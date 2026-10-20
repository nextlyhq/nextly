/**
 * Liquid for email templates, locked down.
 *
 * Templates are edited by people who may not be trusted with the recipients
 * of every email, so escaping is decided here, once, and an author cannot
 * turn it off:
 *
 * - Every value written into HTML is escaped with the same function the
 *   `{{variable}}` engine used, so existing templates render byte for byte as
 *   before.
 * - No filter that skips escaping is registered (LiquidJS marks such filters
 *   `raw`; every one is removed), and the tags that write a value without
 *   escaping it (`echo`, `liquid`, `cycle`) are removed.
 * - Pre-rendered HTML is written as it is only when the calling code wraps it
 *   with `markHtml`. The mark is a class instance with a private field, which
 *   no value parsed from a request, a form or a database row can be.
 * - Nothing is loaded from a file: `include`, `render`, `layout` and `block`
 *   are removed.
 * - A template's size and the work and memory a render may use are limited,
 *   and an error names the limit it hit.
 *
 * Three contexts: HTML (escaped), plain text, and a single line (plain text
 * with line breaks removed, for a subject or a header).
 */

import {
  CaptureTag as CaptureBlock,
  Drop,
  Liquid,
  Output,
  type Context,
  type Template,
} from "liquidjs";

import { NextlyError } from "../../../errors";

import { escapeHtml, htmlToText } from "./template-engine";

// ============================================================
// Pre-rendered HTML
// ============================================================

/**
 * HTML the calling code vouches for, written into a template unescaped.
 *
 * Nominal: the private field means no object literal is assignable to it, and
 * only `markHtml` constructs one.
 *
 * Inside a template it is its markup as a string: compared, filtered,
 * measured and read as that string is. Only output treats it differently,
 * writing it unescaped.
 *
 * @experimental
 */
export class TrustedHtml extends Drop {
  readonly #html: string;

  private constructor(html: string) {
    super();
    this.#html = html;
  }

  /** @internal Used by `markHtml` only. */
  static of(html: string): TrustedHtml {
    return new TrustedHtml(html);
  }

  /**
   * Whether a value is a mark `markHtml` made. Checked by the private field
   * rather than the prototype: an object made from the prototype, or one that
   * merely copies its shape, carries no field and is not a mark.
   */
  static is(value: unknown): value is TrustedHtml {
    return typeof value === "object" && value !== null && #html in value;
  }

  /** The markup, as given; empty on anything that only borrowed the prototype. */
  get html(): string {
    return TrustedHtml.is(this) ? this.#html : "";
  }

  /** Written as text wherever it is not output into HTML, so it is never lost. */
  toString(): string {
    return this.html;
  }

  /** What Liquid compares and filters. */
  valueOf(): string {
    return this.html;
  }

  /** What Liquid reads a property of, so `size` and `first` are the string's. */
  toLiquid(): string {
    return this.html;
  }

  /** What the `size` filter measures. */
  get length(): number {
    return this.html.length;
  }

  toJSON(): string {
    return this.html;
  }
}

/**
 * Mark pre-rendered HTML so a template writes it unescaped.
 *
 * Only code marks HTML, and only markup that code built itself: a value from
 * a request, a form, a stored row or another plugin must never be passed
 * here, since the mark is what turns escaping off. Anything unmarked is
 * escaped wherever a template writes it.
 *
 * @experimental
 */
export function markHtml(html: string): TrustedHtml {
  return TrustedHtml.of(String(html));
}

// ============================================================
// Limits
// ============================================================

/**
 * The limits a Liquid render works within. Set well above what any template
 * stored before Liquid needs (the largest built-in renders in well under a
 * millisecond and a few kilobytes), so they stop only a runaway template.
 */
export const LIQUID_LIMITS = {
  /** Characters of template parsed at once. */
  parseLimit: 500_000,
  /** Milliseconds a single render may take. */
  renderLimit: 1_000,
  /** Units of memory a render may allocate (strings, arrays, joins). */
  memoryLimit: 20_000_000,
} as const;

const LIMIT_NAMES: Record<string, string> = {
  "parse length": "template size",
  "template render": "render time",
  "memory alloc": "render memory",
};

