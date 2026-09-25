// Normalises CHECK-constraint expressions to one canonical spelling so the
// diff compares what a check MEANS rather than how a dialect chose to print it.
//
// Why this exists: PostgreSQL does not keep a check's source text. It stores a
// parse tree and `pg_get_constraintdef` deparses it, so an authored
//
//     status IN ('a', 'b')
//
// on a varchar column reads back as
//
//     ((status)::text = ANY ((ARRAY['a'::character varying, 'b'::character varying])::text[]))
//
// and `score >= 0 AND (score IS NULL OR score < 1000)` reads back with every
// subexpression parenthesised. Compared as text, every check PostgreSQL holds
// differs from its declaration, so each comparison proposes a drop-plus-add
// and a later change to the check is refused as drift.
//
// Both sides of the comparison go through this one function, rather than the
// desired side emitting PostgreSQL's deparsed spelling: that spelling is an
// artefact of the server's deparser, varies with the column type, and would
// have to be tracked release by release.
//
// Design principle — the same one normalize-default.ts follows:
//   - Only rewrites that preserve meaning: redundant parentheses (the printer
//     emits exactly the ones precedence requires), keyword and identifier
//     case, whitespace, the associativity of AND/OR, and PostgreSQL's
//     equivalent spellings (`= ANY (ARRAY[...])` for IN, `<> ALL` for NOT IN,
//     `~~` for LIKE, BETWEEN expanded into its two comparisons, a one-element
//     IN list as an equality, and NOT pushed into a predicate that has a
//     negated form).
//   - Casts PostgreSQL inserts on its own are dropped: a cast on a literal,
//     and a cast to a character type, which is how a varchar column is
//     compared with text. Any other cast is kept.
//   - Anything the grammar below does not recognise is returned UNCHANGED, so
//     an unfamiliar expression compares exactly as it did before this existed.
//     A spurious drop-plus-add is the safe failure; treating two different
//     checks as the same one is not.
//
// MySQL has its own spelling of the same checks, read by the same rules. It
// reports every string behind a charset introducer with backslash escapes
// (`_utf8mb4'it\'s'`), wraps every subexpression in parentheses, quotes
// identifiers with backticks, keeps BETWEEN, and stores `NOT n = 3` as
// `n <> 3`. Each of those is either syntax the tokenizer reads or a rewrite
// below, so a MySQL clause reaches the same tree as its declaration. The one
// exception is a string holding a backslash, whose value MySQL itself reads
// differently by sql_mode; `readLiteral` says why, and such a clause is
// compared as exact text.
//
// Nothing in PostgreSQL or SQLite output uses an introducer, a backtick or a
// `::` cast in any other sense, so reading all of them in one grammar costs
// neither dialect anything.

/**
 * The canonical form of a check expression, for comparison only.
 *
 * Never used as DDL: the diff keeps each side's own text on the operations it
 * emits, so what reaches the database is always what was declared or read.
 */
export function normalizeCheckExpression(expression: string): string {
  const tokens = tokenize(expression);
  if (tokens === null) return expression;
  const parser = new Parser(tokens);
  const tree = parser.parseExpression();
  if (tree === null || !parser.atEnd()) return expression;
  return print(canonical(tree), 0);
}

// =============================================================================
// Tokens
// =============================================================================

type Token =
  | { kind: "word"; text: string }
  | { kind: "quoted"; text: string }
  // A string literal carries the VALUE it denotes, decoded by the rules of the
  // spelling it arrived in, so two spellings of one value become one token.
  | { kind: "string"; value: string }
  | { kind: "number"; text: string }
  | { kind: "punct"; text: string };

// Longest first, so `<=` is never read as `<` followed by `=`.
const PUNCTUATION = [
  "!~~",
  "::",
  "<=",
  ">=",
  "<>",
  "!=",
  "~~",
  "=",
  "<",
  ">",
  "(",
  ")",
  "[",
  "]",
  ",",
  "+",
  "-",
  "*",
  "/",
  "%",
];

/**
 * What one scanner read at a position: the token, if the text there is one
 * (whitespace is read but yields none), and where the next read starts.
 */
type Scanned = { token?: Token; end: number };

/**
 * A reader for one class of token. It returns undefined when the text at `i`
 * is not its class, so the next scanner is tried, and null when it is its
 * class but malformed, which puts the whole expression outside the grammar.
 */
type Scanner = (source: string, i: number) => Scanned | null | undefined;

/**
 * The scanners in the order they are tried. The order is load-bearing: a
 * number is tried before a word, and a word before punctuation, so `.5` is a
 * number and `_utf8mb4'a'` is one introduced string rather than a word.
 */
