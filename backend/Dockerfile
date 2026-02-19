FROM node:20-alpine AS base
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/package.json
COPY packages/game-kit/package.json packages/game-kit/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/betting/package.json packages/betting/package.json
COPY packages/games/holdem/package.json packages/games/holdem/package.json
RUN pnpm install --frozen-lockfile

COPY backend backend
COPY packages/game-kit packages/game-kit
COPY packages/engine packages/engine
COPY packages/betting packages/betting
COPY packages/games/holdem packages/games/holdem

FROM base AS dev
WORKDIR /app/backend
RUN pnpm prisma generate
EXPOSE 3001
CMD ["pnpm", "dev"]

FROM base AS build
RUN pnpm --filter @paprikaplay/games-holdem... --filter paprikaplay-backend build

FROM node:20-alpine AS prod
WORKDIR /app
RUN corepack enable

COPY --from=build /app /app

WORKDIR /app/backend
EXPOSE 3001
CMD ["node", "dist/index.js"]
