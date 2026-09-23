import "server-only";

import { analyticsService } from "@/modules/analytics/services/analytics.service";
import { assertOrganizationId } from "@/lib/tenant";
import { generateExecutiveDecisions } from "../engine/decision.engine";
import { findRevenueOpportunities } from "../engine/opportunity.engine";
import { requestExecutiveReport, requestExecutiveStrategy } from "../engine/executive-ai.engine";
import { aiCeoContextRepository } from "../repositories/context.repository";
import { aiCeoRepository } from "../repositories/ai-ceo.repository";
import type { DecisionStatusName } from "../dto";

interface AnalyticsReader {
  getDashboard: typeof analyticsService.getDashboard;
}

export interface AICeoServiceDependencies {
  analytics: AnalyticsReader;
  contextRepository: Pick<typeof aiCeoContextRepository, "load">;
  repository: Pick<
    typeof aiCeoRepository,
    "persistGeneration" | "persistReport" | "transition" | "dashboard"
  >;
  strategyProvider: typeof requestExecutiveStrategy;
  reportProvider: typeof requestExecutiveReport;
}

/**
 * AI CEO application service. It can analyze, persist recommendations and
 * record human lifecycle transitions. It intentionally has no dependency on
 * campaign mutation, outreach dispatch, delivery connectors or commerce
 * execution — automatic execution is impossible at this boundary.
 */
export function createAICeoService(deps: AICeoServiceDependencies) {
  async function loadContext(organizationId: string, now: Date) {
    const organization = assertOrganizationId(organizationId);
    const analytics = await deps.analytics.getDashboard(organization, { days: 30, now });
    return deps.contextRepository.load(organization, analytics, now);
  }

  return {
    async generateExecutiveDecisions(organizationId: string, actorId: string, now = new Date()) {
      const organization = assertOrganizationId(organizationId);
      const context = await loadContext(organization, now);
      const opportunities = findRevenueOpportunities(context);
      const strategy = await deps.strategyProvider(context, opportunities);
      const decisions = generateExecutiveDecisions(context, strategy.data.decisions, opportunities);
      const run = await deps.repository.persistGeneration(organization, {
        context,
        decisions,
        promptVersion: strategy.promptVersion,
        model: strategy.model,
        temperature: strategy.temperature,
        inputTokens: strategy.inputTokens,
        outputTokens: strategy.outputTokens,
        rawResponse: strategy.rawResponse,
        actorId,
      });
      return {
        runId: run.id,
        summary: strategy.data.summary,
        opportunities: opportunities.length,
        decisions: decisions.length,
      };
    },

    async generateExecutiveReport(organizationId: string, actorId: string, now = new Date()) {
      const organization = assertOrganizationId(organizationId);
      const context = await loadContext(organization, now);
      const opportunities = findRevenueOpportunities(context);
      const report = await deps.reportProvider(context, opportunities);
      return deps.repository.persistReport(organization, {
        context,
        summary: report.data.summary,
        risks: report.data.risks,
        opportunities: report.data.opportunities,
        promptVersion: report.promptVersion,
        model: report.model,
        temperature: report.temperature,
        inputTokens: report.inputTokens,
        outputTokens: report.outputTokens,
        rawResponse: report.rawResponse,
        actorId,
        now,
      });
    },

    async transitionDecision(
      organizationId: string,
      decisionId: string,
      target: Exclude<DecisionStatusName, "PENDING">,
      actorId: string,
      now = new Date(),
    ) {
      return deps.repository.transition(
        assertOrganizationId(organizationId),
        decisionId,
        target,
        actorId,
        now,
      );
    },

    getDashboard(organizationId: string) {
      return deps.repository.dashboard(assertOrganizationId(organizationId));
    },
  };
}

export const aiCeoService = createAICeoService({
  analytics: analyticsService,
  contextRepository: aiCeoContextRepository,
  repository: aiCeoRepository,
  strategyProvider: requestExecutiveStrategy,
  reportProvider: requestExecutiveReport,
});
