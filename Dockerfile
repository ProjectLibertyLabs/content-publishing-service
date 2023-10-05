FROM --platform=linux/amd64 node:18 as build

# TODO: The deployment docker image should install the content publishing
#       service from NPM rather than building from source
WORKDIR /app
COPY package*.json ./
RUN npm install

# Build / Copy the rest of the application files to the container and build
COPY . .
RUN npm run build

FROM build as app-only

EXPOSE 3000

ENTRYPOINT npm start

