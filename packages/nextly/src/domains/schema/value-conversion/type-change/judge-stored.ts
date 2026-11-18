/**
 * A field's type change judged over every value its column holds: each stored value read as the
 * old field reads it (`decodeStored`), judged by the eight rules (`judgeValue`), and collected as
 * the class the worst value gives, every reason with how many rows give it and the first of their
 * keys, and the keys a lost value would clear. Rows are named by their key, never their value.
 *
 * @module domains/schema/value-conversion/type-change/judge-stored
 */
import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { validateEntryData } from "../../../../shared/lib/entry-validation";
import type { SupportedDialect } from "../../services/field-column-descriptor";
import { reasonClass } from "../judge-column";
import type { KeyedBy } from "../read-values";
import { readStoredValues } from "../read-values";
import type {
  ConversionJudgement,
  ConversionReasonKind,
  RowKey,
  StoredValue,
} from "../types";

import { decodeStored } from "./decode-stored";
import type { FieldTypeOnDialect } from "./field-type";
import {
  classOf,
  judgeValue,
  type ValueVerdict,
  type OutcomeReason,
  pairBlocked,
  type ValueOutcome,
} from "./judge";
import { type StoredAsRead, storedAsRead } from "./stored-as-read";

/** How many keys a reason names before it gives only the count. */
export const FIRST_KEYS = 20;

/** A field's type change judged over its stored values. */
export interface StoredTypeChangeJudgement {
  judgement: ConversionJudgement;
  /** Every row whose value the change would clear: the lost ones. */
  cleared: RowKey[];
  /** How many values each outcome holds, for a review that names the changed ones too. */
  counts: Record<ValueOutcome, number>;
}

/** What a collection is asked besides the class, reasons and rows. */
export interface CollectOptions {
  /**
   * The new field is unique: two values that read as one value of the new type block the change
   * (`repeated`), counted within each language where the field is translated. Only then are the
   * values kept as the scan goes, each distinct one once.
   */
  unique?: boolean;
  /** Each kept or changed value, as the new type reads it, handed over as it is judged. */
  onReading?: (key: RowKey, readsAs: string) => void;
}

/**
 * The reason kind each outcome reason is reported as. Kept values give no reason; a value stored
 * in its new form is counted as `new-form`, which is safe.
 */
const REPORTED_AS: Record<
  Exclude<OutcomeReason, "same-value" | "empty">,
  ConversionReasonKind
> = {
  "new-form": "new-form",
  "too-long": "too-long",
  rounded: "rounded",
  "out-of-range": "out-of-range",
  "no-time-or-offset": "no-time-or-offset",
  "not-a-number": "not-a-number",
  "not-a-date": "not-a-date",
  "not-an-email": "not-an-email",
  "not-an-option": "not-an-option",
  "not-a-boolean": "not-a-boolean",
  "non-finite": "non-finite",
  "several-items": "several-items",
  "item-not-held": "item-not-held",
  object: "object",
  "kind-never-held": "kind-never-held",
  "pair-blocked": "pair-blocked",
  "link-not-carried": "link-not-carried",
  "column-refuses": "column-refuses",
  "field-refuses": "field-refuses",
};

/**
 * The judgement of values already in hand: each judged by the eight rules and collected. The
 * database read is `judgeStoredTypeChange`'s; this is the collecting, on its own so it can be
 * judged without a database.
 */
export async function collectTypeChange(
  from: FieldTypeOnDialect,
  to: FieldTypeOnDialect,
  values: AsyncIterable<Pick<StoredValue, "key" | "text" | "exactReal">>,
  accepts?: (readsAs: string) => Promise<boolean>,
  options: CollectOptions = {}
): Promise<StoredTypeChangeJudgement> {
  // A pair blocked whatever its values hold is one reason of the types, with no rows. A
  // relationship's change is judged by its rows instead: one holding no link has nothing for the
  // change to carry, so only the rows holding one block it, each counted (`link-not-carried`).
  const blocked = pairBlocked(from, to);
  if (blocked !== null && blocked !== "relationship") {
    return {
      judgement: {
        class: "blocked",
        reasons: [{ kind: "pair-blocked", class: "blocked" }],
      },
      cleared: [],
      counts: { kept: 0, changed: 0, lost: 0, blocked: 0 },
    };
  }
  const read = storedAsRead(from, to);
  const tally = new TypeChangeTally(options, read);
  for await (const value of values) {
    const stored = value.exactReal ?? value.text;
    tally.add(
      value.key,
      await withFieldRule(
        asConverted(
          judgeValue(from, to, decodeStored(from, value)),
          stored,
          read
        ),
        accepts
      ),
      stored
    );
  }
  return tally.result();
}

