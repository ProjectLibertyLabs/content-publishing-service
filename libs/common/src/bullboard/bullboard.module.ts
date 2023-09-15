import { Module } from '@nestjs/common';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullModule } from '@nestjs/bullmq';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { QueueConstants } from '../utils/queues';

@Module({
  imports: [
    BullModule.registerQueue({
      name: QueueConstants.ASSET_QUEUE_NAME,
    }),
    BullModule.registerQueue({
      name: QueueConstants.REQUEST_QUEUE_NAME,
    }),
    BullModule.registerQueue({
      name: QueueConstants.BROADCAST_QUEUE_NAME,
    }),
    BullModule.registerQueue({
      name: QueueConstants.REPLY_QUEUE_NAME,
    }),
    BullModule.registerQueue({
      name: QueueConstants.REACTION_QUEUE_NAME,
    }),
    BullModule.registerQueue({
      name: QueueConstants.TOMBSTONE_QUEUE_NAME,
    }),
    BullModule.registerQueue({
      name: QueueConstants.BATCH_QUEUE_NAME,
    }),
    BullModule.registerQueue({
      name: QueueConstants.PROFILE_QUEUE_NAME,
    }),
    BullModule.registerQueue({
      name: QueueConstants.PUBLISH_QUEUE_NAME,
    }),
    BullModule.registerQueue({
      name: QueueConstants.STATUS_QUEUE_NAME,
    }),
    BullModule.registerQueue({
      name: QueueConstants.TRANSACTION_RECEIPT_QUEUE_NAME,
    }),
    BullModule.registerQueue({
      name: QueueConstants.UPDATE_QUEUE_NAME,
    }),

    BullBoardModule.forFeature({
      name: QueueConstants.ASSET_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: QueueConstants.REQUEST_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: QueueConstants.BROADCAST_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: QueueConstants.REPLY_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: QueueConstants.REACTION_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: QueueConstants.TOMBSTONE_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: QueueConstants.BATCH_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: QueueConstants.PROFILE_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: QueueConstants.PUBLISH_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: QueueConstants.STATUS_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: QueueConstants.TRANSACTION_RECEIPT_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: QueueConstants.UPDATE_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
  ],
})
export class BullControlPanelModule {}
