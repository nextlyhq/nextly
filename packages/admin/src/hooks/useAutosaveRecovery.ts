"use client";

/**
 * Whether to offer the author their own recovery point back when an editor
 * opens, and the values to restore if they accept.
 *
 * The other half of `useDocumentAutosave`. Recording without offering is a loop
 * that never closes: the work is stored and nobody is ever told it exists.
 *
 * @module hooks/useAutosaveRecovery
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";

import { useCurrentUserId } from "@admin/hooks/useCurrentUserId";
import { useLocalization } from "@admin/hooks/useLocalization";
import { canonicalJson } from "@admin/lib/canonical-json";
import {
  forgetTabPreference,
  recallTabPreference,
  rememberTabPreference,
} from "@admin/lib/device-memory/device-memory";
import {
  DOCUMENT_VERSION_KEY,
  versionOf,
  type StaleVersion,
} from "@admin/lib/document-version";
import {
  versionApi,
  type AutosaveDetail,
  type VersionScope,
} from "@admin/services/versionApi";

/**
 * Where "Not now" is remembered: this browser tab's session storage, keyed by
 * the document, holding the identity of the recovery point put off; this
 * page's memory alone where the site turned remembering off.
 *
 * Session storage is copied into a tab duplicated from this one or opened from
 * it, so the point stays put off there too; a tab opened on its own, or a new
 * window, starts without it.
 */
function putOffKey(documentKey: string): string {
  return `nextly:recovery-not-now:${documentKey}`;
}

/** Where "Not now" waits while the signed-in account is not yet known. */
const PENDING_PUT_OFF_KEY = "nextly:recovery-not-now:pending";

/** A put-off waiting for the account: the document and the point. */
interface PendingPutOff {
  documentKey: string;
  identity: string;
}

/** The put-offs waiting for the account; none where storage refuses. */
function pendingPutOffs(): PendingPutOff[] {
  try {
    const raw = recallTabPreference(PENDING_PUT_OFF_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is PendingPutOff =>
            typeof item === "object" &&
            item !== null &&
            typeof (item as PendingPutOff).documentKey === "string" &&
            typeof (item as PendingPutOff).identity === "string"
        )
      : [];
  } catch {
    return [];
  }
}

/**
 * Replace the waiting put-offs, through the device memory: the tab's session
 * storage, or this page's memory alone where the site turned remembering off
 * or the storage refuses them.
 */
function writePendingPutOffs(pending: readonly PendingPutOff[]): void {
  if (pending.length === 0) {
    forgetTabPreference(PENDING_PUT_OFF_KEY);
  } else {
    rememberTabPreference(PENDING_PUT_OFF_KEY, JSON.stringify(pending));
  }
}

/**
 * "Not now", kept for the signed-in author. Pressed before the account is
 * known (the recovery read can answer first), it waits in the tab's session
 * storage, every one of them and across a reload, and answers for its own
 * document until the account is known; then each is stored for that account.
 * Stored under no one, a later load knowing the account would miss it.
 */
function usePutOff(
  author: string | null,
  documentKey: string
): {
  putOff: (identity: string) => void;
  isPutOff: (identity: string) => boolean;
} {
  useEffect(() => {
    if (author === null) return;
    const pending = pendingPutOffs();
    if (pending.length === 0) return;
    for (const one of pending) {
      rememberPutOff(`${author}|${one.documentKey}`, one.identity);
    }
    writePendingPutOffs([]);
  }, [author]);
  const key = `${author ?? ""}|${documentKey}`;
  return {
    putOff: useCallback(
      (identity: string) => {
        if (author !== null) {
          rememberPutOff(key, identity);
          return;
        }
        const others = pendingPutOffs().filter(
          one => one.documentKey !== documentKey
        );
        writePendingPutOffs([...others, { documentKey, identity }]);
      },
      [author, documentKey, key]
    ),
    isPutOff: useCallback(
      (identity: string) =>
        author === null
          ? pendingPutOffs().some(
              one =>
                one.documentKey === documentKey && one.identity === identity
            )
          : wasPutOff(key, identity),
      [author, documentKey, key]
    ),
  };
}

