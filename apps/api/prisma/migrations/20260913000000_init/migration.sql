-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PoolType" AS ENUM ('CL', 'BIN');

-- CreateEnum
CREATE TYPE "LiquidityEventKind" AS ENUM ('MODIFY', 'MINT', 'BURN');

-- CreateEnum
CREATE TYPE "PoolFeeUpdateKind" AS ENUM ('PROTOCOL_FEE', 'DYNAMIC_LP_FEE');

-- CreateEnum
CREATE TYPE "FeeCollectionVia" AS ENUM ('COLLECT', 'SWEEP', 'INNER_CALL');

-- CreateEnum
CREATE TYPE "RunKind" AS ENUM ('INDEX', 'SNAPSHOT', 'GOVERNANCE_SNAPSHOT', 'FEEDS', 'USAGE_FLUSH');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('VERIFIED', 'MISMATCH', 'UNAVAILABLE', 'ERROR');

-- CreateEnum
CREATE TYPE "RevenueSource" AS ENUM ('PROTOCOL_FEE_COLLECTED', 'PROTOCOL_FEE_SWEPT', 'REVSHARE_PROTOCOL_CLAIM', 'LP_LOCKER_PROTOCOL_CLAIM', 'LP_LOCKER_INTEGRATOR_CLAIM', 'KIT_LAUNCH_FEE');

-- CreateEnum
CREATE TYPE "ApiKeyStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "ListingKind" AS ENUM ('LATCH', 'LAUNCH', 'LAUNCHPAD', 'TOKEN');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('UNKNOWN', 'NONE', 'QUEUED', 'ARMED', 'EXPIRED');

-- CreateTable
CREATE TABLE "chains" (
    "id" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isMainnet" BOOLEAN NOT NULL,
    "deployedAtBlock" BIGINT NOT NULL,
    "contractBlockClock" TEXT NOT NULL,
    "contractBlockTimeCentis" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indexer_checkpoints" (
    "chainId" INTEGER NOT NULL,
    "lastIndexedBlock" BIGINT NOT NULL,
    "lastIndexedBlockHash" TEXT NOT NULL,
    "lastIndexedBlockTimestamp" TIMESTAMP(3) NOT NULL,
    "addressSetHash" TEXT NOT NULL,
    "headBlock" BIGINT NOT NULL,
    "headObservedAt" TIMESTAMP(3) NOT NULL,
    "contractBlockNumber" BIGINT,
    "contractClockMethod" TEXT,
    "contractClockRpcBlock" BIGINT,
    "contractClockTimestamp" TIMESTAMP(3),
    "contractClockReadAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "indexer_checkpoints_pkey" PRIMARY KEY ("chainId")
);

