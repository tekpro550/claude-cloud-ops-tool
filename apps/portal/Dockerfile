# Build context is the repo root, e.g.:
#   docker build -f apps/portal/Dockerfile \
#     --build-arg VITE_API_BASE_URL=https://api.example.com/api/v1 \
#     --build-arg VITE_DEFAULT_TENANT_ID=<tenant-uuid> \
#     -t cloud-ops-tool-portal .
#
# Vite env vars are compile-time (inlined into the built JS), not runtime --
# both ARGs have to be known at `docker build` time.

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
ARG VITE_DEFAULT_TENANT_ID
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_DEFAULT_TENANT_ID=$VITE_DEFAULT_TENANT_ID
RUN pnpm --filter @cloud-ops-tool/portal build

FROM nginx:1.27-alpine AS runtime
COPY apps/portal/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/portal/dist /usr/share/nginx/html
EXPOSE 80
