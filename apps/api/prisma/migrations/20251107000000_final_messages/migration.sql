-- Personalisation: DB-backed shared final messages (one row per
-- space per kind). Follows the ChestReward pattern: shared config,
-- either space member may overwrite; the space FK cascades on
-- delete. `kind` is restricted to the two known messages by a
-- CHECK, since Prisma cannot express a string enum here. Length
-- rules live in the API's zod schema, not here. No seed data: when
-- no row exists, the frontend shows the code drafts, labelled as
-- drafts.

-- CreateTable
CREATE TABLE "FinalMessage" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinalMessage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FinalMessage_kind_check" CHECK ("kind" IN ('star-letter', 'hero-final'))
);

-- CreateIndex
CREATE UNIQUE INDEX "FinalMessage_spaceId_kind_key" ON "FinalMessage"("spaceId", "kind");
CREATE INDEX "FinalMessage_spaceId_idx" ON "FinalMessage"("spaceId");

-- AddForeignKey
ALTER TABLE "FinalMessage" ADD CONSTRAINT "FinalMessage_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinalMessage" ADD CONSTRAINT "FinalMessage_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
