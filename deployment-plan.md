# Deployment Plan: MCP Server on Railway

## 0. Prerequisite blocker: transport mismatch

This server currently connects with `StdioServerTransport` ([src/index.ts](src/index.ts)):

```ts
await createMcpServer(service, schemas).connect(new StdioServerTransport());
```

Stdio transport expects the MCP client to spawn the server as a local child process and talk to it over stdin/stdout. Railway hosts long-running network services — there's no MCP client attached to the container's stdio, so a stdio-only build would start, do nothing, and Railway's health checks would fail.

**Required change before deploying:** add an HTTP-based transport alongside (or instead of) stdio, using the SDK's `StreamableHTTPServerTransport`, and bind it to `process.env.PORT` (Railway injects `PORT` at runtime).

High-level shape:

```ts
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await createMcpServer(service, schemas).connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get("/healthz", (_req, res) => res.status(200).send("ok"));

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => logger.info({ port }, "MCP server listening"));
```

Keep the existing `npm run dev` / stdio path for local MCP client use (Claude Desktop, etc.) behind an env flag (e.g. `TRANSPORT=http` vs default stdio) so nothing local breaks.

This is a code change, not just a config change — flag it to the team before scheduling the Railway rollout.

## 1. Containerize the app

Add a `Dockerfile` (Railway also supports Nixpacks auto-detection, but an explicit Dockerfile is more predictable for a TypeScript/ESM build):

```dockerfile
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/build ./build
EXPOSE 3000
CMD ["node", "build/index.js"]
```

Add a `.dockerignore`:

```
node_modules
build
.env
.google-tokens.json
tests
*.md
```

## 2. Fix the token store for Railway's ephemeral filesystem

`GOOGLE_TOKEN_STORE_PATH` currently points at `.google-tokens.json` on local disk ([src/auth.ts](src/auth.ts)). Railway containers redeploy from scratch — anything written to the local filesystem is lost on every deploy/restart.

Options, in order of preference:
1. **Attach a Railway Volume** and set `GOOGLE_TOKEN_STORE_PATH` to a path inside the mounted volume (e.g. `/data/google-tokens.json`). Simplest change, no code edits needed.
2. Move token storage to a managed store (Railway Postgres/Redis add-on) if multiple instances or true durability is needed later.

Volumes are the minimal-effort fix for a single-instance deployment; note it in the plan as the default.

## 3. Secrets and environment variables

Do **not** commit `.env` (already gitignored) or `src/client_secret_818015685530-*.json` — that file contains a real OAuth client secret. Add it to `.gitignore` and remove it from the repo before pushing to a remote that Railway builds from, since Railway typically deploys from a connected GitHub repo.

Set these as Railway **environment variables** (Project → Variables), not baked into the image:

| Variable | Value / source |
|---|---|
| `GOOGLE_CLIENT_ID` | from Google Cloud Console OAuth client |
| `GOOGLE_CLIENT_SECRET` | from Google Cloud Console OAuth client (rotate the one currently in `.env` before reuse, since it has been sitting in a local plaintext file) |
| `GOOGLE_REDIRECT_URI` | `https://<your-railway-domain>/oauth2/callback` — must be updated to the public Railway URL and added to the OAuth client's Authorized redirect URIs in Google Cloud Console |
| `GOOGLE_TOKEN_STORE_PATH` | `/data/google-tokens.json` (volume mount path) |
| `GOOGLE_TOKEN_STORE_ENCRYPTION_KEY` | generate a fresh base64 32-byte key (`openssl rand -base64 32`) — don't reuse the local dev key |
| `LOG_LEVEL` | `info` |
| `MAX_EMAIL_SUBJECT_SIZE`, `MAX_EMAIL_BODY_SIZE`, `MAX_DOCUMENT_APPEND_SIZE`, `REQUEST_TIMEOUT_MS`, `RATE_LIMIT_PER_MINUTE`, `IDEMPOTENCY_TTL_SECONDS` | keep current defaults unless load-testing says otherwise |
| `PORT` | set automatically by Railway; just make sure the app reads it |

## 4. Google OAuth authorization flow in a hosted environment

`npm run authorize` ([src/authorize.ts](src/authorize.ts)) runs an interactive local flow (opens a browser, listens on `127.0.0.1:3000` for the callback). That won't work directly inside a Railway container. Two options:

- **Recommended:** run `npm run authorize` once locally against the *production* OAuth client (same `GOOGLE_CLIENT_ID`/`SECRET`, redirect URI set to the Railway domain), producing a token file, then upload that token file into the Railway volume (e.g. via `railway run` / a one-off shell, or `railway ssh` if available) so the deployed service starts with valid tokens.
- Alternative: expose the `/oauth2/callback` route from the deployed app itself and run the authorization handshake once against the live URL.

Either way, document who owns re-authorization when the refresh token is eventually revoked.

## 5. Railway project setup steps

1. `npm install -g @railway/cli` (if not already installed) and `railway login`.
2. `railway init` in this repo (or connect the GitHub repo via the Railway dashboard for auto-deploys on push).
3. Add a Volume in the Railway dashboard, mount it at `/data`.
4. Set all environment variables from Section 3 in the Railway dashboard.
5. Push/deploy: `railway up` (CLI) or let the GitHub integration trigger a build on push to the deploy branch.
6. In Railway → Settings → Networking, generate a public domain (or attach a custom domain).
7. Update the Google Cloud Console OAuth client's Authorized redirect URI to `https://<railway-domain>/oauth2/callback`.
8. Run the one-time authorization step from Section 4 and confirm the token file lands in the mounted volume.
9. Add a health check in Railway settings pointing at `GET /healthz` (once the HTTP transport from Section 0 is in place).

## 6. Post-deploy verification

- `curl https://<railway-domain>/healthz` returns `200`.
- Send a minimal MCP `initialize` request to `/mcp` and confirm the `google-workspace` server responds with its declared tools.
- Trigger `gmail_create_draft` against a test account and confirm the draft appears (non-destructive check).
- Confirm logs (`railway logs`) show structured pino output at the configured `LOG_LEVEL` and no leaked secrets.
- Restart the service (`railway service restart` or redeploy) and confirm tokens persist (volume works) instead of forcing re-authorization.

## Open items to confirm with the team before proceeding

- Whether stdio access is still needed for local MCP clients (Claude Desktop, etc.) alongside the hosted HTTP endpoint, or whether this deployment fully replaces local usage.
- Who owns rotating the Google OAuth client secret before production traffic starts (current one has lived in a local `.env`).
- Expected request volume, to decide if the in-memory `IdempotencyStore` ([src/services.ts](src/services.ts)) needs to move to Redis for multi-instance deployments.
