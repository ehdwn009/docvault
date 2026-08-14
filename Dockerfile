# ---- build stage: client SPA ----
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci
COPY client client
# 저사양 서버(1GB 램)에서 Node가 힙 한도를 낮게 잡아 빌드가 OOM으로 죽는 것 방지 — 스왑까지 쓰며 완주하게
RUN NODE_OPTIONS=--max-old-space-size=2048 npm run build -w client

# ---- runtime stage ----
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci -w server --omit=dev
COPY server server
COPY CHANGELOG.md ./
COPY --from=build /app/client/dist client/dist
ENV DATA_DIR=/app/data
EXPOSE 3000
CMD ["npm", "start", "-w", "server"]
