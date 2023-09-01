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

@Injectable()
export class IPFSAnnouncer {
  private logger: Logger;

  constructor(
    private configService: ConfigService,
    private blockchainService: BlockchainService,
    private eventEmitter: EventEmitter2,
  ) {
    this.logger = new Logger(IPFSAnnouncer.name);
  }

  public async announce(batchJob: IBatchAnnouncerJobData, helia: Helia): Promise<IPublisherJob> {
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
    const [cid, hash] = await this.pinToIPFS(buffer.toString());
    const ipfsUrl = await this.formIpfsUrl(cid, hash);
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
    const [cid, hash] = await this.pinToIPFS(noteString);
    const ipfsUrl = await this.formIpfsUrl(cid, hash);
    const broadcastActivity = createBroadcast(dsnpUserId, ipfsUrl, hash);
    return broadcastActivity;
  }

  private async pinToIPFS(content: string): Promise<[string, string]> {
    this.logger.debug('Pinning content to IPFS');
    return ['', '']; // Placeholder implementation
  }

  private async formIpfsUrl(cid: string, hash: string): Promise<string> {
    this.logger.debug('Forming IPFS URL');
    return ''; // Placeholder implementation
  }

  // public async hashFile(fileBuffer: Buffer): Promise<string> {
  //   this.logger.debug('Hashing file');
  //   const hash = await blake2b256.digest(fileBuffer);
  //   return toMultibase(hash.bytes, 'blake2b-256');
  // }
}
