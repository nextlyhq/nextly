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

import { effectiveEntryStatus } from "@admin/components/features/entries/EntryForm/entry-address";
import type { EntryData } from "@admin/components/features/entries/EntryForm/useEntryForm";
import { useCollectionSchema } from "@admin/hooks/queries/useCollections";
import {
  useDocumentLock,
  type DocumentLockState,
} from "@admin/hooks/queries/useDocumentLock";
import { useStoredEntry } from "@admin/hooks/queries/useStoredReferences";
import { useUpdateEntry } from "@admin/hooks/queries/useUpdateEntry";
import { useCan } from "@admin/hooks/useCan";
import { useAsksTranslationStatus } from "@admin/hooks/useCanRequest";
import {
  autosaveScopeFor,
  documentRecordingKey,
  emptyThePoint,
  holdsOwnRecording,
} from "@admin/hooks/useDocumentAutosave";
import { useLocalization } from "@admin/hooks/useLocalization";
import {
  lastStoredRecording,
  recordingsSettled,
  useSnapshotAutosave,
} from "@admin/hooks/useSnapshotAutosave";
import {
  DOCUMENT_OVERWRITE_KEY,
  DOCUMENT_VERSION_KEY,
  staleVersionOf,
  versionOf,
} from "@admin/lib/document-version";
import { parseServerErrorMessage } from "@admin/lib/errors/error-mapping";
import { readsHeldDraft } from "@admin/lib/held-draft";
import type { UpdateEntryPayload } from "@admin/services/entryApi";
import { versionApi, type VersionScope } from "@admin/services/versionApi";

/** A document as stored: its values at depth 0, related items by their ids. */
type StoredDocument = Record<string, unknown>;

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
 * document has not been read yet (`unread`), the caller named another
 * document before it was sent (`moved`), or the server refused it
 * (`refused`).
 *
 * @experimental Settles with editing a second document in place.
 */
export type DocumentSessionRefusal =
  | "stale"
  | "locked"
  | "no-drafts"
  | "unread"
  | "moved"
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

/**
 * Whether the language a document was read in is live: the language's own
 * state where the read carries every language's (`_translations`), else the
 * row's, by the rule the document's own editor reads it with.
 */
function isPublished(
  document: StoredDocument,
  locale: string | undefined,
  defaultLocale: string | undefined
): boolean {
  return (
    effectiveEntryStatus(document as EntryData, locale, defaultLocale) ===
    "published"
  );
}

