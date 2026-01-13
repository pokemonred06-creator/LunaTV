# 使用官方 Node.js 镜像作为基础镜像
FROM node:20-alpine AS base

# ===== Go Proxy Build Stage =====
FROM golang:1.22-alpine AS go-builder
WORKDIR /go-app
COPY scripts/proxy/go.mod .
COPY scripts/proxy/server.go .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /goproxy ./server.go

# ===== Node.js Dependencies Stage =====
FROM base AS deps
WORKDIR /app

# 复制 package.json 和 lock 文件
RUN npm install -g pnpm@10.14.0
COPY package.json pnpm-lock.yaml ./

# Aggressively clean any pre-existing artifacts just in case
RUN rm -rf node_modules .next

# Install dependencies using pnpm
RUN pnpm install --no-frozen-lockfile

# ===== Next.js Build Stage =====
FROM base AS builder
WORKDIR /app
RUN npm install -g pnpm@10.14.0
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 再次清理 .next 以防万一
RUN rm -rf .next

# 禁用 Next.js 遥测
ENV NEXT_TELEMETRY_DISABLED 1

# 构建
RUN npm run build

# ===== Production Runner Stage =====
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1
ENV DISABLE_SECURE_COOKIES true

# 创建非 root 用户
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy Go proxy binary
COPY --from=go-builder /goproxy /app/goproxy

# 复制构建产物
COPY --from=builder /app/public ./public

# 自动利用 standalone output 减少镜像大小
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy startup script
COPY --chown=nextjs:nodejs start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Create data directory
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data

# 切换用户
USER nextjs

# 暴露端口 (3000 for Next.js, 8080 for Go proxy)
EXPOSE 3000 8080

# 启动命令
CMD ["/app/start.sh"]
