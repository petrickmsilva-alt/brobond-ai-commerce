/**
 * Mock Creator Collector (PR003 — Creator Discovery Engine).
 *
 * IMPORTANT: the Creator Discovery Engine intentionally performs **no**
 * network access in this PR — no TikTok API, no Instagram API, no Shopee,
 * no scraping, no OpenAI. `MOCK_CREATOR_CANDIDATES` below is a realistic,
 * **deterministic** dataset (100 creators across the 5 tracked niches) so
 * the whole pipeline — collector → score engine → CRM repository →
 * dashboard — works end-to-end today.
 *
 * The dataset is generated once at module load by a seeded PRNG
 * (`MOCK_DATASET_SEED`), so two runs — or two processes — always produce
 * byte-identical candidates (pinned by `tests/creator-collector.test.ts`).
 *
 * Distribution (mandated by PR003):
 *   Moda 35 · Casual 20 · Street 20 · Fitness 15 · Executivo 10
 * Followers: 5.000 – 2.000.000 (power-skewed towards realistic mid-tail).
 */

import { CreatorSource } from "@prisma/client";
import type {
  CreatorCandidate,
  CreatorCollector,
  CreatorNicheName,
} from "../../interfaces/creator.interface";
import { CREATOR_NICHES } from "../../interfaces/creator.interface";

/** PRNG seed — change it to roll a new (still deterministic) dataset. */
export const MOCK_DATASET_SEED = 0x00c0ffee;

/** Followers bounds of the mock dataset (PR003 contract). */
export const MOCK_FOLLOWERS_MIN = 5_000;
export const MOCK_FOLLOWERS_MAX = 2_000_000;

/** Mandated niche distribution: [niche, count] pairs (sum = 100). */
export const MOCK_NICHE_DISTRIBUTION: readonly (readonly [CreatorNicheName, number])[] = [
  ["Moda", 35],
  ["Casual", 20],
  ["Street", 20],
  ["Fitness", 15],
  ["Executivo", 10],
];

const FIRST_NAMES = [
  "Ana",
  "Bruno",
  "Carla",
  "Diego",
  "Elisa",
  "Felipe",
  "Gabi",
  "Heitor",
  "Ítala",
  "João",
  "Karina",
  "Lucas",
  "Marina",
  "Nuno",
  "Olívia",
  "Pedro",
  "Rafaela",
  "Sérgio",
  "Tainá",
  "Vitor",
  "Yara",
  "Zeca",
  "Caio",
  "Nina",
] as const;

const LAST_NAMES = [
  "Almeida",
  "Barros",
  "Cardoso",
  "Duarte",
  "Esteves",
  "Farias",
  "Gomes",
  "Henrique",
  "Ipólito",
  "Junqueira",
  "Klein",
  "Lacerda",
  "Moura",
  "Nogueira",
  "Oliveira",
  "Peixoto",
  "Quintela",
  "Ribeiro",
  "Sampaio",
  "Teixeira",
] as const;

const NICHE_TAG_POOLS: Record<CreatorNicheName, readonly string[]> = {
  Moda: ["moda masculina", "look do dia", "alta costura", "tendências"],
  Casual: ["casual", "dia a dia", "básicos", "conforto"],
  Street: ["streetwear", "urbano", "sneakers", "hip hop"],
  Fitness: ["fitness", "treino", "saúde", "academia"],
  Executivo: ["alfaiataria", "corporate", "luxo", "business"],
};

/** mulberry32 — tiny, fast, deterministic 32-bit PRNG. */
function createPrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function slugPart(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Build the deterministic mock dataset. Module-private — callers consume
 * the frozen `MOCK_CREATOR_CANDIDATES` export (or the collector).
 */
function buildMockCandidates(): CreatorCandidate[] {
  const random = createPrng(MOCK_DATASET_SEED);
  const candidates: CreatorCandidate[] = [];
  let index = 0;

  for (const [niche, count] of MOCK_NICHE_DISTRIBUTION) {
    for (let i = 0; i < count; i += 1) {
      index += 1;
      const nn = String(index).padStart(3, "0");
      const firstName = FIRST_NAMES[Math.floor(random() * FIRST_NAMES.length)]!;
      const lastName = LAST_NAMES[Math.floor(random() * LAST_NAMES.length)]!;

      // Power-skewed follower base: mostly mid-tail, a few mega profiles.
      const followers =
        MOCK_FOLLOWERS_MIN +
        Math.floor(random() ** 2.2 * (MOCK_FOLLOWERS_MAX - MOCK_FOLLOWERS_MIN - 1));

      const tagPool = NICHE_TAG_POOLS[niche];
      const tags = [tagPool[Math.floor(random() * tagPool.length)]!];
      if (random() < 0.4) {
        const second = tagPool[Math.floor(random() * tagPool.length)]!;
        if (!tags.includes(second)) tags.push(second);
      }

      candidates.push({
        externalId: `mock-${slugPart(niche)}-${nn}`,
        handle: `@${slugPart(firstName)}.${slugPart(lastName)}${nn}`,
        displayName: `${firstName} ${lastName}`,
        niche,
        followers,
        avgViews: Math.round(followers * (0.05 + random() * 0.55)),
        engagementRate: round1(0.5 + random() * 11.5),
        postsPerWeek: round1(1 + random() * 12),
        growthRate: round1(random() * 25),
        qualityScore: 40 + Math.floor(random() * 59),
        tags,
      });
    }
  }

  return candidates;
}

/**
 * The deterministic mock dataset — exactly 100 candidates with the PR003
 * niche distribution. Frozen: mutating a returned reference never leaks
 * into the source of truth.
 */
export const MOCK_CREATOR_CANDIDATES: readonly CreatorCandidate[] =
  Object.freeze(buildMockCandidates());

/** PR002-era alias kept for symmetry with the trends module. */
export const MOCK_CREATOR_SIGNALS = MOCK_CREATOR_CANDIDATES;

/** The MOCK implementation of the `CreatorCollector` contract (PR003). */
export class MockCreatorCollector implements CreatorCollector {
  readonly source: CreatorSource = CreatorSource.MOCK;

  /** Defensive copy — callers may sort/mutate the result freely. */
  async collect(): Promise<CreatorCandidate[]> {
    return MOCK_CREATOR_CANDIDATES.map((candidate) => ({ ...candidate }));
  }
}

/** Retrocompatible alias. */
export const MockCollector = MockCreatorCollector;

// Narrow the export surface: CREATOR_NICHES is re-exported so the collector
// file can be used to bootstrap niche-aware tests without extra imports.
export { CREATOR_NICHES };
