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
  const { flags, toggleFlag, net, setNet } = useDapp()
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

        <section className="dapp-card dapp-card--config">
          <h2 className="dapp-microlabel">API KEY</h2>
          <div className="dapp-apikey">
            <span className="dapp-apikey__value">{data.apiKey}</span>
            <button type="button" className="dapp-btn dapp-btn--ghost">
              ROTATE
            </button>
          </div>
          <p className="dapp-note">{data.apiNote}</p>
        </section>
      </div>
    </div>
  )
}