/** Whether "Save as draft" can store a document without changing what is live. */
function isDraftable(
  published: boolean,
  hasStatus: boolean,
  keepsDrafts: boolean
): boolean {
  return hasStatus && (!published || keepsDrafts);
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

/**
 * The caller's changes, without what only the session decides: the status a
 * write sends follows from the operation (a draft of a live document must
 * name none, or it would publish or unpublish it), and the version from the
 * copy read, never from the caller.
 */
function changedFields(
  changes: Readonly<Record<string, unknown>>
): UpdateEntryPayload {
  const fields: Record<string, unknown> = { ...changes };
  delete fields.status;
  delete fields[DOCUMENT_VERSION_KEY];
  delete fields[DOCUMENT_OVERWRITE_KEY];
  return fields as UpdateEntryPayload;
}

/** The document's values without its id, which a recovery point leaves out. */
function withoutId(document: StoredDocument): Record<string, unknown> {
  const values: Record<string, unknown> = { ...document };
  delete values.id;
  return values;
}

/** Which document, in which language: a write is fenced by it. */
function targetKey(target: DocumentSessionTarget | null): string | null {
  return target === null
    ? null
    : `${target.collection}\u0000${target.id}\u0000${target.locale ?? ""}`;
}

/** The document as read, and what its collection keeps. */
interface SessionRead {
  readonly document: StoredDocument | undefined;
  /** Whether the language read is live. */
  readonly published: boolean;
  readonly open: DocumentSessionOpen;
  readonly hasStatus: boolean;
  readonly keepsDrafts: boolean;
  /** Read the document again, answering it as stored now. */
  readonly refresh: () => Promise<StoredDocument | undefined>;
  /** Whether `document` is live, read in the target's language. */
  readonly publishedOf: (document: StoredDocument) => boolean;
}

/** The document as the session's caller is told it, once it is read. */
function readyOpen(
  document: StoredDocument,
  published: boolean,
  draftable: boolean
): DocumentSessionOpen {
  return {
    status: "ready",
    values: document,
    published,
    unpublishedChanges: !published || document._isWorkingDraft === true,
    changedAt:
      typeof document.updatedAt === "string" ? document.updatedAt : null,
    draftable,
  };
}

/**
 * The named document's stored read: in the language named alone, with every
 * language's state where the person may read it, so a translation is judged
 * live or not by its own state rather than the default language's.
 */
function useStoredSessionDocument(
  target: DocumentSessionTarget | null,
  keepsDrafts: boolean,
  ready: boolean
): {
  read: ReturnType<typeof useStoredEntry>;
  publishedOf: (document: StoredDocument) => boolean;
} {
  const slug = target?.collection ?? "";
  const { enabled: localized, defaultLocale } = useLocalization();
  const asksLanguages = useAsksTranslationStatus(slug);
  const locale = target?.locale;
  const read = useStoredEntry({
    collectionSlug: slug,
    entryId: target?.id ?? "",
    draft: keepsDrafts,
    ...(locale === undefined ? {} : { locale }),
    ...(localized ? { fallbackLocale: "none" } : {}),
    translationStatus: localized && asksLanguages,
    enabled: target !== null && ready,
  });
  const language = localized ? defaultLocale : undefined;
  const publishedOf = useCallback(
    (stored: StoredDocument) => isPublished(stored, locale, language),
    [locale, language]
  );
  return { read, publishedOf };
}

/**
 * Read the named document as its editor would: its held working draft in
 * place of the live row where the collection keeps one, as stored (related
 * items by id, so one the person may not read is kept, not dropped), and in
 * the language named alone, so an untranslated field reads empty rather than
 * as another language's words a save or a recovery would then store.
 */
function useSessionRead(target: DocumentSessionTarget | null): SessionRead {
  // Whether the collection keeps a working draft, which decides both how the
  // document is read and what "Save as draft" may send.
  const schema = useCollectionSchema(target?.collection);
  const keepsDrafts = readsHeldDraft(schema.data);
  const hasStatus = schema.data?.status === true;
  const { read, publishedOf } = useStoredSessionDocument(
    target,
    keepsDrafts,
    schema.data !== undefined
  );
  const document = target === null ? undefined : read.data;
  const failed = read.isError || schema.isError;
  const { refetch: refetchRead } = read;
  const { refetch: refetchSchema } = schema;
  const refresh = useCallback(
    async () => (await refetchRead()).data,
    [refetchRead]
  );
  const retry = useCallback(() => {
    void refetchSchema();
    void refetchRead();
  }, [refetchSchema, refetchRead]);
  const published = document !== undefined && publishedOf(document);
  const draftable = isDraftable(published, hasStatus, keepsDrafts);
  const open = useMemo((): DocumentSessionOpen => {
    if (document !== undefined)
      return readyOpen(document, published, draftable);
    return failed ? { status: "failed", retry } : { status: "loading" };
  }, [document, published, draftable, failed, retry]);
  return useMemo(
    () => ({
      document,
      published,
      open,
      hasStatus,
      keepsDrafts,
      refresh,
      publishedOf,
    }),
    [document, published, open, hasStatus, keepsDrafts, refresh, publishedOf]
  );
}

/**
 * The version the copy started from, moved by each new read and by each of
 * the session's own writes (through the ref it hands out): the next write
 * sends it, and the lock's beats name it.
 */
function useCopyVersion(
  document: StoredDocument | undefined
): MutableRefObject<string | undefined> {
  const versionRef = useRef<string | undefined>(undefined);
  const readVersion = versionOf(document);
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
    document: StoredDocument,
    changes: Readonly<Record<string, unknown>>
  ) => void;
  /**
   * Which edit was recorded last: a save takes it as it starts, and settles
   * only that one once it has stored it.
   */
  readonly generation: () => number;
  /** Edits up to `generation` were stored: nothing more to record for them. */
  readonly stored: (generation: number) => void;
  readonly cancel: () => void;
  /** Record the edits not yet stored after all: a write that put it off failed. */
  readonly resume: () => void;
  readonly discard: () => Promise<void>;
}

