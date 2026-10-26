/**
 * The problems that stop a template parsing, found as the author types.
 *
 * Parsed with the same LiquidJS the server renders with, configured as its
 * engine is (`nextly/src/domains/email/services/liquid-engine.ts`): strict
 * filters, own properties only, the same template-size limit, and the same
 * tags and filters removed. A problem here is the one a save would be refused
 * for, at the same line.
 *
 * It is also the admin's one answer to which tags and filters an email can
 * use: completion offers what this engine registers. A test pins that to the
 * server engine's own answer, so a policy change on either side fails there
 * instead of drifting.
 *
 * This module imports LiquidJS, so only the editor (which loads on demand)
 * imports it: the admin's startup never pays for the parser.
 *
 * @module components/features/settings/EmailTemplateForm/liquid/liquid-problems
 */
import { Liquid, type Template } from "liquidjs";

/** A problem in a template, where it is. */
export interface LiquidProblem {
  /** Offsets of the text the problem is about. */
  from: number;
  to: number;
  /** 1-based, as an author counts lines. */
  line: number;
  column: number;
  message: string;
}

/** The server's template-size limit, in characters. */
const PARSE_LIMIT = 500_000;

/**
 * The tags the server's engine removes: they load files, or write a value
 * without escaping it. Every filter marked `raw` goes too.
 */
const REMOVED_TAGS = [
  "include",
  "render",
  "layout",
  "block",
  "echo",
  "liquid",
  "cycle",
];

function makeParser(): Liquid {
  const liquid = new Liquid({
    strictFilters: true,
    strictVariables: false,
    ownPropertyOnly: true,
    parseLimit: PARSE_LIMIT,
  });
  for (const tag of REMOVED_TAGS) delete liquid.tags[tag];
  // A filter marked `raw` makes LiquidJS skip the output escape.
  for (const [name, filter] of Object.entries(liquid.filters)) {
    if (typeof filter === "object" && filter !== null && filter.raw) {
      delete liquid.filters[name];
    }
  }
  return liquid;
}

const parser = makeParser();

/** The tags an author can use, by name, as the server's engine lists them. */
export function liquidTagNames(): string[] {
  return Object.keys(parser.tags).sort();
}

/**
 * The tags LiquidJS has that the engine removed. Not "everything outside
 * `liquidTagNames`": `else`, `elsif` and every `end…` belong to the tag they
 * close, are no tag of their own, and are still written.
 */
export function removedTagNames(): string[] {
  const registered = new Set(Object.keys(parser.tags));
  return Object.keys(new Liquid().tags)
    .filter(name => !registered.has(name))
    .sort();
}

/** The filters an author can use, by name. */
export function liquidFilterNames(): string[] {
  return Object.keys(parser.filters).sort();
}

/** The line and column of an offset, both 1-based. */
function positionOf(source: string, offset: number): [number, number] {
  const before = source.slice(0, offset);
  const line = before.split("\n").length;
  const column = offset - before.lastIndexOf("\n");
  return [line, column];
}

function problemOf(error: unknown, source: string): LiquidProblem {
  const raw = error instanceof Error ? error.message : String(error);
  // LiquidJS appends ", line:N, col:M"; the position is reported on its own.
  const message = raw.replace(/, (file:[^,]*, )?line:\d+, col:\d+$/, "");
  const token = (error as { token?: { begin?: number; end?: number } }).token;
  const clamp = (offset: number) =>
    Math.max(0, Math.min(offset, source.length));
  const from = clamp(token?.begin ?? 0);
  const to = clamp(Math.max(token?.end ?? source.length, from));
  const [line, column] = positionOf(source, from);
  return { from, to, line, column, message };
}

/** What stops `source` parsing, or nothing. LiquidJS stops at the first. */
export function liquidProblems(source: string): LiquidProblem[] {
  if (!source) return [];
  try {
    parser.parse(source);
    return [];
  } catch (error) {
    return [problemOf(error, source)];
  }
}

/**
 * `source` parsed by the engine configured as the server's, with what it was
 * parsed by, for reading what the template uses; nothing when it does not
 * parse (its problem is `liquidProblems`'s to report).
 */
export function parsedTemplate(
  source: string
): { engine: Liquid; templates: Template[] } | null {
  try {
    return { engine: parser, templates: parser.parse(source) };
  } catch {
    return null;
  }
}
