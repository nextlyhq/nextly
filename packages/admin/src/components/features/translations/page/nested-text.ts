/**
 * The text inside a document's repeaters, groups and components, as its
 * translation page writes it: each text of each row the language is given, and
 * a save that changes that text and nothing around it.
 *
 * Such a container has one structure in every language: the rows, their order
 * and their shared values. So the rows are read off the value being written,
 * never added, removed or moved here, and a row is the same row in another
 * language by its id, wherever it stands there.
 *
 * Which fields are text, and which row is which, are read by the two answers
 * the editor and storage read them by (`container-text`).
 *
 * @module components/features/translations/page/nested-text
 */

import type { FieldConfig } from "nextly/config";
import {
  isFieldGroupFieldType,
  readFieldGroupType,
} from "nextly/field-group-type";

import {
  holdsTranslatedText,
  sourceValueAt,
} from "@admin/components/features/entries/container-text";
import { fieldAdminGates } from "@admin/components/features/entries/fields/field-admin-gates";
import { isFieldTranslated } from "@admin/components/features/entries/translation-meta";
import { sameFieldValue } from "@admin/components/features/versions/same-form-value";
import { fieldLabel } from "@admin/lib/field-label";
import { getDefaultValues } from "@admin/lib/form/default-values";

import type { TranslationField } from "./translation-fields";
import type { ProvenanceClaim } from "./translation-save";

/** One text inside a container: the form's path to it, and what it is called. */
export interface NestedText {
  /** Its path in the form, such as `slides.1.caption`. */
  path: string;
  /** The path of the row or group it sits in, which its condition reads beside. */
  basePath: string;
  field: FieldConfig;
  /** What it is called where it stands alone: "Slide 2, Caption". */
  label: string;
}

/**
 * One level of a container: the container itself, a row, or a group that only
 * lays fields out, with the texts in it and the levels inside.
 */
export interface TextLevel {
  /** Names the level among its siblings. */
  key: string;
  /** What it is called; absent for a group that only lays fields out. */
  label: string | undefined;
  /** The container the level is of, whose own gates apply; absent for a row. */
  field: FieldConfig | undefined;
  /** The path its condition reads beside. */
  basePath: string;
  texts: NestedText[];
  levels: TextLevel[];
}

/** What is read of a container or a component beyond its declaration's union. */
interface ContainerShape {
  type: string;
  name?: string;
  label?: unknown;
  labels?: { singular?: unknown };
  localized?: boolean;
  repeatable?: boolean;
  fields?: FieldConfig[];
  componentFields?: FieldConfig[];
  componentSchemas?: Record<string, { fields?: FieldConfig[] } | undefined>;
}

const shapeOf = (field: FieldConfig): ContainerShape =>
  field as unknown as ContainerShape;

type Row = Readonly<Record<string, unknown>>;

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a field holds translated text: its own, or inside it. Asked as a
 * group holding it alone, which is how a field inside a container is asked.
 */
export function holdsText(field: FieldConfig): boolean {
  return holdsTranslatedText({ type: "group", fields: [field] }, true);
}

function labelOf(field: FieldConfig): string {
  const { name, label } = shapeOf(field);
  return fieldLabel({
    name,
    label: typeof label === "string" ? label : undefined,
  });
}

/** What one row of a list is called: "Slide 2". */
function rowLabel(field: FieldConfig, index: number): string {
  const singular = shapeOf(field).labels?.singular;
  const one =
    typeof singular === "string" && singular.trim() !== ""
      ? singular
      : labelOf(field);
  return `${one} ${index + 1}`;
}

/** The fields of the component an instance is. */
function instanceFields(field: ContainerShape, instance: Row): FieldConfig[] {
  if (field.componentFields) return field.componentFields;
  const type = readFieldGroupType(instance);
  return (
    (type === undefined ? undefined : field.componentSchemas?.[type])?.fields ??
    []
  );
}

/** The fields one row, instance or group value holds. */
function fieldsIn(field: FieldConfig, value: Row): FieldConfig[] {
  const shape = shapeOf(field);
  return isFieldGroupFieldType(shape.type)
    ? instanceFields(shape, value)
    : (shape.fields ?? []);
}

