# xlab-nvr — Stage 1: Build frontend bundle
FROM node:22-alpine AS builder

RUN apk add --no-cache python3 make g++ sqlite-dev

WORKDIR /app

COPY package.json ./
RUN npm install --legacy-peer-deps

COPY . .
RUN npm run build

# xlab-nvr — Stage 2: Production runtime with FFmpeg and native SQLite
FROM node:22-alpine AS runner

LABEL org.opencontainers.image.title="xlab-nvr"
LABEL org.opencontainers.image.description="xlab-nvr standalone self-hosted NVR"

RUN apk add --no-cache ffmpeg tzdata python3 make g++ sqlite-libs

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/data
ENV RECORDINGS_DIR=/app/recordings

COPY package.json ./
RUN npm install --omit=dev --legacy-peer-deps

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/server ./server
COPY --from=builder /app/src/types.ts ./src/types.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json

RUN mkdir -p /app/recordings /data/snapshots && chmod -R 755 /app/recordings /data

EXPOSE 8080

VOLUME ["/data", "/app/recordings"]

CMD ["npx", "tsx", "server.ts"]
