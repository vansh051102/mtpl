-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "leadId" TEXT;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "isArchived" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "AuditLog_leadId_idx" ON "AuditLog"("leadId");

-- CreateIndex
CREATE INDEX "PurchaseRequest_leadId_status_idx" ON "PurchaseRequest"("leadId", "status");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: most AuditLog rows with resourceType = 'Lead' store the lead's
-- real id in resourceId. Exception: bulk import/export audit entries use
-- the literal string 'bulk' as resourceId (see lib/audit.ts callers in
-- app/api/v1/leads/import and export routes) — not a real Lead id, so the
-- FK above would reject it. Only copy resourceId -> leadId where it
-- actually matches an existing Lead row.
UPDATE "AuditLog" a SET "leadId" = a."resourceId"
WHERE a."resourceType" = 'Lead'
  AND a."leadId" IS NULL
  AND EXISTS (SELECT 1 FROM "Lead" l WHERE l.id = a."resourceId");
