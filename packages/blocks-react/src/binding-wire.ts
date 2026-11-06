/**
 * A page's binding sources, as they travel between a server that read them
 * and an editor's canvas that draws with them.
 *
 * `PageBindings` holds a Map of Singles and a field-shape lookup, which do not
 * survive JSON. The canvas asks its host's server to read its binding sources
 * (as the person editing, through `readBindingSources`), and the answer
 * crosses the wire in this form and is read back into `PageBindings` on the
 * other side, by this one pair of functions, so the two ends cannot disagree
 * about its shape.
 *
 * The field shapes travel as the reads recorded them: every source the read
 * looked up, the relations its paths follow included, and nothing worked out
 * again on the way.
 *
 * @module binding-wire
 */
import type { BindingFieldShape } from "@nextlyhq/blocks-engine";

import type {
  BlocksFieldShapeRef,
  BlocksFieldShapes,
  BlocksSiteSettings,
  PageBindings,
} from "./context";

/** A source's shapes as the read recorded them: `null` for none known. */
type RecordedShapes = readonly BindingFieldShape[] | undefined;

/** The key a source's shapes are kept under: `collection:posts`, `single:home`. */
export function shapeRefKey(ref: BlocksFieldShapeRef): string {
  return "collection" in ref
    ? `collection:${ref.collection}`
    : `single:${ref.single}`;
}

/* The shapes each lookup was made from, so it can be put on the wire. */
const RECORDED = new WeakMap<
  BlocksFieldShapes,
  ReadonlyMap<string, RecordedShapes>
>();

/**
 * A field-shape lookup over the shapes a read recorded, by `shapeRefKey`,
 * which `bindingsToWire` can send whole.
 */
export function recordedFieldShapes(
  known: ReadonlyMap<string, RecordedShapes>
): BlocksFieldShapes {
  const shapes: BlocksFieldShapes = {
    fieldsOf: ref => known.get(shapeRefKey(ref)),
  };
  RECORDED.set(shapes, known);
  return shapes;
}

/**
 * Binding sources in a form JSON carries.
 *
 * @experimental Settles with the editor's binding sources.
 */
export interface WireBindings {
  readonly entry?: Readonly<Record<string, unknown>> | null;
  readonly entryRef?: BlocksFieldShapeRef;
  readonly singles: readonly (readonly [
    string,
    Readonly<Record<string, unknown>> | null,
  ])[];
  readonly site?: BlocksSiteSettings | null;
  readonly timeZone?: string;
  readonly shapes: readonly (readonly [
    string,
    readonly BindingFieldShape[] | null,
  ])[];
}

/**
 * Binding sources as they go on the wire. A lookup that was not recorded by a
 * read (`recordedFieldShapes`) sends no shapes: its bindings are then judged
 * by their values, as for a source whose shapes are unknown.
 *
 * @experimental Settles with the editor's binding sources.
 */
export function bindingsToWire(bindings: PageBindings): WireBindings {
  const recorded =
    bindings.fieldShapes === undefined
      ? undefined
      : RECORDED.get(bindings.fieldShapes);
  return {
    ...(bindings.entry === undefined ? {} : { entry: bindings.entry }),
    ...(bindings.entryRef === undefined ? {} : { entryRef: bindings.entryRef }),
    singles: [...(bindings.singles ?? new Map()).entries()],
    ...(bindings.site === undefined ? {} : { site: bindings.site }),
    ...(bindings.timeZone === undefined ? {} : { timeZone: bindings.timeZone }),
    shapes: [...(recorded ?? new Map()).entries()].map(
      ([key, fields]) => [key, fields ?? null] as const
    ),
  };
}

/**
 * Binding sources read back from the wire, as the renderer takes them.
 *
 * @experimental Settles with the editor's binding sources.
 */
export function bindingsFromWire(wire: WireBindings): PageBindings {
  const known = new Map<string, RecordedShapes>(
    wire.shapes.map(([key, fields]) => [key, fields ?? undefined])
  );
  return {
    ...(wire.entry === undefined ? {} : { entry: wire.entry }),
    ...(wire.entryRef === undefined ? {} : { entryRef: wire.entryRef }),
    singles: new Map(wire.singles),
    ...(wire.site === undefined ? {} : { site: wire.site }),
    ...(wire.timeZone === undefined ? {} : { timeZone: wire.timeZone }),
    fieldShapes: recordedFieldShapes(known),
  };
}
