// What: serializes a collection definition to TypeScript source that can be
// pasted into nextly.config.ts. Used by the `nextly db:sync --promote <slug>`
// command to move a UI-owned collection into code-owned form.
// Why: the naive `JSON.stringify` approach produces double-quoted keys which
// looks out of place in a hand-written TS config. This module produces
// idiomatic TS: unquoted identifier keys, bare numbers/booleans, string
// values in double quotes, and nested arrays/objects indented two spaces.

export interface SerializableCollection {
  slug: string;
  fields: SerializableField[];
  [key: string]: unknown;
}

export interface SerializableField {
  name: string;
  type: string;
  [key: string]: unknown;
}

// Produces a TS fragment the user can paste into the `collections` array.
// Does NOT include the surrounding `{` / `}` of the config object or the
// `collections:` key - just the bare object literal for one collection.
export function serializeCollection(
  collection: SerializableCollection
): string {
  return formatValue(collection, 0);
}

// Produces a value rendered as TS source. Handles primitives, arrays, and
// plain objects. Unknown / class-instance values fall back to JSON.
function formatValue(value: unknown, indentLevel: number): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const innerIndent = "  ".repeat(indentLevel + 1);
    const outerIndent = "  ".repeat(indentLevel);
    const items = value
      .map(item => `${innerIndent}${formatValue(item, indentLevel + 1)}`)
      .join(",\n");
    return `[\n${items}\n${outerIndent}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      // Drop undefined entries so the output is clean.
      ([, v]) => v !== undefined
    );
    if (entries.length === 0) return "{}";
    const innerIndent = "  ".repeat(indentLevel + 1);
    const outerIndent = "  ".repeat(indentLevel);
    const rendered = entries
      .map(([key, v]) => {
        const keyStr = isSafeIdentifier(key) ? key : JSON.stringify(key);
        return `${innerIndent}${keyStr}: ${formatValue(v, indentLevel + 1)}`;
      })
      .join(",\n");
    return `{\n${rendered}\n${outerIndent}}`;
  }
  // Functions, Dates, etc. fall through to JSON for best-effort output.
  return JSON.stringify(value);
}

// TS identifier rules without heavy validation: starts with letter/_, rest
// alphanumeric/_. Intentionally excludes dashes and special chars so we
// fall back to the JSON-quoted form on anything unusual.
function isSafeIdentifier(key: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key);
}
