# Ascent Tournament Accounting

This project serves as an intermediary service for storing and managing tournament accounting information on the Midnight blockchain.

## Prerequisites

### Bun

This project use Bun for build and script execution.  

### Docker

Most interactions with midnight require a proof server running.  For local dev this is done via a docker container. The root folder has a docker-compose.yml which has configuration for running the proof server as well as the indexer and node.  Usually it is sufficient just to run the proof server locally and use remote services for the indexer and node.  

If you have docker installed then running `bun proof-server` will start the proof-server


### Deploying

To deploy the current version of accountun just `az login` followed by `az acr login --name accountun` and finally run `bun docker:publish`