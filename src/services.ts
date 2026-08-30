import { createHash, randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { AppendInput, EmailInput } from "./validation.js";
import type { WorkspaceAdapter } from "./providers.js";
import { ApplicationError } from "./errors.js";

type Entry = { fingerprint: string; expiresAt: number; result: unknown };

export class IdempotencyStore {
  private readonly entries = new Map<string, Entry>();
  async execute<T>(tool: string, key: string | undefined, input: unknown, action: () => Promise<T>): Promise<T> {
    if (!key) return action();
    const storageKey = `${tool}:${key}`;
    const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const existing = this.entries.get(storageKey);
    if (existing && existing.expiresAt > Date.now()) {
      if (existing.fingerprint !== fingerprint) throw new ApplicationError("CONFLICT", "The idempotency key was used with different input.", false);
      return existing.result as T;
    }
    const result = await action();
    this.entries.set(storageKey, { fingerprint, result, expiresAt: Date.now() + 86_400_000 });
    return result;
  }
}

export class WorkspaceService {
  constructor(private readonly adapterFactory: () => Promise<WorkspaceAdapter>, private readonly idempotency: IdempotencyStore, private readonly logger: Logger) {}
  createDraft(input: EmailInput) { return this.run("gmail_create_draft", input, (adapter) => adapter.createDraft(input)); }
  sendEmail(input: EmailInput) { return this.run("gmail_send_email", input, (adapter) => adapter.sendEmail(input)); }
  appendContent(input: AppendInput) { return this.run("google_docs_append_content", input, async (adapter) => ({ documentId: input.documentId, ...(await adapter.appendDocument(input.documentId, input.content, input.addNewline)) })); }

  private async run<T>(tool: string, input: { idempotencyKey?: string }, action: (adapter: WorkspaceAdapter) => Promise<T>): Promise<T> {
    const requestId = randomUUID();
    const startedAt = Date.now();
    try {
      const result = await this.idempotency.execute(tool, input.idempotencyKey, input, async () => action(await this.adapterFactory()));
      this.logger.info({ requestId, tool, success: true, durationMs: Date.now() - startedAt }, "workspace_write_operation");
      return result;
    } catch (error) {
      this.logger.warn({ requestId, tool, success: false, durationMs: Date.now() - startedAt, errorCode: error instanceof ApplicationError ? error.code : "INTERNAL_ERROR" }, "workspace_write_operation");
      throw error;
    }
  }
}