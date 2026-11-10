/**
 * A Schema Builder field change, as the admin applies it, read as one save
 * of the collection (`writeCollectionSave`): the new fields, the person's
 * rename choices, their answers to rows that do not fit, and the conversions
 * they confirmed.
 *
 * @module domains/schema/builder-save/schema-change-save
 */
import { NextlyError } from "../../../errors/nextly-error";
import type {
  UiSchemaEntity,
  UiSchemaManifest,
} from "../../../schemas/_zod/ui-schema";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import type { BrowserRenameResolution } from "../pipeline/prompt-dispatcher/browser";
import { PromptCancelledError } from "../pipeline/prompt-dispatcher/errors";
import { parseEventId, type Resolution } from "../pipeline/resolution/types";
import { toSnakeCase } from "../services/field-column-descriptor";

import type { CollectionSave } from "./collection-save";

/** A field's answer in the earlier per-field shape the admin still sends. */
export interface PerFieldResolution {
  action: "provide_default" | "mark_nullable" | "cancel" | "confirm_drop";
  value?: unknown;
}

/** What the admin sends with a field change, beyond the fields themselves. */
export interface SchemaChangeAnswers {
  renameResolutions?: readonly BrowserRenameResolution[];
  eventResolutions?: readonly Resolution[];
  resolutions?: Readonly<Record<string, PerFieldResolution>>;
  acknowledgedConversions?: readonly string[];
}

/** One answer, by field: fill, delete, or make the field optional. */
type Answer =
  | { field: string; kind: "fill"; value: unknown }
  | { field: string; kind: "delete_nonconforming" }
  | { field: string; kind: "make_optional" };

/**
 * The collection a field change saves: the definition's own entry as it
 * stands (or, where the definition has none, one read from the registry
 * row), with the new fields, each one the person made optional instead of
 * filling written so, and the save the writer takes. A cancelled answer
 * stops here, with nothing written.
 */
export function saveOfSchemaChange(args: {
  slug: string;
  /** The collection's table, which every answer's event must name. */
  table: string;
  /** The definition file as it stands. */
  definition: UiSchemaManifest;
  /** The collection's registry row, for a collection the definition lacks. */
  row: {
    labels?: { singular: string; plural: string };
    fields?: FieldDefinition[];
  };
  fields: readonly FieldDefinition[];
  localized: boolean;
  answers: SchemaChangeAnswers;
  junctions: NonNullable<CollectionSave["junctions"]>;
  keys: NonNullable<CollectionSave["keys"]>;
}): { save: CollectionSave; fields: FieldDefinition[] } {
  const answers = answersOf(args.answers, args.fields, args.table);
  const optional = new Set(
    answers.filter(a => a.kind === "make_optional").map(a => a.field)
  );
  const fields = args.fields.map(field =>
    optional.has(field.name) ? { ...field, required: false } : field
  );
  const previous =
    args.definition.collections.find(c => c.slug === args.slug) ??
    ({
      slug: args.slug,
      labels: args.row.labels ?? { singular: args.slug, plural: args.slug },
      fields: args.row.fields ?? [],
    } satisfies UiSchemaEntity);
  const entity: UiSchemaEntity = {
    ...previous,
    localized: args.localized,
    fields,
  };
  const resolutions = answers.flatMap(
    (a): NonNullable<CollectionSave["resolutions"]>[number][] =>
      a.kind === "fill"
        ? [{ column: a.field, kind: "fill", value: a.value }]
        : a.kind === "delete_nonconforming"
          ? [{ column: a.field, kind: "delete_nonconforming" }]
          : []
  );
  return {
    fields,
    save: {
      slug: args.slug,
      previous,
      entity,
      change: "update",
      renamedFields: (args.answers.renameResolutions ?? [])
        .filter(r => r.choice === "rename")
        .map(r => ({ from: r.fromColumn, to: r.toColumn })),
      ...(resolutions.length === 0 ? {} : { resolutions }),
      ...(args.answers.acknowledgedConversions === undefined
        ? {}
        : { acknowledgedConversions: args.answers.acknowledgedConversions }),
      junctions: args.junctions,
      keys: args.keys,
    },
  };
}

/**
 * The answers in both shapes the admin sends, by field: the typed ones keyed
 * by event (`kind:table.column`) and the earlier per-field ones. A drop's
 * confirmation needs nothing in the file; a cancel stops the save.
 */
function answersOf(
  answers: SchemaChangeAnswers,
  fields: readonly FieldDefinition[],
  table: string
): Answer[] {
  const out: Answer[] = [];
  for (const resolution of answers.eventResolutions ?? []) {
    if (resolution.kind === "abort") throw new PromptCancelledError();
    const field = fieldOfEvent(resolution.eventId, fields, table);
    if (resolution.kind === "provide_default") {
      out.push({ field, kind: "fill", value: resolution.value });
    } else if (resolution.kind === "delete_nonconforming") {
      out.push({ field, kind: "delete_nonconforming" });
    } else if (resolution.kind === "make_optional") {
      out.push({ field, kind: "make_optional" });
    }
  }
  for (const [field, resolution] of Object.entries(answers.resolutions ?? {})) {
    if (resolution.action === "cancel") throw new PromptCancelledError();
    if (resolution.action === "provide_default") {
      out.push({ field, kind: "fill", value: resolution.value });
    } else if (resolution.action === "mark_nullable") {
      out.push({ field, kind: "make_optional" });
    }
  }
  return out;
}

/**
 * The field an event names: the one of `fields` whose column (its name in
 * snake case, as the Builder names a column) is the event's, so a camelCase
 * field is found by its own name. An event that is malformed, names another
 * table, or a column no field has is refused: an answer only settles a field
 * of the collection being saved, and whether this save asks it at all is
 * judged where its rows are counted (`settledRows`).
 */
function fieldOfEvent(
  eventId: string,
  fields: readonly FieldDefinition[],
  table: string
): string {
  let event: ReturnType<typeof parseEventId> | undefined;
  try {
    event = parseEventId(eventId);
  } catch {
    event = undefined;
  }
  const field =
    event?.table === table
      ? fields.find(f => toSnakeCase(f.name) === event.column)
      : undefined;
  if (field === undefined) {
    throw NextlyError.validation({
      errors: [
        {
          path: "eventResolutions",
          code: "RESOLUTION_EVENT_UNKNOWN",
          message: `${eventId} is not a change to a field of this collection.`,
        },
      ],
    });
  }
  return field.name;
}
