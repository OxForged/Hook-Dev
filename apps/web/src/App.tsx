import { GasChart } from './charts/GasChart'
import { FeeChart } from './charts/FeeChart'

const NAV = [
  { href: '#why', label: 'Why Latch Protocol' },
  { href: '#architecture', label: 'Architecture' },
  { href: '#chains', label: 'Chains' },
  { href: '#fees', label: 'Fees' },
] as const

type Feature = { icon: string; title: string; body: string }

const FEATURES: readonly Feature[] = [
  {
    icon: 'V',
    title: 'Vault-separated custody',
    body:
      'A single Vault holds every token and settles balance deltas inside a lock. Pool managers register as apps against it, so new pool types ship without touching the contract that custodies funds.',
  },
  {
    icon: '2',
    title: 'Two pool types, one Vault',
    body:
      'Concentrated liquidity and liquidity-book (bin) pools both run as registered apps. Hooks written against one settlement model work across both.',
  },
  {
    icon: '<>',
    title: 'Hooks without address mining',
    body:
      'Permissions live in the pool key, not the hook address. Deploy a hook from any address and register it — no CREATE2 salt grinding, no vanity search.',
  },
] as const

type ChainRow = { evm: string; backend: string; status: string; note: string }

const CHAINS: readonly ChainRow[] = [
  {
    evm: 'Cancun (EIP-1153)',
    backend: 'Transient storage',
    status: 'Default build',
    note: 'TSTORE/TLOAD settlement. Lowest gas.',
  },
  {
    evm: 'Pre-Cancun (Shanghai)',
    backend: 'Persistent storage',
    status: 'Legacy build',
    note: 'SSTORE-backed settlement with explicit slot clearing.',
  },
] as const

type Stat = { v: string; k: string; note: string }

/** Every tile is countable in the repo; the note says where. */
const SURFACE_STATS: readonly Stat[] = [
  { v: '2', k: 'Pool types', note: 'Concentrated liquidity + liquidity book' },
  { v: '22', k: 'Unique event signatures', note: '34 declarations; ProtocolFees is a shared base' },
  { v: '14', k: 'Hook permission bits', note: 'Offsets 0–13 of a 16-bit bitmap' },
  { v: '4,000', k: 'Protocol fee cap, in pips', note: '0.4% — MAX_PROTOCOL_FEE' },
] as const

/*
 * Deliberately absent: a "tests passing" strip.
 * A local run on 9 Sep 2026 measured core 842/844 (2 Windows-only vm.ffi
 * failures), periphery 506/509 (3 REAL assertion failures in
 * PeripheryBackendSafetyTest — transient recorder state not swept),
 * fees 14/14, SDK 61/61. Publishing a green badge over a red suite would be
 * a false claim, and a hardcoded count drifts on the next commit. Add this
 * back only once the suites are green AND something keeps the number honest.
 */

function Nav() {
  return (
    <nav className="nav">
      <div className="wrap nav-inner">
        <a className="brand" href="#top">
          <span className="brand-mark" aria-hidden="true">
            L
          </span>
          Latch Protocol
        </a>
        <ul className="nav-links">
          {NAV.map((n) => (
            <li key={n.href}>
              <a href={n.href}>{n.label}</a>
            </li>
          ))}
        </ul>
        <a className="btn btn-ghost" href="#developers">
          Developer docs
        </a>
      </div>
    </nav>
  )
}

function Hero() {
  return (
    <header className="hero" id="top">
      <div className="wrap">
        <span className="eyebrow">
          <span className="dot" aria-hidden="true" />
          Pre-release · not yet deployed
        </span>
        <h1>
          The hooks platform for chains <span className="grad">v4 never reached</span>
        </h1>
        <p className="lede">
          A singleton AMM with programmable hooks, built to run on EVM chains that Uniswap v4 does
          not serve — including chains without transient storage. Permissioned by pool key, not by
          mined addresses.
        </p>
        <div className="cta-row">
          <a className="btn btn-primary" href="#developers">
            Build a hook
          </a>
          <a className="btn btn-ghost" href="#architecture">
            How it works
          </a>
        </div>
      </div>
    </header>
  )
}

