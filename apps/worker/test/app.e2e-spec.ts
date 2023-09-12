/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable no-undef */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Job, Queue } from 'bullmq';
import { WorkerModule } from '../src/worker.module';
import { AnnouncementTypeDto, IRequestJob } from '../../../libs/common/src';

describe('Worker Processors E2E tests', () => {
  let app: INestApplication;
  let eventEmitter: EventEmitter2;
  let module: TestingModule;
  let requestQueue: Queue;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();

    app = module.createNestApplication();
    requestQueue = app.get('BullQueue_requestQueue') as Queue;
    eventEmitter = app.get<EventEmitter2>(EventEmitter2);
    eventEmitter.on('shutdown', async () => {
      await app.close();
    });
    app.useGlobalPipes(new ValidationPipe());
    app.enableShutdownHooks();
    await app.init();
  });

  afterEach(async () => {
    await module.close();
  });

  it('Should send broadcast to the REQUEST_QUEUE_NAME', async () => {
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
      assetToMimeType: new Map(),
    };

    const spy = jest.spyOn(requestQueue, 'add');
    const job: Job<IRequestJob, any, string> = await requestQueue.add('e2e_1', data);

    expect(spy).toHaveBeenCalled();
    expect(job.id).toEqual('e2e_1');
    expect(job.data).toEqual(data);
    expect(requestQueue.getJobCounts()).toEqual({ active: 1, completed: 0, delayed: 0, failed: 0, waiting: 0 });
  });
});
