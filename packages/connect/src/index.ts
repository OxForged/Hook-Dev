/* ============================================================================
   @latchprotocol/connect — public surface.

   Everything an integrator may import from the package root is listed here by
   name. Nothing is `export *`-ed: the surface of an MIT package that sits on
   the GPL boundary should be auditable at a glance, and a name that is not on
   this list is internal and may change without notice.

   Subpath entries (`./chains`, `./theme`) re-export the same symbols for apps
   that want the chain list or the theme without pulling React into a bundle.
   ============================================================================ */

/* ---------------------------------------------------------------- components */

export { LatchWalletProvider } from './components/LatchWalletProvider.js'
export type { LatchWalletProviderProps } from './components/LatchWalletProvider.js'

export { LatchConnectButton } from './components/LatchConnectButton.js'
export type { LatchConnectButtonProps } from './components/LatchConnectButton.js'

export { LatchChainSwitcher } from './components/LatchChainSwitcher.js'
export type { LatchChainSwitcherProps } from './components/LatchChainSwitcher.js'

/* -------------------------------------------------------------------- config */

export { createLatchConfig, hasWalletConnect } from './config/createLatchConfig.js'
export type { CreateLatchConfigOptions } from './config/createLatchConfig.js'

export { WALLETCONNECT_PROJECT_ID_ENV, walletConnectProjectId } from './config/env.js'

/* -------------------------------------------------------------------- chains */

export {
  /* wagmi-curated */
  base,
  bsc,
  mainnet,
  sepolia,
  /* defined in this package */
  arcTestnet,
  hyperEvm,
  monad,
  monadTestnet,
  plasma,
  stable,
  stableTestnet,
  /* lists */
  LATCH_CHAINS,
  LATCH_MAINNET_CHAINS,
  LATCH_TESTNET_CHAINS,
  LATCH_DEPLOYED_CHAIN_IDS,
  LATCH_DEFAULT_CHAIN,
  /* audit surface */
  SINGLE_ENDPOINT_CHAIN_IDS,
  UNVERIFIED_CHAIN_METADATA,
  /* helpers */
  isLatchDeployedChain,
  latchChainById,
} from './chains/index.js'

/* --------------------------------------------------------------------- theme */

export { latchTheme, LATCH_THEME } from './theme/index.js'
export type { LatchThemeOptions, Theme } from './theme/index.js'
export {
  LATCH_COLORS,
  LATCH_EASE,
  LATCH_FONTS,
  LATCH_RADII,
  LATCH_SCRIM,
  LATCH_SHADOWS,
} from './theme/index.js'
