/*
https://docs.nestjs.com/modules
*/

import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { RedisModule } from '@songkeys/nestjs-redis';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '../../../../libs/common/src/config/config.module';
import { ConfigService } from '../../../../libs/common/src/config/config.service';
import { BATCH_QUEUE_NAME, BROADCAST_QUEUE_NAME, PROFILE_QUEUE_NAME, REACTION_QUEUE_NAME, REPLY_QUEUE_NAME, TOMBSTONE_QUEUE_NAME, UPDATE_QUEUE_NAME } from '../../../../libs/common/src';
import { BatchingProcessorService } from './batching.processor.service';
import { BroadcastWorker } from './workers/broadcast.worker';
import { ReplyWorker } from './workers/reply.worker';
import { ReactionWorker } from './workers/reaction.worker';
import { TombstoneWorker } from './workers/tombstone.worker';
import { UpdateWorker } from './workers/update.worker';
import { ProfileWorker } from './workers/profile.worker';

@Module({
  imports: [
    ConfigModule,
    RedisModule.forRootAsync(
      {
        imports: [ConfigModule],
        useFactory: (configService: ConfigService) => ({
          config: [{ url: configService.redisUrl.toString() }],
        }),
        inject: [ConfigService],
      },
      true, // isGlobal
    ),
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
    ScheduleModule.forRoot(),
    BullModule.registerQueue({
      name: BATCH_QUEUE_NAME,
    }),
    BullModule.registerQueue({
      name: BROADCAST_QUEUE_NAME,
    }),
    BullModule.registerQueue({
      name: REPLY_QUEUE_NAME,
    }),
    BullModule.registerQueue({
      name: REACTION_QUEUE_NAME,
    }),
    BullModule.registerQueue({
      name: TOMBSTONE_QUEUE_NAME,
    }),
    BullModule.registerQueue({
      name: UPDATE_QUEUE_NAME,
    }),
    BullModule.registerQueue({
      name: PROFILE_QUEUE_NAME,
    }),
  ],
  providers: [BatchingProcessorService, BroadcastWorker, ReplyWorker, ReactionWorker, TombstoneWorker, UpdateWorker, ProfileWorker],
  exports: [BullModule, BatchingProcessorService],
})
export class BatchingProcessorModule {}
