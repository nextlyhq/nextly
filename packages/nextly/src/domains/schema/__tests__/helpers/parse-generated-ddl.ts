/**
 * Reading the columns out of DDL a builder generated.
 *
 * Shared because two suites need the same answer and a second parser is exactly the failure both of
 * them exist to catch. The column-conformance matrix compares what the builders emit against what
 * the descriptor asks for; the rename-type ratchet needs the set of types those builders can put in
 * a table. Each was a candidate for its own regex, and a regex that split `DECIMAL(10, 2)` on its
 * comma or compared `TEXT` against `text` reported divergences that did not exist.
 *
 * The emitted SQL is read rather than any intermediate a generator happens to expose, because the
 * SQL is what reaches the database and an intermediate can agree while the rendering does not.
 *
 * @module domains/schema/__tests__/helpers/parse-generated-ddl
 */

/**
 * The text between the CREATE TABLE column list's own parentheses.
 *
 * Found by counting depth rather than by taking the last `)`, because a column can close its own
 * parenthesis after the list's does not: `DECIMAL(10, 2)` and an inline CHECK both do.
 */
export function balancedBody(create: string): string {
  const open = create.indexOf("(");
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < create.length; i++) {
    if (create[i] === "(") depth++;
    else if (create[i] === ")") {
      depth--;
      if (depth === 0) return create.slice(open + 1, i);
    }
  }
  return create.slice(open + 1);
}

/**
 * Split a column list on the commas that separate columns.
 *
 * A plain split on "," cuts `DECIMAL(10, 2)` in half and reports the fragment as the column's type,
 * which reads as a real disagreement and is not one.
 */
export function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/** What one side says a column is. `null` means that side produces no column at all. */
export interface Rendered {
  type: string;
  notNull: boolean;
}

/**
 * The columns a generated CREATE TABLE declares.
 *
 * Reads the emitted SQL rather than any intermediate the generator happens to expose, because the
 * SQL is what reaches the database and an intermediate can agree while the rendering does not.
 */
export function parseCreateTable(sql: string): Map<string, Rendered> {
  const out = new Map<string, Rendered>();
  const create = sql.split(";").find(s => /CREATE TABLE/i.test(s));
  if (!create) return out;

  for (const raw of splitTopLevel(balancedBody(create))) {
    const line = raw.trim();
    // Constraint and key clauses are not column declarations.
    if (/^(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|KEY|INDEX)\b/i.test(line))
      continue;
    const m = line.match(/^["`]?([a-z0-9_]+)["`]?\s+(.+)$/i);
    if (!m?.[1] || !m[2]) continue;
    const rest = m[2].trim();
    out.set(m[1], {
      // Strip the clauses that qualify a column rather than name its type.
      type: rest
        .replace(/\b(NOT NULL|PRIMARY KEY|UNIQUE|AUTO_INCREMENT)\b/gi, "")
        // To the end of the declaration, NOT to the next comma. `splitTopLevel` has already
        // isolated one column, so every comma still present is inside the default's own
        // parentheses: stopping at one leaves the tail of `DEFAULT (strftime('%s', 'now'))`
        // attached to the type, which reads as a divergence and is not one.
        .replace(/\bDEFAULT\s+.*/gi, "")
        .replace(/\bREFERENCES\b.*/gi, "")
        .trim(),
      notNull: /\bNOT NULL\b/i.test(rest),
    });
  }
  return out;
}

/**
 * The columns an ALTER migration adds.
 *
 * A column created WITH its table and the same column added to an existing one are emitted by
 * different code, and they are allowed to disagree without anything noticing: the ADD COLUMN path
 * passes only a field's type and length, so anything a field says through its options or its
 * validation is dropped on the way. That makes "created fresh" and "added later" two separate
 * answers to one question, and both have to be measured.
 */
export function parseAddColumns(sql: string): Map<string, Rendered> {
  const out = new Map<string, Rendered>();
  for (const statement of sql.split(";")) {
    const m = statement.match(
      /ADD\s+COLUMN\s+["`]?([a-z0-9_]+)["`]?\s+([^;]+)/i
    );
    if (!m?.[1] || !m[2]) continue;
    const rest = m[2].trim();
    out.set(m[1], {
      type: rest
        .replace(/\b(NOT NULL|PRIMARY KEY|UNIQUE|AUTO_INCREMENT)\b/gi, "")
        .replace(/\bDEFAULT\s+.*/gi, "")
        .replace(/\bREFERENCES\b.*/gi, "")
        .replace(/\bAFTER\b.*/gi, "")
        .trim(),
      notNull: /\bNOT NULL\b/i.test(rest),
    });
  }
  return out;
}