/**
 * A verdict as the save's conversion leaves the value: a blank value the rules read as empty is
 * written as what the conversion writes for it (`blankAs`), and a stored empty list a list keeps
 * stays `[]`; either is then judged by the new field, as a required list refuses `[]`.
 */
function asConverted(
  verdict: ValueVerdict,
  stored: string | null,
  read: StoredAsRead
): ValueVerdict {
  // A stored empty the conversion writes as no value is empty to the new type, however the old type
  // reads it: a one-link column's text `null` reads as a link, and the switch's guard clears it.
  if (stored !== null && read.writtenAsNone?.includes(stored.trim()) === true) {
    return { outcome: "kept", reason: "empty" };
  }
  if (verdict.reason !== "empty" || stored === null) return verdict;
  if (read.blankAs !== undefined) {
    return { outcome: "changed", reason: "new-form", readsAs: read.blankAs };
  }
  // A stored empty list the new type keeps as it is: still a value, which a required list refuses.
  if (read.emptyListHeld && stored.trim() === "[]") {
    return { outcome: "kept", reason: "same-value", readsAs: "[]" };
  }
  return verdict;
}

/** The values of one type change counted as they are judged: by outcome, by reason, and cleared. */
class TypeChangeTally {
  private readonly counts: Record<ValueOutcome, number> = {
    kept: 0,
    changed: 0,
    lost: 0,
    blocked: 0,
  };
  private readonly byReason = new Map<
    ConversionReasonKind,
    { count: number; first: RowKey[] }
  >();
  private readonly cleared: RowKey[] = [];
  private readonly repeatsOf:
    | ((key: RowKey, readsAs: string) => RowKey[] | undefined)
    | undefined;

  constructor(
    private readonly options: CollectOptions,
    private readonly read: StoredAsRead
  ) {
    this.repeatsOf = options.unique === true ? uniqueValues() : undefined;
  }

  /** One value's verdict, counted, with the text the database stores it as. */
  add(key: RowKey, verdict: ValueVerdict, stored: string | null): void {
    if (
      this.emptyNotHeld(key, verdict, stored) ||
      (verdict.readsAs !== undefined &&
        this.blocks(key, verdict.outcome, verdict.readsAs, stored))
    ) {
      this.counts.blocked += 1;
      return;
    }
    this.counts[verdict.outcome] += 1;
    if (verdict.outcome === "lost") this.cleared.push(key);
    if (verdict.reason === "same-value" || verdict.reason === "empty") return;
    this.note(REPORTED_AS[verdict.reason], key);
  }

  /** The class the worst value gives, every reason with its rows, and the rows to clear. */
  result(): StoredTypeChangeJudgement {
    const outcomes = (Object.keys(this.counts) as ValueOutcome[]).filter(
      o => this.counts[o] > 0
    );
    return {
      judgement: {
        class: classOf(outcomes),
        reasons: [...this.byReason].map(([kind, rows]) => ({
          kind,
          class: reasonClass(kind),
          rows: { first: rows.first, count: rows.count },
        })),
      },
      cleared: this.cleared,
      counts: this.counts,
    };
  }

  /**
   * Whether an empty value the database stores as something blocks the change, noting why: an
   * empty list is stored as `[]`, empty to the new type only where it keeps a list.
   */
  private emptyNotHeld(
    key: RowKey,
    verdict: ValueVerdict,
    stored: string | null
  ): boolean {
    if (verdict.reason !== "empty" || stored === null) return false;
    if (this.read.emptyListHeld && stored.trim() === "[]") return false;
    if (this.read.writtenAsNone?.includes(stored.trim()) === true) return false;
    this.note("needs-rewrite", key);
    return true;
  }

  /**
   * Whether a value the rules keep or change blocks the change all the same, noting why: one
   * another row in its language already reads as, which a unique field cannot hold twice; or one
   * whose stored form is not its reading, which no save rewrites yet (`needs-rewrite`).
   */
  private blocks(
    key: RowKey,
    outcome: ValueVerdict["outcome"],
    readsAs: string,
    stored: string | null
  ): boolean {
    this.options.onReading?.(key, readsAs);
    const repeated = this.repeatsOf?.(key, readsAs);
    if (repeated !== undefined) {
      for (const row of repeated) this.note("repeated", row);
      return true;
    }
    if (!this.read.value(stored, readsAs, outcome)) {
      this.note("needs-rewrite", key);
      return true;
    }
    return false;
  }

