/**
 * `system:continue`: what Continue where you left off lists, one row per
 * document, as the reader may read it now.
 *
 * Two tabs, chosen by the query's `where.tab`:
 *
 * - **Mine** (the default): the reader's pins they may read, in the order they
 *   pinned them, then the documents they saved most recently, newest first.
 * - **Team**: the documents other people saved most recently, newest first,
 *   each with who saved it.
 *
 * Each tab lists a document once: the trail's walk answers one row per
 * document, and Mine leaves out a save of a document already listed as a pin.
 *
 * 🔴 No title comes from anything kept. The saves are the activity trail's,
 * through the same walk and per-row read check as Recent activity
 * (`ActivityLogService.getRecentEdits`), and a pin is the reader's own
 * choice; but the title of every row, its status and its icon are read now,
 * as the reader, through the ordinary read path (`readableHeadings`). A row
 * whose document the reader may not read now, or that is gone, is left out:
 * never drawn as "Untitled", which would still say something is there.
 *
 * @module services/dashboard/continue-widget-source
 */

import { container } from "../../di/container";
import type { NextlyServiceConfig } from "../../di/register";
import { activeAuditRetention } from "../../domains/audit/retention-config";
import type { VersionsService } from "../../domains/versions/versions-service";
import type { WidgetQuery } from "../../domains/widgets/query";
import { effectiveWidgetLimit } from "../../domains/widgets/query-limits";
import type { WidgetResult } from "../../domains/widgets/result";
import {
  failUnavailableSourceOrOp,
  isWidgetTab,
  refuseUnconsumedQueryFields,
  type WidgetTab,
} from "../../domains/widgets/sources";
import { CONTINUE_SOURCE_ID } from "../../domains/widgets/system-source-ids";
import { registerSystemSource } from "../../domains/widgets/system-sources";
import { NextlyError } from "../../errors/nextly-error";

import type {
  ActivityLogService,
  RecentEdit,
  RecentEditsOptions,
} from "./activity-log-service";
import { readActivitySubjects } from "./activity-subjects";
import { dashboardPinsService, type ShownPin } from "./dashboard-pins-service";
import {
  bootedHeadingRegistries,
  type DocumentHeading,
  type DocumentRef,
  headingKey,
  readableHeadings,
} from "./readable-headings";
import type { ReadCaller } from "./readable-resources";
import { resolveReadableResources } from "./resolve-readable-resources";
import { describeSelected, selectedNames } from "./selected-fields";

export { CONTINUE_SOURCE_ID };

/**
 * The fields this source publishes, and the ONLY names a query may select:
 * everything a row is drawn from, and nothing it does not draw.
 */
const CONTINUE_FIELDS = [
  { name: "id", type: "string" as const, label: "Row" },
  { name: "entryId", type: "string" as const, label: "Entry" },
  { name: "entryTitle", type: "string" as const, label: "Title" },
  { name: "collection", type: "string" as const, label: "Collection" },
  { name: "subjectKind", type: "string" as const, label: "Kind" },
  { name: "icon", type: "string" as const, label: "Icon" },
  { name: "locale", type: "string" as const, label: "Language" },
  { name: "actorType", type: "string" as const, label: "Saved by kind" },
  { name: "userId", type: "string" as const, label: "Saved by" },
  { name: "userName", type: "string" as const, label: "Name" },
  { name: "identityErasedAt", type: "date" as const, label: "Identity erased" },
  { name: "editedAt", type: "date" as const, label: "Edited" },
  { name: "status", type: "string" as const, label: "Status" },
  {
    name: "pendingChanges",
    type: "boolean" as const,
    label: "Changes not published",
  },
  { name: "pinned", type: "boolean" as const, label: "Pinned" },
];

/**
 * What this resolver does with each field of a widget query: an exhaustive
 * `Record`, as the other system sources keep, so a field added to
 * `WidgetQuery` fails `check-types` here until someone decides what it means.
 * `where` carries the card's tab, and nothing else.
 */
