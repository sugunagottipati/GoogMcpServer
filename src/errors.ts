export type ErrorCode = "INVALID_INPUT" | "AUTHENTICATION_REQUIRED" | "AUTHORIZATION_DENIED" | "RESOURCE_NOT_FOUND" | "RATE_LIMITED" | "PROVIDER_ERROR" | "NETWORK_ERROR" | "TIMEOUT" | "CONFLICT" | "INTERNAL_ERROR";

export class ApplicationError extends Error {
  constructor(public readonly code: ErrorCode, message: string, public readonly retryable: boolean, public readonly providerStatus?: number) {
    super(message);
  }
}

export function toApplicationError(error: unknown): ApplicationError {
  if (error instanceof ApplicationError) return error;
  if (error instanceof Error && error.name === "AbortError") return new ApplicationError("TIMEOUT", "The Google Workspace request timed out.", true);
  return new ApplicationError("INTERNAL_ERROR", "The operation could not be completed.", false);
}