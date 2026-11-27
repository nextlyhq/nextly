/**
 * How a result becomes an answer: a short Markdown answer for people and
 * models, the same data as JSON in a fenced block labeled as data, and the
 * data itself as structured content.
 *
 * ## What the Markdown shows
 *
 * The answer names things the way a person reads them: a title or a name
 * beside every ID, and a link into the admin for anything that has one. An
 * operation states where a thing lives in the admin as `adminPath` (a path on
 * the site, such as `/admin/collections/posts/12`); the adapter only joins it
 * to the site's address, and refuses to make a link from anything that is not
 * a path on the site. Text that spans lines (rich text arrives as Markdown) is
 * quoted as a block, so it reads as content and never as part of the answer's
 * own words.
 *
 * ## Concise and detailed
 *
 * The concise answer keeps the fields that identify each thing (its ID, name,
 * title, status, link) and every field the output schema requires, so it
 * still checks against the full schema; the detailed answer keeps every
 * field. The concise cut is checked against the operation's own output schema
 * before it is used, and the full result is answered whenever the cut would
 * not pass.
 *
 * @module answers
 * @experimental
 */
import { propertiesOf, type AnswerFormat } from "./schemas";

/** The most characters an answer's text may hold. */
export const MAX_ANSWER_CHARACTERS = 50_000;

/** The fields the concise answer always keeps, beside the required ones. */
export const IDENTIFYING_KEYS: ReadonlySet<string> = new Set([
  "id",
  "title",
  "name",
  "label",
  "slug",
  "filename",
  "status",
  "collection",
  "single",
  "adminPath",
  "items",
]);

/** The fields an item's name is read from, in order of preference. */
const NAME_KEYS = ["title", "name", "label", "filename", "slug"] as const;

type JsonSchema = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredOf(schema: JsonSchema): ReadonlySet<string> {
  const required = schema.required;
  return new Set(
    Array.isArray(required)
      ? required.filter((key): key is string => typeof key === "string")
      : []
  );
}

/**
 * The concise cut of `value`, read against its JSON Schema: an object keeps
 * its required and identifying fields, cut in turn; an array cuts each item;
 * anything the schema does not describe as an object or array is kept whole.
 */
export function conciseCut(value: unknown, schema: JsonSchema): unknown {
  if (Array.isArray(value)) {
    const items = schema.items;
    return isRecord(items)
      ? value.map(entry => conciseCut(entry, items))
      : value;
  }
  if (!isRecord(value)) return value;
  const properties = propertiesOf(schema);
  if (!properties) return value;
  const required = requiredOf(schema);
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!required.has(key) && !IDENTIFYING_KEYS.has(key)) continue;
    out[key] = conciseCut(entry, properties[key] ?? {});
  }
  return out;
}

/** What the Markdown answer needs besides the data. */
export interface AnswerContext {
  /** The tool's title: the answer's heading. */
  readonly title: string;
  readonly format: AnswerFormat;
  /** The site's address, such as `https://example.com`; links need it. */
  readonly adminOrigin?: string;
  /** For a call made under an old name: the current one, and when the old one may go. */
  readonly renamed?: {
    readonly from: string;
    readonly to: string;
    readonly removableFrom: string;
  };
}

/** `text` with the characters Markdown would read as markup escaped. */
function escapeInline(text: string): string {
  return text.replace(/[\\`*_[\]<>#|!~]/g, character => `\\${character}`);
}

/**
 * The admin link for `adminPath` on the site at `origin`, or `undefined`
 * when the path is not a plain path on the site (another host, a scheme,
 * spaces or backslashes).
 */
export function adminLink(
  adminPath: unknown,
  origin: string | undefined
): string | undefined {
  if (origin === undefined || typeof adminPath !== "string") return undefined;
  if (!/^\/(?!\/)[^\s\\]*$/.test(adminPath)) return undefined;
  let base: URL;
  try {
    base = new URL(origin);
  } catch {
    return undefined;
  }
  const link = new URL(adminPath, base);
  return link.origin === base.origin ? link.href : undefined;
}

/** An item's display name: its first non-empty name field. */
function nameOf(item: Readonly<Record<string, unknown>>): string | undefined {
  for (const key of NAME_KEYS) {
    const value = item[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return undefined;
}

/** Whether `value` names a thing: it has an ID. */
function isThing(value: unknown): value is Readonly<Record<string, unknown>> {
  return (
    isRecord(value) &&
    (typeof value.id === "string" || typeof value.id === "number")
  );
}

/** One line naming a thing: its name as a link where it has one, then its ID. */
function thingLine(
  thing: Readonly<Record<string, unknown>>,
  origin: string | undefined
): string {
  const name = nameOf(thing);
  const id = `ID \`${String(thing.id).replace(/`/g, "'")}\``;
  const link = adminLink(thing.adminPath, origin);
  const label = name === undefined ? undefined : escapeInline(name);
  if (label !== undefined && link !== undefined)
    return `[${label}](<${link}>) (${id})`;
  if (label !== undefined) return `${label} (${id})`;
  if (link !== undefined) return `[${id}](<${link}>)`;
  return id;
}

