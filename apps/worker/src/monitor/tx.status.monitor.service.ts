import { InjectRedis } from '@liaoliaots/nestjs-redis';
import { Processor, WorkerHost, OnWorkerEvent, InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import Redis from 'ioredis';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MILLISECONDS_PER_SECOND } from 'time-constants';
import { RegistryError } from '@polkadot/types/types';
import { BlockchainService } from '../../../../libs/common/src/blockchain/blockchain.service';
import { ConfigService } from '../../../../libs/common/src/config/config.service';
import { ITxMonitorJob } from '../interfaces/status-monitor.interface';
import { QueueConstants } from '../../../../libs/common/src';
import { SECONDS_PER_BLOCK } from '../../../../libs/common/src/constants';
import { BlockchainConstants } from '../../../../libs/common/src/blockchain/blockchain-constants';

@Injectable()
@Processor(QueueConstants.TRANSACTION_RECEIPT_QUEUE_NAME, {
  concurrency: 2,
})
export class TxStatusMonitoringService extends WorkerHost implements OnApplicationBootstrap, OnModuleDestroy {
  private logger: Logger;

  constructor(
    @InjectRedis() private cacheManager: Redis,
    @InjectQueue(QueueConstants.TRANSACTION_RECEIPT_QUEUE_NAME) private txReceiptQueue: Queue,
    @InjectQueue(QueueConstants.PUBLISH_QUEUE_NAME) private publishQueue: Queue,
    private blockchainService: BlockchainService,
  ) {
    super();
    this.logger = new Logger(this.constructor.name);
  }

  public async onApplicationBootstrap() {
    this.logger.debug('Starting publishing service');
  }

  public onModuleDestroy() {
    try {
      this.logger.debug('Shutting down publishing service');
    } catch (e) {
      // 🐂 //
    }
  }

  async process(job: Job<ITxMonitorJob, any, string>): Promise<any> {
    this.logger.log(`Monitoring job ${job.id} of type ${job.name}`);
    try {
      const numberBlocksToParse = BlockchainConstants.NUMBER_BLOCKS_TO_CRAWL;
      const txCapacityEpoch = job.data.epoch;
      const previousKnownBlockNumber = (await this.blockchainService.getBlock(job.data.lastFinalizedBlockHash)).block.header.number.toBigInt();
      const currentFinalizedBlockNumber = await this.blockchainService.getLatestFinalizedBlockNumber();
      const blockList: bigint[] = [];
      for (let i = previousKnownBlockNumber; i <= currentFinalizedBlockNumber && i < previousKnownBlockNumber + numberBlocksToParse; i += 1n) {
        blockList.push(i);
      }
      const txResult = await this.blockchainService.crawlBlockListForTx(job.data.txHash, blockList, [{ pallet: 'messages', event: 'MessageStored' }]);
      if (!txResult.blockHash && !txResult.error && job.attemptsMade <= (job.opts.attempts ?? 3)) {
        throw new Error(`Tx not found in block list, retrying (attempts=${job.attemptsMade})`);
      }

      // take actions on error and fail the job
      if (txResult.error) {
        await this.handleMessagesFailure(job.data.id, txResult.error);
      }
      this.setEpochCapacity(txCapacityEpoch, txResult.capacityWithDrawn ?? 0n);
      return { success: txResult.success };
    } catch (e) {
      this.logger.error(e);
      throw e;
    } finally {
      // do some stuff
    }
  }

  // eslint-disable-next-line class-methods-use-this
  @OnWorkerEvent('completed')
  onCompleted() {
    // do some stuff
  }

  private async handleMessagesFailure(jobId: string, moduleError: RegistryError): Promise<void> {
    this.logger.debug(`Handling extrinsic failure for job ${jobId} and error ${JSON.stringify(moduleError)}`);
    const txJob = (await this.txReceiptQueue.getJob(jobId)) as Job<ITxMonitorJob, any, string>;
    if (!txJob) {
      this.logger.error(`Job ${jobId} not found in tx receipt queue`);
    }
    const blockDelay = 1 * SECONDS_PER_BLOCK * MILLISECONDS_PER_SECOND;

    try {
      switch (moduleError.name) {
        case 'TooManyMessagesInBlock':
          // Re-try the job in the publish queue with a block delay
          await this.publishQueue.removeRepeatableByKey(txJob.data.referencePublishJob.id);
          await this.publishQueue.add(txJob.data.referencePublishJob.id, txJob.data.referencePublishJob, { delay: blockDelay });
          break;
        case 'InvalidMessageSourceAccount':
          // PROVIDER_ID is not set correctly
          // Pause publishing entirely
          this.publishQueue.pause();
          break;
        case 'InvalidSchemaId':
          // Fail the job since this should never happen, or is a protocol error
          // pause publishing entirely
          this.publishQueue.pause();
          break;
        case 'UnAuthorizedDelegate':
          // Re-try the job in the publish queue with a block delay, could be a signing error
          await this.publishQueue.removeRepeatableByKey(txJob.data.referencePublishJob.id);
          await this.publishQueue.add(txJob.data.referencePublishJob.id, txJob.data.referencePublishJob, { delay: blockDelay });
          break;
        case 'ExceedsMaxMessagePayloadSizeBytes' || 'InvalidPayloadLocation' || 'UnsupportedCid' || 'InvalidCid':
          break;
        default:
          this.logger.error(`Unknown module error ${moduleError}`);
      }
    } catch (error) {
      this.logger.error(`Error handling module error: ${error}`);
    }
  }

  private async setEpochCapacity(epoch: string, capacityWithdrew: bigint): Promise<void> {
    const epochCapacityKey = `epochCapacity:${epoch}`;

    try {
      const epochCapacity = BigInt((await this.cacheManager.get(epochCapacityKey)) ?? 0);
      const newEpochCapacity = epochCapacity + capacityWithdrew;

      const epochDurationBlocks = await this.blockchainService.getCurrentEpochLength();
      const epochDuration = epochDurationBlocks * SECONDS_PER_BLOCK * MILLISECONDS_PER_SECOND;

      await this.cacheManager.setex(epochCapacityKey, epochDuration, newEpochCapacity.toString());
    } catch (error) {
      this.logger.error(`Error setting epoch capacity: ${error}`);
    }
  }
}
