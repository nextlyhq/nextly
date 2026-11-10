/**
 * A reading position over one migration statement's tokens, as the server
 * reads them (`statementTokens`): the one cursor every reader of a
 * statement's shape reads through, so none grows a second parser that could
 * read the same text as another statement.
 *
 * @module domains/schema/migrate/statement-cursor
 */
import type { SupportedDialect } from "../../../database/schema-registry";

import { statementTokens, type QuotedToken } from "./split-sql";

/** One token of a statement: a word or character, or a quoted segment. */
export type StatementToken = string | QuotedToken;

/** An unquoted name: a word with no qualifier and no `@` prefix. */
const BARE_NAME = /^[A-Z_][A-Z0-9_$]*$/;

/**
 * A reading position over a statement's tokens. `conditional` records that
 * an `IF [NOT] EXISTS` was read anywhere in the statement.
 */
export class StatementCursor {
  at = 0;
  conditional = false;

  constructor(private readonly tokens: readonly StatementToken[]) {}

  peek(offset = 0): StatementToken | undefined {
    return this.tokens[this.at + offset];
  }

  done(): boolean {
    return this.at >= this.tokens.length;
  }

  /** Whether the next token is this keyword (an unquoted word). */
  isWord(word: string, offset = 0): boolean {
    return this.peek(offset) === word;
  }

  /** Consumes `words` when they are the next tokens, in order. */
  accept(...words: string[]): boolean {
    if (!words.every((word, i) => this.isWord(word, i))) return false;
    this.at += words.length;
    return true;
  }

  /** Consumes `IF EXISTS` or `IF NOT EXISTS` when next, and notes it. */
  acceptCondition(): void {
    if (this.accept("IF", "EXISTS") || this.accept("IF", "NOT", "EXISTS")) {
      this.conditional = true;
    }
  }

  /**
   * Consumes one unqualified name and returns it lower-cased, or undefined
   * when the next token is not a name or the name is schema-qualified
   * (`s.t`, `"s"."t"`): which schema an unqualified read reaches is not
   * something this reading decides. A string is never a name.
   */
  name(): string | undefined {
    const name = this.nameAt(0);
    if (name === undefined) return undefined;
    this.at += 1;
    if (this.isWord(".")) return undefined;
    return name;
  }

  /**
   * Consumes one or more names separated by commas (`name()` each), or
   * returns undefined when one of them is not a plain name.
   */
  names(): string[] | undefined {
    const names: string[] = [];
    do {
      const name = this.name();
      if (name === undefined) return undefined;
      names.push(name);
    } while (this.accept(","));
    return names;
  }

  /**
   * Consumes a name with exactly one qualifier (`s.t`, `"s"."t"`) and returns
   * both parts lower-cased, or undefined, consuming nothing, when the next
   * tokens are not one. Which schema the qualifier names is the caller's to
   * decide; `name()` still reads no qualified name.
   */
  qualifiedName(): { qualifier: string; name: string } | undefined {
    // Unquoted, `s.t` is one word.
    const word = this.peek();
    if (typeof word === "string" && word.includes(".")) {
      const [qualifier, name, ...more] = word.split(".");
      if (
        more.length > 0 ||
        !BARE_NAME.test(qualifier) ||
        !BARE_NAME.test(name)
      ) {
        return undefined;
      }
      this.at += 1;
      return { qualifier: qualifier.toLowerCase(), name: name.toLowerCase() };
    }
    const qualifier = this.nameAt(0);
    if (qualifier === undefined || !this.isWord(".", 1)) return undefined;
    const name = this.nameAt(2);
    if (name === undefined || this.isWord(".", 3)) return undefined;
    this.at += 3;
    return { qualifier, name };
  }

  /** The name the token at `offset` is, lower-cased, or undefined; a string is never a name. */
  private nameAt(offset: number): string | undefined {
    const token = this.peek(offset);
    if (typeof token === "string") {
      return BARE_NAME.test(token) ? token.toLowerCase() : undefined;
    }
    if (
      token !== undefined &&
      token.name !== undefined &&
      token.escaped !== true
    ) {
      return token.name.toLowerCase();
    }
    return undefined;
  }

  /** The tokens from here to the end, consumed. */
  rest(): StatementToken[] {
    const tokens = this.tokens.slice(this.at);
    this.at = this.tokens.length;
    return tokens;
  }

  /** The tokens from here to the end, split at commas outside parentheses. */
  clauses(): StatementToken[][] {
    const clauses: StatementToken[][] = [[]];
    let depth = 0;
    for (const token of this.tokens.slice(this.at)) {
      if (token === "(") depth += 1;
      if (token === ")") depth -= 1;
      if (token === "," && depth === 0) {
        clauses.push([]);
        continue;
      }
      clauses[clauses.length - 1].push(token);
    }
    this.at = this.tokens.length;
    return clauses;
  }
}

/**
 * A cursor at the start of `statement`, read for `dialect`. The statement's
 * own trailing `;`, if a caller left one on, is not part of its shape.
 */
export function cursorOf(
  statement: string,
  dialect: SupportedDialect,
  options: {
    /**
     * Read a quoted name not written in lower case as no name: PostgreSQL
     * keeps a quoted name's case, so `"DC_POSTS"` is not `dc_posts`, and a
     * reader judging whose table a statement changes fails closed on it.
     */
    exactQuotedNames?: boolean;
  } = {}
): StatementCursor {
  const tokens = statementTokens(statement, dialect);
  while (tokens.length > 0 && tokens[tokens.length - 1] === ";") tokens.pop();
  return new StatementCursor(
    options.exactQuotedNames === true ? tokens.map(lowerCaseQuotedOnly) : tokens
  );
}

/** A quoted name written in another case than lower, as no name; any other token as it is. */
function lowerCaseQuotedOnly(token: StatementToken): StatementToken {
  if (
    typeof token === "string" ||
    token.kind !== "name" ||
    token.written === undefined ||
    token.written === token.written.toLowerCase()
  ) {
    return token;
  }
  return { ...token, name: undefined };
}
