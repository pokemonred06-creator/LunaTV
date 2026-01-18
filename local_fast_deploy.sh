#!/bin/bash
# local_fast_deploy.sh

echo "--> Building Docker image (AMD64) using Dockerfile.fast..."
docker build --no-cache --platform linux/amd64 -f Dockerfile.fast -t lunatv:custom .

echo "--> Saving image to tarball..."
docker save -o lunatv_custom.tar lunatv:custom

echo "--> Deploying to Synology..."
./deploy.sh
