#!/bin/sh
# Startup script to run both Go proxy and Next.js

# Start Go proxy in background on port 8080
echo "Starting Go proxy on :8080..."
/app/goproxy -addr :8080 -config /app/data/db.json -dev &
GOPROXY_PID=$!

# Give Go proxy time to start
sleep 1

# Check if Go proxy started successfully
if ! kill -0 $GOPROXY_PID 2>/dev/null; then
    echo "Warning: Go proxy failed to start, continuing with Next.js only"
fi

# Start Next.js (foreground)
echo "Starting Next.js on :3000..."
exec node server.js
