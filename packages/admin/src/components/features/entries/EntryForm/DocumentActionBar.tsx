"use client";

/**
 * Draws the document's actions, wherever each one said it belongs.
 *
 * The counterpart to `document-actions`: that module answers WHAT an author may
 * do and WHERE it goes, this one answers what that looks like. Keeping them
 * apart is the point — the header previously decided both at once, in JSX, so
 * "is Unpublish available" and "is Unpublish a button" were the same expression
 * and could not be reasoned about separately.
 *
 * A caller supplies a BINDING per action id: what to run, and any reason it
 * cannot run at this instant. The split matters. Whether an action EXISTS is a
 * question about permissions and document state, which the model owns and can
 * be tested without rendering; whether it can run RIGHT NOW is about the form —
 * mid-submit, invalid, nothing changed — which only the form knows. Folding the
 * second into the model would have put form state in a module that has no form.
 *
 * An action with no binding is not drawn. That is how an optional affordance —
 * a collection with no duplicate handler — disappears without the model needing
 * to know which handlers a host happened to pass.
 *
 * @module components/features/entries/EntryForm/DocumentActionBar
 */

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@nextlyhq/ui";
import { ChevronDown, Loader2, Lock, MoreHorizontal } from "lucide-react";
import { Fragment, useEffect, useId, useState, type JSX } from "react";

import { useInTopBar } from "@admin/components/layout/header/TopBarPlaces";
import { Link } from "@admin/components/ui/link";
import { cn } from "@admin/lib/utils";

import { BAR_CONTROLS_GAP, BAR_ICON_CONTROL } from "./bar-controls";
import {
  actionsAt,
  menuGroups,
  PUBLISH_WITHOUT_REVIEW_ACTION_ID,
  withContributedActions,
  type EditorDocumentAction,
} from "./document-actions";
import { DOCUMENT_PANEL_TOGGLE_ATTRIBUTE } from "./DocumentSidePanel";

/** What a host wires an action to, and why it might not run right now. */
export interface ActionBinding {
  onSelect: () => void;
  /**
   * Submit this form natively instead of calling back.
   *
   * A collection with NO status column saves by submitting the form and letting
   * it decide, with no intent attached. Routing that through a callback is not
   * a detail: every save handler the hosts expose carries an intent, and the
   * one for drafts writes `status: "draft"` — a column such a collection does
   * not have, so the write fails. The control has always been a submit button
   * for exactly this reason, and this keeps it one.
   */
  submitForm?: string;
  /**
   * A TRANSIENT reason — mid-submit, invalid, nothing to save.
   *
   * Separate from the model's `disabledReason`, which is about permission and
   * document state. Both disable the control and both are worth showing; they
   * are distinguished because one is a property of the document and the other
   * of this moment, and a caller that conflated them would have to recompute
   * permissions on every keystroke.
   */
  disabledReason?: string;
  /**
   * A way out of the reason, drawn as its own row directly under the held
   * one: the held row cannot be focused, so what ends the hold has to be a
   * control of its own to be reached by keyboard.
   */
  recovery?: ActionRecovery;
}

/** A control that ends what holds an action, such as Retry. */
export interface ActionRecovery {
  label: string;
  onSelect: () => void;
}

/**
 * An action a HOST supplies: what it is, and what it runs.
 *
 * The two travel together because a description with no binding is not drawn
 * and a binding with no description has nowhere to go — so a host that provided
 * one and forgot the other would get silence rather than an error. Pairing them
 * makes the omission unrepresentable.
 */
export interface ContributedAction {
  action: EditorDocumentAction;
  binding: ContributedBinding;
}

/**
 * A contribution's control. Told, when it is chosen, the document as the form
 * holds it: the page that contributes it sits above the form, so the saved
 * entry is all it has, and an edit not yet saved (a title being typed) lives
 * only in the form.
 */
export interface ContributedBinding extends Omit<ActionBinding, "onSelect"> {
  onSelect: (document: DocumentAsEdited) => void;
}

/** The document as the editor holds it, unsaved edits included. */
export interface DocumentAsEdited {
  values: Record<string, unknown>;
  /** Whether those values hold edits not saved yet; absent where unknown. */
  dirty?: boolean;
}

