# The override contract

What the page builder promises about the CSS it emits, and what it promises
about yours.

The page belongs to you. The builder writes CSS onto it, and this document says
exactly how much authority that CSS claims — so that "why didn't my style
apply?" always has an answer you can check rather than guess at.

---

## In one sentence

**Builder rules beat ordinary site CSS; your CSS beats the builder whenever you
mean it to.**

---

## What this applies to

Stylesheets compiled by this package, `@nextlyhq/blocks-engine`. Every guarantee
below is enforced by tests against its output.

`@nextlyhq/plugin-page-builder` still renders through a compiler of its own,
which predates this contract and does not follow it: its rules are single
classes, unanchored to the page root, so they carry one class of weight rather
than the weights tabled below. Moving that renderer onto this engine is a
separate piece of work. Until it lands, read this as the contract for the engine,
not as a description of what that plugin currently emits.

---

## What the builder emits

Every rule the builder writes is anchored to the page root and carries at least
two classes' worth of weight:

```css
.nx-pb-page.nx-pb-page .nx-pb-a1b2 {
  color: blue;
}
```

Two things follow, and both are enforced by tests rather than by convention.

**Nothing the builder emits can match outside the page root.** Not a stray
selector, not a hostile value in stored content, not a stylesheet compiled from a
document nobody validated. A test compiles the whole adversarial document corpus
and fails if any emitted selector could match an element outside
`.nx-pb-page`.

**Nothing the builder emits defines a name that collides with yours.**
`@keyframes`, `@property`, `@counter-style` and `@font-face` all define names
that CSS resolves across the whole document regardless of scoping, so the
builder namespaces every one it defines. An animation you call `fade` and one the
builder calls `fade` are different animations; so are two fonts called `Inter`.

---

## Why the class is repeated

`.nx-pb-page.nx-pb-page` is not a typo. Repeating a class buys one notch of
specificity without `!important`, and that notch decides a contest users lose
constantly:

```css
/* Your site's theme, written months ago and long forgotten */
.content .card h1 {
  color: rebeccapurple;
} /* 0-2-1 */

/* What you just set in the builder */
.nx-pb-page .nx-pb-a1b2 {
  color: teal;
} /* 0-2-0 — LOSES */
```

Before the repetition, the heading stayed purple and the builder appeared to have
ignored you. With it, the builder's rule is 0-3-0 and teal wins — which is what
you asked for when you set it.

**`!important` is deliberately never used.** It would win the argument by ending
it, and then your own overrides would need `!important` too, forever. One notch
is enough to beat ordinary CSS and cheap to beat deliberately.

### The exact weights

Not every builder rule weighs the same. Specificity is written the way devtools
shows it: (ids, classes, types), where a pseudo-class such as `:hover` counts in
the middle column.

| What it styles                | Selector                                        | Specificity |
| ----------------------------- | ----------------------------------------------- | ----------- |
| Page-wide settings            | `.nx-pb-page.nx-pb-page`                        | 0-2-0       |
| Links inside the page         | `.nx-pb-page.nx-pb-page a`                      | 0-2-1       |
| A block type's defaults       | `.nx-pb-page.nx-pb-page .nx-bt-core--section`   | 0-3-0       |
| One node's own styles         | `.nx-pb-page.nx-pb-page .nx-pb-a1b2`            | 0-3-0       |
| Links inside a node           | `.nx-pb-page.nx-pb-page .nx-pb-a1b2 a`          | 0-3-1       |
| Hovered links inside a node   | `.nx-pb-page.nx-pb-page .nx-pb-a1b2 a:hover`    | 0-4-1       |
| Hiding a node at a breakpoint | `.nx-pb-page.nx-pb-page .nx-pb-a1b2.nx-pb-a1b2` | 0-4-0       |

The rule behind the table, which matters more than the rows: **a property that
styles something inside the element adds that thing's own weight.** Link colour
is the case that exists today, and the last three rows are what it produces.
Anything similar added later follows the same pattern rather than appearing as
a new exception, so read the table as worked examples of the rule.

Two of the rows are deliberate rather than incidental.

**Page settings weigh less** because they are the outermost element's own
styles, and everything inside should be able to say otherwise — a block that
sets its own colour is meant to beat the page's default colour.

**Hiding weighs more** because it has to beat the node's own `display`,
including one set on a state. `.nx-pb-a1b2:focus-visible { display: block }`
would otherwise outrank a plain `display: none` and leave a focused element on
screen at a width you hid it at.

**States add nothing.** Hover, focus and the rest are emitted inside `:where()`,
which contributes zero, so `:hover` styles weigh exactly what the same node's
base styles weigh and win on source order instead. Rendering a document under a
scope adds one class to every row above.

