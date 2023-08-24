/*
https://docs.nestjs.com/modules
*/

import { Module } from '@nestjs/common';
import { PublishingService } from './publisher.service';
import { ConfigModule } from '../config/config.module';

@Module({
  imports: [ConfigModule],
  controllers: [],
  providers: [PublishingService],
  exports: [PublishingService],
})
export class PublisherModule {}
