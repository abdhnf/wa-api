# Multi-stage build for WhatsApp Backend Gateway
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package descriptors
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./

# Install dependencies
RUN pnpm install --frozen-lockfile || pnpm install

# Copy source code and config
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript to dist/
RUN pnpm build

# Production runtime stage
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3100
ENV HOST=0.0.0.0

# Install pnpm for production deps
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --prod --frozen-lockfile || pnpm install --prod

# Copy built code from builder
COPY --from=builder /app/dist ./dist

# Create storage directory for SQLite and Baileys session credentials
RUN mkdir -p ./data/auth

EXPOSE 3100

VOLUME ["/app/data"]

CMD ["node", "dist/server.js"]
