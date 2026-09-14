-- CreateEnum
CREATE TYPE "LaunchLegKind" AS ENUM ('CL', 'BIN');

-- CreateEnum
CREATE TYPE "FeeFlowKind" AS ENUM ('CREDITED', 'CLAIMED', 'SKIMMED');

-- CreateTable
CREATE TABLE "kit_v2_launches" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "kit" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "creator" TEXT NOT NULL,
    "tenant" TEXT NOT NULL,
    "launcher" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "totalSupply" DECIMAL(78,0) NOT NULL,
    "seedSupply" DECIMAL(78,0) NOT NULL,
    "legCount" INTEGER NOT NULL,
    "startTime" BIGINT NOT NULL,
    "protocolFeeWei" DECIMAL(78,0) NOT NULL,
    "integrator" TEXT NOT NULL,
    "integratorFeeWei" DECIMAL(78,0) NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockTimestamp" TIMESTAMP(3) NOT NULL,
    "txHash" TEXT NOT NULL,
    "txIndex" INTEGER NOT NULL,
    "logIndex" INTEGER NOT NULL,

    CONSTRAINT "kit_v2_launches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kit_v2_launch_legs" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "kit" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "kind" "LaunchLegKind" NOT NULL,
    "lockId" DECIMAL(78,0) NOT NULL,
    "launchTokenSeeded" DECIMAL(78,0) NOT NULL,
    "weightBps" INTEGER NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockTimestamp" TIMESTAMP(3) NOT NULL,
    "txHash" TEXT NOT NULL,
    "txIndex" INTEGER NOT NULL,
    "logIndex" INTEGER NOT NULL,

    CONSTRAINT "kit_v2_launch_legs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lp_locks" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "locker" TEXT NOT NULL,
    "lockerKind" "LaunchLegKind" NOT NULL,
    "lockId" DECIMAL(78,0) NOT NULL,
    "poolId" TEXT NOT NULL,
    "creator" TEXT NOT NULL,
    "integrator" TEXT NOT NULL,
    "creatorBps" INTEGER NOT NULL,
    "integratorBps" INTEGER NOT NULL,
    "protocolBps" INTEGER NOT NULL,
    "liquidity" DECIMAL(78,0),
    "binIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "shares" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "principals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fromAddress" TEXT NOT NULL,
    "operator" TEXT,
    "blockNumber" BIGINT NOT NULL,
    "blockTimestamp" TIMESTAMP(3) NOT NULL,
    "txHash" TEXT NOT NULL,
    "txIndex" INTEGER NOT NULL,
    "logIndex" INTEGER NOT NULL,

    CONSTRAINT "lp_locks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lp_fee_collections" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "locker" TEXT NOT NULL,
    "lockerKind" "LaunchLegKind" NOT NULL,
    "lockId" DECIMAL(78,0) NOT NULL,
    "currency" TEXT NOT NULL,
    "caller" TEXT NOT NULL,
    "amount" DECIMAL(78,0) NOT NULL,
    "creatorShare" DECIMAL(78,0) NOT NULL,
    "integratorShare" DECIMAL(78,0) NOT NULL,
    "protocolShare" DECIMAL(78,0) NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockTimestamp" TIMESTAMP(3) NOT NULL,
    "txHash" TEXT NOT NULL,
    "txIndex" INTEGER NOT NULL,
    "logIndex" INTEGER NOT NULL,

    CONSTRAINT "lp_fee_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_flows" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contract" TEXT NOT NULL,
    "contractRole" TEXT NOT NULL,
    "kind" "FeeFlowKind" NOT NULL,
    "account" TEXT,
    "to" TEXT,
    "caller" TEXT,
    "token" TEXT NOT NULL,
    "amount" DECIMAL(78,0) NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "blockTimestamp" TIMESTAMP(3) NOT NULL,
    "txHash" TEXT NOT NULL,
    "txIndex" INTEGER NOT NULL,
    "logIndex" INTEGER NOT NULL,

    CONSTRAINT "fee_flows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kit_v2_launches_chainId_blockNumber_idx" ON "kit_v2_launches"("chainId", "blockNumber");

-- CreateIndex
CREATE INDEX "kit_v2_launches_chainId_creator_idx" ON "kit_v2_launches"("chainId", "creator");

-- CreateIndex
CREATE INDEX "kit_v2_launches_chainId_tenant_idx" ON "kit_v2_launches"("chainId", "tenant");

-- CreateIndex
CREATE UNIQUE INDEX "kit_v2_launches_chainId_kit_token_key" ON "kit_v2_launches"("chainId", "kit", "token");

-- CreateIndex
CREATE INDEX "kit_v2_launch_legs_chainId_token_idx" ON "kit_v2_launch_legs"("chainId", "token");

-- CreateIndex
CREATE INDEX "kit_v2_launch_legs_chainId_blockNumber_idx" ON "kit_v2_launch_legs"("chainId", "blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "kit_v2_launch_legs_chainId_kit_poolId_key" ON "kit_v2_launch_legs"("chainId", "kit", "poolId");

-- CreateIndex
CREATE INDEX "lp_locks_chainId_poolId_idx" ON "lp_locks"("chainId", "poolId");

-- CreateIndex
CREATE INDEX "lp_locks_chainId_blockNumber_idx" ON "lp_locks"("chainId", "blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "lp_locks_chainId_locker_lockId_key" ON "lp_locks"("chainId", "locker", "lockId");

-- CreateIndex
CREATE INDEX "lp_fee_collections_chainId_locker_lockId_idx" ON "lp_fee_collections"("chainId", "locker", "lockId");

-- CreateIndex
CREATE INDEX "lp_fee_collections_chainId_currency_idx" ON "lp_fee_collections"("chainId", "currency");

-- CreateIndex
CREATE INDEX "lp_fee_collections_chainId_blockNumber_idx" ON "lp_fee_collections"("chainId", "blockNumber");

-- CreateIndex
CREATE INDEX "fee_flows_chainId_contract_kind_idx" ON "fee_flows"("chainId", "contract", "kind");

-- CreateIndex
CREATE INDEX "fee_flows_chainId_account_idx" ON "fee_flows"("chainId", "account");

-- CreateIndex
CREATE INDEX "fee_flows_chainId_blockNumber_idx" ON "fee_flows"("chainId", "blockNumber");

