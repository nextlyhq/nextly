/**
 * Where the code, the comments and the quoted text of a SQL text lie, read
 * the way the dialect it will run on reads them.
 *
 * The one scanner both the statement splitter (`split-sql.ts`) and the drop
 * guard (`ownership/drop-guard.ts`) read SQL through. Each asks it a
 * different question — where does a statement end, which tables does it
 * drop — but both answers depend on the same facts: which `;` is a
 * separator, which `--` starts a comment, which quote closes a string. Two
 * scanners disagreeing about one of those is how a statement the guard read
 * as one thing runs as another.
 *
 * The dialect rules:
 *
 * - Line comments: `--` everywhere, except that on MySQL it needs whitespace,
 *   a control character or the end of the text after it (`1--1` is
 *   arithmetic there); `#` on MySQL only. A line comment ends at a newline or
 *   carriage return.
 * - Block comments nest on PostgreSQL and end at the first `*\/` elsewhere.
 *   On MySQL `/*! ... *\/` and `/*M! ... *\/` are EXECUTED, and are marked.
 * - `'...'` is a string everywhere. MySQL reads a backslash in it as an
 *   escape; PostgreSQL does only in an `E'...'` string; SQLite never does.
 * - `"..."` is a string on MySQL (whose ANSI_QUOTES mode reads it as a name)
 *   and a quoted name elsewhere. Backticks quote names on MySQL and SQLite,
 *   and `[...]` does on SQLite.
 * - PostgreSQL's `$$...$$` / `$tag$...$tag$` bodies are one quoted unit, which
 *   the drop guard reads as code (it usually is: a `DO` block or a function
 *   body) and the splitter never splits inside.
 *
 * With no dialect, only `'` and `"` quote, `--` always comments, and block
 * comments do not nest.
 *
 * @module domains/schema/migrate/sql-scan
 */
import type { SupportedDialect } from "../../../database/schema-registry";

/**
 * One stretch of a SQL text. `start` and `end` (exclusive) index the text
 * the scan was given; together the segments cover it exactly.
 */
export type SqlSegment =
  | { kind: "code"; start: number; end: number }
  | { kind: "line-comment"; start: number; end: number }
  | {
      kind: "block-comment";
      start: number;
      end: number;
      /** MySQL's `/*! ... *\/`, which the server executes. */
      executable: boolean;
      unterminated: boolean;
    }
  | {
      kind: "string";
      start: number;
      end: number;
      quote: "'" | '"';
      /** The content with a doubled quote undone; backslashes as written. */
      content: string;
      /**
       * A backslash directly before the quote character inside it, on a
       * dialect where whether that backslash escapes depends on a server
       * setting (MySQL's NO_BACKSLASH_ESCAPES, PostgreSQL's
       * standard_conforming_strings) — so where the string ends does too.
       */
      ambiguousBackslash: boolean;
      unterminated: boolean;
    }
  | {
      kind: "quoted-name";
      start: number;
      end: number;
      content: string;
      /** PostgreSQL's `U&"..."`, whose escapes this scan does not decode. */
      unicodeEscaped: boolean;
      /** SQLite's `[...]`, which has no escape and ends at the first `]`. */
      bracketed: boolean;
      unterminated: boolean;
    }
  | {
      kind: "dollar-body";
      start: number;
      end: number;
      /** Where the body between the two delimiters starts and ends. */
      bodyStart: number;
      bodyEnd: number;
      unterminated: boolean;
    };

/**
 * A PostgreSQL dollar-quote delimiter: `$$` or `$tag$`. A `$` followed by a
 * digit is a positional parameter (`$1`), which the tag's first character
 * rules out.
 */
const DOLLAR_DELIMITER =
  /\$(?:(?:[A-Za-z_]|[^\p{ASCII}])(?:\w|[^\p{ASCII}])*)?\$/uy;

/** A character that continues an unquoted word, `$` included. */
const WORD_CHAR = /[\w$]|[^\p{ASCII}]/u;

/**
 * Whether a line comment begins at `index`: `--`, and on MySQL also `#`.
 * MySQL starts one at `--` only when whitespace, a control character or the
 * end of the text follows.
 */
