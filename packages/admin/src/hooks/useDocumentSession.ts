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

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

import { effectiveEntryStatus } from "@admin/components/features/entries/EntryForm/entry-address";
import type { EntryData } from "@admin/components/features/entries/EntryForm/useEntryForm";
import { LOCALE_PARAM } from "@admin/constants/search-params";
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
import { useLocaleParam } from "@admin/hooks/useLocaleParam";
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

/**
 * The fields a write sent, as the server stored them: its answer's value for
 * each where it gives one (a field hook may have changed what was sent), the
 * value sent otherwise.
 */
function storedValues(
  sent: Readonly<Record<string, unknown>>,
  answer: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(sent).map(([key, value]) => [
      key,
      key in answer ? answer[key] : value,
    ])
  );
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
    ...documentScope(target, localized),
    draft: keepsDrafts,
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
 * Which document a read or a write names, and in which language: the named
 * language alone where the site has several, so no other language's words
 * stand in for an untranslated field.
 */
function documentScope(
  target: DocumentSessionTarget | null,
  localized: boolean
): {
  collectionSlug: string;
  entryId: string;
  locale?: string;
  fallbackLocale?: string;
} {
  return {
    collectionSlug: target?.collection ?? "",
    entryId: target?.id ?? "",
    ...(target?.locale === undefined ? {} : { locale: target.locale }),
    ...(localized ? { fallbackLocale: "none" } : {}),
  };
}

/**
 * Reading the document again: `refresh` answers it as stored now, and
 * `retry` asks both reads again after one failed.
 */
function useReadAgain(
  refetchRead: () => Promise<{ data?: StoredDocument }>,
  refetchSchema: () => Promise<unknown>
): {
  refresh: () => Promise<StoredDocument | undefined>;
  retry: () => void;
} {
  const refresh = useCallback(
    async () => (await refetchRead()).data,
    [refetchRead]
  );
  const retry = useCallback(() => {
    void refetchSchema();
    void refetchRead();
  }, [refetchSchema, refetchRead]);
  return { refresh, retry };
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
  const { refresh, retry } = useReadAgain(read.refetch, schema.refetch);
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
 * The version the caller's copy started from: the first read's for each
 * document named, then moved only by the session's own writes (through the
 * ref it hands out). A read arriving later, a refusal's or the cache's own
 * refresh, is not the copy the caller edits, so a write after it still sends
 * the version the edits began from and a save made meanwhile refuses it.
 */
