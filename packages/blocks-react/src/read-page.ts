/**
 * The tree to read and the stylesheet that describes it, resolved together.
 *
 * Together because neither answer is correct alone. Preparing a document drops
 * the nodes the page will not present, and whether anything was dropped is the
 * fact that decides what a STORED stylesheet may still be trusted for — but the
 * prepared tree no longer contains the evidence, so a caller holding only that
 * tree cannot supply it and cannot know it is missing.
 *
 * `PageRenderer` never had the problem: it runs the passes itself and still
 * holds each stage when it resolves styles. A consumer assembling the two by
 * hand holds only the result, and the documented pairing therefore resolved
 * styles with `repairedDocument` left at its default. That is sound for every
 * pruned node whose rules the artifact carries per node, and unsound for the
 * rest of what a pruned node put in the sheet: the block-type tier and the named
 * classes it referenced are keyed by TYPE and by CLASS, not by node, so they
 * stay in `css` with nothing left on the page to justify them.
 *
 * @module read-page
 */
import type {
  BlockDocument,
  RemotePatternInput,
  StyleCompileContext,
  UnresolvedInstance,
} from "@nextlyhq/blocks-engine";

import type {
  DocumentReadStages,
  PrepareDocumentArgs,
} from "./prepare-document";
import { prepareDocumentReadStages, readingViewOf } from "./prepare-document";
import type { BlockResolver } from "./resolver";
import type { PageStyles } from "./styles";
import {
  effectiveCompile,
  gatedMapCoversPrunedNodes,
  hasDuplicateNodeIds,
  migrationChangedWhatDraws,
  readableGatedRules,
  resolvePageStyles,
} from "./styles";

export interface ReadPageArgs extends PrepareDocumentArgs {
  /** The stylesheet artifact stored with the page, when it has one. */
  styles?: PageStyles;
  /**
   * The inputs to compile a fresh sheet, when the caller has them.
   *
   * Its presence is what lets a repaired document be recompiled instead of
   * having its stored sheet withheld, so a caller that can supply it should.
   */
  styleContext?: StyleCompileContext;
  /**
   * The hosts this site allows a stylesheet to fetch from.
   *
   * A stylesheet fetches too: `background-image: url(...)` is a request the
   * browser makes on every page the rule applies to, so the host's list has to
   * reach the compile as well as the blocks.
   *
   * The policy IDENTITY is derived from these rather than taken as a field, so
   * it changes exactly when the policy does and there is nothing to remember to
   * bump. A caller with its own `mayFetchUrl` states which policy that predicate
   * is through `styleContext.fetchPolicyId`; one that does not gets an identity
   * no artifact can carry, so every stored sheet recompiles rather than being
   * reused under rules that never judged it.
   */
  remotePatterns?: readonly RemotePatternInput[];
}

export interface PreparedPage {
  /**
   * The tree to render or describe, or `null` when the page presents nothing
   * readable — an envelope this build cannot speak, or a page whose every node
   * resolved to a placeholder.
   */
  document: BlockDocument | null;
  /** The stylesheet for that tree. */
  styles: PageStyles;
  /**
   * Every component definition this page read, unresolvable ones included.
   *
   * Surfaced here because the caller that fetched those definitions is the one
   * that has to tag the page with them, and it cannot re-derive the transitive
   * set — only the composition knows what a definition itself referenced.
   */
  referencedComponents: readonly string[];
  /** Every instance that could not be composed, and why. */
  unresolvedInstances: readonly UnresolvedInstance[];
}

/**
 * Whether the passes changed the tree in a way a STORED stylesheet cannot
 * describe.
 *
 * Four of the five stage boundaries count, and the fifth is excluded for a
 * reason that would otherwise blank every page:
 *
 * - **The caps pass**, because a document over its limits is truncated, and the
 *   sheet was compiled from the untruncated one.
 * - **Condition gating**, but only when the artifact cannot ACCOUNT for what it
 *   removed. The per-node map was built for this case and usually covers it, so
 *   refusing categorically would cost every page carrying a conditioned block
 *   its whole stylesheet. Coverage is asked through the same check the renderer
 *   uses, which is stricter than "every removed node has an entry": a block
 *   type's defaults are emitted ONCE into the main sheet and shared, so removing
 *   the LAST node of a type leaves that type's rule — and any `url(...)` in it —
 *   published for a block nobody was served. Only a recompile can drop a
 *   type-level rule, so the artifact must not claim to cover that.
 * - **Address repair**, for the reason that first looked like grounds to exclude
 *   it. The compiler refuses to style duplicated ids at all — there is one class
 *   for the id and no way to tell a renderer about a second — so the sheet holds
 *   no node-local rules for EITHER. It still NAMES the id in its class map, so
 *   the artifact reads as usable and is trusted, and the node that survived
 *   deduplication renders carrying a class no rule targets. Asked of the
 *   MIGRATED tree rather than by comparing stages, because gating can remove the
 *   twin first: the collision then never reaches the address pass, the two
 *   stages compare equal, and the survivor is still missing its rules. The
 *   pre-gating document is the only place that evidence survives.
 * - **The placeholder pass**, because a node that resolves to a placeholder is
 *   gone for every visitor until the page is republished, while the tiers it
 *   pulled into the sheet stay behind.
 *
 * **Migration** is the exclusion, as a STAGE COMPARISON. It allocates
 * unconditionally, so comparing it against the caps pass is true on every
 * document ever read; included that way, every page would report as repaired and
 * every stored sheet would be withheld on the happy path.
 *
 * What migration can still do is change what a node DRAWS, and that is asked
 * separately below — of the nodes the engine reported rewriting rather than by
 * comparing the two documents, so the ordinary page pays nothing for it.
 */
