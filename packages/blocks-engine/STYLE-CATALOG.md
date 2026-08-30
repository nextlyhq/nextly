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
lines. Properties with no flag are reachable only through the `true` form, which
is how a group states that it offers nothing finer than all-or-nothing.

`supports` decides what an EDITOR offers and what a block promises to render.
Document validation does not enforce it: it checks a property against the
catalog, not against the block that owns the node. Validation is given a block
lookup that answers whether a type is registered and nothing more, so a block's
declaration is not reachable there. Enforcing it would also mean a block
narrowing its `supports` invalidates every stored document that styled through
the wider declaration, which is a migration rather than a check.

## The properties

### spacing

| Property  | Flag      | Value                          | Tokens    | Emits                                        |
| --------- | --------- | ------------------------------ | --------- | -------------------------------------------- |
| `margin`  | `margin`  | logical box sides of dimension | dimension | `margin-block-start` … `margin-inline-end`   |
| `padding` | `padding` | logical box sides of dimension | dimension | `padding-block-start` … `padding-inline-end` |

### layout

| Property              | Flag | Value                                         | Tokens    | Emits                   |
| --------------------- | ---- | --------------------------------------------- | --------- | ----------------------- |
| `display`             |      | keyword                                       |           | `display`               |
| `flexDirection`       |      | keyword                                       |           | `flex-direction`        |
| `flexWrap`            |      | keyword                                       |           | `flex-wrap`             |
| `justifyContent`      |      | keyword (`start`/`end`, never `left`/`right`) |           | `justify-content`       |
| `alignItems`          |      | keyword                                       |           | `align-items`           |
| `alignContent`        |      | keyword                                       |           | `align-content`         |
| `gap`                 |      | dimension                                     | dimension | `gap`                   |
| `rowGap`              |      | dimension                                     | dimension | `row-gap`               |
| `columnGap`           |      | dimension                                     | dimension | `column-gap`            |
| `gridTemplateColumns` |      | css value                                     |           | `grid-template-columns` |
| `gridTemplateRows`    |      | css value                                     |           | `grid-template-rows`    |
| `gridAutoFlow`        |      | keyword                                       |           | `grid-auto-flow`        |

### dimensions

| Property      | Flag | Value     | Tokens    | Emits          |
| ------------- | ---- | --------- | --------- | -------------- |
| `width`       |      | dimension | dimension | `width`        |
| `height`      |      | dimension | dimension | `height`       |
| `minWidth`    |      | dimension | dimension | `min-width`    |
| `minHeight`   |      | dimension | dimension | `min-height`   |
| `maxWidth`    |      | dimension | dimension | `max-width`    |
| `maxHeight`   |      | dimension | dimension | `max-height`   |
| `aspectRatio` |      | css value |           | `aspect-ratio` |
| `objectFit`   |      | keyword   |           | `object-fit`   |
| `overflow`    |      | keyword   |           | `overflow`     |

### typography

| Property         | Flag | Value                                              | Tokens             | Emits             |
| ---------------- | ---- | -------------------------------------------------- | ------------------ | ----------------- |
| `fontFamily`     |      | css value                                          | fontFamily         | `font-family`     |
| `fontSize`       |      | dimension                                          | dimension          | `font-size`       |
| `fontWeight`     |      | keyword or number 1–1000                           | fontWeight, number | `font-weight`     |
| `lineHeight`     |      | number or dimension                                | number, dimension  | `line-height`     |
| `letterSpacing`  |      | dimension                                          | dimension          | `letter-spacing`  |
| `wordSpacing`    |      | dimension                                          | dimension          | `word-spacing`    |
| `textAlign`      |      | keyword (`start`/`end`, flips with direction)      |                    | `text-align`      |
| `textTransform`  |      | keyword                                            |                    | `text-transform`  |
| `fontStyle`      |      | keyword or css value (`oblique` takes an angle)    |                    | `font-style`      |
| `listStyleType`  |      | keyword (`revert` restores the per-element marker) |                    | `list-style-type` |
| `textDecoration` |      | css value                                          |                    | `text-decoration` |
| `textShadow`     |      | css value                                          | shadow             | `text-shadow`     |

### color

| Property         | Flag   | Value | Tokens | Emits                           |
| ---------------- | ------ | ----- | ------ | ------------------------------- |
| `color`          | `text` | color | color  | `color`                         |
| `linkColor`      | `link` | color | color  | `color` on descendant `a`       |
| `linkColorHover` | `link` | color | color  | `color` on descendant `a:hover` |

Link colors are the one deliberate exception to a block styling only its own
root element: a link lives inside the text, so its color has to reach a
descendant. The exception is recorded in the catalog rather than hidden in the
compiler, so every case of it is visible and testable.

### background

| Property             | Flag       | Value                                                        | Tokens | Emits                          |
| -------------------- | ---------- | ------------------------------------------------------------ | ------ | ------------------------------ |
| `backgroundColor`    | `color`    | color                                                        | color  | `background-color`             |
| `background`         | `image`    | composite: `url`, `position`, `size`, `repeat`, `attachment` |        | `background-image` and friends |
| `backgroundGradient` | `gradient` | css value                                                    |        | `background-image`             |

`background.url` and `backgroundGradient` both emit `background-image`. Setting
both on one element is ambiguous; which wins is settled by the compiler, not by
the catalog.

### border

| Property       | Flag     | Value                                                | Tokens           | Emits                                             |
| -------------- | -------- | ---------------------------------------------------- | ---------------- | ------------------------------------------------- |
| `border`       | `line`   | composite: `width` (logical sides), `style`, `color` | dimension, color | `border-*-width`, `border-style`, `border-color`  |
| `borderRadius` | `radius` | one dimension, or logical corners                    | dimension        | `border-radius`, or `border-start-start-radius` … |

### shadow

| Property    | Flag | Value     | Tokens | Emits        |
| ----------- | ---- | --------- | ------ | ------------ |
| `boxShadow` |      | css value | shadow | `box-shadow` |

### effects

| Property       | Flag | Value      | Tokens           | Emits            |
| -------------- | ---- | ---------- | ---------------- | ---------------- |
| `opacity`      |      | number 0–1 | number           | `opacity`        |
| `filter`       |      | css value  |                  | `filter`         |
| `mixBlendMode` |      | keyword    |                  | `mix-blend-mode` |
| `transform`    |      | css value  |                  | `transform`      |
| `transition`   |      | css value  | custom, duration | `transition`     |

Nothing is transitioned automatically. A transition happens because an author
asked for one.

### position

| Property   | Flag | Value                                                | Tokens            | Emits                                        |
| ---------- | ---- | ---------------------------------------------------- | ----------------- | -------------------------------------------- |
| `position` |      | composite: `type`, `inset` (logical sides), `zIndex` | dimension, number | `position`, `inset-block-start` …, `z-index` |

### container

| Property        | Flag | Value   | Tokens | Emits            |
| --------------- | ---- | ------- | ------ | ---------------- |
| `containerType` |      | keyword |        | `container-type` |

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