function useCopyVersion(
  document: StoredDocument | undefined,
  key: string | null
): MutableRefObject<string | undefined> {
  const versionRef = useRef<string | undefined>(undefined);
  const adoptedFor = useRef<string | null>(null);
  const readVersion = versionOf(document);
  if (
    key !== adoptedFor.current &&
    (key === null || readVersion !== undefined)
  ) {
    adoptedFor.current = key;
    versionRef.current = key === null ? undefined : readVersion;
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
  readonly stored: (
    generation: number,
    /** The fields that write stored, which a later recording is rebased on. */
    written: Readonly<Record<string, unknown>>,
    /** The read they were stored over, until a newer one holds them. */
    over: StoredDocument | undefined
  ) => void;
  readonly cancel: () => void;
  /**
   * A write is on its way: nothing is recorded until it lands, since the
   * write empties the person's point as it stores.
   */
  readonly pause: () => void;
  /** The write landed or failed: the edits it did not store are recorded. */
  readonly resume: () => void;
  readonly discard: () => Promise<void>;
}

/**
 * Record `edits` as the point, noting it as this recorder's once stored.
 * Stamped as it is sent with the version the session's next write would
 * send, the copy's: so edits recorded while a write was on its way carry the
 * version that write stored, and a refresh read since moves nothing.
 */
async function recordSnapshot(
  scope: VersionScope | null,
  edits: Record<string, unknown>,
  version: string | undefined,
  locale: string | null,
  storedRef: MutableRefObject<Record<string, unknown> | null>
): ReturnType<typeof versionApi.saveAutosave> {
  if (scope === null) throw new Error("session: no document to record");
  const snapshot =
    version === undefined
      ? edits
      : { ...edits, [DOCUMENT_VERSION_KEY]: version };
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
  held: boolean,
  versionRef: MutableRefObject<string | undefined>
): SessionRecording {
  const locale = target?.locale ?? null;
  const slug = target?.collection ?? "";
  const id = target?.id;
  const scope = useMemo(
    () => (id === undefined ? null : autosaveScopeFor("collection", slug, id)),
    [slug, id]
  );
  const document = documentRecordingKey(scope);
  const parts = useRecordedParts();
  // What this recorder last stored, so a discard empties the point only
  // while it still holds that: another tab of the same person writes the
  // same point.
  const storedRef = useRef<Record<string, unknown> | null>(null);
  const edits = useEditGenerations();
  const writes = useWritesOnTheirWay();
  const identity = recordingIdentity(document, locale);
  // Another document, or language, named: what was recorded and counted for
  // the one before is not this one's, so none of it can be recorded here.
  useStartAfreshOn(identity, () => {
    writes.clear();
    parts.clear();
    storedRef.current = null;
    edits.reset();
  });
  const { schedule, cancel, lastSent } = useSnapshotAutosave({
    identity,
    document,
    save: () =>
      recordSnapshot(
        scope,
        parts.joined(),
        versionRef.current,
        locale,
        storedRef
      ),
    enabled: held && writes.pending === 0,
    stillWanted: edits.unsettled,
  });
  // Once no write is on its way, the edits none of them stored are recorded.
  const idle = writes.pending === 0;
  useEffect(() => {
    if (idle && edits.unsettled()) schedule();
  }, [idle, writes.landed, edits, schedule]);
  const record = useCallback(
    (stored: StoredDocument, changes: Readonly<Record<string, unknown>>) => {
      // The WHOLE document, since restoring a recovery point replaces every
      // value its editor holds: the read's values with the changes over them.
      parts.edited(stored, changes);
      edits.bump();
      schedule();
    },
    [parts, edits, schedule]
  );
  const { pause, resume } = writes;
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
  const { generation, settle } = edits;
  const stored = useCallback(
    (
      upTo: number,
      written: Readonly<Record<string, unknown>>,
      over: StoredDocument | undefined
    ) => {
      parts.wrote(written, over);
      settle(upTo);
    },
    [parts, settle]
  );
  return useMemo(
    () => ({
      document,
      record,
      generation,
      stored,
      cancel,
      pause,
      resume,
      discard,
    }),
    [document, record, generation, stored, cancel, pause, resume, discard]
  );
}

/**
 * Run `reset` in the render that first sees a new `identity`, so nothing
 * held for the one before outlives the change by a render.
 */
function useStartAfreshOn(identity: string | null, reset: () => void): void {
  const [current, setCurrent] = useState(identity);
  if (current !== identity) {
    setCurrent(identity);
    reset();
  }
}

/**
 * Writes on their way, and how many have landed or failed: counted apart, so
 * a write that fails at once still asks for the recording it put off.
 */
function useWritesOnTheirWay(): {
  readonly pending: number;
  readonly landed: number;
  readonly pause: () => void;
  readonly resume: () => void;
  readonly clear: () => void;
} {
  const [writes, setWrites] = useState({ pending: 0, landed: 0 });
  const pause = useCallback(
    () => setWrites(now => ({ ...now, pending: now.pending + 1 })),
    []
  );
  const resume = useCallback(
    () =>
      setWrites(now => ({
        pending: Math.max(0, now.pending - 1),
        landed: now.landed + 1,
      })),
    []
  );
  const clear = useCallback(() => setWrites({ pending: 0, landed: 0 }), []);
  return { ...writes, pause, resume, clear };
}

/**
 * What a recording is made of: the document as read, the fields this
 * session's own writes stored since, and the latest edits over both. Kept
 * apart and joined as it is sent, so edits recorded while a write was on its
 * way are rebased on what that write stored rather than on the read from
 * before it, which restoring would otherwise put back.
 */
function useRecordedParts(): {
  readonly edited: (
    base: Record<string, unknown>,
    changes: Readonly<Record<string, unknown>>
  ) => void;
  readonly wrote: (
    written: Readonly<Record<string, unknown>>,
    over: StoredDocument | undefined
  ) => void;
  readonly joined: () => Record<string, unknown>;
  readonly clear: () => void;
} {
  const base = useRef<Record<string, unknown>>({});
  const written = useRef<Record<string, unknown>>({});
  const changes = useRef<Readonly<Record<string, unknown>>>({});
  // The read the written fields were stored over: a newer read already holds
  // them as the server stored them, so they are dropped then.
  const writtenOver = useRef<StoredDocument | null>(null);
  return useMemo(
    () => ({
      edited: (read, edits) => {
        if (writtenOver.current !== null && read !== writtenOver.current) {
          written.current = {};
          writtenOver.current = null;
        }
        base.current = read;
        changes.current = edits;
      },
      wrote: (fields, over) => {
        written.current = { ...written.current, ...fields };
        writtenOver.current = over ?? null;
      },
      joined: () => ({
        ...withoutId(base.current),
        ...written.current,
        ...changes.current,
      }),
      clear: () => {
        base.current = {};
        written.current = {};
        changes.current = {};
        writtenOver.current = null;
      },
    }),
    []
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
  /** Another document is named: none of its edits are this one's. */
  readonly reset: () => void;
} {
  const generationRef = useRef(0);
  const settledRef = useRef(0);
  return useMemo(
    () => ({
      reset: () => {
        generationRef.current = 0;
        settledRef.current = 0;
      },
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
  const { enabled: localized } = useLocalization();
  const { mutateAsync } = useUpdateEntry({
    ...documentScope(target, localized),
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
  // Whether the session holds the lock now: a write that waited is sent only
  // while it still does, since a colleague may have taken it meanwhile.
  const holding = useRef(held);
  holding.current = held;
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
      // Nothing is recorded while the write is on its way, since it empties
      // the person's point as it stores; the edits it does not store are
      // recorded once it has landed or failed.
      recording.pause();
      try {
        // A recording landing after the write would put the work back as a
        // recovery point, so the ones on their way land first.
        recording.cancel();
        await recordingsSettled(recording.document);
        // Taken before anything else is awaited, and only while the session
        // still names the document it judged: the update is bound to the
        // document named now.
        const version = versionRef.current;
        if (moved()) return refused("moved");
        if (!holding.current) return refused("locked");
        const written = changedFields(changes);
        const result = await mutateAsync({
          ...written,
          ...statusFor(intent, verdict.published, read.hasStatus),
          ...(version === undefined ? {} : { [DOCUMENT_VERSION_KEY]: version }),
        });
        if (!moved()) {
          versionRef.current = versionOf(result.item) ?? versionRef.current;
          recording.stored(
            taken,
            storedValues(written, result.item),
            read.document
          );
          readBehind.current = read.document;
        }
        return { ok: true, values: result.item };
      } catch (error) {
        return refusalOf(error);
      } finally {
        // A write the caller moved away from leaves the next document's
        // recording alone: its own bookkeeping was started afresh.
        if (!moved()) recording.resume();
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
 * Whether the person may publish the named document in its language. The
 * admin knows the person's grants for the language on screen alone (a rule
 * may answer by language), so a document named in another language is not
 * offered for publishing rather than offered on a guess the server refuses.
 */
function useMayPublishIn(target: DocumentSessionTarget | null): boolean {
  const may = useCan(`publish-${target?.collection ?? ""}`);
  const onScreen = useLocaleParam(LOCALE_PARAM);
  const { enabled: localized, defaultLocale } = useLocalization();
  const language = target?.locale;
  const sameLanguage =
    !localized ||
    language === undefined ||
    language === (onScreen ?? defaultLocale);
  return may && sameLanguage;
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
  const versionRef = useCopyVersion(read.document, targetKey(target));
  const lock = useSessionLock(target, versionRef);
  const held = lock.status === "held";
  const recording = useSessionRecording(target, held, versionRef);
  const mayPublish = useMayPublishIn(target);
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
