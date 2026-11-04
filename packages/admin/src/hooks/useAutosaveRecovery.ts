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

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { UseFormReturn } from "react-hook-form";

import { useCurrentUserId } from "@admin/hooks/useCurrentUserId";
import { canonicalJson } from "@admin/lib/canonical-json";
import {
  versionApi,
  type AutosaveDetail,
  type VersionScope,
} from "@admin/services/versionApi";

/**
 * Where "Not now" is remembered: this browser tab's session storage, keyed by
 * the document, holding the identity of the recovery point put off.
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
    const raw = window.sessionStorage.getItem(PENDING_PUT_OFF_KEY);
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

/** Replace the waiting put-offs, ignoring storage that refuses. */
function writePendingPutOffs(pending: readonly PendingPutOff[]): void {
  try {
    if (pending.length === 0) {
      window.sessionStorage.removeItem(PENDING_PUT_OFF_KEY);
    } else {
      window.sessionStorage.setItem(
        PENDING_PUT_OFF_KEY,
        JSON.stringify(pending)
      );
    }
  } catch {
    // Storage refused: "Not now" lasts for this editor, as it did before.
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
  locale: string | null
): boolean {
  if ((point.locale ?? null) !== locale) return false;
  return canonicalJson(point.snapshot) === canonicalJson(stored);
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
  try {
    return window.sessionStorage.getItem(putOffKey(documentKey)) === at;
  } catch {
    // Storage refused (a private window, blocked site data): offer again.
    return false;
  }
}

/** Remember that this tab put off the recovery point named `at`. */
function rememberPutOff(documentKey: string, at: string): void {
  try {
    window.sessionStorage.setItem(putOffKey(documentKey), at);
  } catch {
    // Storage refused: "Not now" lasts for this editor, as it did before.
  }
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
}

export interface AutosaveRecoveryOffer {
  /** When the server stored it, for "unsaved changes from N minutes ago". */
  savedAt: Date;
  /** The values to write back into the form if the author accepts. */
  snapshot: unknown;
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
   */
  restore: () => void;
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
}: UseAutosaveRecoveryOptions): UseAutosaveRecoveryResult {
  // Recovery points are each author's own, so a "Not now" is too: another
  // account signed in to this tab is offered its own point.
  const author = useCurrentUserId();
  // Keyed by the document, so switching entries asks again rather than
  // reusing the previous document's answer.
  const queryKey = [
    "autosave-recovery",
    scope?.kind,
    scope?.slug,
    scope?.kind === "single" ? scope.documentId : scope?.entryId,
  ];
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
  const offer = useMemo<AutosaveRecoveryOffer | null>(() => {
    if (dismissed || !data) return null;
    const savedAt = new Date(data.updatedAt);
    if (Number.isNaN(savedAt.getTime())) return null;
    // Put off in this tab already: see `dismiss`.
    if (isPutOff(pointIdentity(data))) return null;
    // A recovery point holding what the document already stores is no unsaved
    // work: an author who undid back to the saved document left one behind,
    // and offering it back on every load restores nothing.
    if (holdsStored(data, stored, locale)) return null;
    return { savedAt, snapshot: data.snapshot };
  }, [dismissed, data, stored, locale, isPutOff]);

  const restore = useCallback(() => {
    if (!offer) return;
    /*
     * `reset` with `keepDefaultValues` so the form goes DIRTY: the recovered
     * values are not what the server holds, and treating them as the new
     * baseline would let the reader navigate away believing they were stored.
     */
    form.reset(offer.snapshot as Record<string, unknown>, {
      keepDefaultValues: true,
    });
    // Taken, not put off: the form holds the work now, so nothing is offered.
    setDismissed(true);
  }, [offer, form]);

  return { offer, isResolved, dismiss, restore };
}