-- CreateTable
CREATE TABLE "indexer_runs" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "kind" "RunKind" NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "fromBlock" BIGINT,
    "toBlock" BIGINT,
    "logsFetched" INTEGER NOT NULL DEFAULT 0,
    "rowsWritten" INTEGER NOT NULL DEFAULT 0,
    "endpointHost" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "indexer_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reorg_events" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "atBlock" BIGINT NOT NULL,
    "storedHash" TEXT NOT NULL,
    "observedHash" TEXT NOT NULL,
    "rewoundTo" BIGINT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reorg_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pools" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "poolId" TEXT NOT NULL,
    "poolType" "PoolType" NOT NULL,
    "poolManager" TEXT NOT NULL,
    "currency0" TEXT NOT NULL,
    "currency1" TEXT NOT NULL,
    "hooks" TEXT NOT NULL,
    "fee" INTEGER NOT NULL,
    "parameters" TEXT NOT NULL,
    "hookBitmap" INTEGER NOT NULL,
    "tickSpacing" INTEGER,
    "binStep" INTEGER,
    "initSqrtPriceX96" DECIMAL(78,0),
    "initTick" INTEGER,
    "initActiveId" INTEGER,
    "blockNumber" BIGINT NOT NULL,
    "blockTimestamp" TIMESTAMP(3) NOT NULL,
    "txHash" TEXT NOT NULL,
    "txIndex" INTEGER NOT NULL,
    "logIndex" INTEGER NOT NULL,

    CONSTRAINT "pools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "swaps" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "poolRowId" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "poolType" "PoolType" NOT NULL,
    "sender" TEXT NOT NULL,
    "txFrom" TEXT,
    "amount0" DECIMAL(78,0) NOT NULL,
    "amount1" DECIMAL(78,0) NOT NULL,
    "zeroForOne" BOOLEAN NOT NULL,
    "tokenIn" TEXT NOT NULL,
    "tokenOut" TEXT NOT NULL,
    "amountIn" DECIMAL(78,0) NOT NULL,
    "amountOut" DECIMAL(78,0) NOT NULL,
    "fee" INTEGER NOT NULL,
    "protocolFee" INTEGER NOT NULL,
    "feeTotal" DECIMAL(78,0) NOT NULL,
    "feeProtocol" DECIMAL(78,0) NOT NULL,
    "feeLp" DECIMAL(78,0) NOT NULL,
    "sqrtPriceX96" DECIMAL(78,0),
    "liquidity" DECIMAL(78,0),
    "tick" INTEGER,
    "activeId" INTEGER,
    "blockNumber" BIGINT NOT NULL,
    "blockTimestamp" TIMESTAMP(3) NOT NULL,
    "txHash" TEXT NOT NULL,
    "txIndex" INTEGER NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "contract" TEXT NOT NULL,

    CONSTRAINT "swaps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidity_events" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "poolRowId" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "kind" "LiquidityEventKind" NOT NULL,
    "sender" TEXT NOT NULL,
    "salt" TEXT NOT NULL,
    "tickLower" INTEGER,
    "tickUpper" INTEGER,
    "liquidityDelta" DECIMAL(78,0),
    "binIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "packedAmounts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "blockNumber" BIGINT NOT NULL,
    "blockTimestamp" TIMESTAMP(3) NOT NULL,
    "txHash" TEXT NOT NULL,
    "txIndex" INTEGER NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "contract" TEXT NOT NULL,

    CONSTRAINT "liquidity_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pool_fee_updates" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "poolId" TEXT NOT NULL,
    "kind" "PoolFeeUpdateKind" NOT NULL,
    "value" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockTimestamp" TIMESTAMP(3) NOT NULL,
    "txHash" TEXT NOT NULL,
    "txIndex" INTEGER NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "contract" TEXT NOT NULL,

    CONSTRAINT "pool_fee_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revshare_takes" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "hook" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "lpDonated" DECIMAL(78,0) NOT NULL,
    "toBeneficiaries" DECIMAL(78,0) NOT NULL,
    "toDistributor" DECIMAL(78,0) NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockTimestamp" TIMESTAMP(3) NOT NULL,
    "txHash" TEXT NOT NULL,
    "txIndex" INTEGER NOT NULL,
    "logIndex" INTEGER NOT NULL,

    CONSTRAINT "revshare_takes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revshare_claims" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "hook" TEXT NOT NULL,
    "beneficiary" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "amount" DECIMAL(78,0) NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockTimestamp" TIMESTAMP(3) NOT NULL,
    "txHash" TEXT NOT NULL,
    "txIndex" INTEGER NOT NULL,
    "logIndex" INTEGER NOT NULL,

    CONSTRAINT "revshare_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "protocol_fee_collections" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "controller" TEXT NOT NULL,
    "poolManager" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "amount" DECIMAL(78,0) NOT NULL,
    "via" "FeeCollectionVia" NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockTimestamp" TIMESTAMP(3) NOT NULL,
    "txHash" TEXT NOT NULL,
    "txIndex" INTEGER NOT NULL,
    "logIndex" INTEGER NOT NULL,

    CONSTRAINT "protocol_fee_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "launches" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "kit" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "launchToken" TEXT NOT NULL,
    "quoteToken" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "startContractBlock" BIGINT NOT NULL,
    "decayContractBlocks" INTEGER NOT NULL,
    "initialFeeBips" INTEGER NOT NULL,
    "finalFeeBips" INTEGER NOT NULL,
    "maxBuyPerTx" DECIMAL(78,0) NOT NULL,
    "launchTokenIsCurrency0" BOOLEAN NOT NULL,
    "preset" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockTimestamp" TIMESTAMP(3) NOT NULL,
    "txHash" TEXT NOT NULL,
    "txIndex" INTEGER NOT NULL,
    "logIndex" INTEGER NOT NULL,

    CONSTRAINT "launches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_events" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractKey" TEXT NOT NULL,
    "contract" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "subject" TEXT,
    "args" JSONB NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockTimestamp" TIMESTAMP(3) NOT NULL,
    "txHash" TEXT NOT NULL,
    "txIndex" INTEGER NOT NULL,
    "logIndex" INTEGER NOT NULL,

    CONSTRAINT "contract_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timelock_events" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "timelock" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "operationId" TEXT,
    "callIndex" INTEGER,
    "target" TEXT,
    "value" DECIMAL(78,0),
    "data" TEXT,
    "selector" TEXT,
    "functionSignature" TEXT,
    "predecessor" TEXT,
    "delaySeconds" BIGINT,
    "hazard" TEXT,
    "hazardNote" TEXT,
    "blockNumber" BIGINT NOT NULL,
    "blockTimestamp" TIMESTAMP(3) NOT NULL,
    "txHash" TEXT NOT NULL,
    "txIndex" INTEGER NOT NULL,
    "logIndex" INTEGER NOT NULL,

    CONSTRAINT "timelock_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_ledger" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "source" "RevenueSource" NOT NULL,
    "token" TEXT NOT NULL,
    "amount" DECIMAL(78,0) NOT NULL,
    "counterparty" TEXT,
    "contract" TEXT NOT NULL,
    "poolId" TEXT,
    "usdValue" TEXT,
    "usdSource" TEXT,
    "usdPricedAt" TIMESTAMP(3),
    "blockNumber" BIGINT NOT NULL,
    "blockTimestamp" TIMESTAMP(3) NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,

    CONSTRAINT "revenue_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tokens" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "symbol" TEXT,
    "name" TEXT,
    "decimals" INTEGER,
    "totalSupply" DECIMAL(78,0),
    "inAddressBook" BOOLEAN NOT NULL DEFAULT false,
    "isTestToken" BOOLEAN,
    "uiMultiplier" DECIMAL(78,0),
    "readAtBlock" BIGINT,
    "readAt" TIMESTAMP(3),
    "readError" TEXT,

    CONSTRAINT "tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pool_states" (
    "poolRowId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "sqrtPriceX96" DECIMAL(78,0),
    "tick" INTEGER,
    "liquidity" DECIMAL(78,0),
    "activeId" INTEGER,
    "protocolFee" INTEGER,
    "lpFee" INTEGER,
    "readAtBlock" BIGINT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL,
    "readError" TEXT,

    CONSTRAINT "pool_states_pkey" PRIMARY KEY ("poolRowId")
);

