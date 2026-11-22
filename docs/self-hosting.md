---
title: Self-hosting
---

# Self-hosting the GitHub App and dashboard

The fixlock [GitHub App](github-app.md) and [team dashboard](dashboard.md) run on Cloudflare Workers by default. For privacy-sensitive teams, or GitHub Enterprise Server, run the same code on your own server with Docker. Your code never leaves your network: the App reads it through your GitHub's API and stores nothing.

## 1. Create your own GitHub App

Follow [Run your own copy](github-app.md#run-your-own-copy) for the App's settings and permissions, using your server's address: the webhook URL is `https://fixlock.example.com/webhook` and the dashboard's callback URL `https://fixlock.example.com/auth/callback`. Download its private key.

## 2. Run the container

```bash
docker run -d --name fixlock --restart unless-stopped -p 8787:8787 \
  -e APP_ID=123456 \
  -e WEBHOOK_SECRET=… \
  -e PRIVATE_KEY_FILE=/run/secrets/app.pem -v /srv/fixlock/app.pem:/run/secrets/app.pem:ro \
  -e CLIENT_ID=Iv23… -e CLIENT_SECRET=… -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e PUBLIC_URL=https://fixlock.example.com \
  ghcr.io/abinandhmj/fixlock-app:latest
```

Put it behind your HTTPS reverse proxy (nginx, Caddy, Traefik, a load balancer). GitHub only sends webhooks to HTTPS, and the dashboard's sign-in cookies need it. The server reads `X-Forwarded-Proto` and `X-Forwarded-Host`, or uses `PUBLIC_URL` if set.

## Settings

| Variable | |
|---|---|
| `APP_ID`, `WEBHOOK_SECRET` | From your GitHub App |
| `PRIVATE_KEY_FILE` or `PRIVATE_KEY` | The App's private key: a file path, or the PEM itself (`\n` for line breaks is fine) |
| `CLIENT_ID`, `CLIENT_SECRET`, `SESSION_SECRET` | The team dashboard (optional) |
| `GITHUB_API`, `GITHUB_WEB` | GitHub Enterprise Server: `https://github.example.com/api/v3` and `https://github.example.com` |
| `PUBLIC_URL` | The address people and GitHub use, if the proxy doesn't send forwarded headers |
| `AUTO_SETUP=off` | Don't open setup pull requests on install |
| `PORT`, `HOST` | Default `8787`, `0.0.0.0` |

There's no Workers request limit here, so a setup on install covers every selected repository. Dashboard summaries are cached in memory for 5 minutes.

## Without Docker

```bash
git clone https://github.com/AbinandhMJ/fixlock && cd fixlock
APP_ID=… WEBHOOK_SECRET=… PRIVATE_KEY_FILE=./app.pem node app/server.mjs
```

Node.js 20 or newer; no `npm install` needed. Use your process manager (systemd, pm2) to keep it running.

## Updating

`docker pull ghcr.io/abinandhmj/fixlock-app:latest` and restart. Each commit to fixlock's main branch is also tagged with its commit SHA, if you want to pin a version.

## Verifying the image

Each image is built by fixlock's GitHub Actions workflow, signed with Sigstore (keyless) and carries a signed build attestation and an SBOM. Check one before you run it:

```bash
gh attestation verify oci://ghcr.io/abinandhmj/fixlock-app:latest -R AbinandhMJ/fixlock
# or, with cosign:
cosign verify ghcr.io/abinandhmj/fixlock-app:latest \
  --certificate-identity-regexp '^https://github.com/AbinandhMJ/fixlock/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```
