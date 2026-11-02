-- Boyfriend Arcade: quiz questions, guess rounds, chest riddles,
-- per-player chest solves, and the single shared chest reward.
-- Hand-written following the 20251102000000_game_progress pattern
-- (Prisma is the sole schema authority; see schema.prisma).
-- All rows are space-scoped with the space FK on DELETE CASCADE.
-- Length/range rules live in the API's zod schemas, not here;
-- the database stores answers as given and the route layer owns
-- normalized (trim + lowercase) comparison and answer masking.

-- CreateTable
CREATE TABLE "QuizQuestion" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" TEXT[] NOT NULL,
    "correctOption" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuizQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuessRound" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "guesserId" TEXT,
    "guessText" TEXT,
    "revealed" BOOLEAN NOT NULL DEFAULT false,
    "correct" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuessRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChestRiddle" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "hint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChestRiddle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChestSolve" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "riddleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChestSolve_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChestReward" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "memoryId" TEXT,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChestReward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuizQuestion_spaceId_createdAt_idx" ON "QuizQuestion"("spaceId", "createdAt");

-- CreateIndex
CREATE INDEX "GuessRound_spaceId_createdAt_idx" ON "GuessRound"("spaceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ChestRiddle_spaceId_sortOrder_idx" ON "ChestRiddle"("spaceId", "sortOrder");

-- CreateIndex
CREATE INDEX "ChestSolve_spaceId_playerId_idx" ON "ChestSolve"("spaceId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "ChestSolve_spaceId_playerId_riddleId_key" ON "ChestSolve"("spaceId", "playerId", "riddleId");

-- CreateIndex
CREATE UNIQUE INDEX "ChestReward_spaceId_key" ON "ChestReward"("spaceId");

-- AddForeignKey
ALTER TABLE "QuizQuestion" ADD CONSTRAINT "QuizQuestion_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizQuestion" ADD CONSTRAINT "QuizQuestion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuessRound" ADD CONSTRAINT "GuessRound_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuessRound" ADD CONSTRAINT "GuessRound_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChestRiddle" ADD CONSTRAINT "ChestRiddle_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChestRiddle" ADD CONSTRAINT "ChestRiddle_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChestSolve" ADD CONSTRAINT "ChestSolve_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChestSolve" ADD CONSTRAINT "ChestSolve_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChestSolve" ADD CONSTRAINT "ChestSolve_riddleId_fkey" FOREIGN KEY ("riddleId") REFERENCES "ChestRiddle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChestReward" ADD CONSTRAINT "ChestReward_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChestReward" ADD CONSTRAINT "ChestReward_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "Memory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChestReward" ADD CONSTRAINT "ChestReward_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
