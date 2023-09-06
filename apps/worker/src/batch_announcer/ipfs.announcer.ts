import { Injectable, Logger } from '@nestjs/common';
import { PassThrough } from 'node:stream';
import { ParquetWriter } from '@dsnp/parquetjs';
import parquet from '@dsnp/frequency-schemas/parquet';
import {
  ActivityContentImageLink,
  ActivityContentProfile,
  ActivityContentTag,
  ActivityContentAttachment,
  ActivityContentLink,
  ActivityContentImage,
  ActivityContentVideoLink,
  ActivityContentVideo,
  ActivityContentAudio,
  ActivityContentAudioLink,
} from '@dsnp/activity-content/types';
import { BlockchainService } from '../blockchain/blockchain.service';
import { ConfigService } from '../../../api/src/config/config.service';
import { IBatchAnnouncerJobData } from '../interfaces/batch-announcer.job.interface';
import { IPublisherJob } from '../interfaces/publisher-job.interface';
import { IpfsService } from '../../../../libs/common/src/utils/ipfs.client';
import { calculateDsnpHash } from '../../../../libs/common/src/utils/ipfs';
import {
  AnnouncementTypeDto,
  BroadcastDto,
  ReplyDto,
  ReactionDto,
  UpdateDto,
  ProfileDto,
  UpdateAnnouncementTypeDto,
  TagTypeDto,
  AttachmentTypeDto,
  AssetDto,
} from '../../../../libs/common/src';
import { createBroadcast, createReply, createReaction, createNote, createProfile } from '../../../../libs/common/src/interfaces/dsnp';

@Injectable()
export class IpfsAnnouncer {
  private logger: Logger;

  constructor(
    private configService: ConfigService,
    private blockchainService: BlockchainService,
    private ipfsService: IpfsService,
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
        case AnnouncementTypeDto.BROADCAST:
          await this.processBroadcast(writer, announcement.content as BroadcastDto, announcement.dsnpUserId);
          break;
        case AnnouncementTypeDto.REPLY:
          await this.processReply(writer, announcement.content as ReplyDto, announcement.dsnpUserId);
          break;
        case AnnouncementTypeDto.REACTION:
          await this.processReaction(writer, announcement.content as ReactionDto, announcement.dsnpUserId);
          break;
        case AnnouncementTypeDto.UPDATE:
          await this.processUpdate(writer, announcement.content as UpdateDto, announcement.dsnpUserId);
          break;
        case AnnouncementTypeDto.PROFILE:
          await this.processProfile(writer, announcement.content as ProfileDto, announcement.dsnpUserId);
          break;
        case AnnouncementTypeDto.TOMBSTONE:
          // TODO
          break;
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

  private async processBroadcast(writer: ParquetWriter, content: BroadcastDto, dsnpUserId: string): Promise<void> {
    this.logger.debug(`Processing broadcast`);
    const [cid, ipfsUrl, hash] = await this.prepareNote(content);
    const broadcastActivity = createBroadcast(dsnpUserId, ipfsUrl, hash);
    await writer.appendRow(broadcastActivity);
  }

  private async processReply(writer: ParquetWriter, content: ReplyDto, dsnpUserId: string): Promise<void> {
    this.logger.debug(`Processing reply for ${content.inReplyTo}`);
    const [cid, ipfsUrl, hash] = await this.prepareNote(content);
    const replyActivity = createReply(dsnpUserId, ipfsUrl, hash, content.inReplyTo);
    await writer.appendRow(replyActivity);
  }

  private async processReaction(writer: ParquetWriter, content: ReactionDto, dsnpUserId: string): Promise<void> {
    this.logger.debug(`Processing reaction ${content.emoji} for ${content.inReplyTo}`);
    const reactionActivity = await createReaction(dsnpUserId, content.emoji, content.inReplyTo);
    await writer.appendRow(reactionActivity);
  }

  private async processUpdate(writer: ParquetWriter, content: UpdateDto, dsnpUserId: string): Promise<void> {
    this.logger.debug(`Processing update`);
    if (content.targetAnnouncementType === UpdateAnnouncementTypeDto.BROADCAST) {
      const [cid, ipfsUrl, hash] = await this.prepareNote(content as BroadcastDto);
      const broadcastActivity = createBroadcast(dsnpUserId, ipfsUrl, hash);
      await writer.appendRow(broadcastActivity);
    } else if (content.targetAnnouncementType === UpdateAnnouncementTypeDto.REPLY) {
      const [cid, ipfsUrl, hash] = await this.prepareNote(content as ReplyDto);
      const replyActivity = createReply(dsnpUserId, ipfsUrl, hash, content.inReplyTo ?? '');
      await writer.appendRow(replyActivity);
    }
  }

  private async processProfile(writer: ParquetWriter, content: ProfileDto, dsnpUserId: string): Promise<void> {
    this.logger.debug(`Processing profile`);
    const attachments: ActivityContentImageLink[] = [];
    const icons = content.profile.icon || [];
    icons.forEach(async (icon) => {
      const contentBuffer = await this.ipfsService.getPinned(icon.referenceId);
      const hashedContent = await calculateDsnpHash(contentBuffer);
      const image: ActivityContentImageLink = {
        mediaType: 'image', // TODO
        hash: [hashedContent],
        height: icon.height,
        width: icon.width,
        type: 'Link',
        href: await this.formIpfsUrl(icon.referenceId),
      };
      attachments.push(image);
    });

    const profileActivity: ActivityContentProfile = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Profile',
      name: content.profile.name || '',
      published: content.profile.published || '',
      location: {
        latitude: content.profile.location?.latitude,
        longitude: content.profile.location?.longitude,
        radius: content.profile.location?.radius,
        altitude: content.profile.location?.altitude,
        accuracy: content.profile.location?.accuracy,
        name: content.profile.location?.name || '',
        type: 'Place',
      },
      summary: content.profile.summary || '',
      icon: attachments,
    };
    const profileString = JSON.stringify(profileActivity);
    const [cid, hash] = await this.pinStringToIPFS(Buffer.from(profileString));
    const profileAnnouncement = createProfile(dsnpUserId, await this.formIpfsUrl(cid), hash);
    await writer.appendRow(profileAnnouncement);
  }

