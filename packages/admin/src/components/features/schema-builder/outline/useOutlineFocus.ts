"use client";

/**
 * Focus over the outline: which container is shown on its own, kept for this visit only, and what
 * the outline draws because of it. A container that goes away (deleted, undone, moved out of
 * reach) hands Focus to the deepest crumb still there, or ends it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  focusFallback,
  focusView,
  type FocusView,
} from "@admin/lib/builder/outline/focus-view";
import type { OutlineNode } from "@admin/lib/builder/outline/outline-model";

export interface OutlineFocus {
  view: FocusView;
  /**
   * Show one container on its own, or the whole outline for null, asking the outline to put
   * keyboard focus on the first of `returnTo` it then draws.
   */
  show: (id: string | null, returnTo?: readonly (string | null)[]) => void;
  /**
   * Whether a change of Focus asked for keyboard focus since the last drawing, and the row it
   * asked for, the first of them drawn (null when none is: an empty container, say, where the
   * outline gives focus elsewhere). Asked once, on the first drawing after `show`, and forgotten
   * after it.
   */
  takeReturn: (drawn: (id: string) => boolean) => FocusReturn;
}

export interface FocusReturn {
  asked: boolean;
  id: string | null;
}

export function useOutlineFocus(nodes: readonly OutlineNode[]): OutlineFocus {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const view = useMemo(() => focusView(nodes, focusedId), [nodes, focusedId]);
  // The crumbs last shown, so a container that goes away hands Focus to the deepest one left.
  const crumbIds = useRef<string[]>([]);
  if (view.focused) crumbIds.current = view.crumbs.map(crumb => crumb.id);
  // The rows a change of Focus asked to return to, or null when none asked.
  const returning = useRef<readonly (string | null)[] | null>(null);

  useEffect(() => {
    if (focusedId !== null && view.focused === null) {
      setFocusedId(focusFallback(nodes, crumbIds.current));
    }
  }, [focusedId, view.focused, nodes]);

  const show = useCallback(
    (id: string | null, returnTo: readonly (string | null)[] = []) => {
      returning.current = returnTo;
      setFocusedId(id);
    },
    []
  );

  const takeReturn = useCallback(
    (drawn: (id: string) => boolean): FocusReturn => {
      const candidates = returning.current;
      returning.current = null;
      if (candidates === null) return { asked: false, id: null };
      return {
        asked: true,
        id:
          candidates.find((id): id is string => id !== null && drawn(id)) ??
          null,
      };
    },
    []
  );

  // One object while what it holds is the same, so what is built from it is not rebuilt on every
  // drawing of the outline.
  return useMemo(() => ({ view, show, takeReturn }), [view, show, takeReturn]);
}