/** What every level is read with. */
interface Reading {
  /** The container's value, under its name, which rows are known by. */
  root: Row;
  /** The names of what is around, outermost first, for a text's own label. */
  around: readonly string[];
  /** Whether the value is a row of a list, which its `id` tells apart. */
  inList: boolean;
}

/** The texts and levels of one row, instance or group. */
function contentsOf(
  fields: readonly FieldConfig[],
  value: Row,
  basePath: string,
  reading: Reading
): Pick<TextLevel, "texts" | "levels"> {
  const texts: NestedText[] = [];
  const levels: TextLevel[] = [];
  fields.forEach((field, index) => {
    const shape = shapeOf(field);
    if (fieldAdminGates(field).hidden || !holdsText(field)) return;
    // What tells a row from the others is the same in every language, though
    // its repeater declares it as a field of its own.
    if (reading.inList && shape.name === "id") return;
    if (!shape.name) {
      // A group with no name lays its fields out at this level, under its own
      // condition.
      const inside = contentsOf(shape.fields ?? [], value, basePath, reading);
      if (isEmptyLevel(inside)) return;
      levels.push({
        key: `layout-${index}`,
        label: undefined,
        field,
        basePath,
        ...inside,
      });
      return;
    }
    // A value the reader may not see is not in the row at all.
    if (!Object.hasOwn(value, shape.name)) return;
    const path = `${basePath}.${shape.name}`;
    if (isContainer(shape)) {
      const level = levelOf(field, value[shape.name], path, basePath, reading);
      if (level !== undefined) levels.push(level);
      return;
    }
    texts.push({
      path,
      basePath,
      field,
      label: [...reading.around, labelOf(field)].join(", "),
    });
  });
  return { texts, levels };
}

function isContainer({ type }: ContainerShape): boolean {
  return type === "repeater" || type === "group" || isFieldGroupFieldType(type);
}

function isEmptyLevel({
  texts,
  levels,
}: Pick<TextLevel, "texts" | "levels">): boolean {
  return texts.length === 0 && levels.length === 0;
}

/** One container at `path`, or undefined where it holds no text to write. */
function levelOf(
  field: FieldConfig,
  value: unknown,
  path: string,
  basePath: string,
  reading: Reading
): TextLevel | undefined {
  const label = labelOf(field);
  const level = (inside: Pick<TextLevel, "texts" | "levels">) =>
    isEmptyLevel(inside)
      ? undefined
      : { key: path, label, field, basePath, ...inside };
  if (Array.isArray(value)) {
    return level({ texts: [], levels: rowsOf(field, value, path, reading) });
  }
  if (!isRow(value)) return undefined;
  return level(
    contentsOf(fieldsIn(field, value), value, path, {
      ...reading,
      around: [...reading.around, label],
      inList: false,
    })
  );
}

/** The rows of a list that hold text to write. */
function rowsOf(
  field: FieldConfig,
  rows: readonly unknown[],
  path: string,
  reading: Reading
): TextLevel[] {
  return rows.flatMap((row, index) => {
    const rowPath = `${path}.${index}`;
    // A row no id tells from the others keeps its text shared by every
    // language, so it has none of this language's to write.
    const known =
      sourceValueAt(reading.root, reading.root, rowPath) !== undefined;
    if (!isRow(row) || !known) return [];
    const label = rowLabel(field, index);
    const inside = contentsOf(fieldsIn(field, row), row, rowPath, {
      ...reading,
      around: [...reading.around, label],
      inList: true,
    });
    if (isEmptyLevel(inside)) return [];
    return [
      {
        key: rowPath,
        label,
        field: undefined,
        basePath: rowPath,
        ...inside,
      },
    ];
  });
}

/**
 * A container's value as the form holds it: the one instance of a component
 * that holds one, which a read may answer as a list of one. Nothing stays
 * nothing, where the form would draw an empty group.
 */
export function heldValue(field: FieldConfig, value: unknown): unknown {
  const { name } = shapeOf(field);
  if (value === null || value === undefined || !name) return null;
  return getDefaultValues([field], { [name]: value })[name];
}

/** The text inside a container's `value`, or undefined where it holds none. */
export function textLevel(
  { field, name }: TranslationField,
  value: unknown
): TextLevel | undefined {
  return levelOf(field, value, name, "", {
    root: { [name]: value },
    around: [],
    inList: false,
  });
}

