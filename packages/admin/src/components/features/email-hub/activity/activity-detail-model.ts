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
 * A queued email's own failure as the kind the delivery log records, so a
 * failure with no attempt behind it is still classified: one whose outcome
 * can't be known, one worth trying again, or one refused for good.
 */
export function failureKindOf(
  failure: EmailFailure | null
): DeliveryFailureKind | null {
  if (failure === null) return null;
  if (failure.unknown) return "unknown";
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
   * Whether any provider was asked. A queued email can fail before that for
   * a reason that isn't its template's, such as a held message that can't be
   * read, and that is never worded as a provider's answer.
   */
  reachedProvider: boolean;
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
      todo: "Fix the template, then send it again: sending it unchanged fails the same way.",
    };
  }
  if (!input.reachedProvider) {
    return {
      title: `${lead}: it never reached a provider`,
      ...why,
      todo:
        outcome === "retrying"
          ? "Usually nothing: it tries again by itself, waiting longer each time."
          : "It won’t be tried again by itself. The reason above says what stopped it.",
    };
  }
  const kind = failureKind ?? "retryable";
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
    // A template the site owns is its own; only another owner's template has
    // a default the site can override.
    label:
      version.owner === "site"
        ? "The site’s own template"
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
