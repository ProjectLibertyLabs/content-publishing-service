import { Injectable } from '@nestjs/common';

@Injectable()
export class PublishingService {
  // eslint-disable-next-line class-methods-use-this
  getHello(): string {
    return 'Hello World from Worker!';
  }
}
