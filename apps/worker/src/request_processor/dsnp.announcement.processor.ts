import {
  ActivityContentTag,
  ActivityContentAttachment,
  ActivityContentLink,
  ActivityContentImageLink,
  ActivityContentImage,
  ActivityContentVideoLink,
  ActivityContentVideo,
  ActivityContentAudioLink,
  ActivityContentAudio,
  ActivityContentProfile,
} from '@dsnp/activity-content/types';
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  TagTypeDto,
  AssetDto,
  AttachmentTypeDto,
  IRequestJob,
  QueueConstants,
  BroadcastDto,
  ProfileDto,
  ReactionDto,
  ReplyDto,
  UpdateDto,
  AnnouncementTypeDto,
  TombstoneDto,
  ModifiableAnnouncementTypeDto,
} from '../../../../libs/common/src';
import { IpfsService } from '../../../../libs/common/src/utils/ipfs.client';
import { ConfigService } from '../../../api/src/config/config.service';
import { calculateDsnpHash } from '../../../../libs/common/src/utils/ipfs';
import {
  AnnouncementType,
  BroadcastAnnouncement,
  ProfileAnnouncement,
  ReactionAnnouncement,
  ReplyAnnouncement,
  UpdateAnnouncement,
  createBroadcast,
  createNote,
  createProfile,
  createReaction,
  createReply,
  createTombstone,
  createUpdate,
} from '../../../../libs/common/src/interfaces/dsnp';

@Injectable()
export class DsnpAnnouncementProcessor {
  private logger: Logger;

  constructor(
    @InjectQueue(QueueConstants.BROADCAST_QUEUE_NAME) private broadcastQueue: Queue,
    @InjectQueue(QueueConstants.REPLY_QUEUE_NAME) private replyQueue: Queue,
    @InjectQueue(QueueConstants.REACTION_QUEUE_NAME) private reactionQueue: Queue,
    @InjectQueue(QueueConstants.UPDATE_QUEUE_NAME) private updateQueue: Queue,
    @InjectQueue(QueueConstants.PROFILE_QUEUE_NAME) private profileQueue: Queue,
    @InjectQueue(QueueConstants.TOMBSTONE_QUEUE_NAME) private tombstoneQueue: Queue,
    private configService: ConfigService,
    private ipfsService: IpfsService,
  ) {
    this.logger = new Logger(DsnpAnnouncementProcessor.name);
  }

  public async collectAnnouncementAndQueue(data: IRequestJob) {
    this.logger.debug(`Collecting announcement and queueing`);
    this.logger.verbose(`Processing Acitivity: ${data.announcementType} for ${data.dsnpUserId}`);
    try {
      switch (data.announcementType) {
        case AnnouncementTypeDto.BROADCAST: {
          const broadcast = await this.processBroadcast(data.content as BroadcastDto, data.dsnpUserId);
          await this.broadcastQueue.add(`Broadcast Job - ${data.id}`, broadcast, { jobId: data.id, removeOnFail: false, removeOnComplete: 2000 });
          break;
        }
        case AnnouncementTypeDto.REPLY: {
          const reply = await this.processReply(data.content as ReplyDto, data.dsnpUserId);
          await this.replyQueue.add(`Reply Job - ${data.id}`, reply, { jobId: data.id, removeOnFail: false, removeOnComplete: 2000 });
          break;
        }
        case AnnouncementTypeDto.REACTION: {
          const reaction = await this.processReaction(data.content as ReactionDto, data.dsnpUserId);
          await this.reactionQueue.add(`Reaction Job - ${data.id}`, reaction, { jobId: data.id, removeOnFail: false, removeOnComplete: 2000 });
          break;
        }
        case AnnouncementTypeDto.UPDATE: {
          const updateDto = data.content as UpdateDto;
          const updateAnnoucementType: AnnouncementType =
            updateDto.targetAnnouncementType === ModifiableAnnouncementTypeDto.BROADCAST ? AnnouncementType.Broadcast : AnnouncementType.Reply;
          const update = await this.processUpdate(updateDto, updateAnnoucementType, updateDto.targetContentHash ?? '', data.dsnpUserId);
          await this.updateQueue.add(`Update Job - ${data.id}`, update, { jobId: data.id, removeOnFail: false, removeOnComplete: 2000 });
          break;
        }
        case AnnouncementTypeDto.PROFILE: {
          const profile = await this.processProfile(data.content as ProfileDto, data.dsnpUserId);
          await this.profileQueue.add(`Profile Job - ${data.id}`, profile, { jobId: data.id, removeOnFail: false, removeOnComplete: 2000 });
          break;
        }
        case AnnouncementTypeDto.TOMBSTONE: {
          const tombStoneDto = data.content as TombstoneDto;
          let targetAnnouncementType: AnnouncementType;
          switch (tombStoneDto.targetAnnouncementType) {
            case ModifiableAnnouncementTypeDto.BROADCAST: {
              targetAnnouncementType = AnnouncementType.Broadcast;
              break;
            }
            case ModifiableAnnouncementTypeDto.REPLY: {
              targetAnnouncementType = AnnouncementType.Reply;
              break;
            }
            default:
              throw new Error(`Unsupported target announcement type ${typeof tombStoneDto.targetAnnouncementType}`);
          }
          const announcementType: AnnouncementType = targetAnnouncementType;
          const tombstone = createTombstone(data.dsnpUserId, announcementType, tombStoneDto.targetContentHash ?? '');
          await this.tombstoneQueue.add(`Tombstone Job - ${data.id}`, tombstone, { jobId: data.id, removeOnFail: false, removeOnComplete: 2000 });
          break;
        }
        default:
          throw new Error(`Unsupported announcement type ${typeof data.announcementType}`);
      }
    } catch (e) {
      this.logger.error(`Error processing announcement ${data.announcementType} for ${data.dsnpUserId}: ${e}`);
      throw e;
    }
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
                mediaType: reference.mimeType,
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
                mediaType: reference.mimeType,
                hash: [hashedContent],
                height: reference.height,
                width: reference.width,
                type: 'Link',
                href: await this.formIpfsUrl(reference.referenceId),
              };
              duration = duration ?? reference.duration ?? '';
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
              duration = duration ?? reference.duration ?? '';
              const audio: ActivityContentAudioLink = {
                mediaType: reference.mimeType,
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
    const [cid, hash] = await this.pinBufferToIPFS(Buffer.from(noteString));
    const ipfsUrl = await this.formIpfsUrl(cid);
    return [cid, hash, ipfsUrl];
  }

