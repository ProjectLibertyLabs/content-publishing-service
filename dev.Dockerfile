FROM --platform=linux/amd64 node:18

RUN apt-get -y update
RUN apt-get -y install redis
RUN sed -e 's/^appendonly .*$/appendonly yes/' /etc/redis/redis.conf > /etc/redis/redis.conf.appendonly
RUN mv /etc/redis/redis.conf.appendonly /etc/redis/redis.conf

ENV REDIS_URL=redis://localhost:6379

WORKDIR /usr/src/app

COPY . .

RUN npm install

# install nest cli
RUN npm install -g @nestjs/cli

VOLUME [ "/var/lib/redis" ]
EXPOSE 3000
EXPOSE 6379
# Start the application
ENTRYPOINT service redis-server start && npm run start:dev:docker