  private note(kind: ConversionReasonKind, key: RowKey): void {
    const seen = this.byReason.get(kind) ?? { count: 0, first: [] };
    seen.count += 1;
    if (seen.first.length < FIRST_KEYS) seen.first.push(key);
    this.byReason.set(kind, seen);
  }
}

/**
 * A unique field's values as the new type reads them, each distinct one with its language once. A
 * value no row in its language read as before gives undefined; one that repeats gives the rows to
 * name for it: the first row that held it, the first time it is repeated, and this one. Holds the
 * distinct values, which counting a unique field's repeats needs, and nothing for any other field.
 */
export function uniqueValues(): (
  key: RowKey,
  readsAs: string
) => RowKey[] | undefined {
  const holder = new Map<string, RowKey | null>();
  return (key, readsAs) => {
    const held = JSON.stringify([languageOf(key), readsAs]);
    if (!holder.has(held)) {
      holder.set(held, key);
      return undefined;
    }
    const first = holder.get(held) ?? null;
    holder.set(held, null);
    return first === null ? [key] : [first, key];
  };
}

/** The language a row's value is in: a translation's locale, or none for the entity's own row. */
function languageOf(key: RowKey): string {
  return "locale" in key ? key.locale : "";
}

/**
 * A verdict the rules keep or change, asked of the new field's own validation too: a value it
 * refuses is lost, as the write path would refuse it. Lost, blocked and empty values are left as
 * the rules judged them.
 */
async function withFieldRule(
  verdict: ValueVerdict,
  accepts: ((readsAs: string) => Promise<boolean>) | undefined
): Promise<ValueVerdict> {
  if (accepts === undefined || verdict.readsAs === undefined) return verdict;
  return (await accepts(verdict.readsAs))
    ? verdict
    : { outcome: "lost", reason: "field-refuses" };
}

/**
 * Whether the new field's own validation accepts a value as the new type reads it, by the entry
 * validator every write runs (`validateEntryData`): its length, pattern, range and options, and a
 * plugin type's own `validate`. The value is validated as the field's only value, as an update
 * that sets it.
 */
export function fieldAccepts(
  to: FieldTypeOnDialect,
  field: FieldDefinition
): (readsAs: string) => Promise<boolean> {
  return async readsAs => {
    const issues = await validateEntryData(
      { [field.name]: valueOf(to, readsAs) },
      [field],
      { mode: "update" }
    );
    return issues.length === 0;
  };
}

/** A value as the new field holds it, from its writing as the new type reads it (`readsAs`). */
function valueOf(to: FieldTypeOnDialect, readsAs: string): unknown {
  switch (to.family) {
    case "number":
      return Number(readsAs);
    case "checkbox":
      return readsAs === "true";
    case "json":
    case "list":
    case "richText":
      return JSON.parse(readsAs) as unknown;
    case "relationship":
      return to.relation?.kept === "one"
        ? readsAs
        : (JSON.parse(readsAs) as unknown);
    default:
      return readsAs;
  }
}

/**
 * A field's type change judged over every value `column` of `table` holds, read a page at a time
 * and keyed as the table keys its rows.
 */
export function judgeStoredTypeChange(
  args: {
    db: unknown;
    dialect: SupportedDialect;
    table: string;
    column: string;
    keyedBy: KeyedBy;
    from: FieldTypeOnDialect;
    to: FieldTypeOnDialect;
    /** The new field's own validation, asked of each kept or changed value (`fieldAccepts`). */
    accepts?: (readsAs: string) => Promise<boolean>;
  } & CollectOptions
): Promise<StoredTypeChangeJudgement> {
  return collectTypeChange(
    args.from,
    args.to,
    readStoredValues(args.db, args.dialect, {
      table: args.table,
      column: args.column,
      keyedBy: args.keyedBy,
      toJson: false,
    }),
    args.accepts,
    {
      ...(args.unique !== undefined ? { unique: args.unique } : {}),
      ...(args.onReading !== undefined ? { onReading: args.onReading } : {}),
    }
  );
}
