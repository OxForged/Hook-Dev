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
import type { DappState, Filter, Flags, Range, Screen } from './data/types.ts'
import { loadDeploy } from './data/deploy.ts'
import { loadSettings } from './data/settings.ts'
import { loadShell } from './data/shell.ts'
import { useReducedMotion } from './lib/motion.ts'

/** README § Interactions: "Block ticker — +1 every 4000ms". */
const BLOCK_INTERVAL = 4000
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
  setNet: (net: string) => void
  toggleFlag: (key: keyof Flags) => void
}

const DappContext = createContext<DappStore | null>(null)

export function DappStateProvider({ screen, children }: { screen: Screen; children: ReactNode }) {
  const deployDefaults = useMemo(loadDeploy, [])
  const settingsDefaults = useMemo(loadSettings, [])
  const shell = useMemo(loadShell, [])
  const reduced = useReducedMotion()

  const [range, setRange] = useState<Range>('30D')
  const [filter, setFilter] = useState<Filter>('All')
  const [cbs, setCbs] = useState<string[]>(deployDefaults.defaultCallbacks)
  const [budget, setBudget] = useState<number>(deployDefaults.defaultBudget)
  const [deploying, setDeploying] = useState(false)
  const [deployed, setDeployed] = useState(false)
  const [net, setNet] = useState(settingsDefaults.defaultNetwork)
  const [flags, setFlags] = useState<Flags>(settingsDefaults.defaultFlags)
  const [block, setBlock] = useState(shell.block)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* Live block ticker. JS-driven, so it carries its own reduced-motion guard:
     under `reduce` the height stays put instead of animating on a timer. */
  useEffect(() => {
    if (reduced) return
    const id = setInterval(() => setBlock((b) => b + 1), BLOCK_INTERVAL)
    return () => clearInterval(id)
  }, [reduced])

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
