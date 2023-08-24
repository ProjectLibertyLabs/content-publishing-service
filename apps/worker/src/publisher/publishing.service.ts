import { InjectRedis } from '@liaoliaots/nestjs-redis';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Job } from 'bullmq';
import Redis from 'ioredis';
import { BlockchainService } from '../../../api/src/blockchain/blockchain.service';
import { ConfigService } from '../../../api/src/config/config.service';
import { SchedulerRegistry } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IPublisherJob } from '../interfaces/publisher-job.interface';


@Injectable()
@Processor('publishQueue', {
  concurrency: 2,
})
export class PublishingService extends WorkerHost implements OnApplicationBootstrap, OnModuleDestroy {
  
  private logger: Logger;

  constructor(
    @InjectRedis() private cacheManager: Redis,
    private blockchainService: BlockchainService,
    private configService: ConfigService,
    private schedulerRegistry: SchedulerRegistry,
    private eventEmitter: EventEmitter2,
  ) {
    super();
    this.logger = new Logger(this.constructor.name);
  }
  
  onApplicationBootstrap() {
    throw new Error('Method not implemented.');
  }
  onModuleDestroy() {
    throw new Error('Method not implemented.');
  }
  async process(job: Job<IPublisherJob, any, string>): Promise<any> {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`);
  }

  // eslint-disable-next-line class-methods-use-this
  @OnWorkerEvent('completed')
  onCompleted() {
    // do some stuff
  }
}
