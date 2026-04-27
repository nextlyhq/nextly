// Per-dialect SQL parsers for F4 RenameDetector.
//
// Reads drizzle-kit's statementsToExecute strings and extracts structured
// (tableName, columnName, columnType) tuples for DROP COLUMN / ADD COLUMN
// statements. PG and SQLite share double-quote identifiers; MySQL uses
// backticks.
//
// MySQL emits combined statements like "ALTER TABLE t DROP COLUMN a,
// ADD COLUMN b int" - splitMysqlCombinedStatement breaks these into
// individual logical statements before the regex pass. Splitter is
// paren-aware (so numeric(10,2) is not mis-split) and string-literal-aware
// (so DEFAULT 'a,b,c' is not mis-split).

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";

export interface ParsedDropColumn {
  tableName: string;
  columnName: string;
}

export interface ParsedAddColumn {
  tableName: string;
  columnName: string;
  columnType: string;
}

// Regex builder helpers - shared structure with per-dialect identifier
// quote character. Group capture order:
//   m[1] = optional schema/db prefix (ignored)
//   m[2] = table name
//   m[3] = column name
//   m[4] = (ADD only) raw type spec, captured greedily until ; or end-of-line
function buildDropRegex(quote: '"' | "`"): RegExp {
  const id = `${quote}([^${quote}]+)${quote}`;
  return new RegExp(
    `^\\s*ALTER\\s+TABLE\\s+(?:${id}\\s*\\.\\s*)?${id}\\s+DROP\\s+COLUMN\\s+(?:IF\\s+EXISTS\\s+)?${id}`,
    "i"
  );
}

function buildAddRegex(quote: '"' | "`"): RegExp {
  const id = `${quote}([^${quote}]+)${quote}`;
  return new RegExp(
    `^\\s*ALTER\\s+TABLE\\s+(?:${id}\\s*\\.\\s*)?${id}\\s+ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${id}\\s+(.+?)\\s*;?\\s*$`,
    "is"
  );
}

const DROP_REGEX: Record<SupportedDialect, RegExp> = {
  postgresql: buildDropRegex('"'),
  sqlite: buildDropRegex('"'),
  mysql: buildDropRegex("`"),
};

const ADD_REGEX: Record<SupportedDialect, RegExp> = {
  postgresql: buildAddRegex('"'),
  sqlite: buildAddRegex('"'),
  mysql: buildAddRegex("`"),
};

export function parseDropColumn(
  stmt: string,
  dialect: SupportedDialect
): ParsedDropColumn | null {
  const m = DROP_REGEX[dialect].exec(stmt);
  if (!m) return null;
  return { tableName: m[2], columnName: m[3] };
}

export function parseAddColumn(
  stmt: string,
  dialect: SupportedDialect
): ParsedAddColumn | null {
  const m = ADD_REGEX[dialect].exec(stmt);
  if (!m) return null;
  return {
    tableName: m[2],
    columnName: m[3],
    columnType: m[4].trim(),
  };
}

// Split a MySQL ALTER TABLE statement on top-level commas.
// Paren-aware (numeric(10,2) not split) and string-literal-aware (DEFAULT
// 'a,b,c' not split). Each output element is prefixed with the original
// "ALTER TABLE `<table>`" so it parses standalone.
//
// Returns the input as a single-element array if not a combined ALTER TABLE.
export function splitMysqlCombinedStatement(stmt: string): string[] {
  const trimmed = stmt.trim();
  // Only ALTER TABLE statements get split. Anything else passes through.
  const altMatch = /^ALTER\s+TABLE\s+`[^`]+`\s+/i.exec(trimmed);
  if (!altMatch) return [trimmed];

  const prefix = altMatch[0];
  const body = trimmed.slice(prefix.length);

  const parts: string[] = [];
  let depth = 0;
  let inString = false;
  let stringChar: '"' | "'" | null = null;
  let start = 0;

  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inString) {
      // Closing quote (un-escaped). MySQL allows '' as escaped quote inside
      // single-quoted strings; the simple "previous char != \\" check is
      // good enough for drizzle-kit's emitted DEFAULT values.
      if (c === stringChar && body[i - 1] !== "\\") {
        inString = false;
        stringChar = null;
      }
      continue;
    }
    if (c === "'" || c === '"') {
      inString = true;
      stringChar = c;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      parts.push(body.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(body.slice(start).trim().replace(/;$/, ""));

  return parts.filter(p => p.length > 0).map(p => `${prefix.trim()} ${p}`);
}
