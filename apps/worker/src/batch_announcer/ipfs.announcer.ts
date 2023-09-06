import { Injectable, Logger } from '@nestjs/common';
import { PassThrough } from 'node:stream';
import { ParquetWriter } from '@dsnp/parquetjs';
import { fromFrequencySchema } from '@dsnp/frequency-schemas/parquet';
import {
  ActivityContentImageLink,
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
import { TagTypeDto, AttachmentTypeDto, AssetDto } from '../../../../libs/common/src';
import { createNote } from '../../../../libs/common/src/interfaces/dsnp';

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

    const [parquetSchema, writerOptions] = fromFrequencySchema(schema);
    const publishStream = new PassThrough();

    const writer = await ParquetWriter.openStream(parquetSchema, publishStream as any, writerOptions);

    announcements.forEach(async (announcement) => {
      writer.appendRow(announcement);
    });

    await writer.close();
    const buffer = await this.bufferPublishStream(publishStream);
    const [cid, hash] = await this.pinStringToIPFS(buffer);
    const ipfsUrl = await this.formIpfsUrl(cid);
    this.logger.debug(`Batch ${batchId} published to IPFS at ${ipfsUrl}`);
    this.logger.debug(`Batch ${batchId} hash: ${hash}`);
    return { id: batchId, schemaId, data: { cid, payloadLength: buffer.length } };
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

  private async pinStringToIPFS(buf: Buffer): Promise<[string, string]> {
    const { cid, size } = await this.ipfsService.ipfsPin('application/octet-stream', buf);
    return [cid.toString(), size.toString()];
  }

  private async formIpfsUrl(cid: string): Promise<string> {
    return this.configService.getIpfsCidPlaceholder(cid);
  }
}
