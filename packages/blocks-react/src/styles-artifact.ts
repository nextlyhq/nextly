/**
 * The style artifact a page is stored and rendered with: its compiled sheet,
 * the class each node was given and what it was compiled under, and how a
 * compile becomes one.
 *
 * @module styles-artifact
 */
import type { CompiledPageCss } from "@nextlyhq/blocks-engine";

/**
 * A page's compiled stylesheet and the class each node was assigned.
 *
 * Both halves travel together because neither is usable alone: the CSS is
 * written against exactly these classes, and a renderer that kept the sheet but
 * recomputed the classes could hand a node a class no rule targets.
 *
 * `classes` is a plain object rather than the compiler's `Map` on purpose. This
 * artifact is stored next to the document and handed across the server/client
 * boundary as a prop, and a `Map` survives neither: `JSON.stringify` turns it
 * into `{}`, silently, so a page would come back styled by an empty sheet.
 */
export interface PageStyles {
  css: string;
  /**
   * Which host-fetch policy this CSS was compiled under, when one was in force.
   *
   * A stored stylesheet is a CACHE of a compile, and a cache is only sound when
   * it is keyed on every input the compile used. The host's fetch list is such
   * an input: the same document compiled under two different lists produces two
   * different sheets, one of which may name a host the other refuses. Without
   * this field a reader cannot tell them apart, so a sheet written before a
   * policy existed keeps publishing `url(https://unlisted…)` on a site that has
   * since forbidden it, and the block markup beside it is bounded while the
   * stylesheet is not.
   *
   * An OPAQUE label rather than the list itself. The reader only ever asks
   * "same policy as now?", which is an equality test, and storing the answer
   * rather than the rules keeps the stored artifact from having to be re-read
   * whenever the shape of a pattern changes.
   *
   * Absent means compiled under NO policy, which is exactly what every artifact
   * written before this field existed was.
   */
  fetchPolicyId?: string;
  /**
   * Which SHARED style inputs this CSS was compiled against, when they were
   * knowable.
   *
   * The same argument as `fetchPolicyId`, for the three inputs it does not
   * cover: the site's breakpoints, its token prefix and its named-class
   * library. All three are site-level, every page compiles against them, and
   * each renders directly into the stored sheet — breakpoints as the at-rules,
   * the prefix inside every `var()`, and a class's slug as the selector itself.
   * Move one and this artifact references at-rules, properties and selectors
   * the newly compiled site sheet no longer declares, which CSS reports by
   * silently dropping the declaration.
   *
   * A digest rather than the inputs, because a class library reaches thousands
   * of entries and this is stored on every page.
   *
   * Absent means UNTRUSTED, not "compiled against none" — the two are
   * indistinguishable from the artifact alone, and the reading that trusts it
   * is the one that serves a stale sheet forever.
   */
  sharedInputsId?: string;
  /**
   * The container this sheet's breakpoints were aimed at, when it is a PREVIEW
   * artifact — and absent for every publishable one.
   *
   * A preview sheet is not publishable and the difference is invisible in the
   * CSS: its viewport tiers are `@container` rules naming a box only the
   * previewing surface declares, so on a published page they match nothing and
   * every breakpoint above the base one silently disappears. The page still
   * renders, still looks styled at desktop width, and stops being responsive.
   *
   * Recorded on the ARTIFACT because `resolvePageStyles` is exported and
   * returns this shape, so a preview result can be persisted and later handed
   * back with no compile context — and a context-free read has nothing else to
   * judge it by. Every other staleness field here is compared against inputs a
   * context supplies; this one has to be refusable without one.
   */
  previewContainer?: string;
  /** Node id to generated class name. */
  classes: Record<string, string>;
  /**
   * The scope class the selectors were anchored under, when there was one.
   *
   * Recorded here rather than asked of the caller separately, because a scope
   * that lives in two places is a scope that can disagree with itself: the
   * stylesheet's selectors already encode it, so a renderer told a different
   * one puts a class on the root that no rule mentions and the whole sheet
   * silently matches nothing. Travelling with the CSS makes that unstateable.
   */
  scope?: string;
  /**
   * The node-local rules of every condition-gated node, keyed by node id, held
   * OUT of `css` so a reader appends only the ones whose nodes survived.
   *
   * The sheet is compiled when the document is SAVED and a condition is decided
   * when the page is READ, so one pre-compiled string otherwise carries rules
   * for nodes the reader removes — publishing the colours, fonts and `url(...)`
   * of a block whose markup is withheld.
   *
   * An ABSENT field means "compiled before this split existed", NOT "nothing was
   * gated". The two are indistinguishable from the artifact alone, and reading
   * absence as "nothing gated" would trust a sheet that predates gating
   * entirely. So gating must still force a recompile when this is missing; only
   * a present map licenses skipping it.
   */
  gated?: Readonly<Record<string, string>>;
}

/** The compiler's output in the storable shape. */
export function toPageStyles(
  compiled: CompiledPageCss,
  scope?: string,
  /** The policy the compile ran under, recorded so a later read can check it. */
  fetchPolicyId?: string,
  /** The shared inputs the compile ran against, recorded for the same reason. */
  sharedInputsId?: string
): PageStyles {
  const styles: PageStyles = {
    css: compiled.css,
    classes: Object.fromEntries(compiled.classes),
    ...(fetchPolicyId === undefined ? {} : { fetchPolicyId }),
    ...(sharedInputsId === undefined ? {} : { sharedInputsId }),
  };
  // Carried through because THIS is the shape that gets stored: a compiler that
  // splits the sheet and a writer that drops half of it leave the gated rules
  // nowhere, and the page renders those nodes unstyled with nothing to say why.
  const withGated =
    compiled.gated === undefined
      ? styles
      : { ...styles, gated: compiled.gated };
  // The scope the compiler WROTE, not the one the caller asked for. A scope the
  // compiler cannot write is dropped and the sheet compiled global, so recording
  // the request stores an artifact claiming an isolation its own selectors do
  // not carry — and the renderer attaches that class, which is how one
  // document's rules reach another rendered beside it.
  //
  // The parameter is no longer read for this: a caller cannot know whether the
  // compiler accepted its scope, and only the compiler does.
  const withScope =
    compiled.scope === undefined
      ? withGated
      : { ...withGated, scope: compiled.scope };
  // The container the compiler actually AIMED AT, for the same reason the scope
  // above is the written one rather than the requested one: a refused name
  // compiles published, and stamping that artifact as a preview would withhold
  // a perfectly publishable sheet on every later context-free read.
  return compiled.previewContainer === undefined
    ? withScope
    : { ...withScope, previewContainer: compiled.previewContainer };
}
