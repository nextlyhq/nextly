/**
 * The dashboard's summary sources: `system:team`, how many people and roles;
 * `system:team-people`, the Team card's people; and `system:content`, the
 * Content table's rows. The counts answer from the dashboard service's own
 * readings, so their cards and the `/stats` summary cannot come to disagree;
 * the people from the users service's.
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
 * ## `system:team-people`
 *
 * The Team card's list: each person's name, email, the role they hold now and
 * when they were last active, most recently active first, at most twenty, and
 * how many there are in all. Its `where` may name a role by its slug, and the
 * users service filters, orders and cuts the list in the database. Asked of
 * the same `TEAM_GATE` as `system:team`, before anything is read, and a
 * reader it refuses is answered as a source that does not exist. Only the
 * fields the card draws leave it: no id, no address beyond the email, nothing
 * about sessions but the one instant.
 *
 * ## `system:content`
 *
 * The Content table (`getContentTable`): one row per collection and Single
 * this reader may see on the dashboard, latest update first, at most the
 * query's limit. A collection's row carries its entries, its drafts by the
 * collection list's Draft filter, and whether the reader may create in it,
 * counted for the rows answered and no others; a Single's row carries whether
 * the reader may update it. Every row carries its last update, with who made
 * it and what they did taken from the same change where the activity trail
 * holds one. Each row says which `kind` it is, since a collection and a Single
 * may share a slug. The answer's `total` is what every list answer's is, the
 * rows the read matched: every collection AND every Single the reader may see
 * on the dashboard, of which `items` is the first page; `totalByKind` splits
 * it into the two. It adds no access rule of its own: the scope, every count,
 * every decision and every save are the service's, read as the reader.
 *
 * @module services/dashboard/summary-widget-sources
 */

