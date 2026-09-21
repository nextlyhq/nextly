# Research policy

Governs when `discovering-a-feature` (or any skill) reaches for external
research instead of working from the codebase alone.

## When external research is warranted

- an API, framework, or library the change depends on may have changed since training;
- the task touches security, accessibility, or a protocol standard;
- a live product/UX decision genuinely depends on how a competitor behaves — not as a ritual step for every task;
- the architecture depends on an external system whose current behavior isn't already documented in this repo.

## When it is not

A routine bug fix, an internal refactor, or anything whose correct behavior
the codebase, its tests, or `AGENTS.md` already establish. Before researching,
state which decision the research will change. If you cannot name one, do not
research — implement from what is already known.

## How to research

- prefer primary sources (the library's own docs/changelog, the standard's own text) over secondary summaries;
- record the date or version you verified against;
- for each source, say what decision it changes, not just what it says;
- compare concrete behavior, not marketing copy;
- stop once further research is unlikely to change the decision.

## Nextly-specific defaults

For product/UX questions, the useful default set of competitors is Payload
CMS, Strapi, Directus, Sanity, and WordPress/ACF — check only the ones
actually relevant to the question at hand, not all five every time. For a
library or framework question, prefer its current docs/changelog (via
context7 if available) over training knowledge, and record the version.

For any ecommerce-related template, plugin, or module — plan or
implementation — also deeply review **Shopify** specifically, in addition to
whichever of the above are relevant. Ecommerce has its own established
conventions (product/variant/inventory modeling, cart and checkout flow,
storefront APIs, theme/section architecture) that the general CMS competitor
list above does not cover, and Shopify is the reference point for them.
