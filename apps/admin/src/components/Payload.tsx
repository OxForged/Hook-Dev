import type { ReactNode } from 'react'
import type { SimulationResult, TxPayload } from '../pages/types.ts'
import { Addr, Chip, CopyButton, KV, Table } from './ui.tsx'

export function SimulationView({ sim, from }: { sim: SimulationResult; from?: string }) {
  const tone = sim.status === 'success' ? 'ok' : sim.status === 'reverted' ? 'high' : 'muted'
  return (
    <div className={`sim sim--${sim.status}`} role="status">
      <div className="sim__head">
        <Chip tone={tone}>eth_call: {sim.status}</Chip>
        {from ? <span className="small muted">simulated from <code>{from}</code>{sim.blockNumber ? ` at block ${sim.blockNumber}` : ''}</span> : null}
      </div>
      {sim.status === 'reverted' && sim.revert ? (
        <p className="small">
          Reverts{sim.revert.name ? <> with <code>{sim.revert.name}({sim.revert.args.join(', ')})</code></> : null}. {sim.revert.message}
        </p>
      ) : null}
      {sim.status === 'unavailable' ? <p className="small muted">Not simulated: {sim.error ?? 'no detail'}. The payload is still exact; simulate it in the Safe app before signing.</p> : null}
      {sim.status === 'success' ? <p className="small muted">The call succeeds against current state. Simulation is not a guarantee: state can change before execution.</p> : null}
    </div>
  )
}

export function PayloadView({ payload, title }: { payload: TxPayload; title: string }) {
  return (
    <section className="payload" aria-label={title}>
      <h3 className="subhead">{title}</h3>
      <p className="small">{payload.description}</p>
      {payload.warnings.length ? (
        <ul className="warnings">
          {payload.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      <KV
        rows={[
          ['Kind', payload.kind === 'safe' ? 'Safe transaction (CALL, operation 0; nonce read by the Safe at signing)' : 'Direct transaction from your own wallet'],
          ...(payload.safe ? ([['Safe', <Addr key="s" value={payload.safe} />]] as [string, ReactNode][]) : []),
          ['To', <span key="t" className="copyrow"><code className="break">{payload.to}</code><CopyButton text={payload.to} /></span>],
          ['Value', <span key="v" className="copyrow"><code>{payload.value}</code> wei<CopyButton text={payload.value} /></span>],
          ...(payload.operation !== undefined ? ([['Operation', <code key="o">{payload.operation} (CALL)</code>]] as [string, ReactNode][]) : []),
          ['Data', <span key="d" className="copyrow copyrow--block"><code className="break data">{payload.data}</code><CopyButton text={payload.data} label="Copy data" /></span>],
          ['Chain', String(payload.chainId)],
        ]}
      />
      {payload.decoded ? (
        <>
          <h4 className="subhead subhead--sm">Decoded: <code>{payload.decoded.signature}</code></h4>
          <Table caption="Decoded arguments">
            <thead><tr><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Value</th></tr></thead>
            <tbody>
              {payload.decoded.args.map((a) => (
                <tr key={a.name}>
                  <td><code>{a.name}</code></td>
                  <td><code>{a.type}</code></td>
                  <td><code className="break">{Array.isArray(a.value) ? `[${a.value.join(', ')}]` : a.value}</code></td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      ) : (
        <p className="state state--unconfigured">Calldata could not be decoded against a known ABI. Do not sign what you cannot read.</p>
      )}
    </section>
  )
}
