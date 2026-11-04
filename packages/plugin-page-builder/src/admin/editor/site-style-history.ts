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
import { useBeforeDocumentAction } from "@nextlyhq/plugin-sdk/admin";
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

import {
  releaseHeldSiteStyle,
  sameSection,
  storedSection,
  type SectionChain,
  type SiteStyleHistory,
  type SiteStyleReplay,
  type SiteStyleSection,
} from "../site-style-client";
import { useStoredSiteStyle } from "../site-style-read";

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

/** How long a stored replay waits for the read before asking for it again. */
const READ_BACK_WAIT_MS = 5000;

/** A fresh copy restarts the read-back wait without changing what it awaits. */
function again(current: SiteStyleReplay | null): SiteStyleReplay | null {
  return current === null ? null : { ...current };
}

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
 * made then would write it back. So the revision moves once the read holds
 * the replayed value. Should it not within {@link READ_BACK_WAIT_MS}, the
 * read is asked for again, and the answer is the server's own, whatever it
 * holds by then: the surfaces remount on that, never on the read the write
 * replaced. Settling until then, and while any replay is in flight.
 */
function useReadBack(
  setRevision: (next: (current: number) => number) => void
): {
  inFlight: (delta: number) => void;
  waitForRead: (replay: SiteStyleReplay) => void;
  settling: boolean;
} {
  // The same read the canvas draws from, so "caught up" means the canvas
  // shows the replayed value.
  const { data, refetch } = useStoredSiteStyle();
  const [replaying, setReplaying] = useState(0);
  const [awaiting, setAwaiting] = useState<SiteStyleReplay | null>(null);
  const caughtUp = useCallback(() => {
    setAwaiting(null);
    setRevision(current => current + 1);
  }, [setRevision]);
  useEffect(() => {
    if (
      awaiting !== null &&
      sameSection(storedSection(data, awaiting.section), awaiting.value)
    ) {
      caughtUp();
    }
  }, [data, awaiting, caughtUp]);
  useEffect(() => {
    if (awaiting === null) return;
    let live = true;
    const timer = setTimeout(() => {
      // Only a read that answered unlocks the surfaces. A failed one leaves
      // the value the replay replaced, so the wait starts over instead.
      Promise.resolve(refetch?.()).then(
        answer => {
          if (!live) return;
          if (answer?.isError === true) setAwaiting(again);
          else caughtUp();
        },
        () => {
          if (live) setAwaiting(again);
        }
      );
    }, READ_BACK_WAIT_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [awaiting, caughtUp, refetch]);
  const inFlight = useCallback((delta: number) => {
    setReplaying(current => current + delta);
  }, []);
  return {
    inFlight,
    waitForRead: setAwaiting,
    settling: replaying > 0 || awaiting !== null,
  };
}

/** The editor's history, as far as a style step needs it. */
type RecordStep = (step: {
  readonly undo: () => Promise<boolean>;
  readonly redo: () => Promise<boolean>;
}) => () => void;

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
  /** The held values drawn over the stored read, for `SiteStylePreviewContext`. */
  preview: ReadonlyMap<SiteStyleSection, unknown>;
} {
  const [revision, setRevision] = useState(0);
  const { shown, preview } = useHeldPreview();
  const { inFlight, waitForRead, settling } = useReadBack(setRevision);
  const settled = useRef(new Map<SiteStyleSection, SectionChain>()).current;
  const recorder = useRef<RecordStep | null>(null);
  const connect = useCallback((record: RecordStep | null) => {
    recorder.current = record;
  }, []);
  const history = useMemo<SiteStyleHistory>(() => {
    const replay =
      (half: () => Promise<SiteStyleReplay>, verb: "undone" | "redone") =>
      async (): Promise<boolean> => {
        inFlight(1);
        try {
          const outcome = await half();
          const stored = outcome.stored;
          if (stored) {
            waitForRead(outcome);
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
      preview,
      record: step =>
        recorder.current?.({
          undo: replay(step.undo, "undone"),
          redo: replay(step.redo, "redone"),
        }) ?? (() => {}),
    };
  }, [settled, inFlight, waitForRead, preview]);
  const replay = useMemo(() => ({ revision, settling }), [revision, settling]);
  useReleaseWhenDone(history);
  return { history, replay, connect, preview: shown };
}

/** A held value drawn over the read, and the read its write answered at. */
interface Shown {
  value: unknown;
  /** The read when the write was stored; `UNANSWERED` while it is held. */
  storedAt: unknown;
}

/** What `storedAt` reads before a write has answered. */
const UNANSWERED: unique symbol = Symbol("unanswered");

/**
 * The held values drawn over the stored read, so the canvas shows an edit at
 * once while its write waits for the author's pause.
 *
 * A stored value stays drawn until the read moves on from the one it was
 * stored at: the write asks for the read again, and dropping the value before
 * that answer would draw the old one for a moment in between. A refused value
 * is dropped at once, so the canvas goes back to what is stored.
 */
function useHeldPreview(): {
  shown: ReadonlyMap<SiteStyleSection, unknown>;
  preview: NonNullable<SiteStyleHistory["preview"]>;
} {
  const { data } = useStoredSiteStyle();
  const read = useRef<unknown>(data);
  read.current = data;
  const [held, setHeld] = useState<ReadonlyMap<SiteStyleSection, Shown>>(
    () => new Map()
  );
  const preview = useCallback<NonNullable<SiteStyleHistory["preview"]>>(
    (section, value, state) => {
      setHeld(current => {
        const was = current.get(section);
        // An answer about a value no longer drawn is about an older burst.
        if (state !== "held" && was?.value !== value) return current;
        const next = new Map(current);
        // Dropped too once stored where the read already holds it, which
        // happens when the read came back before the write's answer did.
        if (
          state === "dropped" ||
          (state === "stored" &&
            sameSection(storedSection(read.current, section), value))
        ) {
          next.delete(section);
        } else
          next.set(section, {
            value,
            storedAt: state === "stored" ? read.current : UNANSWERED,
          });
        return next;
      });
    },
    []
  );
  useEffect(() => {
    setHeld(current => {
      const moved = [...current].filter(
        ([section, shown]) =>
          shown.storedAt !== UNANSWERED &&
          (shown.storedAt !== data ||
            sameSection(storedSection(data, section), shown.value))
      );
      if (moved.length === 0) return current;
      const next = new Map(current);
      for (const [section] of moved) next.delete(section);
      return next;
    });
  }, [data]);
  const shown = useMemo(
    () => new Map([...held].map(([section, { value }]) => [section, value])),
    [held]
  );
  return { shown, preview };
}

/**
 * Writes what a Design edit left waiting for the author's pause whenever the
 * pause cannot be waited for: before the page is saved or published (the
 * form's storing gate then waits for it, and for any write still on its way,
 * so the page and its styles are stored together), when the browser tab is
 * hidden or closed, and when the editor goes away.
 */
function useReleaseWhenDone(history: SiteStyleHistory): void {
  // Started here; the form's storing gate then waits for every write, these
  // included, and refuses Save and Publish while one of them was refused,
  // for as long as the form lives, so also once the editor has closed.
  useBeforeDocumentAction(() => {
    void releaseHeldSiteStyle(history);
  });
  useEffect(() => {
    const release = (): void => {
      void releaseHeldSiteStyle(history);
    };
    // Hidden is the last moment a page is sure to see: it comes before
    // `pagehide`, and is all a mobile browser closing a tab may send. Nothing
    // here can wait for the write, so it is sent to outlive the page (the
    // Single's update asks `keepalive` for every site style write).
    const hidden = (): void => {
      if (document.visibilityState === "hidden") release();
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", release);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", release);
      release();
    };
  }, [history]);
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
