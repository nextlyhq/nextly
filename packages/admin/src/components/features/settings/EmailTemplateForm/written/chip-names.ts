/**
 * What a chip is called on screen: the declared label of its variable and of
 * each field along its path, so `order.total` reads "Order › Total". A part
 * with no label shows its own name, so a chip always says what it holds.
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
  name: string;
  label?: string;
  fields?: readonly EmailTemplateVariableField[];
}

/** The friendly name of a variable path, such as `order.total`. */
export type ChipNamer = (variable: string) => string;

/** The word a chip shows for the current item of a list. */
const ITEM_WORD = "Item";

/** The declared variable or field at `path`, when there is one. */
function partAt(
  variables: readonly TemplateFormVariable[],
  path: string
): Part | undefined {
  const [head, ...rest] = path.split(".");
  const variable = variables.find(v => v.name === head);
  let part: Part | undefined = variable && {
    name: variable.name,
    label: variable.presentation?.label,
    fields: variable.presentation?.fields,
  };
  for (const name of rest) part = part?.fields?.find(f => f.name === name);
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
    const [head, ...rest] = path.split(".");
    const inItem = list !== undefined && head === "item";
    let part: Part | undefined = inItem
      ? { name: head, label: ITEM_WORD, fields: items?.fields }
      : partAt(variables, head);
    const words = [part?.label ?? head];
    for (const name of rest) {
      part = part?.fields?.find(f => f.name === name);
      words.push(part?.label ?? name);
    }
    return words.join(" › ");
  };
}

/** The paths a list's current item offers as chips: `item.<field>`. */
export function itemPaths(
  variables: readonly TemplateFormVariable[],
  list: string
): string[] {
  const fields = partAt(variables, list)?.fields ?? [];
  return fields.map(field => `item.${field.name}`);
}
