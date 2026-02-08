#!/bin/sh
# Startup script to run both Go proxy and Next.js

# Start Go proxy in background on port 8080
echo "Starting Go proxy on :8080..."
GOPROXY_ARGS="-addr :8080 -config /app/data/db.json"

# Default to secure mode in production. Opt-in to dev mode via PROXY_DEV=true.
if [ "${PROXY_DEV}" = "true" ]; then
    echo "WARNING: PROXY_DEV=true, starting Go proxy in dev mode (no auth)."
    /app/goproxy $GOPROXY_ARGS -dev &
else
    if [ -z "${PROXY_SECRET}" ]; then
        echo "FATAL: PROXY_SECRET is not set. Refusing to start Go proxy without auth."
        echo "Set PROXY_SECRET (recommended) or set PROXY_DEV=true (development only)."
        exit 1
    fi
    /app/goproxy $GOPROXY_ARGS &
fi
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
