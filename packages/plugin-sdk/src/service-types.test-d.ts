import type {
  PluginCollectionService,
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

// Exported so eslint does not flag the assertions as unused.
export const __d56TypeCheck = { q, list, total, bulk };
