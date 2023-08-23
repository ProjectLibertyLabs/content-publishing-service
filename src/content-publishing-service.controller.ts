import { Controller, Get, HttpStatus, Logger } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger'; 
import { ApiResponse, ApiOperation } from '@nestjs/swagger';

@Controller('content-publishing-service')
@ApiTags('content-publishing-service')
export class ContentPublishingServiceController {
  private readonly logger: Logger;

  constructor() {
    this.logger = new Logger(this.constructor.name);
  }

  // eslint-disable-next-line class-methods-use-this
  @Get('health')
  health() {
    return {
      status: HttpStatus.OK,
    };
  }

  // eslint-disable-next-line class-methods-use-this
  @Get('swagger')
  @ApiOperation({ summary: 'Swagger UI' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Endpoint to serve Swagger UI' })
  swagger() {
    return {
      status: HttpStatus.OK,
    };
  }
}
