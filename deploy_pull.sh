#!/bin/bash
set -e

TARGET="synology"
DEST="~/LunaTV"
IMAGE="lunatv_custom.tar"
PORT=9999

# Get local IP
LOCAL_IP=$(ipconfig getifaddr en0)
if [ -z "$LOCAL_IP" ]; then
    echo "Error: Cannot determine local IP."
    exit 1
fi
echo "--> Local IP: $LOCAL_IP"

# Check if image exists
if [ ! -f "$IMAGE" ]; then
    echo "Error: $IMAGE not found!"
    exit 1
fi

echo "--> Starting local HTTP server on port $PORT..."
python3 -m http.server $PORT > /dev/null 2>&1 &
SERVER_PID=$!
sleep 2

# Ensure server is killed on exit
trap "kill $SERVER_PID" EXIT

echo "--> Creating remote directory..."
ssh $TARGET "mkdir -p $DEST"

echo "--> Triggering remote download..."
ssh $TARGET "cd $DEST && \
    rm -f $IMAGE docker-compose.yml && \
    echo 'Downloading image...' && \
    wget http://$LOCAL_IP:$PORT/$IMAGE && \
    echo 'Downloading compose file...' && \
    wget http://$LOCAL_IP:$PORT/docker-compose.yml"

echo "--> Deploying..."
ssh $TARGET "cd $DEST && \
    echo 'Loading Docker image...' && \
    /usr/local/bin/docker load -i $IMAGE && \
    echo 'Stopping existing container...' && \
    (/usr/local/bin/docker rm -f lunatv || true) && \
    echo 'Creating cache directory...' && \
    mkdir -p cache && \
    chmod 777 cache && \
    echo 'Starting services...' && \
    /usr/local/bin/docker-compose up -d --remove-orphans && \
    /usr/local/bin/docker system prune -f"

echo "--> Deployment Complete!"