/** A value on one line, or `undefined` when it needs lines of its own. */
function inlineValue(
  value: unknown,
  origin: string | undefined
): string | undefined {
  if (value === null || value === undefined) return "none";
  if (typeof value === "string") {
    return value.includes("\n") ? undefined : escapeInline(value);
  }
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (isThing(value)) return thingLine(value, origin);
  if (Array.isArray(value)) {
    if (value.length === 0) return "none";
    if (value.every(entry => isThing(entry))) {
      return value.map(entry => thingLine(entry, origin)).join(", ");
    }
    if (value.every(entry => typeof entry !== "object" || entry === null)) {
      return value.map(entry => inlineValue(entry, origin) ?? "").join(", ");
    }
  }
  return undefined;
}

/** `text` as a Markdown block quote, indented by `indent`. */
function quoted(text: string, indent: string): string[] {
  return text.split("\n").map(line => `${indent}> ${line}`.trimEnd());
}

/** The fields of `record` as list lines, skipping the ones a heading line already shows. */
function fieldLines(
  record: Readonly<Record<string, unknown>>,
  origin: string | undefined,
  indent: string,
  skip: ReadonlySet<string>
): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (skip.has(key) || value === undefined) continue;
    const label = `${indent}- ${escapeInline(key)}:`;
    const inline = inlineValue(value, origin);
    if (inline !== undefined) {
      lines.push(`${label} ${inline}`);
    } else if (typeof value === "string") {
      lines.push(label, ...quoted(value, `${indent}  `));
    } else if (Array.isArray(value)) {
      lines.push(
        `${label} ${value.length} item${value.length === 1 ? "" : "s"}`
      );
      for (const entry of value)
        lines.push(...itemLines(entry, origin, `${indent}  `));
    } else if (isRecord(value)) {
      lines.push(label, ...fieldLines(value, origin, `${indent}  `, new Set()));
    }
  }
  return lines;
}

/** The fields a thing's heading line shows, so its list does not repeat them. */
const SHOWN_IN_HEADING: ReadonlySet<string> = new Set([
  "id",
  "adminPath",
  ...NAME_KEYS,
]);

/** One item of a list: its heading line, then its other fields beneath. */
function itemLines(
  item: unknown,
  origin: string | undefined,
  indent: string
): string[] {
  if (isThing(item)) {
    return [
      `${indent}- ${thingLine(item, origin)}`,
      ...fieldLines(item, origin, `${indent}  `, SHOWN_IN_HEADING),
    ];
  }
  if (isRecord(item)) {
    return [
      `${indent}- item`,
      ...fieldLines(item, origin, `${indent}  `, new Set()),
    ];
  }
  const inline = inlineValue(item, origin);
  return inline !== undefined
    ? [`${indent}- ${inline}`]
    : [`${indent}-`, ...quoted(String(item), `${indent}  `)];
}

/** The Markdown body for `data`, without the heading or the data block. */
function bodyLines(data: unknown, origin: string | undefined): string[] {
  if (!isRecord(data)) {
    const inline = inlineValue(data, origin);
    return inline !== undefined
      ? [`Result: ${inline}`]
      : ["Result:", ...quoted(String(data), "")];
  }
  const lines: string[] = [];
  if (isThing(data)) lines.push(thingLine(data, origin), "");
  const items = data.items;
  const skip = new Set<string>(isThing(data) ? SHOWN_IN_HEADING : []);
  skip.add("page");
  if (Array.isArray(items)) skip.add("items");
  lines.push(...fieldLines(data, origin, "", skip));
  if (Array.isArray(items)) {
    if (lines.length > 0) lines.push("");
    lines.push(
      items.length === 0
        ? "No items."
        : `${items.length} item${items.length === 1 ? "" : "s"}:`
    );
    for (const item of items) lines.push(...itemLines(item, origin, ""));
  }
  return lines;
}

/** The page line of a list's answer. */
function pageLines(data: unknown): string[] {
  if (!isRecord(data) || !isRecord(data.page)) return [];
  const page = data.page;
  const total = typeof page.total === "number" ? ` of ${page.total}` : "";
  if (typeof page.next === "string") {
    return [
      "",
      `More items${total} follow: call again with \`after\` set to \`page.next\` from the data below, and the same other inputs.`,
    ];
  }
  return total === "" ? [] : ["", `That is the last page${total}.`];
}

/** A fence of backticks longer than any run of backticks inside `text`. */
function fenceFor(text: string): string {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? [])
    longest = Math.max(longest, run.length);
  return "`".repeat(Math.max(3, longest + 1));
}

/** The label line before the data block, which a client can find it by. */
export const DATA_LABEL = "Data (the same as the structured content, as JSON):";

/**
 * The answer's text for `data`: the Markdown answer, then the data as JSON in
 * a fenced block under {@link DATA_LABEL}.
 */
export function answerText(data: unknown, context: AnswerContext): string {
  const lines = [`**${escapeInline(context.title)}**`, ""];
  if (context.renamed) {
    lines.push(
      `This tool is now called \`${context.renamed.to}\`; the name \`${context.renamed.from}\` may stop working from release ${context.renamed.removableFrom}.`,
      ""
    );
  }
  lines.push(...bodyLines(data, context.adminOrigin), ...pageLines(data));
  if (context.format === "concise") {
    lines.push(
      "",
      'This is the concise answer; ask for `format: "detailed"` for every field.'
    );
  }
  const json = JSON.stringify(data, null, 2) ?? "null";
  const fence = fenceFor(json);
  lines.push("", DATA_LABEL, "", `${fence}json`, json, fence);
  return lines.join("\n");
}
