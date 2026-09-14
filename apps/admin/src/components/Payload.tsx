import type { ReactNode } from 'react'
import type { ConversionInnerCall, SimulationResult, TxPayload } from '../pages/types.ts'
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

export function PayloadView({ payload, title }: { payload: TxPayload & { innerCalls?: ConversionInnerCall[] }; title: string }) {
  const delegate = payload.operation === 1
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
          ['Kind', payload.kind === 'safe' ? (delegate ? 'Safe transaction (DELEGATECALL into MultiSendCallOnly, operation 1; nonce read by the Safe at signing)' : 'Safe transaction (CALL, operation 0; nonce read by the Safe at signing)') : 'Direct transaction from your own wallet'],
          ...(payload.safe ? ([['Safe', <Addr key="s" value={payload.safe} />]] as [string, ReactNode][]) : []),
          ['To', <span key="t" className="copyrow"><code className="break">{payload.to}</code><CopyButton text={payload.to} /></span>],
          ['Value', <span key="v" className="copyrow"><code>{payload.value}</code> wei<CopyButton text={payload.value} /></span>],
          ...(payload.operation !== undefined ? ([['Operation', <code key="o">{payload.operation} ({delegate ? 'DELEGATECALL' : 'CALL'})</code>]] as [string, ReactNode][]) : []),
          ['Data', <span key="d" className="copyrow copyrow--block"><code className="break data">{payload.data}</code><CopyButton text={payload.data} label="Copy data" /></span>],
          ['Chain', String(payload.chainId)],
        ]}
      />
      {payload.decoded && payload.innerCalls?.length ? (
        <h4 className="subhead subhead--sm">Decoded: <code>{payload.decoded.signature}</code>, the packed batch below</h4>
      ) : payload.decoded ? (
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
      {payload.innerCalls?.length ? <InnerCalls calls={payload.innerCalls} /> : null}
    </section>
  )
}

/** The batch, decoded from the MultiSend calldata by the API (not echoed from its inputs). */
function InnerCalls({ calls }: { calls: ConversionInnerCall[] }) {
  return (
    <div className="stack stack--tight">
      <h4 className="subhead subhead--sm">Inside the batch: {calls.length} calls, each a CALL from the Safe, all or nothing</h4>
      <ol className="inner-calls">
        {calls.map((c) => (
          <li key={c.index} className="inner-call">
            <p className="small">
              <strong>{c.index}.</strong> {c.label}
            </p>
            <KV
              rows={[
                ['To', <span key="t" className="copyrow"><code className="break">{c.to}</code><CopyButton text={c.to} /></span>],
                ['Value', <code key="v">{c.value} wei</code>],
                ['Call', c.decoded ? <code key="s">{c.decoded.signature}</code> : <span key="s" className="state state--unconfigured">not decoded: do not sign</span>],
              ]}
            />
            {c.decoded && !c.router ? (
              <Table caption={`Call ${c.index} arguments`}>
                <thead><tr><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Value</th></tr></thead>
                <tbody>
                  {c.decoded.args.map((a) => (
                    <tr key={a.name}><td><code>{a.name}</code></td><td><code>{a.type}</code></td><td><code className="break">{Array.isArray(a.value) ? `[${a.value.join(', ')}]` : a.value}</code></td></tr>
                  ))}
                </tbody>
              </Table>
            ) : null}
            {c.router ? (
              <div className="router-plan">
                <p className="small">Router deadline (unix seconds) <code>{c.router.deadline ?? 'none'}</code></p>
                {c.router.steps.map((s, i) => (
                  <div key={i} className="router-step">
                    <p className="small"><code>{s.commandByte}</code> <strong>{s.command}</strong></p>
                    {s.params ? <pre className="json json--wide">{JSON.stringify(s.params, null, 2)}</pre> : null}
                    {s.actions?.map((a, j) => (
                      <details key={j} open={j === 0}>
                        <summary><code>{a.actionByte}</code> {a.action}</summary>
                        <pre className="json json--wide">{JSON.stringify(a.params, null, 2)}</pre>
                      </details>
                    ))}
                  </div>
                ))}
              </div>
            ) : null}
            <details>
              <summary>Raw calldata</summary>
              <span className="copyrow copyrow--block"><code className="break data">{c.data}</code><CopyButton text={c.data} label="Copy data" /></span>
            </details>
          </li>
        ))}
      </ol>
    </div>
  )
}
