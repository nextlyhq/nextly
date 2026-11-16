import * as React from "react";

import { cn } from "../lib/utils";

/**
 * One icon an icon source can draw.
 *
 * @experimental
 */
export interface IconSourceIcon {
  /** The id a field stores, `<set>:<name>`: `lucide:star`. */
  readonly id: string;
  /** Its name within its set: `star`, `circle-arrow-up`. */
  readonly name: string;
  /**
   * The SVG's inner markup, as a flat run of self-closing shape elements:
   * `path`, `circle`, `ellipse`, `line`, `polygon`, `polyline` and `rect`,
   * carrying only their geometry attributes and a `fill` of `none` or
   * `currentColor`.
   *
   * Never inserted as HTML. {@link IconGlyph} reads the markup into React
   * elements and draws a body of any other shape as nothing at all, so a body
   * holding a script, an event attribute or a nested element draws an empty
   * box rather than reaching the page.
   */
  readonly body: string;
  /** The box the body is drawn in: `0 0 24 24`. */
  readonly viewBox: string;
  /**
   * Drawn by its stroke in the text colour, as Lucide's icons are, rather than
   * by its fill. Stroked unless this is `false`.
   */
  readonly stroked?: boolean;
  /** The words the icon is found by in a search, shown beside it. */
  readonly tags?: readonly string[];
}

/**
 * Where an icon picker gets its icons: one icon set, searched and resolved.
 *
 * An interface rather than data, so this package carries no icons of its own.
 * The host supplies the set, typically by loading it on demand, and decides
 * how a search ranks its matches.
 *
 * @experimental
 */
export interface IconSource {
  /** The set prefix every id from this source carries: `lucide`. */
  readonly prefix: string;
  /** The set's name as a person reads it: `Lucide`. */
  readonly label: string;
  /**
   * The icons matching a query, best match first. An empty query lists the
   * whole set, in the order a person should browse it.
   */
  search(query: string): Promise<readonly IconSourceIcon[]>;
  /**
   * One icon by id, or `null` when the set does not draw it. An id the set has
   * since renamed resolves to the icon it now is.
   */
  resolve(id: string): Promise<IconSourceIcon | null>;
}

/** The shape elements a body may contain. */
const SHAPES: ReadonlySet<string> = new Set([
  "path",
  "circle",
  "ellipse",
  "line",
  "polygon",
  "polyline",
  "rect",
]);

/** The attributes a shape may carry: geometry, and its fill. */
const GEOMETRY: ReadonlySet<string> = new Set([
  "d",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x",
  "y",
  "x1",
  "x2",
  "y1",
  "y2",
  "width",
  "height",
  "points",
  "fill",
]);

/** The fills a shape may name: none, or the text colour. */
const FILLS: ReadonlySet<string> = new Set(["none", "currentColor"]);

interface Shape {
  readonly tag: string;
  readonly attributes: Readonly<Record<string, string>>;
}

/**
 * Read bodies, by body. A picker draws the same few hundred icons on every
 * scroll, and reading each once is what keeps a scroll from re-reading them.
 * Bounded so a host searching several large sets cannot grow it without end.
 */
const readBodies = new Map<string, readonly Shape[] | null>();
const READ_BODIES_LIMIT = 4096;

/** One element and the attributes after its name, anchored where the last one ended. */
const ELEMENT = /\s*<([a-z]+)((?:\s+[a-zA-Z0-9-]+="[^"<>]*")*)\s*\/>/y;
const ATTRIBUTE = /([a-zA-Z0-9-]+)="([^"<>]*)"/g;

/** A shape's attributes, or `null` when any is not allowed geometry. */
function readAttributes(text: string): Record<string, string> | null {
  const attributes: Record<string, string> = {};
  for (const [, name = "", value = ""] of text.matchAll(ATTRIBUTE)) {
    const allowed = GEOMETRY.has(name) && (name !== "fill" || FILLS.has(value));
    if (!allowed) return null;
    attributes[name] = value;
  }
  return attributes;
}

/** The shape at `at` and where it ends, or `null` when none starts there. */
function readShape(
  body: string,
  at: number
): { shape: Shape; end: number } | null {
  ELEMENT.lastIndex = at;
  const match = ELEMENT.exec(body);
  const tag = match?.[1];
  if (match === null || tag === undefined || !SHAPES.has(tag)) return null;
  const attributes = readAttributes(match[2] ?? "");
  return attributes === null
    ? null
    : { shape: { tag, attributes }, end: ELEMENT.lastIndex };
}

/**
 * A body read as shapes, or `null` when any part of it is not one: every
 * element must be an allowed shape, every attribute allowed geometry, and
 * nothing may sit between the elements but whitespace.
 */
function readBody(body: string): readonly Shape[] | null {
  const cached = readBodies.get(body);
  if (cached !== undefined) return cached;
  let shapes: Shape[] | null = [];
  let at = 0;
  while (shapes !== null && body.slice(at).trim() !== "") {
    const read = readShape(body, at);
    if (read === null) shapes = null;
    else {
      shapes.push(read.shape);
      at = read.end;
    }
  }
  if (readBodies.size >= READ_BODIES_LIMIT) readBodies.clear();
  readBodies.set(body, shapes);
  return shapes;
}

/**
 * Props for IconGlyph.
 *
 * @experimental
 */
export interface IconGlyphProps
  extends Omit<
    React.SVGProps<SVGSVGElement>,
    "children" | "viewBox" | "dangerouslySetInnerHTML"
  > {
  /** The icon to draw. Only its body, box and stroke are read. */
  icon: Pick<IconSourceIcon, "body" | "viewBox" | "stroked">;
}

/**
 * An icon from an {@link IconSource}, drawn as an inline SVG in the text
 * colour.
 *
 * Decorative by default (`aria-hidden`): the control around it names the
 * icon. The body is read into React elements rather than inserted as markup,
 * and a body that is not a run of plain shapes draws an empty box.
 *
 * @experimental
 */
export function IconGlyph({
  icon,
  className,
  ...props
}: IconGlyphProps): React.JSX.Element {
  const shapes = readBody(icon.body) ?? [];
  const stroked = icon.stroked !== false;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={icon.viewBox}
      aria-hidden="true"
      focusable="false"
      fill={stroked ? "none" : "currentColor"}
      stroke={stroked ? "currentColor" : "none"}
      strokeWidth={stroked ? 2 : undefined}
      strokeLinecap={stroked ? "round" : undefined}
      strokeLinejoin={stroked ? "round" : undefined}
      className={cn("size-4 shrink-0", className)}
      {...props}
    >
      {shapes.map((shape, index) =>
        React.createElement(shape.tag, { key: index, ...shape.attributes })
      )}
    </svg>
  );
}

/**
 * An icon's name as a person reads it: `circle-arrow-up` is
 * `Circle arrow up`.
 */
export function iconDisplayName(name: string): string {
  const words = name.replace(/-/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
