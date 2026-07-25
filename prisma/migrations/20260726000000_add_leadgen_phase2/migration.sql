-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "clientMutationId" TEXT,
ADD COLUMN     "ctiVerified" BOOLEAN;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "deletedByUserId" TEXT;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "ctiConfiguredBy" TEXT,
ADD COLUMN     "ctiWebhookSecret" TEXT;

-- CreateTable
CREATE TABLE "WebhookPayload" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "companyName" TEXT,
    "sourceMetadata" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "dlqReason" TEXT,
    "processedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookPayload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PiiViewLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "fieldUnmasked" TEXT NOT NULL,
    "reason" TEXT,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PiiViewLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookPayload_orgId_status_idx" ON "WebhookPayload"("orgId", "status");

-- CreateIndex
CREATE INDEX "WebhookPayload_receivedAt_idx" ON "WebhookPayload"("receivedAt");

-- CreateIndex
CREATE INDEX "PiiViewLog_orgId_userId_viewedAt_idx" ON "PiiViewLog"("orgId", "userId", "viewedAt");

-- CreateIndex
CREATE INDEX "PiiViewLog_contactId_idx" ON "PiiViewLog"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "Activity_contactId_clientMutationId_key" ON "Activity"("contactId", "clientMutationId");

-- CreateIndex
CREATE UNIQUE INDEX "Settings_ctiWebhookSecret_key" ON "Settings"("ctiWebhookSecret");

-- AddForeignKey
ALTER TABLE "WebhookPayload" ADD CONSTRAINT "WebhookPayload_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PiiViewLog" ADD CONSTRAINT "PiiViewLog_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique indexes replacing the old plain @@unique([orgId,email]) /
-- @@unique([orgId,phone]) constraints. Prisma's schema DSL can't express a
-- WHERE clause on a unique constraint (prisma/prisma#7108), so these are
-- managed here only, not declared in schema.prisma. Same soft-delete pattern
-- as Lead already uses. Existing data has no soft-deleted contacts yet, so
-- dropping the old constraints and adding the partial ones is safe with zero
-- rows to reconcile.
DROP INDEX "Contact_orgId_email_key";
DROP INDEX "Contact_orgId_phone_key";

CREATE UNIQUE INDEX "Contact_orgId_email_active_key" ON "Contact"("orgId", "email") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "Contact_orgId_phone_active_key" ON "Contact"("orgId", "phone") WHERE "deletedAt" IS NULL;
