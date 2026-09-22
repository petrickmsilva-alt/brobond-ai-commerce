/**
 * Creator CRM (PR003) — repositories · dto · validators.
 *
 * The CRM is the read/write surface over `CreatorProfile` /
 * `CreatorMetric` / `CreatorTag`. Every function is tenant-scoped
 * (`organizationId` first) and every write path validates through the Zod
 * schemas in `validators/`.
 */
export * from "./dto";
export * from "./repositories";
export * from "./validators";
