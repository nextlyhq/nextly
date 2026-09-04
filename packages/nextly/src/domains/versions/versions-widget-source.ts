/**
 * `system:versions` — the documents carrying edits that are not live.
 *
 * 🔴 The access decision is made HERE, and that is the difference from
 * `system:releases`. `ReleasesService` authorizes itself, so that resolver
 * hands the caller through and adds nothing. `VersionsService` has no
 * authorization at all — none of its methods takes an actor — so a resolver
 * that simply called it would answer an install-wide number to a reader
 * entitled to part of it.
 *
 * The bound is `readableEntities`, asked once per registered entity, and NOT a
 * filter over the caller's permission slugs. The two look equivalent and are
 * not, in both directions:
 *
 * - An API key is judged on its OWN stamped scope. Resolving the owner's
 *   role-derived slugs instead hands a narrowly scoped key everything its
 *   minter can read — and a key minted by a super admin every document in the
 *   install, since the bypass belongs to the session path alone.
 * - A collection whose code-defined `access.read` REFUSES this caller still has
 *   the permission row a slug filter admits it on, and one authorized purely in
 *   code has no row to find at all.
 *
 * That is the same call `/api/dashboard/stats` and the widget layout endpoint
 * make, so this card describes the collections whose documents the caller could
 * actually open — which is the only definition of "in reach" that cannot drift
 * from what a row read would answer.
 *
 * The result is an ENUMERATED set, never "no filter". A super admin gets every
 * registered entity rather than an unbounded read, so a version row naming a
 * collection that is no longer registered belongs to nobody — the same
 * deliberate consequence `resolveReadableResources` documents. It is what lets
 * the service take a required `readonly string[]`, with `[]` meaning exactly
 * nothing, instead of the three-way `undefined | [] | list` whose collapse hands
 * every document to a caller granted none.
 *
 * @module domains/versions/versions-widget-source
 */

import {
  readAccessCaller,
  readableEntities,
} from "../../auth/entity-read-access";
import { container } from "../../di/container";
import { NextlyError } from "../../errors/nextly-error";
import type { ReadCaller } from "../../services/dashboard/readable-resources";
import { registeredContentSlugs } from "../../services/lib/registered-content-slugs";
import type { WidgetQuery } from "../widgets/query";
import type { WidgetResult } from "../widgets/result";
import { failUnavailableSourceOrOp } from "../widgets/sources";
import { VERSIONS_SOURCE_ID } from "../widgets/system-source-ids";
import { registerSystemSource } from "../widgets/system-sources";

import type { VersionsService } from "./versions-service";

export { VERSIONS_SOURCE_ID };

/** How many rows the list card draws when the query names no limit. */
const DEFAULT_LIMIT = 5;

/**
 * The fields this source publishes.
 *
 * Deliberately the document's identity and its instant, and nothing from the
 * snapshot: a source's field list is the allowlist every query is checked
 * against, so publishing a column here publishes it to every reader who may see
 * the source. The snapshot is the document's unpublished content.
 */
const VERSION_FIELDS = [
  { name: "scopeSlug", type: "string" as const, label: "Collection" },
  { name: "entryId", type: "string" as const, label: "Document" },
  { name: "locale", type: "string" as const, label: "Language" },
  { name: "updatedAt", type: "date" as const, label: "Edited" },
];

function service(): VersionsService {
  if (!container.has("versionsService")) {
    throw NextlyError.internal({
      logContext: { reason: "versions-service-unregistered" },
    });
  }
  return container.get<VersionsService>("versionsService");
}

/**
 * What this source does with each field of a widget query.
 *
 * Exhaustive over `keyof WidgetQuery`, so adding a field there fails
 * `check-types` here until someone decides what it means for this source —
 * rather than the field being accepted by validation and then silently dropped,
 * which answers a different question than the caller asked.
 */
const QUERY_FIELD_USE: Record<keyof WidgetQuery, "consumed" | "refused"> = {
  source: "consumed",
  op: "consumed",
  select: "consumed",
  limit: "consumed",
  where: "refused",
  sort: "refused",
  status: "refused",
};

