# 使用官方 Node.js 镜像作为基础镜像
FROM node:18-alpine AS base

# 安装依赖
FROM base AS deps
WORKDIR /app

# 复制 package.json 和 lock 文件
RUN npm install -g pnpm@10.14.0
COPY package.json pnpm-lock.yaml ./

# Aggressively clean any pre-existing artifacts just in case
RUN rm -rf node_modules .next

# Install dependencies using pnpm
# ARG NPM_CI_FLAGS="" # No longer needed for pnpm install
RUN pnpm install --no-frozen-lockfile

# 构建应用
FROM base AS builder
WORKDIR /app
RUN npm install -g pnpm@10.14.0 # Install pnpm directly in builder stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 再次清理 .next 以防万一
RUN rm -rf .next

# 禁用 Next.js 遥测
ENV NEXT_TELEMETRY_DISABLED 1

# 构建
RUN npm run build

# 生产环境运行
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

# 创建非 root 用户
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# 复制构建产物
COPY --from=builder /app/public ./public

# 自动利用 standalone output 减少镜像大小
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# 切换用户
USER nextjs

# 暴露端口
EXPOSE 3000

# 启动命令
CMD ["node", "server.js"]
