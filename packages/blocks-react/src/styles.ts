import {
  compilePageCss,
  nodeClassNames,
  type BlockDocument,
  type BlockNode,
  type MayFetchUrl,
  type StyleCompileContext,
  type StyleTraceEntry,
} from "@nextlyhq/blocks-engine";

import type { BlockResolver } from "./resolver";
import {
  UNIDENTIFIED_SHARED_INPUTS,
  sharedStyleInputsId,
  stampedUnderCurrentEncoding,
} from "./shared-style-inputs";
import { type PageStyles, toPageStyles } from "./styles-artifact";
import { compileContextFor, drawlessTestFor } from "./styles-block-inputs";
import { storedUnderAnotherPolicy } from "./styles-effective-compile";
import { withGatedRules } from "./styles-gated-rules";
import {
  documentNodeIds,
  artifactDescribesUnaccountedNodes,
  normalizeStoredStyles,
} from "./styles-stored-trust";

export { toPageStyles } from "./styles-artifact";
export type { PageStyles } from "./styles-artifact";
export {
  blockBasesFor,
  blockPartsFor,
  islandsFor,
  drawlessTestFor,
} from "./styles-block-inputs";
export {
  isRecordedGatedEntry,
  isUsableGatedEntry,
  readableGatedRules,
  migrationChangedWhatDraws,
  gatedEntriesCoverRemovedNodes,
  gatedMapCoversPrunedNodes,
  hasDuplicateNodeIds,
} from "./styles-stored-trust";
export { itemDecidedRules } from "./styles-gated-rules";
export {
  fetchPolicyLabel,
  UNIDENTIFIED_FETCH_POLICY,
  effectiveCompile,
} from "./styles-effective-compile";
export type { EffectiveCompile } from "./styles-effective-compile";

/** Caller-supplied policy for one style resolution. */
export interface ResolveStyleOptions {
  /**
   * Which host-fetch policy is in force now. Compared against the stamp the
   * stored artifact carries; a difference means that artifact was compiled
   * under other rules and cannot be trusted for this render.
   */
  fetchPolicyId?: string;
  /**
   * The host-fetch predicate in force, as {@link effectiveCompile} derived it.
   *
   * Read only by a recompile with no compile context, which has nothing else to
   * judge a URL by. When `fetchPolicyId` names a policy and this is absent, such
   * a recompile is not made and the sheet is withheld, since compiling without
   * the predicate would admit every URL the policy refuses.
   */
  mayFetchUrl?: MayFetchUrl;
  /**
   * The tree the STORED artifact describes, when the caller narrowed the
   * document before calling this.
   *
   * The documented direct-caller flow is prune-then-resolve, so `document` here
   * is often already smaller than the tree the artifact was compiled from — and
   * two of those prunes are LICENSED to keep the artifact rather than to refuse
   * it. Anything derived from the tree for the artifact's identity has to be
   * derived from this one instead, or a covered prune moves that identity and
   * rejects the very sheet it was allowed in order to reuse.
   *
   * Absent means the two are the same tree, which is the case for every caller
   * that has not pruned.
   */
  storedDocument?: BlockDocument;
  /**
   * Whether `document` is the tree being DRAWN, every conditioned block left in
   * it kept because its conditions held.
   *
   * A compile holds each conditioned block's rules apart, in `gated`. A render
   * wants the rules of the blocks it kept back in `css`. A caller compiling a
   * whole stored document to save its sheet does not: a reader appends those
   * rules per surviving block, so a saved `css` carrying them would publish a
   * hidden block's colours and URLs to every visitor. So they go back only
   * when this says the tree is the one drawn.
   */
  drawn?: boolean;
  /**
   * Ask for the cascade that produced the sheet, alongside the sheet.
   *
   * The editor needs it and nothing else does. A control showing where its
   * value came from — authored here, inherited from a class, inherited from a
   * wider breakpoint — is answering a question only the compiler can answer,
   * because it has already settled tier order, both breakpoint axes, states,
   * refused values, descendant selectors and specificity. Re-deriving that
   * beside the compiler is the drift every staleness test in this file exists
   * to catch.
   *
   * Off by default, and the compiler builds the array only when asked, so an
   * ordinary render pays nothing. It is deliberately NOT part of
   * {@link PageStyles}: that shape is what gets stored, and a cascade recorded
   * for one editing session has no business in the database.
   */
  trace?: boolean;
}

