/* Settings — SCREENS.md § C7.

   The network picker is no longer a list of plausible-sounding chain names. It
   is the SDK's own target list (src/data/chains.ts, generated from
   packages/sdk/src/chains/endpoints.ts), and each chip states whether Latch is
   actually deployed there. Ten of the eleven are targets with no contracts;
   showing them as selectable without saying so would be a lie. */

import { useMemo } from 'react'
import { ChainMark } from '../../../components/ChainMark.tsx'
import type { ChainRow } from '../../../data/chains.ts'
import { explorerAddressUrl } from '../../../data/chains.ts'
import { ChainTag } from '../../../components/ChainTag.tsx'
import { rpcsFor } from '../../../lib/chain'
import { walletConnectEnabled } from '../../../lib/wallet.ts'
import { stocksConfigured } from '../../../lib/prices.ts'
import { loadSettings } from '../data/settings.ts'
import { useDapp } from '../state.tsx'

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
  const { flags, toggleFlag, net, setNet, browsingChain } = useDapp()
  const endpoints = useMemo(() => rpcsFor(browsingChain), [browsingChain])
  const selected = useMemo(
    () => data.networks.find((c) => c.key === net) ?? data.networks[0],
    [data.networks, net],
  )

  return (
    <div className="dapp-grid dapp-grid--settings">
      <section className="dapp-card dapp-card--config">
        <h2 className="dapp-card__title dapp-card__title--lg">Preferences</h2>
        <ul className="dapp-prefs">
          {data.toggles.map((t) => (
            <li key={t.key} className="dapp-pref">
              <span className="dapp-pref__copy">
                <span className="dapp-pref__name" id={`dapp-pref-${t.key}`}>
                  {t.name}
                </span>
                <span className="dapp-pref__hint">{t.hint}</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={flags[t.key]}
                aria-labelledby={`dapp-pref-${t.key}`}
                className={flags[t.key] ? 'dapp-toggle is-on' : 'dapp-toggle'}
                onClick={() => toggleFlag(t.key)}
              >
                <span className="dapp-toggle__knob" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <div className="dapp-stack">
        <section className="dapp-card dapp-card--config">
          <h2 className="dapp-microlabel" id="dapp-net-label">
            DEFAULT NETWORK
          </h2>
          <p className="dapp-note">
            {data.networks.length} target chains, each confirmed to support EIP-1153 by a live
            TSTORE probe. Latch contracts exist on Ethereum Sepolia only — the rest are targets,
            so selecting one gives you an RPC, not a deployment.
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
              <div className="dapp-netfact">
                <dt>Verified public RPCs</dt>
                <dd className="tabular">
                  {selected.endpointCount}
                  {selected.singlePointOfFailure
                    ? ' · no failover'
                    : selected.belowTarget
                      ? ' · below the 5-endpoint target'
                      : ''}
                </dd>
              </div>
            </dl>

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
                          aria-label={`${contract.name} on Sepolia Etherscan: ${contract.address}`}
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
            Tried in this order. Each is probed before shipping — it answered{' '}
            <code>eth_chainId</code> with the expected id and served{' '}
            <code>eth_blockNumber</code>. A rate-limited endpoint falls straight through to the
            next rather than being retried, so one pass asks all of them before any is asked
            twice. None carries an API key.
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
            Both are read at build time from the environment and neither is required.
            Without a WalletConnect project id the connect modal offers browser wallets only,
            rather than showing rows that cannot complete. Without a Finnhub key the equities
            ticker says it is unconfigured instead of showing a price it does not have.
          </p>
          <p className="dapp-note">
            There is no Latch API key. The app reads chain directly and keeps no account.
          </p>
        </section>
      </div>
    </div>
  )
}
