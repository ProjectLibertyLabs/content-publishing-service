// ipfs.service.ts

import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import FormData from 'form-data';
import { extension as getExtension } from 'mime-types';
import { toMultibase } from '@dsnp/activity-content/hash';
import { CID } from 'multiformats/cid';
import { bases } from 'multiformats/basics';
import { bytes } from 'multiformats';
import { ConfigService } from '../../../api/src/config/config.service';

export interface FilePin {
  cid: string;
  cidBytes: Uint8Array;
  fileName: string;
  size: number;
  hash: string;
}

@Injectable()
export class IpfsService {
  logger: Logger;

  constructor(private readonly configService: ConfigService) {
    this.logger = new Logger(IpfsService.name);
  }

  private async ipfsPinBuffer(filename: string, contentType: string, fileBuffer: Buffer): Promise<FilePin> {
    const ipfsAdd = `${this.configService.getIpfsEndpoint()}/api/v0/add`;
    const form = new FormData();
    form.append('file', fileBuffer, {
      filename,
      contentType,
    });

    const ipfsAuthUser = this.configService.getIpfsBasicAuthUser();
    const ipfsAuthSecret = this.configService.getIpfsBasicAuthSecret();
    const ipfsAuth = ipfsAuthUser && ipfsAuthSecret ? `Basic ${Buffer.from(`${ipfsAuthUser}:${ipfsAuthSecret}`).toString('base64')}` : '';

    const headers = {
      'Content-Type': `multipart/form-data; boundary=${form.getBoundary()}`,
      Accept: '*/*',
      Connection: 'keep-alive',
      authorization: ipfsAuth,
    };

    const response = await axios.post(ipfsAdd, form, { headers });

    const { data } = response;
    if (!data || !data.Hash || !data.Size) {
      throw new Error(`Unable to pin file: ${filename}`);
    }
    // Convert to CID v1 base58btc
    const cid = CID.parse(data.Hash).toV1();

    console.log(`Pinned to IPFS: ${cid.toString(bases.base58btc)}`);
    return {
      cid: cid.toString(bases.base58btc),
      cidBytes: cid.bytes,
      fileName: data.Name,
      size: data.Size,
      hash: '',
    };
  }

  public async ipfsPin(mimeType: string, file: Buffer): Promise<FilePin> {
    const hash = await this.ipfsHashBuffer(file);
    const extension = getExtension(mimeType);
    if (extension === false) {
      throw new Error(`unknown mimetype: ${mimeType}`);
    }
    const ipfs = await this.ipfsPinBuffer(`${hash}.${extension}`, mimeType, file);
    return { ...ipfs, hash };
  }

  private async ipfsHashBuffer(fileBuffer: Buffer): Promise<string> {
    this.logger.debug(`Hashing file buffer with length: ${fileBuffer.length}`);
    // const hash = await toMultibase(bytes.coerce(blakejs.blake2b(fileBuffer, undefined, 32)), 'blake2b-256');
    // this.logger.debug(`Hashed file buffer to ${hash}`);
    // return hash;
    // TODO figure out how to use multiformats
    return fileBuffer.toString('hex');
  }

  public ipfsUrl(cid: string): string {
    if (this.configService.getIpfsGatewayUrl().includes('[CID]')) {
      return this.configService.getIpfsGatewayUrl().replace('[CID]', cid);
    }
    return `${this.configService.getIpfsGatewayUrl()}/ipfs/${cid}`;
  }
}