function Why() {
  return (
    <section id="why">
      <div className="wrap">
        <p className="sec-label">The difference</p>
        <h2>Your hook&rsquo;s address is just an address</h2>
        <p className="sec-lede">
          Uniswap v4 encodes hook permissions in the low bits of the hook&rsquo;s own contract
          address, so shipping a hook means grinding a CREATE2 salt until you find one whose
          resulting address has the right bits set. Latch Protocol reads permissions from a bitmap in
          the pool key and cross-checks it against the hook, so any address works.
        </p>

        <div className="compare">
          <article className="card">
            <div className="card-head">
              <span className="tag tag-bad">v4</span> Mine an address
            </div>
            <p className="card-note">
              Search salts off-chain until the address encodes your permission bits. Change the
              permissions, mine again.
            </p>
            <pre>
              <code>
                <span className="c-dim">{'// grind until address bits match'}</span>
                {'\n'}
                <span className="c-key">while</span> (<span className="c-key">true</span>) {'{'}
                {'\n  salt++;'}
                {'\n  addr = create2Address(salt);'}
                {'\n  '}
                <span className="c-key">if</span> (addr & FLAGS == FLAGS){' '}
                <span className="c-key">break</span>;{'\n}'}
              </code>
            </pre>
          </article>

          <article className="card">
            <div className="card-head">
              <span className="tag tag-good">Latch Protocol</span> Declare a bitmap
            </div>
            <p className="card-note">
              The hook reports its own permissions. Core validates them against the pool key at
              initialization.
            </p>
            <pre>
              <code>
                <span className="c-key">function</span> getHooksRegistrationBitmap()
                {'\n  '}
                <span className="c-key">external</span> <span className="c-key">pure</span>{' '}
                <span className="c-key">returns</span> (<span className="c-str">uint16</span>)
                {'\n{'}
                {'\n  '}
                <span className="c-key">return</span> BEFORE_SWAP | AFTER_SWAP;
                {'\n}'}
              </code>
            </pre>
          </article>
        </div>
      </div>
    </section>
  )
}

function Architecture() {
  return (
    <section id="architecture">
      <div className="wrap">
        <p className="sec-label">Architecture</p>
        <h2>Custody and logic, separated</h2>
        <p className="sec-lede">
          Forked from PancakeSwap Infinity and hardened for portability. The Vault is the only
          contract that holds funds; everything else registers against it.
        </p>
        <div className="grid3">
          {FEATURES.map((f) => (
            <article className="card feat" key={f.title}>
              <div className="feat-icon" aria-hidden="true">
                {f.icon}
              </div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

function Chains() {
  return (
    <section id="chains">
      <div className="wrap">
        <p className="sec-label">Portability</p>
        <h2>One codebase, two settlement backends</h2>
        <p className="sec-lede">
          Transient storage (EIP-1153) is not available everywhere, and the chains without it are
          exactly the ones v4 skipped. The settlement layer compiles against either backend, chosen
          at build time.
        </p>
        <div className="table-scroll">
          <table>
            <caption className="sr-only">Build targets by EVM version</caption>
            <thead>
              <tr>
                <th scope="col">EVM target</th>
                <th scope="col">Settlement backend</th>
                <th scope="col">Build</th>
                <th scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              {CHAINS.map((c) => (
                <tr key={c.evm}>
                  <td>{c.evm}</td>
                  <td>{c.backend}</td>
                  <td className="num">{c.status}</td>
                  <td>{c.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <GasChart />
      </div>
    </section>
  )
}

function Fees() {
  return (
    <section id="fees">
      <div className="wrap">
        <p className="sec-label">Protocol fee</p>
        <h2>Taken from swap input, hard-capped at 0.4%</h2>
        <p className="sec-lede">
          The protocol fee is deducted from the swap input before the LP fee applies to the
          remainder. It is additive to what a swapper pays and does not reduce LP earnings. It is
          configurable per pool and per fee tier, and the library caps it at 4,000 pips. The chart
          below plots one scenario — a flat 0.1% — because a flat fee is where the tiering problem
          shows up.
        </p>

        <FeeChart />

        <p className="callout">
          <strong>Tiering is expected.</strong> A flat 0.1% multiplies the cost of a stable pool
          roughly elevenfold. Low-fee tiers should be configured with a smaller protocol fee to stay
          competitive — the controller supports per-tier and per-pool overrides.
        </p>
      </div>
    </section>
  )
}

function Developers() {
  return (
    <section id="developers">
      <div className="wrap">
        <p className="sec-label">For developers</p>
        <h2>Open source, GPL-2.0</h2>
        <p className="sec-lede">
          Core is GPL-2.0-or-later. The SDK and interfaces are MIT, so hooks you build stay yours —
          you never import copyleft code to integrate.
        </p>
        <div className="stats">
          {SURFACE_STATS.map((s) => (
            <div className="stat" key={s.k}>
              <div className="stat-v">{s.v}</div>
              <div className="stat-k">{s.k}</div>
              <div className="stat-note">{s.note}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default function App() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Why />
        <Architecture />
        <Chains />
        <Fees />
        <Developers />
      </main>
      <footer>
        <div className="wrap foot-inner">
          <span>Latch Protocol · GPL-2.0-or-later · Pre-release</span>
          <span className="foot-right">
            <span>Not audited. Not deployed. Do not use with real funds.</span>
            <a
              className="foot-credit"
              href="https://x.com/Ox_Forged"
              target="_blank"
              rel="noopener noreferrer"
            >
              Built by @Ox_Forged
            </a>
          </span>
        </div>
      </footer>
    </>
  )
}