function storedSheetCannotDescribe(
  document: BlockDocument,
  stages: DocumentReadStages,
  styles: PageStyles | undefined,
  resolver: BlockResolver
): boolean {
  const gatedRules = readableGatedRules(styles);
  // An ABSENT map means "compiled before the split existed", not "nothing was
  // gated", so only a readable one licenses skipping the recompile.
  const gatingCovered =
    gatedRules !== undefined &&
    gatedMapCoversPrunedNodes(stages.migrated, stages.gated, gatedRules);
  return (
    stages.sanitized !== document ||
    // Composition. A stored sheet was compiled from the page's OWN nodes;
    // inlining a component adds nodes whose ids that sheet never named, so
    // each of them would render unstyled while the sheet looked intact.
    //
    // Covered TODAY by the unaccounted-node clause below, and stated here
    // anyway because that coverage is incidental rather than structural: it
    // holds only because the compiler assigns a class to EVERY node, so
    // removing the instance always leaves the artifact naming one the document
    // no longer has. Measured, not assumed — and a change to sparse class
    // assignment would remove it silently, which is the wrong way for a
    // stylesheet guarantee to lapse. No test can separate the two while both
    // hold; break-verified as a survivor rather than left looking covered.
    stages.resolved !== stages.sanitized ||
    hasDuplicateNodeIds(stages.migrated) ||
    (stages.gated !== stages.migrated && !gatingCovered) ||
    stages.prepared !== stages.deduped ||
    migrationChangedWhatDraws(stages, resolver, styles)
  );
}

/**
 * Read a stored page: its presentable tree and the stylesheet for it.
 *
 * This is the whole documented flow for a consumer outside `PageRenderer`.
 * Preparing the document and resolving its styles as two calls is what leaves
 * the second one unable to see what the first removed — and the gap is silent,
 * because the sheet it produces is a valid sheet describing a tree that is one
 * pass out of date.
 *
 * Returns the reading view of the document, so `null` means "do not present
 * this page" rather than "this page is empty". Styles come back either way: a
 * caller that decides to show a fallback still has the page's scope and class
 * names, which the rest of the system expects to exist.
 */
export function preparePageForRead(
  document: BlockDocument,
  args: ReadPageArgs
): PreparedPage {
  const stages = prepareDocumentReadStages(document, args);
  if (stages === null) {
    // An unreadable envelope has no tree to compile against and no ids to name,
    // so there is nothing to resolve. Answered directly rather than by handing
    // the compiler a document it already refused.
    return {
      document: null,
      styles: { css: "", classes: {} },
      referencedComponents: [],
      unresolvedInstances: [],
    };
  }

  // What a caller supplied is not what this page compiles with. Asked through
  // the SAME derivation the renderer uses, so a page read here and the same page
  // rendered cannot disagree about its scope, its caps or which fetch policy
  // judged its stored sheet.
  const compile = effectiveCompile({
    styleContext: args.styleContext,
    styles: args.styles,
    limits: args.limits,
    remotePatterns: args.remotePatterns,
  });
  const styles = resolvePageStyles(
    stages.prepared,
    args.styles,
    compile.context,
    args.resolver,
    storedSheetCannotDescribe(document, stages, args.styles, args.resolver),
    { fetchPolicyId: compile.fetchPolicyId }
  );

  // Compiled against the PREPARED tree whatever the reading view decides. The
  // two answer different questions: a page presenting nothing but placeholders
  // is not worth showing, but its scope and class names are still the ones the
  // rest of the system expects, and rebuilding them from an empty document would
  // hand the caller a sheet for a page that does not exist.
  return {
    document: readingViewOf(stages),
    styles,
    referencedComponents: stages.referencedComponents,
    unresolvedInstances: stages.unresolvedInstances,
  };
}