const QUERY_FIELD_USE: Record<keyof WidgetQuery, "consumed" | "refused"> = {
  source: "consumed",
  op: "consumed",
  select: "consumed",
  limit: "consumed",
  where: "consumed",
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
 * The tab a query's `where` names, Mine when it names none, or a refusal of
 * anything else in it: a key this source does not read would be validated
 * and then dropped, and the card would answer a different question.
 */
function tabOf(where: WidgetQuery["where"]): WidgetTab {
  if (where === undefined) return "mine";
  const unknown = Object.keys(where).filter(key => key !== "tab");
  if (unknown.length > 0) {
    failUnavailableSourceOrOp(
      `source "${CONTINUE_SOURCE_ID}" narrows by tab alone, not: ${unknown.join(", ")}`
    );
  }
  const { tab } = where;
  if (tab === undefined) return "mine";
  if (!isWidgetTab(tab)) {
    failUnavailableSourceOrOp(
      `source "${CONTINUE_SOURCE_ID}" takes tab as "mine" or "team"`
    );
  }
  return tab;
}

/** A day, in the milliseconds the retention windows are stated in. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How many whole days back the trail holds rows, or `undefined` when nothing
 * prunes it, rounded DOWN so the span is never overstated; read through
 * `activeAuditRetention`, so a reloaded policy is the one reported.
 */
function retentionDays(): number | undefined {
  const built = container.has("config")
    ? container.get<NextlyServiceConfig>("config").auditRetention
    : undefined;
  const maxAge = activeAuditRetention(built)?.activityMaxAgeMs;
  if (typeof maxAge !== "number") return undefined;
  const days = Math.floor(maxAge / DAY_MS);
  return days >= 1 ? days : undefined;
}

/** The answer's span, as the list result states it: present only when bounded. */
function windowOf(): { window?: { days: number } } {
  const days = retentionDays();
  return days === undefined ? {} : { window: { days } };
}

/** The services, resolved at CALL time, as `system:activity` resolves its own. */
function activityLog(): ActivityLogService {
  if (!container.has("activityLogService")) {
    throw NextlyError.internal({
      logContext: { reason: "activity-log-service-unregistered" },
    });
  }
  return container.get<ActivityLogService>("activityLogService");
}

function versions(): VersionsService | undefined {
  return container.has("versionsService")
    ? container.get<VersionsService>("versionsService")
    : undefined;
}

/** One row of the card, before it is cut to the fields the query selects. */
interface ContinueRow {
  id: string;
  entryId: string;
  entryTitle: string;
  collection: string;
  subjectKind: "collection" | "single";
  icon: string | null;
  locale: string | null;
  actorType: string | null;
  userId: string | null;
  userName: string | null;
  identityErasedAt: string | null;
  editedAt: string | null;
  status: string | null;
  pendingChanges: boolean | null;
  pinned: boolean;
}

/** The document a pin names. */
function pinRef(pin: ShownPin): DocumentRef {
  return {
    kind: pin.targetType,
    slug: pin.targetSlug,
    entryId: pin.entryId,
  };
}

/** The document a save names. */
function editRef(edit: RecentEdit): DocumentRef {
  const kind = edit.subjectKind === "single" ? "single" : "collection";
  return {
    kind,
    slug: edit.collection,
    entryId: kind === "single" ? "" : (edit.entryId ?? ""),
  };
}

/** A pin as a row: its heading as read now, edited when the document last was. */
function pinRow(pin: ShownPin): ContinueRow {
  return {
    id: `pin:${headingKey(pinRef(pin))}`,
    entryId: pin.entryId,
    entryTitle: pin.title,
    collection: pin.targetSlug,
    subjectKind: pin.targetType,
    icon: pin.icon ?? null,
    locale: null,
    actorType: null,
    userId: null,
    userName: null,
    identityErasedAt: null,
    editedAt: pin.updatedAt ?? null,
    status: pin.status ?? null,
    pendingChanges: null,
    pinned: true,
  };
}

/** A save as a row: who saved it and when, under its heading as read now. */
function editRow(
  edit: RecentEdit,
  heading: DocumentHeading,
  pinned: boolean
): ContinueRow {
  const ref = editRef(edit);
  return {
    id: edit.id,
    entryId: edit.entryId ?? "",
    entryTitle: heading.title,
    collection: ref.slug,
    subjectKind: ref.kind,
    icon: heading.icon ?? null,
    locale: edit.locale,
    actorType: edit.actorType,
    userId: edit.userId,
    userName: edit.userName,
    identityErasedAt: edit.identityErasedAt,
    editedAt: edit.createdAt,
    status: heading.status ?? null,
    pendingChanges: null,
    pinned,
  };
}

/** The reader as a person, or `undefined` for an API key, which has no pins or saves of its own. */
function personOf(caller: ReadCaller): string | undefined {
  if (caller.authenticatedScope?.actorType === "apiKey") return undefined;
  return typeof caller.user?.id === "string" ? caller.user.id : undefined;
}

/** The trail's latest saves, one per document, as the reader may see them. */
async function recentEdits(
  caller: ReadCaller,
  options: Pick<RecentEditsOptions, "limit" | "savedBy" | "notSavedBy">
): Promise<RecentEdit[]> {
  const subjects = await readActivitySubjects();
  const { edits } = await activityLog().getRecentEdits({
    ...options,
    scope: await resolveReadableResources(caller),
    caller,
    ...subjects,
  });
  return edits;
}

/**
 * The saves as rows, each under its heading read now as the reader; a save
 * whose document they may not read now, or that is gone, is left out.
 */
async function editRows(
  edits: readonly RecentEdit[],
  caller: ReadCaller,
  pinned: ReadonlySet<string>
): Promise<ContinueRow[]> {
  const headings = await readableHeadings(
    edits.map(editRef),
    caller,
    bootedHeadingRegistries()
  );
  return edits.flatMap(edit => {
    const key = headingKey(editRef(edit));
    const heading = headings.get(key);
    return heading === undefined
      ? []
      : [editRow(edit, heading, pinned.has(key))];
  });
}

/** The reader's pins they may read, in the order pinned; none for a caller who is not a person. */
async function readerPins(
  caller: ReadCaller,
  person: string | undefined
): Promise<ShownPin[]> {
  if (person === undefined) return [];
  const pins = await dashboardPinsService().list(caller);
  return [...pins].sort((a, b) => a.pinnedAt.localeCompare(b.pinnedAt));
}

/**
 * Mine: the pins first, in the order pinned, then the reader's own latest
 * saves of documents not pinned, newest first, at most `limit` rows. Enough
 * saves are asked for that the pins they also name cannot leave Mine short.
 */
async function mineRows(
  caller: ReadCaller,
  person: string | undefined,
  limit: number
): Promise<ContinueRow[]> {
  if (person === undefined) return [];
  const pins = await readerPins(caller, person);
  const pinned = new Set(pins.map(pin => headingKey(pinRef(pin))));
  const edits = await recentEdits(caller, {
    limit: limit + pins.length,
    savedBy: person,
  });
  const saved = await editRows(
    edits.filter(edit => !pinned.has(headingKey(editRef(edit)))),
    caller,
    pinned
  );
  return [...pins.map(pinRow), ...saved].slice(0, limit);
}

/**
 * Team: other people's latest saves, newest first, each marked as pinned when
 * the reader has pinned its document, so its menu offers the right verb.
 */
async function teamRows(
  caller: ReadCaller,
  person: string | undefined,
  limit: number
): Promise<ContinueRow[]> {
  const pins = await readerPins(caller, person);
  const pinned = new Set(pins.map(pin => headingKey(pinRef(pin))));
  const edits = await recentEdits(caller, {
    limit,
    ...(person === undefined ? {} : { notSavedBy: person }),
  });
  return editRows(edits, caller, pinned);
}

/** The rows that name a document id, grouped by their collection or Single. */
function byDocumentScope(rows: readonly ContinueRow[]): ContinueRow[][] {
  const groups = new Map<string, ContinueRow[]>();
  for (const row of rows) {
    if (row.entryId === "") continue;
    const key = JSON.stringify([row.subjectKind, row.collection]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()];
}

/**
 * Whether each row of `group` holds changes not yet published, in the
 * language it was saved in, from one read; nothing when the read fails.
 */
async function pendingOf(
  pending: VersionsService,
  group: readonly ContinueRow[]
): Promise<[ContinueRow, boolean][]> {
  const [first] = group;
  if (first === undefined) return [];
  try {
    const locales = await pending.pendingChangeLocales(
      first.subjectKind,
      first.collection,
      group.map(row => row.entryId)
    );
    return group.map((row): [ContinueRow, boolean] => [
      row,
      locales.get(row.entryId)?.has(row.locale) === true,
    ]);
  } catch {
    // A label is never worth the card: these rows say nothing about it.
    return [];
  }
}

/**
 * Each row with whether its document holds changes not yet published: one
 * read per collection or Single, all at once. A read that fails leaves its
 * rows saying nothing (`null`), never "no changes"; a pinned Single, which
 * names no document id, says nothing either.
 */
async function withPendingChanges(
  rows: readonly ContinueRow[]
): Promise<ContinueRow[]> {
  const pending = versions();
  if (pending === undefined) return [...rows];
  const answers = new Map(
    (
      await Promise.all(
        byDocumentScope(rows).map(group => pendingOf(pending, group))
      )
    ).flat()
  );
  return rows.map(row => {
    const answer = answers.get(row);
    return answer === undefined ? row : { ...row, pendingChanges: answer };
  });
}

/** Answer Continue where you left off for this reader, on the tab the query names. */
async function resolveContinue(
  query: WidgetQuery,
  caller: ReadCaller
): Promise<WidgetResult> {
  refuseUnconsumedQueryFields(query, QUERY_FIELD_USE, CONTINUE_SOURCE_ID);
  const tab = tabOf(query.where);
  const limit = effectiveWidgetLimit(query.limit);
  const person = personOf(caller);
  const rows = await withPendingChanges(
    tab === "team"
      ? await teamRows(caller, person, limit)
      : await mineRows(caller, person, limit)
  );
  const names = selectedNames(CONTINUE_FIELDS, query.select);
  const fields = describeSelected(CONTINUE_FIELDS, query.select);
  return {
    op: "list",
    items: rows.map(row => {
      const values: Record<string, unknown> = { ...row };
      return Object.fromEntries(names.map(name => [name, values[name]]));
    }),
    ...(fields ? { fields } : {}),
    // The trail holds saves for its retention period alone, so the answer
    // says how far back it looked: an empty card then says "none in that
    // span" rather than "none ever".
    ...windowOf(),
  };
}

/**
 * Publish the source and the function that answers it, from the boot-time
 * registry reset, as the other system sources are. It narrows by Tab, which
 * reaches it as the query's `where`.
 */
export function registerContinueWidgetSource(): void {
  registerSystemSource(
    {
      id: CONTINUE_SOURCE_ID,
      label: "Continue where you left off",
      kind: "system",
      titleField: "entryTitle",
      supports: ["list"],
      fields: CONTINUE_FIELDS,
      filters: ["tab"],
    },
    resolveContinue
  );
}