function isLineCommentAt(
  text: string,
  index: number,
  dialect?: SupportedDialect
): boolean {
  if (dialect === "mysql" && text[index] === "#") return true;
  if (text[index] !== "-" || text[index + 1] !== "-") return false;
  if (dialect !== "mysql") return true;
  const next = text.charCodeAt(index + 2);
  return Number.isNaN(next) || next <= 0x20;
}

/** Whether the character before `index` continues a word. */
function afterWordChar(text: string, index: number): boolean {
  return index > 0 && WORD_CHAR.test(text[index - 1]);
}

/**
 * Splits `text` into its segments. Never throws: a string, comment or body
 * that does not close runs to the end of the text and is marked
 * `unterminated`, for the caller to judge.
 */
export function scanSql(
  text: string,
  dialect?: SupportedDialect
): SqlSegment[] {
  const segments: SqlSegment[] = [];
  let codeStart = 0;
  let i = 0;
  while (i < text.length) {
    const quoted = quotedAt(text, i, dialect);
    if (quoted === undefined) {
      i += 1;
      continue;
    }
    if (quoted.start > codeStart) {
      segments.push({ kind: "code", start: codeStart, end: quoted.start });
    }
    segments.push(quoted);
    i = quoted.end;
    codeStart = i;
  }
  if (codeStart < text.length) {
    segments.push({ kind: "code", start: codeStart, end: text.length });
  }
  return segments;
}

/** The non-code segment that starts at `at`, if one does. */
function quotedAt(
  text: string,
  at: number,
  dialect: SupportedDialect | undefined
): SqlSegment | undefined {
  const c = text[at];
  if (isLineCommentAt(text, at, dialect)) {
    return { kind: "line-comment", start: at, end: lineEnd(text, at) };
  }
  if (c === "/" && text[at + 1] === "*") {
    return blockComment(text, at, dialect);
  }
  if (dialect === "postgresql") {
    const prefixed = postgresPrefixedAt(text, at);
    if (prefixed !== undefined) return prefixed;
    if (c === "$" && !afterWordChar(text, at)) {
      const body = dollarBody(text, at);
      if (body !== undefined) return body;
    }
  }
  if (c === "'") {
    // MySQL reads a backslash in a string as an escape by default; SQLite and
    // an ordinary PostgreSQL string never do (`E'...'` is its prefix's case).
    return stringAt(text, at, at, "'", dialect === "mysql", dialect);
  }
  if (c === '"') {
    return dialect === "mysql"
      ? stringAt(text, at, at, '"', true, dialect)
      : quotedName(text, at, '"', false);
  }
  if (c === "`" && (dialect === "mysql" || dialect === "sqlite")) {
    return quotedName(text, at, "`", false);
  }
  if (c === "[" && dialect === "sqlite") return bracketedName(text, at);
  return undefined;
}

/**
 * PostgreSQL's prefixed forms: `E'...'`, an escape string, and `U&"..."`, a
 * name spelled with unicode escapes. The prefix has to be a whole word:
 * `nameE'x'` is a name followed by a string.
 */
function postgresPrefixedAt(text: string, at: number): SqlSegment | undefined {
  if (afterWordChar(text, at)) return undefined;
  const c = text[at];
  if ((c === "E" || c === "e") && text[at + 1] === "'") {
    return stringAt(text, at, at + 1, "'", true, "postgresql");
  }
  if (
    (c === "U" || c === "u") &&
    text[at + 1] === "&" &&
    text[at + 2] === '"'
  ) {
    const name = quotedName(text, at + 2, '"', true);
    return { ...name, start: at };
  }
  return undefined;
}

/**
 * Whether a server setting decides what a backslash in this string means:
 * every MySQL string, and PostgreSQL's ordinary one. Not an `E'...'` string,
 * which always escapes, and never SQLite, which never does.
 */
function settingDecidesBackslash(
  dialect: SupportedDialect | undefined,
  escapeString: boolean
): boolean {
  if (dialect === "mysql") return true;
  return dialect === "postgresql" && !escapeString;
}

/**
 * A string literal whose opening quote is at `quoteAt` (after any prefix
 * starting at `start`). A doubled quote is one quote character; with
 * `escapes`, a backslash also escapes the character after it.
 */
