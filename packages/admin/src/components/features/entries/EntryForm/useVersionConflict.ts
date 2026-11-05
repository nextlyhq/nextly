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
import { useMemo, useState } from "react";

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
  /**
   * A rejection handler for a write of `payload`: pins the form, as
   * `refused` does, then rejects with the same error.
   */
  refusedThen: (payload: Record<string, unknown>) => (error: unknown) => never;
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

/** What a form's version holds across renders: its copy's, and a refused save. */
interface Tracked {
  startedFrom: string | undefined;
  pin: Pinned | null;
  setConflict: (conflict: VersionConflict | null) => void;
}

function adoptAnswered(tracked: Tracked, item: unknown): void {
  // A write that answers with no version (an older server) leaves the copy
  // where it was rather than unversioned.
  tracked.startedFrom = versionOf(item) ?? tracked.startedFrom;
}

function adoptRecovered(tracked: Tracked, recovered: string | undefined): void {
  if (recovered !== undefined) tracked.startedFrom = recovered;
}

function pinRefusal(
  tracked: Tracked,
  error: unknown,
  payload: Record<string, unknown>
): boolean {
  const stale = staleVersionOf(error);
  if (!stale) return false;
  const { [DOCUMENT_VERSION_KEY]: _sent, ...rest } = payload;
  tracked.pin = { stale, payload: rest, startedFrom: tracked.startedFrom };
  tracked.setConflict({ stale });
  return true;
}

function pinThenReject(
  tracked: Tracked,
  payload: Record<string, unknown>,
  error: unknown
): never {
  pinRefusal(tracked, error, payload);
  throw error;
}

function overwriteOf(tracked: Tracked): Record<string, unknown> | null {
  const held = tracked.pin;
  if (!held) return null;
  // The version the edits began from, so history names whose changes the
  // overwrite replaced.
  return withStartingVersion(
    { ...held.payload, [DOCUMENT_OVERWRITE_KEY]: true },
    held.startedFrom
  );
}

function fail(tracked: Tracked, message: string): void {
  const held = tracked.pin;
  if (held) tracked.setConflict({ stale: held.stale, failure: message });
}

async function keepEdits(
  tracked: Tracked,
  scope: VersionScope | null,
  values: Record<string, unknown>,
  locale: string | null | undefined
): Promise<void> {
  if (!scope) {
    throw new Error("This document has no recovery points to keep edits in.");
  }
  await versionApi.saveAutosave(
    scope,
    withStartingVersion(values, tracked.pin?.startedFrom),
    locale
  );
}

function release(tracked: Tracked): void {
  tracked.pin = null;
  tracked.setConflict(null);
}

/** A form's version actions, over what `tracked` holds. */
function actionsOver(tracked: Tracked): Omit<VersionConflictState, "conflict"> {
  return {
    pinned: () => tracked.pin !== null,
    startedFrom: () => tracked.startedFrom,
    withVersion: <T extends Record<string, unknown>>(payload: T): T =>
      withStartingVersion(payload, tracked.startedFrom),
    adoptRead: (doc: unknown) => {
      tracked.startedFrom = versionOf(doc);
    },
    adoptAnswered: (item: unknown) => adoptAnswered(tracked, item),
    adoptRecovered: (recovered: string | undefined) =>
      adoptRecovered(tracked, recovered),
    refused: (error: unknown, payload: Record<string, unknown>) =>
      pinRefusal(tracked, error, payload),
    refusedThen: (payload: Record<string, unknown>) => (error: unknown) =>
      pinThenReject(tracked, payload, error),
    overwrite: () => overwriteOf(tracked),
    keepEdits: (scope, values, locale) =>
      keepEdits(tracked, scope, values, locale),
    refusedFrom: () => tracked.pin?.startedFrom,
    failed: (message: string) => fail(tracked, message),
    release: () => release(tracked),
  };
}

export function useVersionConflict(): VersionConflictState {
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  // Made once, so every action is stable for the form's life and a form's
  // effects can depend on them.
  const [actions] = useState(() =>
    actionsOver({ startedFrom: undefined, pin: null, setConflict })
  );
  // One object while the conflict is unchanged, so a form's effects can
  // depend on it without running again on every render.
  return useMemo(() => ({ conflict, ...actions }), [conflict, actions]);
}
