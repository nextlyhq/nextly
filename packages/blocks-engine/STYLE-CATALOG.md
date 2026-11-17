# Style-property catalog

The catalog is the closed-but-extensible set of keys legal inside a document's
`StyleValues`. Every key declares the shape of its stored value, the CSS it
emits, and the design-token kinds it accepts.

It is data, not code. Validation walks it, the compiler emits from it, an editor
derives its controls from it, and this page is checked against it by test — so
all four agree by construction rather than by anyone remembering to update them
together.

> **Experimental.** The catalog is frozen jointly with the block API. Until that
> freeze, entries may still change.

## Storage keys are logical, not physical

A value says _"the edge where text starts"_, not _"the left edge"_. One document
then renders correctly in both writing directions with no per-locale style fork,
which is the whole reason for the choice.

Editors show physical labels — "Left", "Right" — mapped by the canvas's writing
direction, so the logical vocabulary never reaches users.

Box sides are `blockStart`, `blockEnd`, `inlineStart`, `inlineEnd`. Corners are
`startStart`, `startEnd`, `endStart`, `endEnd`. Alignment values are `start` and
`end`, never `left` and `right`.

**Sizing stays physical.** `width` and `height` mean the same thing in every
writing direction, so there is nothing to flip. Logical sizing matters only for
vertical writing modes, which the catalog can add later without a migration.

## Value shapes

- **keyword** — one of a closed set the catalog lists. The set is ours, so it
  stays current with the CSS we intend to support.
- **dimension** — a measurement: a length or percentage string (`"16px"`,
  `"2rem"`, `"50%"`) in any CSS length unit, a function that resolves to one
  (`"clamp(1rem, 5vw, 3rem)"`, `"var(--site-space-4)"`), a sizing keyword such as
  `auto` or `max-content` **where that property accepts one**, or the number `0`.
  Keywords are per property, because they are not interchangeable: `margin: auto`
  centres a box while `padding: auto` means nothing. Values that are valid CSS
  but measure nothing are refused, including `"10"`, `"red"`, units that
  measure something else such as `"20deg"` or `"2s"`, and an expression built
  only out of bare numbers such as `"calc(1)"` — they would emit a
  declaration the browser discards. `line-height` is the one property where a
  bare number IS the measurement, and it says so. A few properties take more than
  one measurement — `gap` takes a row and a column — but most take exactly one,
  and a corner radius is expressed per corner rather than as a shorthand.
- **number** — a unitless number, bounded where the property has natural limits.
- **color** — a colour: a hex literal, one of the CSS named colours, a keyword
  such as `currentColor` or `transparent`, or a colour function including
  `oklch()`, `color-mix()` and `light-dark()`. Values that are valid CSS but not
  colours, such as `"16px"`, are refused, as is a colour carrying a stray
  operator such as `"red,"`, which the browser discards whole.
- **css value** — a free-form CSS value, checked for syntax and safety but not
  against a property grammar (see below).
- **url** — a URL emitted inside `url()`, with its scheme checked and the same
  length cap every other value is held to. A url leaf may also name keywords it
  takes in place of a URL: `background.url` accepts `none`, which is what clears
  an image set at an earlier state and has to be emitted bare rather than
  wrapped.
- **composite** — an object whose named parts each have their own shape, such as
  logical box sides, logical corners, or a structured `border`.
- **union** — a value accepted in more than one shape, such as a corner radius
  given either as one scalar or as four corners.

Anywhere a shape's leaf declares token kinds, a design-token reference
`{ "$token": "color.primary" }` may be stored instead of a literal.

## Token kinds

The token vocabulary is the subset of W3C DTCG `$type` values supported here:
`color`, `dimension`, `fontFamily`, `fontWeight`, `number`, `shadow`,
`duration`, and `custom`. Keeping it a subset rather than a parallel vocabulary
is what makes DTCG import and export lossless.

## Supports

A catalog group and a block's `supports` key are the same thing named twice. A
block declaring `supports: { spacing: true }` may set every property in the
spacing group.

Where a group lists flags, the object form opts in precisely:
`supports: { border: { radius: true } }` allows corner rounding and no border
lines, and `{ border: { outline: true } }` an outline alone. Properties with no flag are reachable only through the `true` form, which
is how a group states that it offers nothing finer than all-or-nothing.

`supports` decides what an EDITOR offers and what a block promises to render.
Document validation does not enforce it: it checks a property against the
catalog, not against the block that owns the node. Validation is given a block
lookup that answers whether a type is registered and nothing more, so a block's
declaration is not reachable there. Enforcing it would also mean a block
narrowing its `supports` invalidates every stored document that styled through
the wider declaration, which is a migration rather than a check.

