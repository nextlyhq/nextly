/**
 * What a block IS as HTML content, and what it lets sit beneath it.
 *
 * The nesting rule in `nesting.ts` knows names: a child's declared parents and
 * a slot's allow-list. It cannot see that a Card whose link is switched on
 * renders an `<a>`, and that HTML refuses anything interactive inside one, or
 * that a Section rendered as a `<footer>` may not hold another footer. Those
 * rules follow a block's SETTINGS, not its name, so the block answers for
 * itself through `BlockDefinition.contentModel(props)` and this module reads
 * that answer the same way for every caller.
 *
 * The vocabulary is closed and small on purpose. It holds exactly the content
 * categories the HTML rules this editor enforces are written against, so a
 * block author picks from a list a reviewer can check, and an answer naming
 * anything else is read as no answer rather than as a new rule.
 */

/**
 * The content categories the placement rule is written against.
 *
 * Named after HTML's own categories: `flow` and `phrasing` are what a parent
 * accepts as direct children; `interactive` is what a link or a button refuses
 * anywhere inside; `header`, `footer` and `main` are the landmarks HTML refuses
 * inside one another; `form` is what a form refuses inside itself.
 */
export const CONTENT_KINDS = [
  "flow",
  "phrasing",
  "interactive",
  "header",
  "footer",
  "main",
  "form",
] as const;

/** One of {@link CONTENT_KINDS}. */
export type ContentKind = (typeof CONTENT_KINDS)[number];

/**
 * A block's content model, as its definition declares it for a set of props.
 *
 * @experimental Part of the block-authoring surface while the editor's
 *   placement rule settles; a block that declares nothing keeps working.
 */
export interface ContentModel {
  /**
   * What the block's OWN markup is or contains: a linked Card is `flow` and
   * `interactive`, a Button is `flow`, `phrasing` and `interactive`. Its slot
   * children are not counted here; they answer for themselves.
   */
  readonly is: readonly ContentKind[];
  /** What may sit beneath it, when it holds blocks at all. */
  readonly accepts?: {
    /**
     * What its slots' DIRECT children must be. `phrasing` admits only a child
     * whose `is` names `phrasing`. Omitted means `flow`.
     */
    readonly content?: "flow" | "phrasing";
    /**
     * Kinds refused ANYWHERE beneath it, at any depth: HTML's "no interactive
     * content descendant" for a link, "no header or footer descendant" for a
     * footer. Carried down the tree, so a Button three levels inside a linked
     * Card is refused as surely as one directly inside it.
     */
    readonly without?: readonly ContentKind[];
  };
}

/**
 * A content model read and normalised: every list deduplicated and sorted, so
 * two answers describing the same model compare equal by their key.
 */
export interface ResolvedContentModel {
  readonly is: readonly ContentKind[];
  readonly content: "flow" | "phrasing";
  readonly without: readonly ContentKind[];
}

/**
 * The model of a block that declares none: flow content accepting flow
 * content. That is what an ordinary `<div>` is, and it is what lets a plugin
 * block written before this rule keep going wherever it went before.
 */
export const UNDECLARED_CONTENT_MODEL: ResolvedContentModel = {
  is: ["flow"],
  content: "flow",
  without: [],
};

/**
 * The model of a block that draws nothing for its props (an Embed with no
 * source): no markup is no content, so nothing refuses it and it refuses
 * nothing. Decided by the block's own `rendersNothing`, the answer the renderer
 * and the stylesheet already use.
 */
export const NO_MARKUP_CONTENT_MODEL: ResolvedContentModel = {
  is: [],
  content: "flow",
  without: [],
};

/** How a caller hands over a block's declaration, when it has one. */
export type ContentModelDeclaration = (props: never) => unknown;

/**
 * Read a block's content model for these props.
 *
 * Contained like `rendersNothing`: the declaration is a plugin author's
 * function and the props are whatever the document stored, so a throw, a
 * promise or a malformed answer is read as UNDECLARED rather than raised. A
 * placement check runs on every drag and every save, and one broken block
 * must not take either down with it. Reading a broken answer as undeclared is
 * the permissive direction, which is the one a block already had before it
 * declared anything.
 */
export function resolveContentModel(
  declaration: ContentModelDeclaration | undefined,
  props: unknown
): ResolvedContentModel {
  if (typeof declaration !== "function") return UNDECLARED_CONTENT_MODEL;
  try {
    const answer: unknown = declaration(props as never);
    // Read inside the guard: a throwing `then` getter would escape otherwise.
    if (typeof (answer as { then?: unknown } | null)?.then === "function") {
      // A pending promise is not an answer, and a rejection left unobserved
      // would surface as an unhandled rejection.
      void Promise.resolve(answer).catch(() => undefined);
      return UNDECLARED_CONTENT_MODEL;
    }
    // Normalised inside the guard too: the answer is the author's object, and
    // a getter or proxy on it can throw while its fields are read.
    return normalise(answer) ?? UNDECLARED_CONTENT_MODEL;
  } catch {
    return UNDECLARED_CONTENT_MODEL;
  }
}

/** The answer in its normal form, or undefined when it is not a model. */
function normalise(answer: unknown): ResolvedContentModel | undefined {
  if (typeof answer !== "object" || answer === null) return undefined;
  const { is, accepts } = answer as { is?: unknown; accepts?: unknown };
  const kinds = kindList(is);
  if (kinds === undefined || kinds.length === 0) return undefined;
  const beneath = acceptsOf(accepts);
  return beneath === undefined ? undefined : { is: kinds, ...beneath };
}

/** The `accepts` half in its normal form, or undefined when it is malformed. */
function acceptsOf(
  accepts: unknown
): Pick<ResolvedContentModel, "content" | "without"> | undefined {
  if (accepts === undefined) return { content: "flow", without: [] };
  if (typeof accepts !== "object" || accepts === null) return undefined;
  const { content, without } = accepts as {
    content?: unknown;
    without?: unknown;
  };
  const direct = contentOf(content);
  const refused = without === undefined ? [] : kindList(without);
  if (direct === undefined || refused === undefined) return undefined;
  return { content: direct, without: refused };
}

/** What a container's direct children must be; omitted means flow. */
function contentOf(content: unknown): "flow" | "phrasing" | undefined {
  if (content === undefined) return "flow";
  return content === "flow" || content === "phrasing" ? content : undefined;
}

/**
 * A list of known kinds, deduplicated and in {@link CONTENT_KINDS} order, or
 * undefined when the value is not one. An unknown kind spoils the whole list
 * rather than being dropped, because dropping it would silently turn a rule
 * the author meant into a weaker one.
 */
function kindList(value: unknown): ContentKind[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const known = CONTENT_KINDS as readonly unknown[];
  if (!value.every(kind => known.includes(kind))) return undefined;
  return CONTENT_KINDS.filter(kind => value.includes(kind));
}

/**
 * A stable string for a resolved model, so two placements can be compared on
 * whether a block's settings changed what it is. The lists are already in one
 * order, which is what makes the key stable.
 */
export function contentModelKey(model: ResolvedContentModel): string {
  return `${model.is.join(",")}|${model.content}|${model.without.join(",")}`;
}