/** What a host with no form to read hands a contribution. */
const NO_VALUES = (): Record<string, unknown> => ({});

/**
 * The built-in actions and bindings with a host's contributions folded in.
 *
 * ONE rule decides both halves, and that is the whole point of this function.
 * A built-in wins an id collision — the built-ins carry the permission checks
 * and the destructive flags — and the two halves must agree about which
 * contributions lost, or the surface draws a built-in verb wired to somebody
 * else's handler. `Delete` drawn from the model and bound to a contribution is
 * exactly the substitution the precedence exists to prevent, and nothing about
 * it looks wrong on screen.
 *
 * Acceptance is DERIVED from the merge rather than recomputed beside it: a
 * contribution is bound only if its own action object survived into the merged
 * list. A second copy of the collision rule here would agree today and drift on
 * the first change to either.
 */
export function acceptContributions(
  built: readonly EditorDocumentAction[],
  builtBindings: Readonly<Record<string, ActionBinding | undefined>>,
  contributed: readonly ContributedAction[],
  /**
   * The form's values, read at the moment a contribution is chosen rather
   * than when the editor drew, so an edit made since the last render counts.
   */
  currentValues: () => Record<string, unknown> = NO_VALUES,
  /** Whether the form holds unsaved edits, read at the same moment. */
  currentDirty?: () => boolean
): {
  actions: EditorDocumentAction[];
  bindings: Record<string, ActionBinding | undefined>;
} {
  const actions = withContributedActions(
    built,
    contributed.map(entry => entry.action)
  );
  const bindings: Record<string, ActionBinding | undefined> = {
    ...builtBindings,
  };
  for (const entry of contributed) {
    if (actions.includes(entry.action))
      bindings[entry.action.id] = {
        ...entry.binding,
        onSelect: () =>
          entry.binding.onSelect({
            values: currentValues(),
            ...(currentDirty === undefined ? {} : { dirty: currentDirty() }),
          }),
      };
  }
  return { actions, bindings };
}

export interface DocumentActionBarProps {
  actions: readonly EditorDocumentAction[];
  /** Keyed by action id. An action with no entry is not drawn. */
  bindings: Readonly<Record<string, ActionBinding | undefined>>;
  /** Whether a mutation is in flight, which shows on the leading action. */
  pending?: boolean;
  className?: string;
  /**
   * Controls the bar draws beside this one on a wide editor and folds into
   * this menu on a phone (History, the preview, the panel toggle), so a phone
   * keeps the bar to one row of actions. The bar passes them only where it
   * folds them, so every row given is drawn, first in the menu.
   */
  narrowItems?: readonly NarrowMenuItem[];
  /**
   * The bar's own rows on the main button's menu, after the model's: the
   * preview's choices and the ways into the document's other views. They are
   * rows there at every width, so the header draws one main button and no
   * second set of controls beside it. With no main button they lead More.
   */
  mainMenuItems?: readonly NarrowMenuItem[];
}

/** A header control, as a row of a menu. */
export interface NarrowMenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  /**
   * Where the row leads, for a way into another view: drawn as a link, so a
   * middle or modified click opens it in a new tab as a list row's does, and
   * `onSelect` is not called.
   */
  href?: string;
  disabled?: boolean;
  /**
   * The row that shows or hides the document panel. While it is folded here,
   * the menu's trigger is the panel's toggle: where focus goes back to when
   * the panel closes.
   */
  togglesPanel?: boolean;
}

/**
 * Hidden on a phone's screen: a past version's own actions, which the version
 * view draws in a bar at the bottom of a phone's screen instead.
 */
export const WIDE_ONLY = "max-sm:hidden";

/**
 * How a refusal is spoken on a menu item.
 *
 * Nothing when the action is usable, so a usable row carries no stray
 * attributes and a test asserting their absence means something.
 *
 * These attributes are a SUPPLEMENT to the visible line below, never the whole
 * answer. A disabled Radix item carries `pointer-events-none` and is skipped by
 * the menu's roving focus, so a `title` never opens and an `aria-description`
 * on an unfocusable row is read by nobody. A refusal that only lives in these
 * is a refusal the author cannot obtain.
 */
function reasonAttributes(reason: string | undefined): Record<string, string> {
  return reason === undefined
    ? {}
    : { title: reason, "aria-description": reason };
}

