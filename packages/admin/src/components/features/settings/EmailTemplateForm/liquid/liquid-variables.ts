/**
 * The variables a template reads, as the server's engine parses it.
 *
 * Read from the parsed template rather than its text, so a variable is found
 * however it is written: with filters, inside `if`, `for` and `case`, through
 * bracket access, or with whitespace control. Loop items, `forloop` and names
 * the template `assign`s itself are not variables a sender supplies, and are
 * left out. A use written out with no `| default:` fallback that answers is
 * one that renders blank when the variable has no value: a literal fallback
 * always answers, and a variable one answers with its own value.
 *
 * This module imports LiquidJS (through `liquid-problems`), so only the
 * editor's lazy chunk loads it.
 *
 * @module components/features/settings/EmailTemplateForm/liquid/liquid-variables
 */
import { Output, type Template } from "liquidjs";

import { parsedTemplate } from "./liquid-problems";

/** One place a template reads a variable. */
export interface VariableUse {
  /** The variable as written, for example `order.lines` or `items[0].sku`. */
  path: string;
  /** Its top-level name, the one a declaration names. */
  root: string;
  /** The literal steps from the root, or null when a step is computed. */
  segments: Array<string | number> | null;
  /** Offsets of what to mark: the whole `{{ … }}` when it is written out. */
  from: number;
  to: number;
  /** Written out by an output tag, rather than only tested in a tag. */
  written: boolean;
  /**
   * Not judged blank: written as a `| default:` argument, or beside a
   * fallback that always renders — a literal, or one whose value cannot be
   * read.
   */
  fallback: boolean;
  /**
   * The `| default:` arguments that are variables, judged with the use: it
   * renders blank only when it and every one of them has no value.
   */
  fallbackSegments?: ReadonlyArray<ReadonlyArray<string | number>>;
}

interface OutputRange {
  begin: number;
  end: number;
  hasDefault: boolean;
  /** The default filters' arguments' token ranges, literals and variables. */
  defaultArgs: Array<{ begin: number; end: number }>;
}

