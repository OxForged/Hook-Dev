# syntax=docker/dockerfile:1
#
# Latch API + indexer image. One image, two commands:
#   node dist/index.js    public API (and admin API when ADMIN_ENABLED)
#   node dist/worker.js   indexer / snapshot worker (the only process that reads chains)
#
# BUILD CONTEXT IS THE REPO ROOT, because the API depends on packages/sdk through
# `file:../../packages/sdk`:
#
#   docker build -f apps/api/Dockerfile -t latch-api .
#
# `apps/api/Dockerfile.dockerignore` is an ALLOWLIST (BuildKit picks it up beside
# this Dockerfile): only packages/sdk and apps/api sources enter the context. No
# .env, no key, no broadcast/ can be copied into a layer by accident.
#
# The image holds no secrets and no signing key. Nothing in it can send a
# transaction.

FROM node:22-alpine AS sdk
WORKDIR /repo/packages/sdk
COPY packages/sdk/package.json packages/sdk/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY packages/sdk/tsconfig*.json ./
COPY packages/sdk/src ./src
COPY packages/sdk/schema.graphql ./schema.graphql
# build:ci compiles the COMMITTED generated sources; it does not need Foundry.
RUN npm run build:ci && npm prune --omit=dev

# Operator console (apps/admin): a static build served by this image at /admin,
# only when ADMIN_ENABLED=true. Its dev mock server (apps/admin/test) is not copied.
FROM node:22-alpine AS admin-ui
WORKDIR /repo/apps/admin
COPY apps/admin/package.json apps/admin/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY apps/admin/tsconfig.json apps/admin/tsconfig.app.json apps/admin/tsconfig.node.json apps/admin/vite.config.ts apps/admin/index.html ./
COPY apps/admin/src ./src
RUN npx tsc -b && npx vite build

FROM node:22-alpine AS build
# Prisma engines on Alpine need OpenSSL.
RUN apk add --no-cache openssl
WORKDIR /repo
COPY --from=sdk /repo/packages/sdk /repo/packages/sdk
WORKDIR /repo/apps/api
COPY apps/api/package.json apps/api/package-lock.json ./
RUN npm install --no-audit --no-fund
COPY apps/api/tsconfig.json apps/api/tsconfig.build.json ./
COPY apps/api/prisma ./prisma
COPY apps/api/src ./src
RUN npx prisma generate && npx tsc -p tsconfig.build.json && npm prune --omit=dev

FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build --chown=node:node /repo/packages/sdk /repo/packages/sdk
WORKDIR /repo/apps/api
COPY --from=build --chown=node:node /repo/apps/api/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist
COPY --from=build --chown=node:node /repo/apps/api/prisma ./prisma
COPY --from=build --chown=node:node /repo/apps/api/package.json ./package.json
COPY --chown=node:node apps/api/config ./config
COPY --from=admin-ui --chown=node:node /repo/apps/admin/dist ./admin-ui
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