/** A resolved sheet, and the cascade that produced it when one was asked for. */
export interface ResolvedPageStyles {
  readonly styles: PageStyles;
  /**
   * Present only when `trace` was asked for AND a compile actually ran.
   *
   * Absent is a real answer rather than a failure: a page served from a stored
   * artifact is not recompiled, so there IS no cascade to report, and a caller
   * that treats absence as "nothing is authored" would tell an author their
   * values came from nowhere. Show no provenance rather than a wrong one.
   */
  readonly trace?: readonly StyleTraceEntry[];
}

/**
 * The styles a render should use, from whichever of the three inputs it has.
 *
 * Ordered by how much each can be trusted:
 *
 * 1. A stored artifact. Compilation happens at write time, so what ships is
 *    what was compiled against the document as saved. Recompiling per request
 *    is the missing-CSS bug class page builders are known for, and it costs the
 *    compile on every render of an unchanged page.
 * 2. A compile context, for a consumer with no write path — the standalone
 *    case. The compiler is deterministic and needs no runtime, so this produces
 *    the same bytes the CMS would have stored.
 * 3. Neither, which still has to work. A document renders without styles, but
 *    it cannot render without CLASSES: every block is handed one and puts it on
 *    its root element. They come from the same helper the compiler uses, so the
 *    collision handling that makes two ids hashing alike distinguishable is the
 *    same in all three paths rather than reinvented in the cheapest one.
 */
