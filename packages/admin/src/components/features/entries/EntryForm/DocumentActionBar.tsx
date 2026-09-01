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
} from "@nextlyhq/ui";
import { Loader2, MoreHorizontal } from "lucide-react";

import { cn } from "@admin/lib/utils";

import {
  actionsAt,
  menuGroups,
  withContributedActions,
  type DocumentAction,
} from "./document-actions";
import { ToolbarLabel } from "./toolbar-density";

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
  action: DocumentAction;
  binding: ActionBinding;
}

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
  built: readonly DocumentAction[],
  builtBindings: Readonly<Record<string, ActionBinding | undefined>>,
  contributed: readonly ContributedAction[]
): {
  actions: DocumentAction[];
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
      bindings[entry.action.id] = entry.binding;
  }
  return { actions, bindings };
}

export interface DocumentActionBarProps {
  actions: readonly DocumentAction[];
  /** Keyed by action id. An action with no entry is not drawn. */
  bindings: Readonly<Record<string, ActionBinding | undefined>>;
  /** Whether a mutation is in flight, which shows on the leading action. */
  pending?: boolean;
  className?: string;
}

/**
 * How a refusal is spoken on a menu item.
 *
 * Nothing when the action is usable, so a usable row carries no stray
 * attributes and a test asserting their absence means something.
 */
function reasonAttributes(reason: string | undefined): Record<string, string> {
  return reason === undefined
    ? {}
    : { title: reason, "aria-description": reason };
}

/** Both reasons an action may be unusable, or undefined when it is usable. */
function reasonFor(
  action: DocumentAction,
  binding: ActionBinding
): string | undefined {
  return action.disabledReason ?? binding.disabledReason;
}

/**
 * The actions a host actually wired, paired with their bindings.
 *
 * Filtered ONCE and reused by each region, so a control cannot appear in the
 * toolbar while the menu believes it does not exist.
 */
function bound(
  actions: readonly DocumentAction[],
  bindings: DocumentActionBarProps["bindings"]
): { action: DocumentAction; binding: ActionBinding }[] {
  const out: { action: DocumentAction; binding: ActionBinding }[] = [];
  for (const action of actions) {
    const binding = bindings[action.id];
    if (binding !== undefined) out.push({ action, binding });
  }
  return out;
}

export function DocumentActionBar({
  actions,
  bindings,
  pending = false,
  className,
}: DocumentActionBarProps) {
  const wired = bound(actions, bindings);
  const available = wired.map(entry => entry.action);
  const primary = bound(actionsAt(available, "primary"), bindings)[0];
  const toolbar = bound(actionsAt(available, "toolbar"), bindings);
  const groups = menuGroups(available);
  const documentItems = bound(groups.document, bindings);
  const dangerItems = bound(groups.danger, bindings);
  const hasMenu = documentItems.length > 0 || dangerItems.length > 0;

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
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
          <ToolbarLabel priority="lifecycle">{action.label}</ToolbarLabel>
        </Button>
      ))}

      {primary === undefined ? null : (
        <Button
          size="sm"
          {...(primary.binding.submitForm === undefined
            ? { type: "button" as const, onClick: primary.binding.onSelect }
            : { type: "submit" as const, form: primary.binding.submitForm })}
          disabled={reasonFor(primary.action, primary.binding) !== undefined}
          /*
            The reason is the title when there is one, so a control an author
            cannot use says why. Three separate permissions and several document
            states decide these, and a dead button with no explanation reads as
            broken rather than as forbidden.
          */
          title={
            reasonFor(primary.action, primary.binding) ?? primary.action.label
          }
          data-action={primary.action.id}
          data-primary="true"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {primary.action.label}
        </Button>
      )}

      {hasMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="px-2"
              aria-label="More actions"
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {documentItems.map(({ action, binding }) => (
              <DropdownMenuItem
                key={action.id}
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
                {action.label}
              </DropdownMenuItem>
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
              <DropdownMenuItem
                key={action.id}
                disabled={reasonFor(action, binding) !== undefined}
                onClick={binding.onSelect}
                data-action={action.id}
                className="text-destructive focus:text-destructive"
                {...reasonAttributes(reasonFor(action, binding))}
              >
                {action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
