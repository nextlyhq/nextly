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

/** A block's position and size inside the canvas, in canvas-local pixels. */
export interface BlockBox {
  id: string;
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface CanvasDriver {
  /** Open the canvas on a seeded page and wait until it is interactive. */
  mountTree(fixture: CanvasFixture): Promise<void>;

  /**
   * Centre of a draggable source in the insert panel, in host coordinates.
   *
   * On the driver rather than in the suite because "where a drag starts" is the
   * single most implementation-specific fact about a canvas: the PoC has a
   * library list, v2 has a three-tier inserter. A suite that located it itself
   * could not be retargeted by swapping the driver.
   */
  dragSourceCentre(): Promise<Point>;

  /** A point over the canvas, near its top, in host coordinates. */
  canvasCentre(): Promise<Point>;

  /**
   * Insert a block without dragging: the non-drag path WCAG 2.2 §2.5.7 requires
   * for every drag gesture. On the driver because how it is offered is a canvas
   * decision, while "it must exist" is a requirement of every canvas.
   */
  clickToInsert(): Promise<void>;

  /** Where the pointer was last commanded to, in host coordinates. */
  pointer(): Point;

  /**
   * Whether a drag is currently in flight.
   *
   * Distinguishes "no drag started" from "a drag started and mutated nothing",
   * which a tree-shape check alone cannot tell apart.
   */
  isDragging(): Promise<boolean>;

  /** The canvas frame's top-left in host coordinates. */
  frameOrigin(): Promise<Point>;

  /**
   * The canvas frame's current transform scale, 1 when untransformed.
   *
   * Exposed so a scenario can prove the zoom it asked for was actually
   * applied: a `setZoom` that silently stopped working would otherwise let a
   * scaled test degrade into an unscaled one and still pass.
   */
  frameScale(): Promise<number>;

  /**
   * Whether the editor is still mounted.
   *
   * On the driver because what "the editor" is made of differs per canvas;
   * asking for one canvas's chrome class directly would report a correctly
   * behaving replacement as broken.
   */
  isEditorPresent(): Promise<boolean>;

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

  /** Every block's box in canvas-local pixels, document order, root first. */
  readBlockBoxes(): Promise<BlockBox[]>;

  /** Every drop zone's height in canvas-local pixels, document order. */
  readZoneHeights(): Promise<number[]>;

  /**
   * Ordinal of the drop zone geometrically nearest the current pointer.
   *
   * The exact form of "the indicator is where the pointer is": comparing the
   * ACTIVE ordinal against this one needs no tolerance, and both the stale-rect
   * (#1705) and unscaled-transform (#1706) failures select a zone that is not
   * the nearest, so it catches them without a magic number.
   */
  nearestZoneToPointer(): Promise<number>;

  /** `data-nx-id` of the container owning the active zone, or null. */
  readActiveZoneOwner(): Promise<string | null>;

  /** Scroll the HOST document (not the canvas) during a drag. */
  scrollHost(dy: number): Promise<void>;
  /** Apply a CSS transform scale to the canvas frame. */
  setZoom(scale: number): Promise<void>;
}
