# Google Workspace MCP Server

Generic stdio MCP server exposing `gmail_create_draft`, `gmail_send_email`, and `google_docs_append_content`.

## Setup

1. Enable the Gmail API and Google Docs API in a Google Cloud project, then create an OAuth 2.0 desktop client.
2. Copy `.env.example` to `.env`, set the OAuth values, generate `GOOGLE_TOKEN_STORE_ENCRYPTION_KEY` with `openssl rand -base64 32`, and register the exact redirect URI in Google Cloud.
3. Run `npm run build`, then `npm run authorize` and complete browser consent.
4. Run `npm start`, or configure an MCP client to execute `node /absolute/path/to/mcp-server/build/index.js`. VS Code configuration is included in [.vscode/mcp.json](.vscode/mcp.json).

## Commands

```bash
npm run build
npm test
npm run authorize
npm start
```

The server requests only `gmail.compose` and `documents`. OAuth tokens, client secrets, email bodies, and document content are excluded from tool results and normal logs. See [docs/architecture.md](docs/architecture.md) for design and production deployment considerations.