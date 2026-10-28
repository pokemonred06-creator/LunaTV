---
description: Build and Deploy LunaTV to Synology
---

1. Build the Docker image for linux/amd64
   // turbo
   docker build --platform linux/amd64 -t lunatv:custom .

2. Save the Docker image to a tar file
   // turbo
   docker save -o lunatv_custom.tar lunatv:custom

3. Deploy to Synology
   // turbo
   ./deploy.sh
