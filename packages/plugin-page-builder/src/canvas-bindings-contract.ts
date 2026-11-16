/**
 * What the canvas bindings route takes and answers, named where both ends can
 * read it.
 *
 * The editor's canvas draws a block's bound props with the values the person
 * editing could see in the admin: the entry being edited, the Singles it
 * binds and the site settings. It works out what its bindings read from the
 * document it draws (`bindingDemand`) and sends only that; the route reads
 * those sources as the caller and answers them in the form that crosses the
 * wire (`WireBindings`).
 *
 * FREE OF RUNTIME IMPORTS, for the reason `library-contract.ts` gives.
 *
 * @module canvas-bindings-contract
 */
import type { BindingDemand, ConditionDemand } from "@nextlyhq/blocks-engine";
import type { WireBindings } from "@nextlyhq/blocks-react";

/** What one source is read for, as the engine states it. */
type SourceDemand = NonNullable<BindingDemand["entry"]>;

/** Where the canvas reads its binding sources, under this plugin's namespace. */
export const CANVAS_BINDINGS_ROUTE_PATH = "/canvas-bindings";

/** What one source is read for, as JSON carries it. */
export interface CanvasSourceDemand {
  readonly fields: readonly string[];
  readonly follows: Readonly<Record<string, readonly string[]>>;
}

/** What the canvas asks: the page's own entry, and what its bindings read. */
export interface CanvasBindingsRequest {
  /** The entry the document being edited belongs to. */
  readonly source: {
    readonly kind: "collection" | "single";
    readonly slug: string;
    /** The entry's id, for a collection's entry. */
    readonly id?: string;
  };
  readonly demand: {
    readonly entry?: CanvasSourceDemand;
    readonly singles: Readonly<Record<string, CanvasSourceDemand>>;
    readonly site: boolean;
    readonly formatsDates: boolean;
  };
  /**
   * The collections the page's lists draw. Their public field shapes are read
   * and sent back, so a list item's binding to a field visitors may not read
   * falls back on the canvas as it does on the published page.
   */
  readonly lists: readonly string[];
  /** The language being edited. */
  readonly locale?: string;
  /**
   * What the page's visibility conditions read, read in the same read of
   * the entry as its bindings', as the published page reads them: the
   * editor's read meter asks it, so the conditions are judged as they are
   * there.
   */
  readonly conditions?: CanvasConditionDemand;
  /**
   * The reads the page has left when its bindings are read, so they are read
   * under the allowance the published page reads them under; the default
   * allowance when absent.
   */
  readonly allowance?: number;
}

/** What a page's conditions read, as JSON carries it. */
export interface CanvasConditionDemand {
  readonly any: boolean;
  readonly entryFields: readonly string[];
  readonly ordersValues: boolean;
}

/** What the conditions read, as the meter sends it. */
export function conditionsToWire(
  conditions: ConditionDemand
): CanvasConditionDemand {
  return {
    any: conditions.any,
    entryFields: [...conditions.entryFields].sort(),
    ordersValues: conditions.ordersValues,
  };
}

/** What the conditions read, as the route reads it back. */
export function conditionsFromWire(
  wire: CanvasConditionDemand
): ConditionDemand {
  return {
    any: wire.any,
    entryFields: new Set(wire.entryFields),
    ordersValues: wire.ordersValues,
  };
}

/** What the route answers: the sources, read as the caller. */
export type CanvasBindingsResponse = WireBindings;

/** One source's demand as JSON carries it. */
function sourceToWire(demand: SourceDemand): CanvasSourceDemand {
  return {
    fields: [...demand.fields],
    follows: Object.fromEntries(
      [...demand.follows.entries()].map(([name, fields]) => [name, [...fields]])
    ),
  };
}

/** One source's demand read back from JSON. */
function sourceFromWire(demand: CanvasSourceDemand): SourceDemand {
  return {
    fields: [...demand.fields],
    follows: new Map(
      Object.entries(demand.follows).map(([name, fields]) => [
        name,
        [...fields],
      ])
    ),
  };
}

/** What the bindings read, as the canvas sends it. */
export function demandToWire(
  demand: BindingDemand
): CanvasBindingsRequest["demand"] {
  return {
    ...(demand.entry === undefined
      ? {}
      : { entry: sourceToWire(demand.entry) }),
    singles: Object.fromEntries(
      [...demand.singles.entries()].map(([slug, wanted]) => [
        slug,
        sourceToWire(wanted),
      ])
    ),
    site: demand.site,
    formatsDates: demand.formatsDates,
  };
}

/**
 * What the bindings read, as the route reads it back. `any` is true: the
 * canvas asks only when its document holds a binding.
 */
export function demandFromWire(
  wire: CanvasBindingsRequest["demand"]
): BindingDemand {
  return {
    any: true,
    ...(wire.entry === undefined ? {} : { entry: sourceFromWire(wire.entry) }),
    singles: new Map(
      Object.entries(wire.singles).map(([slug, wanted]) => [
        slug,
        sourceFromWire(wanted),
      ])
    ),
    site: wire.site,
    formatsDates: wire.formatsDates,
  };
}
