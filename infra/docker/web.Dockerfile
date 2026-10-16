# syntax=docker/dockerfile:1
# sutra-web — Next.js standalone build for Cloud Run. Build from the repo root:
#   docker build -f infra/docker/web.Dockerfile -t <image> .
# The image scales to zero (Cloud Run min instances 0); config comes from the mounted
# SUTRA_ENV secret at /secrets/.env, so no secrets are baked in.

# ---- deps: install the whole workspace with a frozen lockfile ----
FROM node:22.20.0-bookworm-slim AS deps
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ---- build: compile the Next.js app in standalone mode ----
FROM node:22.20.0-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app
COPY --from=deps /app /app
RUN pnpm --filter @sutra/web build

# ---- runtime: only the standalone server + static assets ----
FROM node:22.20.0-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs
# `output: 'standalone'` traces the monorepo into apps/web/.next/standalone (server + minimal deps).
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
USER nextjs
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
