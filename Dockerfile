# syntax=docker/dockerfile:1

# ============================================================
# 阶段 1：安装依赖
# ============================================================
FROM node:20-alpine AS deps
WORKDIR /app

# 利用 layer 缓存：仅当 package.json / lockfile 变更时才重新 npm ci
COPY package.json package-lock.json ./
RUN npm ci

# ============================================================
# 阶段 2：构建
# ============================================================
FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# 开启 standalone 输出（本地开发/构建不受影响）
ENV NEXT_OUTPUT=standalone

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 生产构建（NEXT_OUTPUT=standalone 时输出精简 standalone 产物）
RUN npm run build

# ============================================================
# 阶段 3：精简运行镜像
# ============================================================
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=5173
ENV HOSTNAME=0.0.0.0

# 以非 root 用户运行（Node 安全实践）
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# standalone 运行产物（含 server.js 与所需 node_modules）
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# 静态资源（standalone 产物不包含 .next/static，需手动复制）
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# 公开静态资源（如 public/ 目录存在则复制；当前项目未使用）
# COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# 数据目录：store.json 在此生成，通过 volume 挂载实现持久化
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

USER nextjs
EXPOSE 5173

# 数据卷（docker compose 中挂载宿主 ./data 覆盖）
VOLUME ["/app/data"]

CMD ["node", "server.js"]
