/**
 * Cloudflare Turnstile verification for the public listing submission endpoint.
 * OFF unless TURNSTILE_ENABLED=true. When on, it FAILS CLOSED: a verification
 * that errors or times out rejects the submission.
 */

export interface CaptchaVerifier {
  readonly enabled: boolean;
  verify(token: string | undefined, remoteIp: string | undefined): Promise<{ ok: boolean; reason: string | null }>;
}

export const disabledCaptcha: CaptchaVerifier = {
  enabled: false,
  verify: async () => ({ ok: true, reason: null }),
};

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function turnstileVerifier(secret: string, fetchImpl: typeof fetch = fetch, timeoutMs = 5_000): CaptchaVerifier {
  return {
    enabled: true,
    async verify(token, remoteIp) {
      if (!token || token.length > 2_048) return { ok: false, reason: "captcha token missing" };
      const body = new URLSearchParams({ secret, response: token });
      if (remoteIp) body.set("remoteip", remoteIp);
      try {
        const res = await fetchImpl(SITEVERIFY, { method: "POST", body, signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) return { ok: false, reason: "captcha verification unavailable" };
        const j = (await res.json()) as { success?: boolean };
        return j.success === true ? { ok: true, reason: null } : { ok: false, reason: "captcha rejected" };
      } catch {
        return { ok: false, reason: "captcha verification unavailable" };
      }
    },
  };
}
