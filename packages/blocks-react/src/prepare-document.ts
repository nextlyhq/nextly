/**
 * The passes a stored document goes through before anything reads it.
 *
 * Gathered here because there is now more than one reader. The renderer turns a
 * document into HTML and the route helper turns it into metadata, and both must
 * describe the SAME page — a title derived from a node the HTML withholds is
 * wrong in a way nothing surfaces, and it is published off-site to every
 * crawler rather than only to the visitor.
 *
 * Each pass exists for a failure that was reachable without it, and the ORDER
 * is part of the contract:
 *
 * 1. **Envelope and format guard.** The envelope is database input, read
 *    before the repairs that make its contents safe; a corrupt column holding
 *    `null` throws on first property access. An unsupported `formatVersion`
 *    means nothing below can be trusted to mean what it says.
 * 2. **Shape repair**, against the caps the SITE configured — a site that
 *    raised `maxNodes` for long pages must not have its content truncated
 *    against the default.
 * 3. **Migration**, so a node behind its definition is read as its current
 *    props rather than its stored ones.
 * 4. **Condition gating**, which removes a node and its whole subtree from the
 *    output. This is the one whose absence leaks: a gated node is deliberately
 *    withheld, so anything derived from it publishes what was withheld.
 * 5. **Address repair**, which drops later duplicates of a repeated id — so a
 *    duplicate that never renders cannot speak for the page.
 * 6. **Known placeholders**, whose subtrees the renderer replaces wholesale. A
 *    node whose migration failed, whose type nothing registered, or whose
 *    stored version is ahead of its definition emits a placeholder and none of
 *    its content.
 *
 * Gathering the passes here does not by itself make two readers agree. Each
 * pass's ARGUMENTS are as much of the contract as the pass and its position:
 * the same six calls made with a different predicate or different caps is a
 * COPY of this pipeline rather than a use of it, and it diverges exactly as a
 * hand-written sequence would. The placeholder predicate handed to the address
 * repair is the sharp one, because omitting it is silent and changes which
 * nodes survive.
 *
 * @module prepare-document
 */
import {
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
  migrateDocument,
} from "@nextlyhq/blocks-engine";
import type {
  BlockDocument,
  BlockNode,
  DocumentLimits,
  StyleCompileContext,
} from "@nextlyhq/blocks-engine";

import type { BlockResolver } from "./resolver";
import { migrationSourceFor } from "./resolver";
import { dedupeNodeIds, sanitizeDocument } from "./sanitize";
import { pruneHiddenNodes } from "./visibility";

export interface PrepareDocumentArgs {
  /** Where block definitions come from. */
  resolver: BlockResolver;
  /** Caps this site holds its documents to. */
  limits?: DocumentLimits;
  /** Consulted for `limits` when none was given directly. */
  styleContext?: StyleCompileContext;
}

/**
 * Whether a node renders its own markup, decided from the document alone.
 *
 * Only the outcomes knowable WITHOUT calling the block: an unregistered type, a
 * failed migration, and a node stored ahead of the definition that would render
 * it. Whether a block throws or returns nothing is settled by calling it, which
 * is the renderer's business and not a document-shape question.
 */
function rendersOwnMarkup(node: BlockNode, resolver: BlockResolver): boolean {
  if (node.migrationFailed === true) return false;
  const definition = resolver.get(node.type);
  if (definition === undefined) return false;
  return node.version <= definition.version;
}

