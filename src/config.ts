import { z } from "zod";

const positiveInteger = (fallback: number) => z.coerce.number().int().positive().default(fallback);

const configSchema = z.object({
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_REDIRECT_URI: z.url().optional(),
  GOOGLE_TOKEN_STORE_PATH: z.string().min(1).default(".google-tokens.json"),
  GOOGLE_TOKENS_JSON: z.string().min(1).optional(),
  GOOGLE_TOKEN_STORE_ENCRYPTION_KEY: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
  PORT: positiveInteger(3000),
  MAX_EMAIL_SUBJECT_SIZE: positiveInteger(998),
  MAX_EMAIL_BODY_SIZE: positiveInteger(1_048_576),
  MAX_DOCUMENT_APPEND_SIZE: positiveInteger(1_048_576),
  REQUEST_TIMEOUT_MS: positiveInteger(15_000),
  RATE_LIMIT_PER_MINUTE: positiveInteger(30),
  IDEMPOTENCY_TTL_SECONDS: positiveInteger(86_400),
});

export type Config = z.infer<typeof configSchema>;
export const loadConfig = (environment: NodeJS.ProcessEnv = process.env): Config => configSchema.parse(environment);

export function requireGoogleOAuthConfig(config: Config): Required<Pick<Config, "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "GOOGLE_REDIRECT_URI">> {
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET || !config.GOOGLE_REDIRECT_URI) {
    throw new Error("Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.");
  }
  return { GOOGLE_CLIENT_ID: config.GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET: config.GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI: config.GOOGLE_REDIRECT_URI };
}

export function requireTokenEncryptionKey(config: Config): Buffer {
  if (!config.GOOGLE_TOKEN_STORE_ENCRYPTION_KEY) throw new Error("GOOGLE_TOKEN_STORE_ENCRYPTION_KEY must be set to a base64-encoded 32-byte key.");
  const key = Buffer.from(config.GOOGLE_TOKEN_STORE_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) throw new Error("GOOGLE_TOKEN_STORE_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  return key;
}