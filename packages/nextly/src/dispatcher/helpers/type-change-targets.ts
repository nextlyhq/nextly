/**
 * The types a saved field may be changed to in the Schema Builder, as its type picker lists them:
 * each candidate blocked whatever the field's values hold, and why, or marked by what the change can
 * do to them (keeps every value, converts some, may lose some). Read from the conversion rules
 * themselves (`pairBlocked`, `pairOutcome`), never restated here, so the picker and the save that
 * judges the stored values answer from one set of rules.
 *
 * @module dispatcher/helpers/type-change-targets
 */
import { z } from "zod";

import { respondList } from "../../api/response-shapes";
import { nextlyValidationFromZod } from "../../api/zod-to-nextly-error";
import { FIELD_TYPE_CATALOG } from "../../collections/fields/catalog";
import type {
  ColumnOrigin,
  SupportedDialect,
} from "../../domains/schema/services/field-column-descriptor";
import {
  fieldTypeInJson,
  fieldTypeOnDialect,
} from "../../domains/schema/value-conversion/type-change/field-type";
import {
  pairBlocked,
  type PairBlockReason,
} from "../../domains/schema/value-conversion/type-change/judge";
import {
  pairOutcome,
  type PairOutcome,
} from "../../domains/schema/value-conversion/type-change/pair-outcome";
import { NextlyError } from "../../errors/nextly-error";
import type { FieldDefinition } from "../../schemas/dynamic-collections";

import { getAdapterFromDI } from "./di";
import { toPaginationMeta } from "./service-envelope";

/** One type a saved field could be changed to, as the picker shows it. */
export interface TypeChangeTarget {
  type: string;
  /** Why the change is refused whatever the field's values hold; null where it is not. */
  blocked: PairBlockReason | null;
  /** What the change can do to the field's values; null where it is blocked. */
  outcome: PairOutcome | null;
}

/**
 * Each of `candidates` other than the field's own type, judged as a change from `field`, a field
 * as its entity stores it, on the database this runs on. `builtBy` and `componentRow` say where its
 * values are kept, as the save that would make the change reads them; `inJson`, that they are held
 * inside a named group's or a repeater's JSON value, as the save judges such a field.
 */
export function typeChangeTargets(args: {
  field: FieldDefinition;
  candidates: readonly string[];
  dialect: SupportedDialect;
  builtBy: ColumnOrigin;
  componentRow?: boolean;
  inJson?: boolean;
}): TypeChangeTarget[] {
  const at = args.componentRow === true ? { componentRow: true } : {};
  const typeOf = (field: FieldDefinition) =>
    args.inJson === true
      ? fieldTypeInJson(field, args.dialect, args.builtBy)
      : fieldTypeOnDialect(field, args.dialect, args.builtBy, at);
  const from = typeOf(args.field);
  return args.candidates
    .filter(type => type !== args.field.type)
    .map(type => {
      const to = typeOf({ ...args.field, type } as FieldDefinition);
      const blocked = pairBlocked(from, to);
      return {
        type,
        blocked,
        outcome: blocked === null ? pairOutcome(from, to) : null,
      };
    });
}

/**
 * What the type picker asks: the saved field, by its path of names through its groups and repeaters,
 * and the types it offers; the field types the catalog lists where it names none.
 */
const TargetsRequest = z.object({
  field: z.array(z.string().min(1)).min(1).max(20),
  candidates: z.array(z.string().min(1)).max(100).optional(),
});

/**
 * The fields on one level as a value is read there: a group with no name holds its fields on the
 * level it stands on, so they are found there, by their own names.
 */
function onLevel(fields: readonly FieldDefinition[]): FieldDefinition[] {
  return fields.flatMap(field =>
    field.type === "group" && !field.name
      ? onLevel(field.fields ?? [])
      : [field]
  );
}

/**
 * The field at `path` among `fields`, by name through groups and repeaters, if there is one, and
 * whether its value is held inside a container's JSON value: below a named group or a repeater.
 */
function fieldAt(
  fields: readonly FieldDefinition[],
  path: readonly string[],
  inJson = false
): { field: FieldDefinition; inJson: boolean } | undefined {
  const [name, ...rest] = path;
  const found = onLevel(fields).find(field => field.name === name);
  if (found === undefined) return undefined;
  if (rest.length === 0) return { field: found, inJson };
  return fieldAt(found.fields ?? [], rest, true);
}

/**
 * The type picker's answer for a saved field of an entity whose stored fields are `fields`, as a
 * list (`{ items, meta }`). Shared by the collection, Single and field-group routes, so the three
 * answer alike.
 */
export function respondTypeChangeTargets(args: {
  fields: readonly FieldDefinition[];
  body: unknown;
  builtBy: ColumnOrigin;
  componentRow?: boolean;
}): Response {
  let request: z.infer<typeof TargetsRequest>;
  try {
    request = TargetsRequest.parse(args.body ?? {});
  } catch (error) {
    if (error instanceof z.ZodError) throw nextlyValidationFromZod(error);
    throw error;
  }
  const found = fieldAt(args.fields, request.field);
  if (found === undefined) {
    throw NextlyError.notFound({
      message: `No saved field ${request.field.join(".")}.`,
    });
  }
  const adapter = getAdapterFromDI();
  if (adapter === undefined) {
    throw NextlyError.internal({
      logContext: { reason: "adapter-not-initialized" },
    });
  }
  const items = typeChangeTargets({
    field: found.field,
    inJson: found.inJson,
    candidates:
      request.candidates ?? FIELD_TYPE_CATALOG.map(entry => entry.type),
    dialect: adapter.getCapabilities().dialect,
    builtBy: args.builtBy,
    ...(args.componentRow === true ? { componentRow: true } : {}),
  });
  return respondList(
    items,
    toPaginationMeta({
      total: items.length,
      page: 1,
      limit: Math.max(items.length, 1),
      totalPages: 1,
    })
  );
}
