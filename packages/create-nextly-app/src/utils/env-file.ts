import { expand } from "dotenv-expand";

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
 * - References (`$NAME`, `${NAME}`, `${NAME:-default}`, and `\$` for a
 *   literal dollar) are expanded by dotenv-expand itself, the version Next.js
 *   bundles, so a value is what the app gets when the environment it runs in
 *   sets none of the variables involved. That is also what the committed
 *   file gives every such deployment, defaults included, so a credential in
 *   one is judged as written.
 * - `referencing` holds every key whose value refers to another variable,
 *   filled in here or not: Next.js keeps the values of the environment the
 *   app runs in when it expands a file, so even a variable this file sets
 *   can be different there, and no decision rests on such a value.
 * - `unresolved` holds those that refer to a variable this file does not
 *   define: filled in where the app runs, so unknown here, and judged by
 *   nothing that needs the value itself.
 *
 * Line breaks are `\n`, `\r\n` or a lone `\r`, as dotenv reads them. The
 * horizontal-space classes are `[ \t]`, never `\s`, and each line is matched
 * on its own, so a file full of blank lines is read in linear time: dotenv's
 * own line pattern is not, which is why the lines are read here rather than
 * by dotenv.
 */
export interface EnvKeys {
  defined: Map<string, string>;
  mentioned: Set<string>;
  unresolved: Set<string>;
  referencing: Set<string>;
}

// `KEY=value`, or dotenv's other form, `KEY: value` (a colon, then a space).
const ASSIGNMENT =
  /^[ \t]*(#[ \t]*)?(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)(?:[ \t]*=|:[ \t]+)(.*)$/;

export function readEnvKeys(text: string): EnvKeys {
  const raw = new Map<string, string>();
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
  return { mentioned, ...expanded(raw) };
}

/**
 * The values as Next.js expands them, by dotenv-expand itself, and which
 * refer to other variables. `ignoreProcessEnv` keeps this process's own
 * environment out: the one the app runs in is unknown here, so it is taken as
 * setting none of them.
 */
function expanded(
  raw: Map<string, string>
): Pick<EnvKeys, "defined" | "unresolved" | "referencing"> {
  const referencing = new Set<string>();
  const unresolved = new Set<string>();
  for (const [key, value] of raw) {
    const names = [...value.matchAll(NAMED)].map(([, name]) => name);
    if (names.length === 0) continue;
    referencing.add(key);
    if (names.some(name => !raw.has(name))) unresolved.add(key);
  }
  try {
    const { parsed } = expand({
      parsed: Object.fromEntries(raw),
      ignoreProcessEnv: true,
    });
    return {
      defined: new Map(Object.entries(parsed ?? {})),
      unresolved,
      referencing,
    };
  } catch {
    // A value that names itself, directly or through others, makes
    // dotenv-expand recurse until the stack runs out, and Next.js then loads
    // nothing from the file: every value that refers to another is unknown.
    for (const key of referencing) unresolved.add(key);
    return { defined: new Map(raw), unresolved, referencing };
  }
}

/**
 * A name a value refers to, as dotenv-expand 10 finds one: a `$` after no
 * backslash, then the name, braced or not. A default may hold a reference of
 * its own, which this finds too.
 */
const NAMED = /(?<!\\)\$\{?(\w+)/g;

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

/**
 * A value as dotenv parses it, before expansion. The quotes are removed
 * before dotenv-expand sees it, so it expands single-quoted values as well.
 */
function readValue(raw: string): string {
  const value = raw.trim();
  const quote = value[0];
  if (quote === '"' || quote === "'" || quote === "`") {
    const end = closingQuote(value, quote, 1);
    // dotenv turns \n and \r into line breaks inside double quotes only.
    if (end > 0) {
      const inner = value.slice(1, end);
      return quote === '"'
        ? inner.replace(/\\n/g, "\n").replace(/\\r/g, "\r")
        : inner;
    }
  }
  const comment = value.indexOf("#");
  return (comment === -1 ? value : value.slice(0, comment)).trim();
}