const SCANNERS: Scanner[] = [
  scanWhitespace,
  scanString,
  scanQuotedIdentifier,
  scanNumber,
  scanWord,
  scanPunctuation,
];

/** The tokens of an expression, or null for any character outside the grammar. */
function tokenize(source: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const scanned = scanAt(source, i);
    if (scanned === null) return null;
    if (scanned.token !== undefined) tokens.push(scanned.token);
    i = scanned.end;
  }
  return tokens;
}

/** The first scanner's reading at `i`, or null when none recognises it. */
function scanAt(source: string, i: number): Scanned | null {
  for (const scanner of SCANNERS) {
    const scanned = scanner(source, i);
    if (scanned !== undefined) return scanned;
  }
  return null;
}

function scanWhitespace(source: string, i: number): Scanned | undefined {
  return /\s/.test(source[i]) ? { end: i + 1 } : undefined;
}

/** A plain string literal, whose backslashes are ordinary characters. */
function scanString(source: string, i: number): Scanned | null | undefined {
  return source[i] === "'" ? scanLiteral(source, i, false) : undefined;
}

/** A string literal opening at `start`, as a token. */
function scanLiteral(
  source: string,
  start: number,
  mysqlEscapes: boolean
): Scanned | null {
  const literal = readLiteral(source, start, mysqlEscapes);
  if (literal === null) return null;
  return { token: { kind: "string", value: literal.value }, end: literal.end };
}

/**
 * A double-quoted (standard) or backtick-quoted (MySQL) identifier, in which a
 * doubled quote character stands for one.
 */
function scanQuotedIdentifier(
  source: string,
  i: number
): Scanned | null | undefined {
  const quote = source[i];
  if (quote !== '"' && quote !== "`") return undefined;
  let j = i + 1;
  let name = "";
  for (;;) {
    if (j >= source.length) return null;
    if (source[j] !== quote) {
      name += source[j];
      j += 1;
      continue;
    }
    if (source[j + 1] !== quote) {
      return { token: { kind: "quoted", text: name }, end: j + 1 };
    }
    name += quote;
    j += 2;
  }
}

function scanNumber(source: string, i: number): Scanned | undefined {
  const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(
    source.slice(i)
  );
  if (!number) return undefined;
  return {
    token: { kind: "number", text: number[0] },
    end: i + number[0].length,
  };
}

/**
 * A word, or — when the word is a charset introducer followed by a literal —
 * the string that literal holds. An introducer followed by anything else is
 * read as an ordinary word.
 */
function scanWord(source: string, i: number): Scanned | null | undefined {
  const word = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(source.slice(i));
  if (!word) return undefined;
  const end = i + word[0].length;
  if (CHARSET_INTRODUCER.test(word[0])) {
    const introduced = scanIntroduced(source, end);
    if (introduced !== undefined) return introduced;
  }
  return { token: { kind: "word", text: word[0] }, end };
}

/** The literal behind a charset introducer ending at `after`, if any. */
function scanIntroduced(
  source: string,
  after: number
): Scanned | null | undefined {
  // MySQL's form: `_utf8mb4'a'`, the introducer touching the quote, with
  // a quote inside escaped as `\'` — the only way MySQL prints a string
  // literal in a stored check.
  if (source[after] === "'") return scanLiteral(source, after, true);
  // `_utf8mb4 X'...'`, a hex literal read as text in that character set:
  // the one spelling of a value whose meaning no sql_mode can change.
  const hex = /^\s*[xX]'([0-9A-Fa-f]*)'/.exec(source.slice(after));
  if (!hex) return undefined;
  const value = decodeHexUtf8(hex[1]);
  if (value === null) return null;
  return { token: { kind: "string", value }, end: after + hex[0].length };
}

function scanPunctuation(source: string, i: number): Scanned | undefined {
  const punct = PUNCTUATION.find(p => source.startsWith(p, i));
  if (punct === undefined) return undefined;
  return { token: { kind: "punct", text: punct }, end: i + punct.length };
}

/**
 * A MySQL character-set introducer: `_utf8mb4`, `_latin1`, `_binary`. It names
 * the character set of the literal that follows, which says nothing about
 * which value the literal holds, so it is read and discarded.
 */
const CHARSET_INTRODUCER = /^_[A-Za-z0-9]+$/;

