/**
 * What an approval would cover that its reviewer cannot read: the fields that changed since the
 * part was last approved, or else since it last went live, which a field-level read rule hides
 * from them, at any depth.
 *
 * Readability is asked of the field-access evaluation every read uses (`applyFieldReadAccess`),
 * over the version the reviewer is shown, so a reviewer is refused exactly what a read of that
 * version would withhold from them. The caller resolves the reviewer's grants before its
 * transaction opens (`resolvedCallerGrants`), so the evaluation reads nothing beside it.
 *
 * @module domains/workflows/hidden-changes
 * @experimental
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { canonicalJson } from "../../shared/lib/canonical-json";
import {
  applyFieldReadAccess,
  resolvedCallerGrants,
  type CallerGrants,
} from "../../shared/lib/field-level-registry";
import { snapshotRecord } from "../versions/shared-publish-base";
import { documentSystemKeys } from "../versions/snapshot-system-keys";

import { holderAnswer } from "./holders";
import type { ReviewDocument } from "./review-state-repository";

/** The most people a refusal names as able to approve instead. */
const MAX_APPROVERS = 10;

/** The most people asked, so a refusal on a large install stays bounded. */
const MAX_PEOPLE_ASKED = 200;

/**
 * Someone who could approve what a reviewer was refused.
 *
 * @experimental
 */
export interface PossibleApprover {
  kind: "user";
  id: string;
  name: string | null;
}

const entityOf = (document: ReviewDocument) =>
  document.scopeKind === "single"
    ? ("single" as const)
    : ("collection" as const);

/**
 * The top-level fields of `shown` whose values differ from `baseline`'s, the framework's own keys
 * and `exemptFields` left out. With no baseline, nothing was approved or published, so every
 * field holding a value is new.
 */
export function changedFields(
  document: ReviewDocument,
  shown: unknown,
  baseline: unknown,
  exemptFields: readonly string[]
): string[] {
  const now = snapshotRecord(shown);
  const before = baseline === undefined ? null : snapshotRecord(baseline);
  const left = new Set([
    ...documentSystemKeys(entityOf(document)),
    ...exemptFields,
  ]);
  const names = new Set([
    ...Object.keys(now),
    ...(before === null ? [] : Object.keys(before)),
  ]);
  return [...names]
    .filter(name => !left.has(name))
    .filter(name =>
      before === null
        ? now[name] !== null && now[name] !== undefined
        : canonicalJson(now[name]) !== canonicalJson(before[name])
    )
    .sort();
}

/**
 * Which of `fields` the reader `user` cannot read in full in `shown`: absent from what a read of
 * it gives them, or given with something inside withheld.
 */
export async function hiddenFrom(
  document: ReviewDocument,
  shown: unknown,
  fields: readonly string[],
  user: { id: string; name?: string | null },
  grants: () => Promise<CallerGrants>
): Promise<string[]> {
  if (fields.length === 0) return [];
  const whole = snapshotRecord(shown);
  // A copy the evaluation may strip at any depth; the snapshot is JSON, so a JSON copy is whole.
  const readable = JSON.parse(JSON.stringify(whole)) as Record<string, unknown>;
  await applyFieldReadAccess({
    kind: entityOf(document),
    slug: document.scopeSlug,
    entry: readable,
    user: { id: user.id, ...(user.name ? { name: user.name } : {}) },
    grants,
    overrideAccess: false,
  });
  return fields.filter(
    name =>
      !(name in readable) ||
      canonicalJson(readable[name]) !== canonicalJson(whole[name])
  );
}

/**
 * The people who could approve `parts` in place of a refused reviewer: active, not `excluded`
 * (the reviewer, and whoever the step refuses as accountable for a part's stage), holding the
 * step's `action` on the document's collection by the one decision (`holderAnswer`), and able
 * to read every field in `parts` that changed. At most {@link MAX_APPROVERS}, ordered by id.
 *
 * Read on the pool, after the refused step's transaction has ended: asked only once a refusal is
 * certain, so an approval that goes through reads none of it.
 */
export async function possibleApprovers(
  adapter: DrizzleAdapter,
  args: {
    document: ReviewDocument;
    action: string;
    parts: ReadonlyArray<{ shown: unknown; changed: readonly string[] }>;
    excluded: ReadonlySet<string>;
  }
): Promise<PossibleApprover[]> {
  const people = await adapter.select<{
    id: string;
    name: string | null;
    isActive: boolean | number | null;
  }>("users", {
    columns: ["id", "name", "isActive"],
    orderBy: [{ column: "id", direction: "asc" }],
    limit: MAX_PEOPLE_ASKED,
  });
  const found: PossibleApprover[] = [];
  for (const person of people) {
    if (found.length >= MAX_APPROVERS) break;
    // SQLite stores a boolean as 0 or 1.
    if (!person.isActive || args.excluded.has(person.id)) continue;
    const holds = await holderAnswer(
      adapter,
      { kind: "user", id: person.id },
      args.action,
      args.document.scopeSlug
    );
    if (holds !== "holds") continue;
    const grants = await resolvedCallerGrants({ id: person.id });
    let readsAll = true;
    for (const part of args.parts) {
      const hidden = await hiddenFrom(
        args.document,
        part.shown,
        part.changed,
        person,
        grants
      );
      if (hidden.length > 0) {
        readsAll = false;
        break;
      }
    }
    if (readsAll) {
      found.push({ kind: "user", id: person.id, name: person.name ?? null });
    }
  }
  return found;
}