/**
 * Whether a recovery point holds exactly what the document stores, in the
 * language it was recorded in. Strict, and offered whenever in doubt: hiding a
 * point loses work, while offering one needlessly costs a dismissal. A point
 * in another language than the form shows is never judged equal, and neither
 * is one lacking a field the server withheld (a password, a field this author
 * may not read): passing over a missing key would also pass over a property
 * an edit deleted.
 */
function holdsStored(
  point: AutosaveDetail,
  stored: unknown,
  locale: string | null,
  defaultLocale: string | null
): boolean {
  if (!recordedIn(point, locale, defaultLocale)) return false;
  return canonicalJson(pointValues(point.snapshot)) === canonicalJson(stored);
}

/**
 * A point's values: its snapshot without the version its edits began from,
 * which says where they came from rather than what they are.
 */
function pointValues(snapshot: unknown): unknown {
  if (typeof snapshot !== "object" || snapshot === null) return snapshot;
  const { [DOCUMENT_VERSION_KEY]: _startedFrom, ...values } =
    snapshot as Record<string, unknown>;
  return values;
}

/**
 * A string's 53-bit hash (cyrb53), to name a recovery point's content in a
 * short key rather than storing the whole document.
 */
function hash53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * Which recovery point this is: when it was stored, in which language, and what
 * it holds. The time alone is not enough, since SQLite stores it to the second
 * and a point rewritten within that second, with newer work or in another
 * language, keeps the same time.
 */
function pointIdentity(point: AutosaveDetail): string {
  return [
    point.updatedAt,
    point.locale ?? "",
    hash53(canonicalJson(point.snapshot)),
  ].join("|");
}

/** Whether this tab already put off the recovery point named `at`. */
function wasPutOff(documentKey: string, at: string): boolean {
  // Through the device memory, which reads storage that refuses as nothing.
  return recallTabPreference(putOffKey(documentKey)) === at;
}

/** Remember that this tab put off the recovery point named `at`. */
function rememberPutOff(documentKey: string, at: string): void {
  // Kept through the device memory: in this page's memory alone where the
  // site turned remembering off or the storage refuses it.
  rememberTabPreference(putOffKey(documentKey), at);
}

export interface UseAutosaveRecoveryOptions {
  /** The document to read a recovery point for, or `null` when there is none. */
  scope: VersionScope | null;
  /**
   * The form an accepted offer is written back into.
   *
   * Taken by the hook rather than left to each editor, because HOW a recovery
   * point is applied is part of the same rule as whether to offer it — and the
   * entry and Single editors must not be able to answer it differently.
   */
  form: UseFormReturn<Record<string, unknown>>;
  /**
   * The language the form shows, or `null` where the document has none. A
   * recovery point recorded in another language is never judged equal to it.
   */
  locale?: string | null;
  /**
   * How many saves this editor has made. A save deletes the author's recovery
   * point on the server, so after one, an offer still on screen is for work the
   * document now holds: restoring it would put older values back over what was
   * just saved. It is withdrawn rather than read again, since a read now could
   * surface a point written since the save while the form holds newer values,
   * which is why the offer is read only once.
   */
  savedCount?: number;
  /**
   * Told, when an offer is taken, the version the point's edits began from,
   * or undefined for a point saved before versions: a save of the restored
   * edits is judged by it.
   */
  onRestored?: (startedFrom: string | undefined) => void;
}

export interface AutosaveRecoveryOffer {
  /** When the server stored it, for "unsaved changes from N minutes ago". */
  savedAt: Date;
  /** The values to write back into the form if the author accepts. */
  snapshot: unknown;
  /**
   * Whether the point is from an older version of the document, which someone
   * else (or no one in particular) has written since: restoring it replaces
   * those changes, and the offer says so.
   */
  olderVersion: boolean;
  /**
   * The version the point's edits began from, which a save of them is judged
   * by once restored; undefined for a point saved before versions.
   */
  startedFrom?: string;
  /** What changed since that version, as a refused save says it. */
  changedSince?: StaleVersion;
  /** The point was saved without its starting version. */
  startingVersionUnknown: boolean;
}