/** Record `snapshot` as the point, noting it as this recorder's once stored. */
async function recordSnapshot(
  scope: VersionScope | null,
  snapshot: Record<string, unknown>,
  locale: string | null,
  storedRef: MutableRefObject<Record<string, unknown> | null>
): ReturnType<typeof versionApi.saveAutosave> {
  if (scope === null) throw new Error("session: no document to record");
  const result = await versionApi.saveAutosave(scope, snapshot, locale);
  storedRef.current = snapshot;
  return result;
}

/**
 * Whether the person's recovery point is still this recorder's to empty:
 * nothing recorded since, its own recording the last stored, and the point
 * holding what it recorded, by the server's own reading (another tab of the
 * same person writes the same point).
 */
async function stillOwnsThePoint({
  scope,
  document,
  mine,
  unsettled,
  stored,
}: {
  scope: VersionScope;
  document: string;
  mine: number;
  unsettled: () => boolean;
  stored: Record<string, unknown> | null;
}): Promise<boolean> {
  if (unsettled() || lastStoredRecording(document) !== mine) return false;
  return holdsOwnRecording(scope, stored);
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
  // What this recorder last stored, so a discard empties the point only
  // while it still holds that: another tab of the same person writes the
  // same point.
  const storedRef = useRef<Record<string, unknown> | null>(null);
  const edits = useEditGenerations();
  const { schedule, cancel, lastSent } = useSnapshotAutosave({
    identity: recordingIdentity(document, locale),
    document,
    save: () => recordSnapshot(scope, snapshotRef.current, locale, storedRef),
    enabled: held,
    stillWanted: edits.unsettled,
  });
  const record = useCallback(
    (stored: StoredDocument, changes: Readonly<Record<string, unknown>>) => {
      // The WHOLE document, since restoring a recovery point replaces every
      // value its editor holds: the read's values with the changes over them.
      snapshotRef.current = { ...withoutId(stored), ...changes };
      edits.bump();
      schedule();
    },
    [edits, schedule]
  );
  const resume = useCallback(() => {
    if (edits.unsettled()) schedule();
  }, [edits, schedule]);
  const discard = useCallback(async () => {
    edits.settle(edits.generation());
    cancel();
    const mine = lastSent();
    if (scope === null || document === null || mine === null) return;
    await emptyThePoint(scope, locale, () =>
      stillOwnsThePoint({
        scope,
        document,
        mine,
        unsettled: edits.unsettled,
        stored: storedRef.current,
      })
    );
  }, [edits, cancel, scope, document, lastSent, locale]);
  const { generation, settle: stored } = edits;
  return useMemo(
    () => ({ document, record, generation, stored, cancel, resume, discard }),
    [document, record, generation, stored, cancel, resume, discard]
  );
}

/** What a recording of `document` in `locale` is keyed by, as the form's is. */
function recordingIdentity(
  document: string | null,
  locale: string | null
): string | null {
  return document === null ? null : `${document}:${locale ?? ""}`;
}

/**
 * The edits recorded, counted, and how many of them a save has stored: a
 * save settles only the edits it took, so an edit made while it was on its
 * way is still recorded.
 */
function useEditGenerations(): {
  readonly bump: () => void;
  readonly generation: () => number;
  readonly settle: (upTo: number) => void;
  readonly unsettled: () => boolean;
} {
  const generationRef = useRef(0);
  const settledRef = useRef(0);
  return useMemo(
    () => ({
      bump: () => {
        generationRef.current += 1;
      },
      generation: () => generationRef.current,
      settle: (upTo: number) => {
        settledRef.current = Math.max(settledRef.current, upTo);
      },
      unsettled: () => generationRef.current > settledRef.current,
    }),
    []
  );
}

/**
 * Whether a write of `intent` may be sent, judged before anything is asked
 * of the server: the document read, or why it may not.
 */
