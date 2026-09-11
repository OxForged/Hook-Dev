# syntax=docker/dockerfile:1
#
# The keeper, as a container.
#
# Two stages so the runtime image carries no TypeScript, no dev dependencies and
# no build tooling — the thing that eventually holds a signing key should contain
# as little as possible.
#
# It runs as a NON-ROOT user and with no writable state: the keeper reads chain,
# decides, and either reports or sends. It persists nothing, so there is no
# volume to corrupt and nothing on disk worth stealing except the environment.

FROM node:22-alpine AS build
WORKDIR /app

# Dependencies first, so a source-only change does not re-resolve the tree.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop dev dependencies rather than reinstalling: `npm ci --omit=dev` into a
# clean tree would re-download everything.
RUN npm prune --omit=dev


FROM node:22-alpine AS runtime
WORKDIR /app

# `node` (uid 1000) ships with the base image. Running as root inside a container
# that may hold a key buys nothing and costs a containment boundary.
ENV NODE_ENV=production

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json

USER node

# Overridden by compose. The default is deliberately the SAFE one: no --execute,
# so a container started with no arguments reports what it would do and sends
# nothing. Making the dangerous mode the explicit one is the same rule the CLI
# itself follows.
ENTRYPOINT ["node", "dist/index.js"]
CMD ["--config", "/config/keeper.config.json"]
