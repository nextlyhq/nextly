/**
 * What an author can do to a document, as data rather than as branches.
 *
 * The header used to decide each control where it drew it, so what appeared was
 * the sum of a dozen conditions spread down a 900-line component. Three
 * consequences, and the third is the one that decided this shape:
 *
 * - Nothing owned the rule that there is ONE primary action. A published
 *   document with a pending draft rendered Save, Publish and Unpublish side by
 *   side, all the same size, and an author had to read three buttons to find
 *   the one they wanted.
 * - Where an action belonged — toolbar or menu — was expressed by WHERE its
 *   JSX sat, so demoting one meant moving code rather than changing a value.
 * - A plugin could not join in. Contributed actions get a single slot with no
 *   priority and no placement, so "add this document to a release" could only
 *   ever be one more button beside the others.
 *
 * So an action DESCRIBES itself and the surface decides how to draw it. That is
 * the shape Sanity's document actions settled on for the same reason: one
 * description renders as a toolbar button or a menu item depending on where it
 * is asked for, and a plugin appends to the same list the built-ins come from.
 *
 * This module is deliberately free of React. What an author may do is a
 * question about permissions and document state, and answering it in a
 * component means it can only be tested by rendering one.
 *
 * @module components/features/entries/EntryForm/document-actions
 */

/**
 * Where an action is drawn.
 *
 * `primary` is a promise as much as a position: exactly one action carries it,
 * and {@link documentActions} is what keeps that true. Two primaries is the
 * state the header was already in.
 */
export type ActionPlacement = "primary" | "toolbar" | "menu";

/**
 * Which part of the menu an action belongs to.
 *
 * `danger` is separated because the menu currently mixes Duplicate with Delete
 * in one flat list, and a destructive verb one row from a routine one is a slip
 * waiting to happen.
 */
export type ActionGroup = "document" | "danger";

export interface DocumentAction {
  /** Stable identity, for tests and for a plugin replacing a built-in. */
  id: string;
  /**
   * What the control says, in the imperative.
   *
   * Imperative and SPECIFIC: "Publish changes" rather than "Publish" on a
   * document that is already live, where the shorter word reads as a no-op and
   * says nothing about the pending draft it promotes.
   */
  label: string;
  placement: ActionPlacement;
  /** Which menu section, for a `menu` action. */
  group?: ActionGroup;
  /** Whether the action removes or replaces something an author can see. */
  destructive?: boolean;
  /**
   * Why this action cannot be used right now, or absent when it can.
   *
   * A REASON rather than a boolean, because three separate permissions and
   * several document states decide these, and a dead control with no
   * explanation reads as a broken one. Whatever draws the action is expected to
   * surface this — a tooltip on a disabled button, helper text on a menu item.
   */
  disabledReason?: string;
}

/**
 * Everything the answer depends on.
 *
 * Facts only. Whether a control is drawn is this module's decision, and a
 * caller passing `showPublishButton` would be making it somewhere else.
 */
export interface DocumentActionState {
  mode: "create" | "edit";
  /** Whether the collection has a publish lifecycle at all. */
  hasStatus: boolean;
  /** Whether a published document keeps its edits as a working draft. */
  draftsEnabled: boolean;
  /** The document's status in the language being edited. */
  status: "draft" | "published" | "unknown";
  /** Whether a published document has unpublished edits pending. */
  hasWorkingDraft: boolean;
  /** Whether a past version is on screen, which forbids every mutation. */
  readingHistory: boolean;
  canPublish: boolean;
  canUnpublish: boolean;
  canDelete: boolean;
  /** Whether the form currently holds work worth discarding. */
  isDirty: boolean;
  /** Whether the document can be duplicated — an edit-mode affordance. */
  canDuplicate: boolean;
}

/** The reason every action is unavailable while a past version is on screen. */
const HISTORY_REASON =
  "You are viewing a past version. Return to the current one to make changes.";

/**
 * The one action an author is most likely reaching for, given the state.
 *
 * Derived rather than chosen at each call site, which is what stops two
 * controls both claiming to be the main one. The order below is the whole rule:
 *
 * - CREATING, the only thing to do is make the document exist.
 * - A DRAFT's purpose is to become published, so Publish leads and Save is the
 *   quieter companion — the same ranking the block editor and Sanity use.
 * - PUBLISHED WITH PENDING EDITS, publishing those edits is the act; the label
 *   says so rather than repeating "Publish" at a document that is already live.
 * - PUBLISHED AND CLEAN, or a collection with no lifecycle at all, saving is
 *   all there is.
 */