function mayWrite(
  read: SessionRead,
  document: StoredDocument | undefined,
  held: boolean,
  intent: "draft" | "publish"
):
  | { readonly published: boolean }
  | { readonly refused: DocumentSessionRefusal } {
  if (document === undefined) return { refused: "unread" };
  if (!held) return { refused: "locked" };
  const published = read.publishedOf(document);
  if (
    intent === "draft" &&
    !isDraftable(published, read.hasStatus, read.keepsDrafts)
  ) {
    return { refused: "no-drafts" };
  }
  return { published };
}

/** A refusal decided before anything was sent. */
function refused(reason: DocumentSessionRefusal): DocumentSessionOutcome {
  return { ok: false, reason, message: null };
}

/**
 * The session's two writes, through the admin's own update as the signed-in
 * person, each sending the version the copy started from.
 */
function useSessionWrite(
  target: DocumentSessionTarget | null,
  read: SessionRead,
  held: boolean,
  recording: SessionRecording,
  versionRef: MutableRefObject<string | undefined>
): Pick<DocumentSession, "saveDraft" | "publish"> {
  const slug = target?.collection ?? "";
  const { enabled: localized } = useLocalization();
  const { mutateAsync } = useUpdateEntry({
    collectionSlug: slug,
    entryId: target?.id ?? "",
    ...(target?.locale === undefined ? {} : { locale: target.locale }),
    ...(localized ? { fallbackLocale: "none" } : {}),
    // The caller says what happened, in its own words, where it is working.
    showToast: false,
    // The read stays what was stored until the server says otherwise.
    optimistic: false,
  });
  // The document named now: a write that waited while the caller named
  // another is not sent, and an answer that lands after it changes nothing
  // of the session it left.
  const currentKey = useRef(targetKey(target));
  currentKey.current = targetKey(target);
  // Whether a write has landed that the read has not caught up with: the
  // next write reads the document again first, so it judges the status the
  // last one left (a publish makes a draft's next save a working draft).
  const readBehind = useRef<StoredDocument | undefined | null>(null);
  if (readBehind.current !== null && readBehind.current !== read.document) {
    readBehind.current = null;
  }

  const write = useCallback(
    async (
      changes: Readonly<Record<string, unknown>>,
      intent: "draft" | "publish"
    ): Promise<DocumentSessionOutcome> => {
      const key = currentKey.current;
      const moved = () => currentKey.current !== key;
      const document =
        readBehind.current === null ? read.document : await read.refresh();
      if (moved()) return refused("moved");
      const verdict = mayWrite(read, document, held, intent);
      if ("refused" in verdict) return refused(verdict.refused);
      const taken = recording.generation();
      // A recording landing after the write would put the work back as a
      // recovery point, so the ones on their way land first.
      recording.cancel();
      await recordingsSettled(recording.document);
      // Taken before anything else is awaited, and only while the session
      // still names the document it judged: the update is bound to the
      // document named now.
      const version = versionRef.current;
      if (moved()) return refused("moved");
      const payload: UpdateEntryPayload = {
        ...changedFields(changes),
        ...statusFor(intent, verdict.published, read.hasStatus),
        ...(version === undefined ? {} : { [DOCUMENT_VERSION_KEY]: version }),
      };
      try {
        const result = await mutateAsync(payload);
        if (!moved()) {
          versionRef.current = versionOf(result.item) ?? versionRef.current;
          recording.stored(taken);
          readBehind.current = read.document;
        }
        return { ok: true, values: result.item };
      } catch (error) {
        // The edits are still unsaved, so the recording the write put off is
        // made after all.
        if (!moved()) recording.resume();
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
  return { saveDraft, publish };
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
  const versionRef = useCopyVersion(read.document);
  const lock = useSessionLock(target, versionRef);
  const held = lock.status === "held";
  const recording = useSessionRecording(target, held);
  const mayPublish = useCan(`publish-${target?.collection ?? ""}`);
  const { saveDraft, publish } = useSessionWrite(
    target,
    read,
    held,
    recording,
    versionRef
  );
  const { document } = read;
  const { record: recordDocument, discard } = recording;
  const record = useCallback(
    (changes: Readonly<Record<string, unknown>>) => {
      if (document !== undefined) recordDocument(document, changes);
    },
    [document, recordDocument]
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
