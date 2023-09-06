import { Test, TestingModule } from '@nestjs/testing';
import { expect, describe, jest, it, beforeEach } from '@jest/globals';
import assert from 'assert';
import { FrequencyParquetSchema } from '@dsnp/frequency-schemas/types/frequency';
import { ConfigService } from '../../../api/src/config/config.service';
import { BlockchainService } from '../blockchain/blockchain.service';
import { IpfsService } from '../../../../libs/common/src/utils/ipfs.client';
import { IpfsAnnouncer } from './ipfs.announcer';

// Create a mock for the dependencies
const mockConfigService = {
  getIpfsCidPlaceholder: jest.fn(),
};

const mockBlockchainService = {
  getSchema: jest.fn(),
};

const mockIpfsService = {
  getPinned: jest.fn(),
  ipfsPin: jest.fn(),
};

describe('IpfsAnnouncer', () => {
  let ipfsAnnouncer: IpfsAnnouncer;

  const broadcast: FrequencyParquetSchema = [
    {
      name: 'announcementType',
      column_type: {
        INTEGER: {
          bit_width: 32,
          sign: true,
        },
      },
      compression: 'GZIP',
      bloom_filter: false,
    },
    {
      name: 'contentHash',
      column_type: 'BYTE_ARRAY',
      compression: 'GZIP',
      bloom_filter: true,
    },
    {
      name: 'fromId',
      column_type: {
        INTEGER: {
          bit_width: 64,
          sign: false,
        },
      },
      compression: 'GZIP',
      bloom_filter: true,
    },
    {
      name: 'url',
      column_type: 'STRING',
      compression: 'GZIP',
      bloom_filter: false,
    },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IpfsAnnouncer,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: BlockchainService, useValue: mockBlockchainService },
        { provide: IpfsService, useValue: mockIpfsService },
      ],
    }).compile();

    ipfsAnnouncer = module.get<IpfsAnnouncer>(IpfsAnnouncer);
  });

  it('should be defined', () => {
    expect(ipfsAnnouncer).toBeDefined();
  });

  // Write your test cases here
  it('should announce a batch to IPFS', async () => {
    // Mock the necessary dependencies' behavior
    mockConfigService.getIpfsCidPlaceholder.mockReturnValue('mockIpfsUrl');
    mockBlockchainService.getSchema.mockReturnValue({ model: JSON.stringify(broadcast) });
    mockIpfsService.getPinned.mockReturnValue(Buffer.from('mockContentBuffer'));
    mockIpfsService.ipfsPin.mockReturnValue({ cid: 'mockCid', size: 'mockSize' });

    const batchJob = {
      batchId: 'mockBatchId',
      schemaId: 123,
      announcements: [],
    };

    const result = await ipfsAnnouncer.announce(batchJob);
    assert(result);
    expect(mockConfigService.getIpfsCidPlaceholder).toHaveBeenCalledWith('mockCid');
    expect(mockBlockchainService.getSchema).toHaveBeenCalledWith(123);
  });
});
