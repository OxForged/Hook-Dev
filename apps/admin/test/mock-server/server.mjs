// DEV/TEST ONLY. A fixture stand-in for /v1/admin so the operator console can be
// rendered and screenshotted without Postgres, Redis, a chain or a wallet.
//
//   node test/mock-server/server.mjs            (listens on 127.0.0.1:5189)
//   ADMIN_API_TARGET=http://127.0.0.1:5189 npx vite
//
// It lives under test/ so it is never imported by src/ and never bundled: vite
// builds only what src/main.tsx reaches. Every response carries
// `X-Latch-Fixture: test/mock-server`, and the console shows a red "TEST FIXTURE
// API" banner whenever it sees that header. The real API never sends it.
//
// A request whose Referer contains `signedout` gets 401 from /auth/session, to
// render the sign-in screen.
import { createServer } from 'node:http'
import { fixtures } from './fixtures.mjs'

const PORT = Number(process.env.MOCK_PORT ?? 5189)

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Latch-Fixture': 'test/mock-server', ...headers })
  res.end(body === undefined ? '' : JSON.stringify(body))
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)
  const path = url.pathname.replace(/^\/v1\/admin/, '')
  const signedOut = String(req.headers.referer ?? '').includes('signedout')
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const json = () => {
      try {
        return JSON.parse(body || '{}')
      } catch {
        return {}
      }
    }
    if (!url.pathname.startsWith('/v1/admin')) return send(res, 404, { error: { code: 'NOT_FOUND', message: 'mock serves /v1/admin only' } })

    if (req.method === 'GET' && path === '/auth/session') return signedOut ? send(res, 401, { error: { code: 'UNAUTHORIZED', message: 'No admin session' } }) : send(res, 200, fixtures.session)
    if (req.method === 'POST' && path === '/auth/nonce') return send(res, 200, { nonce: 'mockNonce12345678', domain: '127.0.0.1:5180', chainId: 4663, expiresAt: new Date(Date.now() + 300_000).toISOString() })
    if (req.method === 'POST' && path === '/auth/verify') return send(res, 200, fixtures.session)
    if (req.method === 'POST' && path === '/auth/logout') return send(res, 204)

    if (req.method === 'GET') {
      if (path === '/revenue/export.csv') {
        res.writeHead(200, { 'Content-Type': 'text/csv', 'X-Latch-Fixture': 'test/mock-server' })
        return res.end('chainId,source,token\r\n')
      }
      const m = /^\/moderation\/listings\/([a-z0-9]+)(\/icon)?$/.exec(path)
      if (m) return m[2] ? send(res, 404, { error: { code: 'NOT_FOUND', message: 'Icon not found' } }) : send(res, 200, fixtures.listingDetail)
      const key = path.replace(/^\//, '')
      if (key in fixtures.get) return send(res, 200, fixtures.get[key])
      return send(res, 404, { error: { code: 'NOT_FOUND', message: `mock has no ${path}` } })
    }

    if (req.method === 'POST') {
      if (path === '/timelock/execute') {
        const op = fixtures.get['governance/timelock'].operations.find((o) => o.operationId === json().operationId)
        if (!op) return send(res, 404, { error: { code: 'NOT_FOUND', message: 'Timelock operation not found' } })
        return send(res, 409, { error: { code: 'CONFLICT', message: `Operation is not ready until ${op.readyAt}` } })
      }
      if (path === '/safe/fee-controller/collect') return send(res, 200, fixtures.collect)
      if (path === '/safe/fee-controller/sweep') return send(res, 200, fixtures.collect)
      if (path === '/registry/listing') return send(res, 200, fixtures.flag)
      if (/\/moderation\/listings\/[a-z0-9]+\/(approve|reject|request-changes)$/.test(path)) return send(res, 200, { status: 'APPROVED' })
      if (path === '/keys') return send(res, 201, { key: { prefix: 'latchk_mockmockmock_…' }, secret: 'latchk_mockmockmock_THIS-IS-A-FIXTURE-NOT-A-KEY-0000000000000' })
      if (path === '/keys/accounts') return send(res, 201, { id: 'cmockaccount000000000001' })
      if (/^\/keys\/[a-z0-9]+\/revoke$/.test(path)) return send(res, 200, { effective: 'immediately' })
    }
    return send(res, 404, { error: { code: 'NOT_FOUND', message: `mock has no ${req.method} ${path}` } })
  })
})

server.listen(PORT, '127.0.0.1', () => console.log(`admin mock API (fixtures) on http://127.0.0.1:${PORT}`))
