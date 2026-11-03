-- Phase 7: original relationship board game. Hand-written
-- following the 20251105000000_hero_adventure pattern (Prisma is
-- the sole schema authority; see schema.prisma). All rows are
-- space-scoped with the space FK on DELETE CASCADE.
--
-- BoardConfig.config holds the full BoardConfigData JSON; its
-- shape is owned by the shared board engine and validated by the
-- route layer at CREATE/PATCH time. BoardGame.configId is
-- deliberately a PLAIN id with NO foreign key, so deleting a
-- config never deletes a running game; BoardGame.configSnapshot
-- is the full config copied at creation, so mid-game config edits
-- cannot affect a running game. BoardGame.state is the full
-- GameState JSON owned by the engine. Length/range rules live in
-- the API's zod schemas, not here. No seed data: configs are
-- created by space members through the API, except the per-space
-- default config seeded on first GET (see routes/board.ts).
-- Custom terminology only: no third-party board-game name, logo,
-- or card text appears anywhere here.

-- CreateTable
CREATE TABLE "BoardConfig" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoardConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardGame" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "configSnapshot" JSONB NOT NULL,
    "state" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'playing',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoardGame_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BoardConfig_spaceId_createdAt_idx" ON "BoardConfig"("spaceId", "createdAt");

-- CreateIndex
CREATE INDEX "BoardGame_spaceId_createdAt_idx" ON "BoardGame"("spaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "BoardConfig" ADD CONSTRAINT "BoardConfig_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardConfig" ADD CONSTRAINT "BoardConfig_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardGame" ADD CONSTRAINT "BoardGame_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardGame" ADD CONSTRAINT "BoardGame_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- NOTE: intentionally NO foreign key on "BoardGame"."configId".
-- A deleted config must never delete a running game.
