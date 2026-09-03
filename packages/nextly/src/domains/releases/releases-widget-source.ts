/**
 * `system:releases` — the dashboard's view of what ships next.
 *
 * The first source answered by a DOMAIN SERVICE rather than compiled to a
 * collection query, and it is here rather than in the widgets domain because
 * the registration is PUSHED: widgets knows nothing about releases, so a domain
 * can publish a source without editing a file it does not own, and the widgets
 * package does not acquire a dependency on most of the codebase to offer a card.
 *
 * 🔴 The resolver adds no access rule of its own. `ReleasesService.find` calls
 * its own `authorize` before it reads, so every row this returns has already
 * been judged by the rule that owns it. A filter applied here would be a second
 * implementation of that rule, agreeing on the day it is written and drifting
 * afterwards — which is what `domains/widgets/system-sources.ts` exists to
 * prevent, and what Strapi's homepage widgets got wrong (strapi#22921).
 *
 * @module domains/releases/releases-widget-source
 */

import { container } from "../../di/container";
import { NextlyError } from "../../errors/nextly-error";
import type { ReadCaller } from "../../services/dashboard/readable-resources";
import type { WidgetQuery } from "../widgets/query";
import type { WidgetResult, WidgetResultField } from "../widgets/result";
import { failUnavailableSourceOrOp } from "../widgets/sources";
import { registerSystemSource } from "../widgets/system-sources";

import type { ReleaseRow } from "./releases-repository";
import type {
  ReleaseActor,
  ReleasesService,
} from "./services/releases-service";

export const RELEASES_SOURCE_ID = "system:releases";

/**
 * How many releases the card reads when the query names no limit.
 *
 * A cap rather than a page size: `find` is bounded by `scheduledAfter` as well,
 * so this only decides how much of an unusually crowded schedule a card draws.
 */
const DEFAULT_LIMIT = 5;

/**
 * The fields this source publishes, and the ONLY names a query may reference.
 *
 * Deliberately three of `ReleaseRow`'s eleven. `createdBy`, `revision`,
 * `publishedAt` and the rest are either an internal identifier or a fact about
 * a release that has already shipped, and a source's field list is the
 * allowlist every `select` is checked against — so publishing a column here is
 * publishing it to every reader who may see the source at all.
 */
const RELEASE_FIELDS = [
  { name: "title", type: "string" as const, label: "Release" },
  { name: "state", type: "string" as const, label: "State" },
  { name: "scheduledAt", type: "date" as const, label: "Scheduled" },
];

/**
 * The service, resolved at CALL time rather than at registration.
 *
 * `registerReleasesWidgetSource` runs during boot's registry reset, before the
 * container necessarily holds `releasesService`; a resolver that captured the
 * instance would either fail at boot or pin the first one built and survive a
 * hot reload holding it. This is the same lookup `direct-api/namespaces/releases`
 * makes, including the `has` guard, for the same reason.
 */
function service(): ReleasesService {
  if (!container.has("releasesService")) {
    // The public sentence stays the uniform internal-error one; the reason an
    // operator needs goes to the log rather than into a body a client reads.
    throw NextlyError.internal({
      logContext: { reason: "releases-service-unregistered" },
    });
  }
  return container.get<ReleasesService>("releasesService");
}

/**
 * The dashboard caller, as the releases domain spells one.
 *
 * `overrideAccess` is deliberately never set: this is a reader's request, and
 * the service must judge it as one. The API key's own stamped scope travels
 * when present, because a narrowly scoped key must be judged on that scope
 * rather than on the roles of whoever minted it.
 */
function actorFor(caller: ReadCaller): ReleaseActor {
  return {
    userId: caller.user.id,
    ...(caller.authenticatedScope !== undefined && {
      authenticatedScope: caller.authenticatedScope,
    }),
  };
}

/** A release row reduced to the fields this source declares. */
function projected(row: ReleaseRow, names: readonly string[]) {
  const full: Record<string, unknown> = {
    title: row.title,
    state: row.state,
    scheduledAt: row.scheduledAt,
  };
  return Object.fromEntries(names.map(name => [name, full[name]]));
}

/**
 * The columns to head a list with, when the query chose them.
 *
 * Mirrors the collection path: `fields` is present only when the query declared
 * `select`, because without one the rows carry whatever the source holds and
 * there are no columns the widget chose.
 */
function describeFields(
  select: readonly string[] | undefined
): WidgetResultField[] | undefined {
  if (!select || select.length === 0) return undefined;
  const labels = new Map(RELEASE_FIELDS.map(f => [f.name, f.label]));
  const seen = new Set<string>();
  const described: WidgetResultField[] = [];
  for (const name of select) {
    if (seen.has(name)) continue;
    seen.add(name);
    const label = labels.get(name);
    if (label !== undefined) described.push({ name, label });
  }
  return described.length > 0 ? described : undefined;
}

/**
 * Answer "what ships next", soonest first.
 *
 * 🔴 `order: "soonest"` is what makes the limit keep the right end. The
 * repository's default is recent-first, which is correct for "what happened"
 * and returns the FURTHEST-OUT releases for this question — with real rows, in
 * a plausible order, so nothing in the result says it is wrong.
 *
 * `scheduledAfter: now` rather than a fixed window: a release scheduled for
 * next year is still the next one when nothing is closer, and a window would
 * make the card empty rather than say so.
 *
 * `where` and `sort` are REFUSED rather than ignored. The source's declared
 * fields are the allowlist a query's `where` is validated against, so a caller
 * may express one — and this resolver asks a fixed question, so honouring the
 * validation while discarding the filter would answer a different question than
 * the one asked and look correct doing it. Refused with the shared string, the
 * way every other dead end here answers.
 */
async function resolveReleases(
  query: WidgetQuery,
  caller: ReadCaller
): Promise<WidgetResult> {
  if (query.where !== undefined) {
    failUnavailableSourceOrOp(
      `source "${RELEASES_SOURCE_ID}" does not support a "where" filter`
    );
  }
  if (query.sort !== undefined) {
    failUnavailableSourceOrOp(
      `source "${RELEASES_SOURCE_ID}" answers in schedule order and cannot be sorted`
    );
  }

  const rows = await service().find(
    {
      state: "scheduled",
      scheduledAfter: new Date(),
      order: "soonest",
      limit: query.limit ?? DEFAULT_LIMIT,
    },
    actorFor(caller)
  );

  const names = query.select?.length
    ? query.select.filter(name => RELEASE_FIELDS.some(f => f.name === name))
    : RELEASE_FIELDS.map(f => f.name);

  return {
    op: "list",
    items: rows.map(row => projected(row, names)),
    ...(describeFields(query.select) && {
      fields: describeFields(query.select),
    }),
  };
}

/**
 * Publish the source and the function that answers it.
 *
 * Called from the boot-time registry reset, which is the one choke point both
 * boot paths funnel through — so a dev-server hot reload republishes exactly
 * once rather than colliding with the previous boot's registration.
 *
 * `supports` names `list` and nothing else. There is no count endpoint on the
 * releases service, and counting by fetching every row is the full scan
 * `find`'s own limit docblock warns against; declaring an op this source cannot
 * answer would put the refusal in front of a reader rather than here.
 */
export function registerReleasesWidgetSource(): void {
  registerSystemSource(
    {
      id: RELEASES_SOURCE_ID,
      label: "Upcoming releases",
      kind: "system",
      titleField: "title",
      supports: ["list"],
      fields: RELEASE_FIELDS,
    },
    resolveReleases
  );
}
