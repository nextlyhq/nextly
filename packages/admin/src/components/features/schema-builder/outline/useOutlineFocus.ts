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
   * The row asked for focus, the first of them drawn; asked once, on the first drawing after
   * `show`, and forgotten after it whether or not one was drawn.
   */
  takeReturn: (drawn: (id: string) => boolean) => string | null;
}

export function useOutlineFocus(nodes: readonly OutlineNode[]): OutlineFocus {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const view = useMemo(() => focusView(nodes, focusedId), [nodes, focusedId]);
  // The crumbs last shown, so a container that goes away hands Focus to the deepest one left.
  const crumbIds = useRef<string[]>([]);
  if (view.focused) crumbIds.current = view.crumbs.map(crumb => crumb.id);
  const returning = useRef<readonly (string | null)[]>([]);

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

  const takeReturn = useCallback((drawn: (id: string) => boolean) => {
    const candidates = returning.current;
    returning.current = [];
    return (
      candidates.find((id): id is string => id !== null && drawn(id)) ?? null
    );
  }, []);

  return { view, show, takeReturn };
}
