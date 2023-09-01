import { InjectRedis } from '@liaoliaots/nestjs-redis';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { DelayedError, Job } from 'bullmq';
import Redis from 'ioredis';
import { ConfigService } from '../../../api/src/config/config.service';
import { AnnouncementTypeDto, BroadcastDto, IRequestJob, ProfileDto, QueueConstants, ReplyDto, UpdateDto } from '../../../../libs/common/src';

@Injectable()
@Processor(QueueConstants.REACTION_QUEUE_NAME)
export class RequestProcessorService extends WorkerHost {
  private logger: Logger;

  constructor(
    @InjectRedis() private redis: Redis,
    private configService: ConfigService,
  ) {
    super();
    this.logger = new Logger(this.constructor.name);
  }

  async process(job: Job<IRequestJob, any, string>): Promise<any> {
    this.logger.log(`Processing job ${job.id} of type ${job.name}`);
    this.logger.debug(job.asJSON());
    const assets: string[] = [];
    // eslint-disable-next-line default-case
    switch (job.data.announcementType) {
      case AnnouncementTypeDto.BROADCAST:
        (job.data.content as BroadcastDto).content.assets?.forEach((a) => a.references?.forEach((r) => assets.push(r.referenceId)));
        break;
      case AnnouncementTypeDto.REPLY:
        (job.data.content as ReplyDto).content.assets?.forEach((a) => a.references?.forEach((r) => assets.push(r.referenceId)));
        break;
      case AnnouncementTypeDto.UPDATE:
        (job.data.content as UpdateDto).content.assets?.forEach((a) => a.references?.forEach((r) => assets.push(r.referenceId)));
        break;
      case AnnouncementTypeDto.PROFILE:
        (job.data.content as ProfileDto).profile.icon?.forEach((r) => assets.push(r.referenceId));
    }
    if (assets.length > 0) {
      // TODO: check existence in IPFS
      const { data } = job;
      data.dependencyAttempt += 1;
      if (data.dependencyAttempt < 3) {
        await job.moveToDelayed(data.dependencyAttempt * 60 * 1000, job.token); // TODO: get from config
        await job.update(data);
        throw new DelayedError();
      } else {
        throw new Error('Dependency failed!');
      }
    }
  }

  // eslint-disable-next-line class-methods-use-this
  @OnWorkerEvent('completed')
  onCompleted() {}
}