/** Drop the subtrees the renderer replaces with a placeholder. */
function pruneKnownPlaceholders(
  document: BlockDocument,
  resolver: BlockResolver
): BlockDocument {
  let changed = false;

  const walk = (nodes: BlockNode[]): BlockNode[] => {
    const kept: BlockNode[] = [];
    for (const node of nodes) {
      // The whole subtree goes: a placeholder replaces the node AND everything
      // it would have contained, so a healthy child of a broken parent never
      // reaches the page either.
      if (!rendersOwnMarkup(node, resolver)) {
        changed = true;
        continue;
      }
      if (!node.slots) {
        kept.push(node);
        continue;
      }
      // Only the slots the DEFINITION declares. A block never calls
      // `renderSlot` for a region it does not declare, so a stored slot left
      // behind by a hand edit or a definition that dropped one is not on the
      // page — and a leaf that declares none renders none at all.
      //
      // Pruned HERE rather than left to each reader, because this result is the
      // documented render-equivalent tree: the style compiler walks every
      // stored slot too, so an undeclared one would have its descendants'
      // rules — including any `url(...)` they carry — compiled into the sheet
      // for markup nobody receives. The SEO walk already refuses to descend
      // into them; this makes the tree itself say so, once, for every reader.
      const declared = resolver.get(node.type)?.slots ?? {};
      const slotKeys = Object.keys(node.slots);
      let slotsChanged = false;
      const slots: Record<string, BlockNode[]> = {};
      // Iterated in DECLARATION order, not stored order. The renderer asks for
      // its slots by calling `renderSlot` once per declaration, so declaration
      // order is the order the page presents — and this tree is documented as
      // the render-equivalent one. Emitting stored order instead leaves the
      // tree's own key order describing a page nobody is served, and makes two
      // documents that render identically compare as different.
      for (const name of Object.keys(declared)) {
        const children = node.slots[name];
        // Declared but never stored. Left ABSENT rather than added as an empty
        // array: this pass repairs what a reader would mis-render, and a slot
        // with no children renders nothing whether the key is there or not.
        // Adding it would rewrite every document that omits an optional slot.
        if (children === undefined) continue;
        const next = walk(children);
        if (next !== children) slotsChanged = true;
        slots[name] = next;
      }
      // Undeclared slots are dropped by never being visited above, so the
      // change is detected by comparing what survived against what was stored.
      // Counting is enough: every surviving name came from `declared`, so an
      // equal count means the same set.
      if (Object.keys(slots).length !== Object.keys(node.slots).length) {
        slotsChanged = true;
      }
      // A reorder is a change even when nothing was dropped or rewritten.
      // Without this a stored order that merely DIFFERS from the declaration
      // would compute the reordered object and then discard it.
      else if (
        Object.keys(slots).some((name, index) => name !== slotKeys[index])
      ) {
        slotsChanged = true;
      }
      if (slotsChanged) changed = true;
      kept.push(slotsChanged ? { ...node, slots } : node);
    }
    // `changed` tracks BOTH kinds of edit. Tracking only dropped nodes returned
    // the original array whenever every node survived — silently discarding the
    // rebuilt ones, so a slot-level change was computed and then thrown away.
    return changed ? kept : nodes;
  };

  const nodes = walk(document.nodes);
  return nodes === document.nodes ? document : { ...document, nodes };
}

/**
 * The document as the page will actually present it, or `null` when the page
 * presents nothing but a placeholder.
 *
 * `null` rather than an empty document, because the two mean different things
 * to a caller: an empty page has no content to describe, while an unreadable
 * one has content that cannot be trusted to mean anything. A metadata reader
 * must not describe either, and only the second is worth a different message.
 */
export function prepareDocumentForRead(
  document: BlockDocument,
  args: PrepareDocumentArgs
): BlockDocument | null {
  if (
    typeof document !== "object" ||
    document === null ||
    Array.isArray(document)
  ) {
    return null;
  }
  if (document.formatVersion !== DOCUMENT_FORMAT_VERSION) return null;

  const limits = args.limits ?? args.styleContext?.limits ?? DEFAULT_LIMITS;
  const sanitized = sanitizeDocument(document, limits);
  const { doc } = migrateDocument(sanitized, migrationSourceFor(args.resolver));
  // The predicate matters as much as the pass: a placeholder replaces its whole
  // subtree, so a child under one holds no address on the page. Deduping without
  // it lets that unreachable child RESERVE an id and drop the later node that
  // reuses it — and the placeholder prune then removes the reserving parent too,
  // leaving neither node. The renderer keeps the later node, so the two readers
  // would describe different pages.
  const visible = dedupeNodeIds(pruneHiddenNodes(doc), node =>
    rendersOwnMarkup(node, args.resolver)
  );
  const prepared = pruneKnownPlaceholders(visible, args.resolver);
  // A document whose nodes were ALL placeholders presents nothing but
  // placeholders, which is the case `null` names. Returning the empty document
  // instead would report "a page with no content" for a page that has content
  // it cannot render — the exact distinction this return value exists to draw,
  // and a caller spreading its own fallbacks over the result would describe the
  // page as empty rather than as unreadable.
  //
  // A document that was ALREADY empty stays empty: nothing was withheld there.
  // Compared against the tree AFTER gating, not against the stored one. A page
  // whose blocks are all condition-gated is legitimately empty for this
  // visitor — nothing failed to render, it was withheld on purpose — and
  // reporting it as unreadable would show an unsupported-content fallback for a
  // page that is working exactly as configured. Only content that survived
  // gating and then turned out to be unrenderable is a placeholder-only page.
  if (visible.nodes.length > 0 && prepared.nodes.length === 0) return null;
  return prepared;
}
