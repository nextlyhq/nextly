/**
 * Reads which keys an env file defines, line by line, the way dotenv does.
 *
 * One reader for every question about an env file the generator asks, so the
 * `.env` merge and the `.env.example` merge cannot disagree about whether a key
 * is there. Matching the text `DATABASE_URL` anywhere in the file, as the
 * generator once did, took `DATABASE_URL_BACKUP` or a commented line for the
 * key, and then wrote none of the values the app actually lacked.
 *
 * - `defined` holds the keys a line assigns, with the value as dotenv reads
 *   it: `export KEY=` counts, a quoted value (single, double or backtick) is
 *   unquoted and may hold `#`, and an unquoted value ends at the first `#`,
 *   spaced or not, where dotenv's own line pattern ends it.
 * - `mentioned` also holds keys named only in a commented assignment
 *   (`# KEY=…`), for a note that documents a setting rather than setting it.
 *
 * - References are expanded as Next.js expands them (`$NAME`, `${NAME}`,
 *   `${NAME:-default}`, with `\$` a literal dollar), except in single quotes,
 *   from the keys this file defines. A value referring to one it does not
 *   define is filled in where the app runs, so it is `unresolved`: unknown
 *   here, and judged by nothing.
 * - `referencing` holds every key whose value refers to another variable,
 *   filled in here or not: Next.js keeps the values of the environment the
 *   app runs in when it expands a file, so even a variable this file sets
 *   can be different there, and no decision rests on such a value.
 * - `fallbacks` holds, for each key, the literal text its references fall
 *   back to (`${NAME:-text}`): it is in the file word for word, and it is the
 *   value wherever the variable is unset, so it is judged as written.
 *
 * Line breaks are `\n`, `\r\n` or a lone `\r`, as dotenv reads them. The
 * horizontal-space classes are `[ \t]`, never `\s`, and each line is matched
 * on its own, so a file full of blank lines is read in linear time.
 */
export interface EnvKeys {
  defined: Map<string, string>;
  mentioned: Set<string>;
  unresolved: Set<string>;
  referencing: Set<string>;
  fallbacks: Map<string, string[]>;
}

// `KEY=value`, or dotenv's other form, `KEY: value` (a colon, then a space).
const ASSIGNMENT =
  /^[ \t]*(#[ \t]*)?(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)(?:[ \t]*=|:[ \t]+)(.*)$/;

export function readEnvKeys(text: string): EnvKeys {
  const raw = new Map<string, RawValue>();
  const mentioned = new Set<string>();
  // A byte order mark, which some editors write first, is not part of the
  // first line: dotenv reads that line through it. dotenv also turns every
  // `\r\n` and lone `\r` into `\n` before it reads a line.
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n?|\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = ASSIGNMENT.exec(lines[i]);
    if (!match) continue;
    const [, commented, key, firstLine] = match;
    mentioned.add(key);
    if (commented) continue;
    // dotenv reads a quoted value across line breaks up to its closing quote,
    // so the lines it spans belong to it, not to keys of their own.
    const end = closingLine(lines, i, firstLine);
    raw.set(
      key,
      readValue([firstLine, ...lines.slice(i + 1, end + 1)].join("\n"))
    );
    i = end;
  }
  const defined = new Map<string, string>();
  const unresolved = new Set<string>();
  // An unresolved value keeps what could be filled in, for a reader to see.
  const partial = new Map<string, string>();
  const resolve = (key: string, seen: Set<string>): string | undefined => {
    if (defined.has(key)) return defined.get(key);
    const entry = raw.get(key);
    if (!entry || seen.has(key) || unresolved.has(key)) return undefined;
    if (!entry.expands) return entry.value;
    let known = true;
    const value = entry.value.replace(
      REFERENCE,
      (
        whole,
        braced?: string,
        operator?: string,
        fallback?: string,
        bare?: string
      ) => {
        if (whole === "\\$") return "$";
        const found = resolve(
          (braced ?? bare) as string,
          new Set([...seen, key])
        );
        if (found === undefined) {
          known = false;
          return whole;
        }
        return operator === ":-" && found === "" ? (fallback ?? "") : found;
      }
    );
    if (known) return value;
    unresolved.add(key);
    partial.set(key, value);
    return undefined;
  };
  for (const [key, entry] of raw) {
    const value = resolve(key, new Set());
    defined.set(key, value ?? partial.get(key) ?? entry.value);
  }
  return { defined, mentioned, unresolved, ...referencesIn(raw) };
}

/** The keys whose values refer to another variable, and the literal fallbacks. */
function referencesIn(
  raw: Map<string, RawValue>
): Pick<EnvKeys, "referencing" | "fallbacks"> {
  const referencing = new Set<string>();
  const fallbacks = new Map<string, string[]>();
  for (const [key, entry] of raw) {
    if (!entry.expands) continue;
    const references = [...entry.value.matchAll(REFERENCE)].filter(
      ([whole]) => whole !== "\\$"
    );
    if (references.length > 0) referencing.add(key);
    // A fallback that itself refers to a variable is not literal text.
    const literal = references
      .map(reference => reference[3])
      .filter((text): text is string => !!text && !text.includes("$"));
    if (literal.length > 0) fallbacks.set(key, literal);
  }
  return { referencing, fallbacks };
}

/**
 * The line a value opening a quote on line `i` closes on: `i` itself when
 * it closes there, or never closes (dotenv then reads just the one line).
 */
function closingLine(lines: string[], i: number, firstLine: string): number {
  const value = firstLine.trim();
  const quote = value[0];
  if (quote !== '"' && quote !== "'" && quote !== "`") return i;
  if (closingQuote(value, quote, 1) > 0) return i;
  for (let j = i + 1; j < lines.length; j++) {
    if (closingQuote(lines[j], quote, 0) >= 0) return j;
  }
  return i;
}

/**
 * The first `quote` from `from` that does not come right after a backslash,
 * or -1. dotenv's grammar (`"(?:\\"|[^"])*"`) keeps a backslash-quote inside
 * the value however many backslashes come before it, so `\\"` does not close
 * one either.
 */
function closingQuote(text: string, quote: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    if (text[i] === quote && text[i - 1] !== "\\") return i;
  }
  return -1;
}

interface RawValue {
  value: string;
  /** Single-quoted values are taken literally, as dotenv-expand takes them. */
  expands: boolean;
}

const REFERENCE =
  /\\\$|\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?-)([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

function readValue(raw: string): RawValue {
  const value = raw.trim();
  const quote = value[0];
  if (quote === '"' || quote === "'" || quote === "`") {
    const end = closingQuote(value, quote, 1);
    // dotenv expands \n and \r inside double quotes only.
    if (end > 0) {
      const inner = value.slice(1, end);
      return {
        value:
          quote === '"'
            ? inner.replace(/\\n/g, "\n").replace(/\\r/g, "\r")
            : inner,
        expands: quote !== "'",
      };
    }
  }
  const comment = value.indexOf("#");
  return {
    value: (comment === -1 ? value : value.slice(0, comment)).trim(),
    expands: true,
  };
}
