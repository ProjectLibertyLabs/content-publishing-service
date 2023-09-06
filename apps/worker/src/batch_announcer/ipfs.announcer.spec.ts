import { describe, it, beforeEach, jest } from '@jest/globals';
import { IpfsAnnouncer } from './ipfs.announcer';
import { IBatchAnnouncerJobData } from '../interfaces/batch-announcer.job.interface';
import { AnnouncementType } from '../../../../libs/common/src/interfaces/dsnp';
import { AnnouncementTypeDto } from '../../../../libs/common/src';
import { assert } from 'console';

describe('IPFSAnnouncer', () => {
  let ipfsAnnouncer: IpfsAnnouncer;
  let configServiceMock: any;
  let blockchainServiceMock: any;
  let ipfsServiceMock: any;

  beforeEach(() => {
    // Initialize mocks for your dependencies
    configServiceMock = {
      getIpfsCidPlaceholder: jest.fn(),
    };
    blockchainServiceMock = {
      getSchema: jest.fn(),
    };
    ipfsServiceMock = {
      getPinned: jest.fn(),
      ipfsPin: jest.fn(),
    };

    // Create an instance of the IpfsAnnouncer with the mock dependencies
    ipfsAnnouncer = new IpfsAnnouncer(configServiceMock, blockchainServiceMock, ipfsServiceMock);
  });

  describe('announce', () => {
    it('should announce a batch on IPFS', async () => {
      // Mock the necessary methods or data to simulate the behavior
      const batchJobData: IBatchAnnouncerJobData = {
        batchId: 'batch123',
        schemaId: 123,
        announcements: [
          {
            id: 'announcement1',
            dependencyAttempt: 0,
            announcementType: AnnouncementTypeDto.BROADCAST,
            dsnpUserId: 'user1',
            content: {
              content: {
                content: 'Hello world!',
                published: '2021-01-01T00:00:00Z',
                assets: [],
              },
            }

          },
          {
            id: 'announcement2',
            dependencyAttempt: 0,
            announcementType: AnnouncementTypeDto.BROADCAST,
            dsnpUserId: 'user2',
            content: {
              content: {
                content: 'Hello world!',
                published: '2021-01-01T00:00:00Z',
                assets: [],
              },
            }
          },
        ],
      };

      // Mock blockchainService's getSchema method
      blockchainServiceMock.getSchema.mockResolvedValue({
        model: JSON.stringify({
          $schema: 'http://json-schema.org/draft-07/schema#',
          $id: 'https://dsnp.org/schemas/1.0/Announcement.json',
          title: 'Announcement',
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uri',
            },
            announcementType: {
              type: 'string',
              enum: [
                'broadcast',
                'reply',
                'reaction',
                'update',
                'profile',
              ],
            },
            dsnpUserId: {
              type: 'string',
              format: 'uri',
            },
            content: {
              type: 'object',
              properties: {
                content: {
                  type: 'object',
                  properties: {
                    content: {
                      type: 'string',
                    },
                    published: {
                      type: 'string',
                      format: 'date-time',
                    },
                    assets: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          type: {
                            type: 'string',
                            enum: [
                              'image',
                              'video',
                              'audio',
                              'document',
                              'link',
                            ],
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        }),
      });
      // Mock configService's getIpfsCidPlaceholder method
      configServiceMock.getIpfsCidPlaceholder.mockReturnValue('ipfs://mocked-cid');

      // Mock ipfsService's methods if needed
      // ipfsServiceMock.getPinned.mockResolvedValue(/* Mock IPFS data */);
      // ipfsServiceMock.ipfsPin.mockResolvedValue({ cid: 'mocked-cid', size: 'mocked-size' });

      // Call the announce method
      const result = await ipfsAnnouncer.announce(batchJobData);
      assert(result);

      // Verify that the mock methods were called as expected
      expect(blockchainServiceMock.getSchema).toHaveBeenCalledWith(123);
      expect(configServiceMock.getIpfsCidPlaceholder).toHaveBeenCalledWith('mocked-cid');
      // Add more expectations as needed for your specific code

      // Clean up or reset any mocks if necessary
      jest.clearAllMocks();
    });
  });
});
