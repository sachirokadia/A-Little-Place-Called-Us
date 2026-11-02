-- Phase 5: per-user preferences, one row per user (userId unique,
-- cascade on user delete). motion is a plain string with the allowed
-- values enforced by the API's zod schema ('system' | 'reduce' |
-- 'full'); the database default is 'system' and sound defaults OFF.

-- CreateTable
CREATE TABLE "UserPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "motion" TEXT NOT NULL DEFAULT 'system',
    "soundEnabled" BOOLEAN NOT NULL DEFAULT false,
    "onboardingSeen" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserPreference_userId_key" ON "UserPreference"("userId");

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