/**
 * The string literal opening at `start`, decoded to its value, or null when
 * its value cannot be known from the text.
 *
 * Doubling a quote escapes it in all three dialects. A plain literal keeps its
 * backslashes as characters, which is what PostgreSQL and SQLite mean by it,
 * and neither server nor a declaration ever puts a charset introducer in front
 * of one.
 *
 * A literal behind an introducer is MySQL's printed form, and there a
 * backslash is where the value stops being knowable. MySQL prints the clause
 * with backslash escapes and then re-reads that text under the sql_mode of
 * whichever session opens the table. Measured on MySQL 8.0.46: a check
 * permitting `back\slash`, created and opened under NO_BACKSLASH_ESCAPES,
 * enforces `back\\slash` instead — two backslashes — while the stored clause
 * is byte-identical to the one a default-mode server enforces correctly. The
 * same text therefore means two different constraints, and nothing in it says
 * which.
 *
 * So only `\'` is decoded: it is the one escape with a single reading, because
 * under NO_BACKSLASH_ESCAPES the clause containing it does not parse at all
 * (MySQL refuses to create such a check in that mode). Any other backslash
 * makes this return null, and the whole expression is compared as exact text
 * — a check whose values include a backslash reads as changed on MySQL, the
 * safe direction, rather than as a match that may be false.
 */
function readLiteral(
  source: string,
  start: number,
  mysqlEscapes: boolean
): { value: string; end: number } | null {
  let value = "";
  let j = start + 1;
  for (;;) {
    if (j >= source.length) return null;
    const ch = source[j];
    if (ch === "'") {
      if (source[j + 1] !== "'") return { value, end: j + 1 };
      value += "'";
      j += 2;
    } else if (mysqlEscapes && ch === "\\") {
      if (source[j + 1] !== "'") return null;
      value += "'";
      j += 2;
    } else {
      value += ch;
      j += 1;
    }
  }
}

/** Hex digits as UTF-8 text, or null when they are not whole valid bytes. */
function decodeHexUtf8(hex: string): string | null {
  if (hex.length % 2 !== 0) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(hex.match(/../g) ?? [], byte => parseInt(byte, 16))
    );
  } catch {
    return null;
  }
}

/** A value as a standard SQL literal: single quotes, a quote doubled. */
function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// =============================================================================
// Tree
// =============================================================================

type Node =
  | { kind: "literal"; text: string; string: boolean }
  | { kind: "identifier"; text: string }
  | { kind: "call"; name: string; args: Node[] }
  | { kind: "array"; items: Node[] }
  | { kind: "cast"; expr: Node; type: string; base: string }
  | { kind: "negate"; expr: Node }
  | { kind: "arithmetic"; op: string; left: Node; right: Node }
  | { kind: "compare"; op: string; left: Node; right: Node }
  | {
      kind: "quantified";
      op: string;
      quantifier: "ANY" | "ALL";
      left: Node;
      right: Node;
    }
  | { kind: "in"; negated: boolean; left: Node; items: Node[] }
  | { kind: "like"; negated: boolean; left: Node; right: Node }
  | { kind: "isNull"; negated: boolean; expr: Node }
  | { kind: "between"; negated: boolean; expr: Node; low: Node; high: Node }
  | { kind: "not"; expr: Node }
  | { kind: "logical"; op: "AND" | "OR"; args: Node[] };

type NodeKind = Node["kind"];

/** Each node kind mapped to the node shape that carries it. */
type NodeOfKind = { [N in Node as N["kind"]]: N };

/**
 * One handler per node kind. The rewrites, the printer and the precedence
 * table are each one of these, so a new node kind that is missing from any of
 * them is a type error rather than a silent fall-through.
 */
type ByKind<R> = { [K in NodeKind]: (node: NodeOfKind[K]) => R };

/** The result of the handler `table` holds for this node's kind. */
function byKind<R>(table: ByKind<R>, node: Node): R {
  return applyHandler(table, node.kind, node);
}

// Split from `byKind` so the kind is a type parameter: that is what lets the
// compiler see that the handler it looks up accepts the node it is handed.
function applyHandler<R, K extends NodeKind>(
  table: ByKind<R>,
  kind: K,
  node: NodeOfKind[K]
): R {
  return table[kind](node);
}

/**
 * Words that are syntax rather than names. Kept out of identifier position so
 * that `a AND b` can never be read as a column called AND.
 */
const RESERVED = new Set([
  "AND",
  "OR",
  "NOT",
  "IS",
  "NULL",
  "IN",
  "LIKE",
  "BETWEEN",
  "ANY",
  "ALL",
  "SOME",
  "ARRAY",
  "TRUE",
  "FALSE",
]);

const COMPARISON = new Set(["=", "<>", "!=", "<", "<=", ">", ">="]);

/** PostgreSQL's operator spellings of LIKE and NOT LIKE. */
const LIKE_OPERATORS = new Set(["~~", "!~~"]);

/** The words that quantify a comparison, SOME being a synonym for ANY. */
const QUANTIFIERS = new Map<string, "ANY" | "ALL">([
  ["ANY", "ANY"],
  ["SOME", "ANY"],
  ["ALL", "ALL"],
]);