/** Every text of a level, in the order it is drawn. */
export function textsIn(level: TextLevel | undefined): NestedText[] {
  if (level === undefined) return [];
  return [...level.texts, ...level.levels.flatMap(textsIn)];
}

/** `value` with `written` at `path`, every object on the way copied. */
function withValueAt(
  value: unknown,
  [step, ...rest]: readonly string[],
  written: unknown
): unknown {
  if (step === undefined) return written;
  if (Array.isArray(value)) {
    return value.map((row: unknown, index) =>
      String(index) === step ? withValueAt(row, rest, written) : row
    );
  }
  return isRow(value)
    ? { ...value, [step]: withValueAt(value[step], rest, written) }
    : value;
}

/** A container's value with its text written. */
export interface WrittenContainer {
  value: unknown;
  /** The texts that differ from `base`. */
  changed: NestedText[];
  /** Whether any of them holds something. */
  wrote: boolean;
}

/**
 * `base`, a container's value, with each text the form `shown` holds differently
 * written into it, the row known by its id: the rows, their order and their
 * shared values are `base`'s. An emptied text is written as no value, as a
 * field of its own is.
 */
export function writtenContainer(
  container: TranslationField,
  base: unknown,
  shown: Readonly<Record<string, unknown>>
): WrittenContainer {
  const { name } = container;
  const root = { [name]: base };
  let value = base;
  let wrote = false;
  const changed = textsIn(textLevel(container, base)).filter(text => {
    const now = sourceValueAt(shown, root, text.path);
    const was = sourceValueAt(root, root, text.path);
    // Absent is a row the form does not hold, not one it emptied.
    if (now === undefined) return false;
    const type: string = text.field.type;
    if (sameFieldValue(type, now, was)) return false;
    const stored = now === "" ? null : now;
    value = withValueAt(value, text.path.split(".").slice(1), stored);
    wrote ||= isFieldTranslated(stored);
    return true;
  });
  return { value, changed, wrote };
}

/** What saving the containers sends. */
export interface NestedPayload {
  values: Record<string, unknown>;
  claims: Record<string, ProvenanceClaim>;
}

/**
 * The containers whose text changed, each whole, since a container is written
 * whole: `startedFrom`'s with its changed text. One is claimed as original only
 * where none of its text had a source to be made from, since the claim speaks
 * for the whole of it.
 */
export function nestedPayload(
  containers: readonly TranslationField[],
  shown: Readonly<Record<string, unknown>>,
  startedFrom: Readonly<Record<string, unknown>>,
  sourceOf: (path: string) => string | undefined
): NestedPayload {
  const payload: NestedPayload = { values: {}, claims: {} };
  for (const container of containers) {
    const base = startedFrom[container.name];
    const written = writtenContainer(container, base, shown);
    if (written.changed.length === 0) continue;
    payload.values[container.name] = written.value;
    const hasSource = textsIn(textLevel(container, base)).some(
      text => sourceOf(text.path) !== undefined
    );
    if (written.wrote && !hasSource) {
      payload.claims[container.name] = { origin: "original" };
    }
  }
  return payload;
}

/**
 * `values`, what a refused save sent, with the text of each container `shown`
 * holds written into that container as it stands now (`current`), so a row
 * someone added or moved since stays. A container gone since is left out: there
 * is nothing left to write its text on.
 */
export function ontoCurrent(
  containers: readonly TranslationField[],
  values: Readonly<Record<string, unknown>>,
  shown: Readonly<Record<string, unknown>>,
  current: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...values };
  for (const container of containers) {
    const { name, field } = container;
    if (!Object.hasOwn(out, name)) continue;
    const held = heldValue(field, current[name]);
    if (held === null) delete out[name];
    else out[name] = writtenContainer(container, held, shown).value;
  }
  return out;
}

/** One text's value in each language the reader may read the container in. */
export function textPerLanguage(
  container: TranslationField,
  path: string,
  perLanguage: Readonly<Record<string, unknown>>,
  shown: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const { name, field } = container;
  return Object.fromEntries(
    Object.entries(perLanguage).map(([code, value]) => [
      code,
      sourceValueAt({ [name]: heldValue(field, value) }, shown, path),
    ])
  );
}
