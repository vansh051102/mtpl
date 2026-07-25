-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "contactId" TEXT,
ALTER COLUMN "leadId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "disqualifiedDetails" TEXT,
ADD COLUMN     "disqualifiedReason" TEXT,
ADD COLUMN     "lastCallDate" TIMESTAMP(3),
ADD COLUMN     "lastCallOutcome" TEXT,
ADD COLUMN     "lockedByUserId" TEXT,
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "nextFollowupDate" TIMESTAMP(3),
ADD COLUMN     "nextFollowupTimeZone" TEXT,
ADD COLUMN     "stage" TEXT NOT NULL DEFAULT 'New Lead',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "Activity_contactId_idx" ON "Activity"("contactId");

-- CreateIndex
CREATE INDEX "Contact_stage_idx" ON "Contact"("stage");

-- CreateIndex
CREATE INDEX "Contact_nextFollowupDate_idx" ON "Contact"("nextFollowupDate");

-- CreateIndex
CREATE INDEX "Contact_lockedByUserId_idx" ON "Contact"("lockedByUserId");

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
