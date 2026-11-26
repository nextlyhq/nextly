"use client";

/**
 * A row's menu: what can be done to the field, in words. Opened from the
 * row's "⋯" by a pointer, or by Shift+F10 and the context-menu key on the row.
 *
 * A read-only row offers nothing that changes the definition: only its
 * settings, shown without letting them change, the field group it comes from,
 * and where it is defined. A field group's own field offers Move to… as well,
 * disabled, with the move rule's reason it stays.
 */
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import { extractFieldGroupReferences } from "nextly/field-group-type";
import { type JSX, useId } from "react";

import { MoreHorizontal } from "@admin/components/icons";
import { canFocus } from "@admin/lib/builder/outline/focus-view";
import {
  describeReadOnly,
  isFieldGroupOwnRow,
  type OutlineNode,
} from "@admin/lib/builder/outline/outline-model";

import type { OutlineActions } from "./outline-types";

/**
 * The field group a row opens: the one a field-group field uses, or else the
 * one a row is defined in. A field that accepts several field groups offers
 * none itself; each of its field groups is a row of its own that does.
 */
function fieldGroupOf(
  node: OutlineNode
): { slug: string; label: string } | null {
  if (node.container === "field-group") {
    const single = extractFieldGroupReferences(node.field).single;
    if (single === undefined) return null;
    // Its fields carry the field group's label, once it has loaded.
    const loaded = node.children[0]?.readOnly;
    return {
      slug: single,
      label: loaded?.kind === "field-group" ? loaded.label : single,
    };
  }
  if (node.readOnly?.kind === "field-group") {
    return { slug: node.readOnly.slug, label: node.readOnly.label };
  }
  return null;
}

/**
 * Why a row stays where it is when the move rule refuses moving it at all, wherever to: a field
 * group's own field, which changes only in its field group's editor. Undefined for any other row,
 * or a move the rule would allow. The tree asks it for the row whose menu is open, each time it
 * draws, so an open menu says what the rule says now.
 */
export function menuMoveRefusal(
  node: OutlineNode,
  actions: OutlineActions
): string | undefined {
  if (!isFieldGroupOwnRow(node)) return undefined;
  const verdict = actions.judgeMoveTo(node.id, {});
  return verdict.allowed ? undefined : verdict.message;
}

export function OutlineRowMenu({
  node,
  open,
  moveRefusal,
  actions,
}: {
  node: OutlineNode;
  open: boolean;
  /** Why the row stays where it is, while its menu is open (`menuMoveRefusal`). */
  moveRefusal?: string;
  actions: OutlineActions;
}): JSX.Element {
  const { id, field, readOnly } = node;
  const subject = field.label || field.name || "this field";
  const group = fieldGroupOf(node);

  return (
    <DropdownMenu
      open={open}
      onOpenChange={next => actions.setMenuOpen(next ? id : null)}
    >
      <DropdownMenuTrigger asChild>
        {/* For a pointer only: the row's own keys open this menu, so the
            trigger stays out of the tab order and the accessibility tree. */}
        <button
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        aria-label={`Actions for ${subject}`}
        onCloseAutoFocus={event => {
          event.preventDefault();
          actions.focusRow(id);
        }}
      >
        {/* A registered block, or its prop, has no settings to open. */}
        {!node.meta && (
          <DropdownMenuItem onSelect={() => actions.select(id)}>
            {readOnly ? "View settings" : "Edit settings"}
          </DropdownMenuItem>
        )}
        {group && (
          <DropdownMenuItem onSelect={() => actions.openFieldGroup(group.slug)}>
            Open the field group {group.label}
          </DropdownMenuItem>
        )}
        {/* Showing a container on its own changes nothing, so a read-only
            one offers it too. */}
        {actions.focusContainer && canFocus(node) && (
          <DropdownMenuItem onSelect={() => actions.focusContainer?.(id)}>
            Focus
          </DropdownMenuItem>
        )}
        {readOnly ? (
          <ReadOnlyItems readOnly={readOnly} refused={moveRefusal} />
        ) : (
          <EditableItems node={node} actions={actions} />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * What a read-only row's menu says after its other items: why it stays as it is. A field group's
 * own field also offers Move to…, disabled, described by the move rule's reason it stays
 * (`refused`), so a person who looks for it learns why.
 */
function ReadOnlyItems({
  readOnly,
  refused,
}: {
  readOnly: NonNullable<OutlineNode["readOnly"]>;
  refused: string | undefined;
}): JSX.Element {
  const reasonId = useId();
  return (
    <>
      <DropdownMenuSeparator />
      {refused && (
        <DropdownMenuItem disabled aria-describedby={reasonId}>
          Move to…
        </DropdownMenuItem>
      )}
      <DropdownMenuLabel
        id={reasonId}
        className="font-normal text-muted-foreground"
      >
        {refused ?? describeReadOnly(readOnly)}
      </DropdownMenuLabel>
    </>
  );
}

/** What an editable row's menu offers after its other items: every change to the field. */
function EditableItems({
  node,
  actions,
}: {
  node: OutlineNode;
  actions: OutlineActions;
}): JSX.Element {
  const { id, field, container } = node;
  const holdsFields = container === "group" || container === "repeater";
  return (
    <>
      <DropdownMenuSeparator />
      {holdsFields && (
        <DropdownMenuItem onSelect={() => actions.addInside(id)}>
          Add a field inside
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onSelect={() => actions.addAfter(id)}>
        Add a field after
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={!actions.canMove(id, "up")}
        onSelect={() => actions.move(id, "up")}
      >
        Move up
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={!actions.canMove(id, "down")}
        onSelect={() => actions.move(id, "down")}
      >
        Move down
      </DropdownMenuItem>
      {/* Every place, with why not for the ones it may not go, so it
          is offered whenever the field itself may move. */}
      <DropdownMenuItem onSelect={() => actions.openMoveTo(id)}>
        Move to…
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => actions.duplicate(id)}>
        Duplicate
      </DropdownMenuItem>
      {actions.rename && actions.canRename?.(id) && (
        <DropdownMenuItem onSelect={() => actions.rename?.(id)}>
          Rename…
        </DropdownMenuItem>
      )}
      {actions.changeType && actions.canChangeType?.(id) && (
        <DropdownMenuItem onSelect={() => actions.changeType?.(id)}>
          Change type…
        </DropdownMenuItem>
      )}
      <DropdownMenuItem
        onSelect={() => actions.setHidden(id, !field.admin?.hidden)}
      >
        {field.admin?.hidden ? "Show" : "Hide"}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        className="text-destructive"
        onSelect={() => actions.remove(id)}
      >
        Delete
      </DropdownMenuItem>
    </>
  );
}
