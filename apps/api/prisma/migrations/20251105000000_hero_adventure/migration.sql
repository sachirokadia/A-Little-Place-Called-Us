-- Personalized adventure: hero missions for a space. Hand-written
-- following the 20251104000000_boyfriend_arcade pattern (Prisma is
-- the sole schema authority; see schema.prisma). All rows are
-- space-scoped with the space FK on DELETE CASCADE. Length/range
-- rules live in the API's zod schemas, not here. The reward link
-- columns are plain ids with no FK: deleting a linked
-- memory/letter/appreciation never cascades into the mission, and
-- reward-link validity (same space, not deleted, visible to the
-- creator) is enforced by the route layer. No seed data: missions
-- are created by space members through the API only.

-- CreateTable
CREATE TABLE "HeroMission" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "levelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "clue" TEXT NOT NULL,
    "rewardMessage" TEXT NOT NULL,
    "rewardMemoryId" TEXT,
    "rewardLetterId" TEXT,
    "rewardAppreciationId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HeroMission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HeroMission_spaceId_levelId_idx" ON "HeroMission"("spaceId", "levelId");

-- AddForeignKey
ALTER TABLE "HeroMission" ADD CONSTRAINT "HeroMission_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeroMission" ADD CONSTRAINT "HeroMission_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
