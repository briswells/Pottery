# ---- deps ----
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
# Allow native build scripts (sharp, esbuild) non-interactively in the trusted build context.
RUN pnpm install --frozen-lockfile --config.dangerouslyAllowAllBuilds=true

# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ---- run ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/package.json ./package.json
# tsx + source needed for migrate/seed/import scripts at runtime
COPY --from=build /app/src ./src
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "server.js"]
