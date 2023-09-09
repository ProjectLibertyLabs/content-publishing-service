import { InjectRedis } from '@liaoliaots/nestjs-redis';
import { Injectable, Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import Redis from 'ioredis';
import { InjectQueue } from '@nestjs/bullmq';
import { SchedulerRegistry } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { ConfigService } from '../../../api/src/config/config.service';
import { QueueConstants } from '../../../../libs/common/src';
import { Announcement } from '../../../../libs/common/src/interfaces/dsnp';
import { RedisUtils } from '../../../../libs/common/src/utils/redis';
import { IBatchMetadata } from '../../../../libs/common/src/interfaces/batch.interface';
import getBatchMetadataKey = RedisUtils.getBatchMetadataKey;
import getBatchDataKey = RedisUtils.getBatchDataKey;
import { IBatchAnnouncerJobData } from '../interfaces/batch-announcer.job.interface';

@Injectable()
export class BatchingProcessorService {
  private logger: Logger;

  private batchMap: Map<string, IBatchMetadata>;

  constructor(
    @InjectRedis() private redis: Redis,
    @InjectQueue(QueueConstants.BATCH_QUEUE_NAME) private outputQueue: Queue,
    private schedulerRegistry: SchedulerRegistry,
    private configService: ConfigService,
  ) {
    this.logger = new Logger(this.constructor.name);
    this.batchMap = new Map();
  }

  async setupActiveBatchTimeout(queueName: string) {
    const metadata = await this.getMetadataFromRedis(queueName);
    if (metadata) {
      this.batchMap[queueName] = metadata;
      const openTimeMs = Math.round(Date.now() - metadata.startTimestamp);
      const batchTimeoutInMs = 12 * 1000; // TODO: get from config
      if (openTimeMs >= batchTimeoutInMs) {
        await this.closeBatch(queueName, metadata.batchId, false);
      } else {
        const remainingTimeMs = batchTimeoutInMs - openTimeMs;
        const initialTimeout = setTimeout(async (batchQueueName, batchId) => this.closeBatch(batchQueueName, batchId, true), remainingTimeMs);
        this.schedulerRegistry.addTimeout(BatchingProcessorService.getTimeoutName(queueName, metadata.batchId), initialTimeout);
      }
    }
  }

  async process(job: Job<Announcement, any, string>, queueName: string): Promise<any> {
    this.logger.log(`Processing job ${job.id} from ${queueName}`);
    const currentBatch = this.batchMap[queueName];
    if (!currentBatch) {
      // No active batch exists, creating a new one
      const metadata = {
        batchId: randomUUID().toString(),
        startTimestamp: Date.now(),
        rowCount: 1,
      } as IBatchMetadata;
      const result = await this.redis
        .multi()
        .set(getBatchMetadataKey(queueName), JSON.stringify(metadata))
        .hsetnx(getBatchDataKey(queueName), job.id!, JSON.stringify(job.data))
        .exec();
      this.logger.debug(result);
      this.batchMap[queueName] = metadata;
      const initialTimeout = setTimeout(async (batchQueueName, batchId) => this.closeBatch(batchQueueName, batchId, true), 12 * 1000); // TODO: get from config
      this.schedulerRegistry.addTimeout(BatchingProcessorService.getTimeoutName(queueName, metadata.batchId), initialTimeout);
    } else {
      // continue on active batch
      const batchMetadata = await this.getMetadataFromRedis(queueName);
      if (batchMetadata) {
        batchMetadata.rowCount += 1;
        const result = await this.redis
          .multi()
          .hsetnx(getBatchDataKey(queueName), job.id!, JSON.stringify(job.data))
          .set(getBatchMetadataKey(queueName), JSON.stringify(batchMetadata))
          .exec();
        this.logger.debug(result);
        this.batchMap[queueName] = batchMetadata;

        if (batchMetadata.rowCount >= 100) {
          // TODO: get from config
          await this.closeBatch(queueName, batchMetadata.batchId, false);
        }
      } else {
        this.batchMap.delete(queueName);
      }
    }
  }

  async onCompleted(job: Job<Announcement, any, string>, queueName: string) {
    this.logger.log(`Completed ${job.id} from ${queueName}`);
  }

  private async closeBatch(queueName: string, batchId: string, timeout: boolean) {
    this.logger.log(`Closing batch for ${queueName} ${batchId} ${timeout}`);
    const metadata = await this.getMetadataFromRedis(queueName);
    const batch = await this.redis.hgetall(getBatchDataKey(queueName));
    const announcements: Announcement[] = [];
    Object.keys(batch).forEach((key) => {
      const announcement: Announcement = JSON.parse(batch[key]);
      announcements.push(announcement);
    });
    const job = {
      batchId,
      schemaId: 1, // TODO: get from config
      announcements,
    } as IBatchAnnouncerJobData;
    this.outputQueue.add(`Batch Job - ${metadata?.batchId}`, job, { jobId: metadata?.batchId, removeOnFail: false, removeOnComplete: 100 });
    this.logger.log(batch);
    try {
      const result = await this.redis.multi().del(getBatchMetadataKey(queueName)).hdel(getBatchDataKey(queueName)).exec();
      this.logger.debug(result);
      this.schedulerRegistry.deleteTimeout(BatchingProcessorService.getTimeoutName(queueName, batchId));
    } catch (e) {
      this.logger.debug(e);
    }
  }

  private async getMetadataFromRedis(queueName: string): Promise<IBatchMetadata | undefined> {
    const batchMetadata = await this.redis.get(getBatchMetadataKey(queueName));
    return batchMetadata ? JSON.parse(batchMetadata) : undefined;
  }

  // eslint-disable-next-line class-methods-use-this
  private static getTimeoutName(queueName: string, batchId: string): string {
    return `TIMEOUT:${queueName}:${batchId}`;
  }
}
