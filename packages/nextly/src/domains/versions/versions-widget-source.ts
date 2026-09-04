/**
 * `system:versions` — the documents carrying edits that are not live.
 *
 * 🔴 The access decision is made HERE, and that is the difference from
 * `system:releases`. `ReleasesService` authorizes itself, so that resolver
 * hands the caller through and adds nothing. `VersionsService` has no
 * authorization at all — none of its methods takes an actor — so a resolver
 * that simply called it would answer an install-wide number to a reader
 * entitled to part of it. The bound is `readableSlugAllowlist`, the same
 * resolution the collections listing uses, so a caller sees pending edits in
 * exactly the collections they may read.
 *
 * `undefined` from that helper means "no filter" (a super admin), `[]` means
 * "no readable collections" and must answer zero rather than everything. The
 * repository keeps those three answers distinct; reading `[]` as "no filter" is
 * one `?.length` away and hands every document to a caller granted none.
 *
 * @module domains/versions/versions-widget-source
 */

import { container } from "../../di/container";
import { NextlyError } from "../../errors/nextly-error";
import type { ReadCaller } from "../../services/dashboard/readable-resources";
import { readableSlugAllowlist } from "../../services/lib/readable-slug-allowlist";
import type { WidgetQuery } from "../widgets/query";
import type { WidgetResult } from "../widgets/result";
import { failUnavailableSourceOrOp } from "../widgets/sources";
import { registerSystemSource } from "../widgets/system-sources";

import type { VersionsService } from "./versions-service";

export const VERSIONS_SOURCE_ID = "system:versions";

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

async function resolveVersions(
  query: WidgetQuery,
  caller: ReadCaller
): Promise<WidgetResult> {
  refuseUnconsumed(query);

  // Resolved ONCE per query and passed down, rather than each read asking
  // again: the two ops answer about the same set, and two resolutions of one
  // caller's permissions are two chances to disagree.
  const readableSlugs = await readableSlugAllowlist(caller.user.id);

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
  const names = query.select?.length
    ? query.select.filter(name => VERSION_FIELDS.some(f => f.name === name))
    : VERSION_FIELDS.map(f => f.name);
  const fields = query.select?.length
    ? VERSION_FIELDS.filter(f => names.includes(f.name)).map(f => ({
        name: f.name,
        label: f.label,
      }))
    : undefined;

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
