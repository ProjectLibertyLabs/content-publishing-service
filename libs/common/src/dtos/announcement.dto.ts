/**
 * File name should always end with `.dto.ts` for swagger metadata generator to get picked up
 */
// eslint-disable-next-line max-classes-per-file
import { NoteActivityDto, ProfileActivityDto } from './activity.dto';

// eslint-disable-next-line no-shadow
export enum AnnouncementTypeDto {
  TOMBSTONE = 'tombstone',
  BROADCAST = 'broadcast',
  REPLY = 'reply',
  REACTION = 'reaction',
  PROFILE = 'profile',
  UPDATE = 'update',
}

export class BroadcastDto extends NoteActivityDto {}

export class ReplyDto extends NoteActivityDto {
  inReplyTo: string;
}

export class UpdateDto extends NoteActivityDto {
  targetAnnouncementType: AnnouncementTypeDto;
}

export class ReactionDto {
  emoji: string;

  apply: number;

  inReplyTo: string;
}

export class ProfileDto extends ProfileActivityDto {}
