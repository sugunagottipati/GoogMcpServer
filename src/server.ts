import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WorkspaceService } from "./services.js";
import type { Schemas } from "./validation.js";
import { toApplicationError } from "./errors.js";

function toolResult(value: Record<string, unknown>, isError = false) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value, ...(isError ? { isError: true } : {}) };
}

async function invoke(action: () => Promise<Record<string, unknown>>) {
  try { return toolResult({ success: true, ...(await action()) }); }
  catch (error) {
    const appError = toApplicationError(error);
    return toolResult({ success: false, error: { code: appError.code, message: appError.message, retryable: appError.retryable, ...(appError.providerStatus ? { providerStatus: appError.providerStatus } : {}) } }, true);
  }
}

export function createMcpServer(service: WorkspaceService, schemas: Schemas): McpServer {
  const server = new McpServer({ name: "google-workspace", version: "1.0.0" });
  server.registerTool("gmail_create_draft", { title: "Create Gmail Draft", description: "Creates a Gmail draft only for the authorized Google account. This operation never sends email.", inputSchema: schemas.email.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } }, async (args) => invoke(() => service.createDraft(schemas.email.parse(args))));
  server.registerTool("gmail_send_email", { title: "Send Gmail Email", description: "Sends an email externally through the authorized Gmail account. This operation has an immediate external side effect.", inputSchema: schemas.email.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } }, async (args) => invoke(() => service.sendEmail(schemas.email.parse(args))));
  server.registerTool("google_docs_append_content", { title: "Append Google Doc Content", description: "Appends text to the end of an existing Google Document without overwriting existing content. This operation modifies the document.", inputSchema: schemas.append.shape, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } }, async (args) => invoke(() => service.appendContent(schemas.append.parse(args))));
  return server;
}