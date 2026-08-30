import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceAdapter } from "../src/providers.js";
import { IdempotencyStore, WorkspaceService } from "../src/services.js";
import { createSchemas } from "../src/validation.js";

const schemas = createSchemas({ maxEmailSubjectSize: 998, maxEmailBodySize: 1_000, maxDocumentAppendSize: 1_000 });

describe("workspace service", () => {
  it("creates a draft without invoking the send path", async () => {
    const adapter: WorkspaceAdapter = { createDraft: vi.fn().mockResolvedValue({ draftId: "draft", messageId: "message", threadId: "thread" }), sendEmail: vi.fn(), appendDocument: vi.fn() };
    const service = new WorkspaceService(async () => adapter, new IdempotencyStore(), pino({ enabled: false }));
    await service.createDraft(schemas.email.parse({ to: ["person@example.com"], subject: "Draft", body: "Hello" }));
    expect(adapter.sendEmail).not.toHaveBeenCalled();
  });

  it("does not repeat a send for the same idempotency key", async () => {
    const adapter: WorkspaceAdapter = { createDraft: vi.fn(), sendEmail: vi.fn().mockResolvedValue({ messageId: "message", threadId: "thread" }), appendDocument: vi.fn() };
    const service = new WorkspaceService(async () => adapter, new IdempotencyStore(), pino({ enabled: false }));
    const input = schemas.email.parse({ to: ["person@example.com"], subject: "Send", body: "Hello", idempotencyKey: "send-1" });
    await service.sendEmail(input);
    await service.sendEmail(input);
    expect(adapter.sendEmail).toHaveBeenCalledTimes(1);
  });
});