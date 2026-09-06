import "dotenv/config";
import express from "express";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { GoogleAuthorizationContext } from "./auth.js";
import { loadConfig, type Config } from "./config.js";
import { createLogger } from "./observability.js";
import { IdempotencyStore, WorkspaceService } from "./services.js";
import { createMcpServer } from "./server.js";
import { createSchemas } from "./validation.js";

async function runStdio(buildServer: () => ReturnType<typeof createMcpServer>): Promise<void> {
  await buildServer().connect(new StdioServerTransport());
}

async function runHttp(config: Config, buildServer: () => ReturnType<typeof createMcpServer>): Promise<void> {
  const app = express();
  app.use(express.json());

  app.get("/healthz", (_request, response) => {
    response.status(200).send("ok");
  });

  app.get("/", (_request, response) => {
    response.status(200).json({
      name: "google-workspace-mcp-server",
      status: "ok",
      endpoints: {
        health: "/healthz",
        mcp: "/mcp",
      },
    });
  });

  // Stateless mode: a fresh server + transport per request avoids cross-request session leakage.
  app.post("/mcp", async (request, response) => {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    response.on("close", () => transport.close());
    await buildServer().connect(transport);
    await transport.handleRequest(request, response, request.body);
  });

  await new Promise<void>((resolve) => {
    app.listen(config.PORT, () => {
      process.stderr.write(`MCP server listening on port ${config.PORT}\n`);
      resolve();
    });
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const schemas = createSchemas({ maxEmailSubjectSize: config.MAX_EMAIL_SUBJECT_SIZE, maxEmailBodySize: config.MAX_EMAIL_BODY_SIZE, maxDocumentAppendSize: config.MAX_DOCUMENT_APPEND_SIZE });
  const authorization = new GoogleAuthorizationContext(config);
  const buildServer = () => createMcpServer(new WorkspaceService(() => authorization.adapter(), new IdempotencyStore(), createLogger(config.LOG_LEVEL)), schemas);

  if (config.TRANSPORT === "http") await runHttp(config, buildServer);
  else await runStdio(buildServer);
}

main().catch((error) => {
  process.stderr.write(`Fatal server error: ${error instanceof Error ? error.message : "Unknown error"}\n`);
  process.exit(1);
});