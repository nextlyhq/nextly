"use client";

/**
 * Work on a SECOND document from inside the view of another: read its latest
 * version, hold its lock, save it as a draft or publish it, record a recovery
 * point for it, and let it go.
 *
 * The admin keeps one document's lock, saving, recovery and leave guard
 * around a document view. A surface that edits another document in place
 * (the page builder editing a site header while the page stays open) needs
 * the same for that document, and had no way to ask: these are the admin's
 * own pieces, pointed at the document the caller names.
 *
 * - **Open**: the document as its editor would read it, the held working
 *   draft in place of the live row where the collection keeps one, with when
 *   it last changed and whether it has changes a visitor does not see yet.
 * - **Lock**: the admin's advisory claim (`useDocumentLock`), naming who holds
 *   it when someone else does. Taken while a document is named and let go
 *   when the caller names none (its Done), on unmount, and on `pagehide`, as
 *   the editor's own claim is.
 * - **Save as draft / Publish**: through the admin's own update
 *   (`useUpdateEntry`), as the signed-in person, sending the version the copy
 *   started from, so a newer save made meanwhile refuses the write. The
 *   session adds no access rule of its own: the server judges every write.
 *   "Save as draft" never writes the live row: on a published document it
 *   stores the working draft, and where the collection keeps none it refuses.
 * - **Recovery point**: the admin's recording (`useSnapshotAutosave`), keyed by
 *   this document, so after a crash the work is offered when the document is
 *   next opened, by the recovery banner its own editor already shows.
 *
 * @module hooks/useDocumentSession
 * @experimental Settles with editing a second document in place.
 */

import { useCallback, useMemo, useRef, type MutableRefObject } from "react";

import { useCollectionSchema } from "@admin/hooks/queries/useCollections";
import {
  useDocumentLock,
  type DocumentLockState,
} from "@admin/hooks/queries/useDocumentLock";
import { useEntry } from "@admin/hooks/queries/useEntry";
import { useUpdateEntry } from "@admin/hooks/queries/useUpdateEntry";
import { useCan } from "@admin/hooks/useCan";
import {
  autosaveScopeFor,
  documentRecordingKey,
  emptyThePoint,
} from "@admin/hooks/useDocumentAutosave";
import {
  recordingsSettled,
  useSnapshotAutosave,
} from "@admin/hooks/useSnapshotAutosave";
import {
  DOCUMENT_VERSION_KEY,
  staleVersionOf,
  versionOf,
} from "@admin/lib/document-version";
import { parseServerErrorMessage } from "@admin/lib/errors/error-mapping";
import { readsHeldDraft } from "@admin/lib/held-draft";
import type { UpdateEntryPayload } from "@admin/services/entryApi";
import { versionApi } from "@admin/services/versionApi";
import type { Entry } from "@admin/types/collection";

/**
 * The document a session works on: an entry of a collection.
 *
 * @experimental Settles with editing a second document in place.
 */
export interface DocumentSessionTarget {
  /** The collection the document is an entry of, by its slug. */
  readonly collection: string;
  /** The entry's id. */
  readonly id: string;
  /** The language read and written, for a localized collection. */
  readonly locale?: string;
}

/**
 * The document as it was read.
 *
 * @experimental Settles with editing a second document in place.
 */
export type DocumentSessionOpen =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly retry: () => void }
  | {
      readonly status: "ready";
      /** Its stored values: the working draft's where one is held. */
      readonly values: Readonly<Record<string, unknown>>;
      /** Whether a version of it is live. */
      readonly published: boolean;
      /** Whether it holds changes a visitor does not see yet. */
      readonly unpublishedChanges: boolean;
      /** When the version read was last changed, as an ISO 8601 time. */
      readonly changedAt: string | null;
      /**
       * Whether "Save as draft" can store it without changing what is live:
       * false on a published document of a collection that keeps no drafts.
       */
      readonly draftable: boolean;
    };

/**
 * Where the session's lock stands.
 *
 * @experimental Settles with editing a second document in place.
 */
export type DocumentSessionLock =
  /** No document named, or the claim not answered yet. */
  | { readonly status: "claiming" }
  /** This session holds it. */
  | { readonly status: "held" }
  /** Someone else holds it: their name, or null where it is not known. */
  | { readonly status: "held-by-other"; readonly holder: string | null }
  /** This session held it, and someone took it or it lapsed. */
  | { readonly status: "lost" }
  /** The claim could not be asked for; it is asked again on the next beat. */
  | { readonly status: "unavailable" };

