import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { BulkJobOptions } from 'bullmq/dist/esm/interfaces';
import { InjectRedis } from '@liaoliaots/nestjs-redis';
import Redis from 'ioredis';
import { ValidationError } from 'class-validator';
import { HttpErrorByCode } from '@nestjs/common/utils/http-error-by-code.util';
import {
  AnnouncementResponseDto,
  AnnouncementTypeDto,
  AssetIncludedRequestDto,
  AssetValidationResponseDto,
  BroadcastDto,
  IRequestJob,
  ProfileDto,
  QueueConstants,
  ReplyDto,
  RequestTypeDto,
  UpdateDto,
  UploadResponseDto,
} from '../../../libs/common/src';
import { calculateIpfsCID } from '../../../libs/common/src/utils/ipfs';
import { IAssetJob, IAssetMetadata } from '../../../libs/common/src/interfaces/asset-job.interface';
import { RedisUtils } from '../../../libs/common/src/utils/redis';
import getAssetDataKey = RedisUtils.getAssetDataKey;
import getAssetMetadataKey = RedisUtils.getAssetMetadataKey;

@Injectable()
export class ApiService {
  private readonly logger: Logger;

  constructor(
    @InjectRedis() private redis: Redis,
    @InjectQueue(QueueConstants.REQUEST_QUEUE_NAME) private requestQueue: Queue,
    @InjectQueue(QueueConstants.ASSET_QUEUE_NAME) private assetQueue: Queue,
  ) {
    this.logger = new Logger(this.constructor.name);
  }

  async enqueueRequest(announcementType: AnnouncementTypeDto, dsnpUserId: string, content?: RequestTypeDto, targetContentHash?: string): Promise<AnnouncementResponseDto> {
    const data = {
      content,
      id: '',
      announcementType,
      dsnpUserId,
      targetContentHash,
    } as IRequestJob;
    data.id = this.calculateJobId(data);
    const job = await this.requestQueue.add(`Request Job - ${data.id}`, data, { jobId: data.id, removeOnFail: false, removeOnComplete: 2000 }); // TODO: should come from config
    this.logger.debug(job);
    return {
      referenceId: data.id,
    };
  }

  async validateAssets(announcementType: AnnouncementTypeDto, content: AssetIncludedRequestDto): Promise<AssetValidationResponseDto> {
    const checkingList: Array<{ onlyImage: boolean; referenceId: string }> = [];
    if (announcementType === AnnouncementTypeDto.PROFILE) {
      (content as ProfileDto).profile.icon?.forEach((reference) => checkingList.push({ onlyImage: true, referenceId: reference.referenceId }));
    } else if (announcementType === AnnouncementTypeDto.BROADCAST) {
      (content as BroadcastDto).content.assets?.forEach(
        (asset) =>
          asset.references?.forEach((reference) =>
            checkingList.push({
              onlyImage: false,
              referenceId: reference.referenceId,
            }),
          ),
      );
    } else if (announcementType === AnnouncementTypeDto.REPLY) {
      (content as ReplyDto).content.assets?.forEach(
        (asset) =>
          asset.references?.forEach((reference) =>
            checkingList.push({
              onlyImage: false,
              referenceId: reference.referenceId,
            }),
          ),
      );
    } else if (announcementType === AnnouncementTypeDto.UPDATE) {
      (content as UpdateDto).content.assets?.forEach(
        (asset) =>
          asset.references?.forEach((reference) =>
            checkingList.push({
              onlyImage: false,
              referenceId: reference.referenceId,
            }),
          ),
      );
    }

    const redisResults = await Promise.all(checkingList.map((obj) => this.redis.get(getAssetMetadataKey(obj.referenceId))));
    const errors: ValidationError[] = [];
    redisResults.forEach((res, index) => {
      console.log(res);
      if (res === null) {
        errors.push({
          toString(shouldDecorate?: boolean, hasParent?: boolean, parentPath?: string, showConstraintMessages?: boolean): string {
            return `Asset ${checkingList[index].referenceId} does not exist!`;
          },
          property: 'assetReferenceId',
          value: checkingList[index].referenceId,
          constraints: { reference: `Asset ${checkingList[index].referenceId} does not exist!` },
        });
      }
    });
    if (errors.length > 0) {
      throw new HttpErrorByCode[400](errors);
    }
    return {
      isValid: true,
    } as AssetValidationResponseDto;
  }

  // TODO: make all these operations transactional
  // eslint-disable-next-line no-undef,class-methods-use-this
  async addAssets(files: Array<Express.Multer.File>): Promise<UploadResponseDto> {
    // calculate ipfs cid references
    const promises: Promise<string>[] = files.map((file) => calculateIpfsCID(file.buffer));
    const references = await Promise.all(promises);

    // add assets to redis
    const redisDataOps = files.map((f, index) => this.redis.set(getAssetDataKey(references[index]), f.buffer));
    const addedData = await Promise.all(redisDataOps);
    this.logger.debug(addedData);

    // add asset jobs to the queue
    const jobs: any[] = [];
    files.forEach((f, index) => {
      jobs.push({
        name: `Asset Job - ${references[index]}`,
        data: {
          ipfsCid: references[index],
          contentLocation: getAssetDataKey(references[index]),
          mimeType: f.mimetype,
        } as IAssetJob,
        opts: {
          jobId: references[index],
          removeOnFail: false,
          removeOnComplete: true,
        } as BulkJobOptions,
      });
    });
    const queuedJobs = await this.assetQueue.addBulk(jobs);
    this.logger.debug(queuedJobs);

    // add metadata to redis
    const redisMetadataOps = files.map((f, index) =>
      this.redis.set(
        getAssetMetadataKey(references[index]),
        JSON.stringify({
          ipfsCid: references[index],
          mimeType: f.mimetype,
          createdOn: Date.now(),
        } as IAssetMetadata),
      ),
    );
    const addedMetadata = await Promise.all(redisMetadataOps);
    this.logger.debug(addedMetadata);

    return {
      assetIds: references,
    };
  }

  // eslint-disable-next-line class-methods-use-this
  calculateJobId(jobWithoutId: IRequestJob): string {
    const stringVal = JSON.stringify(jobWithoutId);
    return createHash('sha1').update(stringVal).digest('base64url');
  }
}
