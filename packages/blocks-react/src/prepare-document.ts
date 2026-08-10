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
      let slotsChanged = false;
      const slots: Record<string, BlockNode[]> = {};
      for (const [name, children] of Object.entries(node.slots)) {
        const next = walk(children);
        if (next !== children) slotsChanged = true;
        slots[name] = next;
      }
      kept.push(slotsChanged ? { ...node, slots } : node);
    }
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
  return pruneKnownPlaceholders(visible, args.resolver);
}