  private async bufferPublishStream(publishStream: PassThrough): Promise<Buffer> {
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

  public async prepareNote(noteContent?: any): Promise<[string, string, string]> {
    this.logger.debug(`Preparing note`);
    const tags: ActivityContentTag[] = [];
    if (noteContent?.content.tag) {
      noteContent.content.tag.forEach((tag) => {
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
    if (noteContent?.content.assets) {
      noteContent.content.assets.forEach(async (asset: AssetDto) => {
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
          case AttachmentTypeDto.IMAGE: {
            const imageLinks: ActivityContentImageLink[] = [];
            asset.references?.forEach(async (reference) => {
              const contentBuffer = await this.ipfsService.getPinned(reference.referenceId);
              const hashedContent = await calculateDsnpHash(contentBuffer);
              const image: ActivityContentImageLink = {
                mediaType: 'image', // TODO
                hash: [hashedContent],
                height: reference.height,
                width: reference.width,
                type: 'Link',
                href: await this.formIpfsUrl(reference.referenceId),
              };
              imageLinks.push(image);
            });
            const imageActivity: ActivityContentImage = {
              type: 'Image',
              name: asset.name || '',
              url: imageLinks,
            };

            attachments.push(imageActivity);
            break;
          }
          case AttachmentTypeDto.VIDEO: {
            const videoLinks: ActivityContentVideoLink[] = [];
            let duration = '';
            asset.references?.forEach(async (reference) => {
              const contentBuffer = await this.ipfsService.getPinned(reference.referenceId);
              const hashedContent = await calculateDsnpHash(contentBuffer);
              const video: ActivityContentVideoLink = {
                mediaType: 'video', // TODO
                hash: [hashedContent],
                height: reference.height,
                width: reference.width,
                type: 'Link',
                href: await this.formIpfsUrl(reference.referenceId),
              };
              duration = reference.duration ?? '';
              videoLinks.push(video);
            });
            const videoActivity: ActivityContentVideo = {
              type: 'Video',
              name: asset.name || '',
              url: videoLinks,
              duration,
            };

            attachments.push(videoActivity);
            break;
          }
          case AttachmentTypeDto.AUDIO: {
            const audioLinks: ActivityContentAudioLink[] = [];
            let duration = '';
            asset.references?.forEach(async (reference) => {
              const contentBuffer = await this.ipfsService.getPinned(reference.referenceId);
              const hashedContent = await calculateDsnpHash(contentBuffer);
              duration = reference.duration ?? '';
              const audio: ActivityContentAudioLink = {
                mediaType: 'audio', // TODO
                hash: [hashedContent],
                type: 'Link',
                href: await this.formIpfsUrl(reference.referenceId),
              };
              audioLinks.push(audio);
            });
            const audioActivity: ActivityContentAudio = {
              type: 'Audio',
              name: asset.name || '',
              url: audioLinks,
              duration,
            };

            attachments.push(audioActivity);
            break;
          }
          default:
            throw new Error(`Unsupported attachment type ${typeof asset.type}`);
        }
      });
    }

    const note = createNote(noteContent?.content.content ?? '', new Date(noteContent?.content.published ?? ''), {
      name: noteContent?.content.name,
      location: {
        latitude: noteContent?.content.location?.latitude,
        longitude: noteContent?.content.location?.longitude,
        radius: noteContent?.content.location?.radius,
        altitude: noteContent?.content.location?.altitude,
        accuracy: noteContent?.content.location?.accuracy,
        name: noteContent?.content.location?.name || '',
        type: 'Place',
      },
      tag: tags,
      attachment: attachments,
    });
    const noteString = JSON.stringify(note);
    const [cid, hash] = await this.pinStringToIPFS(Buffer.from(noteString));
    const ipfsUrl = await this.formIpfsUrl(cid);
    return [cid, hash, ipfsUrl];
  }

  private async pinStringToIPFS(buf: Buffer): Promise<[string, string]> {
    const { cid, size } = await this.ipfsService.ipfsPin('application/octet-stream', buf);
    return [cid.toString(), size.toString()];
  }

  private async formIpfsUrl(cid: string): Promise<string> {
    return this.configService.getIpfsCidPlaceholder(cid);
  }
}
