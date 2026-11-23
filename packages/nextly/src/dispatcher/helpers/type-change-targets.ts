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
import { fieldTypeOnDialect } from "../../domains/schema/value-conversion/type-change/field-type";
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
 * values are kept, as the save that would make the change reads them.
 */
export function typeChangeTargets(args: {
  field: FieldDefinition;
  candidates: readonly string[];
  dialect: SupportedDialect;
  builtBy: ColumnOrigin;
  componentRow?: boolean;
}): TypeChangeTarget[] {
  const at = args.componentRow === true ? { componentRow: true } : {};
  const from = fieldTypeOnDialect(args.field, args.dialect, args.builtBy, at);
  return args.candidates
    .filter(type => type !== args.field.type)
    .map(type => {
      const to = fieldTypeOnDialect(
        { ...args.field, type } as FieldDefinition,
        args.dialect,
        args.builtBy,
        at
      );
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

/** The field at `path` among `fields`, by name through groups and repeaters, if there is one. */
function fieldAt(
  fields: readonly FieldDefinition[],
  path: readonly string[]
): FieldDefinition | undefined {
  const [name, ...rest] = path;
  const found = fields.find(field => field.name === name);
  if (found === undefined || rest.length === 0) return found;
  return fieldAt(found.fields ?? [], rest);
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
  const field = fieldAt(args.fields, request.field);
  if (field === undefined) {
    throw NextlyError.notFound({
      message: `No saved field ${request.field.join(".")}.`,
    });
  }
  // A field inside a group or a repeater keeps its value in the container's JSON, which its own
  // column's rules do not describe: judged only once those values are read as the JSON holds them.
  if (request.field.length > 1) {
    throw NextlyError.validation({
      errors: [
        {
          path: `fields.${request.field.join(".")}`,
          code: "TYPE_CHANGE_NOT_JUDGED",
          message:
            "A field inside a group or repeating rows is not judged here yet.",
        },
      ],
    });
  }
  const adapter = getAdapterFromDI();
  if (adapter === undefined) {
    throw NextlyError.internal({
      logContext: { reason: "adapter-not-initialized" },
    });
  }
  const items = typeChangeTargets({
    field,
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
