FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json yarn.lock ./

RUN yarn install --frozen-lockfile

COPY . .

ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"

RUN yarn prisma generate
RUN yarn build

# Só dependências de produção: a imagem final não leva ferramentas de
# desenvolvimento (jest, ts-loader, @nestjs/cli) nem as vulnerabilidades delas.
FROM node:24-alpine AS deps

WORKDIR /app

COPY package.json yarn.lock ./

RUN yarn install --frozen-lockfile --production

FROM node:24-alpine

WORKDIR /app

RUN apk add --no-cache openssl

COPY --from=builder /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY package.json yarn.lock ./

RUN chown -R node:node /app

USER node

EXPOSE 3000

CMD ["yarn", "start:prod"]