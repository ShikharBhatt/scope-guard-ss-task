# Multi-stage Dockerfile for Scope Guard with Prisma ORM
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig*.json ./
COPY prisma ./prisma
RUN npm ci
RUN npx prisma generate

COPY src ./src
COPY migrations ./migrations

RUN npm run build

# Production Stage
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --only=production
RUN npx prisma generate

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/migrations ./migrations

EXPOSE 3000
EXPOSE 3128

# Entrypoint runs migrations, seeds demo tenant, and launches Scope Guard
CMD ["sh", "-c", "node dist/database/run-migrations.js && node dist/database/seed.js && node dist/main.js"]
