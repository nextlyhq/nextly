"use client";

/**
 * What can be done to the outline's rows, as one object that stays the same
 * for the outline's whole life, so no row redraws because of it; and the
 * state those actions keep: which row has focus, whose menu or Move to… is
 * open, which row a move asks focus back on, and what was last announced.
 *
 * Every move, by key, menu, Move to… or drag, is judged by the one move rule
 * and announced: where the field went, or why nothing moved.
 */
import { useCallback, useMemo, useRef, useState } from "react";

import type { FieldInsertPosition } from "@admin/lib/builder/insert-field";
import type { MoveVerdict } from "@admin/lib/builder/move-rule";
import { movedSentence } from "@admin/lib/builder/move-words";
import {
  dropTarget,
  stepTarget,
  type MoveStep,
  type OutlineRows,
} from "@admin/lib/builder/outline/move-targets";
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
  /** The row whose Move to… is open, if any. */
  moveToFor: string | null;
  closeMoveTo: () => void;
  /**
   * The row a move asks focus back on once it is drawn, taken by the outline
   * when it can focus it.
   */
  takeRefocus: (drawn: (id: string) => boolean) => string | null;
  announcement: string;
}

/** What a field is called in an announcement. */
function spokenName(node: OutlineNode): string {
  return node.field.label || node.field.name || "the field";
}

/** Why a step has nowhere to go, said when it is asked for anyway. */
function nowhereSentence(node: OutlineNode, step: MoveStep): string {
  const name = spokenName(node);
  if (isPendingDelete(node)) {
    return `${name} is deleted. Undo brings it back before it can move.`;
  }
  const why: Record<MoveStep, string> = {
    up: `${name} cannot move up: it is first at the top level, or a deleted field is above it.`,
    down: `${name} cannot move down: it is last at the top level, or a deleted field is below it.`,
    out: `${name} is already at the top level.`,
    in: `There is no container right above ${name} to move into.`,
  };
  return `${why[step]} Nothing moved.`;
}

export function useOutlineActions(
  nodes: readonly OutlineNode[],
  callbacks: OutlineCallbacks
): OutlineActionState {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [moveToFor, setMoveToFor] = useState<string | null>(null);
  const refocus = useRef<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  // A live region says nothing when its text does not change, so the same
  // sentence twice in a row (the same key pressed again where it cannot go)
  // alternates a trailing no-break space, and is said each time.
  const announce = useCallback(
    (text: string) =>
      setAnnouncement(previous => (previous === text ? `${text}\u00a0` : text)),
    []
  );

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

  const takeRefocus = useCallback((drawn: (id: string) => boolean) => {
    const id = refocus.current;
    if (id !== null && drawn(id)) refocus.current = null;
    return id;
  }, []);

  const actions = useMemo<OutlineActions>(() => {
    const call = () => latest.current.callbacks;
    const nodeOf = (id: string) => latest.current.byId.get(id);
    const rows = (): OutlineRows => ({
      nodes: latest.current.nodes,
      byId: latest.current.byId,
    });

    /**
     * Judge a move and keep it if allowed, saying where the field went, or
     * why nothing moved; focus stays on the field either way.
     */
    const carryOut = (
      id: string,
      target: FieldInsertPosition,
      step?: "up" | "down"
    ): MoveVerdict => {
      const before = call().fields;
      const verdict = call().judgeMove(id, target);
      if (verdict.allowed) {
        call().commitMove(verdict.fields);
        announce(movedSentence(before, verdict.fields, id, step));
      } else {
        announce(`${verdict.message} Nothing moved.`);
      }
      refocus.current = id;
      return verdict;
    };

    const canMove = (id: string, step: MoveStep): boolean => {
      const node = nodeOf(id);
      // A deleted row neither moves nor is moved past: the builder no
      // longer holds it, so a move beside it would land elsewhere.
      if (!node || !node.own || node.readOnly || isPendingDelete(node)) {
        return false;
      }
      // Nor past a read-only sibling, nor anywhere else the rule refuses;
      // the step's target is null beside a deleted row.
      const target = stepTarget(rows(), id, step);
      return target !== null && call().judgeMove(id, target).allowed;
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
      addInside: id => {
        const node = nodeOf(id);
        // The builder no longer holds a deleted container to add into.
        if (!node || !isPendingDelete(node))
          call().addAt({ parentFieldId: id });
      },
      addAfter: id => {
        const node = nodeOf(id);
        // A read-only row, or one in a read-only container, offers no place.
        if (node?.own && node.readOnly === null && !isPendingDelete(node)) {
          call().addAt(positionAfter(node));
        }
      },
      canMove,
      move: (id, step) => {
        const node = nodeOf(id);
        if (!node) return;
        const target = isPendingDelete(node)
          ? null
          : stepTarget(rows(), id, step);
        // A registered block, or one of its props, is declared in code: it is
        // read here, not a field, so it never moves.
        if (node.meta) {
          announce(
            `${spokenName(node)} is declared in code, not a field of this entity, so it does not move.`
          );
          return;
        }
        if (!target) {
          announce(nowhereSentence(node, step));
          return;
        }
        carryOut(
          id,
          target,
          step === "up" || step === "down" ? step : undefined
        );
      },
      openMoveTo: id => setMoveToFor(id),
      moveDestinations: id => call().moveDestinations(id),
      judgeMoveTo: (id, target) => call().judgeMove(id, target),
      moveTo: (id, target) => {
        const verdict = carryOut(id, target);
        if (verdict.allowed) setMoveToFor(null);
        return verdict;
      },
      judgeDrop: (activeId, overId, levels) => {
        const target = dropTarget(rows(), activeId, overId, levels);
        return target ? call().judgeMove(activeId, target) : null;
      },
      drop: (activeId, overId, levels) => {
        const node = nodeOf(activeId);
        if (!node) return;
        const target = dropTarget(rows(), activeId, overId, levels);
        if (target) {
          carryOut(activeId, target);
          return;
        }
        announce(
          overId === activeId
            ? `${spokenName(node)} was dropped where it was. Nothing moved.`
            : `${spokenName(node)} cannot go where a deleted field was until the delete is saved or undone. Nothing moved.`
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
          announce(
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
  }, [focusRow, siblingsOf, announce]);

  return {
    actions,
    registerRow,
    focusRow,
    focusedId,
    setFocusedId,
    menuFor,
    moveToFor,
    closeMoveTo: () => setMoveToFor(null),
    takeRefocus,
    announcement,
  };
}
