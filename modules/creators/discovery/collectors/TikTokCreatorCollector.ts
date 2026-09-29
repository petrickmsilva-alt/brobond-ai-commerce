/**
 * TikTok Creator Collector — PLACEHOLDER (PR003).
 *
 * Reserved for the real TikTok source (future PR): creator search /
 * display API. The contract is already pinned here and tested, so wiring
 * the real implementation must not touch any caller —
 * `getCreatorCollector(CreatorSource.TIKTOK)` keeps resolving to this
 * class until then.
 *
 * No network access is performed in PR003 — by design.
 */

import { CreatorSource } from "@prisma/client";
import type { CreatorCandidate, CreatorCollector } from "../../interfaces/creator.interface";

export class TikTokCreatorCollector implements CreatorCollector {
  readonly source: CreatorSource = CreatorSource.TIKTOK;

  async collect(): Promise<CreatorCandidate[]> {
    throw new Error(
      "TikTokCreatorCollector is not implemented yet — the PR003 discovery engine runs on the MOCK source only.",
    );
  }
}
