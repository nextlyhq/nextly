/**
 * The shared statement cursor: a reading position over one statement's tokens, as the splitter's
 * tokenizer reads them (`statementTokens`), for every reader of a statement's shape.
 *
 * Only the methods a reader here uses: `peek`, `isWord`, `accept`, `acceptCondition`, `name`,
 * `clauses` and `rest`. A name is unqualified and lower-cased; a string is never a name.
 *
 * @module domains/schema/migrate/statement-cursor
 */
import type { SupportedDialect } from "../../../database/schema-registry";

import { statementTokens, type QuotedToken } from "./split-sql";

export type StatementToken = string | QuotedToken;

/** An unquoted name: a word with no qualifier and no `@` prefix. */
const BARE_NAME = /^[A-Z_][A-Z0-9_$]*$/;

export class StatementCursor {
  private at = 0;
  /** An `IF [NOT] EXISTS` was read. */
  conditional = false;

  constructor(private readonly tokens: readonly StatementToken[]) {}

  peek(offset = 0): StatementToken | undefined {
    return this.tokens[this.at + offset];
  }

  /** Whether the token `offset` ahead is this keyword or punctuation. */
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
   * Consumes one unqualified name and returns it lower-cased; undefined when the next token is
   * not a name, or the name is schema-qualified (`s.t`, `"s"."t"`).
   */
  name(): string | undefined {
    const token = this.peek();
    let name: string | undefined;
    if (typeof token === "string") {
      if (!BARE_NAME.test(token)) return undefined;
      name = token.toLowerCase();
    } else if (
      token !== undefined &&
      token.name !== undefined &&
      token.escaped !== true
    ) {
      name = token.name.toLowerCase();
    }
    if (name === undefined) return undefined;
    this.at += 1;
    if (this.isWord(".")) return undefined;
    return name;
  }

  /** The tokens from here to the end, consumed. */
  rest(): StatementToken[] {
    const tokens = this.tokens.slice(this.at);
    this.at = this.tokens.length;
    return tokens;
  }

  /** The tokens from here to the end, consumed, split at commas outside parentheses. */
  clauses(): StatementToken[][] {
    const clauses: StatementToken[][] = [[]];
    let depth = 0;
    for (const token of this.rest()) {
      if (token === "(") depth += 1;
      if (token === ")") depth -= 1;
      if (token === "," && depth === 0) {
        clauses.push([]);
        continue;
      }
      clauses[clauses.length - 1].push(token);
    }
    return clauses;
  }
}

/** A cursor over one statement, its own trailing `;` left out. */
export function cursorOf(
  statement: string,
  dialect: SupportedDialect
): StatementCursor {
  const tokens = statementTokens(statement, dialect);
  while (tokens.length > 0 && tokens[tokens.length - 1] === ";") tokens.pop();
  return new StatementCursor(tokens);
}