/**
 * Why a save or publish did not happen: a newer version was saved since this
 * copy was read (`stale`), this session does not hold the lock (`locked`),
 * the collection keeps no drafts for a published document (`no-drafts`), the
 * document has not been read yet (`unread`), or the server refused it
 * (`refused`).
 *
 * @experimental Settles with editing a second document in place.
 */
export type DocumentSessionRefusal =
  | "stale"
  | "locked"
  | "no-drafts"
  | "unread"
  | "refused";

/**
 * What a save or publish came to.
 *
 * @experimental Settles with editing a second document in place.
 */
export type DocumentSessionOutcome =
  | {
      readonly ok: true;
      /** The document as the write stored it. */
      readonly values: Readonly<Record<string, unknown>>;
    }
  | {
      readonly ok: false;
      readonly reason: DocumentSessionRefusal;
      /** The server's own words, where it gave any. */
      readonly message: string | null;
      /** For `stale`: who saved the newer version, where the caller may know. */
      readonly changedBy?: string | null;
    };

/**
 * A session on a second document.
 *
 * @experimental Settles with editing a second document in place.
 */
export interface DocumentSession {
  readonly open: DocumentSessionOpen;
  readonly lock: DocumentSessionLock;
  /** Whether the signed-in person may publish documents of the collection. */
  readonly mayPublish: boolean;
  /** Store `changes` over the document as a draft, leaving what is live. */
  readonly saveDraft: (
    changes: Readonly<Record<string, unknown>>
  ) => Promise<DocumentSessionOutcome>;
  /** Store `changes` over the document and make it live. */
  readonly publish: (
    changes: Readonly<Record<string, unknown>>
  ) => Promise<DocumentSessionOutcome>;
  /**
   * Record `changes` over the document as this person's recovery point for
   * it, once the editing has paused. Where the document keeps no recovery
   * points the server refuses the recording, and nothing is kept.
   */
  readonly record: (changes: Readonly<Record<string, unknown>>) => void;
  /**
   * The changes are thrown away: drop a recording not yet made and empty the
   * recovery point this session recorded, so it is not offered later.
   */
  readonly discard: () => Promise<void>;
}

/** The lock's state as a session's caller reads it. */
function sessionLockOf(state: DocumentLockState): DocumentSessionLock {
  switch (state.status) {
    case "held-by-me":
      return { status: "held" };
    case "held-by-other":
      return {
        status: "held-by-other",
        holder: state.holder.ownerLabel?.trim() || null,
      };
    case "taken-over":
    case "lost":
      return { status: "lost" };
    case "unavailable":
      return { status: "unavailable" };
    default:
      return { status: "claiming" };
  }
}

/** A refusal from the server as the session's caller reads it. */
function refusalOf(error: unknown): DocumentSessionOutcome {
  const stale = staleVersionOf(error);
  const message = parseServerErrorMessage(error);
  return stale === undefined
    ? { ok: false, reason: "refused", message }
    : {
        ok: false,
        reason: "stale",
        message,
        changedBy: stale.changedBy?.name ?? null,
      };
}

/** Whether a read entry is live. */
function isPublished(entry: Entry): boolean {
  return entry.status === "published";
}

/** What a write of `intent` sends as the status, from what was read. */
function statusFor(
  intent: "draft" | "publish",
  published: boolean,
  hasStatus: boolean
): Record<string, string> {
  if (intent === "publish") return hasStatus ? { status: "published" } : {};
  // A draft of a live document leaves the status out, which stores the
  // working draft; a document not yet live is stored as a draft.
  return published ? {} : { status: "draft" };
}

/** The document's values without its id, which a recovery point leaves out. */
function withoutId(entry: Entry): Record<string, unknown> {
  const values: Record<string, unknown> = { ...entry };
  delete values.id;
  return values;
}

/** Whether "Save as draft" can store a document without changing what is live. */
function isDraftable(
  published: boolean,
  hasStatus: boolean,
  keepsDrafts: boolean
): boolean {
  return hasStatus && (!published || keepsDrafts);
}

/** The document as read, and what its collection keeps. */
interface SessionRead {
  readonly entry: Entry | undefined;
  readonly open: DocumentSessionOpen;
  readonly hasStatus: boolean;
  readonly keepsDrafts: boolean;
}