## The properties

**Applies when** says where a property has an effect, as the catalog records it
(`appliesWhen`): `always` on any box; `flex-container`, `grid-container` or
`flex-or-grid-container` on a block that lays its children out that way;
`wrapping-flex-or-grid` on a grid, or a flex container whose children wrap;
`block-container` on a box whose children lay out in block flow;
`flex-child`, `grid-child` or `flex-or-grid-child` on a block whose parent is
that kind of container; `positioned` on a block whose position is not `static`;
`replaced` on an image, a video or an embed. A property listing several applies
wherever any one holds, and a composite can answer per field. Ask
`applies(property, context)` rather than reading the record: it is the one
place that also treats what it cannot read about a block as applying.

The flex and grid child properties sit in `dimensions`, so every block that has
a size can take its share of a Row or a Grid without declaring anything more.

### spacing

| Property  | Flag      | Value                          | Tokens    | Emits                                        | Applies when |
| --------- | --------- | ------------------------------ | --------- | -------------------------------------------- | ------------ |
| `margin`  | `margin`  | logical box sides of dimension | dimension | `margin-block-start` … `margin-inline-end`   | always       |
| `padding` | `padding` | logical box sides of dimension | dimension | `padding-block-start` … `padding-inline-end` | always       |

### layout

| Property              | Flag | Value                                         | Tokens    | Emits                   | Applies when                           |
| --------------------- | ---- | --------------------------------------------- | --------- | ----------------------- | -------------------------------------- |
| `boxSizing`           |      | keyword (`content-box`/`border-box`)          |           | `box-sizing`            | always                                 |
| `display`             |      | keyword                                       |           | `display`               | always                                 |
| `flexDirection`       |      | keyword                                       |           | `flex-direction`        | flex-container                         |
| `flexWrap`            |      | keyword                                       |           | `flex-wrap`             | flex-container                         |
| `justifyContent`      |      | keyword (`start`/`end`, never `left`/`right`) |           | `justify-content`       | flex-or-grid-container                 |
| `alignItems`          |      | keyword                                       |           | `align-items`           | flex-or-grid-container                 |
| `alignContent`        |      | keyword                                       |           | `align-content`         | wrapping-flex-or-grid, block-container |
| `gap`                 |      | dimension                                     | dimension | `gap`                   | flex-or-grid-container                 |
| `rowGap`              |      | dimension                                     | dimension | `row-gap`               | flex-or-grid-container                 |
| `columnGap`           |      | dimension                                     | dimension | `column-gap`            | flex-or-grid-container                 |
| `gridTemplateColumns` |      | css value                                     |           | `grid-template-columns` | grid-container                         |
| `gridTemplateRows`    |      | css value                                     |           | `grid-template-rows`    | grid-container                         |
| `gridAutoFlow`        |      | keyword                                       |           | `grid-auto-flow`        | grid-container                         |
| `justifyItems`        |      | keyword                                       |           | `justify-items`         | grid-container                         |

### dimensions

| Property         | Flag | Value      | Tokens    | Emits             | Applies when       |
| ---------------- | ---- | ---------- | --------- | ----------------- | ------------------ |
| `width`          |      | dimension  | dimension | `width`           | always             |
| `height`         |      | dimension  | dimension | `height`          | always             |
| `minWidth`       |      | dimension  | dimension | `min-width`       | always             |
| `minHeight`      |      | dimension  | dimension | `min-height`      | always             |
| `maxWidth`       |      | dimension  | dimension | `max-width`       | always             |
| `maxHeight`      |      | dimension  | dimension | `max-height`      | always             |
| `aspectRatio`    |      | css value  |           | `aspect-ratio`    | always             |
| `objectFit`      |      | keyword    |           | `object-fit`      | replaced           |
| `objectPosition` |      | css value  |           | `object-position` | replaced           |
| `overflow`       |      | keyword    |           | `overflow`        | always             |
| `flexGrow`       |      | number ≥ 0 | number    | `flex-grow`       | flex-child         |
| `flexShrink`     |      | number ≥ 0 | number    | `flex-shrink`     | flex-child         |
| `flexBasis`      |      | dimension  | dimension | `flex-basis`      | flex-child         |
| `alignSelf`      |      | keyword    |           | `align-self`      | flex-or-grid-child |
| `justifySelf`    |      | keyword    |           | `justify-self`    | grid-child         |
| `order`          |      | integer    | number    | `order`           | flex-or-grid-child |

### typography

