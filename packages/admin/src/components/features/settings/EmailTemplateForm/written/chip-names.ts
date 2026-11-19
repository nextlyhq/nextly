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
    const names = [part?.label ?? start.first];
    for (const name of start.rest) {
      part = part?.fields?.find(f => f.name === name);
      names.push(part?.label ?? name);
    }
    return names.join(" › ");
  };
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

/** The paths a list's current item offers as chips: `item.<field>`. */
export function itemPaths(
  variables: readonly TemplateFormVariable[],
  list: string
): string[] {
  return fieldPaths(partAt(variables, list)?.fields ?? [], "item");
}
