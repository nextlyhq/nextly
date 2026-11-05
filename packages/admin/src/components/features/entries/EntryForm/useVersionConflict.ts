/**
 * The version an editor's copy started from, and the conflict a save made
 * from it opens when the document changed since.
 *
 * One rule, for every editor form: the copy carries the version it started
 * from, sends it with every write, and moves it only when the copy on screen
 * is replaced by a read or by a write the server answered. A save refused
 * because the document changed since pins the form, keeping the edits on
 * screen, until the author chooses: load the current version (the edits kept
 * as a recovery point that remembers the version they began from), or save
 * theirs anyway (an overwrite naming the version they began from, so history
 * records whose changes it replaced).
 *
 * The form keeps its own rules for when a read resets it; it asks `pinned`
 * before applying one, and `adoptRead` when it does.
 */
import { useCallback, useMemo, useRef, useState } from "react";

import {
  DOCUMENT_OVERWRITE_KEY,
  DOCUMENT_VERSION_KEY,
  staleVersionOf,
  versionOf,
  type StaleVersion,
} from "@admin/lib/document-version";
import { versionApi, type VersionScope } from "@admin/services/versionApi";

/** A refused save, as the conflict dialog shows it. */
export interface VersionConflict {
  stale: StaleVersion;
  /** Why the last choice did not go through, to show beside the choices. */
  failure?: string;
}

interface Pinned {
  stale: StaleVersion;
  /** The refused write, without its version. */
  payload: Record<string, unknown>;
  /** The version the refused edits began from. */
  startedFrom: string | undefined;
}

export interface VersionConflictState {
  /** The conflict to show, or null when no save is refused. */
  conflict: VersionConflict | null;
  /** Whether a refused save holds the form: no read may reset it. */
  pinned: () => boolean;
  /** The version the copy on screen started from. */
  startedFrom: () => string | undefined;
  /** `payload` with the version the copy started from, when it has one. */
  withVersion: <T extends Record<string, unknown>>(payload: T) => T;
  /** The copy was replaced by `doc`, as read. */
  adoptRead: (doc: unknown) => void;
  /** A write the server answered with `item` stored the copy. */
  adoptAnswered: (item: unknown) => void;
  /**
   * Edits restored from a recovery point now hold the form: the version they
   * began from, or the one on screen for a point saved before versions.
   */
  adoptRecovered: (startedFrom: string | undefined) => void;
  /**
   * Pin the form when `error` refuses `payload` because the document changed
   * since; answers whether it did.
   */
  refused: (error: unknown, payload: Record<string, unknown>) => boolean;
  /** The refused write again, saving over the newer version on purpose. */
  overwrite: () => Record<string, unknown> | null;
  /**
   * Keep `values` as a recovery point that remembers the version they began
   * from, before the form loads the current version. Rejects, leaving the
   * conflict open with the reason, when the point cannot be written.
   */
  keepEdits: (
    scope: VersionScope | null,
    values: Record<string, unknown>,
    locale: string | null | undefined
  ) => Promise<void>;
  /** The version the refused edits began from, while pinned. */
  refusedFrom: () => string | undefined;
  /** Say why a choice did not go through, keeping the conflict open. */
  failed: (message: string) => void;
  /** Close the conflict: the author chose, and the choice went through. */
  release: () => void;
}

/** `payload` naming `version` as the one it began from, when there is one. */
function withStartingVersion<T extends Record<string, unknown>>(
  payload: T,
  version: string | undefined
): T {
  return version === undefined
    ? payload
    : { ...payload, [DOCUMENT_VERSION_KEY]: version };
}

export function useVersionConflict(): VersionConflictState {
  const startedFrom = useRef<string | undefined>(undefined);
  const pin = useRef<Pinned | null>(null);
  const [conflict, setConflict] = useState<VersionConflict | null>(null);

  const pinned = useCallback(() => pin.current !== null, []);
  const currentStart = useCallback(() => startedFrom.current, []);

  const withVersion = useCallback(
    <T extends Record<string, unknown>>(payload: T): T =>
      withStartingVersion(payload, startedFrom.current),
    []
  );

  const adoptRead = useCallback((doc: unknown) => {
    startedFrom.current = versionOf(doc);
  }, []);

  const adoptAnswered = useCallback((item: unknown) => {
    // A write that answers with no version (an older server) leaves the copy
    // where it was rather than unversioned.
    startedFrom.current = versionOf(item) ?? startedFrom.current;
  }, []);

  const adoptRecovered = useCallback((recovered: string | undefined) => {
    if (recovered !== undefined) startedFrom.current = recovered;
  }, []);

  const refused = useCallback(
    (error: unknown, payload: Record<string, unknown>) => {
      const stale = staleVersionOf(error);
      if (!stale) return false;
      const { [DOCUMENT_VERSION_KEY]: _sent, ...rest } = payload;
      pin.current = { stale, payload: rest, startedFrom: startedFrom.current };
      setConflict({ stale });
      return true;
    },
    []
  );

  const overwrite = useCallback(() => {
    const held = pin.current;
    if (!held) return null;
    // The version the edits began from, so history names whose changes the
    // overwrite replaced.
    return withStartingVersion(
      { ...held.payload, [DOCUMENT_OVERWRITE_KEY]: true },
      held.startedFrom
    );
  }, []);

  const failed = useCallback((message: string) => {
    const held = pin.current;
    if (held) setConflict({ stale: held.stale, failure: message });
  }, []);

  const keepEdits = useCallback(
    async (
      scope: VersionScope | null,
      values: Record<string, unknown>,
      locale: string | null | undefined
    ) => {
      if (!scope) {
        throw new Error(
          "This document has no recovery points to keep edits in."
        );
      }
      await versionApi.saveAutosave(
        scope,
        withStartingVersion(values, pin.current?.startedFrom),
        locale
      );
    },
    []
  );

  const refusedFrom = useCallback(() => pin.current?.startedFrom, []);

  const release = useCallback(() => {
    pin.current = null;
    setConflict(null);
  }, []);

  // One object while the conflict is unchanged, so a form's effects can
  // depend on it without running again on every render.
  return useMemo(
    () => ({
      conflict,
      pinned,
      startedFrom: currentStart,
      withVersion,
      adoptRead,
      adoptAnswered,
      adoptRecovered,
      refused,
      overwrite,
      keepEdits,
      refusedFrom,
      failed,
      release,
    }),
    [
      adoptRecovered,
      conflict,
      pinned,
      currentStart,
      withVersion,
      adoptRead,
      adoptAnswered,
      refused,
      overwrite,
      keepEdits,
      refusedFrom,
      failed,
      release,
    ]
  );
}
