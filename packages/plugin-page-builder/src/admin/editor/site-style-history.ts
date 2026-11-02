"use client";

/**
 * The editor's side of undoing a shared style change.
 *
 * A studio's save is recorded as a step of the editor's history (see
 * `SiteStyleHistoryContext`). This wraps each step so that taking it back or
 * putting it forward:
 * - moves `revision` on, which the Design panel keys its open tab by. A
 *   studio holds its own copy of the section while it is open, and a write
 *   made behind its back would be overwritten by its next edit; remounted, it
 *   reads the section afresh.
 * - tells the author when the write was refused, since the change then stays
 *   as it is and the step leaves the history.
 *
 * @module admin/editor/site-style-history
 */
import { toast } from "@nextlyhq/ui";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Context,
} from "react";

import type {
  SiteStyleHistory,
  SiteStyleSection,
  SiteStyleStep,
} from "../site-style-client";

/** How many times a style step has been replayed; the Design panel's key. */
export const StyleRevisionContext: Context<number> = createContext(0);

/** The editor's history, as far as a style step needs it. */
type RecordStep = (step: SiteStyleStep) => void;

/**
 * Held ABOVE the editor's own hooks, because some of the style writers run in
 * the editor component itself and read the context from its parent. The
 * editor's history is created inside that component, so it connects its
 * `recordStep` once it exists; a save before that joins no history.
 */
export function useSiteStyleHistory(): {
  history: SiteStyleHistory;
  revision: number;
  connect: (record: RecordStep | null) => void;
} {
  const [revision, setRevision] = useState(0);
  const written = useRef(new Map<SiteStyleSection, unknown>()).current;
  const recorder = useRef<RecordStep | null>(null);
  const connect = useCallback((record: RecordStep | null) => {
    recorder.current = record;
  }, []);
  const history = useMemo<SiteStyleHistory>(() => {
    const replay =
      (half: () => Promise<boolean>, verb: "undone" | "redone") => async () => {
        setRevision(current => current + 1);
        const stored = await half();
        if (!stored) {
          toast.error(
            `That style change could not be ${verb}, so it stays as it is.`
          );
        }
        return stored;
      };
    return {
      written,
      record: step =>
        recorder.current?.({
          undo: replay(step.undo, "undone"),
          redo: replay(step.redo, "redone"),
        }),
    };
  }, [written]);
  return { history, revision, connect };
}

/** How the editor below connects its history to the one provided above it. */
export const ConnectStyleHistoryContext: Context<
  (record: RecordStep | null) => void
> = createContext<(record: RecordStep | null) => void>(() => {});

/** Connect the editor's history while it is mounted, and let it go after. */
export function useConnectStyleHistory(recordStep: RecordStep): void {
  const connect = useContext(ConnectStyleHistoryContext);
  useEffect(() => {
    connect(recordStep);
    return () => connect(null);
  }, [connect, recordStep]);
}
