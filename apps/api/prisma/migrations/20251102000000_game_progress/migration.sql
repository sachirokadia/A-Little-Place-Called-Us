-- Phase 1 addition, hand-written following the 20251101000000_init pattern.
-- Minimal GameProgress model only: no API route reads or writes it yet,
-- and no client score is ever trusted. This reserves the shape Phase 1B
-- will use, with server-validated progress data. It does not add a game,
-- a score endpoint, or any button.

-- CreateTable
CREATE TABLE "GameProgress" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "gameKey" TEXT NOT NULL,
    "progress" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GameProgress_spaceId_playerId_gameKey_key" ON "GameProgress"("spaceId", "playerId", "gameKey");

-- CreateIndex
CREATE INDEX "GameProgress_spaceId_playerId_idx" ON "GameProgress"("spaceId", "playerId");

-- AddForeignKey
ALTER TABLE "GameProgress" ADD CONSTRAINT "GameProgress_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameProgress" ADD CONSTRAINT "GameProgress_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