export interface UseAutosaveRecoveryResult {
  /** The offer to present, or `null` when there is nothing worth offering. */
  offer: AutosaveRecoveryOffer | null;
  /**
   * Whether the question has been answered yet.
   *
   * `offer === null` alone cannot distinguish "there is nothing to offer" from
   * "the read has not come back", and the two want different treatment: the
   * first is final, the second is a moment that will pass. Callers that render
   * on the answer need this to avoid asserting the negative early, and so does
   * any test of the suppression rules, which are otherwise satisfied by a
   * result that simply has not arrived.
   */
  isResolved: boolean;
  /**
   * "Not now": stop offering this recovery point for the rest of this browser
   * tab's session, reloads included.
   *
   * It does NOT delete the stored recovery point, deliberately: a newer one,
   * from edits made after, is offered again, and so is this one in a tab or
   * window opened on its own (a tab duplicated from this one, or opened from
   * it, shares its session storage and keeps it put off), so an author never
   * discovers work gone because they closed an offer. What it ends is the same
   * offer returning on every load of the editor.
   */
  dismiss: () => void;
  /**
   * Accept the offer: write the recovered values into the form and stop
   * offering. A no-op when there is nothing on offer, so a caller may wire it
   * to a control it renders before the read has come back.
   *
   * An offer read as current is asked about again first, since the read is
   * not repeated while the editor stays open: a write since then makes it an
   * older version, and it is then shown as one rather than restored, so the
   * author decides with the warning in front of them. So the restore happens
   * later, when the answer is in: a caller with steps of its own around it
   * passes them as `apply`, which runs in place of `take` once the offer is
   * confirmed, and calls `take` itself.
   */
  restore: (apply?: () => void) => void;
  /**
   * Read the author's point again and offer it, once edits were just kept as
   * one: an editor that loads the current version over its refused edits.
   */
  recheck: () => void;
  /** Write the offered values into the form now, unasked: see `restore`. */
  take: () => void;
}

/**
 * Whether `point` was recorded in the editor's language `locale`.
 *
 * A point belongs to the language it was recorded in: restored into another
 * language's form it would put one language's text in another's fields. The
 * default language has two spellings, no language on the editor's canonical
 * address and its code under `?locale=`, so both sides are read as the
 * default first. The offer and the restore both ask this, so the two cannot
 * disagree about which language a point is in.
 */
function recordedIn(
  point: Pick<AutosaveDetail, "locale">,
  locale: string | null,
  defaultLocale: string | null
): boolean {
  return (point.locale ?? defaultLocale) === (locale ?? defaultLocale);
}

/**
 * An offer, asked about again before it is restored: still as offered, or the
 * answer the offer should now be drawn from (from an older version, or gone).
 * One already shown as older is not asked again, since the author chose it
 * with the warning in front of them. A read that fails restores nothing: the
 * offer stays as it was, to be chosen again, since restoring an answer that
 * could not be checked could put back an older version without its warning.
 */
async function askedAgain(
  offer: AutosaveRecoveryOffer,
  point: AutosaveDetail,
  scope: VersionScope | null
): Promise<
  { stillCurrent: true } | { stillCurrent: false; fresh: AutosaveDetail | null }
> {
  if (offer.olderVersion || !scope) return { stillCurrent: true };
  try {
    const fresh = await versionApi.getAutosave(scope);
    // The same point, still current: a rewrite since, from another tab, is
    // newer work, and the offer is drawn again from it.
    const same =
      fresh !== null && pointIdentity(fresh) === pointIdentity(point);
    return same && fresh.superseded === undefined
      ? { stillCurrent: true }
      : { stillCurrent: false, fresh };
  } catch {
    return { stillCurrent: false, fresh: point };
  }
}

/**
 * The restore half of an offer: ask about it again (see `askedAgain`), then
 * write it into the form, or draw the offer again from the new answer.
 */
