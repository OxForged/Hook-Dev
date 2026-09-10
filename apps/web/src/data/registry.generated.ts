/* eslint-disable */
/* ============================================================================
   GENERATED FILE — DO NOT EDIT BY HAND.

   Emitted by apps/web/scripts/sync-registry.mjs from
   packages/registry/src/ILatchHookRegistry.sol and LatchHookRegistry.sol,
   cross-checked bit for bit against packages/sdk/src/hooks/bitmap.ts
   (`CL_HOOK_FLAGS`). Generation FAILS if the two disagree.

   Everything here is contract fact: the bit layout, the masks `classify()`
   branches on, the order the three enums cross the ABI in as `uint8`, and the
   ABI of every read the Hook Explorer performs (reads only — this ABI cannot
   encode a state-changing call).

   Editorial copy — what a bit means for a user's money — is NOT here. It lives
   in src/routes/dapp/data/registry.ts, keyed by the `HookCallback` union
   below, so adding a callback to the contract breaks the build until someone
   writes the sentence explaining it.

   Regenerate with `npm run sync-registry`; `predev` and `prebuild` do it.

   NOTE: presence here means "the contract exists in this repo", NOT "the
   registry is deployed". It is deployed nowhere. See registry.ts.
   ============================================================================ */

/** Every callback the registration bitmap can carry, in bit order. */
export const HOOK_CALLBACKS = [
  'beforeInitialize',
  'afterInitialize',
  'beforeAddLiquidity',
  'afterAddLiquidity',
  'beforeRemoveLiquidity',
  'afterRemoveLiquidity',
  'beforeSwap',
  'afterSwap',
  'beforeDonate',
  'afterDonate',
  'beforeSwapReturnsDelta',
  'afterSwapReturnsDelta',
  'afterAddLiquidityReturnsDelta',
  'afterRemoveLiquidityReturnsDelta',
] as const

export type HookCallback = (typeof HOOK_CALLBACKS)[number]

/** Bit offset of each callback. Mirrors `PERM_*` in ILatchHookRegistry.sol. */
export const HOOK_CALLBACK_BIT: Readonly<Record<HookCallback, number>> = {
  beforeInitialize: 0,
  afterInitialize: 1,
  beforeAddLiquidity: 2,
  afterAddLiquidity: 3,
  beforeRemoveLiquidity: 4,
  afterRemoveLiquidity: 5,
  beforeSwap: 6,
  afterSwap: 7,
  beforeDonate: 8,
  afterDonate: 9,
  beforeSwapReturnsDelta: 10,
  afterSwapReturnsDelta: 11,
  afterAddLiquidityReturnsDelta: 12,
  afterRemoveLiquidityReturnsDelta: 13,
}

/**
 * The masks the contract itself branches on. `classify()`, `takesSwapCut()`,
 * `canBlockSwaps()` and `canTrapLiquidity()` are all expressed in these, so a
 * local mirror built from them cannot disagree with the on-chain answer.
 */
export const PERM = {
  PERM_BEFORE_INITIALIZE: 0x0001,
  PERM_AFTER_INITIALIZE: 0x0002,
  PERM_BEFORE_ADD_LIQUIDITY: 0x0004,
  PERM_AFTER_ADD_LIQUIDITY: 0x0008,
  PERM_BEFORE_REMOVE_LIQUIDITY: 0x0010,
  PERM_AFTER_REMOVE_LIQUIDITY: 0x0020,
  PERM_BEFORE_SWAP: 0x0040,
  PERM_AFTER_SWAP: 0x0080,
  PERM_BEFORE_DONATE: 0x0100,
  PERM_AFTER_DONATE: 0x0200,
  PERM_BEFORE_SWAP_RETURNS_DELTA: 0x0400,
  PERM_AFTER_SWAP_RETURNS_DELTA: 0x0800,
  PERM_AFTER_ADD_LIQUIDITY_RETURNS_DELTA: 0x1000,
  PERM_AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA: 0x2000,
  PERM_RESERVED_BITS: 0xc000,
  PERM_ALL_ASSIGNED: 0x3fff,
  PERM_RETURNS_DELTA_MASK: 0x3c00,
  PERM_SWAP_CUT_MASK: 0x0c00,
  PERM_BEFORE_MASK: 0x0155,
} as const

