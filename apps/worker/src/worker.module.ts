import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WorkerService } from './worker.service';
import { PublisherModule } from './publisher/publisher.module';
import { PublishingService } from './publisher/publishing.service';
@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: 'localhost',
        port: 6379,
        enableOfflineQueue: false,
      },
    }),
    BullModule.registerQueue({
      name: 'testQueue',
    }),
    PublisherModule,
  ],
  providers: [WorkerService, PublishingService],
})
export class WorkerModule {}
