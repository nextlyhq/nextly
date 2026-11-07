import type {
  PluginCollectionService,
  PluginContext,
  QueryOptions,
  PaginatedResult,
  BatchOperationResult,
  ServiceOpts,
} from "@nextlyhq/plugin-sdk";

// QueryOptions carries the rich-query options the facade now threads (D56):
// filters, sort, pagination, relation depth, and field projection.
const q: QueryOptions = {
  where: { status: { equals: "published" } },
  sort: { field: "createdAt", direction: "desc" },
  pagination: { limit: 10, page: 1 },
  depth: 1,
  select: { title: true },
};

declare const svc: PluginCollectionService;
const sys: ServiceOpts = { as: "system" };

// listEntries accepts the rich QueryOptions + a trailing ServiceOpts (D35/D56).
const list: Promise<PaginatedResult<unknown>> = svc.listEntries(
  "posts",
  q,
  sys
);

// count(slug, { where?, search? }, ServiceOpts?) => Promise<number> (D56).
const total: Promise<number> = svc.count("posts", { where: q.where }, sys);

// createMany(slug, data[], ServiceOpts?) => Promise<BatchOperationResult> (D56).
const bulk: Promise<BatchOperationResult> = svc.createMany(
  "posts",
  [{ title: "a" }, { title: "b" }],
  sys
);

// ownCollections reads the plugin's own declared collections with no hook
// shaping the read. It takes the same query options and only data options.
declare const ctx: PluginContext;
const own = ctx.services.ownCollections;
const ownList: Promise<PaginatedResult<unknown>> = own.listEntries(
  "ledger",
  q,
  {
    locale: "fr",
  }
);
const ownTotal: Promise<number> = own.count("ledger", { where: q.where });
const ownBuckets: Promise<{
  buckets: { value: string | null; count: number }[];
  truncated: boolean;
}> = own.group("ledger", { groupBy: "kind" });

// The same reads on a transaction the plugin holds take its token first, with
// the same options after it and the same answer.
declare const tx: Parameters<Parameters<typeof svc.withTransaction>[0]>[0];
const ownTxList: Promise<PaginatedResult<unknown>> =
  own.listEntriesInTransaction(tx, "ledger", q, { locale: "fr" });
const ownTxSingle: Promise<Record<string, unknown>> =
  own.getSingleInTransaction(tx, "settings");

// Exported so eslint does not flag the assertions as unused.
export const __d56TypeCheck = {
  q,
  list,
  total,
  bulk,
  ownList,
  ownTotal,
  ownBuckets,
  ownTxList,
  ownTxSingle,
};
