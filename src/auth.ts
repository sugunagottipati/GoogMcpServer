import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { google } from "googleapis";
import { requireGoogleOAuthConfig, requireTokenEncryptionKey, type Config } from "./config.js";
import { ApplicationError } from "./errors.js";
import { GoogleWorkspaceAdapter, type WorkspaceAdapter } from "./providers.js";

export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/gmail.compose", "https://www.googleapis.com/auth/documents"];

function decryptTokenPayload(payload: string, encryptionKey: Buffer): Record<string, unknown> {
  const encrypted = JSON.parse(payload) as { iv: string; tag: string; ciphertext: string };
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(encrypted.iv, "base64"));
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, "base64")), decipher.final()]).toString("utf8")) as Record<string, unknown>;
}

function encryptTokenPayload(tokens: Record<string, unknown>, encryptionKey: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(tokens), "utf8"), cipher.final()]);
  return JSON.stringify({ iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") });
}

export class LocalTokenStore {
  constructor(private readonly path: string, private readonly encryptionKey: Buffer) {}

  async load(): Promise<Record<string, unknown> | undefined> {
    try {
      return decryptTokenPayload(await readFile(this.path, "utf8"), this.encryptionKey);
    } catch (error: unknown) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    }
  }

  async save(tokens: Record<string, unknown>): Promise<void> {
    const payload = encryptTokenPayload(tokens, this.encryptionKey);
    await writeFile(this.path, payload, { mode: 0o600 });
    await chmod(this.path, 0o600);
  }
}

export class EnvTokenStore {
  constructor(private readonly payload: string, private readonly encryptionKey: Buffer) {}

  load(): Record<string, unknown> {
    return decryptTokenPayload(this.payload, this.encryptionKey);
  }
}

export class GoogleAuthorizationContext {
  constructor(private readonly config: Config) {}

  async adapter(): Promise<WorkspaceAdapter> {
    let oauth: ReturnType<typeof requireGoogleOAuthConfig>;
    let encryptionKey: Buffer;
    try {
      oauth = requireGoogleOAuthConfig(this.config);
      encryptionKey = requireTokenEncryptionKey(this.config);
    } catch {
      throw new ApplicationError("AUTHENTICATION_REQUIRED", "Google OAuth has not been configured for this server.", false);
    }
    const credentials = this.config.GOOGLE_TOKENS_JSON
      ? new EnvTokenStore(this.config.GOOGLE_TOKENS_JSON, encryptionKey).load()
      : await new LocalTokenStore(this.config.GOOGLE_TOKEN_STORE_PATH, encryptionKey).load();
    if (!credentials) throw new ApplicationError("AUTHENTICATION_REQUIRED", "Authorize a Google account before invoking this tool.", false);
    const client = new google.auth.OAuth2(oauth.GOOGLE_CLIENT_ID, oauth.GOOGLE_CLIENT_SECRET, oauth.GOOGLE_REDIRECT_URI);
    client.setCredentials(credentials);
    return new GoogleWorkspaceAdapter(client);
  }
}

export async function authorizeGoogle(config: Config): Promise<void> {
  const oauth = requireGoogleOAuthConfig(config);
  const encryptionKey = requireTokenEncryptionKey(config);
  const redirectUri = new URL(oauth.GOOGLE_REDIRECT_URI);
  if (!["localhost", "127.0.0.1", "::1"].includes(redirectUri.hostname)) throw new Error("GOOGLE_REDIRECT_URI must use a loopback hostname for local authorization.");
  const client = new google.auth.OAuth2(oauth.GOOGLE_CLIENT_ID, oauth.GOOGLE_CLIENT_SECRET, oauth.GOOGLE_REDIRECT_URI);
  const state = randomBytes(32).toString("base64url");
  process.stderr.write(`Open this URL to authorize Google Workspace:\n${client.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: GOOGLE_SCOPES, state })}\n`);

  await new Promise<void>((resolve, reject) => {
    const server = createServer(async (request, response) => {
      try {
        const callback = new URL(request.url ?? "/", oauth.GOOGLE_REDIRECT_URI);
        if (callback.pathname !== redirectUri.pathname || callback.searchParams.get("state") !== state) throw new Error("OAuth state validation failed.");
        const code = callback.searchParams.get("code");
        if (!code) throw new Error("Google did not return an authorization code.");
        const { tokens } = await client.getToken(code);
        await new LocalTokenStore(config.GOOGLE_TOKEN_STORE_PATH, encryptionKey).save(tokens as Record<string, unknown>);
        process.stderr.write(`\nSet this as GOOGLE_TOKENS_JSON to deploy without a token file/volume:\n${encryptTokenPayload(tokens as Record<string, unknown>, encryptionKey)}\n`);
        response.end("Google Workspace authorization completed. You may close this tab.");
        server.close(() => resolve());
      } catch (error) {
        response.statusCode = 400;
        response.end("Authorization failed. Return to the terminal for details.");
        server.close(() => reject(error));
      }
    });
    server.listen(Number(redirectUri.port || 80), redirectUri.hostname);
    server.on("error", reject);
  });
}