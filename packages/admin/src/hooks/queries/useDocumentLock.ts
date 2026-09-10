"use client";

/**
 * Hold an advisory claim on a document while someone is editing it.
 *
 * Advisory throughout: nothing here refuses a write, and the server refuses
 * none either. What this buys is that two editors are TOLD about each other
 * rather than discovering it when one of them overwrites the other.
 *
 * ## What it does
 *
 * Claims on mount, confirms on a heartbeat, releases on the way out. The
 * heartbeat interval and the loss deadline both come from `nextly` rather than
 * numbers chosen here, because they are derived from the server's lease and a
 * second copy drifts the moment either is tuned.
 *
 * ## One claim, owned by one effect
 *
 * Every mutable thing about a claim — the token, when it was last confirmed,
 * what is in flight, and whether the editor is still mounted — lives in the
 * effect that created it, not in a ref shared across runs. React Strict Mode's
 * double mount, a document switch and an unmount are then the same case rather
 * than three: each closes over a `cancelled` that is already true.
 *
 * ## Every reply is fenced on what produced it
 *
 * 🔴 A renewal is fenced on its TOKEN, not on the effect run. A takeover
 * replaces the token WITHIN a run, so two heartbeats can overlap across it: a
 * `lost` answer belonging to the displaced token would otherwise clear the claim
 * the takeover just won.
 *
 * 🔴 A claim is fenced on its SEQUENCE. Two acquisitions can be outstanding at
 * once, and the server treats a live claim from the same owner as takeable, so
 * the later one to commit wins and the other's token is already dead.
 *
 * ## Nothing is aborted
 *
 * 🔴 A claim is not idempotent, so aborting one makes its outcome UNKNOWABLE:
 * the request may still commit, and an aborted fetch can never hand back the
 * token it was given. The editor would then hold a token the server has
 * replaced with one it can never learn.
 *
 * So a slow claim is not cancelled — only its hold on the slot expires. The
 * reply still arrives, and if the slot has moved on the token it carries is
 * released as the duplicate it is. That converges without the server needing to
 * know anything about client retries.
 *
 * ## Intent survives the wait
 *
 * 🔴 A person pressing "take over" is a decision, and a poll is not. Whatever is
 * waiting on the slot is remembered as an intent rather than a boolean, a
 * take-over outranks a queued claim, and a take-over whose request outlives the
 * slot is re-asked as a take-over. Losing it turns the decision into a poll that
 * politely declines to displace anyone.
 *
 * ## A request to edit rides the beat that was already going
 *
 * 🔴 An editor that is locked out polls for the document on every beat -- that
 * poll is how it learns the holder has left -- so a person asking for the
 * document is carried as a flag on the claim that was going to be sent anyway,
 * not on a call of its own. That is also what makes the ask a STANDING one:
 * every beat re-states it, the server holds it on a lease, and closing the tab
 * stops refreshing it. A colleague is therefore never told that somebody is
 * waiting when nobody is still there.
 *
 * 🔴 The intent is remembered in the effect, like the claim, and cleared by
 * WINNING the document rather than by the request that carried it. A person
 * presses once; the beat says it again until they have it or they leave.
 *
 * ## The beat outlives the claim
 *
 * 🔴 The interval is cleared by cleanup and by nothing else. An editor who takes
 * the document back needs it still running: stopping it on a loss and trusting
 * the next acquire to start another hands them a claim nothing renews, which
 * expires silently one lease later. Losing the claim sets a flag the beat reads,
 * and taking over clears it.
 *
 * ## A failed confirmation is a blip until the deadline, then it is a loss
 *
 * The lease outlives several beats, so one dropped packet resolves itself on the
 * next one, and treating it as a takeover would move an editor to read-only over
 * nothing. 🔴 But silence is not proof of possession either: past
 * `DOCUMENT_LOCK_LOSS_AFTER_MS` without a CONFIRMED reply the lease has expired
 * server-side and a colleague may already hold the row.
 *
 * 🔴 That deadline is judged at the top of every beat rather than where a request
 * rejects. A stalled connection never rejects at all, so a check that lived only
 * in the failure path would let an editor keep writing against a lease that ran
 * out minutes ago. The deadline leaves two intervals of lease in hand, so it
 * lands while the editor is still protected.
 *
 * @module hooks/queries/useDocumentLock
 */

import {
  DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS,
  DOCUMENT_LOCK_LOSS_AFTER_MS,
  type AcquireDocumentLockOutcome,
  type DocumentLockHolder,
  type DocumentScopeKind,
  type RenewDocumentLockOutcome,
} from "nextly/document-lock";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { protectedApi } from "@admin/lib/api/protectedApi";
import type { MutationResponse } from "@admin/lib/api/response-types";

