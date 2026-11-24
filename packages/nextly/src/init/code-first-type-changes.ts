/**
 * A code-first reload's field type changes, judged entity by entity before the reload assembles
 * its apply, by the judge `db:sync` and the development push ask (`typeChangeJudge`): the column
 * rule and what the new field reads from each value. An entity whose change cannot go ahead
 * without someone answering for it is held back whole, as the reload holds back any change that
 * needs review, so its translations table's work waits with it and every other entity's change
 * still applies:
 * - a blocked change, which nothing gets past;
 * - a lossy change that the data-loss consent naming its column (`NEXTLY_ACCEPT_DATA_LOSS`) does
 *   not cover, since nobody is asked at a reload, which runs inside the development server;
 * - a pair with no conversion Nextly runs, which is confirmed at a terminal (`nextly db:sync`).
 * A safe change, a lossy one its consent covers and a widening go on into the apply, which judges
 * them again on the rows as they are then.
 *
 * The type changes that rule never sees, since they plan no statement (a field inside a group's or a
 * repeater's JSON, a field whose column keeps its type), are judged as a Schema Builder save judges
 * them (`configuredTypeChangeRefusals`), and an entity with a refused one is held with its refusals
 * in the Builder's words, beside the rule's own reasons.
 *
 * @module init/code-first-type-changes
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { resolveDataLossConsent } from "../domains/schema/migrate/data-loss-consent";
import {
  conversionRefusal,
  type JudgedConversion,
  lossyConsentRefusal,
} from "../domains/schema/pipeline/classifier/conversion-refusal";
import { typeChangeJudge } from "../domains/schema/pipeline/classifier/judge-type-change";
import { isWideningChange } from "../domains/schema/pipeline/classifier/type-widening";
import type {
  ChangeColumnTypeOp,
  NextlySchemaSnapshot,
  Operation,
  TableSpec,
} from "../domains/schema/pipeline/diff/types";
import type { DesiredSchema } from "../domains/schema/pipeline/types";
import { configuredTypeChangeRefusals } from "../domains/schema/pipeline/ui-type-changes";
import { consentForColumn } from "../domains/schema/repair-columns/consent";
import type { NextlyError } from "../errors/nextly-error";

/** One entity whose diff changes a column's type, with the table the reload would push for it. */
export interface TypeChangedEntity {
  kind: "collection" | "single" | "fieldGroup";
  slug: string;
  /** The table the reload's apply would push for the entity. */
  table: TableSpec;
  operations: readonly Operation[];
}

/** An entity held back, with why: one message per column whose change cannot go ahead. */
export interface HeldBackTypeChange {
  kind: TypeChangedEntity["kind"];
  slug: string;
  reasons: string[];
}

/** The step a reload's refusal names for trying the change again. */
const NEXT_STEP = "save the configuration again";

/** A column type change the reload hands the apply: every one but a reference list's reshaping. */
function isTypeChange(op: Operation): op is ChangeColumnTypeOp {
  return op.type === "change_column_type" && op.conversion !== "referenceList";
}

/** The messages of a validation refusal, one per entry. */
function messagesOf(error: NextlyError): string[] {
  const data = error.publicData as
    | { errors?: Array<{ message?: unknown }> }
    | undefined;
  return (data?.errors ?? []).flatMap(entry =>
    typeof entry.message === "string" ? [entry.message] : []
  );
}

/**
 * The entities of `entities` whose type changes the reload holds back, each with its reasons;
 * every other entity's changes go on into the apply.
 *
 * @param schema the reload's desired schema, each code-first entity carrying the fields its
 *   registry row records from before the reload (`recordedFields`), which the per-value judge reads
 * @param env where the data-loss consent is read: the reload's process environment
 */
export async function typeChangesHeldBack(args: {
  db: unknown;
  dialect: SupportedDialect;
  live: NextlySchemaSnapshot;
  schema: DesiredSchema;
  entities: readonly TypeChangedEntity[];
  env: Readonly<Record<string, string | undefined>>;
}): Promise<HeldBackTypeChange[]> {
  const consent = resolveDataLossConsent({
    env: args.env,
    honours: ["NEXTLY_ALLOW_CODE_FIRST_DROPS"],
  });
  // The type changes the rule below never sees, which plan no statement (a field inside a group's
  // or a repeater's JSON, a column that keeps its type), judged first as a Schema Builder save
  // judges them and held in its words, beside the rule's own reasons: only stricter.
  const held = new Map<string, HeldBackTypeChange>();
  const hold = (
    kind: HeldBackTypeChange["kind"],
    slug: string,
    reasons: readonly string[]
  ): void => {
    if (reasons.length === 0) return;
    const key = `${kind}:${slug}`;
    const entry = held.get(key) ?? { kind, slug, reasons: [] };
    entry.reasons.push(...reasons);
    held.set(key, entry);
  };
  for (const { kind, slug, refusals } of await configuredTypeChangeRefusals(
    args.schema,
    args.db,
    args.dialect
  )) {
    hold(
      kind,
      slug,
      refusals.map(refusal => refusal.message)
    );
  }
  for (const entity of args.entities) {
    const judge = typeChangeJudge({
      db: args.db,
      dialect: args.dialect,
      live: args.live,
      expected: { tables: [entity.table] },
      schema: args.schema,
    });
    const reasons: string[] = [];
    for (const op of entity.operations.filter(isTypeChange)) {
      const judged = await judge(op);
      // A column the judge cannot find is left to the apply, which offers it as before.
      if (judged === null) continue;
      reasons.push(
        ...reasonsToHold(op, judged.judgement, consent, args.dialect)
      );
    }
    hold(entity.kind, entity.slug, reasons);
  }
  return [...held.values()];
}

/** Why one judged type change is held back, or nothing where it goes on into the apply. */
function reasonsToHold(
  op: ChangeColumnTypeOp,
  judgement: JudgedConversion["judgement"],
  consent: ReturnType<typeof resolveDataLossConsent>,
  dialect: SupportedDialect
): string[] {
  const conversion: JudgedConversion = {
    tableName: op.tableName,
    columnName: op.columnName,
    fromType: op.fromType,
    toType: op.toType,
    judgement,
  };
  if (judgement.reasons.some(reason => reason.kind === "no-conversion")) {
    // A widening the rule has no conversion for is made without a word, as the apply makes it.
    if (isWideningChange(op.fromType, op.toType, dialect)) return [];
    return [
      `${op.tableName}.${op.columnName}: ${op.fromType} -> ${op.toType} is a change Nextly runs no conversion for, so it is confirmed at a terminal: run nextly db:sync.`,
    ];
  }
  if (judgement.class === "blocked") {
    return messagesOf(conversionRefusal([conversion], NEXT_STEP));
  }
  if (judgement.class === "lossy") {
    const column = consentForColumn(
      consent,
      op.tableName,
      op.columnName,
      "a type change"
    );
    if (column.covered) return [];
    return messagesOf(lossyConsentRefusal([{ conversion, consent: column }]));
  }
  return [];
}
