import {
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
  PAGE_ROOT_CLASS,
  migrateDocument,
  type BlockDocument,
  type BlockNode,
  type DocumentLimits,
  type StyleCompileContext,
} from "@nextlyhq/blocks-engine";
import type { ReactElement, ReactNode } from "react";

import { BlockList } from "./block-boundary";
import { createStandaloneContext, type PageContext } from "./context";
import { BlockPlaceholder } from "./placeholder";
import {
  registeredBlocks,
  migrationSourceFor,
  type BlockResolver,
} from "./resolver";
import { dedupeNodeIds, sanitizeDocument } from "./sanitize";
import {
  resolvePageStyles,
  styleTextForInjection,
  type PageStyles,
} from "./styles";
import { pruneHiddenNodes } from "./visibility";

export interface PageRendererProps {
  /** The stored document to render. */
  document: BlockDocument;
  /**
   * What every block render receives. Defaults to a context wired to nothing,
   * which is what makes a document renderable with no CMS present.
   */
  context?: PageContext;
  /** Where block definitions come from. Defaults to the process registry. */
  blocks?: BlockResolver;
  /**
   * The stylesheet compiled when the document was saved, with the class each
   * node was assigned. Supplying it is the normal path.
   */
  styles?: PageStyles;
  /**
   * Compile the stylesheet during this render instead, for a consumer with no
   * write path. Ignored when `styles` is supplied.
   */
  styleContext?: StyleCompileContext;
  /** Shown in place of an asynchronous block until its output arrives. */
  blockFallback?: ReactNode;
  /**
   * The caps this site holds its documents to, used while repairing the stored
   * shape. A site that raised `maxNodes` for long pages validates and compiles
   * against that number, so repairing against the default would truncate
   * content that is legitimately there. Falls back to the compile context's
   * limits, then to the engine defaults.
   */
  limits?: DocumentLimits;
}

/**
 * Whether a node will render its own host markup, decided BEFORE rendering.
 *
 * Two passes need this answer early: address repair, which must not let a node
 * that emits no `id` reserve one away from a healthy sibling, and the stylesheet
 * decision, which must not publish rules compiled for markup that never ships.
 *
 * Only the placeholder outcomes that are knowable from the document and the
 * resolver are covered — an unregistered type, a failed migration, and a node
 * stored ahead of the definition that would render it. All three are pure
 * comparisons.
 *
 * The rest are NOT knowable here, and deliberately so: whether a block throws,
 * returns something unrenderable, or renders a given slot at all is only
 * settled by calling it, which happens inside the boundary further down. A node
 * that ends in one of those placeholders can still reserve an address it never
 * uses. Closing that would mean deciding addresses after render, which is a
 * different design than compiling the document once up front.
 */
function rendersOwnMarkup(node: BlockNode, resolver: BlockResolver): boolean {
  if (node.migrationFailed === true) return false;
  const definition = resolver.get(node.type);
  if (definition === undefined) return false;
  return node.version <= definition.version;
}

/**
 * The tree a stylesheet should be compiled from.
 *
 * A node that resolves to a placeholder emits only a hidden marker, so every
 * rule compiled for the markup it WOULD have rendered matches nothing and ships
 * anyway, carrying whatever those rules referenced. Dropping the node from the
 * style input is what stops that.
 *
 * It has to be a SEPARATE tree from the one that renders. The render still
 * needs the node, because drawing its placeholder is how the failure becomes
 * visible; only the stylesheet should pretend it was never there. Marking the
 * document "repaired" is not enough on its own, because recompiling from a tree
 * that still contains the node produces the same rules again.
 *
 * The subtree goes with it: a placeholder replaces the node entirely, so its
 * children never reach the page either.
 *
 * Returns the ORIGINAL document when every node renders, so the common case
 * allocates nothing and the caller can compare by identity.
 */