/** Where a claim stands from this editor's point of view. */
export type DocumentLockState =
  /** Not asked for: a new document has no id to claim. */
  | { status: "idle" }
  /** Asked for, no answer yet. */
  | { status: "acquiring" }
  /**
   * This editor holds it.
   *
   * `someoneWaiting` is the courtesy notice, and the server's answer rather
   * than this editor's guess: a colleague has asked for the document and has
   * not stopped asking. It withholds nothing and demands nothing -- the lease
   * expiring stays the only thing that transfers a document.
   */
  | { status: "held-by-me"; someoneWaiting: boolean }
  /**
   * Someone else holds it, and can be named.
   *
   * `requestSent` is true once THIS editor has asked for the document and the
   * server has confirmed the ask is on record. Both halves are required: the
   * click alone would let the interface promise a colleague was told by a
   * request that never landed, and the server's answer alone names any waiting
   * editor rather than this one.
   */
  | {
      status: "held-by-other";
      holder: DocumentLockHolder;
      requestSent: boolean;
    }
  /**
   * This editor held it and the server said someone took over. The holder is
   * absent when the claim simply lapsed and nobody took it, which is what
   * decides whether the interface offers to resume or to ask.
   */
  | { status: "taken-over"; holder?: DocumentLockHolder }
  /**
   * This editor held it and could not confirm that for a whole lease.
   *
   * Distinct from `taken-over`, which the server reported. Nobody has said this
   * claim is gone; the point is that nobody can say it is still there, and the
   * lease it rested on has run out.
   */
  | { status: "lost" }
  /** The claim could not be asked for at all. Retried on the next beat. */
  | { status: "unavailable" };

export interface UseDocumentLockOptions {
  scopeKind: DocumentScopeKind;
  slug: string;
  /** Absent while a document is being created, which is nothing to claim. */
  entryId?: string | null;
  /** Off for a read-only surface: a past version is not being edited. */
  enabled?: boolean;
}

/** What is waiting for the acquisition slot. A decision outranks a poll. */
type ClaimIntent = "takeover" | "claim";

/** Whether two holder readings say the same thing, so a poll can stay quiet. */
function sameHolder(a: DocumentLockHolder, b: DocumentLockHolder): boolean {
  return (
    a.ownerId === b.ownerId &&
    a.ownerLabel === b.ownerLabel &&
    a.expiresInSeconds === b.expiresInSeconds
  );
}

/** Names one document, so a repair meant for it cannot land on another. */
function documentKey(
  scopeKind: DocumentScopeKind,
  slug: string,
  entryId: string
): string {
  return `${scopeKind}:${slug}:${entryId}`;
}

