# Self-hosted fixlock GitHub App and team dashboard. Build from the repository root:
#   docker build -f app/Dockerfile -t fixlock-app .
#   docker run -p 8787:8787 -e APP_ID=… -e WEBHOOK_SECRET=… -v $PWD/app.pem:/run/app.pem:ro -e PRIVATE_KEY_FILE=/run/app.pem fixlock-app
# Published as ghcr.io/abinandhmj/fixlock-app. See docs/self-hosting.md.
FROM node:26-alpine
WORKDIR /fixlock
COPY package.json ./
COPY src ./src
COPY app ./app
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
USER node
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${PORT}/ >/dev/null || exit 1
CMD ["node", "app/server.mjs"]