// ============================================================
// The engines
// ============================================================

/** Tags removed: they load files, or write a value without escaping it. */
const REMOVED_TAGS = [
  "include",
  "render",
  "layout",
  "block",
  "echo",
  "liquid",
  "cycle",
];

/** A value as text, exactly as the `{{variable}}` engine wrote it. */
function asText(value: unknown): string {
  if (value === undefined || value === null) return "";
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- the previous engine wrote String(value); byte-for-byte output depends on it
  return String(value);
}

/** The built-in capture tag, as far as it is extended here. */
type CaptureTag = {
  variable: string;
  render(ctx: Context): Generator<unknown, unknown, unknown>;
};

/**
 * In HTML, what this engine has already escaped is written as it is.
 *
 * `capture` stores its body as rendered, values already escaped, and
 * `escape` / `escape_once` return escaped text; LiquidJS escapes output once
 * more, which showed recipients `&amp;lt;`. Each now hands its result on as
 * marked HTML. A filter applied afterwards drops the mark, as for any marked
 * value, except `default` handing back the marked value it was given.
 */
function writeEscapedOnce(liquid: Liquid): void {
  const Capture = liquid.tags.capture as unknown as new (
    ...args: unknown[]
  ) => CaptureTag;
  class MarkedCapture extends Capture {
    *render(ctx: Context): Generator<unknown, unknown, unknown> {
      yield* super.render(ctx);
      const scope = ctx.bottom() as Record<string, unknown>;
      scope[this.variable] = TrustedHtml.of(asText(scope[this.variable]));
      return undefined;
    }
  }
  liquid.registerTag("capture", MarkedCapture as never);
  for (const name of ["escape", "escape_once"]) {
    const base = liquid.filters[name] as (
      this: unknown,
      value: unknown
    ) => unknown;
    liquid.registerFilter(name, function (this: unknown, value: unknown) {
      return TrustedHtml.of(asText(base.call(this, value)));
    });
  }
  const fallback = liquid.filters.default as (
    this: unknown,
    value: unknown,
    ...args: unknown[]
  ) => unknown;
  liquid.registerFilter(
    "default",
    function (this: unknown, value: unknown, ...args: unknown[]) {
      const result = fallback.call(this, value, ...args);
      return TrustedHtml.is(value) && result === value.html ? value : result;
    }
  );
}

function makeEngine(
  writeOutput: (value: unknown) => string,
  html = false
): Liquid {
  const liquid = new Liquid({
    outputEscape: writeOutput,
    strictFilters: true,
    strictVariables: false,
    ownPropertyOnly: true,
    ...LIQUID_LIMITS,
  });
  for (const tag of REMOVED_TAGS) delete liquid.tags[tag];
  // A filter marked `raw` makes LiquidJS skip the output escape, so none may
  // remain. Removed, not replaced: an author using one is told the filter
  // does not exist rather than getting something that looks like it works.
  for (const [name, filter] of Object.entries(liquid.filters)) {
    if (typeof filter === "object" && filter !== null && filter.raw) {
      delete liquid.filters[name];
    }
  }
  if (html) writeEscapedOnce(liquid);
  return liquid;
}

const ENGINES = {
  html: makeEngine(
    value => (TrustedHtml.is(value) ? value.html : escapeHtml(asText(value))),
    true
  ),
  text: makeEngine(value =>
    TrustedHtml.is(value) ? htmlToText(value.html) : asText(value)
  ),
};

export type LiquidContext = "html" | "text" | "line";

/** The filters an author can use, by name: what is registered, nothing else. */
export function liquidFilterNames(): string[] {
  return Object.keys(ENGINES.html.filters).sort();
}

/** The tags an author can use, by name. */
export function liquidTagNames(): string[] {
  return Object.keys(ENGINES.html.tags).sort();
}

// ============================================================
// Errors
// ============================================================

/** A problem in a template, with where it is. */
export interface LiquidProblem {
  /** 1-based line, when the engine reported one. */
  line: number | null;
  column: number | null;
  message: string;
}

