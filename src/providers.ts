import { google } from "googleapis";
import sanitizeHtml from "sanitize-html";
import { ApplicationError } from "./errors.js";

export type EmailCommand = { to: string[]; cc?: string[]; bcc?: string[]; subject: string; body: string; isHtml: boolean };
export type GmailResult = { messageId: string; threadId: string };
export type DraftResult = GmailResult & { draftId: string };

export interface WorkspaceAdapter {
  createDraft(command: EmailCommand): Promise<DraftResult>;
  sendEmail(command: EmailCommand): Promise<GmailResult>;
  appendDocument(documentId: string, content: string, addNewline: boolean): Promise<{ appendedCharacters: number }>;
}

function encodedHeader(value: string): string {
  if (/\r|\n/.test(value)) throw new ApplicationError("INVALID_INPUT", "Email headers cannot contain line breaks.", false);
  return /[^\x20-\x7E]/.test(value) ? `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=` : value;
}

export function buildRawMessage(command: EmailCommand): string {
  const content = command.isHtml ? sanitizeHtml(command.body) : command.body;
  const headers = [
    `To: ${command.to.map(encodedHeader).join(", ")}`,
    ...(command.cc?.length ? [`Cc: ${command.cc.map(encodedHeader).join(", ")}`] : []),
    ...(command.bcc?.length ? [`Bcc: ${command.bcc.map(encodedHeader).join(", ")}`] : []),
    `Subject: ${encodedHeader(command.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: ${command.isHtml ? "text/html" : "text/plain"}; charset=utf-8`,
    "Content-Transfer-Encoding: base64",
  ];
  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${Buffer.from(content, "utf8").toString("base64")}`, "utf8").toString("base64url");
}

export class GoogleWorkspaceAdapter implements WorkspaceAdapter {
  constructor(private readonly auth: InstanceType<typeof google.auth.OAuth2>) {}

  async createDraft(command: EmailCommand): Promise<DraftResult> {
    try {
      const response = await google.gmail({ version: "v1", auth: this.auth }).users.drafts.create({ userId: "me", requestBody: { message: { raw: buildRawMessage(command) } } });
      const draft = response.data;
      if (!draft.id || !draft.message?.id || !draft.message.threadId) throw new Error("Gmail returned an incomplete draft response.");
      return { draftId: draft.id, messageId: draft.message.id, threadId: draft.message.threadId };
    } catch (error) { throw mapGoogleError(error); }
  }

  async sendEmail(command: EmailCommand): Promise<GmailResult> {
    try {
      const response = await google.gmail({ version: "v1", auth: this.auth }).users.messages.send({ userId: "me", requestBody: { raw: buildRawMessage(command) } });
      if (!response.data.id || !response.data.threadId) throw new Error("Gmail returned an incomplete send response.");
      return { messageId: response.data.id, threadId: response.data.threadId };
    } catch (error) { throw mapGoogleError(error); }
  }

  async appendDocument(documentId: string, content: string, addNewline: boolean): Promise<{ appendedCharacters: number }> {
    try {
      const docs = google.docs({ version: "v1", auth: this.auth });
      const document = await docs.documents.get({ documentId });
      const endIndex = document.data.body?.content?.at(-1)?.endIndex;
      if (!endIndex || endIndex < 2) throw new Error("Google Docs returned an invalid document end position.");
      const text = `${addNewline ? "\n" : ""}${content}`;
      await docs.documents.batchUpdate({ documentId, requestBody: { requests: [{ insertText: { location: { index: endIndex - 1 }, text } }] } });
      return { appendedCharacters: text.length };
    } catch (error) { throw mapGoogleError(error); }
  }
}

function mapGoogleError(error: unknown): ApplicationError {
  const status = typeof error === "object" && error !== null && "code" in error && typeof error.code === "number" ? error.code : undefined;
  if (status === 401) return new ApplicationError("AUTHENTICATION_REQUIRED", "Google authorization is required or has expired.", false, status);
  if (status === 403) return new ApplicationError("AUTHORIZATION_DENIED", "The Google account is not authorized for this operation.", false, status);
  if (status === 404) return new ApplicationError("RESOURCE_NOT_FOUND", "The requested Google resource was not found or is inaccessible.", false, status);
  if (status === 429) return new ApplicationError("RATE_LIMITED", "Google rate limited this operation.", true, status);
  if (status && status >= 500) return new ApplicationError("PROVIDER_ERROR", "Google Workspace is temporarily unavailable.", true, status);
  return new ApplicationError("PROVIDER_ERROR", "Google Workspace could not complete the operation.", false, status);
}