export function useDocumentLock({
  scopeKind,
  slug,
  entryId,
  enabled = true,
}: UseDocumentLockOptions) {
  const [state, setState] = useState<DocumentLockState>({ status: "idle" });

  // Published by the running effect, which is the only thing that may touch a
  // claim. A stable callback delegating through it keeps the consumer's
  // reference identity while the claim state stays inside one closure.
  const takeOverRef = useRef<() => void>(() => {});
  const takeOver = useCallback(() => takeOverRef.current(), []);

  // Published the same way and for the same reason: the intent belongs to the
  // effect that owns the claim, and the consumer gets a stable reference.
  const requestAccessRef = useRef<() => void>(() => {});
  const requestAccess = useCallback(() => requestAccessRef.current(), []);

  // 🔴 The cross-RUN half of the fencing, which the token fence cannot cover. A
  // run whose cleanup has already happened can still have a request in flight,
  // and the server treats a claim from the same owner as takeable, so that late
  // reply displaces the run that replaced it. This is how the run that got
  // displaced hears about it. It carries the document the repair is FOR: a run
  // editing another document was never displaced, since the two claims use
  // different lock keys, and waking it would start a claim nobody asked for.
  const reacquireRef = useRef<(forDocument: string) => void>(() => {});

  const active = enabled && Boolean(entryId);
  // Memoised on the three primitives that identify the document. Rebuilt every
  // render it would be a new object each time, so the effect below would claim,
  // release and claim again on every render rather than once per document.
  const ref = useMemo(
    () => ({ scopeKind, slug, entryId: entryId ?? "" }),
    [scopeKind, slug, entryId]
  );

  useEffect(() => {
    if (!active) {
      setState({ status: "idle" });
      return;
    }

    const key = documentKey(ref.scopeKind, ref.slug, ref.entryId);

    let cancelled = false;
    let token: string | null = null;
    let confirmedAt = Date.now();
    let holder: DocumentLockHolder | null = null;
    // The acquisition holding the slot, and what waits behind it.
    let claimSeq = 0;
    let inFlight: number | null = null;
    let pending: ClaimIntent | null = null;
    // 🔴 A separate fact from `pending`, though both mean "ask again". A queued
    // claim or take-over is SATISFIED by winning the document; a repair is not,
    // because the very thing it reports is that the token just installed may
    // already be dead. Collapsing them lets a win swallow the repair.
    let repairNeeded = false;
    // 🔴 A STANDING ask, not a one-shot request. `requesting` is what the person
    // decided and every beat re-states it; `requestSent` is what the server has
    // confirmed is on record, and only the pair may be shown as "they know".
    let requesting = false;
    let requestSent = false;
    // What the holder was last told about a colleague waiting. Kept so an
    // unchanged answer on every beat does not re-render the editor, and does not
    // re-announce a sentence the reader has already heard.
    let awaited = false;
    // 🔴 The dispatch time of the renewal that last spoke for `awaited`.
    //
    // Renewals overlap and their replies can arrive out of order, which is why
    // the lease below is advanced with `Math.max` rather than assigned. What
    // they say about somebody waiting needs the same fence for the same reason:
    // an older reply landing after a newer one answers a question that has
    // already moved on, and the holder is left with the PREVIOUS beat's answer
    // until another renewal happens to correct it. Only the newest may speak.
    let awaitedAt = 0;
    // Set when this editor stops being a contender: displaced by the server, or
    // past its own deadline. The beat then waits for the person rather than
    // re-taking a claim they were just told they had lost.
    let surrendered = false;

    // 🔴 Reset before asking. The document may have changed under a mounted
    // editor, and leaving the previous one's answer on screen would name an
    // unrelated holder — or say this editor holds a document it has not claimed.
    setState({ status: "acquiring" });

    // Best effort. The claim lapses on its own, so a release that never arrives
    // costs the next editor a wait rather than access.
    const release = (claimToken: string) =>
      void protectedApi
        .delete("/document-lock", { ...ref, claimToken })
        .catch(() => undefined);

    /** Remember what still has to be asked. A decision outranks a poll. */
    const remember = (intent: ClaimIntent) => {
      if (intent === "takeover" || pending === null) pending = intent;
    };

    /** Ask for whatever was waiting, once the slot is free. */
    const drain = () => {
      if (cancelled || inFlight !== null) return;
      if (repairNeeded) {
        repairNeeded = false;
        surrendered = false;
        void acquire(false);
        return;
      }
      if (pending === null) return;
      const intent = pending;
      pending = null;
      void acquire(intent === "takeover");
    };

    /** Store a claim this editor now holds. */
    const installAcquired = (claimToken: string, sentAt: number) => {
      token = claimToken;
      // A new claim is a new lease, timed from when it was asked for.
      confirmedAt = sentAt;
      holder = null;
      surrendered = false;
      // 🔴 Whatever a person or a poll was waiting for has been got -- but only
      // if this claim actually established possession. A take-over queued behind
      // a poll that then WON must not be carried into a later claim and spent
      // displacing a colleague nobody asked to displace; a take-over queued while
      // a repair is outstanding must NOT be dropped, because the repair says this
      // very token may already be dead and the following plain claim would come
      // back `held`, losing the click for good.
      if (!repairNeeded) pending = null;
      // Winning the document ends the ask: nobody waits for what they hold. The
      // server clears its own mark on the same event, so neither side is left
      // telling somebody that this editor is queueing for its own claim.
      requesting = false;
      requestSent = false;
      awaited = false;
      // A new claim is a new conversation: renewals of the claim just replaced
      // carry a different token and are already refused, so this only has to
      // stop an EARLIER dispatch time from outranking this claim's own beats.
      awaitedAt = 0;
      setState({ status: "held-by-me", someoneWaiting: false });
    };

    /** Store a refusal, quietly when neither the holder nor the ask has moved. */
    const installHeld = (current: DocumentLockHolder, sent: boolean) => {
      token = null;
      // 🔴 The ask is part of what this state SAYS, so it is part of what decides
      // whether to re-render. Comparing holders alone would leave the button on
      // screen after the request that replaced it landed -- the holder does not
      // change when somebody asks for their document.
      const news = holder === null || !sameHolder(holder, current);
      if (!news && sent === requestSent) return;
      holder = current;
      requestSent = sent;
      setState({ status: "held-by-other", holder: current, requestSent: sent });
    };

    /** Report that the server could not be asked, and forget what it last said. */
    const installUnavailable = () => {
      if (cancelled) return;
      // 🔴 Forget the holder as well as the state. Kept, an identical reading on
      // the next successful poll is suppressed as "nothing changed" and the
      // editor stays on `unavailable` while the server is answering perfectly
      // well — which is plausible whenever the holder renews on this cadence.
      holder = null;
      // The ask itself is NOT forgotten -- `requesting` is the person's decision
      // and outlives a failed beat -- but its confirmation is, because what the
      // server has on record is exactly what this beat failed to learn.
      requestSent = false;
      setState({ status: "unavailable" });
    };

    /**
     * Give up the SLOT without giving up the request.
     *
     * 🔴 Not an abort. A claim is not idempotent, so cancelling one makes its
     * outcome unknowable: it may still commit, and an aborted fetch can never
     * hand back the token it was given. Letting the slot go frees the beat while
     * the answer is still coming.
     */
    const expireSlot = (seq: number, intent: ClaimIntent) => {
      if (inFlight !== seq) return;
      inFlight = null;
      installUnavailable();
      // The intent outlives its request: a person's take-over must not quietly
      // become a poll that declines to displace anyone.
      remember(intent);
      drain();
    };

    /** Report a claim that could not be sent, keeping a decision for the beat. */
    const failClaim = (seq: number, intent: ClaimIntent) => {
      // 🔴 A rejection from a claim that no longer owns the slot says nothing
      // about the document. A retry can succeed and then the original finally
      // rejects: reporting that would replace a good claim with `unavailable`
      // and leave it there, since renewals only move `confirmedAt`. It would also
      // requeue a take-over the retry has already satisfied, which later displaces
      // a colleague with no second click.
      if (inFlight !== seq) return;
      inFlight = null;
      installUnavailable();
      // Kept for the beat rather than retried here, which would spin against a
      // server that is down. A take-over is kept because it was a decision.
      if (intent === "takeover") remember("takeover");
    };

    /**
     * Hand back a claim that arrived too late to be this editor's.
     *
     * 🔴 And say so. The server treats a claim from the same owner as takeable,
     * so this reply displaced whatever holds the document now; releasing it
     * quietly leaves that holder on a token the server has already forgotten.
     */
    const discardDuplicate = (item: AcquireDocumentLockOutcome) => {
      if (item.status !== "acquired") return;
      release(item.claimToken);
      reacquireRef.current(key);
    };

    /**
     * Decide what one acquisition's answer means for this editor.
     *
     * Separate from sending it because the two halves answer different
     * questions. `acquire` owns the SLOT — who has a request outstanding, and
     * what is queued behind it — while this owns the CLAIM the answer carries.
     * The slot question has to be settled first and independently: a reply the
     * slot has moved on from is a duplicate whatever it says, including when it
     * says this editor won the document.
     *
     * `asked` is what THIS request carried, not what the person has since
     * pressed, which is why it is passed in rather than read here.
     */
    const settle = (
      item: AcquireDocumentLockOutcome,
      seq: number,
      sentAt: number,
      asked: boolean
    ) => {
      // The slot moved on without this request, so whatever it won is a
      // duplicate: a later acquisition has already replaced it server-side, or
      // is about to.
      const superseded = inFlight !== seq;
      if (!superseded) inFlight = null;

      if (cancelled || superseded) {
        discardDuplicate(item);
        if (superseded) drain();
        return;
      }

      if (item.status === "acquired") installAcquired(item.claimToken, sentAt);
      // 🔴 Both halves. `item.waiting` says somebody is waiting, which is also
      // true when the person in front of this editor has asked for nothing and a
      // THIRD colleague has. Only the conjunction says "we told them, for you".
      else installHeld(item.holder, asked && item.waiting);
      drain();
    };

    async function acquire(takeover: boolean): Promise<void> {
      const intent: ClaimIntent = takeover ? "takeover" : "claim";
      if (inFlight !== null) {
        remember(intent);
        return;
      }

      const seq = (claimSeq += 1);
      inFlight = seq;
      const sentAt = Date.now();
      const slotExpiry = setTimeout(
        () => expireSlot(seq, intent),
        DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS
      );

      let item: AcquireDocumentLockOutcome;
      // Read once, here, so the answer is judged against what THIS request
      // carried. Read again at the reply, a request sent before the person
      // pressed would report their ask as landed on the strength of a beat that
      // never mentioned it.
      const asked = requesting;
      try {
        ({ item } = await protectedApi.post<
          MutationResponse<AcquireDocumentLockOutcome>
        >("/document-lock", { ...ref, takeover, requestAccess: asked }));
      } catch {
        clearTimeout(slotExpiry);
        failClaim(seq, intent);
        return;
      }
      clearTimeout(slotExpiry);
      settle(item, seq, sentAt, asked);
    }

    /** Give the claim up, and hand back whatever the server may still be holding. */
    const surrender = (next: DocumentLockState) => {
      // 🔴 Release before forgetting. A renewal whose reply never arrived may
      // still have reached the server and extended the lease by most of a TTL,
      // so dropping the token leaves colleagues seeing this editor as the holder
      // long after its own interface says it is not. Release is token-scoped, so
      // it deletes nothing when the claim really has moved on.
      if (token !== null) release(token);
      token = null;
      surrendered = true;
      setState(next);
    };

    takeOverRef.current = () => void acquire(true);
    requestAccessRef.current = () => {
      // Set first, then ask NOW rather than at the next beat, so the person sees
      // their press answered. A claim already in flight is not overtaken: the
      // flag is read where a request is BUILT, so whatever the slot admits next
      // carries it, and every beat after that re-states it.
      requesting = true;
      void acquire(false);
    };
    reacquireRef.current = (forDocument: string) => {
      if (cancelled || forDocument !== key) return;
      // Queued rather than asked directly: the live run may have a claim of its
      // own still open, and the slot admits one at a time.
      repairNeeded = true;
      drain();
    };
    void acquire(false);

    const heartbeat = setInterval(() => {
      if (cancelled) return;

      // 🔴 Judged before anything is sent, so a request that never settles
      // cannot hold the claim open past the lease it rests on.
      if (
        token !== null &&
        Date.now() - confirmedAt >= DOCUMENT_LOCK_LOSS_AFTER_MS
      ) {
        surrender({ status: "lost" });
        return;
      }

      // A decision or a repair waiting on the slot is asked before anything
      // else, so neither is overtaken by the poll below and turned into a
      // polite request that declines to displace anyone.
      if (pending !== null || repairNeeded) {
        drain();
        return;
      }

      // Displaced, or past the deadline. The person decides what happens next.
      if (surrendered) return;

      if (token === null) {
        // Nothing to confirm. Either a colleague holds it — and asking again is
        // how this editor learns they have left, since a plain acquire never
        // steals a live claim — or the last attempt failed and this is the
        // retry. `acquire` refuses to overlap with one already in flight.
        void acquire(false);
        return;
      }

      const sent = token;
      // Timed from dispatch for the same reason a claim is: the lease the server
      // grants starts when it processes this, not when the answer gets back.
      const renewSentAt = Date.now();
      void protectedApi
        .patch<MutationResponse<RenewDocumentLockOutcome>>("/document-lock", {
          ...ref,
          claimToken: sent,
        })
        .then(({ item }) => {
          if (cancelled || sent !== token) return;
          if (item.status === "renewed") {
            // 🔴 Never backwards. Replies can arrive out of order, and an older
            // renewal landing after a newer one would shorten a lease the newer
            // one already extended — firing the deadline several beats early.
            confirmedAt = Math.max(confirmedAt, renewSentAt);
            // 🔴 Coarse by construction, and that is the accessibility
            // requirement rather than a happy accident: the beat is the only
            // thing that can move this, so the notice appears and disappears at
            // the heartbeat's granularity instead of ticking at a reader.
            // Rendered only on a CHANGE, so an unchanged answer every 15 seconds
            // is not a live region repeating itself.
            if (renewSentAt > awaitedAt) {
              awaitedAt = renewSentAt;
              if (item.waiting !== awaited) {
                awaited = item.waiting;
                setState({
                  status: "held-by-me",
                  someoneWaiting: item.waiting,
                });
              }
            }
            return;
          }
          surrender({ status: "taken-over", holder: item.holder });
        })
        .catch(() => {
          // A blip. The deadline above decides when it stops being one.
        });
    }, DOCUMENT_LOCK_HEARTBEAT_INTERVAL_MS);

    return () => {
      cancelled = true;
      takeOverRef.current = () => {};
      requestAccessRef.current = () => {};
      // `reacquireRef` is left for the run that replaces this one to overwrite,
      // and refuses a document it does not own, so a late reply cannot wake an
      // editor that has gone or one looking at something else.
      clearInterval(heartbeat);
      if (token !== null) release(token);
    };
  }, [active, ref]);

  return { state, takeOver, requestAccess };
}
