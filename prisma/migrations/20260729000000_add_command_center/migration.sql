-- AlterTable
ALTER TABLE "AnomalyFlag" ADD COLUMN     "entityId" TEXT,
ADD COLUMN     "entityType" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "liveAvailability" TEXT NOT NULL DEFAULT 'OFFLINE';

-- CreateTable
CREATE TABLE "DepartmentHealthSnapshot" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "health" TEXT NOT NULL,
    "score" DECIMAL(5,2) NOT NULL,
    "metricsJson" JSONB NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepartmentHealthSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DepartmentHealthSnapshot_orgId_department_calculatedAt_idx" ON "DepartmentHealthSnapshot"("orgId", "department", "calculatedAt");

-- CreateIndex
CREATE INDEX "AnomalyFlag_orgId_entityType_entityId_idx" ON "AnomalyFlag"("orgId", "entityType", "entityId");

-- AddForeignKey
ALTER TABLE "DepartmentHealthSnapshot" ADD CONSTRAINT "DepartmentHealthSnapshot_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
