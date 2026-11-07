/**
 * The rows of the "Bindings to fix" report for one document: each binding that
 * no longer fits what it reads, with the facts an author is shown.
 *
 * Built from the same judgement a save runs (`currentBindingProblems`), every
 * problem counted, held or not, since the report lists what is broken rather
 * than what a write broke. A binding with several problems is one row, its
 * codes listed. Each row says where the binding is (the block, or the
 * document's own metadata), what it reads, what is wrong in the engine's code,
 * and what a visitor sees instead: the binding's fallback, the block's own
 * value, or nothing, for a prop the block no longer has. The wording is the
 * admin's, from these facts, so no sentence written for one screen is stored.
 *
 * @module bindings-report/rows
 */
import {
  DEFAULT_BINDING_SOURCE,
  isPlainRecord,
  type BindingDocument,
  type BindingFieldShape,
  type BindingSchemaRef,
} from "@nextlyhq/blocks-engine";

import {
  currentBindingProblems,
  type DeclaredShapesReader,
  type ReadRef,
} from "../fields/binding-judgement";

/** What a visitor sees where a broken binding is. */
export type BindingReportShows =
  | { readonly kind: "fallback"; readonly value: unknown }
  | { readonly kind: "own"; readonly value: unknown }
  | { readonly kind: "nothing" };

/** One broken binding, as the report lists it. */
export interface BindingReportRow {
  /** The block holding it; empty for the document's own metadata. */
  readonly nodeId: string;
  /** The block's type; empty for the document's own metadata. */
  readonly blockType: string;
  /** The prop it fills, or `seo.<field>` for the document's metadata. */
  readonly prop: string;
  /** What it reads: its source, the Single it names, and its field path. */
  readonly binding: {
    readonly source: string;
    readonly sourceKey?: string;
    readonly path: string;
  };
  /** Each problem, as the engine's binding issue codes name them. */
  readonly codes: readonly string[];
  /** The field the path reaches, where the schema has one. */
  readonly field?: { readonly name: string; readonly type: string };
  readonly shows: BindingReportShows;
}

/** A document's report: its rows, or that it binds too many sources to judge. */
export interface DocumentBindingReport {
  readonly rows: readonly BindingReportRow[];
  readonly overflowed: boolean;
}

/** A JSON pointer's segments, unescaped. */
function segmentsOf(path: string): string[] {
  return path
    .split("/")
    .slice(1)
    .map(token => token.replaceAll("~1", "/").replaceAll("~0", "~"));
}

/** The value a pointer names inside `root`, or `undefined`. */
function at(root: unknown, segments: readonly string[]): unknown {
  let value: unknown = root;
  for (const segment of segments) {
    if (Array.isArray(value)) value = value[Number(segment)];
    else if (isPlainRecord(value)) value = value[segment];
    else return undefined;
  }
  return value;
}

/** The field a binding's path reaches, through groups and one relation. */
function fieldAt(
  segments: readonly string[],
  root: readonly BindingFieldShape[] | undefined,
  fieldsOf: (ref: ReadRef) => readonly BindingFieldShape[] | undefined
): BindingFieldShape | undefined {
  let fields = root;
  for (let index = 0; index < segments.length; index += 1) {
    const field = fields?.find(shape => shape.name === segments[index]);
    if (field === undefined || index === segments.length - 1) return field;
    fields =
      field.fields ??
      (typeof field.relationTo === "string"
        ? fieldsOf({ collection: field.relationTo })
        : undefined);
  }
  return undefined;
}

/** The fields a binding's source declares, as the judgement read them. */
function sourceFields(
  binding: Readonly<Record<string, unknown>>,
  entry: BindingSchemaRef | undefined,
  fieldsOf: (ref: ReadRef) => readonly BindingFieldShape[] | undefined
): readonly BindingFieldShape[] | undefined {
  const source = binding.source ?? DEFAULT_BINDING_SOURCE;
  if (source === "single" && typeof binding.sourceKey === "string") {
    return fieldsOf({ single: binding.sourceKey });
  }
  if (source === "entry" && entry !== undefined) {
    return "collection" in entry || "single" in entry
      ? fieldsOf(entry)
      : undefined;
  }
  return undefined;
}

