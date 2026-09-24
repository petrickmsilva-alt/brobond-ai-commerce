-- PR011 — AI CEO & Autonomous Decisions
-- Advisory architecture only: no trigger or foreign key invokes a commerce action.

CREATE TYPE "DecisionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXECUTED');
CREATE TYPE "DecisionPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

CREATE TABLE "AIDecisionRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "inputSnapshot" JSONB NOT NULL,
    "rawResponse" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AIDecisionRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AIDecision" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "priority" "DecisionPriority" NOT NULL,
    "status" "DecisionStatus" NOT NULL DEFAULT 'PENDING',
    "confidence" DOUBLE PRECISION NOT NULL,
    "category" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "potentialRevenueCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AIDecision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DecisionEvidence" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DecisionEvidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExecutiveReport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reportDate" DATE NOT NULL,
    "summary" TEXT NOT NULL,
    "gmvCents" INTEGER NOT NULL,
    "roiBps" INTEGER NOT NULL,
    "creators" INTEGER NOT NULL,
    "products" INTEGER NOT NULL,
    "campaigns" INTEGER NOT NULL,
    "risks" JSONB NOT NULL,
    "opportunities" JSONB NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "inputSnapshot" JSONB NOT NULL,
    "rawResponse" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExecutiveReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AIDecisionRun_organizationId_createdAt_idx" ON "AIDecisionRun"("organizationId", "createdAt");
CREATE INDEX "AIDecisionRun_organizationId_promptVersion_idx" ON "AIDecisionRun"("organizationId", "promptVersion");
CREATE INDEX "AIDecision_organizationId_status_idx" ON "AIDecision"("organizationId", "status");
CREATE INDEX "AIDecision_organizationId_priority_idx" ON "AIDecision"("organizationId", "priority");
CREATE INDEX "AIDecision_organizationId_createdAt_idx" ON "AIDecision"("organizationId", "createdAt");
CREATE INDEX "AIDecision_runId_idx" ON "AIDecision"("runId");
CREATE INDEX "DecisionEvidence_decisionId_idx" ON "DecisionEvidence"("decisionId");
CREATE INDEX "DecisionEvidence_sourceType_sourceId_idx" ON "DecisionEvidence"("sourceType", "sourceId");
CREATE INDEX "ExecutiveReport_organizationId_reportDate_idx" ON "ExecutiveReport"("organizationId", "reportDate");
CREATE INDEX "ExecutiveReport_organizationId_createdAt_idx" ON "ExecutiveReport"("organizationId", "createdAt");

ALTER TABLE "AIDecisionRun" ADD CONSTRAINT "AIDecisionRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AIDecision" ADD CONSTRAINT "AIDecision_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AIDecision" ADD CONSTRAINT "AIDecision_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AIDecisionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DecisionEvidence" ADD CONSTRAINT "DecisionEvidence_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "AIDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExecutiveReport" ADD CONSTRAINT "ExecutiveReport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