/**
 * A menu row: what the action is called, and — when it cannot be used — why.
 *
 * The reason is rendered as TEXT rather than left to a tooltip. A disabled row
 * cannot be hovered or focused, so the explanation attached to it was
 * unreachable by both pointer and keyboard; an author saw a grey row and no
 * way to find out what was wrong with it, which is the "reads as broken rather
 * than as forbidden" problem the reasons exist to solve, one step further on.
 *
 * The row stays genuinely `disabled` rather than being made focusable to carry
 * a tooltip. These rows include Delete and Unpublish, and the refusals are
 * permissions — a control that cannot fire is worth more than one that explains
 * itself well.
 */
function ActionRow({
  label,
  reason,
}: {
  label: string;
  reason: string | undefined;
}) {
  if (reason === undefined) return <>{label}</>;
  return (
    <span className="flex flex-col items-start gap-0.5">
      <span>{label}</span>
      <span className="text-xs font-normal text-muted-foreground">
        {reason}
      </span>
    </span>
  );
}

/**
 * Both reasons an action may be unusable, or undefined when it is usable.
 * Shared with running an action from elsewhere, so a control and a run refuse
 * for exactly the same reasons.
 */
export function reasonFor(
  action: EditorDocumentAction,
  binding: ActionBinding
): string | undefined {
  return action.disabledReason ?? binding.disabledReason;
}

/** An action and what it is wired to. */
export type Bound = { action: EditorDocumentAction; binding: ActionBinding };

/**
 * The actions a host actually wired, paired with their bindings.
 *
 * Filtered ONCE and reused by each region, so a control cannot appear in the
 * toolbar while the menu believes it does not exist.
 */
function bound(
  actions: readonly EditorDocumentAction[],
  bindings: DocumentActionBarProps["bindings"]
): Bound[] {
  const out: Bound[] = [];
  for (const action of actions) {
    const binding = bindings[action.id];
    if (binding !== undefined) out.push({ action, binding });
  }
  return out;
}

/**
 * The actions a host wired, and the one among them that leads: what every
 * drawing of the bar starts from, so two drawings cannot disagree about it.
 */
function wiredActions(
  actions: readonly EditorDocumentAction[],
  bindings: DocumentActionBarProps["bindings"]
): { available: EditorDocumentAction[]; primary: Bound | undefined } {
  const available = bound(actions, bindings).map(entry => entry.action);
  return {
    available,
    primary: bound(actionsAt(available, "primary"), bindings)[0],
  };
}

export function DocumentActionBar({
  actions,
  bindings,
  pending = false,
  className,
  narrowItems = [],
  mainMenuItems = [],
}: DocumentActionBarProps): JSX.Element {
  const inTopBar = useInTopBar();
  const { available, primary } = wiredActions(actions, bindings);
  const toolbar = bound(actionsAt(available, "toolbar"), bindings);
  const groups = menuGroups(available);
  const publishItems = bound(actionsAt(available, "publish-menu"), bindings);
  // The main button's companions hang off whatever action leads, so a clean
  // published document, where Save leads, can still be scheduled to come
  // down. Publishing past the review comes last, apart. The press itself is
  // not repeated as a row: nothing in the header is offered twice. With
  // nothing leading, they lead More's document rows instead.
  const everyday = publishItems.filter(entry => !skipsReview(entry));
  const escape = publishItems.filter(skipsReview);
  const documentItems =
    primary === undefined
      ? [...everyday, ...escape, ...bound(groups.document, bindings)]
      : bound(groups.document, bindings);
  const moreRows =
    primary === undefined ? [...mainMenuItems, ...narrowItems] : narrowItems;
  const dangerItems = bound(groups.danger, bindings);
  const wideMenu = documentItems.length > 0 || dangerItems.length > 0;
  // A menu is drawn when it has a row to hold, folded controls included.
  const hasMenu = wideMenu || moreRows.length > 0;

  return (
    // Wraps within the width it is given rather than past it, as the header's
    // cluster around it does: a preview pane can narrow the editor on a wide
    // screen, and the document's own verbs must stay inside it. In the admin's
    // top bar, which is one row tall, the verbs stay on that row: Save, its
    // arrow and More together never split across two lines.
    <div
      className={cn(
        "flex min-w-0 max-w-full items-center justify-end",
        BAR_CONTROLS_GAP,
        // In the bar it also keeps its own width, so its buttons never spill
        // over the controls before them.
        inTopBar ? "shrink-0 flex-nowrap" : "flex-wrap",
        className
      )}
    >
      {/*
        The supporting action comes FIRST in the DOM and reads first left to
        right, so the leading one sits at the end of the cluster where a
        confirming action is looked for.
      */}
      {toolbar.map(({ action, binding }) => (
        <Button
          key={action.id}
          type="button"
          variant="outline"
          size="sm"
          disabled={reasonFor(action, binding) !== undefined}
          title={reasonFor(action, binding) ?? action.label}
          onClick={binding.onSelect}
          data-action={action.id}
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {/* Its words at every width: the button draws no icon, so a label
            that collapsed would leave it empty. */}
          {action.label}
        </Button>
      ))}

      {primary === undefined ? null : (
        <PrimaryAction
          primary={primary}
          options={everyday}
          rows={mainMenuItems}
          apartOptions={escape}
          pending={pending}
          explainsHold
        />
      )}

      {hasMenu ? (
        <DocumentMenu
          narrowItems={moreRows}
          documentItems={documentItems}
          dangerItems={dangerItems}
          wideMenu={wideMenu}
        />
      ) : null}
    </div>
  );
}

