/* ============================================================================
   Register a Latch — screen data.

   THIS IS NO LONGER A MOCK SEAM. The screen it backs signs a real
   `LatchRegistry.register` transaction on whichever chain the build serves —
   the registry is deployed on more than one, and its address and chain name
   both come from the deployment table, never from a literal here. (It was
   `LatchHookRegistry` until the 2026-09-10 rename; the old contract is still
   deployed and still answers `hookCount()`, so the stale name in copy pointed
   authors at a registry nothing reads.) Everything the user is shown about
   their Latch — its permission bitmap, its capability class, whether the
   registry will accept it — is read off chain by `../lib/registryWrite.ts` and
   never fabricated here.

   What remains in this module is the parts that genuinely are static screen
   copy: the four step labels and the shape of the pre-flight list. The verdicts
   filling that list are passed in; this file cannot invent one.
   ============================================================================ */

export interface DeployStep {
  n: string
  name: string
  hint: string
}

/** A pre-flight row. `state` is tri-valued because "not yet known" is a real answer. */
export type CheckState = 'ok' | 'fail' | 'pending' | 'idle'

export interface PreflightCheck {
  name: string
  value: string
  state: CheckState
}

export interface DeployData {
  steps: DeployStep[]
  /*  ------------------------------------------------------------------------
      Legacy state defaults.

      `routes/dapp/state.tsx` still seeds its `cbs` and `budget` fields from
      here. Those belonged to the old mock flow's callback chips and gas-budget
      slider, both of which are gone from this screen: a submitter does not
      choose a Latch's callbacks, the Latch's own bytecode does, and the registry
      reads them rather than being told. They are kept only so the shared store
      keeps compiling; nothing on this screen reads them.
      ------------------------------------------------------------------------ */
  defaultCallbacks: string[]
  defaultBudget: number
}

export function loadDeploy(): DeployData {
  return {
    steps: [
      { n: '1', name: 'Latch contract', hint: 'deployed address' },
      { n: '2', name: 'Listing', hint: 'name + links' },
      { n: '3', name: 'Pre-flight', hint: 'simulate register()' },
      { n: '4', name: 'Register', hint: 'sign + confirm' },
    ],
    defaultCallbacks: [],
    defaultBudget: 24,
  }
}

export const DOT_BY_STATE: Record<CheckState, string> = {
  ok: 'dapp-dot dapp-dot--success dapp-dot--lg',
  fail: 'dapp-dot dapp-dot--error dapp-dot--lg',
  pending: 'dapp-dot dapp-dot--primary dapp-dot--lg dapp-dot--pulse',
  idle: 'dapp-dot dapp-dot--lg dapp-dot--flat',
}
