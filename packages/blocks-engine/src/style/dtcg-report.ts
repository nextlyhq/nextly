/**
 * What an import reports about a token: its authored description and label,
 * a kind it refuses, Nextly fields and colour members it did not read, and
 * a stated value its own fields override.
 *
 * @module style/dtcg-report
 */
import type { ValidationIssue } from "../validation";

import type { TokenKind } from "./catalog-types";
import {
  type DtcgNode,
  isPlainObject,
  issue,
  NEXTLY_EXTENSION,
  statedDescription,
} from "./dtcg-format";
import {
  fluidNoteFor,
  fromDtcgValue,
  meansTheSame,
  withFluidNote,
} from "./dtcg-values";
import { tokenLabelIssue } from "./site-tokens";

/**
 * The description the author wrote: the one this system's extension records
 * when `$description` holds text it added (`null` for none), else the file's.
 */
export function authoredDescription(
  node: DtcgNode,
  own: unknown,
  name: string,
  issues: ValidationIssue[]
): string | undefined {
  if (!isPlainObject(own) || !("description" in own)) {
    return statedDescription(node);
  }
  const recorded = own.description;
  const stated = statedDescription(node);
  const css = isPlainObject(own.css) ? own.css.light : undefined;
  if (recorded === null || typeof recorded === "string") {
    const own = recorded ?? undefined;
    // `$description` as this system wrote it means the recorded one is the
    // author's; anything else was edited by another tool, and the edit is kept.
    const written =
      typeof css === "string"
        ? withFluidNote(own, fluidNoteFor(css))
        : undefined;
    return stated === undefined || stated === written ? own : stated;
  }
  issues.push(
    issue(
      `"${name}" carries a description in ${NEXTLY_EXTENSION} that is not text, so the file's own description was kept.`
    )
  );
  return statedDescription(node);
}

/**
 * The plain label this system's extension states, when it can be shown.
 *
 * A label is display text, so one that cannot be shown costs the label and not
 * the token: the derived label stands in, and the report says so.
 */
export function statedLabelOf(
  own: unknown,
  name: string,
  issues: ValidationIssue[]
): string | undefined {
  const stated = isPlainObject(own) ? own.label : undefined;
  const problem = tokenLabelIssue(stated);
  if (problem !== undefined) {
    issues.push(
      issue(`"${name}" carries a label that was not kept: ${problem}`)
    );
    return undefined;
  }
  return typeof stated === "string" ? stated : undefined;
}

/**
 * Why a token's type gives this site no kind to read it as, or nothing.
 *
 * Figma writes a true/false variable as a `number` marked by its own
 * extension. Read as a number it would import as 0 or 1, a value nothing on a
 * page can use, so it is refused and named like a type with no kind.
 */
export function kindRefusal(
  type: string | undefined,
  kind: TokenKind | undefined,
  extensions: DtcgNode,
  name: string
): string | undefined {
  if (kind === undefined) {
    return `"${name}" has the type "${type ?? "none"}", which this site has no token kind for, so it was skipped.`;
  }
  if (kind === "number" && extensions["com.figma.type"] === "boolean") {
    return `"${name}" is a true/false variable, which this site has no kind of variable for, so it was skipped.`;
  }
  return undefined;
}

/**
 * The fields this system reads out of its own extension and writes back from
 * the model.
 *
 * The boundary between the two halves of that key: a field named here is the
 * model's to state, and a field not named here is a producer's to keep. Named
 * rather than inferred, because the set is consulted from both ends and a
 * missing name is silent at each — on the way in a model field would be stored
 * a second time as preserved data, and on the way out that stale copy would be
 * written beside the live one.
 *
 * `writesNoFieldItDoesNotDeclare` in the tests is what holds this to the
 * emitter: it reads the key this system writes and requires every field in it
 * to be named here, so adding a field to the emitter without adding it here
 * fails.
 */
const NEXTLY_FIELDS = new Set(["id", "css", "kind", "label", "description"]);

