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

# 서버는 빌드 단계가 없어(tsx가 실시간 변환) 타입 검사가 저절로 돌지 않는다 —
# 이미지가 만들어지기 전에 여기서 막는다. 클라이언트는 build 스크립트에 tsc가 묶여 있다.
COPY server server
RUN npm run typecheck -w server

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