function refuseUnconsumed(query: WidgetQuery): void {
  const carried = Object.entries(query)
    .filter(
      ([name, value]) =>
        value !== undefined &&
        QUERY_FIELD_USE[name as keyof WidgetQuery] === "refused"
    )
    .map(([name]) => name);
  if (carried.length > 0) {
    failUnavailableSourceOrOp(
      `source "${VERSIONS_SOURCE_ID}" answers a fixed question and cannot honour: ${carried.join(", ")}`
    );
  }
}

/** A version row reduced to the fields this source declares. */
function projected(
  row: {
    scopeSlug: string;
    entryId: string;
    locale: string | null;
    updatedAt: Date;
  },
  names: readonly string[]
): Record<string, unknown> {
  const full: Record<string, unknown> = {
    scopeSlug: row.scopeSlug,
    entryId: row.entryId,
    locale: row.locale,
    updatedAt: row.updatedAt,
  };
  return Object.fromEntries(names.map(name => [name, full[name]]));
}

/**
 * The fields to answer with, in the order the query asked for them.
 *
 * 🔴 Order comes from `select`, not from `VERSION_FIELDS`. The table archetype
 * draws its columns straight off `WidgetResult.fields`, so rebuilding the list
 * in declaration order renders `select: ["updatedAt", "scopeSlug"]` as
 * Collection then Edited — the reverse of what its author wrote, with nothing
 * anywhere reporting a disagreement. The collection path derives it this way
 * for the same reason.
 *
 * Unknown names are dropped rather than refused, because the source's field list
 * is the allowlist every query is checked against and a name outside it has no
 * value to answer with. Duplicates are collapsed first: `["title", "title"]` is
 * a legal selection whose projection is one value, so emitting two descriptors
 * would have a table draw two columns for it.
 */
function selectedNames(query: WidgetQuery): string[] {
  if (!query.select?.length) return VERSION_FIELDS.map(field => field.name);
  return [
    ...new Set(
      query.select.filter(name =>
        VERSION_FIELDS.some(field => field.name === name)
      )
    ),
  ];
}

/** Each selected name paired with the label this source publishes for it. */
function describe(
  names: readonly string[]
): { name: string; label?: string }[] {
  const labels = new Map(
    VERSION_FIELDS.map(field => [field.name, field.label])
  );
  return names.map(name => {
    const label = labels.get(name);
    return { name, ...(label !== undefined && { label }) };
  });
}

async function resolveVersions(
  query: WidgetQuery,
  caller: ReadCaller
): Promise<WidgetResult> {
  refuseUnconsumed(query);

  // Resolved ONCE per query and passed down, rather than each read asking
  // again: the two ops answer about the same set, and two resolutions of one
  // caller's permissions are two chances to disagree.
  const readableSlugs = [
    ...(await readableEntities(
      await registeredContentSlugs(),
      readAccessCaller(caller)
    )),
  ];

  if (query.op === "count") {
    return {
      op: "count",
      total: await service().countPendingEdits(readableSlugs),
    };
  }

  const rows = await service().recentPendingEdits({
    readableSlugs,
    limit: query.limit ?? DEFAULT_LIMIT,
  });
  const names = selectedNames(query);
  const fields = query.select?.length ? describe(names) : undefined;

  return {
    op: "list",
    items: rows.map(row => projected(row, names)),
    ...(fields?.length ? { fields } : {}),
  };
}

/**
 * Publish the source and the function that answers it.
 *
 * `supports` names both ops because both are genuinely answerable: the count is
 * one aggregate over the versions table, and the list is one bounded read of
 * the same set. That is why this source is worth its own kind rather than being
 * two unrelated cards.
 */
export function registerVersionsWidgetSource(): void {
  registerSystemSource(
    {
      id: VERSIONS_SOURCE_ID,
      label: "Pending edits",
      kind: "system",
      supports: ["count", "list"],
      fields: VERSION_FIELDS,
    },
    resolveVersions
  );
}
