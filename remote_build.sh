#!/bin/bash

# Configuration
TARGET="synology"
REMOTE_WORK_DIR="/volume5/docker/lunatv_build"
SOURCE_TAR="lunatv_source.tar.gz"

echo "--> Preparing source code..."
# Create a cleaner tarball excluding massive/unnecessary folders
tar --exclude='node_modules' \
    --exclude='.next' \
    --exclude='.git' \
    --exclude='lunatv_custom.tar' \
    --exclude='lunatv.tar' \
    --exclude='.DS_Store' \
    -czf $SOURCE_TAR .

echo "--> Connecting to $TARGET..."
if ! ssh -q $TARGET exit; then
    echo "Error: Cannot connect to $TARGET."
    exit 1
fi

echo "--> Preparing remote directory ($REMOTE_WORK_DIR)..."
ssh $TARGET "mkdir -p $REMOTE_WORK_DIR"

echo "--> Transferring source code (via pipe)..."
cat $SOURCE_TAR | ssh $TARGET "cat > $REMOTE_WORK_DIR/$SOURCE_TAR"

echo "--> Building on Synology..."
ssh $TARGET "cd $REMOTE_WORK_DIR && \
    tar -xzf $SOURCE_TAR && \
    echo 'Building Docker image...' && \
    /usr/local/bin/docker build -f Dockerfile -t lunatv:custom . && \
    echo 'Cleaning up source...' && \
    rm $SOURCE_TAR"

echo "--> Deploying new image..."
ssh $TARGET "cd /volume5/docker && \
    echo 'Stopping container...' && \
    (/usr/local/bin/docker-compose stop lunatv || true) && \
    echo 'Recreating container...' && \
    /usr/local/bin/docker-compose up -d --force-recreate --build lunatv && \
    /usr/local/bin/docker image prune -f"

echo "--> Remote Build & Deploy Complete!"
rm $SOURCE_TAR
