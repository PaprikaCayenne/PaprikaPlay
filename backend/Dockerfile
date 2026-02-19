FROM node:20-alpine AS base
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY prisma ./prisma
RUN pnpm prisma generate

FROM base AS dev
COPY . .
EXPOSE 3001
CMD ["pnpm", "dev"]

FROM base AS build
COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:20-alpine AS prod
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma

EXPOSE 3001
CMD ["node", "dist/index.js"]
