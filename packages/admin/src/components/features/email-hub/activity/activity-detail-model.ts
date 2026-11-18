/**
 * The words of Activity's detail sheet: its state first (what happened, why,
 * and what to do), which version of its template was sent, and each attempt
 * on its timeline.
 *
 * Built from the server's structured answer, never a provider's own text: the
 * kind of failure (`retryable`, `refused`, `unknown`), the provider's status
 * code, and core's plain sentence with anything address-shaped removed.
 *
 * @module components/features/email-hub/activity/activity-detail-model
 */

import type {
  DeliveryAttempt,
  DeliveryFailureKind,
  EmailFailure,
  DeliveryOutcome,
  QueuedEmailState,
  TemplateVersion,
} from "@admin/services/emailActivityApi";

import { RECIPIENT_KIND_LABELS } from "./activity-model";

/** What a detail sheet says first. */
export interface DetailState {
  title: string;
  /** Why, in plain words, when there is a failure to explain. */
  reason?: string;
  /** What the reader can do about it, or null when nothing. */
  todo: string | null;
}

/** The headline for each kind of failure. */
const FAILURE_TITLES: Record<DeliveryFailureKind, string> = {
  retryable: "the provider couldn’t take it then",
  refused: "the provider refused it",
  unknown: "it may have arrived",
};

/** What to do about a refused or unknown failure, wherever it happened. */
const FAILURE_TODO: Record<"refused" | "unknown", string> = {
  refused:
    "Check the recipient’s address and the provider’s settings. Sending again won’t help until one of them changes.",
  unknown:
    "The provider may have taken it before the answer was lost. Check the provider’s own log before sending it again.",
};

/**
 * What to do about a failure the provider might not repeat, which depends on
 * whether anything will try again: only a queued email that is still
 * retrying will. One out of attempts has failed for good, and a direct send
 * is never retried.
 */
function retryableTodo(
  source: DetailSource,
  outcome: DeliveryOutcome | QueuedEmailState
): string {
  if (source === "attempt") {
    // One attempt of a queued email: whether another follows is the queued
    // email's to say, so this never advises sending it again by hand.
    return "This was one attempt of a queued email. Open the queued email to see whether it will be tried again.";
  }
  if (source === "queued" && outcome === "retrying") {
    return "Usually nothing: it tries again by itself, waiting longer each time.";
  }
  if (source === "queued") {
    return "It won’t be tried again by itself: it ran out of attempts. Check the provider, then send it again if it still matters.";
  }
  return "A direct send isn’t retried, so send it again if it matters.";
}

/**
 * Where a sheet's failure was recorded: a direct send's delivery, one attempt
 * of a queued email (a delivery with a queued email behind it), or the queued
 * email itself.
 */
export type DetailSource = "delivery" | "attempt" | "queued";

/**
 * A queued email's own failure as the kind the delivery log records.
 *
 * The queue's row keeps only whether its failure is retryable, never that its
 * outcome is unknown, so a lost or missing answer is read from its newest
 * attempt: when that attempt failed with an unknown outcome and the row's
 * failure is retryable too, the two are the same answer. Otherwise the row
 * decides: worth trying again, or refused for good.
 */
export function failureKindOf(
  failure: EmailFailure | null,
  newest?: DeliveryAttempt
): DeliveryFailureKind | null {
  if (failure === null) return null;
  if (
    failure.unknown ||
    (failure.retryable &&
      newest?.outcome === "failed" &&
      newest.failureKind === "unknown")
  ) {
    return "unknown";
  }
  return failure.retryable ? "retryable" : "refused";
}

/** Core's sentence, with the provider's status beside it when there is one. */
function reasonOf(
  reason: string | null,
  status: number | null | undefined
): string | undefined {
  if (reason === null) return undefined;
  return status ? `${reason} (status ${status})` : reason;
}

/** The states that say what happened and need no reason or advice. */
const PLAIN_STATES: Partial<Record<string, string>> = {
  sent: "Sent",
  waiting: "Waiting for its first attempt",
  sending: "With the provider now",
};

/**
 * A sheet's state: what happened first, then why, then what to do.
 *
 * A failure the template caused (it failed to render, or set a Reply-To that
 * isn't an address) happens before any provider is asked, so it is never
 * worded as the provider's, and its way out is fixing the template.
 */
