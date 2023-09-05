import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PassThrough } from 'node:stream';
import { ParquetWriter } from '@dsnp/parquetjs';
import parquet from '@dsnp/frequency-schemas/parquet';
import {
  ActivityContentAttachment,
  ActivityContentImage,
  ActivityContentImageLink,
  ActivityContentLink,
  ActivityContentNote,
  ActivityContentTag,
} from '@dsnp/activity-content/types';
import { BlockchainService } from '../blockchain/blockchain.service';
import { ConfigService } from '../../../api/src/config/config.service';
import {
  createBroadcast,
  BroadcastAnnouncement,
  createNote,
  ReplyAnnouncement,
  createReply,
  createReaction,
  ReactionAnnouncement,
  ProfileAnnouncement,
  createProfile,
} from '../../../../libs/common/src/interfaces/dsnp';
import {
  AnnouncementTypeDto,
  AttachmentTypeDto,
  BroadcastDto,
  ProfileDto,
  ReactionDto,
  ReplyDto,
  TagTypeDto,
  UpdateAnnouncementTypeDto,
  UpdateDto,
} from '../../../../libs/common/src';
import { IBatchAnnouncerJobData } from '../interfaces/batch-announcer.job.interface';
import { IPublisherJob } from '../interfaces/publisher-job.interface';
import { IpfsService } from '../../../../libs/common/src/utils/ipfs.client';

@Injectable()
export class IpfsAnnouncer {
  private logger: Logger;

  constructor(
    private configService: ConfigService,
    private blockchainService: BlockchainService,
    private ipfsService: IpfsService,
    private eventEmitter: EventEmitter2,
  ) {
    this.logger = new Logger(IpfsAnnouncer.name);
  }

  public async announce(batchJob: IBatchAnnouncerJobData): Promise<IPublisherJob> {
    this.logger.debug(`Announcing batch ${batchJob.batchId} on IPFS`);
    const { batchId, schemaId, announcements } = batchJob;

    const frequencySchema = await this.blockchainService.getSchema(schemaId);
    const schema = JSON.parse(frequencySchema.model.toString());
    if (!schema) {
      throw new Error(`Unable to parse schema for schemaId ${schemaId}`);
    }

    const [parquetSchema, writerOptions] = parquet.fromFrequencySchema(schema);
    const publishStream = new PassThrough();

    const writer = await ParquetWriter.openStream(parquetSchema, publishStream as any, writerOptions);

    announcements.forEach(async (announcement) => {
      switch (announcement.announcementType) {
        case AnnouncementTypeDto.BROADCAST: {
          const broadcastNote = await this.prepareNoteAndBroadcast(announcement.dsnpUserId, announcement.content as BroadcastDto);
          await writer.appendRow(broadcastNote);
          break;
        }
        case AnnouncementTypeDto.REPLY: {
          const replyNote = await this.prepareNoteAndReply(announcement.dsnpUserId, announcement.content as ReplyDto);
          await writer.appendRow(replyNote);
          break;
        }
        case AnnouncementTypeDto.REACTION: {
          const reactionNote = await this.prepareNoteAndReaction(announcement.dsnpUserId, announcement.content as ReactionDto);
          await writer.appendRow(reactionNote);
          break;
        }
        case AnnouncementTypeDto.UPDATE: {
          const updateInfo = announcement.content as UpdateDto;
          if (updateInfo.targetAnnouncementType === UpdateAnnouncementTypeDto.BROADCAST) {
            const broadcastNote = await this.prepareNoteAndBroadcast(announcement.dsnpUserId, { content: updateInfo.content });
            await writer.appendRow(broadcastNote);
          } else if (updateInfo.targetAnnouncementType === UpdateAnnouncementTypeDto.REPLY) {
            const replyNote = await this.prepareNoteAndReply(announcement.dsnpUserId, { inReplyTo: updateInfo.inReplyTo ?? '', content: updateInfo.content });
            await writer.appendRow(replyNote);
          }
          break;
        }
        case AnnouncementTypeDto.PROFILE: {
          const profileNote = await this.prepareNoteAndProfile(announcement.dsnpUserId, announcement.content as ProfileDto);
          await writer.appendRow(profileNote);
          break;
        }
        case AnnouncementTypeDto.TOMBSTONE: {
          // TODO
          break;
        }
        default:
          throw new Error(`Unsupported announcement type ${typeof announcement}`);
      }
    });

    await writer.close();
    const buffer = await this.bufferPublishStream(publishStream);
    const [cid, hash] = await this.pinStringToIPFS(buffer);
    const ipfsUrl = await this.formIpfsUrl(cid);
    this.logger.debug(`Batch ${batchId} published to IPFS at ${ipfsUrl}`);
    this.logger.debug(`Batch ${batchId} hash: ${hash}`);
    return { id: batchId, schemaId, data: { cid, payloadLength: buffer.length } };
  }

