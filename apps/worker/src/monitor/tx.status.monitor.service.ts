import { InjectRedis } from '@liaoliaots/nestjs-redis';
import { Processor, WorkerHost, OnWorkerEvent, InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import Redis from 'ioredis';
import { MILLISECONDS_PER_SECOND } from 'time-constants';
import { RegistryError } from '@polkadot/types/types';
import { BlockchainService } from '../../../../libs/common/src/blockchain/blockchain.service';
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
      const blockDelay = 1 * SECONDS_PER_BLOCK * MILLISECONDS_PER_SECOND;

      for (let i = previousKnownBlockNumber; i <= currentFinalizedBlockNumber && i < previousKnownBlockNumber + numberBlocksToParse; i += 1n) {
        blockList.push(i);
      }
      const txResult = await this.blockchainService.crawlBlockListForTx(job.data.txHash, blockList, [{ pallet: 'messages', event: 'MessageStored' }]);
      // if tx has not yet included in a block, throw error to retry
      if (!txResult.blockHash && !txResult.error && job.attemptsMade <= (job.opts.attempts ?? 3)) {
        throw new Error(`Tx not found in block list, retrying (attempts=${job.attemptsMade})`);
      }

      this.setEpochCapacity(txCapacityEpoch, BigInt(txResult.capacityWithDrawn ?? 0n));

      if (txResult.error) {
        this.logger.debug(`Error found in tx result: ${JSON.stringify(txResult.error)}`);
        const errorReport = await this.handleMessagesFailure(job.data.id, txResult.error);
        const failedError = new Error(`Job ${job.data.id} failed with error ${JSON.stringify(txResult.error)}`);

        if (errorReport.pause) {
          await this.publishQueue.pause();
        }

        if (errorReport.retry && job.attemptsMade <= (job.opts.attempts ?? 3)) {
          this.logger.debug(`Retrying job ${job.data.id}`);
          await this.publishQueue.removeRepeatableByKey(job.data.referencePublishJob.id);
          await this.publishQueue.add(job.data.referencePublishJob.id, job.data.referencePublishJob, { delay: blockDelay });
        }
      }
      await this.txReceiptQueue.removeRepeatableByKey(job.data.id);
      throw new Error(`Job ${job.data.id} failed with error ${JSON.stringify(txResult.error)}`);
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

  private async handleMessagesFailure(jobId: string, moduleError: RegistryError): Promise<{ pause: boolean; retry: boolean }> {
    this.logger.debug(`Handling extrinsic failure for job ${jobId} and error ${JSON.stringify(moduleError)}`);
    try {
      switch (moduleError.name) {
        case 'Too many messages are added to existing block':
          // Re-try the job in the publish queue
          return { pause: false, retry: true };
        case 'UnAuthorizedDelegate':
          // Re-try the job in the publish, could be a signing error
          return { pause: false, retry: true };
        case 'InvalidMessageSourceAccount':
          return { pause: true, retry: false };
        case 'Invalid SchemaId or Schema not found':
          return { pause: true, retry: false };
        case 'Message payload size is too large' || 'Invalid payload location' || 'Unsupported CID version' || 'Invalid CID':
          return { pause: false, retry: false };
        default:
          this.logger.error(`Unknown module error ${moduleError}`);
      }
    } catch (error) {
      this.logger.error(`Error handling module error: ${error}`);
    }

    // unknown error, pause the queue
    return { pause: true, retry: false };
  }

  private async setEpochCapacity(epoch: string, capacityWithdrew: bigint): Promise<void> {
    const epochCapacityKey = `epochCapacity:${epoch}`;

    try {
      const savedCapacity = await this.cacheManager.get(epochCapacityKey);
      const epochCapacity = BigInt(savedCapacity ?? 0);
      const newEpochCapacity = epochCapacity + capacityWithdrew;

      const epochDurationBlocks = await this.blockchainService.getCurrentEpochLength();
      const epochDuration = epochDurationBlocks * SECONDS_PER_BLOCK * MILLISECONDS_PER_SECOND;
      await this.cacheManager.setex(epochCapacityKey, epochDuration, newEpochCapacity.toString());
    } catch (error) {
      this.logger.error(`Error setting epoch capacity: ${error}`);
    }
  }
}