function pruneKnownPlaceholders(
  document: BlockDocument,
  resolver: BlockResolver
): BlockDocument {
  let changed = false;

  const prune = (nodes: BlockNode[]): BlockNode[] => {
    const kept: BlockNode[] = [];
    for (const node of nodes) {
      if (!rendersOwnMarkup(node, resolver)) {
        changed = true;
        continue;
      }

      const slots = node.slots;
      if (slots === undefined) {
        kept.push(node);
        continue;
      }

      let slotsChanged = false;
      const nextSlots: Record<string, BlockNode[]> = {};
      for (const [name, children] of Object.entries(slots)) {
        const pruned = prune(children);
        if (pruned !== children) slotsChanged = true;
        nextSlots[name] = pruned;
      }
      kept.push(slotsChanged ? { ...node, slots: nextSlots } : node);
    }
    return changed ? kept : nodes;
  };

  const nodes = prune(document.nodes);
  return changed ? { ...document, nodes } : document;
}

/**
 * Renders a block document as React.
 *
 * A Server Component, and synchronous: nothing at this level needs to wait, so
 * the page's own shell is not held behind a promise. Individual blocks that ARE
 * asynchronous suspend on their own, and stream in independently.
 *
 * Three things happen here that cannot happen inside a block:
 *
 * 1. **Migration.** Stored nodes carry the schema version they were written
 *    against, and the forgiving pass brings each one up to its block's current
 *    version. Nodes that cannot be upgraded are flagged rather than dropped, so
 *    a document that outran a block's migrations still renders everything else.
 * 2. **Styles.** The stylesheet and the node-to-class map are resolved once for
 *    the whole document, because the class a node gets depends on every other
 *    node's id — two ids can hash alike, and only a pass over all of them sees
 *    it.
 * 3. **The page root.** The compiler anchors every selector at the page root
 *    class, so the element carrying it has to exist or no rule matches
 *    anything.
 */
