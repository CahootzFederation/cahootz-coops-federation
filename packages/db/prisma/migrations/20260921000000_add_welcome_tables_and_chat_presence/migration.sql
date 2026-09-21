-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "capacity" INTEGER,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "welcomeTableNumber" INTEGER,
ADD COLUMN     "welcomeTableStatus" TEXT;

-- AlterTable
ALTER TABLE "GroupMember" ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'MEMBER';

-- CreateTable
CREATE TABLE "WelcomeTableConfig" (
    "id" TEXT NOT NULL,
    "coopId" TEXT NOT NULL DEFAULT 'cahootz',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "capacity" INTEGER NOT NULL DEFAULT 30,
    "guideUserId" TEXT,
    "lastTableNumber" INTEGER NOT NULL DEFAULT 0,
    "activeTableId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WelcomeTableConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CircleChatPresence" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exitedAt" TIMESTAMP(3),

    CONSTRAINT "CircleChatPresence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WelcomeTableConfig_coopId_key" ON "WelcomeTableConfig"("coopId");

-- CreateIndex
CREATE UNIQUE INDEX "WelcomeTableConfig_activeTableId_key" ON "WelcomeTableConfig"("activeTableId");

-- CreateIndex
CREATE INDEX "CircleChatPresence_groupId_exitedAt_lastActivityAt_idx" ON "CircleChatPresence"("groupId", "exitedAt", "lastActivityAt");

-- CreateIndex
CREATE UNIQUE INDEX "CircleChatPresence_groupId_userId_key" ON "CircleChatPresence"("groupId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Group_coopId_kind_welcomeTableNumber_key" ON "Group"("coopId", "kind", "welcomeTableNumber");

-- AddForeignKey
ALTER TABLE "WelcomeTableConfig" ADD CONSTRAINT "WelcomeTableConfig_guideUserId_fkey" FOREIGN KEY ("guideUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WelcomeTableConfig" ADD CONSTRAINT "WelcomeTableConfig_activeTableId_fkey" FOREIGN KEY ("activeTableId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CircleChatPresence" ADD CONSTRAINT "CircleChatPresence_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CircleChatPresence" ADD CONSTRAINT "CircleChatPresence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
