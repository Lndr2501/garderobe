# Garderobe – self-hosted. Build: docker build -t garderobe .  Run: -p 8000:8000 -v garderobe-data:/data
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --ignore-scripts
COPY . .
RUN npm run build && chmod -R a+rX dist

FROM node:24-slim
ENV NODE_ENV=production \
	DATA_DIR=/data \
	PORT=8000 \
	STATIC_DIR=dist/client \
	NODE_OPTIONS=--disable-warning=ExperimentalWarning
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
RUN apt-get update && apt-get install -y --no-install-recommends openssh-client \
	&& rm -rf /var/lib/apt/lists/* \
	&& mkdir -p /data && chown node:node /data
USER node
EXPOSE 8000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:8000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/main.mjs"]