/** Callbacks covered by each risk-bearing mask. Derived, never hand-listed. */
export const SWAP_CUT_CALLBACKS = ['beforeSwapReturnsDelta', 'afterSwapReturnsDelta'] as const
export const RETURNS_DELTA_CALLBACKS = ['beforeSwapReturnsDelta', 'afterSwapReturnsDelta', 'afterAddLiquidityReturnsDelta', 'afterRemoveLiquidityReturnsDelta'] as const
export const VETO_CALLBACKS = ['beforeInitialize', 'beforeAddLiquidity', 'beforeRemoveLiquidity', 'beforeSwap', 'beforeDonate'] as const

/** `enum Verification` — index is the `uint8` that crosses the ABI. */
export const VERIFICATION_LEVELS = ['Unverified', 'SourceVerified', 'Audited'] as const
export type Verification = (typeof VERIFICATION_LEVELS)[number]

/** `enum Listing`. */
export const LISTING_STATES = ['Active', 'Deprecated', 'Malicious'] as const
export type Listing = (typeof LISTING_STATES)[number]

/** `enum RiskClass` — the output of the contract's pure `classify()`. */
export const RISK_CLASSES = ['Passive', 'Restrictive', 'ValueExtracting'] as const
export type RiskClass = (typeof RISK_CLASSES)[number]

/**
 * Read-only ABI of LatchHookRegistry: every view and pure the explorer calls, the
 * events it reads (`HookListingChanged` carries the tombstone reason string, which
 * exists nowhere in storage), and the custom errors, so a revert decodes to a name.
 * No state-changing function is present — this ABI cannot encode one.
 */