export function resolvePageStylesWithTrace(
  document: BlockDocument,
  styles: PageStyles | undefined,
  styleContext: StyleCompileContext | undefined,
  blocks: BlockResolver,
  /**
   * Whether condition-gated nodes were removed from `document` before this ran.
   *
   * It changes what a STORED artifact may be trusted for. The artifact is
   * compiled at write time from the whole document, and conditions are decided
   * at read time, so a sheet saved before any gating knows nothing about it:
   * the gated node's markup is withheld while the rules compiled for it — and
   * any URL inside them — are still published.
   *
   * Recompiling is the right answer whenever the inputs to do so are present.
   * When they are not, the sheet is withheld: the format says a hidden node is
   * omitted from server output, and an unstyled page keeps that promise while a
   * styled one breaks it. Classes are kept either way, so blocks still carry
   * the names the rest of the system expects.
   *
   * An artifact carrying `gated` no longer needs either. Its rules travel per
   * node, so the caller can leave gating out of this flag and let
   * {@link withGatedRules} append exactly the survivors. The other repair
   * causes still belong here: none of them is fixed by a per-node split.
   */
  repairedDocument = false,
  /**
   * What this render knows that the positional arguments cannot carry.
   *
   * An object rather than more positionals: five is already where a call stops
   * reading by position, and the next thing added in line would sit beside a
   * boolean with only its type to separate them.
   */
  options: ResolveStyleOptions = {}
): ResolvedPageStyles {
  // Derived before either branch, so the read path and the compile path cannot
  // answer differently about the same document.
  const drawsNothing = drawlessTestFor(blocks);

  const compileContext = compileContextFor(
    styleContext,
    document,
    blocks,
    drawsNothing,
    options.storedDocument
  );
  const sharedInputsId = sharedStyleInputsId(compileContext);

  // An artifact naming classes for nodes this document does not contain was compiled from a
  // DIFFERENT, larger tree — which is exactly what pruning produces. Its `css` may carry those
  // nodes' rules and asset URLs while their markup is withheld, so it cannot be trusted however
  // the caller filled in `repairedDocument`. Checked here rather than left to the flag because
  // this function is exported and the documented direct-caller flow is prune-then-resolve, where
  // the flag defaults to false and nothing else would notice.
  const compiledFromAnotherTree =
    styles !== undefined && artifactDescribesUnaccountedNodes(styles, document);
  // A stored sheet compiled under a DIFFERENT fetch policy than the one in
  // force is untrusted for the same reason a sheet compiled from a larger tree
  // is: its `url(...)` values were admitted by rules that no longer apply, and
  // the reader cannot tell which of them the current rules would refuse without
  // compiling again. So it is treated as a repair cause, which already means
  // recompile when the inputs are there and withhold the CSS when they are not.
  //
  // Equality, not containment. A list that only ever grew would still be safe
  // to reuse a sheet from, but deciding that needs the rules rather than the
  // label, and a reader that has to reason about the rules is one that can get
  // it wrong quietly.
  //
  // A sheet compiled under an ANONYMOUS predicate is stale against every policy
  // including no policy at all, which is why its own stamp is not enough to
  // decide by. Two transitions make that concrete and they fail in opposite
  // directions: to another anonymous predicate, where a stable sentinel would
  // compare equal to itself and reuse CSS the new predicate never judged; and
  // away from the predicate entirely, where absence is ALSO the honest stamp for
  // an unrestricted compile, so a restrictive artifact would be reused and the
  // URLs it dropped would stay missing for good. Neither a stable stamp nor an
  // absent one separates those, so the stamp records what compiled the sheet and
  // this comparison refuses it outright.
  const compiledUnderAnotherPolicy = storedUnderAnotherPolicy(
    styles,
    options.fetchPolicyId
  );

  // The same test for the site-level inputs, and it refuses an ABSENT stamp for
  // the same reason the policy one refuses its sentinel: absence is equally the
  // honest stamp for a compile that had no shared inputs at all, so treating it
  // as a match would reuse a sheet compiled against a library, a prefix and a
  // breakpoint set that nothing here has seen.
  //
  // Every artifact written before this field existed is unstamped, so each is
  // recompiled and the value returned carries the stamp. Whether that is paid
  // ONCE is not this module's to promise: it returns a stamped value and does
  // not write one, so the cost is once per artifact where a caller persists or
  // caches the result, and once per request where nothing does. The correctness
  // is the same either way; only the price differs.
  // Only ASKED when a context exists. With none there is nothing to compare a
  // stamp against and nothing to recompile with, so a mismatch could not be
  // acted on — it would withhold the sheet and render the page unstyled, which
  // is worse than the staleness it was guarding. A context-free read is not a
  // place this question can be answered, so it is not asked there.
  const compiledAgainstOtherInputs =
    styles !== undefined &&
    compileContext !== undefined &&
    (styles.sharedInputsId !== sharedInputsId ||
      styles.sharedInputsId === UNIDENTIFIED_SHARED_INPUTS);
  /*
   * A PREVIEW artifact on a CONTEXT-FREE read, which is the only place this
   * question is still open.
   *
   * Gated the opposite way to every other rule here, and for the same reason
   * they are gated at all. They compare the artifact against an input the
   * context supplies, so they can only be asked WITH one. This one is a
   * property of the artifact alone and can only be asked WITHOUT one — because
   * when a context exists, `compiledAgainstOtherInputs` has already settled it:
   * `sharedStyleInputsId` folds the preview container into its breakpoint
   * contexts, so a preview artifact read under a published context has a
   * different stamp and is refused there, and one read under the SAME preview
   * context has a matching stamp and is correctly reused.
   *
   * Asking it unconditionally therefore did not add safety, it removed reuse:
   * every preview render recompiled the whole document even when the stamp
   * proved the inputs identical, which on a large editor document is the
   * editor's own hot path.
   *
   * What remains is the case no stamp can reach. Its viewport tiers are
   * `@container` rules naming a box that only the previewing surface declares,
   * so on a published page they match nothing.
   *
   * That is why the reasoning above — that withholding a sheet is worse than
   * serving a stale one — inverts here. A stale sheet is a page styled with
   * yesterday's values, which is wrong and recognisable. A preview sheet served
   * published renders the base tier and silently drops every breakpoint above
   * it, so the page looks deliberately styled at one width and stops responding
   * at every other. Refusing produces a page that is visibly unstyled, which
   * someone notices.
   *
   * `resolvePageStyles` is exported and returns this shape, so this is reachable
   * rather than theoretical: a caller can persist a preview result and hand it
   * back later with `styles` and no `styleContext`.
   */
  const compiledForPreview =
    styles !== undefined &&
    compileContext === undefined &&
    styles.previewContainer !== undefined;

  /*
   * A sheet the compiler wrote under an earlier stamp encoding, asked of the
   * stamp alone. With a context this is already part of the comparison above;
   * WITHOUT one it is the only check that can see it, and a stored sheet
   * written before blocks lost their outer margins would otherwise be served
   * with those margins on every context-free read.
   */
  const compiledUnderAnotherEncoding = !stampedUnderCurrentEncoding(
    styles?.sharedInputsId
  );

  /*
   * ONE answer to "may this stored sheet be served as it stands", used by both
   * the trust branch and the context-free refusal below.
   *
   * They were the same list written twice, once negated and once positive, so a
   * reason added to one and missed in the other would trust an artifact on one
   * path and withhold it on the other — for the same document, decided by
   * whether a context happened to be supplied. Naming it once makes the two
   * unable to disagree.
   */
  const untrusted =
    repairedDocument ||
    compiledFromAnotherTree ||
    compiledUnderAnotherPolicy ||
    compiledAgainstOtherInputs ||
    compiledForPreview ||
    compiledUnderAnotherEncoding;

  if (styles && !untrusted) {
    const normalized = normalizeStoredStyles(styles, document);
    // A refused artifact had its classes rebuilt, so the gated rules — written
    // against the classes it USED to carry — would select nothing. Nothing is
    // appended, which is the same answer the sheet itself got.
    return {
      styles: normalized.refused
        ? normalized.styles
        : withGatedRules(normalized.styles, document, drawsNothing),
    };
  }
  if (styles && untrusted && styleContext === undefined) {
    return untrustedWithoutContext(
      document,
      styles,
      blocks,
      drawsNothing,
      options,
      compiledUnderAnotherEncoding,
      compiledUnderAnotherPolicy
    );
  }
  if (compileContext) {
    // Compiled with the context built above rather than the caller's, for the
    // reasons `compileContextFor` states — including that a predicate injected
    // only by `PageRenderer` would mean every sheet written through this entry
    // keeps its drawless nodes' rules in `css` and carries no `gated` entry for
    // them, so republishing a page would never enable the drop.
    return compileToStyles(
      document,
      compileContext,
      options,
      sharedInputsId,
      drawsNothing
    );
  }
  return {
    styles: {
      css: "",
      classes: Object.fromEntries(nodeClassNames(documentNodeIds(document))),
    },
  };
}

