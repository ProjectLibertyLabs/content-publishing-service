import { InjectRedis } from '@liaoliaots/nestjs-redis';
import { Processor, WorkerHost, OnWorkerEvent, InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import Redis from 'ioredis';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MILLISECONDS_PER_SECOND } from 'time-constants';
import { Hash } from '@polkadot/types/interfaces';
import { BlockchainService } from '../../../../libs/common/src/blockchain/blockchain.service';
import { ConfigService } from '../../../../libs/common/src/config/config.service';
import { ITxMonitorJob } from '../interfaces/status-monitor.interface';
import { QueueConstants } from '../../../../libs/common/src';
import { SECONDS_PER_BLOCK } from '../../../../libs/common/src/constants';

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
      const numberBlocksToParse = 100n;
      const previousKnownBlockNumber = (await this.blockchainService.getBlock(job.data.lastFinalizedBlockHash)).block.header.number.toBigInt();
      const currentFinalizedBlockNumber = await this.blockchainService.getLatestFinalizedBlockNumber();
      const blockList: bigint[] = [];
      for (let i = previousKnownBlockNumber; i <= currentFinalizedBlockNumber && i < previousKnownBlockNumber + numberBlocksToParse; i += 1n) {
        blockList.push(i);
      }
      const txReceived = await this.crawlBlockList(job.data.txHash, blockList);

      if (txReceived) {
        this.logger.verbose(`Successfully completed job ${job.id}`);
        return { success: true };
      }
      this.logger.verbose(`Failed to complete job ${job.id}`);
      return { success: false };
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

  private async crawlBlockList(txHash: Hash, blockList: bigint[]): Promise<boolean> {
    blockList.filter(async (blockNumber) => {
      const blockHash = await this.blockchainService.getBlockHash(blockNumber);
      const block = await this.blockchainService.getBlock(blockHash);
      const txInfo = block.block.extrinsics.filter((extrinsic) => extrinsic.hash.toString() === txHash.toString());
      this.logger.debug(`Extrinsics: ${block.block.extrinsics[0]}`);
      if (txInfo.length > 0) {
        this.logger.verbose(`Found tx ${txHash} in block ${blockNumber}`);
        return true;
      }
      return false;
    });
    return blockList.length > 0;
  }

  private async setEpochCapacity(totalCapacityUsed: { [key: string]: bigint }): Promise<void> {
    Object.entries(totalCapacityUsed).forEach(async ([epoch, capacityUsed]) => {
      const epochCapacityKey = `epochCapacity:${epoch}`;

      try {
        const epochCapacity = BigInt((await this.cacheManager.get(epochCapacityKey)) ?? 0);
        const newEpochCapacity = epochCapacity + capacityUsed;

        const epochDurationBlocks = await this.blockchainService.getCurrentEpochLength();
        const epochDuration = epochDurationBlocks * SECONDS_PER_BLOCK * MILLISECONDS_PER_SECOND;

        await this.cacheManager.setex(epochCapacityKey, epochDuration, newEpochCapacity.toString());
      } catch (error) {
        this.logger.error(`Error setting epoch capacity: ${error}`);

        throw error;
      }
    });
  }
}
