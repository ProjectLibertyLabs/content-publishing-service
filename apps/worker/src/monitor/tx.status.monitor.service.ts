import { InjectRedis } from '@liaoliaots/nestjs-redis';
import { Processor, WorkerHost, OnWorkerEvent, InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import Redis from 'ioredis';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MILLISECONDS_PER_SECOND } from 'time-constants';
import { BlockHash, DispatchError, DispatchInfo, Hash } from '@polkadot/types/interfaces';
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
    @InjectQueue(QueueConstants.TRANSACTION_RECEIPT_QUEUE_NAME) private txReceiptQueue,
    @InjectQueue(QueueConstants.PUBLISH_QUEUE_NAME) private publishQueue: Queue,
    private blockchainService: BlockchainService,
    private configService: ConfigService,
    private eventEmitter: EventEmitter2,
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
      const txBlockHash = await this.crawlBlockList(job.data.txHash, txCapacityEpoch, blockList, (moduleError) => this.handleExtrinsicFailure(job.id ?? job.data.id, moduleError));

      if (txBlockHash) {
        this.logger.verbose(`Successfully found submitted tx ${job.data.txHash} in block ${txBlockHash}`);
        return { success: true };
      }

      if (!txBlockHash && job.attemptsMade >= (job.opts.attempts ?? 3)) {
        this.logger.error(`Job ${job.id} failed after ${job.attemptsMade} attempts`);
        return { success: false };
      }
      throw new Error(`Job ${job.id} failed, retrying`);
    } catch (e) {
      this.logger.error(`Job ${job.id} failed (attempts=${job.attemptsMade}) with error: ${e}`);
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

  private async crawlBlockList(txHash: Hash, epoch: string, blockList: bigint[], errorCallback: any): Promise<BlockHash | undefined> {
    const txReceiptPromises: Promise<BlockHash | undefined>[] = blockList.map(async (blockNumber) => {
      const blockHash = await this.blockchainService.getBlockHash(blockNumber);
      const block = await this.blockchainService.getBlock(blockHash);
      const txInfo = block.block.extrinsics.find((extrinsic) => extrinsic.hash.toString() === txHash.toString());
      this.logger.debug(`Extrinsics: ${block.block.extrinsics[0]}`);

      if (txInfo !== undefined) {
        this.logger.verbose(`Found tx ${txHash} in block ${blockNumber}`);
        const at = await this.blockchainService.api.at(blockHash.toHex());
        const events = await at.query.system.events();
        let isMessageSuccess = false;
        events.subscribe((records) => {
          records.forEach(async (record) => {
            const { event } = record;
            const eventName = event.section;
            const { method } = event;
            const { data } = event;
            this.logger.debug(`Received event: ${eventName} ${method} ${data}`);
            if (eventName.search('capacity') !== -1 && method.search('Withdrawn') !== -1) {
              const capacityWithDrawn = BigInt(data[1].toString());
              this.logger.debug(`Capacity withdrawn: ${capacityWithDrawn}`);
              this.setEpochCapacity(epoch, capacityWithDrawn);
            }
            if (eventName.search('messages') !== -1 && method.search('MessageStored') !== -1) {
              isMessageSuccess = true;
            }
            // system.ExtrinsicFailed
            if (eventName.search('system') !== -1 && method.search('ExtrinsicFailed') !== -1) {
              isMessageSuccess = false;
              const dispatchError = data[0] as DispatchError;
              const dispatchInfo = data[1] as DispatchInfo;
              this.logger.warn(`Extrinsic failed with error: ${dispatchError}`);
              this.logger.warn(`Extrinsic failed with info: ${dispatchInfo}`);

              const moduleThatErroed = dispatchError.asModule;
              const moduleError = dispatchError.registry.findMetaError(moduleThatErroed);
              this.logger.error(`Module error: ${moduleError}`);
              errorCallback(moduleError);
            }
          });
        });
        if (isMessageSuccess) {
          this.logger.verbose(`Successfully found submitted ipfs message ${txHash} in block ${blockHash}`);
          return blockHash;
        }
      }
      return undefined;
    });

    const results = await Promise.all(txReceiptPromises);
    const result = results.find((blockHash) => blockHash !== undefined);
    return result;
  }

  private async handleExtrinsicFailure(jobId: string, moduleError: any) {
    this.logger.debug(`Handling extrinsic failure for job ${jobId} and module error ${moduleError}`);
  }

  private async setEpochCapacity(epoch: string, capacityWithdrew: bigint) {
    const epochCapacityKey = `epochCapacity:${epoch}`;

    try {
      const epochCapacity = BigInt((await this.cacheManager.get(epochCapacityKey)) ?? 0);
      const newEpochCapacity = epochCapacity + capacityWithdrew;

      const epochDurationBlocks = await this.blockchainService.getCurrentEpochLength();
      const epochDuration = epochDurationBlocks * SECONDS_PER_BLOCK * MILLISECONDS_PER_SECOND;

      await this.cacheManager.setex(epochCapacityKey, epochDuration, newEpochCapacity.toString());
    } catch (error) {
      this.logger.error(`Error setting epoch capacity: ${error}`);

      throw error;
    }
  }
}