/**
 * The breakpoints a compile with no site states: none, so every rule is
 * written at the base width.
 */
const NO_SITE_BREAKPOINTS = { viewport: [], container: [] };

/**
 * What a read with no compile context serves for a stored sheet it cannot
 * trust as it stands.
 *
 * Withheld, keeping the classes, for every reason but one: a sheet the
 * compiler before the current stamp encoding wrote. That one describes rules
 * the compiler no longer writes (the outer margins blocks used to carry);
 * serving it keeps them for good, and withholding it leaves the page
 * unstyled. So it is compiled again from the document under the compiler's
 * own defaults: no site breakpoints, the block defaults and child gaps from
 * `blocks`, the typographic baseline, and the artifact's own scope so a page
 * drawn beside another stays isolated.
 *
 * What only the site could supply is not there to compile with: a value an
 * author set at a breakpoint other than the base one, and a named class's
 * styles (the class library is site configuration). Those are left out, with
 * the compiler's own warnings, and the base styling of every node is kept.
 *
 * Not recompiled when the sheet was ALSO compiled under another fetch policy,
 * or when a policy is in force and the read was not handed its predicate: a
 * compile without the predicate would admit URLs the policy refuses, so it
 * withholds as before. With the predicate, the recompile judges every URL by it.
 */