const PRIMARY_RULES: readonly {
  applies: (state: DocumentActionState) => boolean;
  build: (state: DocumentActionState) => { id: string; label: string };
}[] = [
  /*
   * A collection with NO lifecycle has exactly one verb, and its word depends
   * only on whether the document exists yet.
   */
  {
    applies: state => !state.hasStatus,
    build: state => ({
      id: "save",
      label: state.mode === "create" ? "Create" : "Save",
    }),
  },
  /*
   * PUBLISHED WITH PENDING EDITS: publishing those edits is the act, and the
   * label says so rather than repeating "Publish" at a document already live,
   * where the shorter word reads as a no-op.
   */
  {
    applies: state => isPublishedEdit(state) && state.hasWorkingDraft,
    build: () => ({ id: "publish", label: "Publish changes" }),
  },
  /*
   * PUBLISHED AND CLEAN: saving is all there is. "Save" where drafts are
   * enabled, because the work lands in a draft rather than in front of readers,
   * and "Save changes" where it goes straight out — a distinction the editor
   * already drew and worth keeping.
   */
  {
    applies: isPublishedEdit,
    build: state => ({
      id: "save",
      label: state.draftsEnabled ? "Save" : "Save changes",
    }),
  },
];

/**
 * A DRAFT, or a document being created in a collection that HAS a lifecycle:
 * its purpose is to become published, so Publish leads and saving is the
 * quieter companion beside it — the ranking the block editor and Sanity use.
 */
const PRIMARY_FALLBACK = { id: "publish", label: "Publish" };

/**
 * The one action an author is most likely reaching for, given the state.
 *
 * Derived rather than chosen at each call site, which is what stops two
 * controls both claiming to be the main one. A TABLE for the same reason the
 * built-ins are one: written as branches this reached a complexity the gate
 * refuses, and the order of the rules — which IS the rule — was buried in the
 * order the `if`s happened to be typed.
 *
 * FIRST MATCH WINS, so the rows read as "the most specific situation first".
 */
function primaryAction(state: DocumentActionState): DocumentAction {
  const matched = PRIMARY_RULES.find(rule => rule.applies(state));
  const { id, label } = matched?.build(state) ?? PRIMARY_FALLBACK;
  const blocked = state.readingHistory ? HISTORY_REASON : undefined;
  return withReason(
    { id, label, placement: "primary" },
    blocked ?? (id === "publish" ? publishReason(state) : undefined)
  );
}

/** Why publishing is unavailable, or undefined when it is not. */
function publishReason(state: DocumentActionState): string | undefined {
  return state.canPublish
    ? undefined
    : "You do not have permission to publish in this collection.";
}

function withReason(
  action: DocumentAction,
  reason: string | undefined
): DocumentAction {
  return reason === undefined ? action : { ...action, disabledReason: reason };
}

/**
 * One built-in action, and the states it applies to.
 *
 * A TABLE rather than a sequence of `if` blocks, and the reason is not
 * tidiness: written as branches this reached a cyclomatic complexity of 24 in
 * one function, which the repository's own gate refuses — correctly, because a
 * reader then has to hold every condition at once to answer "what does an
 * author see here".
 *
 * It is also the shape a plugin can join. A contributed action is another entry
 * with its own `applies`, so "add this document to a release" arrives without
 * the header being edited — which is the whole reason the built-ins are
 * expressed as data rather than as JSX in the order it happened to be written.
 */
interface ActionRule {
  id: string;
  /** Whether this action exists at all for the given state. */
  applies: (state: DocumentActionState) => boolean;
  /** What it says, which for several actions depends on the state. */
  label: (state: DocumentActionState) => string;
  placement: Exclude<ActionPlacement, "primary">;
  group?: ActionGroup;
  destructive?: boolean;
  /**
   * Why it is unavailable, beyond the historical-view rule every mutation
   * shares. Absent for an action nothing else can forbid.
   */
  reason?: (state: DocumentActionState) => string | undefined;
  /**
   * Whether a historical view forbids this action.
   *
   * Every rule sets it except the one READ in the list. Defaulting it to
   * "mutates" would make the exception invisible at the entry that needs it.
   */
  mutates: boolean;
}

/**
 * A FUNCTION declaration, not a const arrow, and that is load-bearing.
 *
 * Both action tables reference this at module-evaluation time, and a `const`
 * initialised after them throws `Cannot access before initialization` the
 * instant the module is imported. Declared this way it hoists, so the tables
 * may sit wherever they read best rather than wherever the initialiser order
 * permits.
 *
 * Worth stating because nothing static catches it: type-checking, linting and
 * the complexity gate all passed on the broken arrangement — only running the
 * module found it.
 */
function isPublishedEdit(s: DocumentActionState): boolean {
  return s.mode === "edit" && s.hasStatus && s.status === "published";
}

function permissionReason(verb: string): string {
  return `You do not have permission to ${verb} in this collection.`;
}

/**
 * The built-in actions, in the order a surface presents them.
 *
 * Order is part of the contract: the toolbar draws its entries left to right
 * and the menu top to bottom, so moving a row here moves it on screen.
 */
