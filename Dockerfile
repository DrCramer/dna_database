FROM node:20-bullseye-slim AS build
WORKDIR /app
COPY --chown=node:node package*.json ./
COPY vendor ./vendor
RUN npm ci --include=dev --no-audit --no-fund
COPY . .
RUN npm run check:ui
RUN npm test
RUN mkdir -p public && find public -maxdepth 1 -type f -name '*bundle*' -delete && npm run build

FROM node:20-bullseye-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node package*.json ./
COPY vendor ./vendor
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node src ./src
COPY --chown=node:node database ./database
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node --from=build /app/public ./public
RUN mkdir -p /app/logs /app/uploads /app/exports /app/backups /app/config && \
    chown -R node:node /app/logs /app/uploads /app/exports /app/backups /app/config
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"
CMD ["npm", "start"]
