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
import {
  fieldsStoredOnRow,
  toSnakeCase,
} from "../services/field-column-descriptor";

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

/** A field as an answer is matched to it: by its name, which a layout-only field lacks. */
type NamedField = { readonly name?: string };

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
  /**
   * The kind of entity changed: a collection when absent. A Single's or a
   * field group's change is read from, and written to, its own list.
   */
  kind?: "collection" | "single" | "fieldGroup";
  slug: string;
  /** The collection's table, which every answer's event must name. */
  table: string;
  /** The definition file as it stands. */
  definition: UiSchemaManifest;
  /**
   * The entity as the registry stores it, every setting included, for one the
   * definition lacks; the `row` below is read only where this is absent.
   */
  stored?: UiSchemaEntity;
  /** The collection's registry row, for a collection the definition lacks. */
  row: {
    labels?: { singular: string; plural: string };
    fields?: FieldDefinition[];
  };
  fields: readonly FieldDefinition[];
  localized: boolean;
  answers: SchemaChangeAnswers;
  /** The entity's junction statements, where it has many-to-many fields. */
  junctions?: NonNullable<CollectionSave["junctions"]>;
  /** The entity's relationship keys, before the change and after it. */
  keys?: NonNullable<CollectionSave["keys"]>;
}): { save: CollectionSave; fields: FieldDefinition[] } {
  const listed =
    args.kind === "single"
      ? args.definition.singles
      : args.kind === "fieldGroup"
        ? args.definition.components
        : args.definition.collections;
  const previous =
    listed.find(c => c.slug === args.slug) ??
    args.stored ??
    ({
      slug: args.slug,
      labels: args.row.labels ?? { singular: args.slug, plural: args.slug },
      fields: args.row.fields ?? [],
    } satisfies UiSchemaEntity);
  // Answers name columns of the row, a field inside a group with no name included: it is a
  // column there (`fieldsStoredOnRow`), and its change is asked about like one beside the group.
  const answers = answersOf(
    args.answers,
    { now: fieldsStoredOnRow(args.fields) },
    args.table
  );
  const optional = new Set(
    answers.filter(a => a.kind === "make_optional").map(a => a.field)
  );
  const fields = withOptional(args.fields, optional);
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
      ...(args.kind === undefined ? {} : { kind: args.kind }),
      slug: args.slug,
      previous,
      entity,
      change: "update",
      renamedFields: renamedFieldsOf(args.answers.renameResolutions ?? []),
      ...(resolutions.length === 0 ? {} : { resolutions }),
      ...(args.answers.acknowledgedConversions === undefined
        ? {}
        : { acknowledgedConversions: args.answers.acknowledgedConversions }),
      ...(args.junctions === undefined ? {} : { junctions: args.junctions }),
      ...(args.keys === undefined ? {} : { keys: args.keys }),
    },
  };
}

/**
 * `fields` with each field named in `optional` made optional, wherever it is stored on the row: at
 * the top level, or inside a group with no name, whose fields are columns of the row too.
 */
function withOptional(
  fields: readonly FieldDefinition[],
  optional: ReadonlySet<string>
): FieldDefinition[] {
  return fields.map(field => {
    if (typeof field.name !== "string" || field.name.length === 0) {
      const inside = (field as { fields?: unknown }).fields;
      return Array.isArray(inside)
        ? {
            ...field,
            fields: withOptional(inside as FieldDefinition[], optional),
          }
        : field;
    }
    return optional.has(field.name) ? { ...field, required: false } : field;
  });
}

/**
 * The renames a save's rename answers accept, as the writer takes them: the
 * schema dialog's and an update's own (`updateCollection`) through this one
 * reading, so the two write a rename the same way.
 */
export function renamedFieldsOf(
  resolutions: readonly BrowserRenameResolution[]
): NonNullable<CollectionSave["renamedFields"]> {
  return resolutions
    .filter(r => r.choice === "rename")
    .map(r => ({ from: r.fromColumn, to: r.toColumn }));
}

/**
 * The answers in both shapes the admin sends, by field: the typed ones keyed
 * by event (`kind:table.column`) and the earlier per-field ones. A drop's
 * confirmation needs nothing in the file; a cancel stops the save.
 */
function answersOf(
  answers: SchemaChangeAnswers,
  fields: AnsweredFields,
  table: string
): Answer[] {
  const out: Answer[] = [];
  for (const resolution of answers.eventResolutions ?? []) {
    const answer = answerOfEvent(resolution, fields, table);
    if (answer !== undefined) out.push(answer);
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

/** The fields an answer is matched against, as the save changes them. */
interface AnsweredFields {
  /** The fields this save keeps or adds, which a fill or a change settles. */
  now: readonly NamedField[];
}

/** One typed answer, by field; undefined for one the file needs nothing for. A cancel stops. */
function answerOfEvent(
  resolution: Resolution,
  fields: AnsweredFields,
  table: string
): Answer | undefined {
  if (resolution.kind === "abort") throw new PromptCancelledError();
  // A drop's confirmation needs nothing in the file, so it must only name a column of this table.
  // The column may be one no field declares: a table made before its saves wrote migrations can
  // hold one, and dropping it is a conversion this save's adoption makes, which the conversion
  // check refuses until the person confirms it (`acknowledgedConversions`).
  if (resolution.kind === "confirm_drop") {
    eventOnTable(resolution.eventId, table);
    return undefined;
  }
  const field = fieldOfEvent(resolution.eventId, fields.now, table);
  if (resolution.kind === "provide_default") {
    return { field, kind: "fill", value: resolution.value };
  }
  return { field, kind: resolution.kind };
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
  fields: readonly NamedField[],
  table: string
): string {
  const event = eventOnTable(eventId, table);
  const field = fields.find(
    f => typeof f.name === "string" && toSnakeCase(f.name) === event.column
  );
  if (field?.name === undefined) throw unknownEvent(eventId);
  return field.name;
}

/** An event's parts, refused unless it is well formed and names `table`. */
function eventOnTable(
  eventId: string,
  table: string
): ReturnType<typeof parseEventId> {
  let event: ReturnType<typeof parseEventId> | undefined;
  try {
    event = parseEventId(eventId);
  } catch {
    event = undefined;
  }
  if (event?.table !== table) throw unknownEvent(eventId);
  return event;
}

/** The refusal of an answer to an event that is not a change to this entity. */
function unknownEvent(eventId: string): NextlyError {
  return NextlyError.validation({
    errors: [
      {
        path: "eventResolutions",
        code: "RESOLUTION_EVENT_UNKNOWN",
        message: `${eventId} is not a change to a field of this collection.`,
      },
    ],
  });
}
