import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Session and CSRF primitives.
 *
 *   session token  32 random bytes, base64url, ONLY in an httpOnly SameSite=Strict
 *                  cookie. The database stores sha256(token) as the session id,
 *                  so a database read cannot be replayed as a cookie.
 *   CSRF token     32 random bytes, returned in a JSON body to the same-origin
 *                  admin UI, which echoes it in X-CSRF-Token on every non-GET.
 *                  Stored as sha256. Rotated on every /auth/session read.
 */

export const SESSION_COOKIE_SECURE = "__Host-latch_admin";
export const SESSION_COOKIE_DEV = "latch_admin";

export const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
export const randomToken = () => randomBytes(32).toString("base64url");

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k && !(k in out)) {
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        /* ignore malformed */
      }
    }
  }
  return out;
}

export function sessionCookie(name: string, token: string, maxAgeSeconds: number, secure: boolean): string {
  return [`${name}=${token}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${maxAgeSeconds}`, ...(secure ? ["Secure"] : [])].join("; ");
}

export function clearedCookie(name: string, secure: boolean): string {
  return [`${name}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0", ...(secure ? ["Secure"] : [])].join("; ");
}

export interface AuditInput {
  actor: string;
  actorRoles: string[];
  action: string;
  targetType?: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
  requestId?: string;
  ip?: string;
}

/** Every admin mutation writes one of these. Never pass a token or signature in before/after. */
export async function writeAudit(prisma: PrismaClient | Prisma.TransactionClient, a: AuditInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actor: a.actor.toLowerCase(),
      actorRoles: a.actorRoles,
      action: a.action,
      targetType: a.targetType ?? null,
      targetId: a.targetId ?? null,
      before: (a.before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (a.after ?? undefined) as Prisma.InputJsonValue | undefined,
      requestId: a.requestId ?? null,
      ip: a.ip ?? null,
    },
  });
}
