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

## What the builder emits

Every rule the builder writes is anchored to the page root and carries three
classes' worth of weight:

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
`@keyframes`, `@property` and their relatives resolve names across the whole
document regardless of scoping, so the builder namespaces every one it defines.
An animation you call `fade` and one the builder calls `fade` are different
animations.

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

---

## How to override the builder on purpose

Any of these wins. Pick whichever suits your codebase.

**Add a class to the front.** The simplest, and it reads as intent:

```css
.my-theme .nx-pb-page.nx-pb-page .nx-pb-a1b2 {
  color: rebeccapurple;
}
```

**Use `!important`.** Blunt, and it always works, because the builder never uses
it:

```css
.prose h1 {
  color: rebeccapurple !important;
}
```

**Style through a scope you control.** If you render the document with a scope,
that class is yours to select on:

```css
.my-region.nx-pb-page.nx-pb-page .nx-pb-a1b2 {
  color: rebeccapurple;
}
```

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
   `!important` in your stylesheet always wins.
3. **The builder refused the value and said so.** Compilation returns warnings
   for everything it declined to write, each naming the exact position in the
   document. A value that is missing from the page is never missing silently.
