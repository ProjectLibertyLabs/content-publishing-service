import { Test, TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { expect, describe, it, beforeEach, jest } from '@jest/globals';
import { DsnpAnnouncementProcessor } from './dsnp.announcement.processor';
import { AnnouncementTypeDto, IRequestJob } from '../../../../libs/common/src';
import { ConfigService } from '../../../api/src/config/config.service';
import { IpfsService } from '../../../../libs/common/src/utils/ipfs.client';

const mockQueue = {
  add: jest.fn(),
};

// Mock the ConfigService class
const mockConfigService = {
  getIpfsCidPlaceholder: jest.fn(),
};

// Mock the IpfsService class
const mockIpfsService = {
  getPinned: jest.fn(),
  ipfsPin: jest.fn(),
};

describe('DsnpAnnouncementProcessor', () => {
  let dsnpAnnouncementProcessor: DsnpAnnouncementProcessor;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        DsnpAnnouncementProcessor,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: IpfsService, useValue: mockIpfsService },
        { provide: Queue, useValue: mockQueue },
        { provide: 'BullQueue_assetQueue', useValue: mockQueue },
        { provide: 'BullQueue_broadcastQueue', useValue: mockQueue },
        { provide: 'BullQueue_replyQueue', useValue: mockQueue },
        { provide: 'BullQueue_reactionQueue', useValue: mockQueue },
        { provide: 'BullQueue_updateQueue', useValue: mockQueue },
        { provide: 'BullQueue_profileQueue', useValue: mockQueue },
        { provide: 'BullQueue_tombstoneQueue', useValue: mockQueue },
      ],
    }).compile();

    dsnpAnnouncementProcessor = module.get<DsnpAnnouncementProcessor>(DsnpAnnouncementProcessor);
  });

  it('should be defined', () => {
    expect(dsnpAnnouncementProcessor).toBeDefined();
  });

  it('should collect and queue a broadcast announcement', async () => {
    // Mock the necessary dependencies' behavior
    mockConfigService.getIpfsCidPlaceholder.mockReturnValue('mockIpfsUrl');
    mockIpfsService.getPinned.mockReturnValue(Buffer.from('mockContentBuffer'));
    mockIpfsService.ipfsPin.mockReturnValue({ cid: 'mockCid', hash: 'mockHash', size: 123 });

    const data: IRequestJob = {
      id: '1',
      announcementType: AnnouncementTypeDto.BROADCAST,
      dsnpUserId: 'dsnp://123',
      dependencyAttempt: 0,
      content: {
        content: {
          content: 'mockContent',
          published: '2021-01-01T00:00:00.000Z',
        },
      },
    };

    await dsnpAnnouncementProcessor.collectAnnouncementAndQueue(data);

    expect(mockConfigService.getIpfsCidPlaceholder).toHaveBeenCalledWith('mockCid');
    expect(mockIpfsService.ipfsPin).toHaveBeenCalledWith('application/octet-stream', expect.any(Buffer));
  });
  it('should collect and queue a reply announcement', async () => {
    // Mock the necessary dependencies' behavior
    mockConfigService.getIpfsCidPlaceholder.mockReturnValue('mockIpfsUrl');
    mockIpfsService.getPinned.mockReturnValue(Buffer.from('mockContentBuffer'));
    mockIpfsService.ipfsPin.mockReturnValue({ cid: 'mockCid', hash: 'mockHash', size: 123 });

    const data: IRequestJob = {
      id: '2',
      announcementType: AnnouncementTypeDto.REPLY,
      dsnpUserId: 'dsnp://456',
      dependencyAttempt: 0,
      content: {
        content: {
          content: 'mockReplyContent',
          published: '2021-01-01T00:00:00.000Z',
        },
        inReplyTo: 'dsnp://123/reply/1', // Mock the parent reply ID
      },
    };

    await dsnpAnnouncementProcessor.collectAnnouncementAndQueue(data);

    expect(mockConfigService.getIpfsCidPlaceholder).toHaveBeenCalledWith('mockCid');
    expect(mockIpfsService.ipfsPin).toHaveBeenCalledWith('application/octet-stream', expect.any(Buffer));
  });

  it('should collect and queue a reaction announcement', async () => {
    // Mock the necessary dependencies' behavior
    mockConfigService.getIpfsCidPlaceholder.mockReturnValue('mockIpfsUrl');
    mockIpfsService.getPinned.mockReturnValue(Buffer.from('mockContentBuffer'));
    mockIpfsService.ipfsPin.mockReturnValue({ cid: 'mockCid', hash: 'mockHash', size: 123 });

    const data: IRequestJob = {
      id: '3',
      announcementType: AnnouncementTypeDto.REACTION,
      dsnpUserId: 'dsnp://789',
      dependencyAttempt: 0,
      content: {
        emoji: '👍',
        inReplyTo: 'dsnp://123/reply/1',
        apply: 10,
      },
    };

    await dsnpAnnouncementProcessor.collectAnnouncementAndQueue(data);

    expect(mockConfigService.getIpfsCidPlaceholder).toHaveBeenCalledWith('mockCid');
    expect(mockIpfsService.ipfsPin).toHaveBeenCalledWith('application/octet-stream', expect.any(Buffer));
  });
});
