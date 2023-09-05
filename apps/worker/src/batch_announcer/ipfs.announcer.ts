import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PassThrough } from 'node:stream';
import { ParquetWriter } from '@dsnp/parquetjs';
import parquet from '@dsnp/frequency-schemas/parquet';
import { ActivityContentAttachment, ActivityContentTag } from '@dsnp/activity-content/types';
import { Helia } from 'helia';
import { BlockchainService } from '../blockchain/blockchain.service';
import { ConfigService } from '../../../api/src/config/config.service';
import { createBroadcast, BroadcastAnnouncement, createNote } from '../../../../libs/common/src/interfaces/dsnp';
import { AnnouncementTypeDto, BroadcastDto, TagTypeDto } from '../../../../libs/common/src';
import { IBatchAnnouncerJobData } from '../interfaces/batch-announcer.job.interface';
import { IPublisherJob } from '../interfaces/publisher-job.interface';
import { IpfsService } from './ipfs.client';

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
        default:
          throw new Error(`Unsupported announcement type ${typeof announcement}`);
      }
    });

    await writer.close();
    const buffer = await this.bufferPublishStream(publishStream);
    const [cid, hash] = await this.pinStringToIPFS(buffer);
    const ipfsUrl = await this.formIpfsUrl(cid);
    this.logger.debug(`Batch ${batchId} published to IPFS at ${ipfsUrl}`);
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
    // Process attachments if available

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

  private async pinStringToIPFS(buf: Buffer): Promise<[string, string]> {
    const { cid, size } = await this.ipfsService.ipfsPin('application/octet-stream', buf);
    return [cid.toString(), size.toString()];
  }

  private async formIpfsUrl(cid: string): Promise<string> {
    return this.configService.getIpfsCidPlaceholder(cid);
  }

  // public async hashFile(fileBuffer: Buffer): Promise<string> {
  //   this.logger.debug('Hashing file');
  //   const hash = await blake2b256.digest(fileBuffer);
  //   return toMultibase(hash.bytes, 'blake2b-256');
  // }
}
