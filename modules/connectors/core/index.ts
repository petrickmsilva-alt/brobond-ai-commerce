/**
 * Connector Framework — core (PR005).
 *
 * The platform-agnostic half of the module: the `Connector` contract, the
 * factory that resolves a platform to its adapter, the Zod validators, the
 * DTOs, the tenant-scoped repository and the sync service.
 *
 * Callers must NOT import or instantiate an adapter directly: resolve them
 * through `getConnector(platform)` (`connector.factory.ts`).
 *
 * NOTE: `connector.repository` and `connector.sync` are `server-only` and
 * are therefore NOT re-exported here — importing this barrel from a client
 * component must stay safe. Import them by path from server code.
 */

export * from "./connector.interface";
export * from "./connector.factory";
export * from "./connector.validator";
export * from "./connector.dto";