export const REGISTRY_ABI = [
    {
      type: 'function',
      name: 'hookCount',
      inputs: [],
      outputs: [
        {
          name: '',
          type: 'uint256',
          internalType: 'uint256'
        }
      ],
      stateMutability: 'view'
    },
    {
      type: 'function',
      name: 'hookAt',
      inputs: [
        {
          name: 'index',
          type: 'uint256',
          internalType: 'uint256'
        }
      ],
      outputs: [
        {
          name: '',
          type: 'address',
          internalType: 'address'
        }
      ],
      stateMutability: 'view'
    },
    {
      type: 'function',
      name: 'listHooks',
      inputs: [
        {
          name: 'offset',
          type: 'uint256',
          internalType: 'uint256'
        },
        {
          name: 'limit',
          type: 'uint256',
          internalType: 'uint256'
        }
      ],
      outputs: [
        {
          name: '',
          type: 'address[]',
          internalType: 'address[]'
        }
      ],
      stateMutability: 'view'
    },
    {
      type: 'function',
      name: 'getHook',
      inputs: [
        {
          name: 'hook',
          type: 'address',
          internalType: 'address'
        }
      ],
      outputs: [
        {
          name: '',
          type: 'tuple',
          internalType: 'struct HookRecord',
          components: [
            {
              name: 'submitter',
              type: 'address',
              internalType: 'address'
            },
            {
              name: 'submittedAt',
              type: 'uint64',
              internalType: 'uint64'
            },
            {
              name: 'permissions',
              type: 'uint16',
              internalType: 'uint16'
            },
            {
              name: 'verification',
              type: 'uint8',
              internalType: 'enum Verification'
            },
            {
              name: 'listing',
              type: 'uint8',
              internalType: 'enum Listing'
            },
            {
              name: 'steward',
              type: 'address',
              internalType: 'address'
            },
            {
              name: 'updatedAt',
              type: 'uint64',
              internalType: 'uint64'
            },
            {
              name: 'permissionsValid',
              type: 'bool',
              internalType: 'bool'
            },
            {
              name: 'permissionsReadable',
              type: 'bool',
              internalType: 'bool'
            },
            {
              name: 'codehash',
              type: 'bytes32',
              internalType: 'bytes32'
            },
            {
              name: 'metadata',
              type: 'tuple',
              internalType: 'struct HookMetadata',
              components: [
                {
                  name: 'name',
                  type: 'string',
                  internalType: 'string'
                },
                {
                  name: 'description',
                  type: 'string',
                  internalType: 'string'
                },
                {
                  name: 'sourceURI',
                  type: 'string',
                  internalType: 'string'
                },
                {
                  name: 'auditURI',
                  type: 'string',
                  internalType: 'string'
                },
                {
                  name: 'chainIds',
                  type: 'uint256[]',
                  internalType: 'uint256[]'
                }
              ]
            }
          ]
        }
      ],
      stateMutability: 'view'
    },
    {
      type: 'function',
      name: 'permissionsOf',
      inputs: [
        {
          name: 'hook',
          type: 'address',
          internalType: 'address'
        }
      ],
      outputs: [
        {
          name: 'permissions',
          type: 'uint16',
          internalType: 'uint16'
        },
        {
          name: 'readable',
          type: 'bool',
          internalType: 'bool'
        },
        {
          name: 'valid',
          type: 'bool',
          internalType: 'bool'
        }
      ],
      stateMutability: 'view'
    },
    {
      type: 'function',
      name: 'statusOf',
      inputs: [
        {
          name: 'hook',
          type: 'address',
          internalType: 'address'
        }
      ],
      outputs: [
        {
          name: 'verification',
          type: 'uint8',
          internalType: 'enum Verification'
        },
        {
          name: 'listing',
          type: 'uint8',
          internalType: 'enum Listing'
        }
      ],
      stateMutability: 'view'
    },
    {
      type: 'function',
      name: 'riskClassOf',
      inputs: [
        {
          name: 'hook',
          type: 'address',
          internalType: 'address'
        }
      ],
      outputs: [
        {
          name: '',
          type: 'uint8',
          internalType: 'enum RiskClass'
        }
      ],
      stateMutability: 'view'
    },
    {
      type: 'function',
      name: 'isAudited',
      inputs: [
        {
          name: 'hook',
          type: 'address',
          internalType: 'address'
        }
      ],
      outputs: [
        {
          name: '',
          type: 'bool',
          internalType: 'bool'
        }
      ],
      stateMutability: 'view'
    },
    {
      type: 'function',
      name: 'isRegistered',
      inputs: [
        {
          name: 'hook',
          type: 'address',
          internalType: 'address'
        }
      ],
      outputs: [
        {
          name: '',
          type: 'bool',
          internalType: 'bool'
        }
      ],
      stateMutability: 'view'
    },
    {
      type: 'function',
      name: 'classify',
      inputs: [
        {
          name: 'permissions',
          type: 'uint16',
          internalType: 'uint16'
        }
      ],
      outputs: [
        {
          name: '',
          type: 'uint8',
          internalType: 'enum RiskClass'
        }
      ],
      stateMutability: 'pure'
    },
    {
      type: 'function',
      name: 'decodePermissions',
      inputs: [
        {
          name: 'p',
          type: 'uint16',
          internalType: 'uint16'
        }
      ],
      outputs: [
        {
          name: 'd',
          type: 'tuple',
          internalType: 'struct DecodedPermissions',
          components: [
            {
              name: 'beforeInitialize',
              type: 'bool',
              internalType: 'bool'
            },
            {
              name: 'afterInitialize',
              type: 'bool',
              internalType: 'bool'
            },
            {
              name: 'beforeAddLiquidity',
              type: 'bool',
              internalType: 'bool'
            },
            {
              name: 'afterAddLiquidity',
              type: 'bool',
              internalType: 'bool'
            },
            {
              name: 'beforeRemoveLiquidity',
              type: 'bool',
              internalType: 'bool'
            },
            {
              name: 'afterRemoveLiquidity',
              type: 'bool',
              internalType: 'bool'
            },
            {
              name: 'beforeSwap',
              type: 'bool',
              internalType: 'bool'
            },
            {
              name: 'afterSwap',
              type: 'bool',
              internalType: 'bool'
            },
            {
              name: 'beforeDonate',
              type: 'bool',
              internalType: 'bool'
            },
            {
              name: 'afterDonate',
              type: 'bool',
              internalType: 'bool'
            },
            {
              name: 'beforeSwapReturnsDelta',
              type: 'bool',
              internalType: 'bool'
            },
            {
              name: 'afterSwapReturnsDelta',
              type: 'bool',
              internalType: 'bool'
            },
            {
              name: 'afterAddLiquidityReturnsDelta',
              type: 'bool',
              internalType: 'bool'
            },
            {
              name: 'afterRemoveLiquidityReturnsDelta',
              type: 'bool',
              internalType: 'bool'
            }
          ]
        }
      ],
      stateMutability: 'pure'
    },
    {
      type: 'function',
      name: 'takesSwapCut',
      inputs: [
        {
          name: 'permissions',
          type: 'uint16',
          internalType: 'uint16'
        }
      ],
      outputs: [
        {
          name: '',
          type: 'bool',
          internalType: 'bool'
        }
      ],
      stateMutability: 'pure'
    },
    {
      type: 'function',
      name: 'returnsDelta',
      inputs: [
        {
          name: 'permissions',
          type: 'uint16',
          internalType: 'uint16'
        }
      ],
      outputs: [
        {
          name: '',
          type: 'bool',
          internalType: 'bool'
        }
      ],
      stateMutability: 'pure'
    },
    {
      type: 'function',
      name: 'canBlockSwaps',
      inputs: [
        {
          name: 'permissions',
          type: 'uint16',
          internalType: 'uint16'
        }
      ],
      outputs: [
        {
          name: '',
          type: 'bool',
          internalType: 'bool'
        }
      ],
      stateMutability: 'pure'
    },
    {
      type: 'function',
      name: 'canTrapLiquidity',
      inputs: [
        {
          name: 'permissions',
          type: 'uint16',
          internalType: 'uint16'
        }
      ],
      outputs: [
        {
          name: '',
          type: 'bool',
          internalType: 'bool'
        }
      ],
      stateMutability: 'pure'
    },
    {
      type: 'function',
      name: 'isValidBitmap',
      inputs: [
        {
          name: 'permissions',
          type: 'uint16',
          internalType: 'uint16'
        }
      ],
      outputs: [
        {
          name: '',
          type: 'bool',
          internalType: 'bool'
        }
      ],
      stateMutability: 'pure'
    },
    {
      type: 'event',
      name: 'HookRegistered',
      inputs: [
        {
          name: 'hook',
          type: 'address',
          internalType: 'address',
          indexed: true
        },
        {
          name: 'submitter',
          type: 'address',
          internalType: 'address',
          indexed: true
        },
        {
          name: 'permissions',
          type: 'uint16',
          internalType: 'uint16'
        },
        {
          name: 'riskClass',
          type: 'uint8',
          internalType: 'enum RiskClass'
        },
        {
          name: 'codehash',
          type: 'bytes32',
          internalType: 'bytes32'
        },
        {
          name: 'timestamp',
          type: 'uint64',
          internalType: 'uint64'
        }
      ],
      anonymous: false
    },
    {
      type: 'event',
      name: 'HookMetadataUpdated',
      inputs: [
        {
          name: 'hook',
          type: 'address',
          internalType: 'address',
          indexed: true
        },
        {
          name: 'updater',
          type: 'address',
          internalType: 'address',
          indexed: true
        },
        {
          name: 'name',
          type: 'string',
          internalType: 'string'
        },
        {
          name: 'description',
          type: 'string',
          internalType: 'string'
        },
        {
          name: 'sourceURI',
          type: 'string',
          internalType: 'string'
        },
        {
          name: 'auditURI',
          type: 'string',
          internalType: 'string'
        },
        {
          name: 'chainIds',
          type: 'uint256[]',
          internalType: 'uint256[]'
        }
      ],
      anonymous: false
    },
    {
      type: 'event',
      name: 'HookVerificationChanged',
      inputs: [
        {
          name: 'hook',
          type: 'address',
          internalType: 'address',
          indexed: true
        },
        {
          name: 'actor',
          type: 'address',
          internalType: 'address',
          indexed: true
        },
        {
          name: 'previous',
          type: 'uint8',
          internalType: 'enum Verification'
        },
        {
          name: 'current',
          type: 'uint8',
          internalType: 'enum Verification'
        },
        {
          name: 'note',
          type: 'string',
          internalType: 'string'
        }
      ],
      anonymous: false
    },
    {
      type: 'event',
      name: 'HookListingChanged',
      inputs: [
        {
          name: 'hook',
          type: 'address',
          internalType: 'address',
          indexed: true
        },
        {
          name: 'actor',
          type: 'address',
          internalType: 'address',
          indexed: true
        },
        {
          name: 'previous',
          type: 'uint8',
          internalType: 'enum Listing'
        },
        {
          name: 'current',
          type: 'uint8',
          internalType: 'enum Listing'
        },
        {
          name: 'reason',
          type: 'string',
          internalType: 'string'
        }
      ],
      anonymous: false
    },
    {
      type: 'event',
      name: 'HookStewardTransferred',
      inputs: [
        {
          name: 'hook',
          type: 'address',
          internalType: 'address',
          indexed: true
        },
        {
          name: 'previous',
          type: 'address',
          internalType: 'address',
          indexed: true
        },
        {
          name: 'current',
          type: 'address',
          internalType: 'address',
          indexed: true
        }
      ],
      anonymous: false
    },
    {
      type: 'event',
      name: 'HookPermissionsRefreshed',
      inputs: [
        {
          name: 'hook',
          type: 'address',
          internalType: 'address',
          indexed: true
        },
        {
          name: 'actor',
          type: 'address',
          internalType: 'address',
          indexed: true
        },
        {
          name: 'previousPermissions',
          type: 'uint16',
          internalType: 'uint16'
        },
        {
          name: 'currentPermissions',
          type: 'uint16',
          internalType: 'uint16'
        },
        {
          name: 'previousCodehash',
          type: 'bytes32',
          internalType: 'bytes32'
        },
        {
          name: 'currentCodehash',
          type: 'bytes32',
          internalType: 'bytes32'
        },
        {
          name: 'readable',
          type: 'bool',
          internalType: 'bool'
        },
        {
          name: 'valid',
          type: 'bool',
          internalType: 'bool'
        }
      ],
      anonymous: false
    },
    {
      type: 'error',
      name: 'ZeroAddress',
      inputs: []
    },
    {
      type: 'error',
      name: 'HookAlreadyRegistered',
      inputs: [
        {
          name: 'hook',
          type: 'address',
          internalType: 'address'
        }
      ]
    },
    {
      type: 'error',
      name: 'HookNotRegistered',
      inputs: [
        {
          name: 'hook',
          type: 'address',
          internalType: 'address'
        }
      ]
    },
    {
      type: 'error',
      name: 'HookHasNoCode',
      inputs: [
        {
          name: 'hook',
          type: 'address',
          internalType: 'address'
        }
      ]
    },
    {
      type: 'error',
      name: 'PermissionsUnreadable',
      inputs: [
        {
          name: 'hook',
          type: 'address',
          internalType: 'address'
        }
      ]
    },
    {
      type: 'error',
      name: 'ReservedBitsSet',
      inputs: [
        {
          name: 'permissions',
          type: 'uint16',
          internalType: 'uint16'
        }
      ]
    },
    {
      type: 'error',
      name: 'PermissionDependencyMissing',
      inputs: [
        {
          name: 'permissions',
          type: 'uint16',
          internalType: 'uint16'
        }
      ]
    },
    {
      type: 'error',
      name: 'InsufficientGasForProbe',
      inputs: [
        {
          name: 'available',
          type: 'uint256',
          internalType: 'uint256'
        },
        {
          name: 'required',
          type: 'uint256',
          internalType: 'uint256'
        }
      ]
    },
    {
      type: 'error',
      name: 'NotSteward',
      inputs: [
        {
          name: 'hook',
          type: 'address',
          internalType: 'address'
        },
        {
          name: 'caller',
          type: 'address',
          internalType: 'address'
        }
      ]
    },
    {
      type: 'error',
      name: 'NotCuratorOrGuardian',
      inputs: [
        {
          name: 'caller',
          type: 'address',
          internalType: 'address'
        }
      ]
    },
    {
      type: 'error',
      name: 'GuardianCannotRelist',
      inputs: [
        {
          name: 'current',
          type: 'uint8',
          internalType: 'enum Listing'
        },
        {
          name: 'attempted',
          type: 'uint8',
          internalType: 'enum Listing'
        }
      ]
    },
    {
      type: 'error',
      name: 'HookFlaggedMalicious',
      inputs: [
        {
          name: 'hook',
          type: 'address',
          internalType: 'address'
        }
      ]
    },
    {
      type: 'error',
      name: 'PermissionsNotAttestable',
      inputs: [
        {
          name: 'hook',
          type: 'address',
          internalType: 'address'
        }
      ]
    },
    {
      type: 'error',
      name: 'AuditURIRequired',
      inputs: []
    },
    {
      type: 'error',
      name: 'SourceURIRequired',
      inputs: []
    },
    {
      type: 'error',
      name: 'PermissionsUnchanged',
      inputs: [
        {
          name: 'hook',
          type: 'address',
          internalType: 'address'
        }
      ]
    },
    {
      type: 'error',
      name: 'StringTooLong',
      inputs: [
        {
          name: 'length',
          type: 'uint256',
          internalType: 'uint256'
        },
        {
          name: 'maximum',
          type: 'uint256',
          internalType: 'uint256'
        }
      ]
    },
    {
      type: 'error',
      name: 'EmptyName',
      inputs: []
    },
    {
      type: 'error',
      name: 'TooManyChains',
      inputs: [
        {
          name: 'count',
          type: 'uint256',
          internalType: 'uint256'
        },
        {
          name: 'maximum',
          type: 'uint256',
          internalType: 'uint256'
        }
      ]
    },
    {
      type: 'error',
      name: 'InvalidRange',
      inputs: []
    }
  ] as const