| Property         | Flag | Value                                           | Tokens             | Emits             | Applies when |
| ---------------- | ---- | ----------------------------------------------- | ------------------ | ----------------- | ------------ |
| `fontFamily`     |      | css value                                       | fontFamily         | `font-family`     | always       |
| `fontSize`       |      | dimension                                       | dimension          | `font-size`       | always       |
| `fontWeight`     |      | keyword or number 1–1000                        | fontWeight, number | `font-weight`     | always       |
| `lineHeight`     |      | number or dimension                             | number, dimension  | `line-height`     | always       |
| `letterSpacing`  |      | dimension                                       | dimension          | `letter-spacing`  | always       |
| `wordSpacing`    |      | dimension                                       | dimension          | `word-spacing`    | always       |
| `textAlign`      |      | keyword (`start`/`end`, flips with direction)   |                    | `text-align`      | always       |
| `textTransform`  |      | keyword                                         |                    | `text-transform`  | always       |
| `fontStyle`      |      | keyword or css value (`oblique` takes an angle) |                    | `font-style`      | always       |
| `textDecoration` |      | css value                                       |                    | `text-decoration` | always       |
| `textShadow`     |      | css value                                       | shadow             | `text-shadow`     | always       |

### color

| Property         | Flag   | Value | Tokens | Emits                           | Applies when |
| ---------------- | ------ | ----- | ------ | ------------------------------- | ------------ |
| `color`          | `text` | color | color  | `color`                         | always       |
| `linkColor`      | `link` | color | color  | `color` on descendant `a`       | always       |
| `linkColorHover` | `link` | color | color  | `color` on descendant `a:hover` | always       |

Link colors are the one deliberate exception to a block styling only its own
root element: a link lives inside the text, so its color has to reach a
descendant. The exception is recorded in the catalog rather than hidden in the
compiler, so every case of it is visible and testable.

### background

| Property             | Flag       | Value                                                                                      | Tokens        | Emits                                                                         | Applies when |
| -------------------- | ---------- | ------------------------------------------------------------------------------------------ | ------------- | ----------------------------------------------------------------------------- | ------------ |
| `backgroundColor`    | `color`    | color                                                                                      | color         | `background-color`                                                            | always       |
| `background`         | `image`    | composite: `url`, `position`, `size`, `repeat`, `attachment`, `overlay`, `overlayStrength` | color, number | `background-image` and friends, `--nx-pb-overlay`, `--nx-pb-overlay-strength` | always       |
| `backgroundGradient` | `gradient` | css value                                                                                  |               | `background-image`                                                            | always       |

`background.url` and `backgroundGradient` both emit `background-image`. Setting
both on one element is ambiguous; which wins is settled by the compiler, not by
the catalog.

`background.overlay` (a colour) and `background.overlayStrength` (0 to 100) lay
a colour over the image, under the content. Each compiles to its own custom
property, reset on every element of the page so neither inherits, and every image `background.url` or
`backgroundGradient` writes carries one more layer in front that reads them, so
an overlay set at one device covers an image set at another.

### border

| Property       | Flag      | Value                                                | Tokens           | Emits                                                               | Applies when |
| -------------- | --------- | ---------------------------------------------------- | ---------------- | ------------------------------------------------------------------- | ------------ |
| `border`       | `line`    | composite: `width` (logical sides), `style`, `color` | dimension, color | `border-*-width`, `border-style`, `border-color`                    | always       |
| `borderRadius` | `radius`  | one dimension, or logical corners                    | dimension        | `border-radius`, or `border-start-start-radius` …                   | always       |
| `outline`      | `outline` | composite: `width`, `style`, `color`, `offset`       | dimension, color | `outline-width`, `outline-style`, `outline-color`, `outline-offset` | always       |

### shadow

| Property    | Flag | Value     | Tokens | Emits        | Applies when |
| ----------- | ---- | --------- | ------ | ------------ | ------------ |
| `boxShadow` |      | css value | shadow | `box-shadow` | always       |

### effects

| Property       | Flag | Value      | Tokens           | Emits            | Applies when |
| -------------- | ---- | ---------- | ---------------- | ---------------- | ------------ |
| `opacity`      |      | number 0–1 | number           | `opacity`        | always       |
| `filter`       |      | css value  |                  | `filter`         | always       |
| `mixBlendMode` |      | keyword    |                  | `mix-blend-mode` | always       |
| `transform`    |      | css value  |                  | `transform`      | always       |
| `transition`   |      | css value  | custom, duration | `transition`     | always       |

Nothing is transitioned automatically. A transition happens because an author
asked for one.

### position

