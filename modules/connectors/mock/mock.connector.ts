/**
 * Mock Connector (PR005 — Connector Framework).
 *
 * IMPORTANT: the connector framework intentionally performs **no** network
 * access in this PR — no TikTok API, no Instagram API, no Shopee, no
 * scraping, no SDK, no credentials. `MOCK_EXTERNAL_CONTENT` below is a
 * realistic, **deterministic** dataset (40 items across the five content
 * types) so the whole pipeline — connector → sync service → repository →
 * dashboard KPIs — works end-to-end today.
 *
 * The dataset is generated once at module load by a seeded PRNG
 * (`MOCK_CONTENT_SEED`), so two runs — or two processes — always produce
 * byte-identical items (pinned by `tests/connector-mock.test.ts`).
 *
 * The last four items deliberately REPEAT the `externalId` of earlier ones
 * so the dedupe path (and therefore the "Duplicados" KPI) is exercised by
 * the default dataset without any test-only wiring.
 */

import { ConnectorPlatform } from "@prisma/client";
import type {
  Connector,
  ConnectorHealth,
  ExternalContentTypeName,
  FetchContentOptions,
  NormalizedContent,
} from "../core/connector.interface";

/** PRNG seed — change it to roll a new (still deterministic) dataset. */
export const MOCK_CONTENT_SEED = 0x0bb0bd05;

/** How many UNIQUE items the mock dataset contains. */
export const MOCK_UNIQUE_CONTENT_COUNT = 36;

/** How many DUPLICATE items (repeated externalIds) the dataset appends. */
export const MOCK_DUPLICATE_CONTENT_COUNT = 4;

/** Total items returned by an unbounded `fetchContent()`. */
export const MOCK_CONTENT_COUNT = MOCK_UNIQUE_CONTENT_COUNT + MOCK_DUPLICATE_CONTENT_COUNT;

/** Content-type distribution of the unique items (sum = 36). */
export const MOCK_TYPE_DISTRIBUTION: readonly (readonly [ExternalContentTypeName, number])[] = [
  ["VIDEO", 14],
  ["IMAGE", 8],
  ["POST", 7],
  ["PRODUCT", 5],
  ["LIVE", 2],
];

const TOPICS = [
  "camisa masculina",
  "jaqueta premium",
  "bermuda cargo",
  "camiseta oversized",
  "hoodie streetwear",
  "tênis chunky",
  "terno slim fit",
  "relógio minimalista",
  "regata fitness",
  "camiseta dry fit",
  "calça jogger",
  "boné aba reta",
];

const HANDLES = [
  "@ana.souza",
  "@bruno.style",
  "@carla.moda",
  "@diego.fit",
  "@elisa.street",
  "@felipe.exec",
];

/** Mulberry32 — tiny, fast, fully deterministic PRNG. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fixed epoch so `publishedAt` is deterministic across runs/processes. */
const MOCK_EPOCH = Date.UTC(2026, 8, 1, 12, 0, 0);

function buildDataset(): NormalizedContent[] {
  const random = createRandom(MOCK_CONTENT_SEED);
  const items: NormalizedContent[] = [];

  let index = 0;
  for (const [type, count] of MOCK_TYPE_DISTRIBUTION) {
    for (let n = 0; n < count; n += 1) {
      const topic = TOPICS[index % TOPICS.length] as string;
      const handle = HANDLES[index % HANDLES.length] as string;
      const views = 10_000 + Math.floor(random() * 1_990_000);
      const likes = Math.floor(views * (0.04 + random() * 0.16));
      const shares = Math.floor(likes * (0.05 + random() * 0.2));
      const sequence = String(index + 1).padStart(3, "0");

      items.push({
        externalId: `mock-${type.toLowerCase()}-${sequence}`,
        type,
        title: `${topic} — ${type.toLowerCase()} ${sequence}`,
        url: `https://mock.brobond.local/${type.toLowerCase()}/${sequence}`,
        thumbnailUrl: `https://mock.brobond.local/thumb/${sequence}.jpg`,
        authorHandle: handle,
        caption: `Conteúdo mock sobre ${topic}. Nenhuma API real foi consultada.`,
        views,
        likes,
        shares,
        // One item per day going backwards — stable, no Date.now() anywhere.
        publishedAt: new Date(MOCK_EPOCH - index * 86_400_000),
        raw: { provider: "mock", sequence, topic },
      });
      index += 1;
    }
  }

  // Deliberate duplicates: same externalId as the first four items, with
  // refreshed engagement numbers (exactly what a real re-sync looks like).
  for (let n = 0; n < MOCK_DUPLICATE_CONTENT_COUNT; n += 1) {
    const original = items[n] as NormalizedContent;
    items.push({
      ...original,
      title: `${original.title} (re-sync)`,
      views: (original.views ?? 0) + 1_000 * (n + 1),
      likes: (original.likes ?? 0) + 100 * (n + 1),
      raw: { ...(original.raw ?? {}), resync: true },
    });
  }

  return items;
}

/**
 * The deterministic mock dataset: 36 unique items + 4 duplicates.
 * Frozen — `fetchContent()` returns defensive copies so callers can never
 * mutate the module state.
 */
export const MOCK_EXTERNAL_CONTENT: readonly NormalizedContent[] = Object.freeze(buildDataset());

/**
 * MOCK implementation of `Connector` — the only implemented adapter in
 * PR005. Honours `limit`, `since` and `type` so the sync service can be
 * exercised realistically without a provider.
 */
export class MockConnector implements Connector {
  readonly platform: ConnectorPlatform = ConnectorPlatform.MOCK;
  readonly name = "Mock Connector";
  readonly implemented = true;

  async fetchContent(options: FetchContentOptions = {}): Promise<NormalizedContent[]> {
    let items = MOCK_EXTERNAL_CONTENT.map((item) => ({
      ...item,
      publishedAt: item.publishedAt ? new Date(item.publishedAt) : undefined,
      raw: item.raw ? { ...item.raw } : undefined,
    }));

    if (options.type) items = items.filter((item) => item.type === options.type);
    if (options.since) {
      const since = options.since.getTime();
      items = items.filter((item) => (item.publishedAt?.getTime() ?? 0) >= since);
    }
    if (typeof options.limit === "number" && options.limit >= 0) {
      items = items.slice(0, options.limit);
    }

    return items;
  }

  async testConnection(): Promise<ConnectorHealth> {
    return {
      platform: this.platform,
      ok: true,
      implemented: true,
      message: `Mock Connector: ${MOCK_CONTENT_COUNT} itens determinísticos disponíveis (sem acesso de rede).`,
    };
  }
}