export function detailState(input: {
  source: DetailSource;
  templateCaused: boolean;
  /**
   * Whether any attempt is on record. A queued email can fail before any
   * provider is asked, and a short retention window can remove the attempts
   * of one that was asked, so with none on record its failure is worded as
   * neither the provider's nor proof that no provider was asked.
   */
  attemptOnRecord: boolean;
  outcome: DeliveryOutcome | QueuedEmailState;
  failureKind: DeliveryFailureKind | null;
  failureStatus?: number | null;
  failureReason: string | null;
}): DetailState {
  const { outcome, failureKind, failureReason } = input;
  if (outcome === "cancelled") {
    // Cancelled first, and its last failure kept on the record.
    return failureReason
      ? {
          title: "Cancelled",
          reason: `Last failure: ${failureReason}`,
          todo: null,
        }
      : { title: "Cancelled", todo: null };
  }
  const plain = PLAIN_STATES[outcome];
  if (plain) return { title: plain, todo: null };
  const reason = reasonOf(failureReason, input.failureStatus);
  const why = reason ? { reason } : {};
  const lead = outcome === "retrying" ? "Retrying" : "Failed";
  if (input.templateCaused) {
    return {
      title: `${lead}: the template couldn’t be used`,
      ...why,
      // A retrying email renders the template again on its next attempt, so
      // fixing the template is enough; sending it by hand too would send it
      // twice.
      todo:
        outcome === "retrying"
          ? "Fix the template before its next attempt, which uses the template as it is then. Don’t send it again by hand: it tries again by itself."
          : "Fix the template, then send it again: sending it unchanged fails the same way.",
    };
  }
  if (!input.attemptOnRecord) {
    return {
      title: lead,
      ...why,
      todo:
        outcome === "retrying"
          ? "Usually nothing: it tries again by itself, waiting longer each time."
          : "It won’t be tried again by itself. The reason above says what stopped it.",
    };
  }
  if (failureKind === null) {
    // Recorded before failures were sorted by kind: the reason is all there
    // is, so the sheet claims no kind and gives no advice that depends on one.
    return {
      title: lead,
      ...why,
      todo: "This was recorded before failures were sorted by kind, so read the reason above before sending it again.",
    };
  }
  const kind = failureKind;
  return {
    title: `${kind === "unknown" && lead === "Failed" ? "Unknown" : lead}: ${FAILURE_TITLES[kind]}`,
    ...why,
    todo:
      kind === "retryable"
        ? retryableTodo(input.source, outcome)
        : FAILURE_TODO[kind],
  };
}

/** Which version of its template a send used, and its digest's short form. */
export function versionText(version: TemplateVersion | null): {
  label: string;
  digest: string | null;
} {
  if (version === null) return { label: "Not sent yet", digest: null };
  if (version === "none") return { label: "No template", digest: null };
  if (version === "not-recorded") {
    return {
      label: "Not recorded (sent before versions were kept)",
      digest: null,
    };
  }
  if (version.draft)
    return { label: "A draft test, never saved", digest: null };
  return {
    // A template the site owns is its own, and one it defines in code is its
    // code version; only another owner's template has a default the site can
    // override.
    label:
      version.owner === "site"
        ? "The site’s own template"
        : version.owner === "code"
          ? "The site’s code version"
          : version.overridden
            ? "The site’s version"
            : "Owner’s default",
    digest: version.digest ? version.digest.slice(0, 8) : null,
  };
}

/** One attempt on the timeline: its outcome, then provider, recipient and answer. */
export function attemptText(attempt: DeliveryAttempt): {
  outcome: string;
  detail: string;
} {
  const parts = [
    attempt.provider.type,
    RECIPIENT_KIND_LABELS[attempt.recipientKind],
  ];
  if (attempt.outcome === "failed") {
    if (attempt.failureKind) {
      parts.push(
        attempt.failureStatus
          ? `${attempt.failureKind}, status ${attempt.failureStatus}`
          : attempt.failureKind
      );
    }
    if (attempt.failureReason) parts.push(attempt.failureReason);
  }
  return {
    outcome: attempt.outcome === "sent" ? "Sent" : "Failed",
    detail: parts.join(" · "),
  };
}
