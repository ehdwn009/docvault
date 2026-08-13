# ---- build stage: client SPA ----
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci
COPY client client
RUN npm run build -w client

# ---- runtime stage ----
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci -w server --omit=dev
COPY server server
COPY --from=build /app/client/dist client/dist
ENV DATA_DIR=/app/data
EXPOSE 3000
CMD ["npm", "start", "-w", "server"]
