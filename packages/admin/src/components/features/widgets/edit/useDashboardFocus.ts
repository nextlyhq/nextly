"use client";

/**
 * Where keyboard focus goes after a gesture changes the dashboard under it.
 *
 * Moving, removing and restoring a card each re-render the element that held
 * focus somewhere else, or take it away entirely. Left alone the browser drops
 * focus to `body`, and the reader's next Tab restarts at the top of the page --
 * a whole-page relocation reported as one card changing. So each gesture names
 * where focus should land, and this hook puts it there once that element is on
 * the page.
 *
 * ## Why a request waits for the element
 *
 * The target is often not there yet when the gesture finishes: a restored card
 * reappears only once the server's answer has been read again, and a card
 * moved in the draft is re-mounted by the render the move causes. A request is
 * therefore held until the element registers, rather than tried once and lost.
 *
 * @module components/features/widgets/edit/useDashboardFocus
 */

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

import { DASHBOARD_HEADING_ID } from "../../dashboard/WelcomeHeader";

/** Somewhere focus can be sent. */
export type FocusTarget =
  /** A card's actions menu button, while customising. */
  | { kind: "menu"; placementId: string }
  /** A card's own dismiss control, outside customising. */
  | { kind: "dismiss"; placementId: string }
  /** The Undo button on the removal notice. */
  | { kind: "undo" }
  /** The add-a-card picker. */
  | { kind: "add" }
  /** The region that holds the cards. */
  | { kind: "grid" }
  /** The dashboard's one level-one heading. */
  | { kind: "heading" }
  /** The customise bar, as customise mode opens. */
  | { kind: "bar" }
  /** The Customize button, as customise mode closes. */
  | { kind: "customize" };

/** A ref callback that files an element under one key. */
type Register = (element: HTMLElement | null) => void;

export interface DashboardFocus {
  /** Registers a card's menu button. */
  menuRef: (placementId: string) => Register;
  /** Registers a card's dismiss control. */
  dismissRef: (placementId: string) => Register;
  /** Registers the notice's Undo button. */
  undoRef: Register;
  /** Registers the customise bar. */
  barRef: Register;
  /** Registers the Customize button. */
  customizeRef: Register;
  /** The add picker. */
  addRef: RefObject<HTMLElement | null>;
  /** The region holding the cards. */
  gridRef: RefObject<HTMLElement | null>;
  /** Send focus to `target` as soon as it is on the page. */
  request: (target: FocusTarget) => void;
}

/** The key a target's element is filed under. */
function keyOf(target: FocusTarget): string {
  return "placementId" in target
    ? `${target.kind}:${target.placementId}`
    : target.kind;
}

export function useDashboardFocus(): DashboardFocus {
  const elements = useRef(new Map<string, HTMLElement>());
  // Ref callbacks kept per key, so each element is handed the SAME callback on
  // every render; a fresh one would detach and re-attach it every time.
  const callbacks = useRef(new Map<string, Register>());
  const pending = useRef<FocusTarget | null>(null);
  const addRef = useRef<HTMLElement | null>(null);
  const gridRef = useRef<HTMLElement | null>(null);
  // Bumped by a request so the effect below runs even when the gesture that
  // asked caused no render of its own (a re-read that has already landed).
  const [, setRequests] = useState(0);

  const register = useCallback((key: string): Register => {
    const known = callbacks.current.get(key);
    if (known) return known;
    const callback: Register = element => {
      if (element) elements.current.set(key, element);
      else elements.current.delete(key);
    };
    callbacks.current.set(key, callback);
    return callback;
  }, []);

  const find = useCallback((target: FocusTarget): HTMLElement | null => {
    if (target.kind === "add") return addRef.current;
    if (target.kind === "grid") return gridRef.current;
    if (target.kind === "heading") {
      // The heading belongs to the page, not to the grid, so it is found by
      // its id; a grid drawn without it lands on its own region instead.
      return document.getElementById(DASHBOARD_HEADING_ID) ?? gridRef.current;
    }
    return elements.current.get(keyOf(target)) ?? null;
  }, []);

  // No dependency list: a held request is retried after EVERY render of the
  // grid, which is exactly when a target can have appeared. A layout effect, so
  // focus moves before the browser paints the card in its new place.
  useLayoutEffect(() => {
    const target = pending.current;
    if (!target) return;
    const element = find(target);
    if (!element || !element.isConnected) return;
    pending.current = null;
    element.focus();
    // `nearest`, so a card already in view does not jump; one moved off screen
    // is brought back to where the reader can see it landed.
    element.scrollIntoView({ block: "nearest" });
  });

  const request = useCallback((target: FocusTarget) => {
    pending.current = target;
    setRequests(count => count + 1);
  }, []);

  return useMemo(
    () => ({
      menuRef: (placementId: string) => register(`menu:${placementId}`),
      dismissRef: (placementId: string) => register(`dismiss:${placementId}`),
      undoRef: register("undo"),
      barRef: register("bar"),
      customizeRef: register("customize"),
      addRef,
      gridRef,
      request,
    }),
    [register, request]
  );
}
