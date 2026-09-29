/**
 * Connector Factory (PR005) — the SINGLE point where a `ConnectorPlatform`
 * resolves to its `Connector`.
 *
 * `getConnector(platform)` is the only supported way to obtain a connector;
 * mapping a platform to an implementation must never happen through a
 * `switch` (or an `if` chain) outside this factory. Adding a new platform
 * means: implement the adapter under `modules/connectors/<platform>/`,
 * register it in the map below — done. Zero caller changes.
 *
 * Same convention as `modules/trends/hunter/collector.factory.ts` (PR002.1)
 * and `modules/creators/discovery/collector.factory.ts` (PR003).
 */

import { ConnectorPlatform } from "@prisma/client";
import { InstagramConnector } from "../instagram/instagram.connector";
import { MockConnector } from "../mock/mock.connector";
import { ShopeeConnector } from "../shopee/shopee.connector";
import { TikTokConnector } from "../tiktok/tiktok.connector";
import type { Connector } from "./connector.interface";
import { ConnectorNotRegisteredError } from "./connector.interface";

/**
 * Platform → connector builder map. Instances are cached per platform so
 * the factory is stable (`getConnector(MOCK) === getDefaultConnector()`).
 */
const CONNECTOR_BUILDERS: Record<ConnectorPlatform, () => Connector> = {
  MOCK: () => new MockConnector(),
  TIKTOK: () => new TikTokConnector(),
  INSTAGRAM: () => new InstagramConnector(),
  SHOPEE: () => new ShopeeConnector(),
};

const instances = new Map<ConnectorPlatform, Connector>();

/**
 * Resolve the connector for a platform (lazy singleton per platform).
 *
 * @throws {ConnectorNotRegisteredError} for an unregistered platform.
 */
export function getConnector(platform: ConnectorPlatform): Connector {
  const cached = instances.get(platform);
  if (cached) return cached;

  const build = CONNECTOR_BUILDERS[platform];
  if (!build) throw new ConnectorNotRegisteredError(String(platform));

  const instance = build();
  instances.set(platform, instance);
  return instance;
}

/** Every registered connector, in declaration order (MOCK first). */
export function getAllConnectors(): Connector[] {
  return listConnectorPlatforms().map((platform) => getConnector(platform));
}

/** The registered platforms, in declaration order. */
export function listConnectorPlatforms(): ConnectorPlatform[] {
  return Object.keys(CONNECTOR_BUILDERS) as ConnectorPlatform[];
}

/** Whether a platform has an adapter registered in this factory. */
export function isConnectorRegistered(platform: ConnectorPlatform): boolean {
  return Boolean(CONNECTOR_BUILDERS[platform]);
}

/**
 * The connector actually implemented in PR005 — the MOCK one. Equivalent to
 * `getConnector(ConnectorPlatform.MOCK)`.
 */
export function getDefaultConnector(): Connector {
  return getConnector(ConnectorPlatform.MOCK);
}

/** Connectors whose adapter is implemented (PR005: MOCK only). */
export function getImplementedConnectors(): Connector[] {
  return getAllConnectors().filter((connector) => connector.implemented);
}