function untrustedWithoutContext(
  document: BlockDocument,
  styles: PageStyles,
  blocks: BlockResolver,
  drawsNothing: (node: BlockNode) => boolean,
  options: ResolveStyleOptions,
  underAnotherEncoding: boolean,
  underAnotherPolicy: boolean
): ResolvedPageStyles {
  const withheld = {
    styles: { ...normalizeStoredStyles(styles, document).styles, css: "" },
  };
  if (!underAnotherEncoding || underAnotherPolicy) return withheld;
  const { mayFetchUrl } = options;
  if (options.fetchPolicyId !== undefined && mayFetchUrl === undefined) {
    return withheld;
  }
  const context = compileContextFor(
    {
      breakpoints: NO_SITE_BREAKPOINTS,
      ...(styles.scope === undefined ? {} : { scope: styles.scope }),
      ...(mayFetchUrl === undefined ? {} : { mayFetchUrl }),
    },
    document,
    blocks,
    drawsNothing,
    options.storedDocument
  );
  if (context === undefined) return withheld;
  return compileToStyles(
    document,
    context,
    options,
    sharedStyleInputsId(context),
    drawsNothing
  );
}

/**
 * One compile, packaged as the storable sheet plus the cascade behind it.
 *
 * Separated from the resolution above because the two answer different
 * questions. That one decides WHETHER to compile — which is where every
 * staleness rule lives — and this one performs the compile and shapes what
 * comes back. Keeping them together meant a reader had to hold the trust rules
 * in mind to follow the packaging, and the compiler's own options as well.
 */
function compileToStyles(
  document: BlockDocument,
  compileContext: StyleCompileContext,
  options: ResolveStyleOptions,
  sharedInputsId: string | undefined,
  drawsNothing: (node: BlockNode) => boolean
): ResolvedPageStyles {
  const compiled = compilePageCss(document, {
    ...compileContext,
    // Asked for only when a caller wants it. The compiler builds the array
    // lazily, so an ordinary render pays nothing for a facility the editor is
    // the only consumer of.
    ...(options.trace === true ? { trace: true } : {}),
  });
  const packaged = toPageStyles(
    compiled,
    compileContext.scope,
    options.fetchPolicyId,
    sharedInputsId
  );
  // The compiler holds every conditioned block's rules apart; in a tree being
  // drawn the blocks are the ones served, so theirs go back in, as a stored
  // sheet's do, by the same rule. A compile for saving keeps them apart.
  const styles =
    options.drawn === true
      ? withGatedRules(packaged, document, drawsNothing)
      : packaged;
  return compiled.trace === undefined
    ? { styles }
    : { styles, trace: compiled.trace };
}

/**
 * The compiled sheet alone, which is what almost every caller wants.
 *
 * DERIVED from {@link resolvePageStylesWithTrace} rather than computed beside
 * it. The two answers would otherwise be two resolutions of one question, and
 * this file already carries several reasons why a second answer about the same
 * document drifts from the first — every staleness test above exists because a
 * stored sheet and a fresh compile disagreed.
 */
export function resolvePageStyles(
  document: BlockDocument,
  styles: PageStyles | undefined,
  styleContext: StyleCompileContext | undefined,
  blocks: BlockResolver,
  repairedDocument = false,
  options: ResolveStyleOptions = {}
): PageStyles {
  return resolvePageStylesWithTrace(
    document,
    styles,
    styleContext,
    blocks,
    repairedDocument,
    options
  ).styles;
}

/**
 * CSS made safe to place inside a `<style>` element.
 *
 * A stylesheet has to be injected unescaped or every `>` in a selector breaks,
 * which means the one sequence that can end the element early has to be
 * neutralised here. `</style` inside the text closes the element in the HTML
 * parser regardless of CSS syntax, and everything after it becomes markup — the
 * shortest path from author-supplied custom CSS to script execution.
 *
 * Escaping the slash keeps the CSS meaning identical (a backslash escape is
 * valid inside a CSS string or comment, and the sequence is not valid CSS
 * anywhere else) while leaving the parser nothing to match.
 */
export function styleTextForInjection(css: string): string {
  return css.replace(/<\/(style)/gi, "<\\/$1");
}
