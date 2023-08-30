import { InjectRedis } from '@liaoliaots/nestjs-redis';
import { Processor, WorkerHost, OnWorkerEvent, InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import Redis from 'ioredis';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BlockchainService } from '../blockchain/blockchain.service';
import { ConfigService } from '../../../api/src/config/config.service';
import { CAPACITY_EPOCH_TIMEOUT_NAME } from '../../../../libs/common/src/constants';
import { IStatusMonitorJob } from '../interfaces/status-monitor.interface';

@Injectable()
@Processor('txReceiptQueue', {
  concurrency: 2,
})
export class StatusMonitoringService extends WorkerHost implements OnApplicationBootstrap, OnModuleDestroy {
  private logger: Logger;

  constructor(
    @InjectRedis() private cacheManager: Redis,
    @InjectQueue('publishQueue') private publishQueue: Queue,
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
      // 💀 //
    }
  }

  async process(job: Job<IStatusMonitorJob, any, string>): Promise<any> {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`);
    try {
      this.logger.verbose(`Successfully completed job ${job.id}`);
      return { success: true };
    } catch (e) {
      this.logger.error(`Job ${job.id} failed (attempts=${job.attemptsMade})`);
      if (e instanceof Error && e.message.includes('Inability to pay some fees')) {
        this.eventEmitter.emit('capacity.exhausted');
        // TODO: revisit this logic
      }
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
}
