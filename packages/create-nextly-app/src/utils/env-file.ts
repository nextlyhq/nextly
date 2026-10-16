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
 * The horizontal-space classes are `[ \t]`, never `\s`, and each line is matched
 * on its own, so a file full of blank lines is read in linear time.
 */
export interface EnvKeys {
  defined: Map<string, string>;
  mentioned: Set<string>;
}

const ASSIGNMENT =
  /^[ \t]*(#[ \t]*)?(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=(.*)$/;

export function readEnvKeys(text: string): EnvKeys {
  const defined = new Map<string, string>();
  const mentioned = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const match = ASSIGNMENT.exec(line);
    if (!match) continue;
    const [, commented, key, rawValue] = match;
    mentioned.add(key);
    if (!commented) defined.set(key, readValue(rawValue));
  }
  return { defined, mentioned };
}

function readValue(raw: string): string {
  const value = raw.trim();
  const quote = value[0];
  if (quote === '"' || quote === "'" || quote === "`") {
    const end = value.indexOf(quote, 1);
    // dotenv expands \n and \r inside double quotes only.
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