function useRestoreOffer({
  offer,
  point,
  scope,
  form,
  queryKey,
  setDismissed,
  locale,
  defaultLocale,
  onRestored,
}: {
  offer: AutosaveRecoveryOffer | null;
  /** The stored point the offer was drawn from. */
  point: AutosaveDetail | null | undefined;
  scope: VersionScope | null;
  form: UseFormReturn<Record<string, unknown>>;
  queryKey: readonly unknown[];
  setDismissed: (dismissed: boolean) => void;
  /** The language the editor shows now. */
  locale: string | null;
  defaultLocale: string | null;
  onRestored?: (startedFrom: string | undefined) => void;
}): Pick<UseAutosaveRecoveryResult, "restore" | "take"> {
  const queryClient = useQueryClient();
  // The language the editor shows when the re-read below answers, which may
  // not be the one the restore was asked in: the author can switch language
  // during the round trip. Kept in a ref, since the answer arrives after the
  // render that asked.
  //
  // Set during render, not in an effect: an answer can settle after the
  // render that switched language has committed and before its passive
  // effects run, and a ref still holding the old language then would let the
  // old language's work through.
  const currentLocale = useRef(locale);
  currentLocale.current = locale;
  const take = useCallback(() => {
    if (!offer) return;
    /*
     * `reset` with `keepDefaultValues` so the form goes DIRTY: the recovered
     * values are not what the server holds, and treating them as the new
     * baseline would let the reader navigate away believing they were stored.
     */
    // Without the version it began from, which is not a value of the form:
    // the editor judges the next save by it instead.
    form.reset(pointValues(offer.snapshot) as Record<string, unknown>, {
      keepDefaultValues: true,
    });
    onRestored?.(offer.startedFrom);
    setDismissed(true);
  }, [offer, form, setDismissed, onRestored]);

  // Written since, or gone: the offer is drawn again from this answer.
  const redraw = useCallback(
    (fresh: AutosaveDetail | null) => queryClient.setQueryData(queryKey, fresh),
    [queryClient, queryKey]
  );
  const restore = useCallback(
    (apply?: () => void) => {
      if (!offer || !point) return;
      void askedAgain(offer, point, scope).then(answer => {
        // Switched language meanwhile: the point is another language's work
        // now, and written it would fill this language's fields with it. The
        // editor draws its own offer for the language it shows.
        if (!recordedIn(point, currentLocale.current, defaultLocale)) return;
        if (answer.stillCurrent) (apply ?? take)();
        else redraw(answer.fresh);
      });
    },
    [offer, point, scope, take, redraw, defaultLocale]
  );
  return { restore, take };
}

/**
 * The offer a stored point makes, or null when it makes none: dismissed, put
 * off in this tab, unreadable, or holding what the document already stores.
 */
function offerOf(
  data: AutosaveDetail | null | undefined,
  dismissed: boolean,
  isPutOff: (identity: string) => boolean,
  stored: Parameters<typeof holdsStored>[1],
  locale: string | null,
  defaultLocale: string | null
): AutosaveRecoveryOffer | null {
  if (dismissed || !data) return null;
  // Offered only in the language it was typed in: see `recordedIn`.
  if (!recordedIn(data, locale, defaultLocale)) return null;
  const savedAt = new Date(data.updatedAt);
  if (Number.isNaN(savedAt.getTime())) return null;
  // Put off in this tab already: see `dismiss`.
  if (isPutOff(pointIdentity(data))) return null;
  // A recovery point holding what the document already stores is no unsaved
  // work: an author who undid back to the saved document left one behind,
  // and offering it back on every load restores nothing.
  if (holdsStored(data, stored, locale, defaultLocale)) return null;
  const startedFrom = versionOf(data.snapshot);
  return {
    savedAt,
    snapshot: data.snapshot,
    // Written since the point began, by anyone, the author included, or by
    // a write the server cannot name: offered, and said to be from an older
    // version. Not withheld when the later writes were all the author's
    // own: a save of theirs deletes the point, so one still here outlived
    // a write that did not store it, such as publishing every language,
    // and it is the only copy of that work.
    olderVersion: data.superseded !== undefined,
    ...(startedFrom === undefined ? {} : { startedFrom }),
    ...(data.changedSince ? { changedSince: data.changedSince } : {}),
    startingVersionUnknown: data.startingVersionUnknown === true,
  };
}

