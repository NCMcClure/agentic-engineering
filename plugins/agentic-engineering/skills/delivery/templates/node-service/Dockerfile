# Two stages: install production dependencies once, then copy only what runs.
FROM node:22-alpine AS deps
WORKDIR /build
COPY server/package*.json ./
# With no dependencies yet npm creates no node_modules, so make sure one exists.
RUN npm ci --omit=dev && mkdir -p node_modules

FROM node:22-alpine
WORKDIR /app
COPY --from=deps /build/node_modules /app/server/node_modules
COPY server/package.json /app/server/package.json
COPY server/src /app/server/src
ENV NODE_ENV=production
USER node
EXPOSE 8080
CMD ["node", "server/src/app/main.mjs"]