interface PositionedToken {
  getPosition(): [number, number];
}

function hasPosition(value: unknown): value is { token: PositionedToken } {
  if (typeof value !== "object" || value === null || !("token" in value))
    return false;
  const token: unknown = value.token;
  return (
    typeof token === "object" &&
    token !== null &&
    typeof (token as { getPosition?: unknown }).getPosition === "function"
  );
}

/** The limit a LiquidJS error hit, by the name a person would use, or null. */
export function limitHit(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  const match =
    /(parse length|template render|memory alloc) limit exceeded/.exec(message);
  return match ? (LIMIT_NAMES[match[1]] ?? match[1]) : null;
}

/** A LiquidJS error as a problem a person can act on. */
export function toLiquidProblem(error: unknown): LiquidProblem {
  const raw = error instanceof Error ? error.message : String(error);
  // LiquidJS appends ", line:N, col:M"; the position is reported separately.
  const message = raw.replace(/, (file:[^,]*, )?line:\d+, col:\d+$/, "");
  const [line, column] = hasPosition(error)
    ? error.token.getPosition()
    : [null, null];
  const limit = limitHit(error);
  return {
    line,
    column,
    message: limit ? `The template went past its ${limit} limit.` : message,
  };
}

// ============================================================
// Parse and render
// ============================================================

/** Parse a template, or return the problem that stops it parsing. */
export function parseLiquid(
  source: string,
  context: LiquidContext = "html"
): { template: Template[] } | { problem: LiquidProblem } {
  try {
    return {
      template: ENGINES[context === "html" ? "html" : "text"].parse(source),
    };
  } catch (error) {
    return { problem: toLiquidProblem(error) };
  }
}

/** The templates a block tag renders in place: its branches, body and else. */
function blockChildren(node: Template): Template[] {
  // A capture stores what it renders instead of writing it.
  if (node instanceof CaptureBlock) return [];
  const block = node as {
    templates?: Template[];
    elseTemplates?: Template[];
    branches?: Array<{ templates?: Template[] }>;
  };
  return [
    ...(block.templates ?? []),
    ...(block.elseTemplates ?? []),
    ...(block.branches ?? []).flatMap(branch => branch.templates ?? []),
  ];
}

/**
 * Whether `output` (an output tag such as `{{content}}`) is written where
 * Liquid writes output: at the top level or in a block that renders in place,
 * not inside `raw`, `comment` or `capture`, nor quoted in a tag's argument.
 */
export function writesOutput(source: string, output: string): boolean {
  const parsed = parseLiquid(source);
  if ("problem" in parsed) return false;
  const pending = [...parsed.template];
  for (let node = pending.pop(); node; node = pending.pop()) {
    if (node instanceof Output && node.token.getText() === output) return true;
    pending.push(...blockChildren(node));
  }
  return false;
}

/**
 * Render a template in one of the three contexts.
 *
 * @throws NextlyError when the template does not parse or the render fails;
 *   its log context carries the line and whether a limit was hit.
 */
export function renderLiquid(
  source: string,
  data: Record<string, unknown>,
  context: LiquidContext
): string {
  const engine = ENGINES[context === "html" ? "html" : "text"];
  let out: string;
  try {
    out = String(engine.parseAndRenderSync(source, data));
  } catch (error) {
    throw liquidRenderError(error);
  }
  // A subject or header carries no line breaks, whatever the data held.
  return context === "line" ? out.replace(/[\r\n]+/g, " ") : out;
}

/** The error a template that cannot be rendered fails with. Retrying cannot fix it. */
export function liquidRenderError(error: unknown): NextlyError {
  const problem = toLiquidProblem(error);
  return new NextlyError({
    code: "BUSINESS_RULE_VIOLATION",
    publicMessage:
      problem.line !== null
        ? `The email template couldn't be rendered: line ${problem.line}: ${problem.message}`
        : `The email template couldn't be rendered: ${problem.message}`,
    logContext: {
      reason: "email-template-render",
      retryable: false,
      line: problem.line,
      column: problem.column,
      limit: limitHit(error),
    },
    cause: error instanceof Error ? error : undefined,
  });
}
