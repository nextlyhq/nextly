import {
  compilePageCss,
  nodeClassNames,
  walkNodes,
  type BlockDocument,
  type CompiledPageCss,
  type RemotePatternInput,
  type NodeStyles,
  type StyleCompileContext,
} from "@nextlyhq/blocks-engine";

import type { BlockResolver } from "./resolver";

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
  fetchPolicyId?: string
): PageStyles {
  const styles: PageStyles = {
    css: compiled.css,
    classes: Object.fromEntries(compiled.classes),
    ...(fetchPolicyId === undefined ? {} : { fetchPolicyId }),
  };
  // Carried through because THIS is the shape that gets stored: a compiler that
  // splits the sheet and a writer that drops half of it leave the gated rules
  // nowhere, and the page renders those nodes unstyled with nothing to say why.
  const withGated =
    compiled.gated === undefined
      ? styles
      : { ...styles, gated: compiled.gated };
  return scope === undefined ? withGated : { ...withGated, scope };
}

/**
 * The shared default styles for every block type the document uses.
 *
 * The compiler emits one rule per block TYPE rather than copying a type's
 * defaults into every node, and it takes those defaults from the compile
 * context. A caller compiling at render time already handed this renderer the
 * resolver holding the definitions, so requiring them to mirror `baseStyles`
 * into the context as well is a coupling that is easy to miss and silent when
 * missed: the renderer still writes the block-type class and the sheet simply
 * has no rule for it, so every block loses its defaults and nothing says why.
 *
 * A context that already carries `blockBases` is left alone — an explicit
 * choice by the caller outranks what can be derived here.
 */
function blockBasesFor(
  document: BlockDocument,
  blocks: BlockResolver
): Record<string, NodeStyles> {
  const bases: Record<string, NodeStyles> = {};
  walkNodes(document.nodes, node => {
    if (bases[node.type] !== undefined) return;
    const baseStyles = blocks.get(node.type)?.baseStyles;
    if (baseStyles !== undefined) bases[node.type] = baseStyles;
  });
  return bases;
}

