# Mercearia — imagem única com a API e o sistema web (mesmo desenho do Soul ERP).
#
# Um processo serve tudo: sistema em / e API em /v1.

# ---------------------------------------------------------------- build
FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Dependências antes do código: camada reaproveitada entre builds.
COPY package.json package-lock.json* ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json           apps/api/
COPY apps/web/package.json           apps/web/
RUN npm install --no-audit --no-fund

COPY . .
RUN ./scripts/build-release.sh

# ---------------------------------------------------------------- runtime
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 1001 mercearia

COPY --from=build /app/node_modules          ./node_modules
COPY --from=build /app/package.json          ./package.json
COPY --from=build /app/packages              ./packages
COPY --from=build /app/apps/api/dist         ./apps/api/dist
COPY --from=build /app/apps/api/public       ./apps/api/public
COPY --from=build /app/apps/api/prisma       ./apps/api/prisma
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY docker-entrypoint.sh                    ./docker-entrypoint.sh

RUN chmod +x docker-entrypoint.sh && chown -R mercearia:mercearia /app
USER mercearia

ENV PUBLIC_DIR=/app/apps/api/public
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/v1/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "apps/api/dist/main.js"]
