/**
 * The vocabulary the canvas acceptance suite speaks. Implementations swap; the
 * suite does not. A behaviour that cannot be expressed here is out of scope for
 * the suite.
 */
export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A seeded page: the entry to open, and the node ids it contains in order. */
export interface CanvasFixture {
  entryId: string;
  blockIds: string[];
}

export interface CanvasDriver {
  /** Open the canvas on a seeded page and wait until it is interactive. */
  mountTree(fixture: CanvasFixture): Promise<void>;

  /** Press the pointer at a top-level viewport point and pass the drag threshold. */
  startDragAt(point: Point): Promise<void>;
  /** Move the pointer by a delta, in one step. */
  moveBy(dx: number, dy: number): Promise<void>;
  drop(): Promise<void>;
  cancel(): Promise<void>;

  /**
   * Move the pointer onto a drop zone by its ordinal, mid-drag.
   *
   * Zones are 0px tall at rest and 6px while dragging, so they cannot be aimed
   * at before the drag starts and cannot be hit by guessing a point. This is
   * the host-point-to-canvas-point mapping in its smallest useful form.
   * Returns false when the ordinal does not exist.
   */
  moveToZone(ordinal: number): Promise<boolean>;

  /** Move the pending insertion point with the keyboard. */
  keyboardInsert(direction: "up" | "down"): Promise<void>;

  /**
   * Ordinal of the active drop zone among ALL drop zones in document order, or
   * -1 when none is active. Ordinal rather than id because the droppable id is
   * not present in the DOM.
   */
  readActiveTarget(): Promise<number>;
  /** Bounding box of the visible insertion indicator, in top-level coordinates. */
  readIndicatorRect(): Promise<Rect | null>;
  /**
   * Node ids in document order, root first. Shape assertions after a drop read
   * this. Ids rather than block types because the canvas emits `data-nx-id` and
   * no type attribute, and identity answers more questions than type does: a
   * reorder is visible in the ids and invisible in a list of types.
   */
  readTreeShape(): Promise<string[]>;

  /** Scroll the HOST document (not the canvas) during a drag. */
  scrollHost(dy: number): Promise<void>;
  /** Apply a CSS transform scale to the canvas frame. */
  setZoom(scale: number): Promise<void>;
}