/**
 * The half of this system's OWN extension key that the model does not state.
 *
 * Another vendor's block is carried whole; this key is split, because part of
 * it IS the model — `css`, `kind` and `id` are read into the token and written
 * back from it, so keeping the file's copy of those would let an export state a
 * value the site no longer holds. Everything else came from a producer this
 * build cannot interpret, most likely a newer version of this system, and is
 * kept exactly as it arrived.
 *
 * Filtered here AND again on the way out, which are two different guarantees
 * rather than the same one twice: this call decides what a token stores, and
 * the emitter's decides what a token stored by an EARLIER build may write. A
 * token saved while a field was unread still carries that field, and once this
 * build learns to read it only the emitter's filter can stop the stored copy
 * shadowing the live value.
 *
 * Built with `Object.fromEntries` rather than by assignment: these keys come
 * from a file, and assigning `__proto__` onto an object literal reaches
 * `Object.prototype`'s setter instead of storing anything — the field would
 * vanish from the very set that exists to keep it.
 */
export function unreadIn(
  own: unknown
): Readonly<Record<string, unknown>> | undefined {
  if (!isPlainObject(own)) return undefined;
  const kept = Object.entries(own).filter(([key]) => !NEXTLY_FIELDS.has(key));
  return kept.length === 0 ? undefined : Object.fromEntries(kept);
}

/**
 * The members of `css` this system reads.
 *
 * `css` is the one field above with a structure. `id` and `kind` are strings, so
 * a member cannot be added beside what they hold — a newer build widening either
 * into an object fails `isKind` or the id grammar, and the token falls to the
 * `$value` path or is refused, rather than losing something quietly.
 */
const CSS_MEMBERS = new Set(["light", "dark"]);

/**
 * Say which members of a READ field were not kept.
 *
 * The boundary of what preserving reaches, and it is deliberate. `unreadIn`
 * partitions this key at the TOP level only: a member a newer build added inside
 * `css` — a mode this one has no name for — is neither read nor kept, and this
 * is the only thing said about it.
 *
 * Reported rather than preserved, which is the opposite of the choice made one
 * level up, because `css` is not metadata about the token: it IS the token's
 * value, per mode. Writing a preserved member back beside a value the author has
 * since edited would state a mode derived from a value that no longer exists — a
 * colour that renders, looks plausible and is wrong. Losing it is recoverable
 * instead: a build that understands that mode sees it absent and can compute it
 * again, where it cannot see that a value it CAN read is stale.
 *
 * So the round trip is exact for a field this system does not read and lossy for
 * a member inside one it does. Said out loud, because the alternative is a
 * silent difference between the two.
 */
export function reportUnreadMembers(
  own: unknown,
  name: string,
  issues: ValidationIssue[]
): void {
  if (!isPlainObject(own)) return;
  const css = own.css;
  if (!isPlainObject(css)) return;
  const dropped = Object.keys(css).filter(key => !CSS_MEMBERS.has(key));
  if (dropped.length === 0) return;
  issues.push(
    issue(
      `"${name}" states ${dropped.map(key => `"${key}"`).join(", ")} among its per-mode values, which this version has no mode for, so it was not kept. That names a value rather than a note about one, and writing it back would state a mode for a colour this version may since have changed.`
    )
  );
}

/**
 * Say when the file's own `$value` did not agree with the CSS taken instead.
 *
 * A token can arrive described twice: the format's `$value`, and the exact CSS
 * this system wrote into its extension. The extension wins, and that is right —
 * it preserves what the author typed, where `$value` is a conversion. But when
 * the two genuinely DISAGREE, the file's value is discarded without a word and
 * the next export rewrites `$value` to match, so a hand-edited file loses the
 * edit and reports success.
 *
 * Only a real difference is named, never the preference itself. Naming the
 * preference would put a line against every token of every round trip, because
 * the two forms differ in SPELLING on files this system wrote: a token stored
 * as `#111` or `rgb(17 17 17)` comes back from `$value` as `#111111`. A report
 * that fires on correct files is the report that gets ignored.
 *
 * Only the LIGHT value is compared, because the format has one `$value` and a
 * dark value exists only in this system's extension — there is nothing there
 * for it to disagree with.
 */
export function reportOverridden(
  native: unknown,
  taken: string,
  kind: TokenKind,
  name: string,
  issues: ValidationIssue[]
): void {
  const stated = fromDtcgValue(native, kind);
  // Unreadable on its own is a different question, and not one this can answer:
  // there is no value to disagree with.
  if (stated === undefined) return;
  if (meansTheSame(stated, taken, kind)) return;
  issues.push(
    issue(
      `"${name}" was read as "${taken}", the value this system stored, and the "${stated}" its "$value" states was not used.`
    )
  );
}
