/* Settings — SCREENS.md § C7.

   The network picker is no longer a list of plausible-sounding chain names. It
   is the SDK's own target list (src/data/chains.ts, generated from
   packages/sdk/src/chains/endpoints.ts), and each chip states whether Latch is
   actually deployed there. Most are targets with no contracts; showing them as
   selectable without saying so would be a lie.

   WHICH CHAINS ARE DEPLOYED IS COUNTED, NOT ASSERTED. This screen used to state
   "Latch contracts exist on Ethereum Sepolia only", which was false the day a
   second deployment went live — and false in the worst direction, on a mainnet
   build, naming a testnet. The sentence is now assembled from the same contract
   table the chips are, so it cannot disagree with them.

   THE PREFERENCE SWITCHES ARE GONE. Four toggles that read nothing and wrote
   nothing, captioned with simulation, alerting and gas-sponsorship features
   this project does not have. See the header of data/settings.ts. Appearance
   stays: it is the one control here that does what it says.

   THE ENDPOINT CHARTS ARE MEASUREMENTS. `endpointCount`, `supportsEip1153`,
   `singlePointOfFailure` and `belowTarget` are all results of live probes run
   before shipping, recorded in the generated chain list. A gauge against the
   SDK's five-endpoint target says how much rate-limit headroom the selected
   chain has; the bar list says which chain degrades first. Neither adds a
   number the probe did not produce. */

import { useMemo } from 'react'
import { ChainMark } from '../../../components/ChainMark.tsx'
import { ThemeToggle } from '../../../components/ThemeToggle.tsx'
import type { ChainRow } from '../../../data/chains.ts'
import { explorerAddressUrl } from '../../../data/chains.ts'
import { ChainTag } from '../../../components/ChainTag.tsx'
import { rpcsFor } from '../../../lib/chain'
import { walletConnectEnabled } from '../../../lib/wallet.ts'
import { stocksConfigured } from '../../../lib/prices.ts'
import { BarList } from '../components/charts.tsx'
import { Gauge } from '../components/series-charts.tsx'
import { loadSettings } from '../data/settings.ts'
import type { LabelledBar } from '../data/types.ts'
import { useDapp } from '../state.tsx'

/**
 * The SDK's endpoint target per chain. Five verified public RPCs is the point
 * at which one provider rate-limiting does not degrade the app; below it the
 * chain still fails over, with less room. It is a target, not a cap — nothing
 * in the generated list exceeds it, and `Gauge` would draw an overrun in the
 * error colour if one ever did.
 */
const ENDPOINT_TARGET = 5

function NetworkGroup({
  id,
  label,
  chains,
  net,
  onPick,
}: {
  id: string
  label: string
  chains: readonly ChainRow[]
  net: string
  onPick: (chain: ChainRow) => void
}) {
  return (
    <>
      <p className="dapp-microlabel dapp-microlabel--tight dapp-net-group" id={id}>
        {label} · {chains.length}
      </p>
      <div className="dapp-netgrid" role="group" aria-labelledby={id}>
        {chains.map((chain) => (
          <button
            key={chain.key}
            type="button"
            className={chain.key === net ? 'dapp-netchip is-active' : 'dapp-netchip'}
            aria-pressed={chain.key === net}
            onClick={() => onPick(chain)}
          >
            <ChainMark brand={chain.brand} size={22} className="dapp-netchip__mark" />
            <span className="dapp-netchip__body">
              <span className="dapp-netchip__name">{chain.name}</span>
              <span className="dapp-netchip__id tabular">{chain.chainId}</span>
            </span>
            <span
              className={
                chain.deployed ? 'dapp-badge dapp-badge--ok' : 'dapp-badge dapp-badge--mute'
              }
            >
              {chain.deployed ? 'DEPLOYED' : 'NO DEPLOYMENT'}
            </span>
          </button>
        ))}
      </div>
    </>
  )
}

