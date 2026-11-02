"use client";

/**
 * The editor's side of undoing a shared style change.
 *
 * A studio's save is recorded as a step of the editor's history (see
 * `SiteStyleHistoryContext`). This wraps each step so that taking it back or
 * putting it forward:
 * - moves `revision` on once the replayed value has reached the read, which
 *   the Design panel's open tab and the breakpoint manager are keyed by. Each
 *   holds its own copy of a section while it is open, and a write made behind
 *   its back would be overwritten by its next edit; remounted, it reads the
 *   section afresh. Until then they are `settling` and inert, so nothing is
 *   edited against the value the replay is replacing.
 * - tells the author when the write was refused, since the change then stays
 *   as it is and the step leaves the history.
 *
 * @module admin/editor/site-style-history
 */
import { useSingleDocument } from "@nextlyhq/plugin-sdk/admin";
import { toast } from "@nextlyhq/ui";
import {
  createContext,
  createElement,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Context,
  type JSX,
  type ReactNode,
} from "react";

import { SITE_STYLE_SLUG } from "../../site-style-storage";
import type {
  SectionChain,
  SiteStyleHistory,
  SiteStyleSection,
  SiteStyleStep,
} from "../site-style-client";

/**
 * How many style steps have been replayed and their values read back (the
 * key the surfaces holding a copy remount on), and whether one is replaying
 * or waiting for the read to catch up.
 */
export interface StyleReplay {
  revision: number;
  settling: boolean;
}

export const StyleRevisionContext: Context<StyleReplay> =
  createContext<StyleReplay>({
    revision: 0,
    settling: false,
  });

/** How long a stored replay waits for the read before remounting anyway. */
const READ_BACK_WAIT_MS = 5000;

/**
 * Mounts its children afresh each time a style step is undone or redone.
 *
 * For a surface that holds its own copy of a section while it is open: the
 * Design panel's tabs, and the breakpoint manager with its draft and the save
 * it holds the read against. A write made behind its back would otherwise be
 * overwritten by its next edit, or left looking stale for good.
 */
export function RemountOnStyleReplay({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const { revision, settling } = useContext(StyleRevisionContext);
  return createElement(
    "div",
    {
      key: revision,
      className: "contents",
      inert: settling,
      "aria-busy": settling || undefined,
    },
    children
  );
}

/**
 * Waits for the site style's read to catch up with a replayed write, then
 * moves the revision on.
 *
 * The write invalidates the read rather than updating it, so a surface
 * remounted at once would read the value the replay replaced, and an edit
 * made then would write it back. So the revision moves once the read has
 * moved past what it held when the write was stored, or after
 * {@link READ_BACK_WAIT_MS} should it never. Settling until then, and while
 * any replay is in flight.
 */
function useReadBack(
  setRevision: (next: (current: number) => number) => void
): {
  inFlight: (delta: number) => void;
  waitForRead: () => void;
  settling: boolean;
} {
  const { data } = useSingleDocument(SITE_STYLE_SLUG);
  const latest = useRef(data);
  latest.current = data;
  const [replaying, setReplaying] = useState(0);
  // The read as it stood when a replayed write was stored, or none.
  const [awaiting, setAwaiting] = useState<{ read: unknown } | null>(null);
  const caughtUp = useCallback(() => {
    setAwaiting(null);
    setRevision(current => current + 1);
  }, [setRevision]);
  useEffect(() => {
    if (awaiting !== null && data !== awaiting.read) caughtUp();
  }, [data, awaiting, caughtUp]);
  useEffect(() => {
    if (awaiting === null) return;
    const timer = setTimeout(caughtUp, READ_BACK_WAIT_MS);
    return () => clearTimeout(timer);
  }, [awaiting, caughtUp]);
  const inFlight = useCallback((delta: number) => {
    setReplaying(current => current + delta);
  }, []);
  const waitForRead = useCallback(() => {
    setAwaiting({ read: latest.current });
  }, []);
  return {
    inFlight,
    waitForRead,
    settling: replaying > 0 || awaiting !== null,
  };
}

/** The editor's history, as far as a style step needs it. */
type RecordStep = (step: SiteStyleStep) => () => void;

/**
 * Held ABOVE the editor's own hooks, because some of the style writers run in
 * the editor component itself and read the context from its parent. The
 * editor's history is created inside that component, so it connects its
 * `recordStep` once it exists; a save before that joins no history.
 */
export function useSiteStyleHistory(): {
  history: SiteStyleHistory;
  replay: StyleReplay;
  connect: (record: RecordStep | null) => void;
} {
  const [revision, setRevision] = useState(0);
  const { inFlight, waitForRead, settling } = useReadBack(setRevision);
  const settled = useRef(new Map<SiteStyleSection, SectionChain>()).current;
  const recorder = useRef<RecordStep | null>(null);
  const connect = useCallback((record: RecordStep | null) => {
    recorder.current = record;
  }, []);
  const history = useMemo<SiteStyleHistory>(() => {
    const replay =
      (half: () => Promise<boolean>, verb: "undone" | "redone") => async () => {
        inFlight(1);
        try {
          const stored = await half();
          if (stored) {
            waitForRead();
          } else {
            toast.error(
              `That style change could not be ${verb}, so it stays as it is.`
            );
          }
          return stored;
        } finally {
          inFlight(-1);
        }
      };
    return {
      settled,
      record: step =>
        recorder.current?.({
          undo: replay(step.undo, "undone"),
          redo: replay(step.redo, "redone"),
        }) ?? (() => {}),
    };
  }, [settled, inFlight, waitForRead]);
  const replay = useMemo(() => ({ revision, settling }), [revision, settling]);
  return { history, replay, connect };
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
