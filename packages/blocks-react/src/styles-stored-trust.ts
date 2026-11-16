/**
 * Whether a stored artifact can be served for the document in hand: read and
 * repaired against it, its per-node gated rules read through one predicate,
 * and the checks that tell a stored sheet has gone stale.
 *
 * @module styles-stored-trust
 */
import {
  nodeAtPointer,
  nodeClassNames,
  walkNodes,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";

import type { DocumentReadStages } from "./prepare-document";
import type { BlockResolver } from "./resolver";
import type { PageStyles } from "./styles-artifact";
import { drawlessTestFor } from "./styles-block-inputs";

/** Every node id in a document, in document order. */
export function documentNodeIds(document: BlockDocument): string[] {
  const ids: string[] = [];
  walkNodes(document.nodes, node => {
    ids.push(node.id);
  });
  return ids;
}

/**
 * A stored artifact made safe to render against.
 *
 * The artifact is a database record, so it can predate the current shape or
 * have been written by an older version, and neither half can be taken on
 * trust. A missing `classes` map is the dangerous one: the class lookup happens
 * while assembling a block's arguments, BEFORE the try/catch around its render,
 * so one bad stylesheet row would throw in the page component where no block
 * boundary can contain it.
 *
 * Repairs rather than refuses. Classes are recomputed from the document by the
 * same helper the compiler uses, so a document with a broken artifact renders
 * unstyled instead of not at all — and the CSS is dropped with them, since a
 * stylesheet written against classes nobody now carries would match nothing.
 */
interface NormalizedStyles {
  styles: PageStyles;
  /**
   * Whether the artifact's own classes were unusable and had to be rebuilt.
   *
   * Carried explicitly rather than inferred from an empty `css`, because the two
   * are different states that happen to look alike. A page whose only styled
   * node is condition-gated compiles to a legitimately EMPTY main sheet with all
   * its rules in `gated` — reading that emptiness as a refusal would discard the
   * one thing that page's styling consists of.
   */
  refused: boolean;
}

/**
 * Whether the artifact describes nodes this document does not hold AND cannot account for them.
 *
 * `normalizeStoredStyles` checks the other direction — every node needs a class. This catches the
 * artifact describing MORE than it was handed, which is the signature of a tree since pruned.
 *
 * An absent node is only a problem when the artifact does NOT carry its rules separately. When it
 * does, the split has already done its job: those rules were never in `css`, so serving `css` and
 * appending only the survivors is correct and this must not fire. The rule is therefore the same
 * one the renderer applies — every missing node needs a usable gated entry — rather than a second,
 * blunter one that would withhold the sheet on exactly the pages the split exists for.
 */
export function artifactDescribesUnaccountedNodes(
  styles: PageStyles,
  document: BlockDocument
): boolean {
  const map: unknown = styles.classes;
  if (typeof map !== "object" || map === null || Array.isArray(map)) {
    return false;
  }
  const gated = readableGatedRules(styles);
  const present = new Set(documentNodeIds(document));
  return Object.keys(map).some(
    id => !present.has(id) && !isRecordedGatedEntry(gated?.[id])
  );
}

export function normalizeStoredStyles(
  styles: PageStyles,
  document: BlockDocument
): NormalizedStyles {
  // Usable means more than "is an object". A stylesheet whose map is empty,
  // missing a node, or holding a non-string value leaves that node with only
  // its block-type class while the stale CSS still ships — every node-specific
  // selector matching nothing, and no error to say why. `{}` is the exact
  // result of `JSON.stringify` on a `Map`, so it is the shape most likely to
  // arrive.
  const map: unknown = styles.classes;
  const classesUsable =
    typeof map === "object" &&
    map !== null &&
    !Array.isArray(map) &&
    documentNodeIds(document).every(id => {
      const value = (map as Record<string, unknown>)[id];
      return typeof value === "string" && value.length > 0;
    });
  if (classesUsable) {
    return {
      styles: typeof styles.css === "string" ? styles : { ...styles, css: "" },
      refused: false,
    };
  }
  return {
    styles: {
      css: "",
      classes: Object.fromEntries(nodeClassNames(documentNodeIds(document))),
      ...(styles.scope === undefined ? {} : { scope: styles.scope }),
    },
    refused: true,
  };
}

/**
 * Whether the compiler RECORDED this node — the coverage question.
 *
 * An empty string is a legitimate record, not a missing one. A gated node with no node-local or
 * device rules of its own compiles to `serializeRules([])`, which is `""`, and a gated ancestor's
 * unstyled child does the same. Rejecting it would classify a perfectly fresh artifact as
 * uncovered, forcing the repair — and on the ordinary stored-artifact path with no compile context
 * that clears the WHOLE sheet, so every visible sibling loses its styling because one hidden node
 * happened to carry no rules.
 *
 * Deliberately different from {@link isUsableGatedEntry}, which answers a different question. The
 * two were briefly one function and that is what produced this defect: coverage asks whether the
 * node was accounted for, delivery asks whether there is anything to append, and `""` answers yes
 * to the first and no to the second.
 */
export function isRecordedGatedEntry(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * Whether a gated entry carries rules worth appending — the DELIVERY question.
 *
 * Non-empty, because appending `""` would add a blank line to the sheet for every gated node that
 * styles nothing and make an otherwise byte-identical page differ.
 */
export function isUsableGatedEntry(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/**
 * The gated rules a stored artifact carries, or `undefined` when it carries none it can be read.
 *
 * ONE definition, because two places ask this question: the renderer, deciding whether the artifact
 * covers gating well enough to skip the repair, and the delivery (`withGatedRules`), deciding whether
 * to append. When they disagreed the artifact counted as coverage while its map went unread, so the
 * repair was skipped and the stale sheet shipped with the hidden node's rules still in it — the leak,
 * arrived at through two readings of one fact.
 *
 * The artifact is a database record, so `gated` can be null, an array, or a string. Anything not a
 * plain record is treated as ABSENT, which is the safe direction: absent means the sheet predates
 * the split, and gating then forces the recompile-or-withhold path.
 */
export function readableGatedRules(
  styles: PageStyles | undefined
): Readonly<Record<string, unknown>> | undefined {
  const gated: unknown = styles?.gated;
  if (typeof gated !== "object" || gated === null || Array.isArray(gated)) {
    return undefined;
  }
  return gated as Readonly<Record<string, unknown>>;
}

/**
 * Whether migration turned a node that DREW into one that draws nothing.
 *
 * The stored sheet was compiled while the node still drew, so its rules sit in
 * the main `css` with no gated entry, and every later pass agrees the node is
 * present and registered. Nothing else in this function can see it: the
 * drawless predicate decides which per-node entries to APPEND and cannot
 * withdraw a rule already embedded in the sheet, and the stage comparisons all
 * read equal because no pass REMOVED anything. Only a recompile drops it.
 *
 * Asked ONLY of the nodes the engine reported rewriting. The predicate runs a
 * block's own declaration, so asking it of every node on every read would put
 * plugin code in the path of the ordinary case, where nothing migrated and the
 * answer cannot have changed. That list is empty for any page whose nodes are
 * already current, which is nearly all of them, and this returns before walking
 * anything.
 *
 * The reverse flip needs no handling: a node that starts drawless and begins to
 * draw has no rules in the stored sheet to be stale, and the recompile that
 * gives it some is triggered by the sheet not describing it.
 */
export function migrationChangedWhatDraws(
  stages: DocumentReadStages,
  resolver: BlockResolver,
  styles: PageStyles | undefined
): boolean {
  if (stages.rewritten.length === 0) return false;
  const drawsNothing = drawlessTestFor(resolver);
  const gatedRules = readableGatedRules(styles);

  return stages.rewritten.some(entry => {
    const after = nodeAtPointer(stages.migrated, entry.path);
    if (after === undefined) return false;
    // Nothing to be stale about a node that draws nothing now either.
    if (!drawsNothing(after)) return false;

    // Whether the node DREW when the sheet was compiled is read off the sheet
    // rather than recomputed. The compiler records every node it withheld, by
    // id, under its own combined decision — condition, drawless, or inherited
    // from an ancestor — so an entry means "these rules are not in `css`" and
    // its absence means they are.
    //
    // Read rather than re-derived for two reasons. Reapplying the gating rule
    // here would be a second implementation of a decision the compiler owns,
    // and the two only agree while both are maintained together: the compiler
    // may widen what it gates, or change how gating descends a subtree, and a
    // copy that does not follow classifies the same node differently while
    // still looking correct. And the predicate cannot answer the question at
    // all for a node whose migration RENAMED the prop `rendersNothing` reads:
    // today's predicate over yesterday's props reports drawless for a node that
    // drew, so the flip disappears. The artifact carries the answer the schema
    // of the day produced, which is the only version-independent source there
    // is.
    if (gatedRules !== undefined) {
      // Asked through `isRecordedGatedEntry`, the same predicate delivery and
      // pruning coverage use, rather than by testing for the key. A stored map
      // is input like any other: a row carrying `{ "a": null }` has the key and
      // records nothing, so key presence alone would report the node withheld
      // and keep serving rules — and any `url(...)` in them — that nothing
      // accounts for.
      return (
        typeof after.id === "string" &&
        !isRecordedGatedEntry(gatedRules[after.id])
      );
    }

    // An artifact compiled before the per-node map existed carries no record,
    // so the stored props are the only evidence left. This is the derivation
    // above, kept ONLY for those artifacts and inheriting their limitation: a
    // migration that renamed the prop the predicate reads is invisible here.
    const before = nodeAtPointer(stages.sanitized, entry.path);
    return before !== undefined && !drawsNothing(before);
  });
}

/**
 * Whether the artifact holds the OWN rules of every node the prune removed.
 *
 * "A map is present" is not coverage. A stored artifact can be stale relative to the document it
 * is rendered with — compiled when one node was unconditional, so its rules are in `css`, while a
 * different node was already gated and has an entry. The map exists, but it does not cover the
 * node that was actually pruned, and serving the stored sheet publishes that node's rules and
 * asset URLs.
 *
 * The compiler writes an entry for EVERY node it holds back, including one with no styles of its
 * own, so an id missing from the map means the artifact was compiled when that node was still
 * being served. That makes presence-per-removed-id an exact test rather than a heuristic.
 *
 * The ENTRY has to be usable, not merely present. A key whose value the delivery refuses to read
 * certifies coverage that never reaches the sheet, which is the same divergence one value deeper.
 *
 * This is the NODE-LOCAL half on its own, because the two prunes that ask it need different
 * amounts. Written once so neither can drift from the other on the part they share.
 */
export function gatedEntriesCoverRemovedNodes(
  before: BlockDocument,
  after: BlockDocument,
  gated: Readonly<Record<string, unknown>>
): boolean {
  const surviving = new Set<string>();
  walkNodes(after.nodes, node => surviving.add(node.id));
  let covered = true;
  walkNodes(before.nodes, node => {
    if (surviving.has(node.id)) return;
    if (!isRecordedGatedEntry(gated[node.id])) covered = false;
  });
  return covered;
}

/**
 * Whether the artifact's gated map accounts for every node the visibility prune removed.
 *
 * The node-local rules, plus one thing more. The map holds a node's OWN rules; a block type's
 * defaults are shared, emitted once per type into the main sheet, and stay there — so when pruning
 * removes the last instance of a type, the stored sheet still publishes that type's defaults, and
 * any `url(...)` in them, for a block nobody was served. Only a recompile can drop a type-level
 * rule, so the artifact cannot cover this case and must not claim to.
 *
 * Asked HERE and not of a draws-nothing node, and the difference is what the two prunes are for. A
 * condition withholds content from a reader, so the block a page was built from is itself part of
 * what is being withheld and a rule naming that type says something. A block that draws nothing is
 * an ordinary node the site uses and will draw again as soon as it is filled in; its type's
 * defaults come from the block package rather than from the document, and refusing coverage over
 * them would leave the drop unreachable for the page with one image and no second one.
 */
export function gatedMapCoversPrunedNodes(
  before: BlockDocument,
  after: BlockDocument,
  gated: Readonly<Record<string, unknown>>
): boolean {
  const survivingTypes = new Set<string>();
  walkNodes(after.nodes, node => survivingTypes.add(node.type));
  const surviving = new Set<string>();
  walkNodes(after.nodes, node => surviving.add(node.id));
  let covered = gatedEntriesCoverRemovedNodes(before, after, gated);
  walkNodes(before.nodes, node => {
    if (surviving.has(node.id)) return;
    if (!survivingTypes.has(node.type)) covered = false;
  });
  return covered;
}

/**
 * Whether any id appears on more than one node.
 *
 * The compiler suppresses the node-local rules of every node sharing an id, so a stored sheet
 * compiled from such a document is missing them — and stays missing them after a prune removes the
 * duplicate that made the collision visible.
 */
export function hasDuplicateNodeIds(document: BlockDocument): boolean {
  const seen = new Set<string>();
  let duplicate = false;
  walkNodes(document.nodes, node => {
    if (seen.has(node.id)) duplicate = true;
    seen.add(node.id);
  });
  return duplicate;
}
