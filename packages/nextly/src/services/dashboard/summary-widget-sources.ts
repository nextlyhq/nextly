/**
 * The dashboard's summary sources: `system:team`, how many people and roles,
 * and `system:content`, each collection with its entries and drafts. Both
 * answer from the dashboard service's own readings, so their cards and the
 * `/stats` summary cannot come to disagree.
 *
 * ## `system:team`
 *
 * 🔴 The card's gate is asked HERE, not only where the card is offered. A
 * source answers whoever queries it, so a reader the card is not offered to
 * could still ask; the resolver asks the same `TEAM_GATE` the declaration
 * carries, through the decision the layout endpoint takes for the card, and a
 * reader it refuses is answered exactly as a source that does not exist.
 *
 * The roles figure is a second, narrower answer inside the first: a reader
 * without `read-roles` is given the people alone, and the roles row is ABSENT
 * rather than zero, since a zero would still be an answer about rows they may
 * not read.
 *
 * ## `system:content`
 *
 * One row per collection this reader may see on the dashboard: its total, and
 * how many entries are published and how many are drafts, each counted as the
 * reader (`getContentByCollection`). Then one row per Single they may see
 * (`getContentSingles`), which has no entries to count. Each row says which
 * `kind` it is, since a collection and a Single may share a slug. It adds no
 * access rule of its own: the scope and every count are the service's, read
 * the way `/stats` reads them.
 *
 * @module services/dashboard/summary-widget-sources
 */

import { readAccessCaller } from "../../auth/entity-read-access";
import { container } from "../../di/container";
import type { WidgetQuery } from "../../domains/widgets/query";
import type { WidgetResult } from "../../domains/widgets/result";
import {
  failUnavailableSourceOrOp,
  refuseUnconsumedQueryFields,
} from "../../domains/widgets/sources";
import {
  CONTENT_SOURCE_ID,
  TEAM_SOURCE_ID,
} from "../../domains/widgets/system-source-ids";
import { registerSystemSource } from "../../domains/widgets/system-sources";
import {
  TEAM_GATE,
  TEAM_ROLES_PERMISSION,
} from "../../domains/widgets/team-gate";
import {
  holdsWidgetPermission,
  permissionVerdicts,
} from "../../domains/widgets/visibility";
import { NextlyError } from "../../errors/nextly-error";

import type { DashboardService } from "./dashboard-service";
import type { ReadCaller } from "./readable-resources";
import { resolveReadableResources } from "./resolve-readable-resources";

/** One row per figure: which figure it is, and its count. */
const TEAM_FIELDS = [
  { name: "figure", type: "string" as const, label: "Figure" },
  { name: "count", type: "number" as const, label: "Count" },
];

/**
 * Each collection: what it is called, where it is grouped, and its entries. Each
 * Single: what it is called; its entry fields are absent.
 */
const CONTENT_FIELDS = [
  { name: "kind", type: "string" as const, label: "Kind" },
  { name: "slug", type: "string" as const, label: "Collection or Single" },
  { name: "label", type: "string" as const, label: "Name" },
  { name: "group", type: "string" as const, label: "Group" },
  { name: "count", type: "number" as const, label: "Entries" },
  { name: "published", type: "number" as const, label: "Published" },
  { name: "draft", type: "number" as const, label: "Drafts" },
];

/**
 * What these resolvers do with each field of a widget query: both answer one
 * fixed question, so they consume and refuse the same fields. Exhaustive over
 * `keyof WidgetQuery`, as the other system sources keep theirs, so a field added
 * to the query fails `check-types` here until someone decides what it means.
 */
const QUERY_FIELD_USE: Record<keyof WidgetQuery, "consumed" | "refused"> = {
  source: "consumed",
  op: "consumed",
  select: "consumed",
  limit: "consumed",
  where: "refused",
  sort: "refused",
  status: "refused",
  groupBy: "refused",
  dateField: "refused",
  interval: "refused",
};

