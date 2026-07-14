# Build context is the repo root (this is a pnpm workspace monorepo), e.g.:
#   docker build -f apps/api/Dockerfile -t cloud-ops-tool-api .

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
RUN pnpm --filter @cloud-ops-tool/api build
# pnpm's native "produce a standalone, deployable copy of one workspace
# package" command -- resolves the workspace's symlinked node_modules into
# a real, self-contained directory so the runtime stage doesn't need pnpm,
# the workspace root, or any of the other apps.
#
# Deliberately NOT --prod: migration:run (see entrypoint.sh) uses
# typeorm-ts-node-commonjs against the TypeScript source, which needs
# ts-node/typescript -- both devDependencies. Migrations only run once per
# deploy, not on the request hot path, so the larger image is worth not
# having a second, separately-compiled migration path to keep in sync.
RUN pnpm --filter @cloud-ops-tool/api deploy /out

FROM node:22-alpine AS runtime
RUN corepack enable
# The 'ping' monitor type (Module 2) shells out to the system ping binary --
# alpine's busybox includes a ping applet, but installing iputils explicitly
# guarantees it rather than depending on how this base image's busybox was built.
RUN apk add --no-cache iputils
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
COPY apps/api/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/main"]
