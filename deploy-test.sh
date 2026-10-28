#!/bin/bash

# Configuration
TARGET="synology"
DEST="~/LunaTV"
IMAGE_TAR="lunatv_custom.tar"

echo "--> Testing connection to $TARGET..."
if ! ssh -q $TARGET exit; then
    echo "Error: Cannot connect to $TARGET. Please check your SSH configuration or network."
    exit 1
fi

echo "--> Creating directory $DEST on remote..."
ssh $TARGET "mkdir -p $DEST"

echo "--> Copying application files..."
scp -O $IMAGE_TAR docker-compose-test.yml $TARGET:$DEST/

echo "--> Deploying Docker container (TEST)..."
ssh $TARGET "cd $DEST && \
    echo 'Loading Docker image (this may take a while)...' && \
    /usr/local/bin/docker load -i $IMAGE_TAR && \
    echo 'Stopping existing TEST container...' && \
    (/usr/local/bin/docker rm -f lunatv-test || true) && \
    echo 'Creating cache directory for test...' && \
    mkdir -p cache-test && \
    chmod 777 cache-test && \
    echo 'Starting services...' && \
    /usr/local/bin/docker-compose -f docker-compose-test.yml up -d --remove-orphans && \
    /usr/local/bin/docker system prune -f"

echo "--> Test Deployment Complete!"
echo "Check status directly on NAS."