/** The built-in Publish's id, under both "Publish" and "Publish changes". */
const PUBLISH_ACTION_ID = "publish";

/** The built-in Save's id, under every word it is said with. */
const SAVE_ACTION_ID = "save";

/** Whether a row publishes past the workflow, which the menu sets apart. */
function skipsReview(entry: Bound): boolean {
  return entry.action.id === PUBLISH_WITHOUT_REVIEW_ACTION_ID;
}

/** What the arrow beside the primary action is called, and opens. */
export const PUBLISH_OPTIONS_LABEL = "More ways to publish";

/**
 * The one leading action, and where there are other ways to publish, the
 * arrow that opens them, joined to it as one control.
 */
function PrimaryAction({
  primary,
  options,
  rows = [],
  apartOptions = [],
  dangerOptions = [],
  optionsLabel = PUBLISH_OPTIONS_LABEL,
  pending,
  menuClassName,
  explainsHold = false,
}: {
  primary: Bound;
  options: Bound[];
  /**
   * Whether a leading action the model holds (Publish waiting for approval, a
   * step waiting for a save, a past version on screen) stays pressable and
   * opens its reason (`MainPress`), as the entry header draws it. A refusal of
   * this instant (nothing to save, a submit in flight) is drawn disabled
   * everywhere, as is every hold on a surface that leaves this off.
   */
  explainsHold?: boolean;
  /** The bar's own rows, after the model's (`mainMenuItems`). */
  rows?: readonly NarrowMenuItem[];
  /** Rows set apart below a rule, such as publishing past the review. */
  apartOptions?: Bound[];
  /** Destructive rows, below a rule, for a surface with no menu of its own. */
  dangerOptions?: Bound[];
  /** What the arrow is called, for what it holds. */
  optionsLabel?: string;
  pending: boolean;
  /** Extra classes for the arrow's menu, for a surface with its own density. */
  menuClassName?: string;
}) {
  const reason = reasonFor(primary.action, primary.binding);
  const rowCount =
    options.length + rows.length + apartOptions.length + dangerOptions.length;
  const press = (
    <MainPress
      primary={primary}
      reason={reason}
      explainsHold={explainsHold}
      pending={pending}
      className={cn(rowCount > 0 && "rounded-r-none")}
    />
  );
  if (rowCount === 0) return press;
  return (
    <div className="flex items-center" data-publish-split="">
      {press}
      <ActionOptionsMenu
        options={options}
        rows={rows}
        apartOptions={apartOptions}
        dangerOptions={dangerOptions}
        optionsLabel={optionsLabel}
        {...(menuClassName === undefined ? {} : { menuClassName })}
      />
    </div>
  );
}