-- CreateTable
CREATE TABLE "protocol_fee_accrual_snapshots" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "poolManager" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(78,0) NOT NULL,
    "readAtBlock" BIGINT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "protocol_fee_accrual_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feed_observations" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "proxy" TEXT NOT NULL,
    "description" TEXT,
    "roundId" DECIMAL(78,0),
    "answer" DECIMAL(78,0),
    "decimals" INTEGER,
    "feedUpdatedAt" TIMESTAMP(3),
    "readAtBlock" BIGINT NOT NULL,
    "blockTimestamp" TIMESTAMP(3) NOT NULL,
    "stalenessSeconds" INTEGER,
    "heartbeatSeconds" INTEGER NOT NULL,
    "heartbeatViolation" BOOLEAN,
    "error" TEXT,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feed_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliations" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "atBlock" BIGINT NOT NULL,
    "expected" TEXT,
    "observed" TEXT,
    "status" "ReconciliationStatus" NOT NULL,
    "detail" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ownership_snapshots" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractKey" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "check" TEXT NOT NULL,
    "observed" TEXT,
    "expectedTier" TEXT NOT NULL,
    "expectedAddress" TEXT,
    "matches" BOOLEAN,
    "readError" TEXT,
    "readAtBlock" BIGINT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ownership_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_config_hazards" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "hook" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "shape" TEXT NOT NULL,
    "effectiveContractBlock" BIGINT NOT NULL,
    "expiryContractBlock" BIGINT,
    "params" JSONB NOT NULL,
    "status" "ProposalStatus" NOT NULL,
    "contractBlockNumber" BIGINT NOT NULL,
    "contractClockMethod" TEXT NOT NULL,
    "readAtBlock" BIGINT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL,
    "readError" TEXT,

    CONSTRAINT "pending_config_hazards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_balances" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "balanceWei" DECIMAL(78,0) NOT NULL,
    "minWei" DECIMAL(78,0),
    "belowMin" BOOLEAN,
    "readAtBlock" BIGINT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ops_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_submissions" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "kind" "ListingKind" NOT NULL,
    "subjectAddress" TEXT,
    "poolId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "websiteUrl" TEXT,
    "iconAssetRef" TEXT,
    "contactPrivate" TEXT,
    "submittedBy" TEXT,
    "status" "ListingStatus" NOT NULL DEFAULT 'PENDING',
    "reviewer" TEXT,
    "reviewNotes" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listing_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_nonces" (
    "nonce" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "ip" TEXT,

    CONSTRAINT "admin_nonces_pkey" PRIMARY KEY ("nonce")
);

