import "server-only";

import { InstagramConnector } from "../instagram/dm.service";
import { WhatsAppConnector } from "../whatsapp/message.service";
import {
  DELIVERY_CHANNELS,
  DeliveryConnectorNotRegisteredError,
  type DeliveryChannelName,
  type DeliveryConnector,
} from "./delivery.interface";

/**
 * Delivery Factory (PR010 §6) — the SINGLE point where a `DeliveryChannel`
 * resolves to its `DeliveryConnector`.
 *
 * `getDeliveryConnector(channel)` is the only supported way to obtain a
 * connector; mapping a channel to an implementation must NEVER happen
 * through a `switch` (or an `if` chain) outside this factory. Adding a new
 * channel means: implement the connector under `modules/delivery/<channel>/`
 * and register one line in the Map below — zero caller changes.
 *
 * Factory baseada em `Map`, deliberately — same convention as
 * `modules/connectors/core/connector.factory.ts` (PR005).
 */

/** Channel → connector builder registry (the one and only mapping). */
const DELIVERY_CONNECTOR_BUILDERS = new Map<DeliveryChannelName, () => DeliveryConnector>([
  ["INSTAGRAM", () => new InstagramConnector()],
  ["WHATSAPP", () => new WhatsAppConnector()],
]);

/** Lazy singleton cache — a connector instance is stable per channel. */
const instances = new Map<DeliveryChannelName, DeliveryConnector>();

/**
 * Resolve the connector for a channel (lazy singleton per channel).
 * @throws {DeliveryConnectorNotRegisteredError} for an unregistered channel.
 */
export function getDeliveryConnector(channel: DeliveryChannelName): DeliveryConnector {
  const cached = instances.get(channel);
  if (cached) return cached;

  const build = DELIVERY_CONNECTOR_BUILDERS.get(channel);
  if (!build) throw new DeliveryConnectorNotRegisteredError(String(channel));

  const instance = build();
  instances.set(channel, instance);
  return instance;
}

/** Every registered channel, in declaration order. */
export function listDeliveryConnectorChannels(): DeliveryChannelName[] {
  return [...DELIVERY_CONNECTOR_BUILDERS.keys()];
}

/** Every registered connector, in declaration order. */
export function getAllDeliveryConnectors(): DeliveryConnector[] {
  return listDeliveryConnectorChannels().map((channel) => getDeliveryConnector(channel));
}

/** Whether a channel has a connector registered in this factory. */
export function isDeliveryConnectorRegistered(channel: DeliveryChannelName): boolean {
  return DELIVERY_CONNECTOR_BUILDERS.has(channel);
}

/** Consistency guard: every declared channel must be registered (pinned by
 * `tests/delivery-factory.test.ts` — a Prisma enum addition without its
 * connector fails the suite, not production). */
export function assertAllDeliveryChannelsRegistered(): void {
  for (const channel of DELIVERY_CHANNELS) {
    if (!DELIVERY_CONNECTOR_BUILDERS.has(channel)) {
      throw new DeliveryConnectorNotRegisteredError(channel);
    }
  }
}

/** Test hook: clears the lazy singleton cache. */
export function resetDeliveryConnectorCache(): void {
  instances.clear();
}
