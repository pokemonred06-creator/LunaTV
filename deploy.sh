#!/bin/bash

# Configuration
# Assuming 'synology' alias exists in ~/.ssh/config based on user rules.
# If not, use: TARGET="red@192.168.50.8" and ensure password-less auth or use sshpass.
TARGET="synology"
DEST="~/LunaTV"
IMAGE_TAR="lunatv_custom.tar"

echo "--> Testing connection to $TARGET..."
if ! ssh -q $TARGET exit; then
    echo "Error: Cannot connect to $TARGET. Please check your SSH configuration or network."
    echo "Try: ssh -p 8522 red@192.168.50.8"
    exit 1
fi

echo "--> Creating directory $DEST on remote..."
ssh $TARGET "mkdir -p $DEST"

echo "--> Copying application files..."
scp $IMAGE_TAR docker-compose.yml $TARGET:$DEST/

echo "--> Deploying Docker container..."
ssh $TARGET "cd $DEST && \
    echo 'Loading Docker image (this may take a while)...' && \
    docker load -i $IMAGE_TAR && \
    echo 'Starting services...' && \
    docker-compose up -d --remove-orphans && \
    docker system prune -f" # Optional cleanup

echo "--> Deployment Complete!"
echo "Check status directly on NAS or visit http://192.168.50.8:3000"
