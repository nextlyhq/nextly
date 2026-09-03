/**
 * `core/gallery` — a grid of pictures.
 *
 * A preset over the same implementation `core/box`, `core/section`, `core/card`
 * and the columns pair use, restricted to `core/image` children. It differs
 * from a box in relationships and defaults, never in capabilities, which is the
 * property `container.tsx` argues for: display is a style, so a gallery is a
 * box that starts as a picture grid rather than a second kind of container.
 *
 * **Why this is not `core/columns` with images in it.** A row of columns gives
 * every child an identity to be selected and styled, which is what a layout
 * wants and what a gallery does not: twelve photographs would need twelve
 * column blocks around them, and every one is a node an author has to create,
 * name and keep in step. The pictures ARE the items here, so they sit in the
 * slot directly and the track list is the group's business.
 *
 * The restriction is what makes that safe. `core/image` resolves its picture
 * through the host's media library, so a gallery item carries alt text, an
 * intrinsic size and a caption without the group knowing anything about media.
 * A paragraph dropped into a gallery would be laid out as though it were a
 * photograph, which reads as a broken gallery rather than a misplaced block —
 * so the slot refuses it and the editor can say why.
 *
 * **The track list is `baseStyles`, not a rule in the renderer.**
 * `blocks-react/src/styles.ts` feeds `baseStyles` to `compilePageCss`, so this
 * default is a real stylesheet rule an author overrides on the node like any
 * other. A value hardcoded in the render function could not be overridden at
 * all, which is what makes the difference between a default and a constraint.
 *
 * **`auto-fit` rather than a fixed column count, and the reason is the
 * content.** A gallery holds however many pictures were uploaded, and that
 * number changes without anyone revisiting the layout. A fixed
 * `repeat(3, 1fr)` leaves a row of one on the wrong count and needs a
 * breakpoint for every size; `auto-fit` with a minimum fits as many as the
 * container allows and reflows on its own — including inside a column or a
 * card, where a viewport breakpoint would be measuring the wrong box.
 *
 * The minimum is capped by the available width for the same reason
 * `core/columns` caps its own: at a container narrower than the floor, a bare
 * `minmax(180px, 1fr)` makes a single track wider than its parent and the
 * pictures overflow. `min(180px, 100%)` lets the last one fit.
 *
 * **The gap is the site's spacing token, and there is no aspect ratio.** This
 * block shipped with `{ $token: "space.4" }`, rendered its tiles touching, and
 * spent a while as a plain length because of it: the renderer withheld the
 * token tier from a consumer handing back a stored artifact, so the reference
 * arrived as a `var()` with nothing behind it — invalid at computed-value time,
 * and `gap` falls back to `normal`, zero for a grid. The declaration now reaches
 * that path and resolves to `1rem`, which is the value the literal stood in for,
 * so the gutter follows a site that redefines `space.4`. A default `aspect-ratio` was considered and refused: it
 * would crop every picture in the library to one shape, and the crop is
 * invisible in the editor's own preview because the same rule applies there.
 * Uniform tiles are a real want, so `aspectRatio` stays available on the image
 * through its own supports rather than being imposed by the group.
 *
 * @module blocks/library/gallery
 */
import { defineBlock } from "@nextlyhq/blocks-engine";

import type { PageContext } from "../context";

import { MEDIA } from "./categories";
import { CONTAINER_SUPPORTS, renderContainer } from "./container";
import type { ContainerProps } from "./container";

/** This block's registered name, so its tests name it once. */
export const GALLERY_BLOCK = "core/gallery";

/** The only child a gallery lays out. */
export const GALLERY_ITEM_BLOCK = "core/image";

/**
 * Pictures in a reflowing grid.
 *
 * `display: grid` rather than flex because the catalog has NO flex item
 * properties at all — `flex`, `flexGrow`, `flexShrink` and `flexBasis` are
 * absent, and an absent property is dropped by the compiler without a word. A
 * flex gallery would therefore leave every picture unable to say how it takes
 * space. A grid puts that on the track list, which the group owns and can
 * express.
 */
export const GALLERY_BASE_STYLES = {
  base: {
    base: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))",
      // The site's spacing token. This was a length while nothing declared
      // `--site-*` on every path a reference reaches: the value compiled to a
      // `var()` with nothing behind it and `gap` fell back to `normal`, zero for
      // a grid. Measured on the path that used to fail — a stored artifact
      // handed back with no context — the property is now declared and resolves
      // to `1rem`, the value the literal stood in for.
      gap: { $token: "space.4" },
    },
  },
} as const;

export const gallery = defineBlock<ContainerProps, PageContext>({
  name: GALLERY_BLOCK,
  version: 1,
  description:
    "A reflowing grid of pictures. Restricts its slot to core/image so every item carries alt text and an intrinsic size, and a stray block cannot be laid out as though it were a photograph.",
  // Palette metadata. The category is imported rather than spelled here so
  // nineteen blocks cannot drift into nineteen headings; keywords are what
  // let a search for a word the description never uses still find this.
  editor: {
    label: "Gallery",
    icon: "gallery",
    category: MEDIA,
    keywords: ["images", "photos", "grid", "carousel"],
  },
  props: {
    as: { type: "select", options: ["div", "section", "article"] },
    contained: { type: "checkbox" },
  },
  defaultProps: { as: "div", contained: false },
  example: { props: { as: "div" } },
  // The parent half of the nesting rule, and the ONLY half this pair has.
  // `block.ts` is explicit that a slot naming a type does not confine that type
  // to it — which is exactly right here: `core/image` is a general-purpose
  // block that belongs anywhere, so it must NOT declare `parent: [gallery]`.
  // That asymmetry is the difference between this and the columns pair, where
  // a column has no meaning outside its row.
  slots: {
    children: {
      allow: [GALLERY_ITEM_BLOCK],
      // No `defaultBlock`, and the asymmetry noted above is why. A row and an
      // accordion declare one because their allowed child names them back as
      // its only parent, so the container is unusable until it holds one. A
      // gallery's child is `core/image`, which deliberately declares no parent
      // and is placeable anywhere — so nothing about a gallery makes an image
      // hard to reach.
      //
      // A default would also have to guess a count that nothing here knows: a
      // gallery holds as many images as the author has. And an image with no
      // source is a placeholder awaiting an upload, so seeding two would put
      // two things on the page that must be replaced rather than filled.
    },
  },
  baseStyles: GALLERY_BASE_STYLES,
  supports: CONTAINER_SUPPORTS,
  render: renderContainer,
});
