/**
 * What the "Bindings to fix" surfaces say about one broken binding, worded
 * from the facts the report keeps: what changed, and what a visitor sees
 * instead. One wording for the page, the dashboard card and the editor's
 * notice, so the three never describe one binding two ways.
 *
 * @module admin/bindings-report/words
 */
import type { BindingsToFixRow } from "../../bindings-report/contract";

/** A field's type, as an author reads it. */
const TYPE_WORDS: Readonly<Record<string, string>> = {
  text: "text",
  textarea: "text",
  richText: "rich text",
  number: "a number",
  checkbox: "a yes/no value",
  date: "a date",
  select: "a choice",
  radio: "a choice",
  upload: "media",
  relationship: "a relation",
  json: "JSON",
  email: "an email address",
  repeater: "a list",
  group: "a group",
};

/** Where a binding reads from, as an author knows it. */
function sourceWords(row: BindingsToFixRow, documentLabel: string): string {
  switch (row.binding.source) {
    case "single":
      return `The ${row.sourceLabel ?? row.binding.sourceKey ?? ""} Single`;
    case "site":
      return "The site settings";
    case "item":
      return "Each item";
    default:
      return documentLabel;
  }
}

/** The path's last field, as the binding names it. */
function fieldOf(row: BindingsToFixRow): string {
  return row.binding.path.split(".").at(-1) ?? row.binding.path;
}

/**
 * What changed, in one line: the first problem that explains the others (a
 * missing prop before an invalid fallback, a missing field before anything
 * the field would have been judged on).
 *
 * `entryLabel` names the document's own collection, which an entry binding
 * reads from (for example "Posts").
 */
export function whatChanged(row: BindingsToFixRow, entryLabel: string): string {
  const codes = new Set(row.codes);
  const field = fieldOf(row);
  if (codes.has("binding-prop-missing")) {
    return row.blockLabel === ""
      ? `This page has no “${row.propLabel}” any more`
      : `The ${row.blockLabel} block has no “${row.propLabel}” any more`;
  }
  if (codes.has("binding-field-missing")) {
    return `${sourceWords(row, entryLabel)} has no field “${field}”`;
  }
  if (codes.has("binding-type-misfit")) {
    const type =
      row.reaches === undefined ? undefined : TYPE_WORDS[row.reaches.type];
    return type === undefined
      ? `“${field}” no longer fits ${row.propLabel}`
      : `“${field}” is now ${type}; ${row.propLabel} can’t show it`;
  }
  if (
    codes.has("binding-path-too-deep") ||
    codes.has("binding-path-to-many") ||
    codes.has("binding-path-unsupported")
  ) {
    return `The path “${row.binding.path}” can’t be followed any more`;
  }
  if (
    codes.has("binding-format-misfit") ||
    codes.has("binding-format-invalid") ||
    codes.has("binding-format-unsupported")
  ) {
    return `Its format no longer fits “${field}”`;
  }
  if (codes.has("binding-fallback-invalid")) {
    return `Its fallback isn’t a valid ${row.propLabel} any more`;
  }
  return "This binding no longer fits";
}

/** A value short enough to quote, or `undefined`. */
function quoted(value: unknown): string | undefined {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string" || value === "") return undefined;
  return value.length > 40 ? `“${value.slice(0, 39)}…”` : `“${value}”`;
}

/** What a visitor sees where the binding is, as "Visitors see …" ends. */
export function visitorsSee(row: BindingsToFixRow): string {
  switch (row.shows.kind) {
    case "fallback":
      return quoted(row.shows.value) ?? "its fallback";
    case "nothing":
      return "nothing: the binding fills no prop";
    default: {
      const own = quoted(row.shows.value);
      return own === undefined
        ? `the block’s own ${row.propLabel.toLowerCase()}`
        : `the block’s own ${row.propLabel.toLowerCase()}, ${own}`;
    }
  }
}

/** Where the binding is: "Heading · Text", or the page's metadata field. */
export function whereBound(row: BindingsToFixRow): string {
  return row.blockLabel === ""
    ? `Page metadata · ${row.propLabel}`
    : `${row.blockLabel} · ${row.propLabel}`;
}

/** What the binding reads, as "Posts › headline". */
export function boundTo(row: BindingsToFixRow, entryLabel: string): string {
  const source =
    row.binding.source === "single"
      ? (row.sourceLabel ?? row.binding.sourceKey ?? "Single")
      : row.binding.source === "site"
        ? "Site"
        : row.binding.source === "item"
          ? "Item"
          : entryLabel;
  return `${source} › ${row.binding.path.split(".").join(" › ")}`;
}