function stringAt(
  text: string,
  start: number,
  quoteAt: number,
  quote: "'" | '"',
  escapes: boolean,
  dialect: SupportedDialect | undefined
): SqlSegment {
  let content = "";
  let i = quoteAt + 1;
  let closed = false;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\" && escapes) {
      content += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === quote) {
      if (text[i + 1] === quote) {
        content += quote;
        i += 2;
        continue;
      }
      closed = true;
      i += 1;
      break;
    }
    content += c;
    i += 1;
  }
  const end = Math.min(i, text.length);
  const escapeString = start !== quoteAt;
  return {
    kind: "string",
    start,
    end,
    quote,
    content,
    ambiguousBackslash:
      settingDecidesBackslash(dialect, escapeString) &&
      text.slice(quoteAt + 1, end).includes(`\\${quote}`),
    unterminated: !closed,
  };
}

/** A quoted name: a doubled closing quote is one quote character. */
function quotedName(
  text: string,
  at: number,
  quote: '"' | "`",
  unicodeEscaped: boolean
): Extract<SqlSegment, { kind: "quoted-name" }> {
  let content = "";
  let i = at + 1;
  while (i < text.length) {
    if (text[i] === quote) {
      if (text[i + 1] === quote) {
        content += quote;
        i += 2;
        continue;
      }
      return {
        kind: "quoted-name",
        start: at,
        end: i + 1,
        content,
        unicodeEscaped,
        bracketed: false,
        unterminated: false,
      };
    }
    content += text[i];
    i += 1;
  }
  return {
    kind: "quoted-name",
    start: at,
    end: text.length,
    content,
    unicodeEscaped,
    bracketed: false,
    unterminated: true,
  };
}

/** SQLite's bracketed name has no escape: it ends at the first `]`. */
function bracketedName(text: string, at: number): SqlSegment {
  const close = text.indexOf("]", at + 1);
  return {
    kind: "quoted-name",
    start: at,
    end: close === -1 ? text.length : close + 1,
    content: text.slice(at + 1, close === -1 ? text.length : close),
    unicodeEscaped: false,
    bracketed: true,
    unterminated: close === -1,
  };
}

/**
 * Where a line comment starting at `at` ends. PostgreSQL ends one at a
 * carriage return as well as a newline; ending there in every dialect reads
 * more text as code, never less.
 */
function lineEnd(text: string, at: number): number {
  for (let i = at; i < text.length; i += 1) {
    if (text[i] === "\n" || text[i] === "\r") return i;
  }
  return text.length;
}

/**
 * A block comment starting at `at`. PostgreSQL nests them, so
 * `/* /* *\/ x *\/` is one comment; MySQL and SQLite end every one at the
 * first `*\/`.
 */
function blockComment(
  text: string,
  at: number,
  dialect: SupportedDialect | undefined
): SqlSegment {
  const executable =
    dialect === "mysql" && /^\/\*M?!/i.test(text.slice(at, at + 4));
  if (dialect !== "postgresql") {
    const close = text.indexOf("*/", at + 2);
    return {
      kind: "block-comment",
      start: at,
      end: close === -1 ? text.length : close + 2,
      executable,
      unterminated: close === -1,
    };
  }
  let depth = 1;
  let i = at + 2;
  while (i < text.length) {
    if (text.startsWith("/*", i)) {
      depth += 1;
      i += 2;
    } else if (text.startsWith("*/", i)) {
      depth -= 1;
      i += 2;
      if (depth === 0) {
        return {
          kind: "block-comment",
          start: at,
          end: i,
          executable,
          unterminated: false,
        };
      }
    } else {
      i += 1;
    }
  }
  return {
    kind: "block-comment",
    start: at,
    end: text.length,
    executable,
    unterminated: true,
  };
}

/**
 * A PostgreSQL dollar-quoted body starting at `at`, or undefined when the
 * `$` there opens none. The body ends at the first repeat of its own
 * delimiter, whatever lies between.
 */
function dollarBody(text: string, at: number): SqlSegment | undefined {
  DOLLAR_DELIMITER.lastIndex = at;
  const delimiter = DOLLAR_DELIMITER.exec(text)?.[0];
  if (delimiter === undefined) return undefined;
  const bodyStart = at + delimiter.length;
  const close = text.indexOf(delimiter, bodyStart);
  return {
    kind: "dollar-body",
    start: at,
    end: close === -1 ? text.length : close + delimiter.length,
    bodyStart,
    bodyEnd: close === -1 ? text.length : close,
    unterminated: close === -1,
  };
}
