import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import parquetjs, { ParquetWriter } from '@dsnp/parquetjs';
import parquet from '@dsnp/frequency-schemas';
import { BlockchainService } from '../blockchain/blockchain.service';
import { ConfigService } from '../../../api/src/config/config.service';
import { IBatchAnnouncerJobData } from '../interfaces/batch-announcer.job.interface';

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

  public async announce(batchJob: IBatchAnnouncerJobData): Promise<void> {
    this.logger.debug(`Announcing batch ${batchJob.batchId} on IPFS`);
    const { batchId, schemaId, announcements } = batchJob;

    // Create a parquet file
    const frequencySchema = await this.blockchainService.getSchema(schemaId);
    const schema = JSON.parse(frequencySchema.model.toRawType());
    if (!schema) {
      throw new Error(`Unable to parse schema for schemaId ${schemaId}`);
    }

    const [parquetSchema, writerOptions] = parquet.parquet.fromFrequencySchema(schema);
    const writer = await ParquetWriter.openFile(parquetSchema, `./${batchId}.parquet`, writerOptions);

    // Write the data to the parquet file
  }
}
