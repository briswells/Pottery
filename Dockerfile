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
# Public (browser) Square values are inlined by `next build`, so they must be present
# at build time (not runtime). They are NOT secrets — the Square application id,
# location id, and environment are public client identifiers. Pass via --build-arg.
ARG NEXT_PUBLIC_SQUARE_APP_ID
ARG NEXT_PUBLIC_SQUARE_LOCATION_ID
ARG NEXT_PUBLIC_SQUARE_ENVIRONMENT
ENV NEXT_PUBLIC_SQUARE_APP_ID=$NEXT_PUBLIC_SQUARE_APP_ID \
    NEXT_PUBLIC_SQUARE_LOCATION_ID=$NEXT_PUBLIC_SQUARE_LOCATION_ID \
    NEXT_PUBLIC_SQUARE_ENVIRONMENT=$NEXT_PUBLIC_SQUARE_ENVIRONMENT
RUN pnpm build

# ---- run ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/package.json ./package.json
# tsx + source + tsconfig needed for migrate/seed/import scripts at runtime.
# tsconfig.json carries the @payload-config path alias the Payload CLI resolves.
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/src ./src
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "server.js"]