If you are ever unsure, read the winning rule's specificity in devtools and
write something that beats it, rather than working from this table. The table
says what the builder emits; devtools says what actually won, which is the
question you are asking.

---

## How to override the builder on purpose

Pick whichever suits your codebase. Read the note on cascade layers below first
if your CSS lives in an `@layer` — Tailwind's does.

**Add a class to the front.** The simplest, and it reads as intent:

```css
.my-theme .nx-pb-page.nx-pb-page .nx-pb-a1b2 {
  color: rebeccapurple;
}
```

**Use `!important`.** Blunt, and it wins every specificity contest, because the
builder never uses it:

```css
.prose h1 {
  color: rebeccapurple !important;
}
```

There is exactly one thing that outranks it, and it is not us: **a transition in
progress.** While a property is transitioning, the transitioned value beats even
an important author declaration, so if the block sets `transition` on the
property you are overriding, your rule takes effect only once the transition
finishes. Override the transition too if that matters:

```css
.prose h1 {
  color: rebeccapurple !important;
  transition: none !important;
}
```

**Style through a scope you control.** If you render the document with a scope,
that class is yours to select on — but the scope is already part of the selector
the builder emits, so repeating it adds nothing. Put an ancestor in front of it:

```css
/* The builder already emits this when the document has a scope: */
/* .nx-pb-page.nx-pb-page.my-region .nx-pb-a1b2 { color: teal }  (0-4-0) */

/* So this TIES, and loses on source order — the builder's inline
   <style> comes after your stylesheet: */
.my-region.nx-pb-page.nx-pb-page .nx-pb-a1b2 {
  color: rebeccapurple;
} /* 0-4-0 — no */

/* This wins: */
.my-theme .my-region.nx-pb-page.nx-pb-page .nx-pb-a1b2 {
  color: rebeccapurple;
} /* 0-5-0 — yes */
```

Class order inside a compound carries no weight; only the count does. When in
doubt, add one more class than the builder's selector has, or use `!important`.

### If your CSS is in a cascade layer

Specificity is only consulted between declarations in the same layer, and **an
unlayered declaration beats a layered one whatever its specificity**. The builder
emits an unlayered `<style>` element, so a rule of yours inside `@layer` loses to
it no matter how many classes you add:

```css
@layer components {
  /* 0-5-0, and still loses: it is layered, ours is not */
  .my-theme .nx-pb-page.nx-pb-page .nx-pb-a1b2 {
    color: rebeccapurple;
  }
}
```

This is worth knowing because Tailwind puts its own rules in layers, so anything
you write in `@layer components`, or in a file Tailwind processes into one, is
affected. Two things still work:

- **Write the override unlayered.** A plain stylesheet with no `@layer` around
  it outranks every layer, so the specificity rules above apply as written.
- **Use `!important`.** For important declarations the order flips — layered
  beats unlayered — and since the builder never writes `!important` at all, an
  important rule of yours wins from anywhere.

The builder does not emit into a layer itself, and that is deliberate: a layered
stylesheet loses to every unlayered rule on the host page, which would put the
builder below any styling that happens not to use layers.

---

## What the builder does NOT protect you from

Being honest about the edges is more useful than a guarantee that quietly
doesn't hold.

**Your CSS still reaches inside builder pages.** A rule like `p { color: red }`
matches paragraphs inside a block, and if the block sets no colour of its own,
red wins. This is usually what you want — your site's typography applying to your
content — and it is why the builder does not seal itself off.

**Inherited properties still flow in.** `font-family`, `line-height` and `color`
set on `html` or `body` are inherited by builder pages, by design. A builder page
should look like part of your site, not like an iframe pasted into it.

**The builder is not sandboxed from you, and cannot be.** Total isolation is
possible — Shadow DOM does it — and it was rejected deliberately: it would break
your global styles, your Tailwind, your forms and your markup. The contract is
_predictable and overridable_, not _sealed_.

---

## If a style still doesn't apply

In order, these explain nearly every case:

1. **Something of yours is more specific.** Check the winning rule in devtools;
   if it has more classes than `.nx-pb-page.nx-pb-page .nx-pb-xxxx`, that is why.
2. **Something of yours uses `!important`.** The builder never does, so an
   `!important` in your stylesheet wins every specificity contest.
3. **The property is mid-transition.** A transitioning value outranks every
   author declaration, `!important` included, until the transition ends. If the
   block sets `transition` on the property you are changing, add
   `transition: none !important` to your rule and see whether it applies then.
4. **The builder refused the value and said so.** Compilation returns warnings
   for everything it declined to write, each naming the exact position in the
   document. A value that is missing from the page is never missing silently.