/**
 * The key a document's recovery point is read under. Keyed by the document,
 * so switching entries asks again rather than reusing the previous document's
 * answer; memoised on those fields, so the restore, which writes the answer
 * back under it, is not rebuilt on every render.
 */
function useRecoveryQueryKey(scope: VersionScope | null): readonly unknown[] {
  const scopeId = scope?.kind === "single" ? scope.documentId : scope?.entryId;
  return useMemo(
    () => ["autosave-recovery", scope?.kind, scope?.slug, scopeId],
    [scope?.kind, scope?.slug, scopeId]
  );
}

/**
 * @param options - the document to read for, and the form an offer restores into
 * @returns the offer to present, and ways to accept it or stop presenting it
 */
export function useAutosaveRecovery({
  scope,
  form,
  locale = null,
  savedCount = 0,
  onRestored,
}: UseAutosaveRecoveryOptions): UseAutosaveRecoveryResult {
  // Recovery points are each author's own, so a "Not now" is too: another
  // account signed in to this tab is offered its own point.
  const author = useCurrentUserId();
  const queryKey = useRecoveryQueryKey(scope);
  // Which language "no language" is, so the two spellings of the default
  // language name one language.
  const { defaultLocale } = useLocalization();
  const [dismissed, setDismissed] = useState(false);
  // Withdrawn once a save lands: see `savedCount`. Both answers belong to the
  // document they were given for: an editor that moves to another document
  // offers that one's recovery point, whatever was dismissed or saved before.
  const [savesSeen, setSavesSeen] = useState(savedCount);
  const documentKey = JSON.stringify(queryKey);
  const [documentSeen, setDocumentSeen] = useState(documentKey);
  if (documentSeen !== documentKey) {
    setDocumentSeen(documentKey);
    setSavesSeen(savedCount);
    setDismissed(false);
  } else if (savesSeen !== savedCount) {
    setSavesSeen(savedCount);
    setDismissed(true);
  }

  const { data, isPending, isError } = useQuery({
    queryKey,
    queryFn: () => (scope ? versionApi.getAutosave(scope) : null),
    enabled: scope !== null,
    // Read once when the editor opens. Refetching on focus would surface an
    // offer mid-edit, and by then the form already holds newer values than the
    // recovery point does.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  const { putOff, isPutOff } = usePutOff(author, documentKey);
  const dismiss = useCallback(() => {
    setDismissed(true);
    if (data) putOff(pointIdentity(data));
  }, [data, putOff]);

  // The document as stored, which the form was loaded with.
  const stored = form.formState.defaultValues;

  // A document with no address is answered without asking: there is nothing to
  // read, and that is a final answer rather than a pending one.
  const isResolved = scope === null || isError || !isPending;

  // No comparison against the document's own timestamp, deliberately.
  //
  // A real save now DELETES this author's recovery point, so a row existing at
  // all already means there is unsaved work. Asking "is it newer than the
  // document" would be asking a question the data answers by existing.
  //
  // It would also be the wrong question to ask. The two timestamps live in
  // different tables and do not share a clock: one records UTC and the other
  // local time carrying a `Z`, so the comparison was wrong by the server's
  // offset and silently withheld every offer on a Single.
  //
  // Computed rather than returned from an early exit so the accept action below
  // can close over it: hooks run unconditionally, and a `useCallback` cannot sit
  // after a `return`.
  const offer = useMemo(
    () =>
      offerOf(data, dismissed, isPutOff, stored, locale, defaultLocale ?? null),
    [dismissed, data, stored, locale, defaultLocale, isPutOff]
  );

  const { restore, take } = useRestoreOffer({
    offer,
    point: data,
    scope,
    form,
    queryKey,
    // Taken, not put off: the form holds the work now, so nothing is offered.
    setDismissed,
    locale,
    defaultLocale: defaultLocale ?? null,
    onRestored,
  });

  // Read again, offered again: once edits were just kept as a point, the
  // offer to restore them shows at once rather than on the next open.
  const queryClient = useQueryClient();
  const recheck = useCallback(() => {
    setDismissed(false);
    void queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  return { offer, isResolved, dismiss, restore, take, recheck };
}
