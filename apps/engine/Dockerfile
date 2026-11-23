# i-jobs engine image: one image, two commands (API and worker).
# Build from the repository root so the database migrations come along:
#   docker build -f apps/engine/Dockerfile -t ijobs-engine .
# Multi-arch: works on Oracle's ARM (linux/arm64) and on x86 laptops.

ARG NODE_IMAGE=node:22-bookworm-slim

# ---- build ----
FROM ${NODE_IMAGE} AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/engine/package.json apps/engine/
RUN npm ci --workspace @ijobs/engine --include-workspace-root=false --no-audit --no-fund
COPY apps/engine/tsconfig.json apps/engine/tsconfig.build.json apps/engine/
COPY apps/engine/src apps/engine/src
RUN npm run build --workspace @ijobs/engine \
 && npm prune --omit=dev --workspace @ijobs/engine --include-workspace-root=false \
 && mkdir -p apps/engine/node_modules   # npm hoists everything; keep the path so the COPY below always works

# ---- run ----
FROM ${NODE_IMAGE} AS run
ENV NODE_ENV=production \
    MIGRATIONS_DIR=/app/db/migrations \
    SEEDS_DIR=/app/db/seeds \
    PORT=3000
WORKDIR /app
# tini forwards stop signals so jobs finish cleanly on deploys. poppler-utils gives pdftotext for CVs.
RUN apt-get update && apt-get install -y --no-install-recommends tini ca-certificates poppler-utils \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/engine/node_modules ./apps/engine/node_modules
COPY --from=build --chown=node:node /repo/apps/engine/dist ./apps/engine/dist
COPY --from=build --chown=node:node /repo/apps/engine/package.json ./apps/engine/package.json
COPY --chown=node:node db/migrations ./db/migrations
COPY --chown=node:node db/seeds ./db/seeds
USER node
WORKDIR /app/apps/engine
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
# API by default. The worker uses: node dist/worker.js   Migrations: node dist/migrate.js --seed
CMD ["node", "dist/main.js"]
