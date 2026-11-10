# syntax=docker/dockerfile:1
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages ./packages
COPY apps ./apps
COPY fixtures ./fixtures
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm prune --prod

FROM node:22-slim AS runtime
ENV NODE_ENV=production PORT=8080 DATA_DIR=/app/data
WORKDIR /app
COPY --from=build --chown=node:node /app ./
ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=$GIT_COMMIT
RUN printf '{"commit":"%s","builtAt":"%s"}\n' "$GIT_COMMIT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > build.json \
  && mkdir -p /app/data && chown -R node:node /app/data /app/build.json
USER node
VOLUME ["/app/data"]
EXPOSE 8080
# `web` service: explorer UI + tRPC + MCP + agent. `pipeline` service overrides the command (same image).
CMD ["node", "apps/web/dist/server/apps/web/src/main.js"]