/**
 * Read the named document as its editor would: its held working draft in
 * place of the live row where the collection keeps one.
 */
function useSessionRead(target: DocumentSessionTarget | null): SessionRead {
  const named = target !== null;
  const slug = target?.collection ?? "";
  // Whether the collection keeps a working draft, which decides both how the
  // document is read and what "Save as draft" may send.
  const schema = useCollectionSchema(named ? slug : undefined);
  const keepsDrafts = readsHeldDraft(schema.data);
  const hasStatus = schema.data?.status === true;
  const read = useEntry({
    collectionSlug: slug,
    entryId: target?.id ?? "",
    draft: keepsDrafts,
    locale: target?.locale,
    enabled: named && schema.data !== undefined,
  });
  const entry = named ? read.data : undefined;
  const failed = read.isError || schema.isError;
  const { refetch: refetchRead } = read;
  const { refetch: refetchSchema } = schema;
  const open = useMemo((): DocumentSessionOpen => {
    if (entry !== undefined) {
      const published = isPublished(entry);
      return {
        status: "ready",
        values: entry,
        published,
        unpublishedChanges: !published || entry._isWorkingDraft === true,
        changedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : null,
        draftable: isDraftable(published, hasStatus, keepsDrafts),
      };
    }
    if (!failed) return { status: "loading" };
    return {
      status: "failed",
      retry: () => {
        void refetchSchema();
        void refetchRead();
      },
    };
  }, [entry, hasStatus, keepsDrafts, failed, refetchRead, refetchSchema]);
  return useMemo(
    () => ({ entry, open, hasStatus, keepsDrafts }),
    [entry, open, hasStatus, keepsDrafts]
  );
}

/**
 * The version the copy started from, moved by each new read and by each of
 * the session's own writes (through the ref it hands out): the next write
 * sends it, and the lock's beats name it.
 */
function useCopyVersion(
  entry: Entry | undefined
): MutableRefObject<string | undefined> {
  const versionRef = useRef<string | undefined>(undefined);
  const readVersion = versionOf(entry);
  const seenRead = useRef<string | undefined>(undefined);
  if (readVersion !== seenRead.current) {
    seenRead.current = readVersion;
    versionRef.current = readVersion;
  }
  return versionRef;
}

/** The admin's lock on the named document, as the session's caller reads it. */
function useSessionLock(
  target: DocumentSessionTarget | null,
  versionRef: MutableRefObject<string | undefined>
): DocumentSessionLock {
  const lock = useDocumentLock({
    scopeKind: "collection",
    slug: target?.collection ?? "",
    entryId: target?.id ?? null,
    enabled: target !== null,
    version: () => versionRef.current,
  });
  return useMemo(() => sessionLockOf(lock.state), [lock.state]);
}

/** The session's recording of its recovery point. */
interface SessionRecording {
  /** The document the recordings belong to, which a save waits on. */
  readonly document: string | null;
  readonly record: (
    entry: Entry,
    changes: Readonly<Record<string, unknown>>
  ) => void;
  /** The work was stored: nothing more to record until the next change. */
  readonly stored: () => void;
  readonly cancel: () => void;
  readonly discard: () => Promise<void>;
}

/**
 * The person's recovery point for the named document, recorded through the
 * admin's own recording, only while the session holds the document:
 * anything else would record over a colleague's working copy.
 */