/** The service, resolved at call time, as the other system sources resolve theirs. */
function dashboard(): DashboardService {
  if (!container.has("dashboardService")) {
    throw NextlyError.internal({
      logContext: { reason: "dashboard-service-unregistered" },
    });
  }
  return container.get<DashboardService>("dashboardService");
}

/**
 * Answer the Team card: the people always, the roles for a reader who may see
 * them, and nothing at all for a reader the card is not for.
 */
async function resolveTeam(
  query: WidgetQuery,
  caller: ReadCaller
): Promise<WidgetResult> {
  refuseUnconsumedQueryFields(query, QUERY_FIELD_USE, TEAM_SOURCE_ID);
  const verdicts = await permissionVerdicts(
    [TEAM_GATE, TEAM_ROLES_PERMISSION],
    readAccessCaller(caller)
  );
  // The precondition, before any count runs.
  if (!holdsWidgetPermission(TEAM_GATE, verdicts)) {
    failUnavailableSourceOrOp(`${TEAM_SOURCE_ID}: not this reader's card`);
  }
  const figures: Array<"users" | "roles"> =
    verdicts.get(TEAM_ROLES_PERMISSION) === true
      ? ["users", "roles"]
      : ["users"];
  const rows = await Promise.all(
    figures.map(async figure => ({
      figure,
      count: await dashboard().countTeamFigure(figure),
    }))
  );
  return listOf(rows, TEAM_FIELDS, query);
}

/**
 * Answer the Content card: each collection this reader may see, with its entries and drafts,
 * then each Single they may see.
 */
async function resolveContent(
  query: WidgetQuery,
  caller: ReadCaller
): Promise<WidgetResult> {
  refuseUnconsumedQueryFields(query, QUERY_FIELD_USE, CONTENT_SOURCE_ID);
  const scope = await resolveReadableResources(caller);
  // The limit goes to the service, which picks the page before counting it; the Singles take
  // whatever room the collections leave, so the card's one row more still says more exist.
  const collections = await dashboard().getContentByCollection({
    scope,
    caller,
    limit: query.limit,
  });
  const room =
    query.limit === undefined ? undefined : query.limit - collections.length;
  const singles =
    room === undefined || room > 0
      ? await dashboard().getContentSingles({ scope, limit: room })
      : [];
  const rows = [
    ...collections.map(row => ({ kind: "collection", ...row })),
    ...singles.map(single => ({ kind: "single", ...single, group: null })),
  ];
  // `kind` stays in every row whatever was selected: a collection and a Single
  // may share a slug, and without it their rows could not be told apart.
  const select = query.select;
  return listOf(
    rows,
    CONTENT_FIELDS,
    select?.length && !select.includes("kind")
      ? { ...query, select: [...select, "kind"] }
      : query
  );
}

/**
 * `rows` as a list answer: at most `query.limit` of them, each reduced to the
 * fields the query selected, or to every declared field when it selected none.
 */
function listOf(
  rows: readonly object[],
  fields: readonly { name: string }[],
  query: WidgetQuery
): WidgetResult {
  const declared = fields.map(field => field.name);
  const names = query.select?.length
    ? declared.filter(name => query.select?.includes(name))
    : declared;
  return {
    op: "list",
    items: rows.slice(0, query.limit ?? rows.length).map(row => {
      const values = row as Record<string, unknown>;
      return Object.fromEntries(names.map(name => [name, values[name]]));
    }),
  };
}

/** Publish both sources and their resolvers, from the boot-time registry reset. */
export function registerSummaryWidgetSources(): void {
  registerSystemSource(
    {
      id: TEAM_SOURCE_ID,
      label: "Team",
      kind: "system",
      titleField: "figure",
      supports: ["list"],
      fields: TEAM_FIELDS,
    },
    resolveTeam
  );
  registerSystemSource(
    {
      id: CONTENT_SOURCE_ID,
      label: "Content",
      kind: "system",
      titleField: "label",
      supports: ["list"],
      fields: CONTENT_FIELDS,
    },
    resolveContent
  );
}