export function PageRenderer({
  document,
  context,
  blocks,
  styles,
  styleContext,
  blockFallback,
  limits,
}: PageRendererProps): ReactElement {
  const resolver = blocks ?? registeredBlocks();
  const pageContext = context ?? createStandaloneContext();

  // Migrated against the SAME resolver that will render, so the versions nodes
  // are upgraded to are the versions the definitions doing the rendering
  // expect. Reading migrations from the global registry while rendering from a
  // fixture set would produce props no one asked for and no error to explain
  // them.
  // The shape is made sound before anything walks it. The engine's migrator,
  // tree helpers and style compiler all assume a well-formed forest, and this
  // renderer is handed whatever the database returned — a slot holding an
  // object instead of a list would otherwise throw here, in the page component
  // itself, where no per-block boundary can contain it.
  // A document written by a newer formatter is refused rather than read. The
  // envelope itself may mean something different, so migrating and rendering
  // whatever sits under `nodes` shows content that was never authored this way
  // — worse than showing nothing, because nothing announces itself.
  // The ENVELOPE is database input too, and it is read before any of the
  // repair passes that make its contents safe. A corrupt JSON column holding
  // `null` throws on the first property access below, in the page component
  // itself, where no block boundary exists to contain it. (A primitive does
  // not throw — it just reads `undefined` — but it is no more renderable, so
  // both are refused the same way.)
  if (
    typeof document !== "object" ||
    document === null ||
    Array.isArray(document)
  ) {
    return (
      <div className={PAGE_ROOT_CLASS}>
        <BlockPlaceholder reason="unsupported-format" type="document" />
      </div>
    );
  }

  if (document.formatVersion !== DOCUMENT_FORMAT_VERSION) {
    return (
      <div className={PAGE_ROOT_CLASS}>
        <BlockPlaceholder
          reason="unsupported-format"
          type={`formatVersion ${String(document.formatVersion)}`}
        />
      </div>
    );
  }

  const sanitized = sanitizeDocument(
    document,
    limits ?? styleContext?.limits ?? DEFAULT_LIMITS
  );
  const { doc } = migrateDocument(sanitized, migrationSourceFor(resolver));

  // The scope comes from whichever input supplied the stylesheet, never from a
  // separate prop. Two inputs would have to agree, and when they did not the
  // root would carry a class the selectors never mention, so every compiled
  // rule would match nothing while both inputs looked correct on their own.
  // Gated nodes leave the tree BEFORE styles are resolved, so the stylesheet
  // and the markup are compiled from the same document. Filtering only the
  // render would withhold a gated node's HTML while still publishing its
  // scoped CSS, and with it whatever that CSS referenced.
  const pruned = pruneHiddenNodes(doc);

  // Addresses are made unique LAST, over what will actually render. A gated node
  // never reaches the page, so letting it reserve a node id or a DOM id would
  // take that address from a visible node for nothing: the visible one would be
  // dropped or stripped of its anchor, and the node it collided with would then
  // be pruned anyway.
  const visible = dedupeNodeIds(pruned);

  // Whether the tree that renders is the tree the stored stylesheet was
  // compiled from. Each pass returns its input unchanged when it had nothing to
  // do, so identity is the signal — and gating is only one of three ways the
  // answer can be no. Shape repair drops nodes whose identity fields are
  // unreadable, and address repair drops a repeat and strips a duplicated
  // `cssId`; in every case the stored sheet still carries rules for something
  // that is no longer on the page, and with duplicate node ids those rules
  // target the class the SURVIVING node now wears. So the sheet is recompiled
  // where it can be and withheld where it cannot, for any of the three.
  //
  // A knowable placeholder counts as a fourth. Such a node emits only a hidden
  // marker, so a stored sheet compiled for the markup it WOULD have rendered
  // ships rules for content that is not on the page, including whatever those
  // rules reference. Identity alone misses it: the node is skipped by the
  // predicate above, so when nothing else collided the tree comes back
  // unchanged and the stale sheet would be trusted. Skipping the reservation
  // and then trusting the sheet is worse than either on its own, because the
  // colliding case previously repaired the tree and therefore recompiled.
  // Compiled from a tree with the knowable placeholders removed, while the
  // render keeps them so their placeholders still appear.
  const styleInput = pruneKnownPlaceholders(visible, resolver);

  const repairedDocument =
    sanitized !== document ||
    pruned !== doc ||
    visible !== pruned ||
    styleInput !== visible;

  // Recompiling after pruning must not lose what the stored artifact and the
  // renderer knew. `scope` lives on the artifact rather than in the compile
  // context, and the effective limits come from the prop — so passing the raw
  // context would rebuild a scoped page unscoped, letting its rules reach
  // another document rendered beside it, and would repair against default caps
  // a caller had deliberately raised.
  const effectiveLimits = limits ?? styleContext?.limits ?? DEFAULT_LIMITS;
  const compileContext =
    styleContext === undefined
      ? undefined
      : {
          ...styleContext,
          limits: effectiveLimits,
          // Only a STRING scope is carried over. The artifact is a database
          // record, so `scope` can be null or a number, and the compiler
          // dereferences it before any block boundary exists — a malformed one
          // would fail the whole page rather than render it unstyled.
          ...(styleContext.scope === undefined &&
          typeof styles?.scope === "string"
            ? { scope: styles.scope }
            : {}),
        };

  const { css, classes, scope } = resolvePageStyles(
    styleInput,
    styles,
    compileContext,
    resolver,
    repairedDocument
  );
  const rootClassName = scope ? `${PAGE_ROOT_CLASS} ${scope}` : PAGE_ROOT_CLASS;

  return (
    <div className={rootClassName}>
      {css ? (
        // Injected as raw text rather than as a child, because React escapes a
        // text child and a stylesheet cannot survive that: `&` and `>` are
        // ordinary in selectors and would arrive as entities. What that costs
        // is neutralised in `styleTextForInjection`.
        <style
          dangerouslySetInnerHTML={{ __html: styleTextForInjection(css) }}
        />
      ) : null}
      <BlockList
        nodes={visible.nodes}
        context={pageContext}
        blocks={resolver}
        classes={classes}
        fallback={blockFallback}
      />
    </div>
  );
}