export default function Settings() {
  const data = useMemo(loadSettings, [])
  const { net, setNet, browsingChain } = useDapp()
  const endpoints = useMemo(() => rpcsFor(browsingChain), [browsingChain])
  const selected = useMemo(
    () => data.networks.find((c) => c.key === net) ?? data.networks[0],
    [data.networks, net],
  )

  /* Ordered worst-first: the reading a reader wants from this is "which chain
     degrades first when a public provider rate-limits me", and that is the top
     of the list, not the bottom. */
  const endpointBars: LabelledBar[] = useMemo(
    () =>
      [...data.networks]
        .sort((a, b) => a.endpointCount - b.endpointCount || a.name.localeCompare(b.name))
        .map((c) => ({
          name: c.name,
          value: String(c.endpointCount),
          pct: Math.min(100, (c.endpointCount / ENDPOINT_TARGET) * 100),
          color: c.singlePointOfFailure ? 'amber' : c.belowTarget ? 'signal' : 'success',
        })),
    [data.networks],
  )

  const deployedNames = data.deployed.map((c) => c.name)

  return (
    <div className="dapp-grid dapp-grid--settings">
      <section className="dapp-card dapp-card--config">
        <h2 className="dapp-card__title dapp-card__title--lg">Preferences</h2>
        <ul className="dapp-prefs">
          {/* Dapp top-bar placement is a follow-up (see ThemeToggle.tsx) — this
              row is the only place to reach it inside the dapp for now. */}
          <li className="dapp-pref">
            <span className="dapp-pref__copy">
              <span className="dapp-pref__name" id="dapp-pref-appearance">
                Appearance
              </span>
              <span className="dapp-pref__hint">Light, dark, or match your OS.</span>
            </span>
            <ThemeToggle showLabels />
          </li>
        </ul>
        <p className="dapp-note">
          The only preference this app keeps. It stores no account and no other setting.
        </p>
      </section>

      <div className="dapp-stack">
        <section className="dapp-card dapp-card--config">
          <h2 className="dapp-microlabel" id="dapp-net-label">
            DEFAULT NETWORK
          </h2>
          <p className="dapp-note">
            {data.networks.length} target chains, each confirmed to support EIP-1153 by a live
            TSTORE probe. {deployedNames.length} of them carry Latch contracts (
            {deployedNames.join(', ')}); selecting any other gives you an RPC, not a deployment.
          </p>

          <NetworkGroup
            id="dapp-net-mainnet"
            label="MAINNET"
            chains={data.mainnets}
            net={net}
            onPick={(chain) => setNet(chain.key)}
          />
          <NetworkGroup
            id="dapp-net-testnet"
            label="TESTNET"
            chains={data.testnets}
            net={net}
            onPick={(chain) => setNet(chain.key)}
          />

          <p className="dapp-microlabel dapp-microlabel--tight" style={{ marginTop: 18 }}>
            VERIFIED PUBLIC RPCS PER CHAIN
          </p>
          <BarList
            items={endpointBars}
            valueLabel="Endpoints"
            shareLabel={`of the ${ENDPOINT_TARGET}-endpoint target`}
          />
          <p className="dapp-note">
            Counted, not estimated: every endpoint answered <code>eth_chainId</code> with the
            expected id and served <code>eth_blockNumber</code> before shipping. A chain below the
            target still fails over, with less headroom when providers rate-limit.
          </p>
        </section>

        {selected ? (
          <section className="dapp-card dapp-card--config" aria-live="polite">
            <h2 className="dapp-microlabel">SELECTED · {selected.name.toUpperCase()}</h2>
            <dl className="dapp-netfacts">
              <div className="dapp-netfact">
                <dt>Chain ID</dt>
                <dd className="tabular">{selected.chainId}</dd>
              </div>
              <div className="dapp-netfact">
                <dt>EIP-1153</dt>
                <dd>{selected.supportsEip1153 ? 'Verified by TSTORE probe' : 'Unsupported'}</dd>
              </div>
            </dl>

            <Gauge
              value={selected.endpointCount}
              max={ENDPOINT_TARGET}
              label={`Verified public RPCs for ${selected.name}`}
              valueText={String(selected.endpointCount)}
              maxText={`${ENDPOINT_TARGET} target`}
              color={
                selected.singlePointOfFailure ? 'amber' : selected.belowTarget ? 'signal' : 'success'
              }
              caption={
                selected.singlePointOfFailure
                  ? 'One endpoint — a fallback transport cannot fail over.'
                  : selected.belowTarget
                    ? 'Fails over, with less headroom than the target.'
                    : 'Verified public RPCs, at the target.'
              }
            />

            {selected.contracts.length > 0 ? (
              <ul className="dapp-contracts">
                {selected.contracts.map((contract) => {
                  const href = explorerAddressUrl(selected.chainId, contract.address)
                  return (
                    <li key={contract.name} className="dapp-contract">
                      <span className="dapp-contract__name">{contract.name}</span>
                      {href ? (
                        <a
                          className="dapp-contract__addr"
                          href={href}
                          rel="noreferrer noopener"
                          data-hit
                          aria-label={`${contract.name} on the ${selected.name} explorer: ${contract.address}`}
                        >
                          {contract.address}
                        </a>
                      ) : (
                        <span className="dapp-contract__addr">{contract.address}</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="dapp-note dapp-note--warn">
                No Latch deployment on {selected.name}. It is a verified target: the SDK can reach
                it, but there are no contracts to call.
              </p>
            )}
          </section>
        ) : null}

        {/* This used to be an API KEY card showing `latch_sk_••••••••••••7f21`
            beside a ROTATE button that called nothing. There is no Latch API and
            no account system — the app is a client-side reader, which the privacy
            policy already states. A fake credential next to a fake action is the
            worst kind of placeholder, because both look real.

            What replaces it is the configuration that genuinely exists: the RPC
            endpoints this build talks to, and the two build-time variables that
            switch real features on. */}
        <section className="dapp-card dapp-card--config">
          <div className="dapp-card__bar">
            <h2 className="dapp-microlabel">RPC ENDPOINTS</h2>
            <ChainTag chainId={browsingChain} size={13} />
          </div>
          <ol className="live-list live-list--ordered">
            {endpoints.map((url, i) => (
              <li key={url}>
                <span className="tabular">{i + 1}.</span>{' '}
                <span className="dapp-apikey__value">{url}</span>
              </li>
            ))}
          </ol>
          <p className="dapp-note">
            Tried in this order. None carries an API key. A rate-limited endpoint falls straight
            through to the next rather than being retried, so one pass asks all of them before any
            is asked twice.
          </p>
        </section>

        <section className="dapp-card dapp-card--config">
          <h2 className="dapp-microlabel">BUILD CONFIGURATION</h2>
          <ul className="live-list">
            <li>
              <span>WalletConnect</span>
              <span className={walletConnectEnabled ? 'dapp-badge dapp-badge--ok' : 'dapp-badge dapp-badge--mute'}>
                {walletConnectEnabled ? 'CONFIGURED' : 'NOT SET'}
              </span>
            </li>
            <li>
              <span>US equity quotes</span>
              <span className={stocksConfigured() ? 'dapp-badge dapp-badge--ok' : 'dapp-badge dapp-badge--mute'}>
                {stocksConfigured() ? 'CONFIGURED' : 'NOT SET'}
              </span>
            </li>
          </ul>
          <p className="dapp-note">
            Read at build time from the environment; neither is required. There is no Latch API key
            — the app reads chain directly and keeps no account.
          </p>
          <details className="dapp-method">
            <summary>What is missing when one is not set</summary>
            <div className="dapp-method__body">
              <p>
                Without a WalletConnect project id the connect modal offers browser wallets only,
                rather than showing rows that cannot complete. Without a Finnhub key the equities
                ticker says it is unconfigured instead of showing a price it does not have.
              </p>
            </div>
          </details>
        </section>
      </div>
    </div>
  )
}
