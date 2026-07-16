/**
 * Plugin-owned Content-field schema (spec §9). A deliberately small schema — text,
 * textarea, select, number, boolean, link, media — so the inspector's Content tab is
 * self-contained and does not depend on the admin's (currently unexported) FieldRenderer.
 * A block declares `contentFields` as `unknown[]` in core; the admin narrows it here.
 * Reusing Nextly's own field renderers is a documented post-MVP door.
 */
export type ContentFieldType =
  | "text"
  | "textarea"
  | "select"
  | "number"
  | "boolean"
  | "link"
  | "media"
  | "icon"
  | "repeater";

export interface ContentFieldOption {
  value: string;
  label: string;
}

export interface ContentField {
  name: string;
  type: ContentFieldType;
  label: string;
  default?: unknown;
  options?: ContentFieldOption[];
  placeholder?: string;
  /** Marks a field as bindable to a Query Loop item (bind UI wired in M6). */
  bindable?: boolean;
  /** For `repeater` — the fields that make up one item. */
  itemFields?: ContentField[];
  /** For `repeater` — label for the add button. */
  addLabel?: string;
}

const TYPES = new Set<ContentFieldType>([
  "text",
  "textarea",
  "select",
  "number",
  "boolean",
  "link",
  "media",
  "icon",
  "repeater",
]);

const TYPE_DEFAULTS: Record<ContentFieldType, unknown> = {
  text: "",
  textarea: "",
  select: undefined,
  number: 0,
  boolean: false,
  link: undefined,
  media: undefined,
  icon: "Star",
  repeater: [],
};

/** Narrow an untyped `def.contentFields` into validated ContentField entries. */
export function narrowContentFields(
  fields: unknown[] | undefined
): ContentField[] {
  if (!Array.isArray(fields)) return [];
  const out: ContentField[] = [];
  for (const f of fields) {
    if (!f || typeof f !== "object") continue;
    const r = f as Record<string, unknown>;
    if (typeof r.name !== "string") continue;
    if (typeof r.type !== "string" || !TYPES.has(r.type as ContentFieldType)) {
      continue;
    }
    out.push({
      name: r.name,
      type: r.type as ContentFieldType,
      label: typeof r.label === "string" ? r.label : r.name,
      default: r.default,
      options: Array.isArray(r.options)
        ? (r.options as ContentFieldOption[])
        : undefined,
      placeholder:
        typeof r.placeholder === "string" ? r.placeholder : undefined,
      bindable: r.bindable === true,
      itemFields: Array.isArray(r.itemFields)
        ? narrowContentFields(r.itemFields)
        : undefined,
      addLabel: typeof r.addLabel === "string" ? r.addLabel : undefined,
    });
  }
  return out;
}

/** Build a `{ name: defaultValue }` object from a field list. */
export function contentDefaults(
  fields: ContentField[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    out[f.name] = f.default !== undefined ? f.default : TYPE_DEFAULTS[f.type];
  }
  return out;
}