/** The templates a block tag renders: its branches, body and else. */
function blockChildren(node: Template): Template[] {
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

function outputsOf(templates: Template[]): OutputRange[] {
  const outputs: OutputRange[] = [];
  const pending = [...templates];
  for (let node = pending.pop(); node; node = pending.pop()) {
    if (node instanceof Output) {
      const defaults = node.value.filters.filter(
        filter => filter.name === "default"
      );
      outputs.push({
        begin: node.token.begin,
        end: node.token.end,
        hasDefault: defaults.length > 0,
        defaultArgs: defaults.flatMap(filter =>
          (filter.args ?? []).map(arg => ({
            begin: arg.begin,
            end: arg.end,
          }))
        ),
      });
    }
    pending.push(...blockChildren(node));
  }
  return outputs;
}

/** The offset of a 1-based row and column. */
function offsetOf(lineStarts: number[], row: number, col: number): number {
  return (lineStarts[row - 1] ?? 0) + col - 1;
}

function lineStartsOf(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

/** A use while its output's defaults are still being gathered. */
interface PendingUse extends VariableUse {
  /** Where the use's own name begins, inside any output it is written in. */
  at: number;
  outputIndex: number | null;
  /** Written inside a `| default:` argument of its output. */
  inDefaultArg: boolean;
}

/** Every place `source` reads a variable a sender supplies, in source order. */
export function variableUses(source: string): VariableUse[] {
  if (!source) return [];
  const parsed = parsedTemplate(source);
  if (!parsed) return [];
  const analysis = parsed.engine.analyzeSync(parsed.templates);
  const outputs = outputsOf(parsed.templates);
  const lineStarts = lineStartsOf(source);
  const pending: PendingUse[] = [];
  for (const [root, variables] of Object.entries(analysis.globals)) {
    for (const variable of variables) {
      const at = offsetOf(
        lineStarts,
        variable.location.row,
        variable.location.col
      );
      const outputIndex = outputs.findIndex(o => o.begin <= at && at < o.end);
      const output = outputIndex === -1 ? undefined : outputs[outputIndex];
      const inDefaultArg = output?.defaultArgs.some(
        range => range.begin <= at && at < range.end
      );
      const steps = variable.segments;
      const literal = steps.every(
        (step): step is string | number =>
          typeof step === "string" || typeof step === "number"
      );
      pending.push({
        path: String(variable),
        root,
        segments: literal ? steps : null,
        from: output ? output.begin : at,
        to: output ? output.end : at + root.length,
        written: output !== undefined,
        fallback: inDefaultArg,
        at,
        outputIndex: outputIndex === -1 ? null : outputIndex,
        inDefaultArg: inDefaultArg ?? false,
      });
    }
  }
  return judged(pending, outputs).sort((a, b) => a.from - b.from);
}

/**
 * Read each output's defaults against its uses: a default argument written as
 * a variable is judged with the use it serves, and one written as anything
 * else — a literal, or a bare `| default` — always renders. A fallback whose
 * steps are computed cannot be read, so the use is not judged either.
 */
function judged(pending: PendingUse[], outputs: OutputRange[]): VariableUse[] {
  for (const [index, output] of outputs.entries()) {
    if (!output.hasDefault) continue;
    const mine = pending.filter(use => use.outputIndex === index);
    const argUses = mine.filter(use => use.inDefaultArg);
    const alwaysRenders =
      output.defaultArgs.length === 0 ||
      output.defaultArgs.some(
        range =>
          !argUses.some(use => range.begin <= use.at && use.at < range.end)
      ) ||
      argUses.some(use => use.segments === null);
    for (const use of mine) {
      if (use.inDefaultArg) {
        use.fallback = true;
        continue;
      }
      if (alwaysRenders) {
        use.fallback = true;
        continue;
      }
      use.fallbackSegments = argUses.map(use => use.segments);
    }
  }
  return pending;
}

/** The variables `sources` read, each once, in the order first read. */
export function usedVariables(sources: readonly string[]): VariableUse[] {
  const seen = new Set<string>();
  const used: VariableUse[] = [];
  for (const source of sources) {
    for (const use of variableUses(source)) {
      if (seen.has(use.path)) continue;
      seen.add(use.path);
      used.push(use);
    }
  }
  return used;
}

/** The properties Liquid gives a list. */
function listProperty(list: unknown[], step: string): unknown {
  if (step === "size") return list.length;
  if (step === "first") return list[0];
  if (step === "last") return list[list.length - 1];
  return undefined;
}

/** One step into `value`, as Liquid takes it; undefined when absent. */
function stepInto(value: unknown, step: string | number): unknown {
  if (value === null || typeof value !== "object") return undefined;
  if (Array.isArray(value) && typeof step === "string") {
    return listProperty(value, step);
  }
  return Object.prototype.hasOwnProperty.call(value, step)
    ? (value as Record<string | number, unknown>)[step]
    : undefined;
}

/** The value at `segments` in `data`, as Liquid reads it; undefined when absent. */
export function valueAt(
  data: unknown,
  segments: ReadonlyArray<string | number>
): unknown {
  let value: unknown = data;
  for (const step of segments) value = stepInto(value, step);
  return value;
}

/**
 * The uses in `source` that render blank: written out, with no fallback that
 * answers, and no value in `data`. A use reached through a computed step is
 * not judged, and neither is one whose fallback's steps are computed.
 */
export function missingValues(
  source: string,
  data: Record<string, unknown>,
  ignore: ReadonlySet<string> = new Set()
): VariableUse[] {
  return variableUses(source).filter(
    use =>
      use.written &&
      !use.fallback &&
      use.segments !== null &&
      !ignore.has(use.root) &&
      valueAt(data, use.segments) == null &&
      (use.fallbackSegments ?? []).every(
        segments => valueAt(data, segments) == null
      )
  );
}
