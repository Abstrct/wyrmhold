# syntax=docker/dockerfile:1
#
# Wyrmhold in one container: the built site, served by serve.mjs (no dependencies).
#
#   docker build -t wyrmhold .
#   docker run --rm -p 8080:8080 wyrmhold            # http://localhost:8080
#
# The page's network is baked in when it is built (--build-arg VITE_LCD_URL=…, VITE_RPC_WS_URL,
# VITE_DEFAULT_GUILD, VITE_GRASS_URL, VITE_RELAY_URL, VITE_GUILD_READS). It talks to each guild's
# servers directly unless VITE_RELAY_URL names a relay; without one it reads the ledger node where
# a relay would let it read the guild's API (a Guild API session can't cross origins).

FROM node:24-slim AS build
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY . .
ARG VITE_LCD_URL VITE_RPC_WS_URL VITE_DEFAULT_GUILD VITE_GRASS_URL VITE_RELAY_URL VITE_GUILD_READS
RUN pnpm build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0
COPY serve.mjs ./
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO /dev/null "http://127.0.0.1:${PORT}/" || exit 1
CMD ["node", "serve.mjs"]
