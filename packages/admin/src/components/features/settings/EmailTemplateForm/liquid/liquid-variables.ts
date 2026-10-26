/**
 * The variables a template reads, as the server's engine parses it.
 *
 * Read from the parsed template rather than its text, so a variable is found
 * however it is written: with filters, inside `if`, `for` and `case`, through
 * bracket access, or with whitespace control. Loop items, `forloop` and names
 * the template `assign`s itself are not variables a sender supplies, and are
 * left out. A use written out with no `| default:` fallback is one that
 * renders blank when the variable has no value.
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
  /** Written with a `| default:` fallback. */
  fallback: boolean;
}

interface OutputRange {
  begin: number;
  end: number;
  fallback: boolean;
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
      outputs.push({
        begin: node.token.begin,
        end: node.token.end,
        fallback: node.value.filters.some(filter => filter.name === "default"),
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

/** Every place `source` reads a variable a sender supplies, in source order. */
export function variableUses(source: string): VariableUse[] {
  if (!source) return [];
  const parsed = parsedTemplate(source);
  if (!parsed) return [];
  const analysis = parsed.engine.analyzeSync(parsed.templates);
  const outputs = outputsOf(parsed.templates);
  const lineStarts = lineStartsOf(source);
  const uses: VariableUse[] = [];
  for (const [root, variables] of Object.entries(analysis.globals)) {
    for (const variable of variables) {
      const at = offsetOf(
        lineStarts,
        variable.location.row,
        variable.location.col
      );
      const output = outputs.find(o => o.begin <= at && at < o.end);
      const steps = variable.segments;
      const literal = steps.every(
        (step): step is string | number =>
          typeof step === "string" || typeof step === "number"
      );
      uses.push({
        path: String(variable),
        root,
        segments: literal ? steps : null,
        from: output ? output.begin : at,
        to: output ? output.end : at + root.length,
        written: output !== undefined,
        fallback: output?.fallback ?? false,
      });
    }
  }
  return uses.sort((a, b) => a.from - b.from);
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

/** The value at `segments` in `data`, as Liquid reads it; undefined when absent. */
export function valueAt(
  data: unknown,
  segments: ReadonlyArray<string | number>
): unknown {
  let value: unknown = data;
  for (const step of segments) {
    if (value === null || value === undefined) return undefined;
    if (Array.isArray(value) && typeof step === "string") {
      // The properties Liquid gives a list.
      if (step === "size") value = value.length;
      else if (step === "first") value = value[0];
      else if (step === "last") value = value[value.length - 1];
      else return undefined;
      continue;
    }
    if (typeof value !== "object") return undefined;
    value = Object.prototype.hasOwnProperty.call(value, step)
      ? (value as Record<string | number, unknown>)[step]
      : undefined;
  }
  return value;
}

/**
 * The uses in `source` that render blank: written out, with no fallback, and
 * no value in `data`. A use reached through a computed step is not judged.
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
      valueAt(data, use.segments) == null
  );
}
