/**
 * Instagram Creator Collector — PLACEHOLDER (PR003).
 *
 * Reserved for the real Instagram source (future PR): creator search /
 * Graph API. The contract is already pinned here and tested, so wiring the
 * real implementation must not touch any caller —
 * `getCreatorCollector(CreatorSource.INSTAGRAM)` keeps resolving to this
 * class until then.
 *
 * No network access is performed in PR003 — by design.
 */

import { CreatorSource } from "@prisma/client";
import type { CreatorCandidate, CreatorCollector } from "../../interfaces/creator.interface";

export class InstagramCreatorCollector implements CreatorCollector {
  readonly source: CreatorSource = CreatorSource.INSTAGRAM;

  async collect(): Promise<CreatorCandidate[]> {
    throw new Error(
      "InstagramCreatorCollector is not implemented yet — the PR003 discovery engine runs on the MOCK source only.",
    );
  }
}