| Property   | Flag | Value                                                | Tokens            | Emits                                        | Applies when                                                          |
| ---------- | ---- | ---------------------------------------------------- | ----------------- | -------------------------------------------- | --------------------------------------------------------------------- |
| `position` |      | composite: `type`, `inset` (logical sides), `zIndex` | dimension, number | `position`, `inset-block-start` …, `z-index` | always; `inset`: positioned; `zIndex`: positioned, flex-or-grid-child |

### container

| Property        | Flag | Value   | Tokens | Emits            | Applies when |
| --------------- | ---- | ------- | ------ | ---------------- | ------------ |
| `containerType` |      | keyword |        | `container-type` | always       |

Opting an element in as a query container lets its descendants use
container-axis breakpoints. Note that establishing containment also affects how
absolutely-positioned children resolve their containing block.

## What is validated, and what is not

Four things are checked on every value that reaches the stylesheet:

1. **It parses as a CSS value.** A value that parses cannot carry a stray `;` or
   `}` and so cannot escape its own declaration.
2. **Characters and URL schemes that survive parsing.** A quoted CSS string
   parses cleanly while containing `</style>`, and a parser will happily accept a
   quoted `javascript:` URL, so neither is caught by parsing alone. URL schemes
   are an allowlist — `http`, `https`, and URLs with no scheme at all, which
   resolve against the site's own origin.

3. **That a value is the KIND its property takes.** A length has to be a
   measurement and a colour has to be a colour, because `width: "red"` and
   `color: "16px"` are both well-formed CSS values that a browser silently
   discards.

   Inside a length, a math expression is typed with the algebra CSS Values and
   Units 4 defines: division subtracts exponents, addition requires both sides
   to agree, and scaling is multiplying by a number — `1px * 1px` is an area,
   which CSS has nowhere to put. So `calc(1px / 1px)` is a number,
   `calc(1px + 2)` mixes kinds, and neither is a width. The type is computed
   over the whole expression, so nesting and operator precedence are both
   accounted for, and each product is judged as it forms: `calc(1px * 1px / 1px)`
   is refused for the area in the middle, which the final type no longer shows.

   A percentage carries the **percent hint** of the property it is written on.
   On every property here that is a length, so `calc(1px + 50%)` adds two
   lengths and `calc(10% + 1)` adds a length to a number and is refused.

   **Anything the expression cannot see through makes the whole of it
   unreadable rather than partly readable.** What `var()`, `env()`, `attr()` and
   `anchor-size()` resolve to is not knowable here, so an expression containing
   one is accepted whatever else it holds.

4. **Size and nesting depth.** Parsing a value is recursive and allocates a node
   per token, so both shapes of an oversized value are bounded: anything nested
   deeper than 32 brackets, or longer than 8,192 characters, is refused. No real
   declaration approaches either.

**Grammar correctness for a property is deliberately not checked.** The
reference grammar available to do it lags what browsers ship. Measured against
css-tree 2.3.1, it rejects `oklch()`, `color-mix()` and `clamp()`, and does not
recognise `container-type` at all. Using it as a gate would refuse correct,
current CSS — a worse failure than accepting a value the browser will ignore.
Per-property strictness comes instead from the catalog's own keyword sets, which
are ours to keep current.

## Extending the catalog

Adding a property is backwards compatible. Older engines treat a property they
do not know the way they treat an unknown block: an error under strict
validation, a warning under forgiving validation, so a document written by a
newer engine still renders.

Removing a property, or changing what an existing one means or the shape of its
value, is a document-format migration.

### list

| Property        | Flag | Value                                            | Tokens | Emits             | Applies when |
| --------------- | ---- | ------------------------------------------------ | ------ | ----------------- | ------------ |
| `listStyleType` |      | keyword (`revert` restores the element's marker) |        | `list-style-type` | always       |

### disclosure

Offered by a block whose children are disclosures (an Accordion). Each keyword
also writes fixed declarations on the block's own sections, through child
selectors (`> details > summary`), so one value reaches every section and never
a section of an accordion nested inside one.

| Property             | Flag | Value                                         | Tokens | Emits                                                                       | Applies when |
| -------------------- | ---- | --------------------------------------------- | ------ | --------------------------------------------------------------------------- | ------------ |
| `disclosureIcon`     |      | keyword: `chevron`, `plus`, `none`, `browser` |        | `--nx-pb-disclosure-icon`, and each section's title row, icon and open look | always       |
| `disclosurePosition` |      | keyword: `before`, `after`                    |        | `--nx-pb-disclosure-position`, and the icon's order and start margin        | always       |
