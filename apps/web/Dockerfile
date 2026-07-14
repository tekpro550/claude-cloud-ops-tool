# Build context is the repo root, e.g.:
#   docker build -f apps/web/Dockerfile --build-arg VITE_API_BASE_URL=https://api.example.com/api/v1 -t cloud-ops-tool-web .
#
# Vite env vars are compile-time (inlined into the built JS), not runtime --
# VITE_API_BASE_URL has to be known at `docker build` time, which is why it's
# a build ARG here rather than something set later via docker-compose
# environment:.

FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/portal/package.json apps/portal/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

COPY . .
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN pnpm --filter @cloud-ops-tool/web build

FROM nginx:1.27-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