/** Words that are literal values rather than names. */
const CONSTANT_WORDS = new Set(["NULL", "TRUE", "FALSE"]);

/**
 * One way a predicate can continue after its left operand. It returns
 * undefined when the tokens that follow are not its form, so the next form is
 * tried, and null when they are its form but malformed.
 */
type PredicateForm = (left: Node) => Node | null | undefined;

/** A predicate that may be preceded by NOT: IN, LIKE and BETWEEN. */
type NegatableForm = (negated: boolean, left: Node) => Node | null;

/**
 * Words that continue a multi-word type name after `::`, as in
 * `character varying`, `double precision` and `timestamp with time zone`.
 */
const TYPE_CONTINUATION = new Set([
  "varying",
  "precision",
  "with",
  "without",
  "time",
  "zone",
]);

/**
 * Recursive descent over the subset of SQL a check expression uses, lowest
 * precedence first: OR, AND, NOT, the predicates, additive, multiplicative,
 * unary minus, then `::` casts and primaries. Every method returns null on
 * input it does not recognise, which the caller turns into "leave unchanged".
 */
class Parser {
  private position = 0;

  /**
   * What may follow a predicate's left operand, tried in order: a comparison
   * (possibly quantified), PostgreSQL's `~~`/`!~~`, IS [NOT] NULL, then the
   * predicates NOT can precede. None matching leaves the operand as it is.
   */
  private readonly predicateForms: PredicateForm[] = [
    left => this.parseComparison(left),
    left => this.parseLikeOperator(left),
    left => this.parseIsNull(left),
    left => this.parseNegatablePredicate(left),
  ];

  /** The predicates an optional NOT can precede, by their keyword. */
  private readonly negatableForms = new Map<string, NegatableForm>([
    ["IN", (negated, left) => this.parseIn(negated, left)],
    ["LIKE", (negated, left) => this.parseLike(negated, left)],
    ["BETWEEN", (negated, left) => this.parseBetween(negated, left)],
  ]);

  constructor(private readonly tokens: Token[]) {}

  atEnd(): boolean {
    return this.position >= this.tokens.length;
  }