/**
 * What a visitor sees where a binding with these problems is: nothing for a
 * prop the block no longer has, the fallback while it is valid, else the
 * block's own value.
 */
function showsFor(
  codes: readonly string[],
  binding: Readonly<Record<string, unknown>>,
  own: unknown
): BindingReportShows {
  if (codes.includes("binding-prop-missing")) return { kind: "nothing" };
  if (
    binding.fallback !== undefined &&
    !codes.includes("binding-fallback-invalid")
  ) {
    return { kind: "fallback", value: binding.fallback };
  }
  return { kind: "own", value: own };
}

/** One row, from the problems found at one binding's pointer. */
function rowAt(
  document: BindingDocument,
  path: string,
  nodeId: string,
  codes: readonly string[],
  context: {
    readonly entry: BindingSchemaRef | undefined;
    readonly fieldsOf: (
      ref: ReadRef
    ) => readonly BindingFieldShape[] | undefined;
  }
): BindingReportRow | undefined {
  const segments = segmentsOf(path);
  const binding = at(document, segments);
  if (!isPlainRecord(binding) || typeof binding.$bind !== "string") {
    return undefined;
  }
  const metadata = segments[0] === "settings";
  // A block binding sits at `…/bindings/<prop>`, its node two steps up.
  const prop = metadata
    ? `seo.${segments[2] ?? ""}`
    : (segments[segments.length - 1] ?? "");
  const node = metadata ? undefined : at(document, segments.slice(0, -2));
  const props = isPlainRecord(node) ? node.props : undefined;
  const field = fieldAt(
    binding.$bind.split("."),
    sourceFields(binding, context.entry, context.fieldsOf),
    context.fieldsOf
  );
  return {
    nodeId,
    blockType: isPlainRecord(node) && typeof node.type === "string" ? node.type : "",
    prop,
    binding: {
      source:
        typeof binding.source === "string"
          ? binding.source
          : DEFAULT_BINDING_SOURCE,
      ...(typeof binding.sourceKey === "string"
        ? { sourceKey: binding.sourceKey }
        : {}),
      path: binding.$bind,
    },
    codes,
    ...(field === undefined
      ? {}
      : { field: { name: field.name, type: field.type } }),
    shows: showsFor(
      codes,
      binding,
      isPlainRecord(props) ? props[prop] : undefined
    ),
  };
}

/**
 * The report's rows for one document, judged against the declared fields of
 * what it binds, in document order: a block's bindings, then the document's
 * own metadata.
 */
export async function documentBindingReport(
  document: BindingDocument,
  entry: BindingSchemaRef | undefined,
  site: { readonly shapesOf: DeclaredShapesReader; readonly maxNodes?: number }
): Promise<DocumentBindingReport> {
  const problems = await currentBindingProblems(document, entry, site);
  if (problems.overflowed) return { rows: [], overflowed: true };
  // One row per binding, its codes in the order they were found.
  const byPath = new Map<string, { nodeId: string; codes: string[] }>();
  for (const issue of problems.found) {
    const seen = byPath.get(issue.path);
    if (seen === undefined) {
      byPath.set(issue.path, { nodeId: issue.nodeId, codes: [issue.code] });
    } else if (!seen.codes.includes(issue.code)) {
      seen.codes.push(issue.code);
    }
  }
  const rows: BindingReportRow[] = [];
  for (const [path, { nodeId, codes }] of byPath) {
    const row = rowAt(document, path, nodeId, codes, {
      entry,
      fieldsOf: problems.fieldsOf,
    });
    if (row !== undefined) rows.push(row);
  }
  return { rows, overflowed: false };
}