  public async bufferPublishStream(publishStream: PassThrough): Promise<Buffer> {
    this.logger.debug('Buffering publish stream');
    return new Promise((resolve, reject) => {
      const buffers: Buffer[] = [];
      publishStream.on('data', (data) => {
        buffers.push(data);
      });
      publishStream.on('end', () => {
        resolve(Buffer.concat(buffers));
      });
      publishStream.on('error', (err) => {
        reject(err);
      });
    });
  }

  public async prepareNoteAndBroadcast(dsnpUserId: string, broadcast?: BroadcastDto): Promise<BroadcastAnnouncement> {
    const tags: ActivityContentTag[] = [];
    if (broadcast?.content.tag) {
      broadcast.content.tag.forEach((tag) => {
        switch (tag.type) {
          case TagTypeDto.Hashtag:
            tags.push({ name: tag.name || '' });
            break;
          case TagTypeDto.Mention:
            tags.push({
              name: tag.name || '',
              type: 'Mention',
              id: tag.mentionedId || '',
            });
            break;
          default:
            throw new Error(`Unsupported tag type ${typeof tag.type}`);
        }
      });
    }

    const attachments: ActivityContentAttachment[] = [];
    const notes: ActivityContentNote[] = [];
    if (broadcast?.content.assets) {
      broadcast.content.assets.forEach((asset) => {
        switch (asset.type) {
          case AttachmentTypeDto.LINK: {
            const link: ActivityContentLink = {
              type: 'Link',
              href: asset.href || '',
              name: asset.name || '',
            };
            attachments.push(link);
            break;
          }
          case AttachmentTypeDto.IMAGE:
            // TODO
            break;
          case AttachmentTypeDto.VIDEO:
            // TODO
            break;
          case AttachmentTypeDto.AUDIO:
            // TODO
            break;
          default:
            throw new Error(`Unsupported attachment type ${typeof asset.type}`);
        }
      });
    }

    const note = createNote(broadcast?.content.content ?? '', new Date(broadcast?.content.published ?? ''), {
      name: broadcast?.content.name,
      location: {
        latitude: broadcast?.content.location?.latitude,
        longitude: broadcast?.content.location?.longitude,
        radius: broadcast?.content.location?.radius,
        altitude: broadcast?.content.location?.altitude,
        accuracy: broadcast?.content.location?.accuracy,
        name: broadcast?.content.location?.name || '',
        type: 'Place',
      },
      tag: tags,
      attachment: attachments,
    });

    const noteString = JSON.stringify(note);
    const [cid, hash] = await this.pinStringToIPFS(Buffer.from(noteString));
    const ipfsUrl = await this.formIpfsUrl(cid);
    const broadcastActivity = createBroadcast(dsnpUserId, ipfsUrl, hash);
    return broadcastActivity;
  }

  public async prepareNoteAndReply(dsnpUserId: string, reply?: ReplyDto): Promise<ReplyAnnouncement> {
    // TODO
    this.logger.debug(`Preparing reply for ${dsnpUserId}`);
    return createReply(dsnpUserId, '', '', '');
  }

  public async prepareNoteAndReaction(dsnpUserId: string, reaction?: ReactionDto): Promise<ReactionAnnouncement> {
    // TODO
    this.logger.debug(`Preparing reaction for ${dsnpUserId}`);
    return createReaction(dsnpUserId, '', '');
  }

  public async prepareNoteAndProfile(dsnpUserId: string, profile?: ProfileDto): Promise<ProfileAnnouncement> {
    // TODO
    this.logger.debug(`Preparing profile for ${dsnpUserId}`);
    return createProfile(dsnpUserId, '', '');
  }

  private async pinStringToIPFS(buf: Buffer): Promise<[string, string]> {
    const { cid, size } = await this.ipfsService.ipfsPin('application/octet-stream', buf);
    return [cid.toString(), size.toString()];
  }

  private async formIpfsUrl(cid: string): Promise<string> {
    return this.configService.getIpfsCidPlaceholder(cid);
  }
}
