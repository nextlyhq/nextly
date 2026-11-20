/**
 * What a chip is called on screen: the declared label of its variable and of
 * each field along its path, so `order.total` reads "Order › Total". A part
 * with no label shows its own name, so a chip always says what it holds.
 *
 * A declaration's name may itself hold a dot (`order.lines`), so a path is
 * matched to the longest declared name it starts with before its fields.
 *
 * Inside a list, `item` is the list's current item, and its fields are the
 * fields the list's items declare.
 *
 * @module components/features/settings/EmailTemplateForm/written/chip-names
 */
import type { EmailTemplateVariableField } from "@admin/services/emailTemplateApi";

import type { TemplateFormVariable } from "../schema";

/** A variable or one of its fields: its name, label and own fields. */
interface Part {
  label?: string;
  fields?: readonly EmailTemplateVariableField[];
}

/** Where a path starts: its declared part, the words naming it, and the rest. */
interface Start {
  part: Part | undefined;
  /** The start's own words, shown when it has no label. */
  first: string;
  rest: string[];
}

/** The friendly name of a variable path, such as `order.total`. */
export type ChipNamer = (variable: string) => string;

/** The word a chip shows for the current item of a list. */
const ITEM_WORD = "Item";

/** The longest declared name `words` start with, or the first word alone. */
function startOf(
  variables: readonly TemplateFormVariable[],
  words: readonly string[]
): Start {
  for (let n = words.length; n > 0; n--) {
    const name = words.slice(0, n).join(".");
    const variable = variables.find(v => v.name === name);
    if (variable) {
      return {
        part: {
          label: variable.presentation?.label,
          fields: variable.presentation?.fields,
        },
        first: name,
        rest: words.slice(n),
      };
    }
  }
  return { part: undefined, first: words[0] ?? "", rest: words.slice(1) };
}

/** The declared variable or field at `path`, when there is one. */
function partAt(
  variables: readonly TemplateFormVariable[],
  path: string
): Part | undefined {
  const start = startOf(variables, path.split("."));
  let part = start.part;
  for (const name of start.rest)
    part = part?.fields?.find(f => f.name === name);
  return part;
}

/**
 * Names chips by their declared labels. `list` is the path of the list a
 * chip sits in, if any, whose items `item` stands for.
 */
export function chipNamer(
  variables: readonly TemplateFormVariable[],
  list?: string
): ChipNamer {
  const items = list === undefined ? undefined : partAt(variables, list);
  return path => {
    const words = path.split(".");
    const start: Start =
      list !== undefined && words[0] === "item"
        ? {
            part: { label: ITEM_WORD, fields: items?.fields },
            first: "item",
            rest: words.slice(1),
          }
        : startOf(variables, words);
    let part = start.part;
    const names = [shown(part?.label, start.first)];
    for (const name of start.rest) {
      part = part?.fields?.find(f => f.name === name);
      names.push(shown(part?.label, name));
    }
    return names.join(" › ");
  };
}

/** A part's label, or its own name when the label is absent or empty. */
function shown(label: string | undefined, name: string): string {
  return label ? label : name;
}

/**
 * The paths a list block can repeat over: each variable declared as a list
 * and each list field inside a declared object, then the other variables,
 * since one declared without a type may still hold a list. Inside a list
 * field nothing is offered, as a list block cannot hold another.
 */
export function listPaths(
  variables: readonly TemplateFormVariable[]
): string[] {
  const lists = (
    fields: readonly EmailTemplateVariableField[],
    prefix: string
  ): string[] =>
    fields.flatMap(field => {
      const path = `${prefix}.${field.name}`;
      if (field.type === "list") return [path];
      return field.fields ? lists(field.fields, path) : [];
    });
  const declared = variables.filter(variable => variable.name);
  const isList = (variable: TemplateFormVariable) =>
    variable.presentation?.type === "list";
  return [
    ...declared.flatMap(variable =>
      isList(variable)
        ? [variable.name]
        : lists(variable.presentation?.fields ?? [], variable.name)
    ),
    ...declared.filter(v => !isList(v)).map(v => v.name),
  ];
}

/**
 * The full paths of `fields` under `prefix`, through nested objects. A nested
 * list is left out: a list block cannot hold another, so nothing inside the
 * item could repeat over it.
 */
function fieldPaths(
  fields: readonly EmailTemplateVariableField[],
  prefix: string
): string[] {
  return fields.flatMap(field => {
    if (field.type === "list") return [];
    const path = `${prefix}.${field.name}`;
    return field.fields && field.fields.length > 0
      ? fieldPaths(field.fields, path)
      : [path];
  });
}

/**
 * Every path a value can be read from here, for a link's address or a
 * block's condition: inside a list the item and every field inside it first,
 * then each declared variable and every field inside it. Containers are
 * offered too, as a condition can ask whether one has a value. A list field
 * is offered itself (whether it has items), not what its items hold, which
 * only a list block repeating over it can reach.
 */
export function variablePaths(
  variables: readonly TemplateFormVariable[],
  list?: string
): string[] {
  const inside = (
    fields: readonly EmailTemplateVariableField[],
    prefix: string
  ): string[] =>
    fields.flatMap(field => {
      const path = `${prefix}.${field.name}`;
      if (field.type === "list" || !field.fields) return [path];
      return [path, ...inside(field.fields, path)];
    });
  const item =
    list === undefined
      ? []
      : ["item", ...inside(partAt(variables, list)?.fields ?? [], "item")];
  return [
    ...item,
    ...variables
      .filter(variable => variable.name)
      .flatMap(variable => [
        variable.name,
        ...inside(variable.presentation?.fields ?? [], variable.name),
      ]),
  ];
}

/**
 * The paths a list's current item offers as chips: `item.<field>`, or `item`
 * itself for a list of plain values, which has no fields to offer.
 */
export function itemPaths(
  variables: readonly TemplateFormVariable[],
  list: string
): string[] {
  const fields = partAt(variables, list)?.fields ?? [];
  return fields.length > 0 ? fieldPaths(fields, "item") : ["item"];
}
