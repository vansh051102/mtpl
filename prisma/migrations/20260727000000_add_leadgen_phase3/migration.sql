-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "consentTimestamp" TIMESTAMP(3),
ADD COLUMN     "dncStatus" TEXT NOT NULL DEFAULT 'CLEARED',
ADD COLUMN     "isDncListed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "optOutSource" TEXT;

-- CreateTable
CREATE TABLE "LeadFieldDiff" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "modifiedByUserId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadFieldDiff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnomalyFlag" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contactId" TEXT,
    "flagType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "flaggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolution" TEXT,

    CONSTRAINT "AnomalyFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadFieldDiff_contactId_idx" ON "LeadFieldDiff"("contactId");

-- CreateIndex
CREATE INDEX "LeadFieldDiff_orgId_createdAt_idx" ON "LeadFieldDiff"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "AnomalyFlag_orgId_resolvedAt_idx" ON "AnomalyFlag"("orgId", "resolvedAt");

-- CreateIndex
CREATE INDEX "AnomalyFlag_userId_idx" ON "AnomalyFlag"("userId");

-- AddForeignKey
ALTER TABLE "LeadFieldDiff" ADD CONSTRAINT "LeadFieldDiff_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnomalyFlag" ADD CONSTRAINT "AnomalyFlag_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
