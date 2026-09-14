// SPDX-License-Identifier: MIT
// -----------------------------------------------------------------------------
// GENERATED FILE - DO NOT EDIT BY HAND.
// Produced by scripts/generate-launchpad-abi.mjs from the compiled contract ABIs.
// Re-run `npm run generate` after the contracts are rebuilt.
// -----------------------------------------------------------------------------

import type { Abi } from "viem";

/**
 * `LaunchpadKit` - the one-call launch factory.
 *
 * 25 errors, 4 events, 14 functions - curated from the compiled artifact, not the full ABI.
 */
export const LAUNCHPAD_KIT_ABI = [
  {
    "type": "error",
    "name": "AddressEmptyCode",
    "inputs": [
      {
        "name": "target",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "AddressInsufficientBalance",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "FailedInnerCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "HookClockMismatch",
    "inputs": [
      {
        "name": "hookClockMode",
        "type": "string",
        "internalType": "string"
      }
    ]
  },
  {
    "type": "error",
    "name": "HookPoolManagerMismatch",
    "inputs": [
      {
        "name": "expected",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "actual",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "IdenticalCurrencies",
    "inputs": [
      {
        "name": "currency",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidTick",
    "inputs": [
      {
        "name": "tick",
        "type": "int24",
        "internalType": "int24"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidTickRange",
    "inputs": [
      {
        "name": "tickLower",
        "type": "int24",
        "internalType": "int24"
      },
      {
        "name": "tickUpper",
        "type": "int24",
        "internalType": "int24"
      }
    ]
  },
  {
    "type": "error",
    "name": "LaunchAlreadyExists",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      }
    ]
  },
  {
    "type": "error",
    "name": "LaunchTokenCannotBeNative",
    "inputs": []
  },
  {
    "type": "error",
    "name": "LaunchTokenHasNoCode",
    "inputs": [
      {
        "name": "launchToken",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "MaxBuyRequiredByPreset",
    "inputs": [
      {
        "name": "preset",
        "type": "uint8",
        "internalType": "enum Preset"
      }
    ]
  },
  {
    "type": "error",
    "name": "NativeValueMismatch",
    "inputs": [
      {
        "name": "expected",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "actual",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "NoParametersForCustomPreset",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotLaunchOperator",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      },
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "RegistryNotConfigured",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeCastOverflow",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeERC20FailedOperation",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "SeedProducesNoLiquidity",
    "inputs": []
  },
  {
    "type": "error",
    "name": "StartDelayTooLong",
    "inputs": [
      {
        "name": "delaySeconds",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnexpectedHookBitmap",
    "inputs": [
      {
        "name": "expected",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "actual",
        "type": "uint16",
        "internalType": "uint16"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnexpectedNativeValue",
    "inputs": [
      {
        "name": "value",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnknownLaunch",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      }
    ]
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  },
  {
    "type": "event",
    "name": "HookListed",
    "inputs": [
      {
        "name": "hook",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "steward",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "LaunchCreated",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "PoolId"
      },
      {
        "name": "launchToken",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "operator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "quoteToken",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "startTime",
        "type": "uint40",
        "indexed": false,
        "internalType": "uint40"
      },
      {
        "name": "decaySeconds",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "initialFeeBips",
        "type": "uint24",
        "indexed": false,
        "internalType": "uint24"
      },
      {
        "name": "finalFeeBips",
        "type": "uint24",
        "indexed": false,
        "internalType": "uint24"
      },
      {
        "name": "maxBuyPerTx",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      },
      {
        "name": "launchTokenIsCurrency0",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "preset",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum Preset"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "LaunchReconfigured",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "PoolId"
      },
      {
        "name": "operator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "startTime",
        "type": "uint40",
        "indexed": false,
        "internalType": "uint40"
      },
      {
        "name": "decaySeconds",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "initialFeeBips",
        "type": "uint24",
        "indexed": false,
        "internalType": "uint24"
      },
      {
        "name": "finalFeeBips",
        "type": "uint24",
        "indexed": false,
        "internalType": "uint24"
      },
      {
        "name": "maxBuyPerTx",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      },
      {
        "name": "enabled",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "LaunchSeeded",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "PoolId"
      },
      {
        "name": "positionTokenId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "positionRecipient",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "liquidity",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      },
      {
        "name": "amount0Spent",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "amount1Spent",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "function",
    "name": "CLOCK_MODE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "EXPECTED_HOOK_BITMAP",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "clPoolManager",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract ICLPoolManager"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "computePoolKey",
    "inputs": [
      {
        "name": "launchToken",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "quoteToken",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "tickSpacing",
        "type": "int24",
        "internalType": "int24"
      }
    ],
    "outputs": [
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          },
          {
            "name": "poolManager",
            "type": "address",
            "internalType": "contract IPoolManager"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "parameters",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      },
      {
        "name": "launchTokenIsCurrency0",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "createLaunch",
    "inputs": [
      {
        "name": "p",
        "type": "tuple",
        "internalType": "struct LaunchParams",
        "components": [
          {
            "name": "launchToken",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "quoteToken",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "sqrtPriceX96",
            "type": "uint160",
            "internalType": "uint160"
          },
          {
            "name": "preset",
            "type": "uint8",
            "internalType": "enum Preset"
          },
          {
            "name": "initialFeeBips",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "finalFeeBips",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "decaySeconds",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "enabled",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "startDelaySeconds",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "maxBuyPerTx",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "launchOperator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "seed",
            "type": "tuple",
            "internalType": "struct SeedParams",
            "components": [
              {
                "name": "tickLower",
                "type": "int24",
                "internalType": "int24"
              },
              {
                "name": "tickUpper",
                "type": "int24",
                "internalType": "int24"
              },
              {
                "name": "launchTokenAmount",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "quoteTokenAmount",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "positionRecipient",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "deadline",
                "type": "uint256",
                "internalType": "uint256"
              }
            ]
          },
          {
            "name": "listing",
            "type": "tuple",
            "internalType": "struct HookListingParams",
            "components": [
              {
                "name": "register",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "steward",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "metadata",
                "type": "tuple",
                "internalType": "struct LatchMetadata",
                "components": [
                  {
                    "name": "name",
                    "type": "string",
                    "internalType": "string"
                  },
                  {
                    "name": "description",
                    "type": "string",
                    "internalType": "string"
                  },
                  {
                    "name": "sourceURI",
                    "type": "string",
                    "internalType": "string"
                  },
                  {
                    "name": "auditURI",
                    "type": "string",
                    "internalType": "string"
                  },
                  {
                    "name": "chainIds",
                    "type": "uint256[]",
                    "internalType": "uint256[]"
                  }
                ]
              }
            ]
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "result",
        "type": "tuple",
        "internalType": "struct LaunchResult",
        "components": [
          {
            "name": "key",
            "type": "tuple",
            "internalType": "struct PoolKey",
            "components": [
              {
                "name": "currency0",
                "type": "address",
                "internalType": "Currency"
              },
              {
                "name": "currency1",
                "type": "address",
                "internalType": "Currency"
              },
              {
                "name": "hooks",
                "type": "address",
                "internalType": "contract IHooks"
              },
              {
                "name": "poolManager",
                "type": "address",
                "internalType": "contract IPoolManager"
              },
              {
                "name": "fee",
                "type": "uint24",
                "internalType": "uint24"
              },
              {
                "name": "parameters",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          },
          {
            "name": "poolId",
            "type": "bytes32",
            "internalType": "PoolId"
          },
          {
            "name": "startTime",
            "type": "uint40",
            "internalType": "uint40"
          },
          {
            "name": "decaySeconds",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "positionTokenId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "liquiditySeeded",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "launchTokenIsCurrency0",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "getLaunchRecord",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct LaunchRecord",
        "components": [
          {
            "name": "operator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "launchTokenIsCurrency0",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "launchToken",
            "type": "address",
            "internalType": "address"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "hook",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract LaunchGuardHook"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "hookBitmap",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "listHook",
    "inputs": [
      {
        "name": "metadata",
        "type": "tuple",
        "internalType": "struct LatchMetadata",
        "components": [
          {
            "name": "name",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "description",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "sourceURI",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "auditURI",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "chainIds",
            "type": "uint256[]",
            "internalType": "uint256[]"
          }
        ]
      },
      {
        "name": "steward",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "listed",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "permit2",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IAllowanceTransfer"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "positionManager",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract ICLPositionManager"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "previewSchedule",
    "inputs": [
      {
        "name": "p",
        "type": "tuple",
        "internalType": "struct LaunchParams",
        "components": [
          {
            "name": "launchToken",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "quoteToken",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "tickSpacing",
            "type": "int24",
            "internalType": "int24"
          },
          {
            "name": "sqrtPriceX96",
            "type": "uint160",
            "internalType": "uint160"
          },
          {
            "name": "preset",
            "type": "uint8",
            "internalType": "enum Preset"
          },
          {
            "name": "initialFeeBips",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "finalFeeBips",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "decaySeconds",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "enabled",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "startDelaySeconds",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "maxBuyPerTx",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "launchOperator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "seed",
            "type": "tuple",
            "internalType": "struct SeedParams",
            "components": [
              {
                "name": "tickLower",
                "type": "int24",
                "internalType": "int24"
              },
              {
                "name": "tickUpper",
                "type": "int24",
                "internalType": "int24"
              },
              {
                "name": "launchTokenAmount",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "quoteTokenAmount",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "positionRecipient",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "deadline",
                "type": "uint256",
                "internalType": "uint256"
              }
            ]
          },
          {
            "name": "listing",
            "type": "tuple",
            "internalType": "struct HookListingParams",
            "components": [
              {
                "name": "register",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "steward",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "metadata",
                "type": "tuple",
                "internalType": "struct LatchMetadata",
                "components": [
                  {
                    "name": "name",
                    "type": "string",
                    "internalType": "string"
                  },
                  {
                    "name": "description",
                    "type": "string",
                    "internalType": "string"
                  },
                  {
                    "name": "sourceURI",
                    "type": "string",
                    "internalType": "string"
                  },
                  {
                    "name": "auditURI",
                    "type": "string",
                    "internalType": "string"
                  },
                  {
                    "name": "chainIds",
                    "type": "uint256[]",
                    "internalType": "uint256[]"
                  }
                ]
              }
            ]
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "cfg",
        "type": "tuple",
        "internalType": "struct LaunchGuardHook.LaunchConfig",
        "components": [
          {
            "name": "startTime",
            "type": "uint40",
            "internalType": "uint40"
          },
          {
            "name": "decaySeconds",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "initialFeeBips",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "finalFeeBips",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "maxBuyPerTx",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "launchTokenIsCurrency0",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "enabled",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "reconfigureLaunch",
    "inputs": [
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          },
          {
            "name": "poolManager",
            "type": "address",
            "internalType": "contract IPoolManager"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "parameters",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "cfg",
        "type": "tuple",
        "internalType": "struct LaunchGuardHook.LaunchConfig",
        "components": [
          {
            "name": "startTime",
            "type": "uint40",
            "internalType": "uint40"
          },
          {
            "name": "decaySeconds",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "initialFeeBips",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "finalFeeBips",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "maxBuyPerTx",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "launchTokenIsCurrency0",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "enabled",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "registry",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IHookRegistryListing"
      }
    ],
    "stateMutability": "view"
  }
] as const satisfies Abi;

/**
 * `LaunchGuardHook` - the CL launch hook the kit drives.
 *
 * 19 errors, 4 events, 17 functions - curated from the compiled artifact, not the full ABI.
 */
export const LAUNCH_GUARD_HOOK_ABI = [
  {
    "type": "error",
    "name": "BuyExceedsMaxPerTx",
    "inputs": [
      {
        "name": "amountIn",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxBuyPerTx",
        "type": "uint128",
        "internalType": "uint128"
      }
    ]
  },
  {
    "type": "error",
    "name": "CurrencyHasNoCode",
    "inputs": [
      {
        "name": "currency",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "ExactOutputBuyBlockedDuringLaunch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "HookMismatch",
    "inputs": [
      {
        "name": "declared",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "HookNotImplemented",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidDecaySeconds",
    "inputs": [
      {
        "name": "decaySeconds",
        "type": "uint32",
        "internalType": "uint32"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidFeeSchedule",
    "inputs": [
      {
        "name": "initialFeeBips",
        "type": "uint24",
        "internalType": "uint24"
      },
      {
        "name": "finalFeeBips",
        "type": "uint24",
        "internalType": "uint24"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidStartTime",
    "inputs": [
      {
        "name": "startTime",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "currentTime",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "LaunchAlreadyStarted",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      },
      {
        "name": "startTime",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "LaunchNotConfigured",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      }
    ]
  },
  {
    "type": "error",
    "name": "LaunchPoolReserved",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "creator",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotLaunchOwner",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      },
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotPoolManager",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotTokenCreator",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "PermissionDependencyMissing",
    "inputs": [
      {
        "name": "declared",
        "type": "uint16",
        "internalType": "uint16"
      }
    ]
  },
  {
    "type": "error",
    "name": "PoolManagerMismatch",
    "inputs": [
      {
        "name": "declared",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "PoolMustUseDynamicFee",
    "inputs": [
      {
        "name": "fee",
        "type": "uint24",
        "internalType": "uint24"
      }
    ]
  },
  {
    "type": "error",
    "name": "ReservedBitsSet",
    "inputs": [
      {
        "name": "declared",
        "type": "uint16",
        "internalType": "uint16"
      }
    ]
  },
  {
    "type": "error",
    "name": "TradingNotOpen",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      },
      {
        "name": "startTime",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "currentTime",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "event",
    "name": "LaunchClaimed",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "PoolId"
      },
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "LaunchClaimerSet",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "creator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "claimer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "LaunchConfigured",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "PoolId"
      },
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "startTime",
        "type": "uint40",
        "indexed": false,
        "internalType": "uint40"
      },
      {
        "name": "decaySeconds",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "initialFeeBips",
        "type": "uint24",
        "indexed": false,
        "internalType": "uint24"
      },
      {
        "name": "finalFeeBips",
        "type": "uint24",
        "indexed": false,
        "internalType": "uint24"
      },
      {
        "name": "maxBuyPerTx",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      },
      {
        "name": "launchTokenIsCurrency0",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "enabled",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "LaunchStarted",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "PoolId"
      },
      {
        "name": "timestamp",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "function",
    "name": "CLOCK_MODE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "LAUNCH_TOKEN_FACTORY",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract ILaunchTokenOrigin"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_DECAY_SECONDS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_FINAL_FEE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint24",
        "internalType": "uint24"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_INITIAL_FEE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint24",
        "internalType": "uint24"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_START_DELAY_SECONDS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint40",
        "internalType": "uint40"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MIN_DECAY_SECONDS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "clock",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint48",
        "internalType": "uint48"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "configureLaunch",
    "inputs": [
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          },
          {
            "name": "poolManager",
            "type": "address",
            "internalType": "contract IPoolManager"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "parameters",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "cfg",
        "type": "tuple",
        "internalType": "struct LaunchGuardHook.LaunchConfig",
        "components": [
          {
            "name": "startTime",
            "type": "uint40",
            "internalType": "uint40"
          },
          {
            "name": "decaySeconds",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "initialFeeBips",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "finalFeeBips",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "maxBuyPerTx",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "launchTokenIsCurrency0",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "enabled",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "currentFee",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint24",
        "internalType": "uint24"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "feeAt",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      },
      {
        "name": "timestamp",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint24",
        "internalType": "uint24"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getHooksRegistrationBitmap",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "getLaunch",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct LaunchGuardHook.Launch",
        "components": [
          {
            "name": "owner",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "startTime",
            "type": "uint40",
            "internalType": "uint40"
          },
          {
            "name": "decaySeconds",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "enabled",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "initialFeeBips",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "finalFeeBips",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "maxBuyPerTx",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "launchTokenIsCurrency0",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "launched",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "launchClaimerOf",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "claimer",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "launchOwner",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "poolManager",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract ICLPoolManager"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "setLaunchClaimer",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "claimer",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  }
] as const satisfies Abi;

/**
 * `BinLaunchGuardHook` - the liquidity-book variant, including `beforeMint`.
 *
 * 19 errors, 4 events, 17 functions - curated from the compiled artifact, not the full ABI.
 */
export const BIN_LAUNCH_GUARD_HOOK_ABI = [
  {
    "type": "error",
    "name": "BuyExceedsMaxPerTx",
    "inputs": [
      {
        "name": "amountIn",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxBuyPerTx",
        "type": "uint128",
        "internalType": "uint128"
      }
    ]
  },
  {
    "type": "error",
    "name": "CurrencyHasNoCode",
    "inputs": [
      {
        "name": "currency",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "ExactOutputBuyBlockedDuringLaunch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "HookMismatch",
    "inputs": [
      {
        "name": "declared",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "HookNotImplemented",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidDecaySeconds",
    "inputs": [
      {
        "name": "decaySeconds",
        "type": "uint32",
        "internalType": "uint32"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidFeeSchedule",
    "inputs": [
      {
        "name": "initialFeeBips",
        "type": "uint24",
        "internalType": "uint24"
      },
      {
        "name": "finalFeeBips",
        "type": "uint24",
        "internalType": "uint24"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidStartTime",
    "inputs": [
      {
        "name": "startTime",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "currentTime",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "LaunchAlreadyStarted",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      },
      {
        "name": "startTime",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "LaunchNotConfigured",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      }
    ]
  },
  {
    "type": "error",
    "name": "LaunchPoolReserved",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "creator",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotLaunchOwner",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      },
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotPoolManager",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotTokenCreator",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "PermissionDependencyMissing",
    "inputs": [
      {
        "name": "declared",
        "type": "uint16",
        "internalType": "uint16"
      }
    ]
  },
  {
    "type": "error",
    "name": "PoolManagerMismatch",
    "inputs": [
      {
        "name": "declared",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "PoolMustUseDynamicFee",
    "inputs": [
      {
        "name": "fee",
        "type": "uint24",
        "internalType": "uint24"
      }
    ]
  },
  {
    "type": "error",
    "name": "ReservedBitsSet",
    "inputs": [
      {
        "name": "declared",
        "type": "uint16",
        "internalType": "uint16"
      }
    ]
  },
  {
    "type": "error",
    "name": "TradingNotOpen",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      },
      {
        "name": "startTime",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "currentTime",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "event",
    "name": "LaunchClaimed",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "PoolId"
      },
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "LaunchClaimerSet",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "creator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "claimer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "LaunchConfigured",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "PoolId"
      },
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "startTime",
        "type": "uint40",
        "indexed": false,
        "internalType": "uint40"
      },
      {
        "name": "decaySeconds",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "initialFeeBips",
        "type": "uint24",
        "indexed": false,
        "internalType": "uint24"
      },
      {
        "name": "finalFeeBips",
        "type": "uint24",
        "indexed": false,
        "internalType": "uint24"
      },
      {
        "name": "maxBuyPerTx",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      },
      {
        "name": "launchTokenIsCurrency0",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "enabled",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "LaunchStarted",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "PoolId"
      },
      {
        "name": "timestamp",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "function",
    "name": "CLOCK_MODE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "LAUNCH_TOKEN_FACTORY",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract ILaunchTokenOrigin"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_DECAY_SECONDS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_FINAL_FEE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint24",
        "internalType": "uint24"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_INITIAL_FEE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint24",
        "internalType": "uint24"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_START_DELAY_SECONDS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint40",
        "internalType": "uint40"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MIN_DECAY_SECONDS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "clock",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint48",
        "internalType": "uint48"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "configureLaunch",
    "inputs": [
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          },
          {
            "name": "poolManager",
            "type": "address",
            "internalType": "contract IPoolManager"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "parameters",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "cfg",
        "type": "tuple",
        "internalType": "struct BinLaunchGuardHook.LaunchConfig",
        "components": [
          {
            "name": "startTime",
            "type": "uint40",
            "internalType": "uint40"
          },
          {
            "name": "decaySeconds",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "initialFeeBips",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "finalFeeBips",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "maxBuyPerTx",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "launchTokenIsCurrency0",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "enabled",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "currentFee",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint24",
        "internalType": "uint24"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "feeAt",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      },
      {
        "name": "timestamp",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint24",
        "internalType": "uint24"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getHooksRegistrationBitmap",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "getLaunch",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct BinLaunchGuardHook.Launch",
        "components": [
          {
            "name": "owner",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "startTime",
            "type": "uint40",
            "internalType": "uint40"
          },
          {
            "name": "decaySeconds",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "enabled",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "initialFeeBips",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "finalFeeBips",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "maxBuyPerTx",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "launchTokenIsCurrency0",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "launched",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "launchClaimerOf",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "claimer",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "launchOwner",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "PoolId"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "poolManager",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IBinPoolManager"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "setLaunchClaimer",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "claimer",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  }
] as const satisfies Abi;

/**
 * `LaunchpadKitV2` - locked, multi-pool (CL and Bin) launches with a Safe-owned launch fee.
 *
 * 57 errors, 12 events, 50 functions - curated from the compiled artifact, not the full ABI.
 */
export const LAUNCHPAD_KIT_V2_ABI = [
  {
    "type": "error",
    "name": "ActiveIdMoved",
    "inputs": [
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "expected",
        "type": "uint24",
        "internalType": "uint24"
      },
      {
        "name": "actual",
        "type": "uint24",
        "internalType": "uint24"
      }
    ]
  },
  {
    "type": "error",
    "name": "AllocationRecipientRequired",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BinIdOutOfRange",
    "inputs": [
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "activeId",
        "type": "uint24",
        "internalType": "uint24"
      },
      {
        "name": "offset",
        "type": "uint24",
        "internalType": "uint24"
      }
    ]
  },
  {
    "type": "error",
    "name": "BinShapeNotAllowed",
    "inputs": [
      {
        "name": "tenant",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "shape",
        "type": "uint8",
        "internalType": "enum BinShape"
      }
    ]
  },
  {
    "type": "error",
    "name": "DuplicateLegPool",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "EmptyLeg",
    "inputs": [
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "HookClockMismatch",
    "inputs": [
      {
        "name": "hook",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "HookFactoryMismatch",
    "inputs": [
      {
        "name": "hook",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "factory",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "HookPoolManagerMismatch",
    "inputs": [
      {
        "name": "expected",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "actual",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "InsufficientLaunchFee",
    "inputs": [
      {
        "name": "required",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "sent",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "IntegratorFeeAboveCap",
    "inputs": [
      {
        "name": "feeWei",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "capWei",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "IntegratorFeeWithoutIntegrator",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidBinCap",
    "inputs": [
      {
        "name": "maxBinsPerLeg",
        "type": "uint16",
        "internalType": "uint16"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidLegCap",
    "inputs": [
      {
        "name": "maxLegs",
        "type": "uint8",
        "internalType": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidLegCount",
    "inputs": [
      {
        "name": "count",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxLegs",
        "type": "uint8",
        "internalType": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidNotice",
    "inputs": [
      {
        "name": "noticeSeconds",
        "type": "uint32",
        "internalType": "uint32"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidRecipient",
    "inputs": [
      {
        "name": "recipient",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidSeedSupply",
    "inputs": [
      {
        "name": "seedSupply",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "totalSupply",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidTenantConfig",
    "inputs": []
  },
  {
    "type": "error",
    "name": "KitRetainedBinShares",
    "inputs": [
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "binId",
        "type": "uint24",
        "internalType": "uint24"
      },
      {
        "name": "balance",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "KitRetainedLaunchToken",
    "inputs": [
      {
        "name": "balance",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "LaunchFeeAboveCap",
    "inputs": [
      {
        "name": "feeWei",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "capWei",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "LaunchTokenAddressMismatch",
    "inputs": [
      {
        "name": "predicted",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "created",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "LaunchTokenSupplyMismatch",
    "inputs": [
      {
        "name": "expected",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "received",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "LegKeyMismatch",
    "inputs": [
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "LegTooLarge",
    "inputs": [
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "LegWeightsDoNotSum",
    "inputs": [
      {
        "name": "sum",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "LockNotRecorded",
    "inputs": [
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "lockId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "LockerFloorTooLow",
    "inputs": [
      {
        "name": "locker",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "minProtocolBps",
        "type": "uint16",
        "internalType": "uint16"
      }
    ]
  },
  {
    "type": "error",
    "name": "LockerMismatch",
    "inputs": [
      {
        "name": "locker",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "MaxBuyRequiredByPreset",
    "inputs": [
      {
        "name": "preset",
        "type": "uint8",
        "internalType": "enum Preset"
      }
    ]
  },
  {
    "type": "error",
    "name": "NativeTransferFailed",
    "inputs": [
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "NoCode",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "NoParametersForCustomPreset",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NoPendingLaunchFee",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotLaunchOperator",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "NothingToClaim",
    "inputs": []
  },
  {
    "type": "error",
    "name": "OwnableInvalidOwner",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "OwnableUnauthorizedAccount",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "PositionManagerMismatch",
    "inputs": [
      {
        "name": "positionManager",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "PresetNotAllowed",
    "inputs": [
      {
        "name": "tenant",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "preset",
        "type": "uint8",
        "internalType": "enum Preset"
      }
    ]
  },
  {
    "type": "error",
    "name": "PresetUnavailableOnBin",
    "inputs": [
      {
        "name": "preset",
        "type": "uint8",
        "internalType": "enum Preset"
      }
    ]
  },
  {
    "type": "error",
    "name": "ProtocolFeeNotZero",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "protocolFee",
        "type": "uint24",
        "internalType": "uint24"
      }
    ]
  },
  {
    "type": "error",
    "name": "QuoteHasNoCode",
    "inputs": [
      {
        "name": "quote",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "QuoteIsLaunchToken",
    "inputs": [
      {
        "name": "quote",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "QuoteNotAllowed",
    "inputs": [
      {
        "name": "tenant",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "quote",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "RangeNotSingleSided",
    "inputs": [
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "tickLower",
        "type": "int24",
        "internalType": "int24"
      },
      {
        "name": "tickUpper",
        "type": "int24",
        "internalType": "int24"
      },
      {
        "name": "currentTick",
        "type": "int24",
        "internalType": "int24"
      }
    ]
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "RenounceDisabled",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SeedProducesNoLiquidity",
    "inputs": [
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "StartDelayTooLong",
    "inputs": [
      {
        "name": "delaySeconds",
        "type": "uint32",
        "internalType": "uint32"
      }
    ]
  },
  {
    "type": "error",
    "name": "TenantConfigMismatch",
    "inputs": [
      {
        "name": "tenant",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "TenantNotActive",
    "inputs": [
      {
        "name": "tenant",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnexpectedHookBitmap",
    "inputs": [
      {
        "name": "expected",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "actual",
        "type": "uint16",
        "internalType": "uint16"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnknownLaunch",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "VaultMismatch",
    "inputs": [
      {
        "name": "component",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  },
  {
    "type": "event",
    "name": "FeesClaimed",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "to",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "FeesCredited",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "LaunchCreated",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "creator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "tenant",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "launcher",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "operator",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "totalSupply",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "seedSupply",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "legCount",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "startTime",
        "type": "uint40",
        "indexed": false,
        "internalType": "uint40"
      },
      {
        "name": "protocolFeeWei",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "integrator",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "integratorFeeWei",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "LaunchFeeChanged",
    "inputs": [
      {
        "name": "previousWei",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "newWei",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "LaunchFeeIncreaseScheduled",
    "inputs": [
      {
        "name": "currentWei",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "newWei",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "effectiveAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "LaunchLegCreated",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "quote",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "kind",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum LegKind"
      },
      {
        "name": "lockId",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "launchTokenSeeded",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "weightBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "LaunchReconfigured",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "operator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "startTime",
        "type": "uint40",
        "indexed": false,
        "internalType": "uint40"
      },
      {
        "name": "decaySeconds",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "initialFeeBips",
        "type": "uint24",
        "indexed": false,
        "internalType": "uint24"
      },
      {
        "name": "finalFeeBips",
        "type": "uint24",
        "indexed": false,
        "internalType": "uint24"
      },
      {
        "name": "enabled",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferStarted",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OwnershipTransferred",
    "inputs": [
      {
        "name": "previousOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newOwner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PendingLaunchFeeCancelled",
    "inputs": [
      {
        "name": "cancelledWei",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "effectiveAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TenantConfigured",
    "inputs": [
      {
        "name": "tenant",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "integrator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "integratorBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "integratorLaunchFeeWei",
        "type": "uint96",
        "indexed": false,
        "internalType": "uint96"
      },
      {
        "name": "allowedPresets",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "allowedBinShapes",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "restrictQuotes",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "active",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TenantQuoteSet",
    "inputs": [
      {
        "name": "tenant",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "quote",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "allowed",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "function",
    "name": "BIN_HOOK_BITMAP",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "CLOCK_MODE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "CL_HOOK_BITMAP",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_FEE_NOTICE_SECONDS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_LEGS_HARD_CAP",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_START_DELAY_SECONDS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MIN_FEE_NOTICE_SECONDS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "PROTOCOL_LP_FLOOR_BPS",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "binHook",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract BinLaunchGuardHook"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "binLocker",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract LatchBinLPLocker"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "binPoolManager",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IBinPoolManager"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "binPositionManager",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IBinPositionManager"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "cancelPendingLaunchFee",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "clHook",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract LaunchGuardHook"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "clLocker",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract LatchLPLocker"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "clPoolManager",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract ICLPoolManager"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "clPositionManager",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract ICLPositionManager"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "claimFees",
    "inputs": [
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "computeLegKey",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "leg",
        "type": "tuple",
        "internalType": "struct LegParams",
        "components": [
          {
            "name": "kind",
            "type": "uint8",
            "internalType": "enum LegKind"
          },
          {
            "name": "quote",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "weightBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "maxBuyPerTx",
            "type": "uint128",
            "internalType": "uint128"
          },
          {
            "name": "cl",
            "type": "tuple",
            "internalType": "struct CLLegParams",
            "components": [
              {
                "name": "tickSpacing",
                "type": "int24",
                "internalType": "int24"
              },
              {
                "name": "sqrtPriceX96",
                "type": "uint160",
                "internalType": "uint160"
              },
              {
                "name": "tickLower",
                "type": "int24",
                "internalType": "int24"
              },
              {
                "name": "tickUpper",
                "type": "int24",
                "internalType": "int24"
              }
            ]
          },
          {
            "name": "bin",
            "type": "tuple",
            "internalType": "struct BinLegParams",
            "components": [
              {
                "name": "binStep",
                "type": "uint16",
                "internalType": "uint16"
              },
              {
                "name": "activeId",
                "type": "uint24",
                "internalType": "uint24"
              },
              {
                "name": "shape",
                "type": "uint8",
                "internalType": "enum BinShape"
              },
              {
                "name": "binCount",
                "type": "uint16",
                "internalType": "uint16"
              },
              {
                "name": "offsets",
                "type": "uint24[]",
                "internalType": "uint24[]"
              },
              {
                "name": "weights",
                "type": "uint64[]",
                "internalType": "uint64[]"
              },
              {
                "name": "floorBins",
                "type": "uint16",
                "internalType": "uint16"
              }
            ]
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          },
          {
            "name": "poolManager",
            "type": "address",
            "internalType": "contract IPoolManager"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "parameters",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "launchTokenIsCurrency0",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "createLaunch",
    "inputs": [
      {
        "name": "p",
        "type": "tuple",
        "internalType": "struct LaunchParamsV2",
        "components": [
          {
            "name": "name",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "symbol",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "metadataURI",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "userSalt",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "totalSupply",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "seedSupply",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "allocationRecipient",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "creator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "launchOperator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "launchSteward",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "tenant",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "integrator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "integratorBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "integratorLaunchFeeWei",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "creatorBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "protocolBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "schedule",
            "type": "tuple",
            "internalType": "struct ScheduleParams",
            "components": [
              {
                "name": "preset",
                "type": "uint8",
                "internalType": "enum Preset"
              },
              {
                "name": "initialFeeBips",
                "type": "uint24",
                "internalType": "uint24"
              },
              {
                "name": "finalFeeBips",
                "type": "uint24",
                "internalType": "uint24"
              },
              {
                "name": "decaySeconds",
                "type": "uint32",
                "internalType": "uint32"
              },
              {
                "name": "enabled",
                "type": "bool",
                "internalType": "bool"
              },
              {
                "name": "startDelaySeconds",
                "type": "uint32",
                "internalType": "uint32"
              }
            ]
          },
          {
            "name": "legs",
            "type": "tuple[]",
            "internalType": "struct LegParams[]",
            "components": [
              {
                "name": "kind",
                "type": "uint8",
                "internalType": "enum LegKind"
              },
              {
                "name": "quote",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "weightBps",
                "type": "uint16",
                "internalType": "uint16"
              },
              {
                "name": "maxBuyPerTx",
                "type": "uint128",
                "internalType": "uint128"
              },
              {
                "name": "cl",
                "type": "tuple",
                "internalType": "struct CLLegParams",
                "components": [
                  {
                    "name": "tickSpacing",
                    "type": "int24",
                    "internalType": "int24"
                  },
                  {
                    "name": "sqrtPriceX96",
                    "type": "uint160",
                    "internalType": "uint160"
                  },
                  {
                    "name": "tickLower",
                    "type": "int24",
                    "internalType": "int24"
                  },
                  {
                    "name": "tickUpper",
                    "type": "int24",
                    "internalType": "int24"
                  }
                ]
              },
              {
                "name": "bin",
                "type": "tuple",
                "internalType": "struct BinLegParams",
                "components": [
                  {
                    "name": "binStep",
                    "type": "uint16",
                    "internalType": "uint16"
                  },
                  {
                    "name": "activeId",
                    "type": "uint24",
                    "internalType": "uint24"
                  },
                  {
                    "name": "shape",
                    "type": "uint8",
                    "internalType": "enum BinShape"
                  },
                  {
                    "name": "binCount",
                    "type": "uint16",
                    "internalType": "uint16"
                  },
                  {
                    "name": "offsets",
                    "type": "uint24[]",
                    "internalType": "uint24[]"
                  },
                  {
                    "name": "weights",
                    "type": "uint64[]",
                    "internalType": "uint64[]"
                  },
                  {
                    "name": "floorBins",
                    "type": "uint16",
                    "internalType": "uint16"
                  }
                ]
              }
            ]
          },
          {
            "name": "listing",
            "type": "tuple",
            "internalType": "struct LaunchMetadata",
            "components": [
              {
                "name": "description",
                "type": "string",
                "internalType": "string"
              },
              {
                "name": "websiteURI",
                "type": "string",
                "internalType": "string"
              },
              {
                "name": "iconURI",
                "type": "string",
                "internalType": "string"
              },
              {
                "name": "socialURI",
                "type": "string",
                "internalType": "string"
              }
            ]
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "r",
        "type": "tuple",
        "internalType": "struct LaunchResultV2",
        "components": [
          {
            "name": "token",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "poolIds",
            "type": "bytes32[]",
            "internalType": "bytes32[]"
          },
          {
            "name": "lockIds",
            "type": "uint256[]",
            "internalType": "uint256[]"
          },
          {
            "name": "startTime",
            "type": "uint40",
            "internalType": "uint40"
          },
          {
            "name": "protocolFeeWei",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "integratorFeeWei",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "feesOwed",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "flushProtocolFees",
    "inputs": [],
    "outputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getLaunch",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct LaunchRecordV2",
        "components": [
          {
            "name": "creator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "createdAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "legCount",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "operator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "startTime",
            "type": "uint40",
            "internalType": "uint40"
          },
          {
            "name": "tenant",
            "type": "address",
            "internalType": "address"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getLeg",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct LegRecord",
        "components": [
          {
            "name": "launchToken",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "kind",
            "type": "uint8",
            "internalType": "enum LegKind"
          },
          {
            "name": "launchTokenIsCurrency0",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "lockId",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isLockedLaunch",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "launchFeeNoticeSeconds",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "launchFeeWei",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "launchOriginOf",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "creator",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "launchRegistry",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract ILaunchRegistryWriter"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "launchpadSteward",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "legsOf",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32[]",
        "internalType": "bytes32[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "maxBinsPerLeg",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "maxIntegratorBps",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "maxIntegratorLaunchFeeWei",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "maxLaunchFeeWei",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "maxLegs",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "owner",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pendingLaunchFee",
    "inputs": [],
    "outputs": [
      {
        "name": "feeWei",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "effectiveAt",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pendingOwner",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "predictLaunchToken",
    "inputs": [
      {
        "name": "launcher",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "userSalt",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "protocolFeeRecipient",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "reconfigureLaunch",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "keys",
        "type": "tuple[]",
        "internalType": "struct PoolKey[]",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          },
          {
            "name": "poolManager",
            "type": "address",
            "internalType": "contract IPoolManager"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "parameters",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "schedule",
        "type": "tuple",
        "internalType": "struct ScheduleParams",
        "components": [
          {
            "name": "preset",
            "type": "uint8",
            "internalType": "enum Preset"
          },
          {
            "name": "initialFeeBips",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "finalFeeBips",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "decaySeconds",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "enabled",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "startDelaySeconds",
            "type": "uint32",
            "internalType": "uint32"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "registerLaunchpad",
    "inputs": [
      {
        "name": "metadata",
        "type": "tuple",
        "internalType": "struct LaunchpadMetadata",
        "components": [
          {
            "name": "name",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "description",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "sourceURI",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "auditURI",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "websiteURI",
            "type": "string",
            "internalType": "string"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setLaunchFee",
    "inputs": [
      {
        "name": "newFeeWei",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setTenantConfig",
    "inputs": [
      {
        "name": "c",
        "type": "tuple",
        "internalType": "struct TenantConfig",
        "components": [
          {
            "name": "integrator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "integratorBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "integratorLaunchFeeWei",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "allowedPresets",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "allowedBinShapes",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "restrictQuotes",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "active",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setTenantQuote",
    "inputs": [
      {
        "name": "quote",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "allowed",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "tenantConfig",
    "inputs": [
      {
        "name": "tenant",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct TenantConfig",
        "components": [
          {
            "name": "integrator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "integratorBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "integratorLaunchFeeWei",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "allowedPresets",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "allowedBinShapes",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "restrictQuotes",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "active",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "tenantQuoteAllowed",
    "inputs": [
      {
        "name": "tenant",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "quote",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "tokenFactory",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract ILaunchTokenFactory"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "totalFeesOwed",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  }
] as const satisfies Abi;

/**
 * `LaunchLegs` - the kit's linked library. Errors only: it runs by DELEGATECALL inside `createLaunch`, so its reverts (every `BinShape*` rule R1-R6 among them) surface from the KIT's address. Merge it with `LAUNCHPAD_KIT_V2_ABI` to decode a failed launch.
 *
 * 25 errors - curated from the compiled artifact, not the full ABI.
 */
export const LAUNCH_LEGS_ABI = [
  {
    "type": "error",
    "name": "ActiveIdMoved",
    "inputs": [
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "expected",
        "type": "uint24",
        "internalType": "uint24"
      },
      {
        "name": "actual",
        "type": "uint24",
        "internalType": "uint24"
      }
    ]
  },
  {
    "type": "error",
    "name": "AddressEmptyCode",
    "inputs": [
      {
        "name": "target",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "AddressInsufficientBalance",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "BinIdOutOfRange",
    "inputs": [
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "activeId",
        "type": "uint24",
        "internalType": "uint24"
      },
      {
        "name": "offset",
        "type": "uint24",
        "internalType": "uint24"
      }
    ]
  },
  {
    "type": "error",
    "name": "BinShapeBadCount",
    "inputs": [
      {
        "name": "count",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxBins",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "BinShapeDustBin",
    "inputs": [
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "BinShapeGapBelowFloor",
    "inputs": [
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "BinShapeInvalidFloor",
    "inputs": [
      {
        "name": "floorBins",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "count",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "BinShapeLengthMismatch",
    "inputs": [
      {
        "name": "offsets",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "weights",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "BinShapeNotMonotonic",
    "inputs": [
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "BinShapeNotSingleSided",
    "inputs": [
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "BinShapeWeightsDoNotSum",
    "inputs": [
      {
        "name": "sum",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "BinShapeZeroWeight",
    "inputs": [
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "FailedInnerCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidTick",
    "inputs": [
      {
        "name": "tick",
        "type": "int24",
        "internalType": "int24"
      }
    ]
  },
  {
    "type": "error",
    "name": "KitRetainedBinShares",
    "inputs": [
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "binId",
        "type": "uint24",
        "internalType": "uint24"
      },
      {
        "name": "balance",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "KitRetainedLaunchToken",
    "inputs": [
      {
        "name": "balance",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "LaunchTokenAddressMismatch",
    "inputs": [
      {
        "name": "predicted",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "created",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "LaunchTokenSupplyMismatch",
    "inputs": [
      {
        "name": "expected",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "received",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "LockNotRecorded",
    "inputs": [
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "lockId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "ProtocolFeeNotZero",
    "inputs": [
      {
        "name": "poolId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "protocolFee",
        "type": "uint24",
        "internalType": "uint24"
      }
    ]
  },
  {
    "type": "error",
    "name": "RangeNotSingleSided",
    "inputs": [
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "tickLower",
        "type": "int24",
        "internalType": "int24"
      },
      {
        "name": "tickUpper",
        "type": "int24",
        "internalType": "int24"
      },
      {
        "name": "currentTick",
        "type": "int24",
        "internalType": "int24"
      }
    ]
  },
  {
    "type": "error",
    "name": "SafeCastOverflow",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SafeERC20FailedOperation",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "SeedProducesNoLiquidity",
    "inputs": [
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  }
] as const satisfies Abi;

/**
 * `LaunchTokenFactory` - deterministic launch tokens; `launchTokenInitCodeHash` feeds off-chain prediction.
 *
 * 10 errors, 1 event, 7 functions - curated from the compiled artifact, not the full ABI.
 */
export const LAUNCH_TOKEN_FACTORY_ABI = [
  {
    "type": "error",
    "name": "DeploymentInProgress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmptyName",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EmptySymbol",
    "inputs": []
  },
  {
    "type": "error",
    "name": "MetadataURITooLong",
    "inputs": [
      {
        "name": "length",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "max",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "NameTooLong",
    "inputs": [
      {
        "name": "length",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "max",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "NoDeploymentInProgress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SymbolTooLong",
    "inputs": [
      {
        "name": "length",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "max",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "TokenAlreadyDeployed",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "ZeroRecipient",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroSupply",
    "inputs": []
  },
  {
    "type": "event",
    "name": "LaunchTokenCreated",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "deployer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "recipient",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "salt",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "name",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      },
      {
        "name": "symbol",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      },
      {
        "name": "metadataURI",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      },
      {
        "name": "totalSupply",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "function",
    "name": "MAX_METADATA_URI_BYTES",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_NAME_BYTES",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_SYMBOL_BYTES",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "deployerOf",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "deployer",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isLaunchToken",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "launchTokenInitCodeHash",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "predictTokenAddress",
    "inputs": [
      {
        "name": "deployer",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "salt",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  }
] as const satisfies Abi;

/**
 * `LatchLPLocker` - the permanent CL position locker. `collectFees` and `skim` are permissionless.
 *
 * 23 errors, 6 events, 19 functions - curated from the compiled artifact, not the full ABI.
 */
export const LATCH_LP_LOCKER_ABI = [
  {
    "type": "error",
    "name": "AlreadyLocked",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "BpsDoNotSumToDenominator",
    "inputs": [
      {
        "name": "sum",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "EmptyPosition",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "HookInterceptsRemoval",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "hook",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "IntegratorBpsTooHigh",
    "inputs": [
      {
        "name": "integratorBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "maxIntegratorBps",
        "type": "uint16",
        "internalType": "uint16"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidBpsBounds",
    "inputs": [
      {
        "name": "minProtocolBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "maxProtocolBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "maxIntegratorBps",
        "type": "uint16",
        "internalType": "uint16"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidCreator",
    "inputs": [
      {
        "name": "creator",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidIntegrator",
    "inputs": [
      {
        "name": "integrator",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "integratorBps",
        "type": "uint16",
        "internalType": "uint16"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidLockData",
    "inputs": [
      {
        "name": "length",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotCreator",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotLocked",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotOwnedByLocker",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotPendingCreator",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotPositionManager",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "NothingToClaim",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NothingToSkim",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PositionManagerHasNoVault",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ProtocolBpsOutOfRange",
    "inputs": [
      {
        "name": "protocolBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "minProtocolBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "maxProtocolBps",
        "type": "uint16",
        "internalType": "uint16"
      }
    ]
  },
  {
    "type": "error",
    "name": "ProtocolRecipientIsLocker",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SubscriberAttached",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "subscriber",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnexpectedNativeSender",
    "inputs": [
      {
        "name": "sender",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  },
  {
    "type": "event",
    "name": "Claimed",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "currency",
        "type": "address",
        "indexed": true,
        "internalType": "Currency"
      },
      {
        "name": "to",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CreatorTransferStarted",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "creator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "pending",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CreatorTransferred",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "previousCreator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newCreator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "FeesCollected",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "currency",
        "type": "address",
        "indexed": true,
        "internalType": "Currency"
      },
      {
        "name": "caller",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "creatorShare",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "integratorShare",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "protocolShare",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PositionLocked",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "PoolId"
      },
      {
        "name": "creator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "integrator",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "creatorBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "integratorBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "protocolBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "liquidity",
        "type": "uint128",
        "indexed": false,
        "internalType": "uint128"
      },
      {
        "name": "from",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "operator",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Skimmed",
    "inputs": [
      {
        "name": "currency",
        "type": "address",
        "indexed": true,
        "internalType": "Currency"
      },
      {
        "name": "caller",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "function",
    "name": "BPS_DENOMINATOR",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "acceptCreator",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claim",
    "inputs": [
      {
        "name": "currency",
        "type": "address",
        "internalType": "Currency"
      },
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claimable",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "currency",
        "type": "address",
        "internalType": "Currency"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "collectFees",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "amount0",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amount1",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getLock",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct Lock",
        "components": [
          {
            "name": "creator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "creatorBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "integratorBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "protocolBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "lockedAt",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "integrator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "poolId",
            "type": "bytes32",
            "internalType": "PoolId"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isLocked",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "lockCount",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "maxIntegratorBps",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "maxProtocolBps",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "minProtocolBps",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pendingCreator",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "positionManager",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract ICLPositionManager"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "protocolRecipient",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "skim",
    "inputs": [
      {
        "name": "currency",
        "type": "address",
        "internalType": "Currency"
      }
    ],
    "outputs": [
      {
        "name": "surplus",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "splitAmount",
    "inputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "creatorBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "integratorBps",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "outputs": [
      {
        "name": "creatorShare",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "integratorShare",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "protocolShare",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "totalOwed",
    "inputs": [
      {
        "name": "currency",
        "type": "address",
        "internalType": "Currency"
      }
    ],
    "outputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "transferCreator",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "newCreator",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "vault",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  }
] as const satisfies Abi;

/**
 * `LatchBinLPLocker` - the permanent Bin share locker. `collectFees` and `skim` are permissionless.
 *
 * 27 errors, 7 events, 27 functions - curated from the compiled artifact, not the full ABI.
 */
export const LATCH_BIN_LP_LOCKER_ABI = [
  {
    "type": "error",
    "name": "BinIdsNotStrictlyIncreasing",
    "inputs": [
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "BpsDoNotSumToDenominator",
    "inputs": [
      {
        "name": "sum",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "EmptyBin",
    "inputs": [
      {
        "name": "binId",
        "type": "uint24",
        "internalType": "uint24"
      }
    ]
  },
  {
    "type": "error",
    "name": "HookInterceptsRemoval",
    "inputs": [
      {
        "name": "hook",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "IntegratorBpsTooHigh",
    "inputs": [
      {
        "name": "integratorBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "maxIntegratorBps",
        "type": "uint16",
        "internalType": "uint16"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidBinCount",
    "inputs": [
      {
        "name": "count",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxBinsPerLock",
        "type": "uint16",
        "internalType": "uint16"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidBpsBounds",
    "inputs": [
      {
        "name": "minProtocolBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "maxProtocolBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "maxIntegratorBps",
        "type": "uint16",
        "internalType": "uint16"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidCreator",
    "inputs": [
      {
        "name": "creator",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidIntegrator",
    "inputs": [
      {
        "name": "integrator",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "integratorBps",
        "type": "uint16",
        "internalType": "uint16"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidMaxBinsPerLock",
    "inputs": [
      {
        "name": "maxBinsPerLock",
        "type": "uint16",
        "internalType": "uint16"
      }
    ]
  },
  {
    "type": "error",
    "name": "LengthMismatch",
    "inputs": [
      {
        "name": "binIds",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "shares",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotCreator",
    "inputs": [
      {
        "name": "lockId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotLocked",
    "inputs": [
      {
        "name": "lockId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "NotPendingCreator",
    "inputs": [
      {
        "name": "lockId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "NothingToClaim",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NothingToCollect",
    "inputs": [
      {
        "name": "lockId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "NothingToSkim",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PoolManagerMismatch",
    "inputs": [
      {
        "name": "poolManager",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "PositionManagerHasNoPoolManager",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PositionManagerHasNoVault",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ProtocolBpsOutOfRange",
    "inputs": [
      {
        "name": "protocolBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "minProtocolBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "maxProtocolBps",
        "type": "uint16",
        "internalType": "uint16"
      }
    ]
  },
  {
    "type": "error",
    "name": "ProtocolRecipientIsLocker",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ReentrancyGuardReentrantCall",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SharesNotReceived",
    "inputs": [
      {
        "name": "binId",
        "type": "uint24",
        "internalType": "uint24"
      },
      {
        "name": "expected",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "received",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnexpectedNativeSender",
    "inputs": [
      {
        "name": "sender",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroShares",
    "inputs": [
      {
        "name": "binId",
        "type": "uint24",
        "internalType": "uint24"
      }
    ]
  },
  {
    "type": "event",
    "name": "BinsLocked",
    "inputs": [
      {
        "name": "lockId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "poolId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "PoolId"
      },
      {
        "name": "creator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "integrator",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "creatorBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "integratorBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "protocolBps",
        "type": "uint16",
        "indexed": false,
        "internalType": "uint16"
      },
      {
        "name": "binIds",
        "type": "uint24[]",
        "indexed": false,
        "internalType": "uint24[]"
      },
      {
        "name": "shares",
        "type": "uint256[]",
        "indexed": false,
        "internalType": "uint256[]"
      },
      {
        "name": "principals",
        "type": "uint256[]",
        "indexed": false,
        "internalType": "uint256[]"
      },
      {
        "name": "from",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Claimed",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "currency",
        "type": "address",
        "indexed": true,
        "internalType": "Currency"
      },
      {
        "name": "to",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CreatorTransferStarted",
    "inputs": [
      {
        "name": "lockId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "creator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "pending",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "CreatorTransferred",
    "inputs": [
      {
        "name": "lockId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "previousCreator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newCreator",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "FeeSharesBurned",
    "inputs": [
      {
        "name": "lockId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "caller",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "binIds",
        "type": "uint256[]",
        "indexed": false,
        "internalType": "uint256[]"
      },
      {
        "name": "sharesBurned",
        "type": "uint256[]",
        "indexed": false,
        "internalType": "uint256[]"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "FeesCollected",
    "inputs": [
      {
        "name": "lockId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "currency",
        "type": "address",
        "indexed": true,
        "internalType": "Currency"
      },
      {
        "name": "caller",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "creatorShare",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "integratorShare",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "protocolShare",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Skimmed",
    "inputs": [
      {
        "name": "currency",
        "type": "address",
        "indexed": true,
        "internalType": "Currency"
      },
      {
        "name": "caller",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "function",
    "name": "BPS_DENOMINATOR",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "MAX_BINS_HARD_CAP",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "acceptCreator",
    "inputs": [
      {
        "name": "lockId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "binPoolManager",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IBinPoolManager"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "claim",
    "inputs": [
      {
        "name": "currency",
        "type": "address",
        "internalType": "Currency"
      },
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claimable",
    "inputs": [
      {
        "name": "account",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "currency",
        "type": "address",
        "internalType": "Currency"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "collectFees",
    "inputs": [
      {
        "name": "lockId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "amount0",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "amount1",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getLock",
    "inputs": [
      {
        "name": "lockId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct BinLock",
        "components": [
          {
            "name": "creator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "creatorBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "integratorBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "protocolBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "lockedAt",
            "type": "uint48",
            "internalType": "uint48"
          },
          {
            "name": "integrator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "binCount",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "poolId",
            "type": "bytes32",
            "internalType": "PoolId"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getLockedBins",
    "inputs": [
      {
        "name": "lockId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "binIds",
        "type": "uint24[]",
        "internalType": "uint24[]"
      },
      {
        "name": "shares",
        "type": "uint256[]",
        "internalType": "uint256[]"
      },
      {
        "name": "principals",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getPoolKey",
    "inputs": [
      {
        "name": "lockId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          },
          {
            "name": "poolManager",
            "type": "address",
            "internalType": "contract IPoolManager"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "parameters",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "harvestableShares",
    "inputs": [
      {
        "name": "shares",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "principal",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "binReserveX",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "binReserveY",
        "type": "uint128",
        "internalType": "uint128"
      },
      {
        "name": "binLiquidity",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "binShares",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "burn",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "isLocked",
    "inputs": [
      {
        "name": "lockId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "lock",
    "inputs": [
      {
        "name": "key",
        "type": "tuple",
        "internalType": "struct PoolKey",
        "components": [
          {
            "name": "currency0",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "currency1",
            "type": "address",
            "internalType": "Currency"
          },
          {
            "name": "hooks",
            "type": "address",
            "internalType": "contract IHooks"
          },
          {
            "name": "poolManager",
            "type": "address",
            "internalType": "contract IPoolManager"
          },
          {
            "name": "fee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "parameters",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "binIds",
        "type": "uint24[]",
        "internalType": "uint24[]"
      },
      {
        "name": "shares",
        "type": "uint256[]",
        "internalType": "uint256[]"
      },
      {
        "name": "p",
        "type": "tuple",
        "internalType": "struct LockParams",
        "components": [
          {
            "name": "creator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "creatorBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "integrator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "integratorBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "protocolBps",
            "type": "uint16",
            "internalType": "uint16"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "lockId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "lockCount",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "maxBinsPerLock",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "maxIntegratorBps",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "maxProtocolBps",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "minProtocolBps",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pendingCreator",
    "inputs": [
      {
        "name": "lockId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "positionManager",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IBinPositionManager"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "previewCollect",
    "inputs": [
      {
        "name": "lockId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "sharesToBurn",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "protocolRecipient",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "skim",
    "inputs": [
      {
        "name": "currency",
        "type": "address",
        "internalType": "Currency"
      }
    ],
    "outputs": [
      {
        "name": "surplus",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "splitAmount",
    "inputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "creatorBps",
        "type": "uint16",
        "internalType": "uint16"
      },
      {
        "name": "integratorBps",
        "type": "uint16",
        "internalType": "uint16"
      }
    ],
    "outputs": [
      {
        "name": "creatorShare",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "integratorShare",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "protocolShare",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "totalOwed",
    "inputs": [
      {
        "name": "currency",
        "type": "address",
        "internalType": "Currency"
      }
    ],
    "outputs": [
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "transferCreator",
    "inputs": [
      {
        "name": "lockId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "newCreator",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "vault",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  }
] as const satisfies Abi;
