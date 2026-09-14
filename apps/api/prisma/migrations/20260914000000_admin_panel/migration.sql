-- AlterEnum
ALTER TYPE "ListingKind" ADD VALUE 'PROJECT';

-- AlterEnum
ALTER TYPE "ListingStatus" ADD VALUE 'CHANGES_REQUESTED';

-- AlterTable
ALTER TABLE "timelock_events" ADD COLUMN     "salt" TEXT;

-- AlterTable
ALTER TABLE "tokens" ADD COLUMN     "tokenPaused" BOOLEAN;

-- AlterTable
ALTER TABLE "ops_balances" ADD COLUMN     "actionsAffordable" DECIMAL(78,0),
ADD COLUMN     "criticalWei" DECIMAL(78,0),
ADD COLUMN     "gasPriceSource" TEXT,
ADD COLUMN     "gasPriceWei" DECIMAL(78,0),
ADD COLUMN     "rationale" TEXT,
ADD COLUMN     "severity" TEXT;

-- AlterTable
ALTER TABLE "listing_submissions" ADD COLUMN     "category" TEXT,
ADD COLUMN     "categoryOther" TEXT,
ADD COLUMN     "chains" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "iconSourceUrl" TEXT,
ADD COLUMN     "ownLatch" TEXT,
ADD COLUMN     "sourceUrl" TEXT,
ADD COLUMN     "submitterIpHash" TEXT,
ADD COLUMN     "turnstileVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "uses" TEXT[] DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "chainId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "stock_token_observations" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "tokenPaused" BOOLEAN,
    "uiMultiplier" DECIMAL(78,0),
    "changed" BOOLEAN NOT NULL DEFAULT false,
    "previousPaused" BOOLEAN,
    "previousUiMultiplier" DECIMAL(78,0),
    "readAtBlock" BIGINT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readError" TEXT,

    CONSTRAINT "stock_token_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_assets" (
    "id" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "byteLength" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_token_observations_chainId_token_readAtBlock_idx" ON "stock_token_observations"("chainId", "token", "readAtBlock" DESC);

-- CreateIndex
CREATE INDEX "stock_token_observations_chainId_changed_readAt_idx" ON "stock_token_observations"("chainId", "changed", "readAt" DESC);

-- CreateIndex
CREATE INDEX "listing_assets_sha256_idx" ON "listing_assets"("sha256");

