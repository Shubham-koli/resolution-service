# Resolution service

[![Tests](https://github.com/unstoppabledomains/resolution-service/actions/workflows/tests.yml/badge.svg?branch=master)](https://github.com/unstoppabledomains/resolution-service/actions/workflows/tests.yml)
[![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=unstoppabledomains_resolution_service&metric=security_rating&token=f23a522e7a9ee324e58e27e84651e8c731871d43)](https://sonarcloud.io/summary/new_code?id=unstoppabledomains_resolution_service)
[![Known Vulnerabilities](https://snyk.io/test/github/unstoppabledomains/resolution-service/badge.svg)](https://snyk.io/test/github/unstoppabledomains/resolution-service)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=unstoppabledomains_resolution_service&metric=coverage&token=f23a522e7a9ee324e58e27e84651e8c731871d43)](https://sonarcloud.io/summary/new_code?id=unstoppabledomains_resolution_service)
[![Unstoppable Domains Documentation](https://img.shields.io/badge/Documentation-unstoppabledomains.com-blue)](https://docs.unstoppabledomains.com/developer-toolkit/resolution-integration-methods/resolution-service/overview/)
[![Get help on Discord](https://img.shields.io/badge/Get%20help%20on-Discord-blueviolet)](https://discord.gg/b6ZVxSZ9Hn)

- [Installation](README.md#installation)
  - [Pre-requirements](README.md#pre-requirements)
  - [Quick start](README.md#quick-start)
- [Running the service](README.md#running-the-service)
  - [Environment configuration options](README.md#environment-configuration-options)
  - [Running modes](README.md#running-modes)
  - [API keys](README.md#api-keys)
- [Documentation](README.md#documentation)
  - [API reference](README.md#api-reference)
  - [Postman collection](README.md#postman-collection)
- [Development notes](README.md#development-notes)

Resolution service provides an API for getting domain data and metadata
regardless of that domain's location (whether it is stored in Ethereum, Zilliqa,
or any other blockchain). The service caches blockchain events in a database for
easy retrieval without accessing blockchain APIs.

The resolution service is provided as a docker image so it can be launched on a
variety of platforms and in the cloud.

## Resolution service endpoints

- Production Mainnet: http://resolve.unstoppabledomains.com/api-docs/
- Staging Testnet (Ethereum Goerli, Polygon Mumbai):
  https://resolve.staging.unstoppabledomains.com/api-docs/

## Installation

### Pre-requirements

- **git** - to clone the repository.
- **docker** - to run the service. Install docker by following
  [instructions](https://docs.docker.com/engine/install/) for an appropriate
  system.
- **postgres** - to store the data. You can configure Postgres on the same
  server as the resolution service or a dedicated database hosting (e.g. AWS
  RDS, Google Cloud SQL). To install postgres locally, follow these
  [instructions](https://www.postgresql.org/download). Make sure to configure
  password authentication for the DB user that the service will use.
  - This guide has been tested with Postgres 11.17, although other versions may
    also work.

### Quick start

1. Clone the resolution-service repository\
   `git clone https://github.com/unstoppabledomains/resolution-service.git`
2. Build the docker container\
   `docker build -t resolution-service .`
3. Setup environment variables\
   Create a file `service.env` that will contain the required environment variables:

```
NODE_ENV=production
RESOLUTION_POSTGRES_HOST=example.com            # DB host
RESOLUTION_POSTGRES_PORT=5432                   # DB port
RESOLUTION_POSTGRES_USERNAME=example            # DB user configured in postgres
RESOLUTION_POSTGRES_PASSWORD=password           # DB password configured in postgres
RESOLUTION_POSTGRES_DATABASE=resolution_service # Name of the resolution service database
ETHEREUM_JSON_RPC_API_URL=https://alchemy.com   # Address of a JSON RPC provider. This can be a public API (e.g., Alchemy) or a local Ethereum node with JSON RPC enabled
POLYGON_JSON_RPC_API_URL=https://alchemy.com    # Address of a JSON RPC provider. This can be a public API (e.g., Alchemy) or a local Ethereum node with JSON RPC enabled
VIEWBLOCK_API_KEY=apikey                        # Key for Viewblock API, required for getting data from Zilliqa blockchain
METADATA_API=apikey				             # Key for Unstoppable Domain's Metadata API
MORALIS_API_URL=apikey				          # URL for the Moralis API
MORALIS_APP_ID=apikey				           # App ID for the Moralis API
OPENSEA_API_KEY=apikey				          # Key for Opensea's API service
RESOLUTION_APP_AUTH_KEY=apikey                  # API key for authenticating internal-only endpoints, e.g., API key enrollment
```

This is the minimum required set of configurations for the service. Additional
configuration options are listed in
[Environment configuration options](README.md#environment-configuration-options).

4. Create the `resolution_service` postgres database
   `createdb resolution_service`
5. Launch the service
   `docker run -d --env-file service.env -p 3000:3000 --network="host" resolution-service`

## Running the service

Once the service is started, it will perform initial synchronization with the
blockchain networks. It may take more than 24 hours for full synchronization.

During the initial synchronization, the API may not work reliably. The
synchronization status can be checked using the `/status` endpoint. After the
synchronization, you can access the service API endpoints normally.

Note that the service is stateless, so the container doesn't need persistent
storage. All data is stored in the database.

### Environment configuration options

| Option                                      | Default value                                     | required           | Description                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------- | ------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RESOLUTION_API_PORT                         | 3000                                              | :x:                | The port for the HTTP API.                                                                                                                                                                                                                                                                                                  |
| RESOLUTION_RUNNING_MODE                     | API,ETH_WORKER,MATIC_WORKER,ZIL_WORKER,MIGRATIONS | :x:                | Comma-separated list of running modes of the resolution service (see [Running modes](README.md#running-modes)).                                                                                                                                                                                                             |
| RESOLUTION_POSTGRES_HOST                    | localhost                                         | :heavy_check_mark: | Host for the postgres DB. Note that to connect to a postgres instance running on the same server as the container, `host.docker.internal` should be used instead of `localhost` on Windows and MacOS (see https://docs.docker.com/docker-for-windows/networking/#use-cases-and-workarounds).                                |
| RESOLUTION_POSTGRES_USERNAME                | postgres                                          | :heavy_check_mark: | Username that is used to connect to postgres.                                                                                                                                                                                                                                                                               |
| RESOLUTION_POSTGRES_PASSWORD                | secret                                            | :heavy_check_mark: | Password that is used to connect to postgres.                                                                                                                                                                                                                                                                               |
| RESOLUTION_POSTGRES_DATABASE                | resolution_service                                | :heavy_check_mark: | Database name in postgres.                                                                                                                                                                                                                                                                                                  |
| RESOLUTION_POSTGRES_PORT                    | 5432                                              | :x:                | Port number for Postgres database.                                                                                                                                                                                                                                                                                          |
| ETHEREUM_CONFIRMATION_BLOCKS                | 20                                                | :x:                | Number of blocks that the service will wait before accepting an event from the CNS contract. This helps to avoid block reorgs, forks, etc.                                                                                                                                                                                  |
| ETHEREUM_BLOCK_FETCH_LIMIT                  | 500                                               | :x:                | Batch limit for fetching event data from the Ethereum JSON RPC. Note that some API providers may limit the amount of data that can be returned in a single request. So this number should be kept relatively low. However, raising this limit should speed up synchronization if a dedicated node is used with the service. |
| ETHEREUM_RECORDS_PER_PAGE                   | 100                                               | :x:                | Batch limit for fetching domain records from CNS registry smart contract.                                                                                                                                                                                                                                                   |
| ETHEREUM_FETCH_INTERVAL                     | 5000                                              | :x:                | Specifies the interval to fetch data from the CNS registry in milliseconds.                                                                                                                                                                                                                                                 |
| CNS_REGISTRY_EVENTS_STARTING_BLOCK          | 9080000                                           | :x:                | Starting block that is used to look for events in the CNS registry. This helps to avoid parsing old blockchain data, before the contract was even deployed.                                                                                                                                                                 |
| CNS_RESOLVER_ADVANCED_EVENTS_STARTING_BLOCK | 9080000                                           | :x:                | Starting block that is used to look for events in the CNS registry.                                                                                                                                                                                                                                                         |
| ETHEREUM_ACCEPTABLE_DELAY_IN_BLOCKS         | 100                                               | :x:                | How much blocks Ethereum mirror can lag behind until it's considered as unacceptable and need to be fixed. /status endpoint will return `health: true/false` field depends on number of blocks behind compared with this number.                                                                                            |
| ETHEREUM_JSON_RPC_API_URL                   | -                                                 | :heavy_check_mark: | Address of a JSON RPC provider. This can be a public API (e.g. Alchemy), or a local ethereum node with JSON RPC enabled.                                                                                                                                                                                                    |
| ETHEREUM_NETWORK_ID                         | 1                                                 | :x:                | ID of the Ethereum network that is used by the service.                                                                                                                                                                                                                                                                     |
| POLYGON_CONFIRMATION_BLOCKS                 | 20                                                | :x:                | Number of blocks that the service will wait before accepting an event from the smart contracts on Polygon. This helps to avoid block reorgs, forks, etc.                                                                                                                                                                    |
| POLYGON_BLOCK_FETCH_LIMIT                   | 500                                               | :x:                | Batch limit for fetching event data from the Polygon JSON RPC. Note that some API providers may limit the amount of data that can be returned in a single request. So this number should be kept relatively low. However, raising this limit should speed up synchronization if a dedicated node is used with the service.  |
| POLYGON_RECORDS_PER_PAGE                    | 100                                               | :x:                | Batch limit for fetching domain records from Polygon smart contracts.                                                                                                                                                                                                                                                       |
| POLYGON_FETCH_INTERVAL                      | 5000                                              | :x:                | Specifies the interval to fetch data from the Polygon blockchain in milliseconds.                                                                                                                                                                                                                                           |
| POLYGON_UNS_REGISTRY_EVENTS_STARTING_BLOCK  | 19345077                                          | :x:                | Starting block that is used to look for events in the UNS registry on the Polygon blockchain. This helps to avoid parsing old blockchain data, before the contract was even deployed.                                                                                                                                       |
| POLYGON_ACCEPTABLE_DELAY_IN_BLOCKS          | 100                                               | :x:                | How much blocks Polygon mirror can lag behind until it's considered as unacceptable and need to be fixed. /status endpoint will return `health: true/false` field depends on number of blocks behind compared with this number.                                                                                             |
| POLYGON_JSON_RPC_API_URL                    | -                                                 | :heavy_check_mark: | Address of a Polygon JSON RPC provider. This can be a public API (e.g. Alchemy), or a local ethereum node with JSON RPC enabled.                                                                                                                                                                                            |
| POLYGON_NETWORK_ID                          | 137                                               | :x:                | ID of the Polygon network that is used by the service.                                                                                                                                                                                                                                                                      |
| ZNS_NETWORK                                 | mainnet                                           | :x:                | Name of the Zilliqa network will be used by ZNS worker (mainnet or testnet).                                                                                                                                                                                                                                                |
| VIEWBLOCK_API_KEY                           | -                                                 | :heavy_check_mark: | API key for [viewblock](https://viewblock.io/api), required by ZNS worker.                                                                                                                                                                                                                                                  |
| ZNS_FETCH_INTERVAL                          | 5000                                              | :x:                | Specifies the interval to fetch data from the ZNS registry in milliseconds.                                                                                                                                                                                                                                                 |
| NEW_RELIC_LICENSE_KEY                       | -                                                 | :x:                | License key that will be used to access newrelic. If the key is not specified, new relic will not be enabled.                                                                                                                                                                                                               |
| NEW_RELIC_APP_NAME                          | -                                                 | :x:                | App name will be used to access newrelic. If the app name is not specified, new relic will not be enabled.                                                                                                                                                                                                                  |
| BUGSNAG_API_KEY                             | -                                                 | :x:                | API key that will be used to access bugsnag. If the key is not specified, bugsnag will not be enabled.                                                                                                                                                                                                                      |
| TYPEORM_LOGGING_COLORIZE                    | true                                              | :x:                | Colorize typeorm logs.                                                                                                                                                                                                                                                                                                      |
| ZILLIQA_ACCEPTABLE_DELAY_IN_BLOCKS          | 100                                               | :x:                | How much blocks Zilliqa mirror can lag behind until it's considered as unacceptable and need to be fixed. /status endpoint will return `health: true/false` field depends on number of blocks behind compared with this number.                                                                                             |
| MORALIS_API_URL                             | -                                                 | :x:                | URL for the Moralis API. Required by the metadata API endpoints (`METADATA_API` running mode).                                                                                                                                                                                                                              |
| MORALIS_APP_ID                              | -                                                 | :x:                | App ID for the Moralis API. Required by the metadata API endpoints (`METADATA_API` running mode).                                                                                                                                                                                                                           |
| RATE_LIMITER_DISABLED                       | false                                             | :x:                | Rate limiting flag used to disable the rate limiting middleware for running tests                                                                                                                                                                                                                                           |
| DEFAULT_MAX_REQUESTS                        | 5                                                 | :x:                | The default max number of requests before reaching the rate limit                                                                                                                                                                                                                                                           |
| METADATA_MAX_REQUESTS                       | 10                                                | :x:                | The max number of requests for the /metadata endpoints before reaching the rate limit                                                                                                                                                                                                                                       |
| WINDOW_MS                                   | 1000                                              | :x:                | The time window for requests before the window is reset for the rate limiting middleware                                                                                                                                                                                                                                    |
| HEAP_APP_ID                                 | -                                                 | :x:                | The [Heap](https://www.heap.io/) application ID used for sending trackig events                                                                                                                                                                                                                                             |
| IN_MEMORY_CACHE_DISABLED                    | false                                             | :x:                | The typeorm in memory cache disable flag, cache disabled for unit tests                                                                                                                                                                                                                                                     |
| IN_MEMORY_CACHE_EXPIRATION_TIME             | 60000                                             | :x:                | The typeorm in memory cache expiration time in milliseconds                                                                                                                                                                                                                                                                 |

### Running modes

The service provides several running modes. By default, it will run all of them.
However, the modes that will be used can be selected during startup using the
RESOLUTION_RUNNING_MODE environment variable. Available running modes:

- **API** - Runs all APIs
- **SERVICE_API** - Runs the service API (see "Service endpoints" in
  [API reference](README.md#api-reference))
- **METADATA_API** - Runs the metadata API (see "Metadata endpoints" in
  [API reference](README.md#api-reference))
- **ETH_WORKER** - Runs the ETH worker to sync data from the Ethereum CNS and
  UNS registry
- **MATIC_WORKER** - Runs the MATIC worker to sync data from the Polygon UNS
  registry
- **ZIL_WORKER** - Runs the ZIL worker to sync data from the Zilliqa ZNS
  registry
- **MIGRATIONS** - Runs the migration scripts if necessary.

For example, to run only the `API` with the `ETH_WORKER`, the following
environment configuration can be used:

```
RESOLUTION_RUNNING_MODE=API,ETH_WORKER
```

### API keys

The `/domains`, `/records`, and `/reverse` endpoints require an API key for
authentication. The resolution service provides a function to enroll API keys
for accessing these endpoints.

To enroll a new API key into the resolution service, make a `POST` request to
the `/enroll` endpoint with the `RESOLUTION_APP_AUTH_KEY` in the `service.env`
file and API key details, like so:

```shell
curl --location --request POST '/enroll' \
--header 'app-auth-token: {RESOLUTION_APP_AUTH_KEY}' \
--header 'Content-Type: application/json' \
--data-raw '{
    "name": "{API_KEY_NAME}",
    "key": "{API_KEY_VALUE}"
}'
```

> Note: The API key enrollment endpoint is only intended for internal use on
> your server as it requires the value of the `RESOLUTION_APP_AUTH_KEY` variable
> defined in the `service.env` file for authentication. If the
> `RESOLUTION_APP_AUTH_KEY` is not defined, the endpoint will not work.

## Documentation

### API reference

The full API reference
[OpenAPI specification](https://resolve.unstoppabledomains.com/api-docs/) By
default, all API endpoints are enabled. Use the `RUNNING_MODE` env variable to
enable specific sets of endpoints.

| Endpoint                                  | Description                                                   |
| ----------------------------------------- | ------------------------------------------------------------- |
| **Domain endpoints:**                     |
| GET /domains                              | Gets the list of domains.                                     |
| GET /domains/:domainName                  | Gets the resolution of the specified domain.                  |
| GET /records                              | Gets resolution records for multiple domains requested.       |
| GET /domains/:domainName/transfers/latest | Gets the transfer history of a domain name.                   |
| **Reverse endpoints:**                    |
| GET /reverse/:address                     | Gets the reverse record of a wallet address.                  |
| POST /reverse/query                       | Gets the reverse record of multiple wallet addresses.         |
| **Service endpoints:**                    |
| GET /supported_tlds                       | Gets all the domain endings supported by Unstoppable Domains. |
| GET /status                               | Gets the synchronization status.                              |
| GET /api-docs                             | Returns a swagger documentation page.                         |
| **Metadata endpoints:**                   |
| GET /metadata/:domainOrToken              | Retrieve erc721 metadata information of the specified domain  |
| GET /image/:domainOrToken                 | Retrieve `image_data` as a svg string                         |
| GET /image-src/:domainOrToken             | Retrieve image_data as `image/svg+xml`                        |
| **Enrollment endpoints:**                 |
| POST /enroll                              | Enroll an API key into the resolution service                 |

> Note: The `/domains`, `/records`, and `/reverse` endpoints require an API key.
> The key must be provided as a `Bearer` authentication header for requests. New
> keys must be enrolled into the resolution service (see
> [API keys](README.md#api-keys) for more info).

### Postman collection

Unstoppable Domains provides a Postman collection that you can fork to your
workspace and interact with the resolution service API in one click.

[![Run in Postman](https://run.pstmn.io/button.svg)](https://god.gw.postman.com/run-collection/19507736-52bf9f35-1608-4dc4-a96d-e62682b59199?action=collection%2Ffork&collection-url=entityId%3D19507736-52bf9f35-1608-4dc4-a96d-e62682b59199%26entityType%3Dcollection%26workspaceId%3D6762865c-b510-4216-ba7f-45cd07f164c7#?env%5BResolution%20Service%20-%20Open%20API%5D=W3sia2V5IjoiYmFzZV91cmwiLCJ2YWx1ZSI6Imh0dHBzOi8vcmVzb2x2ZS51bnN0b3BwYWJsZWRvbWFpbnMuY29tIiwiZW5hYmxlZCI6dHJ1ZSwidHlwZSI6ImRlZmF1bHQiLCJzZXNzaW9uVmFsdWUiOiJodHRwczovL3Jlc29sdmUudW5zdG9wcGFibGVkb21haW5zLmNvbSIsInNlc3Npb25JbmRleCI6MH0seyJrZXkiOiJhcGlfa2V5IiwidmFsdWUiOiIiLCJlbmFibGVkIjp0cnVlLCJ0eXBlIjoic2VjcmV0Iiwic2Vzc2lvblZhbHVlIjoiIiwic2Vzc2lvbkluZGV4IjoxfV0=)

## Development notes

### Development pre-requirements

The dev. environment generally has the same pre-requirements as running the
service normally. So, Postgres and Docker are also necessary. For convenience
Postgres configuration can be the same as defaults (username - postgres,
password - secret).

Additional pre-requirements that are necessary for development:

- Node.JS 14.21.2 Can be installed using [NVM](https://github.com/nvm-sh/nvm)
- [yarn](https://yarnpkg.com/lang/en/docs/install)

### Running in dev mode

1. Install project dependencies

```
nvm install 14.21.2
nvm use 14.21.2
yarn install
```

2. Configure environment variables.\
   The required variables are the same as running the service in docker. Copy `./local.dev.env.sample`
   to `./local.dev.env` and set variables as necessary.

```
RESOLUTION_POSTGRES_HOST=localhost
RESOLUTION_POSTGRES_USERNAME=postgres
RESOLUTION_POSTGRES_PASSWORD=password
RESOLUTION_POSTGRES_DATABASE=resolution_service
ETHEREUM_JSON_RPC_API_URL=localhost:8545
POLYGON_JSON_RPC_API_URL=localhost:8546
VIEWBLOCK_API_KEY=apikey
METADATA_API=apikey
MORALIS_API_URL=apikey
MORALIS_APP_ID=apikey
OPENSEA_API_KEY=apikey
RESOLUTION_APP_AUTH_KEY=apikey
```

3. Run the service

```
yarn start:dev
```

### Running unit tests

Unit tests can be run using `yarn test`. This command will run the tests with
ENV variables set in `./local.test.env` file. You should copy
`./local.test.env.sample` to `./local.test.env` and redefine any env variable in
yours local environment if needed, for example:
`export RESOLUTION_POSTGRES_PASSWORD=password`. Testing command will take this
variable first instead of using variable from `./local.test.env` file.

For checking coverage use `yarn test:coverage`.

Unit/integration tests use a Postgres database that is cleaned before each test.
By default, the database name is `resolution_service_test`.

### Debugging

To debug the service, you should use the following command:

```
yarn start:dev:debug
```

To debug the tests use:

```
yarn test:debug
```

If you are using
[Visual Studio Code](https://docs.microsoft.com/en-us/visualstudio/debugger/attach-to-running-processes-with-the-visual-studio-debugger?view=vs-2022)
to debug the code, add this to `.vscode/launch.json` launch configuration:

```
  "configurations": [
    ...,
    {
      "type": "node",
      "request": "attach",
      "name": "Attach to resolution service",
      "protocol": "inspector",
      "port": 9229,
      "restart": true,
      "localRoot": "${workspaceFolder}",
      "remoteRoot": "${workspaceFolder}"
    },
```

### Service architecture

![Architecture chart](doc/ResolutionService.png)

The service currently consists of three main components: API and three workers.
The API component is a basic HTTP API that allows the reading of domain data
from the database. The OpenAPI specification:
[OpenAPI specification](https://resolve.unstoppabledomains.com/api-docs/).

Currently, there are three workers in the resolution service:

- ETH worker\
  Contains a scheduled job that connects to the Ethereum blockchain using JSON RPC
  and pulls CNS (.crypto) and UNS domains and resolution events. The events are parsed
  and saved to the database.
- MATIC worker\
  Contains a scheduled job that connects to the Polygon blockchain using JSON RPC
  and pulls domains and resolution events. The events are parsed and saved to the
  database.\
  Since Polygon and Ethereum are compatible, we use two instances of the same
  worker implementation to pull data from these networks.
- ZIL worker\
  Contains a scheduled job that connects to the Zilliqa blockchain using and pulls
  ZNS (.zil) domains and resolution events. The events are parsed and saved to the
  database.

> Unstoppable Domains may add more workers in the future.

### Logs and monitoring

The resolution service outputs logs to `stdout` so they are available by
`docker logs` and can be monitored by cloud tools (e.g. AWS CloudWatch or Google
Cloud Logging). The general log format should be:
`<timestamp> <log level>: <Component label> - <Log message>`

The resolution service has a configurable logging level. Log messages are at
consistent levels across the whole service. We use the following guidelines to
determine the logging level:

| Event              | Component       | description                                                                                                                | log level |
| ------------------ | --------------- | -------------------------------------------------------------------------------------------------------------------------- | --------- |
| Startup info       | all             | Log any startup information (e.g. worker is starting, API is listening)                                                    | info      |
| Sync progress      | Workers         | Log current sync progress of a worker (which blocks are being processed, how many blocks are left to process)              | info      |
| Handled errors     | all             | Log any errors that can be handled gracefully (e.g. a malformed request that will return a 400 error)                      | warn      |
| Unhandled errors   | all             | Log any errors that were captured by top-level error handlers (e.g. an unexpected third-party API error, invalid db state) | error     |
| API Request        | API controllers | Log any request to the API with their parameters                                                                           | debug     |
| DB query           | all             | Log any db queries with their parameters                                                                                   | debug     |
| Parsed event       | Workers         | Log any event or transaction parsed by the worker                                                                          | debug     |
| External API calls | all             | Log external API calls                                                                                                     | debug     |

Additionally, the service will report errors to monitoring tools if the
appropriate keys are provided in the environment configuration. The resolution
service has integrations with [bugsnag](https://www.bugsnag.com/) and
[newrelic](https://newrelic.com/).

### Adding new env vars

1. Add it to GitHub repository Secrets
   (https://github.com/unstoppabledomains/resolution-service/settings/secrets/actions)
2. Add it to such files: env.ts, deploy-production.yml, deploy-staging.yml,
   tests.yml, create-yaml.sh

### Testing image uploads locally

Metadata service will cache NFT PFP images, uploading them to
[Google Cloud Storage](https://cloud.google.com/cdn) (GCS) CDN. To test file
uploads locally, an unofficial
[GCS emulator](https://github.com/fsouza/fake-gcs-server) is used.

To use the emulator, ensure Docker
[is installed](https://docs.docker.com/desktop/install/mac-install/).

Pull the image from Docker Hub

```
docker pull fsouza/fake-gcs-server
```

Create the following directory structure for the GSC bucket storage, where
`resolution-client-assets` is the bucket's name.

```
  storage
  |--> resolution-client-assets
```

Run docker container with mounted bucket directory:

```
docker run -d --name fake-gcs-server -p 4443:4443 -v ${PWD}/storage:/data fsouza/fake-gcs-server -scheme http -public-host localhost:4443
```

Add the following variable to the local dev config:

```
CLOUD_STORAGE_ENDPONT_URL=http://localhost:4443
```
