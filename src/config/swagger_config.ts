import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const initSwagger = (app: INestApplication) => {
  const options = new DocumentBuilder()
    .setTitle('Content Publishing Service API')
    .setDescription('Content Publishing Service API')
    .setVersion('1.0')
    .addBearerAuth({
      type: 'http',
      description: 'Enter JWT token',
    })
    .addCookieAuth('SESSION')
    .build();
  const document = SwaggerModule.createDocument(app, options, {
    extraModels: [],
  });
  SwaggerModule.setup('nest/v1/docs', app, document);
};
