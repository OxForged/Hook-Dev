/**
 * Application errors.
 *
 * Everything thrown deliberately inside a route or service extends
 * `ApiError`, which carries the HTTP status and a stable machine-readable
 * `code`. The error middleware turns anything else into a 500 without leaking
 * internals.
 */

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_FAILED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNPROCESSABLE"
  | "RATE_LIMITED"
  | "DEPENDENCY_UNAVAILABLE"
  | "NOT_IMPLEMENTED"
  | "INTERNAL";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: unknown;
  override readonly cause?: unknown;

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    options?: { details?: unknown; cause?: unknown },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = options?.details;
    this.cause = options?.cause;
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(message: string, details?: unknown) {
    return new ApiError(400, "BAD_REQUEST", message, { details });
  }
  static validation(message: string, details?: unknown) {
    return new ApiError(422, "VALIDATION_FAILED", message, { details });
  }
  static unauthorized(message = "Authentication required") {
    return new ApiError(401, "UNAUTHORIZED", message);
  }
  static forbidden(message = "Not permitted") {
    return new ApiError(403, "FORBIDDEN", message);
  }
  static notFound(what: string) {
    return new ApiError(404, "NOT_FOUND", `${what} not found`);
  }
  static conflict(message: string, details?: unknown) {
    return new ApiError(409, "CONFLICT", message, { details });
  }
  static unavailable(message: string, cause?: unknown) {
    return new ApiError(503, "DEPENDENCY_UNAVAILABLE", message, { cause });
  }
  static notImplemented(message: string) {
    return new ApiError(501, "NOT_IMPLEMENTED", message);
  }
  static internal(message = "Internal server error", cause?: unknown) {
    return new ApiError(500, "INTERNAL", message, { cause });
  }
}

/**
 * Thrown by the RPC chain-data provider when a chain has no endpoint or no
 * known contract addresses. Distinct from a generic failure because it is the
 * expected state today: nothing is deployed.
 */
export class ChainProviderNotConfiguredError extends Error {
  readonly chainId: number;

  constructor(chainId: number, reason: string) {
    super(
      `No live chain-data provider for chain ${chainId}: ${reason}. ` +
        `Set CHAIN_PROVIDER=fixture to ingest local fixtures instead.`,
    );
    this.name = "ChainProviderNotConfiguredError";
    this.chainId = chainId;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}
