/* ============================================================================
   Dapp state — the reference's single state object, kept whole.
   README § State management: screen · range · filter · cbs · budget ·
   deploying · deployed · net · flags · block.

   `screen` is derived from the route rather than stored, so the seven screens
   are real URLs; everything else lives here so a filter or a network choice
   survives navigation exactly as it does in the reference.
   ============================================================================ */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import type { ChainKey } from '../../data/chains.ts'
import type { DappState, Filter, Flags, Range, Screen } from './data/types.ts'
import { loadDeploy } from './data/deploy.ts'
import { loadSettings } from './data/settings.ts'
import { readBlockNumber } from '../../lib/chain'

/** README § Interactions: "Block ticker — +1 every 4000ms". */
/* Sepolia produces a block roughly every 12s; polling faster just wastes RPC. */
const BLOCK_POLL_MS = 12000
/** README § Interactions: "Deploy simulation — 2.2s". */
const SIMULATION_MS = 2200

interface DappStore extends Omit<DappState, 'screen'> {
  screen: Screen
  setRange: (range: Range) => void
  setFilter: (filter: Filter) => void
  toggleCallback: (name: string) => void
  setBudget: (budget: number) => void
  simulate: () => void
  resetDeployment: () => void
  setNet: (net: ChainKey) => void
  toggleFlag: (key: keyof Flags) => void
}

const DappContext = createContext<DappStore | null>(null)

export function DappStateProvider({ screen, children }: { screen: Screen; children: ReactNode }) {
  const deployDefaults = useMemo(loadDeploy, [])
  const settingsDefaults = useMemo(loadSettings, [])

  const [range, setRange] = useState<Range>('30D')
  const [filter, setFilter] = useState<Filter>('All')
  const [cbs, setCbs] = useState<string[]>(deployDefaults.defaultCallbacks)
  const [budget, setBudget] = useState<number>(deployDefaults.defaultBudget)
  const [deploying, setDeploying] = useState(false)
  const [deployed, setDeployed] = useState(false)
  const [net, setNet] = useState(settingsDefaults.defaultNetwork)
  const [flags, setFlags] = useState<Flags>(settingsDefaults.defaultFlags)
  const [block, setBlock] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* Real chain head, polled.

     This used to seed a hardcoded 21,904,118 and increment it locally every 4s,
     which produced a confident, monotonic, and entirely invented block height —
     one that sat in the header a few hundred pixels above the live panel showing
     Sepolia's actual height of 11.6M. Two different "block numbers" on one screen,
     only one of them true.

     `reduced` no longer gates this. Motion preferences govern animation, not
     whether the number is real; under `reduce` the value still updates, it just
     never had any business being a 4s tick in the first place. */
  useEffect(() => {
    let off = false
    const tick = () => {
      readBlockNumber()
        .then((b) => !off && setBlock(Number(b)))
        .catch(() => !off && setBlock(null))
    }
    tick()
    const id = setInterval(tick, BLOCK_POLL_MS)
    return () => {
      off = true
      clearInterval(id)
    }
  }, [])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const toggleCallback = useCallback((name: string) => {
    setCbs((prev) => (prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name]))
  }, [])

  const simulate = useCallback(() => {
    setDeploying((busy) => {
      if (busy) return busy
      setDeployed(false)
      timer.current = setTimeout(() => {
        setDeploying(false)
        setDeployed(true)
      }, SIMULATION_MS)
      return true
    })
  }, [])

  /* The reference's `go()` clears the simulation whenever the screen changes. */
  const resetDeployment = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    setDeploying(false)
    setDeployed(false)
  }, [])

  const toggleFlag = useCallback((key: keyof Flags) => {
    setFlags((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const value = useMemo<DappStore>(
    () => ({
      screen,
      range,
      filter,
      cbs,
      budget,
      deploying,
      deployed,
      net,
      flags,
      block,
      setRange,
      setFilter,
      toggleCallback,
      setBudget,
      simulate,
      resetDeployment,
      setNet,
      toggleFlag,
    }),
    [
      screen,
      range,
      filter,
      cbs,
      budget,
      deploying,
      deployed,
      net,
      flags,
      block,
      toggleCallback,
      simulate,
      resetDeployment,
      toggleFlag,
    ],
  )

  return <DappContext.Provider value={value}>{children}</DappContext.Provider>
}

export function useDapp(): DappStore {
  const ctx = useContext(DappContext)
  if (!ctx) throw new Error('useDapp must be used inside <DappStateProvider>')
  return ctx
}
