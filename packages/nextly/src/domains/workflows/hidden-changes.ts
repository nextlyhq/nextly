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
import { resolveRunAs } from "../../shared/lib/resolve-run-as";
import type { UserContext } from "../collections/services/collection-types";
import type { LiveFieldGroupReadPass } from "../field-groups/live-read-access";
import { databaseRunAs } from "../jobs/jobs-runner";
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
 * The person `userId` as a document read hands them to access rules: the context the canonical
 * resolver builds (`resolveRunAs`), roles, email and claims included, so a rule reading any of
 * them answers here as it does on a read. Null for a person who is gone or deactivated.
 */
export async function readerOf(
  adapter: DrizzleAdapter,
  userId: string
): Promise<UserContext | null> {
  const resolved = await resolveRunAs(databaseRunAs(adapter), userId);
  return resolved.ok ? resolved.user : null;
}

/**
 * Which of `fields` the reader `user` cannot read in full in `shown`: absent from what a read of
 * it gives them, or given with something inside withheld. `fieldGroupPass` is the field-group
 * read pass a read of the document's collection makes (undefined where no field group has a read
 * rule), so the rules of fields inside field groups apply here as they do on a read.
 */
export async function hiddenFrom(
  document: ReviewDocument,
  shown: unknown,
  fields: readonly string[],
  user: UserContext,
  grants: () => Promise<CallerGrants>,
  fieldGroupPass: LiveFieldGroupReadPass | undefined
): Promise<string[]> {
  if (fields.length === 0) return [];
  const whole = snapshotRecord(shown);
  // A copy the evaluation may strip at any depth; the snapshot is JSON, so a JSON copy is whole.
  const readable = JSON.parse(JSON.stringify(whole)) as Record<string, unknown>;
  await applyFieldReadAccess({
    kind: entityOf(document),
    slug: document.scopeSlug,
    entry: readable,
    // The reader whole, as a read gives them to the rules: never a narrower copy.
    user,
    grants,
    overrideAccess: false,
  });
  // The collection's own pass does not reach inside a field group; a read then makes this one,
  // with the same reader and grants.
  await fieldGroupPass?.(readable, { user, grants });
  return fields.filter(name => withheld(name, whole, readable));
}

/**
 * Whether the access pass withheld `name`: it removed a value the version holds, or something
 * inside one. A field the version does not hold at all, such as one the collection no longer has,
 * is a change anyone may approve: nothing of it is there to hide.
 */
function withheld(
  name: string,
  whole: Record<string, unknown>,
  readable: Record<string, unknown>
): boolean {
  if (!(name in whole)) return false;
  if (!(name in readable)) return true;
  return canonicalJson(readable[name]) !== canonicalJson(whole[name]);
}

/** What the people who could approve instead are judged on. */
interface ApproversQuestion {
  document: ReviewDocument;
  action: string;
  parts: ReadonlyArray<{ shown: unknown; changed: readonly string[] }>;
  excluded: ReadonlySet<string>;
  /** The field-group read pass the refused reviewer was judged with. */
  fieldGroupPass: LiveFieldGroupReadPass | undefined;
}

/** A person as the approvers question reads them. */
interface PersonRow {
  id: string;
  name: string | null;
  isActive: boolean | number | null;
}

/** Whether `person` can read every changed field of every part in full. */
async function readsEveryChange(
  adapter: DrizzleAdapter,
  question: ApproversQuestion,
  person: PersonRow
): Promise<boolean> {
  // Judged as a read judges them, by the same context the reviewer is judged by.
  const reader = await readerOf(adapter, person.id);
  if (reader === null) return false;
  const grants = await resolvedCallerGrants(reader);
  for (const part of question.parts) {
    const hidden = await hiddenFrom(
      question.document,
      part.shown,
      part.changed,
      reader,
      grants,
      question.fieldGroupPass
    );
    if (hidden.length > 0) return false;
  }
  return true;
}

/** Whether `person` could approve in place of the refused reviewer. */
async function couldApprove(
  adapter: DrizzleAdapter,
  question: ApproversQuestion,
  person: PersonRow
): Promise<boolean> {
  // SQLite stores a boolean as 0 or 1.
  if (!person.isActive || question.excluded.has(person.id)) return false;
  const holds = await holderAnswer(
    adapter,
    { kind: "user", id: person.id },
    question.action,
    question.document.scopeSlug
  );
  return (
    holds === "holds" && (await readsEveryChange(adapter, question, person))
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
  question: ApproversQuestion
): Promise<PossibleApprover[]> {
  const people = await adapter.select<PersonRow>("users", {
    columns: ["id", "name", "isActive"],
    orderBy: [{ column: "id", direction: "asc" }],
    limit: MAX_PEOPLE_ASKED,
  });
  const found: PossibleApprover[] = [];
  for (const person of people) {
    if (found.length >= MAX_APPROVERS) break;
    if (await couldApprove(adapter, question, person)) {
      found.push({ kind: "user", id: person.id, name: person.name ?? null });
    }
  }
  return found;
}
