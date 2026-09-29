/**
 * Products module — public surface.
 *
 * modules/commerce/products/
 * ├── services/      business logic (server-only)
 * ├── repositories/  tenant-scoped Prisma data access (server-only)
 * ├── dto/           serializable shapes exposed to the UI
 * ├── pricing/       pure margin math (cents + basis points)
 * └── validators/    Zod schemas + slug helpers (pure)
 */
export * from "./dto";
export * from "./pricing";
export * from "./validators";
