# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

# ---------- deps ----------
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# ---------- build ----------
FROM base AS builder
ENV NEXT_OUTPUT=standalone
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# ---------- runtime ----------
FROM base AS runner
ENV NODE_ENV=production
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Prisma CLI + schema so the container can run `migrate deploy` on boot.
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma

# AWS SDK and secrets management libraries
# These are included in node_modules from the deps stage
COPY --from=builder /app/node_modules/@aws-sdk ./node_modules/@aws-sdk
COPY --from=builder /app/node_modules/dotenv ./node_modules/dotenv

# Docker entrypoint script with environment initialization support
COPY --from=builder /app/docker-entrypoint.sh ./docker-entrypoint.sh

# Secrets management instructions (for troubleshooting)
# COPY --from=builder /app/docs/SECRETS_MANAGEMENT.md ./docs/SECRETS_MANAGEMENT.md

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

# Environment initialization:
# - AWS Secrets Manager (production: set AWS_REGION)
# - .env.local fallback (development: copy .env.local into container)
# - Environment variables (Docker, CI/CD)
ENTRYPOINT ["/bin/sh", "./docker-entrypoint.sh"]
