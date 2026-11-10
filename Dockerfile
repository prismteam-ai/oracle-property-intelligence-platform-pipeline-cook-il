# syntax=docker/dockerfile:1
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm prune --prod

FROM node:22-slim AS runtime
ENV NODE_ENV=production PORT=8080 DATA_DIR=/app/data
WORKDIR /app
COPY --from=build /app ./
ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=$GIT_COMMIT
VOLUME ["/app/data"]
EXPOSE 8080
# web app (apps/web) replaces this command once it exists; pipeline service overrides it.
CMD ["node", "apps/pipeline/dist/cli.js", "--help"]