const BUILT_IN_ACTIONS: readonly ActionRule[] = [
  /*
   * Saving a published document is offered BESIDE publishing it, not folded
   * into it. They are different acts once drafts are enabled — one keeps the
   * work private, the other shows it to readers — and an author part-way
   * through a rewrite needs the first without the second.
   */
  {
    id: "save",
    applies: s => isPublishedEdit(s) && s.hasWorkingDraft,
    label: s => (s.draftsEnabled ? "Save" : "Save changes"),
    placement: "toolbar",
    mutates: true,
  },
  /*
   * A DRAFT — or a document being created where a lifecycle exists — keeps its
   * save in the toolbar for the same reason from the other side: Publish leads,
   * and an author not ready for readers still needs somewhere to put the work.
   * Creating is included because a collection with a lifecycle has always
   * offered both from the start; dropping one would take away the ability to
   * begin a document without publishing it.
   */
  {
    id: "save",
    applies: s => s.hasStatus && (s.mode === "create" || s.status === "draft"),
    label: () => "Save draft",
    placement: "toolbar",
    mutates: true,
  },
  {
    id: "duplicate",
    applies: s => s.mode === "edit" && s.canDuplicate,
    label: () => "Duplicate",
    placement: "menu",
    group: "document",
    mutates: true,
  },
  /*
   * The one action that survives a historical view, and deliberately so.
   *
   * Everything else here WRITES, and the document on screen is not the live one
   * — so a mutation would write the wrong thing. Reading what the API returns
   * changes nothing, and it is most useful precisely when an author is trying
   * to understand a version they are looking at. Blocking it would be the rule
   * applied past its reason.
   */
  {
    id: "view-api",
    applies: () => true,
    label: () => "View API response",
    placement: "menu",
    group: "document",
    mutates: false,
  },
  /*
   * The two kinds of discard are different acts on different things: a pending
   * WORKING DRAFT is saved work readers cannot see, while unsaved FORM changes
   * were never written down. Collapsing them into one item would let an author
   * asking to drop a typo throw away a rewrite.
   */
  {
    id: "discard-draft",
    applies: s => s.mode === "edit" && s.hasWorkingDraft,
    label: () => "Discard draft",
    placement: "menu",
    group: "danger",
    destructive: true,
    mutates: true,
  },
  {
    id: "discard-changes",
    applies: s => s.mode === "edit" && s.isDirty,
    label: () => "Discard changes",
    placement: "menu",
    group: "danger",
    destructive: true,
    mutates: true,
  },
  {
    id: "unpublish",
    applies: isPublishedEdit,
    label: () => "Unpublish",
    placement: "menu",
    group: "danger",
    destructive: true,
    reason: s => (s.canUnpublish ? undefined : permissionReason("unpublish")),
    mutates: true,
  },
  {
    id: "delete",
    applies: s => s.mode === "edit",
    label: () => "Delete",
    placement: "menu",
    group: "danger",
    destructive: true,
    reason: s => (s.canDelete ? undefined : permissionReason("delete")),
    mutates: true,
  },
];

/**
 * Every action for a document, in the order a surface should present them.
 *
 * The list is the contract. A caller filters it by placement rather than asking
 * this module for "the toolbar actions" — one question with one answer, so a
 * button and a menu item cannot come from two derivations that disagree about
 * whether an action exists.
 *
 * UNPUBLISH IS IN THE MENU, and that is a deliberate demotion. It sat beside
 * Publish, where the two most consequential and opposite verbs in the editor
 * were one slip apart, styled almost alike. It is rare, it changes what the
 * public sees, and it belongs with the other destructive verbs.
 */
export function documentActions(state: DocumentActionState): DocumentAction[] {
  const blocked = state.readingHistory ? HISTORY_REASON : undefined;
  const built = BUILT_IN_ACTIONS.filter(rule => rule.applies(state)).map(rule =>
    withReason(
      {
        id: rule.id,
        label: rule.label(state),
        placement: rule.placement,
        ...(rule.group === undefined ? {} : { group: rule.group }),
        ...(rule.destructive === undefined
          ? {}
          : { destructive: rule.destructive }),
      },
      (rule.mutates ? blocked : undefined) ?? rule.reason?.(state)
    )
  );
  return [primaryAction(state), ...built];
}

/**
 * The actions for one placement, in list order.
 *
 * Derived from {@link documentActions} rather than built beside it, so a
 * surface cannot draw an action the model does not know about — and an action
 * added to the model appears wherever it declared it belongs without the
 * surfaces being edited.
 */
export function actionsAt(
  actions: readonly DocumentAction[],
  placement: ActionPlacement
): DocumentAction[] {
  return actions.filter(action => action.placement === placement);
}

/**
 * Menu actions split into their groups, keeping list order inside each.
 *
 * Returned as a pair rather than as one list with a flag, because the caller
 * draws a separator between them and a caller reading a flag would have to
 * rediscover where the boundary falls.
 */
export function menuGroups(actions: readonly DocumentAction[]): {
  document: DocumentAction[];
  danger: DocumentAction[];
} {
  const menu = actionsAt(actions, "menu");
  return {
    document: menu.filter(action => action.group !== "danger"),
    danger: menu.filter(action => action.group === "danger"),
  };
}
