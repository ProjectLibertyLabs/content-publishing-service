/*
https://docs.nestjs.com/modules
*/

import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PublishingService } from './publishing.service';
import { PublishEventListener } from './publish-event.listener';
import { ConfigModule } from '../../../api/src/config/config.module';
import { ConfigService } from '../../../api/src/config/config.service';
import { BlockchainModule } from '../../../api/src/blockchain/blockchain.module';

@Module({
  imports: [
    EventEmitterModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        // Note: BullMQ doesn't honor a URL for the Redis connection, and
        // JS URL doesn't parse 'redis://' as a valid protocol, so we fool
        // it by changing the URL to use 'http://' in order to parse out
        // the host, port, username, password, etc.
        // We could pass REDIS_HOST, REDIS_PORT, etc, in the environment, but
        // trying to keep the # of environment variables from proliferating
        const url = new URL(configService.redisUrl.toString().replace(/^redis[s]*/, 'http'));
        const { hostname, port, username, password, pathname } = url;
        return {
          connection: {
            host: hostname || undefined,
            port: port ? Number(port) : undefined,
            username: username || undefined,
            password: password || undefined,
            db: pathname?.length > 1 ? Number(pathname.slice(1)) : undefined,
          },
        };
      },
      inject: [ConfigService],
    }),
    BullModule.registerQueue({
      name: 'publishQueue',
      defaultJobOptions: {
        attempts: 1,
        backoff: {
          type: 'exponential',
        },
        removeOnComplete: true,
        removeOnFail: true,
      },
    }),
    ConfigModule,
    BlockchainModule,
  ],
  controllers: [],
  providers: [PublishingService, PublishEventListener],
  exports: [BullModule, BlockchainModule, PublishingService, PublishEventListener],
})
export class PublisherModule {}
