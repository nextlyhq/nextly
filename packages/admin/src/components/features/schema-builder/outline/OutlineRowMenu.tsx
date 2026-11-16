"use client";

/**
 * A row's menu: what can be done to the field, in words. Opened from the
 * row's "⋯" by a pointer, or by Shift+F10 and the context-menu key on the row.
 *
 * A read-only row offers nothing that changes the definition: only its
 * settings, shown without letting them change, the field group it comes from,
 * and where it is defined.
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
import type { JSX } from "react";

import { MoreHorizontal } from "@admin/components/icons";
import { canFocus } from "@admin/lib/builder/outline/focus-view";
import {
  describeReadOnly,
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

export function OutlineRowMenu({
  node,
  open,
  actions,
}: {
  node: OutlineNode;
  open: boolean;
  actions: OutlineActions;
}): JSX.Element {
  const { id, field, readOnly, container } = node;
  const subject = field.label || field.name || "this field";
  const group = fieldGroupOf(node);
  const holdsFields = container === "group" || container === "repeater";

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
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="font-normal text-muted-foreground">
              {describeReadOnly(readOnly)}
            </DropdownMenuLabel>
          </>
        ) : (
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
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
