import { Controller, Get, HttpStatus, Logger } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger'; 
import { ApiResponse, ApiOperation } from '@nestjs/swagger';

@Controller('content-publishing-service')
@ApiTags('Content Publishing') // Add a tag for the controller
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
  @ApiOperation({ summary: 'Get Swagger UI' }) // Add an operation description
  @ApiResponse({ status: HttpStatus.OK, description: 'Swagger UI' }) // Add a response description
  swagger() {
    return {
      status: HttpStatus.OK,
    };
  }
}