import { readAccessCaller } from "../../auth/entity-read-access";
import { container } from "../../di/container";
import type { UserService } from "../../domains/users/services/user-service";
import type { WidgetQuery } from "../../domains/widgets/query";
import { listEntries } from "../../domains/widgets/query-limits";
import type { WidgetResult } from "../../domains/widgets/result";
import {
  failUnavailableSourceOrOp,
  refuseUnconsumedQueryFields,
} from "../../domains/widgets/sources";
import {
  CONTENT_SOURCE_ID,
  TEAM_PEOPLE_SOURCE_ID,
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

/** Each person: what the Team card draws of them, and nothing else. */
const TEAM_PEOPLE_FIELDS = [
  { name: "name", type: "string" as const, label: "Name" },
  { name: "email", type: "string" as const, label: "Email" },
  { name: "role", type: "string" as const, label: "Role" },
  { name: "lastActiveAt", type: "date" as const, label: "Last active" },
];

/**
 * Each collection: what it is called, where it is grouped, its entries and
 * drafts, and whether the reader may create in it. Each Single: what it is
 * called; its entry fields are absent. Both: the last update, and who saved it
 * where the trail names them.
 */
const CONTENT_FIELDS = [
  { name: "kind", type: "string" as const, label: "Kind" },
  { name: "slug", type: "string" as const, label: "Collection or Single" },
  { name: "label", type: "string" as const, label: "Name" },
  { name: "group", type: "string" as const, label: "Group" },
  { name: "count", type: "number" as const, label: "Entries" },
  { name: "draft", type: "number" as const, label: "Drafts" },
  { name: "canCreate", type: "boolean" as const, label: "May create" },
  {
    name: "singularLabel",
    type: "string" as const,
    label: "One entry is called",
  },
  { name: "canUpdate", type: "boolean" as const, label: "May update" },
  { name: "updatedAt", type: "date" as const, label: "Updated" },
  { name: "userId", type: "string" as const, label: "Saved by" },
  { name: "userName", type: "string" as const, label: "Name of saver" },
  { name: "actorType", type: "string" as const, label: "Saved by kind" },
  { name: "identityErasedAt", type: "date" as const, label: "Identity erased" },
  { name: "event", type: "string" as const, label: "What they did" },
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
  since: "refused",
  until: "refused",
  range: "refused",
};

/**
 * What the people resolver does with each field of a widget query: as the
 * others, but `where` carries the role the card narrows by.
 */
const TEAM_PEOPLE_QUERY_FIELD_USE: Record<
  keyof WidgetQuery,
  "consumed" | "refused"
> = { ...QUERY_FIELD_USE, where: "consumed" };

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

/** The users service, resolved at call time. */
function users(): UserService {
  if (!container.has("userService")) {
    throw NextlyError.internal({
      logContext: { reason: "user-service-unregistered" },
    });
  }
  return container.get<UserService>("userService");
}

/**
 * The role a query's `where` names, by its slug, everyone when it names none,
 * or a refusal of anything else in it: a key this source does not read would
 * be validated and then dropped, and the card would answer a different
 * question.
 */
function roleOf(where: WidgetQuery["where"]): string | undefined {
  if (where === undefined) return undefined;
  const unknown = Object.keys(where).filter(key => key !== "role");
  if (unknown.length > 0) {
    failUnavailableSourceOrOp(
      `source "${TEAM_PEOPLE_SOURCE_ID}" narrows by role alone, not: ${unknown.join(", ")}`
    );
  }
  const { role } = where;
  if (role === undefined) return undefined;
  if (typeof role !== "string" || role === "") {
    failUnavailableSourceOrOp(
      `source "${TEAM_PEOPLE_SOURCE_ID}" takes role as a role's slug`
    );
  }
  return role;
}

/**
 * Answer the Team card's list: the people, most recently active first, for a
 * reader the card is for, and nothing at all for anyone else.
 */
async function resolveTeamPeople(
  query: WidgetQuery,
  caller: ReadCaller
): Promise<WidgetResult> {
  refuseUnconsumedQueryFields(
    query,
    TEAM_PEOPLE_QUERY_FIELD_USE,
    TEAM_PEOPLE_SOURCE_ID
  );
  const roleSlug = roleOf(query.where);
  const verdicts = await permissionVerdicts(
    [TEAM_GATE],
    readAccessCaller(caller)
  );
  // The precondition, before anyone is read.
  if (!holdsWidgetPermission(TEAM_GATE, verdicts)) {
    failUnavailableSourceOrOp(
      `${TEAM_PEOPLE_SOURCE_ID}: not this reader's card`
    );
  }
  const limit = listEntries(query.limit);
  const { people, total } = await users().listTeamPeople({
    ...(roleSlug === undefined ? {} : { roleSlug }),
    limit,
    now: new Date(),
  });
  const rows = people.map(person => ({
    name: person.name ?? undefined,
    email: person.email,
    role: person.role?.name,
    lastActiveAt: person.lastActiveAt,
  }));
  return { ...listOf(rows, TEAM_PEOPLE_FIELDS, { ...query, limit }), total };
}

/**
 * Answer the Content card: the rows of the Content table this reader may see, at most the
 * query's limit, and how many rows it could show in all.
 */
async function resolveContent(
  query: WidgetQuery,
  caller: ReadCaller
): Promise<WidgetResult> {
  refuseUnconsumedQueryFields(query, QUERY_FIELD_USE, CONTENT_SOURCE_ID);
  const scope = await resolveReadableResources(caller);
  // The limit goes to the service, which picks the page before counting it, so a card asking
  // for the rows it draws, and one more, has only those counted.
  const table = await dashboard().getContentTable({
    scope,
    caller,
    limit: query.limit,
  });
  // `kind` stays in every row whatever was selected: a collection and a Single
  // may share a slug, and without it their rows could not be told apart.
  const select = query.select;
  return {
    ...listOf(
      table.rows,
      CONTENT_FIELDS,
      select?.length && !select.includes("kind")
        ? { ...query, select: [...select, "kind"] }
        : query
    ),
    // Every row the table could show, collections and Singles alike: the
    // rows matched, of which `items` is the first page.
    total: table.total,
    // And how many of those are each kind, for the card's subtitle.
    totalByKind: table.byKind,
  };
}

/**
 * `rows` as a list answer: at most `query.limit` of them, each reduced to the
 * fields the query selected, or to every declared field when it selected none.
 *
 * A field a row does not carry stays absent rather than becoming a key with
 * no value: a Single's row has no count and a row whose saver is unknown no
 * name, and the answer handed to a caller in the same process then reads as
 * the one the dashboard's route sends, where JSON drops such keys.
 */
function listOf(
  rows: readonly object[],
  fields: readonly { name: string }[],
  query: WidgetQuery
): Extract<WidgetResult, { op: "list" }> {
  const declared = fields.map(field => field.name);
  const names = query.select?.length
    ? declared.filter(name => query.select?.includes(name))
    : declared;
  return {
    op: "list",
    items: rows.slice(0, query.limit ?? rows.length).map(row => {
      const values = row as Record<string, unknown>;
      return Object.fromEntries(
        names
          .filter(name => values[name] !== undefined)
          .map(name => [name, values[name]])
      );
    }),
  };
}

/** Publish the three sources and their resolvers, from the boot-time registry reset. */
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
      id: TEAM_PEOPLE_SOURCE_ID,
      label: "Team members",
      kind: "system",
      titleField: "name",
      supports: ["list"],
      fields: TEAM_PEOPLE_FIELDS,
      filters: ["role"],
    },
    resolveTeamPeople
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
