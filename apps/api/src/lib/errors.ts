/**
 * Deliberate API errors carry an HTTP status and a stable machine code. The
 * error middleware turns anything else into a bare 500 with no internals.
 */

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_FAILED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "CAPTCHA_FAILED"
  | "PAYLOAD_TOO_LARGE"
  | "URI_TOO_LONG"
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "NOT_INDEXED"
  | "DEPENDENCY_UNAVAILABLE"
  | "TIMEOUT"
  | "INTERNAL";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  static badRequest(message: string, details?: unknown) {
    return new ApiError(400, "BAD_REQUEST", message, details);
  }
  static validation(message: string, details?: unknown) {
    return new ApiError(422, "VALIDATION_FAILED", message, details);
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
  static conflict(message: string) {
    return new ApiError(409, "CONFLICT", message);
  }
  static notIndexed(chainId: number) {
    return new ApiError(503, "NOT_INDEXED", `Chain ${chainId} has not been indexed yet`);
  }
  static unavailable(message: string) {
    return new ApiError(503, "DEPENDENCY_UNAVAILABLE", message);
  }
}