function useSessionRecording(
  target: DocumentSessionTarget | null,
  held: boolean
): SessionRecording {
  const locale = target?.locale ?? null;
  const slug = target?.collection ?? "";
  const id = target?.id;
  const scope = useMemo(
    () => (id === undefined ? null : autosaveScopeFor("collection", slug, id)),
    [slug, id]
  );
  const document = documentRecordingKey(scope);
  const snapshotRef = useRef<Record<string, unknown>>({});
  // Whether there is work since the last write, so a recording that waited
  // through a save does not store a copy of what the save just stored.
  const unsavedRef = useRef(false);
  const { schedule, cancel, lastSent } = useSnapshotAutosave({
    identity: document === null ? null : `${document}:${locale ?? ""}`,
    document,
    save: () =>
      scope === null
        ? Promise.reject(new Error("session: no document to record"))
        : versionApi.saveAutosave(scope, snapshotRef.current, locale),
    enabled: held,
    stillWanted: () => unsavedRef.current,
  });
  const record = useCallback(
    (entry: Entry, changes: Readonly<Record<string, unknown>>) => {
      // The WHOLE document, since restoring a recovery point replaces every
      // value its editor holds: the read's values with the changes over them.
      snapshotRef.current = { ...withoutId(entry), ...changes };
      unsavedRef.current = true;
      schedule();
    },
    [schedule]
  );
  const stored = useCallback(() => {
    unsavedRef.current = false;
  }, []);
  const discard = useCallback(async () => {
    unsavedRef.current = false;
    cancel();
    if (scope === null || lastSent() === null) return;
    await emptyThePoint(scope, locale, () => !unsavedRef.current);
  }, [cancel, scope, lastSent, locale]);
  return useMemo(
    () => ({ document, record, stored, cancel, discard }),
    [document, record, stored, cancel, discard]
  );
}

/**
 * Whether a write of `intent` may be sent, judged before anything is asked
 * of the server: the document read, or why it may not.
 */
function mayWrite(
  read: SessionRead,
  held: boolean,
  intent: "draft" | "publish"
): { readonly entry: Entry } | { readonly refused: DocumentSessionRefusal } {
  const { entry } = read;
  if (entry === undefined) return { refused: "unread" };
  if (!held) return { refused: "locked" };
  if (
    intent === "draft" &&
    !isDraftable(isPublished(entry), read.hasStatus, read.keepsDrafts)
  ) {
    return { refused: "no-drafts" };
  }
  return { entry };
}

/**
 * Open a session on `target`, or on nothing: naming none (`null`) lets go of
 * the lock and stops recording, as unmounting does.
 *
 * @experimental Settles with editing a second document in place.
 */
export function useDocumentSession(
  target: DocumentSessionTarget | null
): DocumentSession {
  const read = useSessionRead(target);
  const versionRef = useCopyVersion(read.entry);
  const lock = useSessionLock(target, versionRef);
  const held = lock.status === "held";
  const recording = useSessionRecording(target, held);
  const slug = target?.collection ?? "";
  const mayPublish = useCan(`publish-${slug}`);
  const { mutateAsync } = useUpdateEntry({
    collectionSlug: slug,
    entryId: target?.id ?? "",
    locale: target?.locale,
    // The caller says what happened, in its own words, where it is working.
    showToast: false,
    // The read stays what was stored until the server says otherwise.
    optimistic: false,
  });

  const write = useCallback(
    async (
      changes: Readonly<Record<string, unknown>>,
      intent: "draft" | "publish"
    ): Promise<DocumentSessionOutcome> => {
      const verdict = mayWrite(read, held, intent);
      if ("refused" in verdict) {
        return { ok: false, reason: verdict.refused, message: null };
      }
      // A recording landing after the write would put the work back as a
      // recovery point, so the ones on their way land first.
      recording.cancel();
      await recordingsSettled(recording.document);
      const version = versionRef.current;
      const payload: UpdateEntryPayload = {
        ...(changes as UpdateEntryPayload),
        ...statusFor(intent, isPublished(verdict.entry), read.hasStatus),
        ...(version === undefined ? {} : { [DOCUMENT_VERSION_KEY]: version }),
      };
      try {
        const result = await mutateAsync(payload);
        versionRef.current = versionOf(result.item) ?? versionRef.current;
        recording.stored();
        return { ok: true, values: result.item };
      } catch (error) {
        return refusalOf(error);
      }
    },
    [read, held, recording, versionRef, mutateAsync]
  );
  const saveDraft = useCallback(
    (changes: Readonly<Record<string, unknown>>) => write(changes, "draft"),
    [write]
  );
  const publish = useCallback(
    (changes: Readonly<Record<string, unknown>>) => write(changes, "publish"),
    [write]
  );
  const { entry } = read;
  const { record: recordEntry, discard } = recording;
  const record = useCallback(
    (changes: Readonly<Record<string, unknown>>) => {
      if (entry !== undefined) recordEntry(entry, changes);
    },
    [entry, recordEntry]
  );

  return useMemo(
    () => ({
      open: read.open,
      lock,
      mayPublish,
      saveDraft,
      publish,
      record,
      discard,
    }),
    [read.open, lock, mayPublish, saveDraft, publish, record, discard]
  );
}