-- CreateTable
CREATE TABLE "admin_sessions" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "roles" TEXT[],
    "csrfHash" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastRoleCheckAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "actorRoles" TEXT[],
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "requestId" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "billingProvider" TEXT,
    "billingCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "rateLimitPerMinute" INTEGER NOT NULL,
    "monthlyQuota" INTEGER NOT NULL,
    "status" "ApiKeyStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_usage_monthly" (
    "keyId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "requests" BIGINT NOT NULL DEFAULT 0,
    "flushedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_usage_monthly_pkey" PRIMARY KEY ("keyId","period")
);

-- CreateIndex
CREATE UNIQUE INDEX "chains_key_key" ON "chains"("key");

-- CreateIndex
CREATE INDEX "indexer_runs_chainId_kind_startedAt_idx" ON "indexer_runs"("chainId", "kind", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "reorg_events_chainId_detectedAt_idx" ON "reorg_events"("chainId", "detectedAt" DESC);

-- CreateIndex
CREATE INDEX "pools_chainId_blockNumber_idx" ON "pools"("chainId", "blockNumber");

-- CreateIndex
CREATE INDEX "pools_chainId_currency0_idx" ON "pools"("chainId", "currency0");

-- CreateIndex
CREATE INDEX "pools_chainId_currency1_idx" ON "pools"("chainId", "currency1");

-- CreateIndex
CREATE INDEX "pools_chainId_hooks_idx" ON "pools"("chainId", "hooks");

-- CreateIndex
CREATE UNIQUE INDEX "pools_chainId_poolId_key" ON "pools"("chainId", "poolId");

-- CreateIndex
CREATE INDEX "swaps_poolRowId_blockNumber_logIndex_idx" ON "swaps"("poolRowId", "blockNumber", "logIndex");

-- CreateIndex
CREATE INDEX "swaps_chainId_blockNumber_idx" ON "swaps"("chainId", "blockNumber");

-- CreateIndex
CREATE INDEX "swaps_chainId_blockTimestamp_idx" ON "swaps"("chainId", "blockTimestamp");

-- CreateIndex
CREATE INDEX "swaps_chainId_tokenIn_blockTimestamp_idx" ON "swaps"("chainId", "tokenIn", "blockTimestamp");

-- CreateIndex
CREATE INDEX "swaps_txHash_idx" ON "swaps"("txHash");

-- CreateIndex
CREATE INDEX "liquidity_events_poolRowId_blockNumber_logIndex_idx" ON "liquidity_events"("poolRowId", "blockNumber", "logIndex");

-- CreateIndex
CREATE INDEX "liquidity_events_chainId_blockNumber_idx" ON "liquidity_events"("chainId", "blockNumber");

-- CreateIndex
CREATE INDEX "pool_fee_updates_chainId_poolId_blockNumber_idx" ON "pool_fee_updates"("chainId", "poolId", "blockNumber");

-- CreateIndex
CREATE INDEX "pool_fee_updates_chainId_blockNumber_idx" ON "pool_fee_updates"("chainId", "blockNumber");

-- CreateIndex
CREATE INDEX "revshare_takes_chainId_hook_poolId_currency_idx" ON "revshare_takes"("chainId", "hook", "poolId", "currency");

-- CreateIndex
CREATE INDEX "revshare_takes_chainId_blockNumber_idx" ON "revshare_takes"("chainId", "blockNumber");

-- CreateIndex
CREATE INDEX "revshare_takes_chainId_blockTimestamp_idx" ON "revshare_takes"("chainId", "blockTimestamp");

-- CreateIndex
CREATE INDEX "revshare_claims_chainId_beneficiary_idx" ON "revshare_claims"("chainId", "beneficiary");

-- CreateIndex
CREATE INDEX "revshare_claims_chainId_blockNumber_idx" ON "revshare_claims"("chainId", "blockNumber");

-- CreateIndex
CREATE INDEX "protocol_fee_collections_chainId_currency_idx" ON "protocol_fee_collections"("chainId", "currency");

-- CreateIndex
CREATE INDEX "protocol_fee_collections_chainId_blockNumber_idx" ON "protocol_fee_collections"("chainId", "blockNumber");

-- CreateIndex
CREATE INDEX "launches_chainId_launchToken_idx" ON "launches"("chainId", "launchToken");

-- CreateIndex
CREATE INDEX "launches_chainId_blockNumber_idx" ON "launches"("chainId", "blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "launches_chainId_kit_poolId_key" ON "launches"("chainId", "kit", "poolId");

-- CreateIndex
CREATE INDEX "contract_events_chainId_contractKey_eventName_idx" ON "contract_events"("chainId", "contractKey", "eventName");

-- CreateIndex
CREATE INDEX "contract_events_chainId_subject_idx" ON "contract_events"("chainId", "subject");

-- CreateIndex
CREATE INDEX "contract_events_chainId_blockNumber_idx" ON "contract_events"("chainId", "blockNumber");

-- CreateIndex
CREATE INDEX "timelock_events_chainId_operationId_idx" ON "timelock_events"("chainId", "operationId");

-- CreateIndex
CREATE INDEX "timelock_events_chainId_hazard_idx" ON "timelock_events"("chainId", "hazard");

-- CreateIndex
CREATE INDEX "timelock_events_chainId_blockNumber_idx" ON "timelock_events"("chainId", "blockNumber");

-- CreateIndex
CREATE INDEX "revenue_ledger_chainId_source_blockTimestamp_idx" ON "revenue_ledger"("chainId", "source", "blockTimestamp");

-- CreateIndex
CREATE INDEX "revenue_ledger_chainId_token_idx" ON "revenue_ledger"("chainId", "token");

-- CreateIndex
CREATE INDEX "revenue_ledger_chainId_blockNumber_idx" ON "revenue_ledger"("chainId", "blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_chainId_address_key" ON "tokens"("chainId", "address");

-- CreateIndex
CREATE INDEX "protocol_fee_accrual_snapshots_chainId_poolManager_currency_idx" ON "protocol_fee_accrual_snapshots"("chainId", "poolManager", "currency", "readAtBlock" DESC);

-- CreateIndex
CREATE INDEX "feed_observations_chainId_proxy_readAtBlock_idx" ON "feed_observations"("chainId", "proxy", "readAtBlock" DESC);

-- CreateIndex
CREATE INDEX "reconciliations_chainId_kind_idx" ON "reconciliations"("chainId", "kind");

-- CreateIndex
CREATE INDEX "ownership_snapshots_chainId_matches_idx" ON "ownership_snapshots"("chainId", "matches");

-- CreateIndex
CREATE INDEX "pending_config_hazards_chainId_status_idx" ON "pending_config_hazards"("chainId", "status");

-- CreateIndex
CREATE INDEX "listing_submissions_status_createdAt_idx" ON "listing_submissions"("status", "createdAt");

-- CreateIndex
CREATE INDEX "admin_nonces_expiresAt_idx" ON "admin_nonces"("expiresAt");

-- CreateIndex
CREATE INDEX "admin_sessions_address_idx" ON "admin_sessions"("address");

-- CreateIndex
CREATE INDEX "audit_log_createdAt_idx" ON "audit_log"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_log_actor_idx" ON "audit_log"("actor");

-- CreateIndex
CREATE UNIQUE INDEX "api_accounts_billingProvider_billingCustomerId_key" ON "api_accounts"("billingProvider", "billingCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_prefix_key" ON "api_keys"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_secretHash_key" ON "api_keys"("secretHash");

-- CreateIndex
CREATE INDEX "api_keys_accountId_idx" ON "api_keys"("accountId");

-- AddForeignKey
ALTER TABLE "swaps" ADD CONSTRAINT "swaps_poolRowId_fkey" FOREIGN KEY ("poolRowId") REFERENCES "pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidity_events" ADD CONSTRAINT "liquidity_events_poolRowId_fkey" FOREIGN KEY ("poolRowId") REFERENCES "pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pool_states" ADD CONSTRAINT "pool_states_poolRowId_fkey" FOREIGN KEY ("poolRowId") REFERENCES "pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "api_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_usage_monthly" ADD CONSTRAINT "api_usage_monthly_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

