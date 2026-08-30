import { describe, expect, it } from "vitest";
import { buildRawMessage } from "../src/providers.js";
import { createSchemas } from "../src/validation.js";

const schemas = createSchemas({ maxEmailSubjectSize: 998, maxEmailBodySize: 1_000, maxDocumentAppendSize: 1_000 });

describe("input validation", () => {
  it("rejects invalid recipients before a provider call", () => {
    expect(() => schemas.email.parse({ to: ["invalid"], subject: "Subject", body: "Body" })).toThrow();
  });

  it("defaults email and document options", () => {
    expect(schemas.email.parse({ to: ["person@example.com"], subject: "Subject", body: "Body" }).isHtml).toBe(false);
    expect(schemas.append.parse({ documentId: "abcdefghijklmnopqrstuv", content: "Notes" }).addNewline).toBe(true);
  });
});

describe("Gmail message construction", () => {
  it("preserves validated recipients and strips unsafe HTML", () => {
    const raw = buildRawMessage({ to: ["person@example.com"], subject: "Hello", body: "<p>Hi</p><script>bad()</script>", isHtml: true });
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    expect(decoded).toContain("To: person@example.com");
    expect(Buffer.from(decoded.split("\r\n\r\n")[1], "base64").toString("utf8")).not.toContain("script");
  });
});