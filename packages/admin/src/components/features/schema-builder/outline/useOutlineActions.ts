"use client";

/**
 * What can be done to the outline's rows, as one object that stays the same
 * for the outline's whole life, so no row redraws because of it; and the
 * state those actions keep: which row has focus, whose menu is open, and what
 * was last announced.
 */
import { useCallback, useMemo, useRef, useState } from "react";

import type { FieldInsertPosition } from "@admin/lib/builder/insert-field";
import {
  flattenOutline,
  type OutlineNode,
} from "@admin/lib/builder/outline/outline-model";
import { isPendingDelete } from "@admin/lib/builder/outline/pending-rows";

import type { OutlineActions, OutlineCallbacks } from "./outline-types";

export interface OutlineActionState {
  actions: OutlineActions;
  registerRow: (id: string, element: HTMLElement | null) => void;
  /** Focus a row; `scroll` brings it into view, as moving by key does. */
  focusRow: (id: string, scroll?: boolean) => void;
  focusedId: string | null;
  setFocusedId: (id: string | null) => void;
  menuFor: string | null;
  announcement: string;
}

/** What a field is called in an announcement. */
function spokenName(node: OutlineNode): string {
  return node.field.label || node.field.name || "the field";
}

export function useOutlineActions(
  nodes: readonly OutlineNode[],
  callbacks: OutlineCallbacks
): OutlineActionState {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const byId = useMemo(
    () => new Map(flattenOutline(nodes).map(node => [node.id, node])),
    [nodes]
  );
  // The latest of everything the actions read, so they need not change.
  const latest = useRef({ byId, nodes, callbacks });
  latest.current = { byId, nodes, callbacks };
  const rowElements = useRef(new Map<string, HTMLElement>());

  const registerRow = useCallback((id: string, element: HTMLElement | null) => {
    if (element) rowElements.current.set(id, element);
    else rowElements.current.delete(id);
  }, []);

  /** The rows a node sits among: its container's, or the top level's. */
  const siblingsOf = useCallback(
    (node: OutlineNode): readonly OutlineNode[] => {
      const parent = node.parentId
        ? latest.current.byId.get(node.parentId)
        : undefined;
      return parent ? parent.children : latest.current.nodes;
    },
    []
  );

  const focusRow = useCallback((id: string, scroll = false) => {
    setFocusedId(id);
    rowElements.current.get(id)?.focus({ preventScroll: !scroll });
  }, []);

  const actions = useMemo<OutlineActions>(() => {
    const call = () => latest.current.callbacks;
    const nodeOf = (id: string) => latest.current.byId.get(id);

    const canMove = (id: string, delta: -1 | 1): boolean => {
      const node = nodeOf(id);
      // A deleted row neither moves nor is moved past: the builder no
      // longer holds it, so a move beside it would land elsewhere.
      if (!node || !node.own || node.readOnly || isPendingDelete(node)) {
        return false;
      }
      const siblings = siblingsOf(node);
      const target = siblings[siblings.indexOf(node) + delta];
      // Nor past a read-only sibling: that would move it too.
      return (
        target !== undefined &&
        target.own &&
        target.readOnly === null &&
        !isPendingDelete(target)
      );
    };

    /** Right after a field, in its own container. */
    const positionAfter = (node: OutlineNode): FieldInsertPosition => {
      const siblings = siblingsOf(node);
      const next = siblings[siblings.indexOf(node) + 1];
      return {
        ...(node.parentId ? { parentFieldId: node.parentId } : {}),
        ...(next ? { beforeFieldId: next.id } : {}),
      };
    };

    return {
      setMenuOpen: setMenuFor,
      focusRow: id => focusRow(id),
      select: id => {
        const node = nodeOf(id);
        // A registered block, or its prop, is no field: nothing to open; nor
        // is a deleted field, which the builder no longer holds.
        if (!node?.meta && !(node && isPendingDelete(node))) call().select(id);
        focusRow(id);
      },
      addInside: id => call().addAt({ parentFieldId: id }),
      addAfter: id => {
        const node = nodeOf(id);
        // A read-only row, or one in a read-only container, offers no place.
        if (node?.own && node.readOnly === null) {
          call().addAt(positionAfter(node));
        }
      },
      canMove,
      move: (id, delta) => {
        const node = nodeOf(id);
        if (!node || !canMove(id, delta)) return;
        const siblings = siblingsOf(node);
        const at = siblings.indexOf(node) + delta;
        call().move(id, delta);
        setAnnouncement(
          `Moved ${spokenName(node)} ${delta < 0 ? "up" : "down"}, position ${
            at + 1
          } of ${siblings.length}.`
        );
      },
      duplicate: id => call().duplicate(id),
      remove: id => {
        const node = nodeOf(id);
        call().remove(id);
        // Pending until the save, and said so, with what goes with it.
        if (node) {
          // Only the fields that go with it: a field group's own fields, shown
          // beneath a field that uses it, stay where they are defined.
          const inside = flattenOutline(node.children).filter(
            row => row.own && !row.meta
          ).length;
          setAnnouncement(
            `Deleted ${spokenName(node)}${
              inside
                ? ` and ${inside} ${inside === 1 ? "field" : "fields"} inside`
                : ""
            }. Undo brings ${inside ? "them" : "it"} back.`
          );
        }
      },
      setHidden: (id, hidden) => call().setHidden(id, hidden),
      openFieldGroup: slug => call().openFieldGroup(slug),
    };
  }, [focusRow, siblingsOf]);

  return {
    actions,
    registerRow,
    focusRow,
    focusedId,
    setFocusedId,
    menuFor,
    announcement,
  };
}