  private async processBroadcast(content: BroadcastDto, dsnpUserId: string): Promise<BroadcastAnnouncement> {
    this.logger.debug(`Processing broadcast`);
    const [cid, ipfsUrl, hash] = await this.prepareNote(content);
    return createBroadcast(dsnpUserId, ipfsUrl, hash);
  }

  private async processReply(content: ReplyDto, dsnpUserId: string): Promise<ReplyAnnouncement> {
    this.logger.debug(`Processing reply for ${content.inReplyTo}`);
    const [cid, ipfsUrl, hash] = await this.prepareNote(content);
    return createReply(dsnpUserId, ipfsUrl, hash, content.inReplyTo);
  }

  private async processReaction(content: ReactionDto, dsnpUserId: string): Promise<ReactionAnnouncement> {
    this.logger.debug(`Processing reaction ${content.emoji} for ${content.inReplyTo}`);
    return createReaction(dsnpUserId, content.emoji, content.inReplyTo);
  }

  private async processUpdate(content: UpdateDto, targetAnnouncementType: AnnouncementType, targetContentHash: string, dsnpUserId: string): Promise<UpdateAnnouncement> {
    this.logger.debug(`Processing update`);
    const [cid, ipfsUrl, hash] = await this.prepareNote(content);
    return createUpdate(dsnpUserId, ipfsUrl, hash, targetAnnouncementType, targetContentHash);
  }

  private async processProfile(content: ProfileDto, dsnpUserId: string): Promise<ProfileAnnouncement> {
    this.logger.debug(`Processing profile`);
    const attachments: ActivityContentImageLink[] = [];
    const icons = content.profile.icon || [];
    icons.forEach(async (icon) => {
      const contentBuffer = await this.ipfsService.getPinned(icon.referenceId);
      const hashedContent = await calculateDsnpHash(contentBuffer);
      const image: ActivityContentImageLink = {
        mediaType: icon.mimeType,
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
    const [cid, hash] = await this.pinBufferToIPFS(Buffer.from(profileString));
    return createProfile(dsnpUserId, await this.formIpfsUrl(cid), hash);
  }

  private async pinBufferToIPFS(buf: Buffer): Promise<[string, string, number]> {
    const { cid, hash, size } = await this.ipfsService.ipfsPin('application/octet-stream', buf);
    return [cid.toString(), hash, size];
  }

  private async formIpfsUrl(cid: string): Promise<string> {
    return this.configService.getIpfsCidPlaceholder(cid);
  }
}
