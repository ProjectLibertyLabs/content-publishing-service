import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Job } from 'bullmq';


@Injectable()
@Processor('publishQueue', {
  concurrency: 2,
})
export class PublishingService extends WorkerHost implements OnApplicationBootstrap, OnModuleDestroy {
  
  onApplicationBootstrap() {
    throw new Error('Method not implemented.');
  }
  onModuleDestroy() {
    throw new Error('Method not implemented.');
  }
  private logger: Logger;  // eslint-disable-next-line class-methods-use-this
  async process(job: Job): Promise<any> {
    console.log(job.data);
  }

  // eslint-disable-next-line class-methods-use-this
  @OnWorkerEvent('completed')
  onCompleted() {
    // do some stuff
  }
}
