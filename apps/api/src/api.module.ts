import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { RedisModule } from '@songkeys/nestjs-redis';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { MulterModule } from '@nestjs/platform-express';
import { ApiController } from './api.controller';
import { DevelopmentController } from './development.controller';
import { ASSET_QUEUE_NAME, BATCH_QUEUE_NAME, BROADCAST_QUEUE_NAME, PROFILE_QUEUE_NAME, PUBLISH_QUEUE_NAME, REACTION_QUEUE_NAME, REPLY_QUEUE_NAME, REQUEST_QUEUE_NAME, STATUS_QUEUE_NAME, TOMBSTONE_QUEUE_NAME, TRANSACTION_RECEIPT_QUEUE_NAME, UPDATE_QUEUE_NAME } from '../../../libs/common/src';
import { ApiService } from './api.service';
import { IpfsService } from '../../../libs/common/src/utils/ipfs.client';
import { ConfigModule } from '../../../libs/common/src/config/config.module';
import { ConfigService } from '../../../libs/common/src/config/config.service';

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
    BullModule.registerQueue(
      {
        name: ASSET_QUEUE_NAME,
      },
      {
        name: REQUEST_QUEUE_NAME,
      },
      {
        name: BROADCAST_QUEUE_NAME,
      },
      {
        name: REPLY_QUEUE_NAME,
      },
      {
        name: REACTION_QUEUE_NAME,
      },
      {
        name: TOMBSTONE_QUEUE_NAME,
      },
      {
        name: UPDATE_QUEUE_NAME,
      },
      {
        name: PROFILE_QUEUE_NAME,
      },
      {
        name: BATCH_QUEUE_NAME,
      },
      {
        name: PUBLISH_QUEUE_NAME,
      },
      {
        name: TRANSACTION_RECEIPT_QUEUE_NAME,
      },
      {
        name: STATUS_QUEUE_NAME,
      },
    ),

    // Bullboard UI
    BullBoardModule.forRoot({
      route: '/queues',
      adapter: ExpressAdapter,
    }),
    BullBoardModule.forFeature({
      name: ASSET_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: REQUEST_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: BROADCAST_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: REPLY_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: REACTION_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: TOMBSTONE_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: UPDATE_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: PROFILE_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: BATCH_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: PUBLISH_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: TRANSACTION_RECEIPT_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: STATUS_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
    EventEmitterModule.forRoot({
      // Use this instance throughout the application
      global: true,
      // set this to `true` to use wildcards
      wildcard: false,
      // the delimiter used to segment namespaces
      delimiter: '.',
      // set this to `true` if you want to emit the newListener event
      newListener: false,
      // set this to `true` if you want to emit the removeListener event
      removeListener: false,
      // the maximum amount of listeners that can be assigned to an event
      maxListeners: 10,
      // show event name in memory leak message when more than maximum amount of listeners is assigned
      verboseMemoryLeak: false,
      // disable throwing uncaughtException if an error event is emitted and it has no listeners
      ignoreErrors: false,
    }),
    ScheduleModule.forRoot(),
    MulterModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        limits: {
          fileSize: configService.fileUploadMaxSizeInBytes,
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [ConfigService, ApiService, IpfsService],
  controllers: process.env?.ENVIRONMENT === 'dev' ? [DevelopmentController, ApiController] : [ApiController],
  exports: [],
})
export class ApiModule {}
