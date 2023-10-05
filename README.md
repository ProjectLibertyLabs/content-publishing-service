# Content Publisher

Content Publisher is a microservice designed to publish DSNP (Decentralized Social Networking Protocol) content to the Frequency blockchain. This README provides step-by-step instructions to set up and run the service.

## Table of Contents

- [Content Publisher](#content-publisher)
  - [Table of Contents](#table-of-contents)
  - [Prerequisites](#prerequisites)
  - [Getting Started](#getting-started)
    - [Clone the Repository](#clone-the-repository)

## Prerequisites

Before you begin, ensure you have met the following requirements:

- **Docker:** Content Publisher is designed to run in a Docker environment. Make sure Docker is installed on your system.

## Getting Started

Follow these steps to set up and run Content Publisher:

### Clone the Repository

1. Clone the Content Publisher repository to your local machine:

   ```bash
   git clone https://github.com/amplicalabls/content-publishing-service.git
   ```

2. Copy the .env.template to .env.docker.dev and update the values as needed.

   ```bash
    cp .env.template .env.docker.dev
   ```

3. Run the following command to start the service:

   ```bash
    docker-compose -f docker-compose.dev.yml up
    ```

4. Visit [Swagger UI](http://localhost:3000/api/docs/swagger) to view the API documentation and submit requests to the service.

5. Visit [Bullboard](http://localhost:3000/queues) to view the job queue and the status of the jobs.
