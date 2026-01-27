#!/bin/bash

# Configuration
TARGET="synology"
REMOTE_DIR="/volume5/docker"
IMAGE_TAR="lunatv_custom.tar"

echo "--> Testing connection to $TARGET..."
if ! ssh -q $TARGET exit; then
    echo "Error: Cannot connect to $TARGET. Please check your SSH configuration or network."
    echo "Try: ssh -p 8522 red@192.168.50.8"
    exit 1
fi

echo "--> Building Docker Image..."
# Build for linux/amd64 since Synology is x86_64
docker build --platform linux/amd64 -t lunatv:custom .

echo "--> Saving Docker Image to tar..."
docker save -o $IMAGE_TAR lunatv:custom

echo "--> Copying files to $REMOTE_DIR..."
# Only copy the image, DO NOT overwrite config files as requested
scp -O $IMAGE_TAR $TARGET:$REMOTE_DIR/

echo "--> Deploying to Production at $REMOTE_DIR..."
ssh $TARGET "mkdir -p $REMOTE_DIR/cache && \
    echo 'Ensuring PROXY_SECRET exists in .env...' && \
    (grep -q 'PROXY_SECRET=' $REMOTE_DIR/.env || echo 'PROXY_SECRET=7d9a2b4c8e1f3g5h7j9k0l2m4n6p8q0r' >> $REMOTE_DIR/.env) && \
    echo 'Stopping legacy container...' && \
    (/usr/local/bin/docker stop lunatv || true) && \
    (/usr/local/bin/docker rm lunatv || true) && \
    echo 'Removing old image...' && \
    (/usr/local/bin/docker rmi lunatv:custom || true) && \
    echo 'Loading Docker image...' && \
    /usr/local/bin/docker load -i $REMOTE_DIR/$IMAGE_TAR && \
    echo 'New Image ID:' && \
    /usr/local/bin/docker images lunatv:custom --format '{{.ID}}' && \
    echo 'Recreating container...' && \
    /usr/local/bin/docker-compose -f $REMOTE_DIR/docker-compose.yml --env-file $REMOTE_DIR/.env up -d --force-recreate lunatv && \
    echo 'Cleaning up...' && \
    rm $REMOTE_DIR/$IMAGE_TAR && \
    /usr/local/bin/docker image prune -f"

echo "--> Deployment Complete!"
echo "Check status at http://192.168.50.8:8899 (or configured port)"
