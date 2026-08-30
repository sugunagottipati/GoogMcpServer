import { z } from "zod";

const emailAddress = z.string().email("Invalid email address.");

export function createSchemas(limits: { maxEmailSubjectSize: number; maxEmailBodySize: number; maxDocumentAppendSize: number }) {
  const idempotencyKey = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/).optional();
  const email = z.object({
    to: z.array(emailAddress).min(1, "At least one recipient is required."),
    cc: z.array(emailAddress).optional(),
    bcc: z.array(emailAddress).optional(),
    subject: z.string().trim().min(1).max(limits.maxEmailSubjectSize),
    body: z.string().trim().min(1).max(limits.maxEmailBodySize),
    isHtml: z.boolean().default(false),
    idempotencyKey,
  }).strict();
  const append = z.object({
    documentId: z.string().trim().regex(/^[A-Za-z0-9_-]{20,200}$/, "Invalid Google document ID."),
    content: z.string().trim().min(1).max(limits.maxDocumentAppendSize),
    addNewline: z.boolean().default(true),
    idempotencyKey,
  }).strict();
  return { email, append };
}

export type Schemas = ReturnType<typeof createSchemas>;
export type EmailInput = z.infer<Schemas["email"]>;
export type AppendInput = z.infer<Schemas["append"]>;