  parseExpression(): Node | null {
    return this.parseOr();
  }

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.position + offset];
  }

  /** The word at `offset`, upper-cased, or undefined for any other token. */
  private keywordAt(offset = 0): string | undefined {
    const token = this.peek(offset);
    return token?.kind === "word" ? token.text.toUpperCase() : undefined;
  }

  private isKeyword(word: string, offset = 0): boolean {
    return this.keywordAt(offset) === word;
  }

  /** Consumes `word` when it is next, reporting whether it was. */
  private takeKeyword(word: string): boolean {
    if (!this.isKeyword(word)) return false;
    this.position += 1;
    return true;
  }

  /** Consumes the next token when it is punctuation in `operators`. */
  private takeOperator(operators: ReadonlySet<string>): string | undefined {
    const token = this.peek();
    if (token?.kind !== "punct" || !operators.has(token.text)) return undefined;
    this.position += 1;
    return token.text;
  }

  private isPunct(text: string): boolean {
    const token = this.peek();
    return token?.kind === "punct" && token.text === text;
  }

  private take(): Token | undefined {
    const token = this.tokens[this.position];
    this.position += 1;
    return token;
  }

  private expectPunct(text: string): boolean {
    if (!this.isPunct(text)) return false;
    this.position += 1;
    return true;
  }

  private parseOr(): Node | null {
    return this.parseLogical("OR", () => this.parseAnd());
  }

  private parseAnd(): Node | null {
    return this.parseLogical("AND", () => this.parseNot());
  }

  private parseLogical(
    op: "AND" | "OR",
    operand: () => Node | null
  ): Node | null {
    const first = operand();
    if (first === null) return null;
    const args = [first];
    while (this.isKeyword(op)) {
      this.position += 1;
      const next = operand();
      if (next === null) return null;
      args.push(next);
    }
    return args.length === 1 ? first : { kind: "logical", op, args };
  }

  private parseNot(): Node | null {
    if (this.isKeyword("NOT")) {
      this.position += 1;
      const expr = this.parseNot();
      return expr === null ? null : { kind: "not", expr };
    }
    return this.parsePredicate();
  }

  private parsePredicate(): Node | null {
    const left = this.parseAdditive();
    if (left === null) return null;
    for (const form of this.predicateForms) {
      const node = form(left);
      if (node !== undefined) return node;
    }
    return left;
  }

  /** `left op right`, or `left op ANY|SOME|ALL (...)`. */
  private parseComparison(left: Node): Node | null | undefined {
    const op = this.takeOperator(COMPARISON);
    if (op === undefined) return undefined;
    const quantifier = QUANTIFIERS.get(this.keywordAt() ?? "");
    if (quantifier !== undefined) {
      this.position += 1;
      return this.parseQuantified(op, quantifier, left);
    }
    const right = this.parseAdditive();
    return right === null ? null : { kind: "compare", op, left, right };
  }

  /** `left ~~ right` and `left !~~ right`, PostgreSQL's LIKE and NOT LIKE. */
  private parseLikeOperator(left: Node): Node | null | undefined {
    const op = this.takeOperator(LIKE_OPERATORS);
    if (op === undefined) return undefined;
    const right = this.parseAdditive();
    return right === null
      ? null
      : { kind: "like", negated: op === "!~~", left, right };
  }

  private parseIsNull(left: Node): Node | null | undefined {
    if (!this.takeKeyword("IS")) return undefined;
    const negated = this.takeKeyword("NOT");
    if (!this.takeKeyword("NULL")) return null;
    return { kind: "isNull", negated, expr: left };
  }

  /** `[NOT] IN`, `[NOT] LIKE` or `[NOT] BETWEEN`, dispatched on the keyword. */
  private parseNegatablePredicate(left: Node): Node | null | undefined {
    const negated = this.isKeyword("NOT");
    const offset = negated ? 1 : 0;
    const form = this.negatableForms.get(this.keywordAt(offset) ?? "");
    // A bare NOT here is not a predicate this grammar knows.
    if (form === undefined) return negated ? null : undefined;
    this.position += offset + 1;
    return form(negated, left);
  }

  private parseIn(negated: boolean, left: Node): Node | null {
    if (!this.expectPunct("(")) return null;
    const items = this.parseList(")");
    return items === null ? null : { kind: "in", negated, left, items };
  }

  private parseLike(negated: boolean, left: Node): Node | null {
    const right = this.parseAdditive();
    return right === null ? null : { kind: "like", negated, left, right };
  }

  private parseBetween(negated: boolean, left: Node): Node | null {
    const low = this.parseAdditive();
    if (low === null || !this.takeKeyword("AND")) return null;
    const high = this.parseAdditive();
    return high === null
      ? null
      : { kind: "between", negated, expr: left, low, high };
  }

  private parseQuantified(
    op: string,
    quantifier: "ANY" | "ALL",
    left: Node
  ): Node | null {
    if (!this.expectPunct("(")) return null;
    const right = this.parseExpression();
    if (right === null || !this.expectPunct(")")) return null;
    return { kind: "quantified", op, quantifier, left, right };
  }

  private parseAdditive(): Node | null {
    return this.parseArithmetic(["+", "-"], () => this.parseMultiplicative());
  }

  private parseMultiplicative(): Node | null {
    return this.parseArithmetic(["*", "/", "%"], () => this.parseUnary());
  }

  private parseArithmetic(
    operators: string[],
    operand: () => Node | null
  ): Node | null {
    let left = operand();
    if (left === null) return null;
    for (;;) {
      const token = this.peek();
      if (token?.kind !== "punct" || !operators.includes(token.text)) break;
      this.position += 1;
      const right = operand();
      if (right === null) return null;
      left = { kind: "arithmetic", op: token.text, left, right };
    }
    return left;
  }

  private parseUnary(): Node | null {
    if (this.isPunct("-")) {
      this.position += 1;
      const expr = this.parseUnary();
      return expr === null ? null : { kind: "negate", expr };
    }
    if (this.isPunct("+")) {
      this.position += 1;
      return this.parseUnary();
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Node | null {
    let expr = this.parsePrimary();
    if (expr === null) return null;
    while (this.isPunct("::")) {
      this.position += 1;
      const type = this.parseTypeName();
      if (type === null) return null;
      expr = { kind: "cast", expr, type: type.text, base: type.base };
    }
    return expr;
  }

  /**
   * A type name after `::` — one or more words, an optional modifier and any
   * number of array brackets. `base` is the words alone, which is what decides
   * whether the cast is one PostgreSQL inserts by itself.
   */
  private parseTypeName(): { text: string; base: string } | null {
    const first = this.take();
    if (first?.kind !== "word") return null;
    const base = this.parseTypeWords(first.text).join(" ");
    const modifier = this.parseTypeModifier();
    if (modifier === null) return null;
    const arrays = this.parseArraySuffix();
    if (arrays === null) return null;
    return { text: base + modifier + arrays, base };
  }

  /** The first word of a type name and the words that continue it. */
  private parseTypeWords(first: string): string[] {
    const words = [first.toLowerCase()];
    for (;;) {
      const next = this.peek();
      if (next?.kind !== "word") return words;
      if (!TYPE_CONTINUATION.has(next.text.toLowerCase())) return words;
      words.push(next.text.toLowerCase());
      this.position += 1;
    }
  }

  /** A `(n)` or `(p,s)` modifier as written back, or "" when there is none. */
  private parseTypeModifier(): string | null {
    if (!this.expectPunct("(")) return "";
    const sizes: string[] = [];
    for (;;) {
      const size = this.take();
      if (size?.kind !== "number") return null;
      sizes.push(size.text);
      if (this.expectPunct(")")) return `(${sizes.join(",")})`;
      if (!this.expectPunct(",")) return null;
    }
  }

  /** Any number of `[]` array brackets, as written back. */
  private parseArraySuffix(): string | null {
    let suffix = "";
    while (this.expectPunct("[")) {
      if (!this.expectPunct("]")) return null;
      suffix += "[]";
    }
    return suffix;
  }

  private parsePrimary(): Node | null {
    const token = this.take();
    if (token === undefined) return null;
    switch (token.kind) {
      case "number":
        return { kind: "literal", text: token.text, string: false };
      case "string":
        return {
          kind: "literal",
          text: quoteLiteral(token.value),
          string: true,
        };
      case "quoted":
        return { kind: "identifier", text: canonicalIdentifier(token.text) };
      case "punct":
        return this.parseParenthesised(token.text);
      case "word":
        return this.parseWord(token.text);
    }
  }

  /** A parenthesised expression, whose opening punctuation was `open`. */
  private parseParenthesised(open: string): Node | null {
    if (open !== "(") return null;
    const inner = this.parseExpression();
    if (inner === null || !this.expectPunct(")")) return null;
    return inner;
  }

  /** A primary that starts with a word: a constant, ARRAY, a call or a name. */
  private parseWord(word: string): Node | null {
    const upper = word.toUpperCase();
    if (CONSTANT_WORDS.has(upper)) {
      return { kind: "literal", text: upper, string: false };
    }
    if (upper === "ARRAY") return this.parseArray();
    if (RESERVED.has(upper)) return null;
    if (this.expectPunct("(")) return this.parseCall(word);
    // An unquoted name is case-insensitive in all three dialects, so its
    // case carries no meaning; PostgreSQL folds it to lower case.
    return {
      kind: "identifier",
      text: canonicalIdentifier(word.toLowerCase()),
    };
  }

  private parseArray(): Node | null {
    if (!this.expectPunct("[")) return null;
    const items = this.parseList("]");
    return items === null ? null : { kind: "array", items };
  }

  /** A function call, its opening parenthesis already consumed. */
  private parseCall(name: string): Node | null {
    const args = this.parseList(")");
    return args === null
      ? null
      : { kind: "call", name: name.toLowerCase(), args };
  }

  /** A comma-separated list up to `close`, which may be empty. */
  private parseList(close: string): Node[] | null {
    const items: Node[] = [];
    if (this.expectPunct(close)) return items;
    for (;;) {
      const item = this.parseExpression();
      if (item === null) return null;
      items.push(item);
      if (this.expectPunct(close)) return items;
      if (!this.expectPunct(",")) return null;
    }
  }
}

/**
 * An identifier as it would be written with the fewest quotes: bare when that
 * names the same column, double-quoted otherwise. `"status"` and `status` are
 * one column; `"Status"` is a different one in PostgreSQL and keeps its quotes.
 */
function canonicalIdentifier(name: string): string {
  if (/^[a-z_][a-z0-9_$]*$/.test(name) && !RESERVED.has(name.toUpperCase())) {
    return name;
  }
  return `"${name.replace(/"/g, '""')}"`;
}

// =============================================================================
// Canonical rewrites
// =============================================================================

/**
 * Character types. A cast to one of these is how PostgreSQL compares a varchar
 * column with a text value — `(status)::text = 'a'::text` — so it is the
 * server's doing, not the author's.
 */
const CHARACTER_TYPES = new Set([
  "text",
  "character varying",
  "varchar",
  "character",
  "char",
  "bpchar",
  "name",
]);

/**
 * Numeric types, for the one literal PostgreSQL re-quotes: a negative number
 * compared with an integer column reads back as `'-1'::integer`.
 */
const NUMERIC_TYPES = new Set([
  "integer",
  "int",
  "int2",
  "int4",
  "int8",
  "smallint",
  "bigint",
  "numeric",
  "decimal",
  "real",
  "double precision",
  "float4",
  "float8",
]);

function canonical(node: Node): Node {
  return byKind(CANONICALISERS, node);
}

/** The canonical rewrite of each node kind, its children rewritten first. */
const CANONICALISERS: ByKind<Node> = {
  literal: node => node,
  identifier: node => node,
  call: node => ({ ...node, args: node.args.map(canonical) }),
  array: node => ({ ...node, items: node.items.map(canonical) }),
  cast: node => canonicalCast(canonical(node.expr), node),
  negate: canonicalNegate,
  arithmetic: node => ({
    ...node,
    left: canonical(node.left),
    right: canonical(node.right),
  }),
  compare: node => ({
    ...node,
    op: canonicalOperator(node.op),
    left: canonical(node.left),
    right: canonical(node.right),
  }),
  quantified: canonicalQuantified,
  in: node =>
    canonicalIn(node.negated, canonical(node.left), node.items.map(canonical)),
  like: node => ({
    ...node,
    left: canonical(node.left),
    right: canonical(node.right),
  }),
  isNull: node => ({ ...node, expr: canonical(node.expr) }),
  between: canonicalBetween,
  not: node => canonicalNot(canonical(node.expr)),
  logical: canonicalLogical,
};

/** `!=` and `<>` are one operator; `<>` is the standard spelling. */
function canonicalOperator(op: string): string {
  return op === "!=" ? "<>" : op;
}

function canonicalNegate(node: NodeOfKind["negate"]): Node {
  const expr = canonical(node.expr);
  // A negative number is ONE literal, however it was spelled.
  if (expr.kind === "literal" && !expr.string && /^\d|^\./.test(expr.text)) {
    return { kind: "literal", text: `-${expr.text}`, string: false };
  }
  return { kind: "negate", expr };
}

/**
 * The quantified comparisons over a literal array that are list membership,
 * keyed by operator and quantifier, and whether each is the negated form.
 */
const LIST_MEMBERSHIP = new Map<string, boolean>([
  ["= ANY", false],
  ["<> ALL", true],
  ["!= ALL", true],
]);

function canonicalQuantified(node: NodeOfKind["quantified"]): Node {
  const left = canonical(node.left);
  const right = canonical(node.right);
  // PostgreSQL's spelling of IN and NOT IN over a literal list.
  if (right.kind === "array") {
    const negated = LIST_MEMBERSHIP.get(`${node.op} ${node.quantifier}`);
    if (negated !== undefined) return canonicalIn(negated, left, right.items);
  }
  return { ...node, op: canonicalOperator(node.op), left, right };
}

function canonicalBetween(node: NodeOfKind["between"]): Node {
  // PostgreSQL expands BETWEEN at parse time and stores the comparisons.
  const expr = canonical(node.expr);
  const low = canonical(node.low);
  const high = canonical(node.high);
  return canonical(
    node.negated
      ? {
          kind: "logical",
          op: "OR",
          args: [
            { kind: "compare", op: "<", left: expr, right: low },
            { kind: "compare", op: ">", left: expr, right: high },
          ],
        }
      : {
          kind: "logical",
          op: "AND",
          args: [
            { kind: "compare", op: ">=", left: expr, right: low },
            { kind: "compare", op: "<=", left: expr, right: high },
          ],
        }
  );
}

function canonicalLogical(node: NodeOfKind["logical"]): Node {
  // AND and OR are associative, and PostgreSQL flattens a chain into one
  // node while keeping an explicitly parenthesised group nested. Both
  // spellings of the same chain must read alike.
  const args: Node[] = [];
  for (const arg of node.args.map(canonical)) {
    if (arg.kind === "logical" && arg.op === node.op) args.push(...arg.args);
    else args.push(arg);
  }
  return { kind: "logical", op: node.op, args };
}

/** A cast, dropped when PostgreSQL would have inserted it by itself. */
function canonicalCast(
  expr: Node,
  cast: Extract<Node, { kind: "cast" }>
): Node {
  const base = cast.base;
  if (expr.kind === "literal") {
    // `'-1'::integer` is the number -1; any other literal's cast only states
    // the type the column comparison already gives it.
    if (
      expr.string &&
      NUMERIC_TYPES.has(base) &&
      /^'-?(?:\d+(?:\.\d*)?|\.\d+)'$/.test(expr.text)
    ) {
      return { kind: "literal", text: expr.text.slice(1, -1), string: false };
    }
    return expr;
  }
  if (
    expr.kind === "array" &&
    expr.items.every(item => item.kind === "literal")
  ) {
    return expr;
  }
  if (CHARACTER_TYPES.has(base)) return expr;
  return { kind: "cast", expr, type: cast.type, base };
}

/** The comparison each operator's negation is. */
const INVERTED: Record<string, string> = {
  "=": "<>",
  "<>": "=",
  "<": ">=",
  ">=": "<",
  ">": "<=",
  "<=": ">",
};

/**
 * NOT pushed into the predicate it negates, where a predicate has a negated
 * form. MySQL stores `NOT n = 3` as `n <> 3` while PostgreSQL keeps
 * `NOT (n = 3)`, so without this the two spellings of one check never meet.
 *
 * Every rewrite holds under SQL's three-valued logic: where the operand is
 * NULL both sides are NULL, and elsewhere they are the same boolean.
 */
function canonicalNot(expr: Node): Node {
  switch (expr.kind) {
    case "not":
      return expr.expr;
    case "compare": {
      const op = INVERTED[expr.op];
      return op === undefined ? { kind: "not", expr } : { ...expr, op };
    }
    case "in":
    case "like":
    case "isNull":
      return { ...expr, negated: !expr.negated };
    default:
      return { kind: "not", expr };
  }
}

/** IN over a one-element list is an equality; PostgreSQL stores it as one. */
function canonicalIn(negated: boolean, left: Node, items: Node[]): Node {
  if (items.length === 1) {
    return { kind: "compare", op: negated ? "<>" : "=", left, right: items[0] };
  }
  return { kind: "in", negated, left, items };
}

// =============================================================================
// Printing
// =============================================================================

// Binding strength, weakest first. A child is parenthesised exactly when it
// binds more weakly than its position requires, so the output carries the
// parentheses the tree needs and no others.
const OR = 1;
const AND = 2;
const NOT = 3;
const PREDICATE = 4;
const ADDITIVE = 5;
const MULTIPLICATIVE = 6;
const UNARY = 7;
const POSTFIX = 8;
const PRIMARY = 9;

/** How strongly each node kind binds. */
const PRECEDENCE: ByKind<number> = {
  logical: node => (node.op === "OR" ? OR : AND),
  not: () => NOT,
  compare: () => PREDICATE,
  quantified: () => PREDICATE,
  in: () => PREDICATE,
  like: () => PREDICATE,
  isNull: () => PREDICATE,
  between: () => PREDICATE,
  arithmetic: node =>
    node.op === "+" || node.op === "-" ? ADDITIVE : MULTIPLICATIVE,
  negate: () => UNARY,
  cast: () => POSTFIX,
  // A negative literal behaves as a unary minus when something binds to it.
  literal: node => (node.text.startsWith("-") ? UNARY : PRIMARY),
  identifier: () => PRIMARY,
  call: () => PRIMARY,
  array: () => PRIMARY,
};

function precedence(node: Node): number {
  return byKind(PRECEDENCE, node);
}

function print(node: Node, minimum: number): string {
  const text = printBare(node);
  return precedence(node) < minimum ? `(${text})` : text;
}

function printList(items: Node[]): string {
  return items.map(item => print(item, 0)).join(", ");
}

/** Each node kind printed without its own parentheses. */
const PRINTERS: ByKind<string> = {
  literal: node => node.text,
  identifier: node => node.text,
  call: node => `${node.name}(${printList(node.args)})`,
  array: node => `ARRAY[${printList(node.items)}]`,
  cast: node => `${print(node.expr, POSTFIX)}::${node.type}`,
  negate: node => `- ${print(node.expr, UNARY)}`,
  // Left-associative: an equal-strength right operand keeps its
  // parentheses, since `a - (b - c)` is not `a - b - c`.
  arithmetic: node =>
    `${print(node.left, precedence(node))} ${node.op} ${print(node.right, precedence(node) + 1)}`,
  compare: node =>
    `${print(node.left, ADDITIVE)} ${node.op} ${print(node.right, ADDITIVE)}`,
  quantified: node =>
    `${print(node.left, ADDITIVE)} ${node.op} ${node.quantifier} (${print(node.right, 0)})`,
  in: node =>
    `${print(node.left, ADDITIVE)} ${node.negated ? "NOT IN" : "IN"} (${printList(node.items)})`,
  like: node =>
    `${print(node.left, ADDITIVE)} ${node.negated ? "NOT LIKE" : "LIKE"} ${print(node.right, ADDITIVE)}`,
  isNull: node =>
    `${print(node.expr, ADDITIVE)} ${node.negated ? "IS NOT NULL" : "IS NULL"}`,
  // Rewritten into comparisons by `canonical`; printed only if reached
  // some other way, and then in its own spelling.
  between: node =>
    `${print(node.expr, ADDITIVE)} ${node.negated ? "NOT BETWEEN" : "BETWEEN"} ${print(node.low, ADDITIVE)} AND ${print(node.high, ADDITIVE)}`,
  not: node => `NOT ${print(node.expr, NOT)}`,
  logical: node => {
    const strength = node.op === "OR" ? OR : AND;
    return node.args.map(arg => print(arg, strength + 1)).join(` ${node.op} `);
  },
};

function printBare(node: Node): string {
  return byKind(PRINTERS, node);
}
