/*
 * The only way this UI talks to anything: same-origin fetch to /v1/admin.
 *
 * Cookies are httpOnly (the UI never sees the session token). The CSRF token is
 * held in memory only, handed out by GET /auth/session, and echoed in
 * X-CSRF-Token on every POST. No localStorage, no third-party origin.
 */

export type ApiFailure =
  | { kind: 'signed-out'; message: string }
  | { kind: 'forbidden'; message: string }
  | { kind: 'not-configured'; message: string }
  | { kind: 'error'; message: string; status: number | null; details?: { path: string; message: string }[] }

export class ApiError extends Error {
  readonly failure: ApiFailure
  constructor(failure: ApiFailure) {
    super(failure.message)
    this.failure = failure
  }
}

export interface Grant {
  role: 'admin' | 'curator' | 'viewer'
  reason: string
  source: string
}

export interface Session {
  address: string
  roles: string[]
  grants: Grant[]
  chainId: number
}

let csrfToken: string | null = null
let fixtureSeen = false
const listeners = new Set<() => void>()

/** True once any response carried the mock server's fixture header. The shell shows a banner. */
export const isFixtureApi = () => fixtureSeen
export function onSignedOut(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const BASE = '/v1/admin'

async function failureFrom(res: Response): Promise<ApiFailure> {
  let body: { error?: { code?: string; message?: string; details?: { path: string; message: string }[] } } = {}
  try {
    body = await res.json()
  } catch {
    /* not JSON */
  }
  const code = body.error?.code
  const message = body.error?.message ?? `HTTP ${res.status}`
  if (res.status === 401) return { kind: 'signed-out', message }
  if (res.status === 403) return { kind: 'forbidden', message }
  if (res.status === 404 && /disabled|not enabled/i.test(message)) return { kind: 'not-configured', message }
  if (res.status === 503 && code === 'NOT_INDEXED') return { kind: 'not-configured', message: `${message}. The indexer has not written a checkpoint for this chain.` }
  return { kind: 'error', message, status: res.status, details: body.error?.details }
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(method === 'POST' ? { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) } : {}),
      },
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    })
  } catch {
    throw new ApiError({ kind: 'error', message: 'The Latch API is unreachable from this browser.', status: null })
  }
  if (res.headers.get('x-latch-fixture')) fixtureSeen = true
  if (!res.ok) {
    const f = await failureFrom(res)
    if (f.kind === 'signed-out') for (const l of listeners) l()
    throw new ApiError(f)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const apiGet = <T>(path: string) => request<T>('GET', path)
export const apiPost = <T>(path: string, body?: unknown) => request<T>('POST', path, body)

export async function loadSession(): Promise<Session> {
  const s = await apiGet<Session & { csrfToken: string }>('/auth/session')
  csrfToken = s.csrfToken
  return { address: s.address, roles: s.roles, grants: s.grants ?? [], chainId: s.chainId }
}

export async function signOut(): Promise<void> {
  try {
    await apiPost('/auth/logout')
  } finally {
    csrfToken = null
  }
}

export function adoptSignIn(s: Session & { csrfToken: string }): Session {
  csrfToken = s.csrfToken
  return { address: s.address, roles: s.roles, grants: s.grants ?? [], chainId: s.chainId }
}

export function hasRole(session: Session | null, needed: 'admin' | 'curator' | 'viewer'): boolean {
  if (!session) return false
  const r = new Set(session.roles)
  if (r.has('admin')) return true
  if (needed === 'curator') return r.has('curator')
  if (needed === 'viewer') return r.has('curator') || r.has('viewer')
  return false
}

/** Query string from defined values only. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v))
  const s = u.toString()
  return s ? `?${s}` : ''
}