/** Every node id in a document, in document order. */
function documentNodeIds(document: BlockDocument): string[] {
  const ids: string[] = [];
  walkNodes(document.nodes, node => {
    ids.push(node.id);
  });
  return ids;
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
function artifactDescribesUnaccountedNodes(
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

function normalizeStoredStyles(
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
 * A stored sheet with the gated rules of the nodes that SURVIVED appended.
 *
 * The stored `css` is always incomplete when `gated` is present, so this is
 * delivery rather than repair: the survivors are appended whether or not
 * anything about the document was repaired. Making it conditional on repair
 * would work only for as long as every conditioned node is pruned — the moment
 * one survives, nothing is repaired, the incomplete sheet ships unchanged and
 * that node renders unstyled.
 *
 * The set is taken from the document being RENDERED, never from re-reading
 * `visibility.conditions`. Walking the surviving nodes means the rules appended
 * are definitionally the rules of the nodes that rendered; a second derivation
 * of the pruning rule is exactly how a sheet and its markup come apart.
 *
 * Appending AFTER the main sheet is safe. Each node's local rules are written
 * against its own hashed class, so two nodes' entries can never target the same
 * element; only tier order matters, and each entry preserves its own tiers
 * internally.
 */
/**
 * The gated rules a stored artifact carries, or `undefined` when it carries none it can be read.
 *
 * ONE definition, because two places ask this question: the renderer, deciding whether the artifact
 * covers gating well enough to skip the repair, and the delivery below, deciding whether to append.
 * When they disagreed the artifact counted as coverage while its map went unread, so the repair was
 * skipped and the stale sheet shipped with the hidden node's rules still in it — the leak, arrived
 * at through two readings of one fact.
 *
 * The artifact is a database record, so `gated` can be null, an array, or a string. Anything not a
 * plain record is treated as ABSENT, which is the safe direction: absent means the sheet predates
 * the split, and gating then forces the recompile-or-withhold path.
 */
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

export function readableGatedRules(
  styles: PageStyles | undefined
): Readonly<Record<string, unknown>> | undefined {
  const gated: unknown = styles?.gated;
  if (typeof gated !== "object" || gated === null || Array.isArray(gated)) {
    return undefined;
  }
  return gated as Readonly<Record<string, unknown>>;
}

function withGatedRules(
  styles: PageStyles,
  document: BlockDocument
): PageStyles {
  const entries = readableGatedRules(styles);
  if (entries === undefined || styles.css === undefined) return styles;
  const appended: string[] = [];
  for (const id of documentNodeIds(document)) {
    const rules = entries[id];
    if (isUsableGatedEntry(rules)) appended.push(rules);
  }
  if (appended.length === 0) return styles;
  // An empty main sheet is joined without a leading newline. `css` is legitimately
  // empty whenever every styled node was gated — a page whose only styling lives
  // on a conditioned block compiles to exactly that — so emptiness cannot be read
  // as a refusal here. The refusal is decided by `normalizeStoredStyles`, which
  // rebuilds the classes; this only ever sees what that returned.
  const parts = styles.css === "" ? appended : [styles.css, ...appended];
  return { ...styles, css: parts.join("\n") };
}

/**
 * PRECONDITION: `document` is the tree that will RENDER, with condition-gated nodes already
 * removed by {@link pruneHiddenNodes}.
 *
 * Stated on the signature because this is exported and the unsafe call is the natural-looking one.
 * Handed a RAW document, every gated node counts as surviving, so its rules are appended from the
 * artifact and its markup is withheld by the renderer — publishing the colours, fonts and
 * `url(...)` of a block nobody was served. `PageRenderer` runs the pass itself, so the ordinary
 * path cannot get this wrong; a consumer assembling styles by hand can, which is why the prune is
 * exported alongside this.
 */
/**
 * A stable label for a host-fetch policy, or `undefined` when there is none.
 *
 * Derived from the patterns rather than assigned by a caller, so it changes
 * exactly when the policy does and there is nothing to remember to bump. Sorted
 * before joining because two lists holding the same entries in a different
 * order are the same policy, and a label that disagreed would recompile every
 * stored sheet on a cosmetic reordering.
 *
 * Written as JSON, for two reasons that are both about being WRONG in a way
 * nobody would see.
 *
 * It has to survive storage. This label is persisted inside the stylesheet
 * artifact, and that artifact is written to a JSON column — which on PostgreSQL
 * cannot hold a NUL byte at all. A separator chosen for being impossible in a
 * hostname is exactly the kind that is also impossible to store, and the failure
 * would be a save that errors only once a site turns the policy on.
 *
 * It has to keep ABSENT and EMPTY apart. `isAllowedRemoteUrl` reads an omitted
 * `port` as "any port" and `port: ""` as "the default port only", so a policy
 * tightened from one to the other is a different policy. Joining fields into a
 * string collapses that difference, and a stylesheet compiled under the broader
 * rule would go on being served under the narrower one. `JSON.stringify` drops
 * an undefined field and keeps an empty one, which is precisely the distinction.
 */
export function fetchPolicyLabel(
  patterns: readonly RemotePatternInput[] | undefined
): string | undefined {
  if (patterns === undefined) return undefined;
  const parts = patterns.map(pattern => {
    // A `URL` keeps the trailing colon on `protocol` and answers "" for the
    // fields it has none of; the object form omits them. Normalised to the
    // object's spelling so the same policy written either way labels the same.
    const fields =
      pattern instanceof URL
        ? {
            protocol: pattern.protocol.replace(/:$/, ""),
            hostname: pattern.hostname,
            port: pattern.port,
            pathname: pattern.pathname,
            search: pattern.search,
          }
        : {
            protocol: pattern.protocol,
            hostname: pattern.hostname,
            port: pattern.port,
            pathname: pattern.pathname,
            search: pattern.search,
          };
    // Key order is fixed by writing the members out, so two equal patterns
    // cannot label differently because they were built in a different order.
    return JSON.stringify([
      fields.protocol ?? null,
      fields.hostname,
      fields.port ?? null,
      fields.pathname ?? null,
      fields.search ?? null,
    ]);
  });
  // An EMPTY list is a real policy — it allows no remote host at all — and must
  // not label the same as having no policy, which asks nothing. The version
  // prefix means a later change to this encoding invalidates old stamps rather
  // than silently matching them.
  return JSON.stringify(["v1", ...parts.sort()]);
}

/**
 * The identity of a fetch policy that declines to identify itself.
 *
 * A plain word, and deliberately not valid `fetchPolicyLabel` output: every
 * label this module produces is a JSON array, so no stored stamp can ever equal
 * this. That makes "a custom predicate with no stated identity" mean recompile
 * every time — the slow answer and the correct one, since the alternative is
 * serving CSS whose URLs were admitted by a function that has since changed.
 *
 * Storage-safe on purpose. It can be STAMPED onto a recompiled artifact and
 * written to a JSON column, so it must not carry the control characters an
 * impossible-looking sentinel invites.
 */
export const UNIDENTIFIED_FETCH_POLICY = "unidentified-fetch-policy";

/** Caller-supplied policy for one style resolution. */
export interface ResolveStyleOptions {
  /**
   * Which host-fetch policy is in force now. Compared against the stamp the
   * stored artifact carries; a difference means that artifact was compiled
   * under other rules and cannot be trusted for this render.
   */
  fetchPolicyId?: string;
}

export function resolvePageStyles(
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
   * The host-fetch policy in force for THIS render, as an opaque label.
   *
   * An object rather than a sixth positional: five is already where a call
   * stops reading by position, and the next thing added in line would sit
   * beside a boolean with only its type to separate them.
   */
  options: ResolveStyleOptions = {}
): PageStyles {
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
  const compiledUnderAnotherPolicy =
    styles !== undefined && styles.fetchPolicyId !== options.fetchPolicyId;

  if (
    styles &&
    !repairedDocument &&
    !compiledFromAnotherTree &&
    !compiledUnderAnotherPolicy
  ) {
    const normalized = normalizeStoredStyles(styles, document);
    // A refused artifact had its classes rebuilt, so the gated rules — written
    // against the classes it USED to carry — would select nothing. Nothing is
    // appended, which is the same answer the sheet itself got.
    return normalized.refused
      ? normalized.styles
      : withGatedRules(normalized.styles, document);
  }
  if (
    styles &&
    (repairedDocument ||
      compiledFromAnotherTree ||
      compiledUnderAnotherPolicy) &&
    styleContext === undefined
  ) {
    return { ...normalizeStoredStyles(styles, document).styles, css: "" };
  }
  if (styleContext) {
    const context: StyleCompileContext =
      styleContext.blockBases === undefined
        ? { ...styleContext, blockBases: blockBasesFor(document, blocks) }
        : styleContext;
    return toPageStyles(
      compilePageCss(document, context),
      context.scope,
      options.fetchPolicyId
    );
  }
  return {
    css: "",
    classes: Object.fromEntries(nodeClassNames(documentNodeIds(document))),
  };
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
