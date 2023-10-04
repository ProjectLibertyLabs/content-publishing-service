FROM node:18-alpine3.17

WORKDIR /app

# Install the application dependencies
COPY package*.json ./
RUN npm install

EXPOSE 3000
# Start the application
CMD ["npm", "run", "start:dev:docker"]