/**
 * The leading action's press.
 *
 * While the model holds it (Publish waiting for approval, a step waiting for a
 * save) and the surface explains holds (`explainsHold`), it is drawn visibly
 * held, with a lock and a quiet outline, but never disabled: a disabled
 * control can be neither focused nor pressed, so its reason would reach
 * nobody using a keyboard or a touch screen. It is then described by its
 * reason, and pressing it opens that reason beside it; it runs nothing. Its
 * words take the foreground token, which reads at 4.5:1 or more on the bar in
 * light and dark. Any other refusal draws it disabled, titled with why.
 *
 * ONE button in every state, so the element a person has focused, or a test
 * holds, stays the same one as a hold comes and goes.
 */
function MainPress({
  primary,
  reason,
  explainsHold,
  pending,
  className,
}: {
  primary: Bound;
  /** Either kind of reason it is unusable, or undefined. */
  reason: string | undefined;
  explainsHold: boolean;
  pending: boolean;
  className?: string;
}) {
  const reasonId = useId();
  const [open, setOpen] = useState(false);
  const hold = explainsHold ? primary.action.disabledReason : undefined;
  const held = hold !== undefined;
  // A hold that lifts takes its reason away with it.
  useEffect(() => {
    if (!held) setOpen(false);
  }, [held]);
  const submits = !held && primary.binding.submitForm !== undefined;
  return (
    <Popover open={held && open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Button
          size="sm"
          variant={held ? "outline" : "default"}
          type={submits ? "submit" : "button"}
          {...(submits ? { form: primary.binding.submitForm } : {})}
          onClick={
            held
              ? () => setOpen(current => !current)
              : submits
                ? undefined
                : primary.binding.onSelect
          }
          disabled={!held && reason !== undefined}
          aria-describedby={held ? reasonId : undefined}
          /*
            The reason is the title when there is one, so a control an author
            cannot use says why. Three separate permissions and several
            document states decide these, and a dead button with no
            explanation reads as broken rather than as forbidden.
          */
          title={hold ?? reason ?? primary.action.label}
          data-action={primary.action.id}
          data-primary="true"
          {...(held ? { "data-held": "" } : {})}
          className={cn(held && "gap-1.5 text-foreground", className)}
        >
          {held ? <Lock className="h-3.5 w-3.5" aria-hidden="true" /> : null}
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {primary.action.label}
        </Button>
      </PopoverAnchor>
      <span id={reasonId} className="sr-only">
        {hold ?? ""}
      </span>
      <PopoverContent align="end" className="w-72 text-sm">
        <p>{hold}</p>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The arrow beside a leading action and the menu it opens: the other ways to
 * publish, then, below a rule, the destructive rows a surface keeps there.
 * Usable while the press is held: each row carries its own reason, and
 * scheduling or adding to a release writes nothing to the form.
 */
export function ActionOptionsMenu({
  options,
  rows = [],
  apartOptions = [],
  dangerOptions = [],
  optionsLabel,
  menuClassName,
  triggerClassName,
}: {
  options: readonly Bound[];
  /** The bar's own rows, after the model's. */
  rows?: readonly NarrowMenuItem[];
  /** Rows set apart below a rule, such as publishing past the review. */
  apartOptions?: readonly Bound[];
  dangerOptions?: readonly Bound[];
  /** What the arrow is called, for what it holds. */
  optionsLabel: string;
  /** Extra classes for the menu, for a surface with its own density. */
  menuClassName?: string;
  /** Extra classes for the arrow, for a surface with its own look. */
  triggerClassName?: string;
}): JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="sm"
          className={cn(
            "rounded-l-none border-l-primary-foreground/25 px-1.5",
            triggerClassName
          )}
          aria-label={optionsLabel}
          title={optionsLabel}
        >
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className={cn("min-w-56", menuClassName)}
      >
        {options.map(entry => (
          <OptionRow key={entry.action.id} entry={entry} />
        ))}
        {rows.map(item => (
          <BarRow key={item.id} item={item} />
        ))}
        {/* A rule only between two populated groups, as in More. */}
        {options.length + rows.length > 0 && apartOptions.length > 0 ? (
          <DropdownMenuSeparator />
        ) : null}
        {apartOptions.map(entry => (
          <OptionRow key={entry.action.id} entry={entry} />
        ))}
        {options.length + rows.length + apartOptions.length > 0 &&
        dangerOptions.length > 0 ? (
          <DropdownMenuSeparator />
        ) : null}
        {dangerOptions.map(entry => (
          <OptionRow key={entry.action.id} entry={entry} danger />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One of the bar's own rows in a menu: a link where it leads to another view,
 * otherwise an item that runs it.
 */
function BarRow({ item }: { item: NarrowMenuItem }) {
  if (item.href !== undefined) {
    return (
      <DropdownMenuItem
        asChild
        disabled={item.disabled === true}
        data-menu-row={item.id}
      >
        <Link href={item.href}>{item.label}</Link>
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuItem
      disabled={item.disabled === true}
      onSelect={item.onSelect}
      data-menu-row={item.id}
    >
      {item.label}
    </DropdownMenuItem>
  );
}

/** One row on the primary action's arrow, with its reason when it is held. */
function OptionRow({
  entry: { action, binding },
  danger = false,
}: {
  entry: Bound;
  danger?: boolean;
}) {
  const reason = reasonFor(action, binding);
  return (
    <>
      <DropdownMenuItem
        disabled={reason !== undefined}
        // `onSelect`, which Radix withholds from a disabled item.
        onSelect={binding.onSelect}
        data-action={action.id}
        className={cn(danger && "text-destructive focus:text-destructive")}
        {...reasonAttributes(reason)}
      >
        <ActionRow label={action.label} reason={reason} />
      </DropdownMenuItem>
      <RecoveryRow entry={{ action, binding }} />
    </>
  );
}

/**
 * The way out of a held row, directly under it, where its binding offers one
 * and it is held: an enabled row of its own, so the menu's keyboard reaches
 * it as it skips the held one.
 */
function RecoveryRow({ entry: { action, binding } }: { entry: Bound }) {
  const { recovery } = binding;
  if (recovery === undefined || reasonFor(action, binding) === undefined) {
    return null;
  }
  return (
    <DropdownMenuItem onSelect={recovery.onSelect} data-retry-for={action.id}>
      {recovery.label}
    </DropdownMenuItem>
  );
}

/** What the arrow is called where something other than Publish leads. */
export const DOCUMENT_OPTIONS_LABEL = "More document actions";

/**
 * The destructive verbs a compact bar keeps on its arrow. Only the one about
 * readers: Unpublish changes what is live, which belongs beside publishing.
 * Discarding and deleting stay on the entry's own page, where the document
 * they act on is the one on screen; a surface holding its own copy of the
 * work would be left showing what was just thrown away.
 */
const COMPACT_DANGER_IDS: ReadonlySet<string> = new Set(["unpublish"]);

/**
 * What a compact bar draws: the leading action, the rows its arrow holds
 * (the toolbar's, then the main button's menu: saving and the other ways to
 * publish) and, below a rule, the destructive one it keeps. One answer for
 * every compact drawing, so a status-carrying pair and the compact bar keep
 * the same rows.
 *
 * `withToolbar: false` is for a surface that draws its own Save beside the
 * leading action: it leaves out the toolbar's rows and Save, which would
 * otherwise be offered twice.
 */
export function compactRows(
  actions: readonly EditorDocumentAction[],
  bindings: DocumentActionBarProps["bindings"],
  { withToolbar = true }: { withToolbar?: boolean } = {}
): { primary: Bound | undefined; options: Bound[]; danger: Bound[] } {
  const { available, primary } = wiredActions(actions, bindings);
  return {
    primary,
    options: [
      ...(withToolbar ? bound(actionsAt(available, "toolbar"), bindings) : []),
      ...bound(actionsAt(available, "publish-menu"), bindings).filter(
        entry => withToolbar || entry.action.id !== SAVE_ACTION_ID
      ),
    ],
    danger: bound(
      menuGroups(available).danger.filter(action =>
        COMPACT_DANGER_IDS.has(action.id)
      ),
      bindings
    ),
  };
}

/**
 * The document's actions as ONE control, for a surface whose bar has room
 * for one, such as a full-window editor that replaces the header.
 *
 * The leading action, and on its arrow: the toolbar's (Save draft), the
 * other ways to publish (Schedule, Add to release), then Unpublish below a
 * rule. Every row is the model's, with the model's reason; this decides only
 * where each is drawn. With nothing leading, the same rows sit in a menu of
 * their own, so a person who may not publish still finds them and reads why.
 */
export function CompactDocumentActionBar({
  actions,
  bindings,
  pending = false,
}: Omit<
  DocumentActionBarProps,
  "className" | "narrowItems" | "mainMenuItems"
>): JSX.Element | null {
  const { primary, options, danger } = compactRows(actions, bindings);
  if (primary === undefined) {
    // Nothing to lead and nothing this bar keeps: no control at all, rather
    // than a menu that opens empty. The entry's page still has its own.
    if (options.length + danger.length === 0) return null;
    return (
      <DocumentMenu
        narrowItems={[]}
        documentItems={options}
        dangerItems={danger}
        wideMenu
        menuClassName={COMPACT_MENU_CLASS}
      />
    );
  }
  return (
    <PrimaryAction
      primary={primary}
      options={options}
      dangerOptions={danger}
      optionsLabel={
        primary.action.id === PUBLISH_ACTION_ID
          ? PUBLISH_OPTIONS_LABEL
          : DOCUMENT_OPTIONS_LABEL
      }
      pending={pending}
      menuClassName={COMPACT_MENU_CLASS}
    />
  );
}

/**
 * The compact bar's menu at the page builder's density: 12px rows 28px high,
 * as the bar it opens from. Spelled here rather than read from the builder's
 * tokens, which a menu drawn outside the editor's element can't inherit.
 */
export const COMPACT_MENU_CLASS =
  "[&_[role=menuitem]]:py-1.5 [&_[role=menuitem]]:text-xs [&_[role=menuitem]]:leading-4";

/**
 * The document's menu: its other verbs, its destructive ones apart, and on a
 * phone the bar's controls folded into it, first.
 */
function DocumentMenu({
  narrowItems,
  documentItems,
  dangerItems,
  wideMenu,
  menuClassName,
}: {
  narrowItems: readonly NarrowMenuItem[];
  documentItems: Bound[];
  dangerItems: Bound[];
  wideMenu: boolean;
  /** Extra classes for the menu, for a surface with its own density. */
  menuClassName?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          {...BAR_ICON_CONTROL}
          aria-label="More actions"
          title="More actions"
          // Named as the editor's outline names its More, so a test can hold
          // the two to one place.
          data-frame-part="bar-more"
          {...(narrowItems.some(item => item.togglesPanel === true)
            ? { [DOCUMENT_PANEL_TOGGLE_ATTRIBUTE]: "" }
            : {})}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={menuClassName}>
        {narrowItems.map(item => (
          <BarRow key={item.id} item={item} />
        ))}
        {narrowItems.length > 0 && wideMenu ? <DropdownMenuSeparator /> : null}
        {documentItems.map(({ action, binding }) => (
          <Fragment key={action.id}>
            <DropdownMenuItem
              disabled={reasonFor(action, binding) !== undefined}
              onClick={binding.onSelect}
              data-action={action.id}
              /*
              The reason travels with the item, not just the buttons. A
              permission an author lacks makes this the ONLY place the
              refusal is visible, and a menu row that is grey and silent
              reads as broken rather than as forbidden. `title` reaches a
              pointer and `aria-description` reaches a screen reader; the
              label alone reaches neither.
            */
              {...reasonAttributes(reasonFor(action, binding))}
            >
              <ActionRow
                label={action.label}
                reason={reasonFor(action, binding)}
              />
            </DropdownMenuItem>
            <RecoveryRow entry={{ action, binding }} />
          </Fragment>
        ))}
        {/*
          A separator only between two populated groups. Drawn
          unconditionally it becomes a rule at the top or bottom of the
          menu, which reads as a group whose items failed to render.
        */}
        {documentItems.length > 0 && dangerItems.length > 0 ? (
          <DropdownMenuSeparator />
        ) : null}
        {dangerItems.map(({ action, binding }) => (
          <Fragment key={action.id}>
            <DropdownMenuItem
              disabled={reasonFor(action, binding) !== undefined}
              onClick={binding.onSelect}
              data-action={action.id}
              className="text-destructive focus:text-destructive"
              {...reasonAttributes(reasonFor(action, binding))}
            >
              <ActionRow
                label={action.label}
                reason={reasonFor(action, binding)}
              />
            </DropdownMenuItem>
            <RecoveryRow entry={{ action, binding }} />
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
