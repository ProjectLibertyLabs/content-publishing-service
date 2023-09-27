import { InjectRedis } from '@liaoliaots/nestjs-redis';
import { Processor, WorkerHost, OnWorkerEvent, InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import Redis from 'ioredis';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MILLISECONDS_PER_SECOND } from 'time-constants';
import { BlockHash, Hash } from '@polkadot/types/interfaces';
import { map, tap, timeout } from 'rxjs';
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
      const txCapacityEpoch = job.data.epoch;
      const previousKnownBlockNumber = (await this.blockchainService.getBlock(job.data.lastFinalizedBlockHash)).block.header.number.toBigInt();
      const currentFinalizedBlockNumber = await this.blockchainService.getLatestFinalizedBlockNumber();
      const blockList: bigint[] = [];
      for (let i = previousKnownBlockNumber; i <= currentFinalizedBlockNumber && i < previousKnownBlockNumber + numberBlocksToParse; i += 1n) {
        blockList.push(i);
      }
      const txBlockHash = await this.crawlBlockList(job.data.txHash, txCapacityEpoch, blockList);

      if (txBlockHash) {
        this.logger.verbose(`Successfully completed job ${job.id}`);
        return { success: true };
      }
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

  private async crawlBlockList(txHash: Hash, epoch: string, blockList: bigint[]): Promise<BlockHash | undefined> {
    // Use Promise.all to await all filter operations before returning undefined
    await Promise.all(
      blockList.map(async (blockNumber) => {
        const blockHash = await this.blockchainService.getBlockHash(blockNumber);
        const block = await this.blockchainService.getBlock(blockHash);
        const txInfo = block.block.extrinsics.filter((extrinsic) => extrinsic.hash.toString() === txHash.toString());
        this.logger.debug(`Extrinsics: ${block.block.extrinsics[0]}`);

        if (txInfo.length > 0) {
          this.logger.debug(`Found tx ${txHash} in block ${blockNumber}`);
          const at = await this.blockchainService.api.at(blockHash.toHex());
          const events = await at.query.system.events();
          events.subscribe((records) => {
            records.forEach(async (record) => {
              const { event } = record;
              const eventName = event.section;
              const { method } = event;
              const { data } = event;
              this.logger.error(`Received event: ${eventName} ${method} ${data}`);
              if (eventName.search('capacity') !== -1 && method.search('Withdrawn') !== -1) {
                const capacityWithDrawn = BigInt(data[1].toString());
                this.logger.debug(`Capacity withdrawn: ${capacityWithDrawn}`);
                this.setEpochCapacity(epoch, capacityWithDrawn);
              }
            });
          });
        }
      }),
    );

    return undefined;
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
