"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Input,
  Label,
} from "@nextlyhq/ui";
import { type JSX, useId, useState } from "react";

import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Send,
  Terminal,
} from "@admin/components/icons";
import { useTestProvider } from "@admin/hooks/queries/useEmailProviders";
import { useDashboardUser } from "@admin/hooks/useDashboardUser";
import type { TestProviderResult } from "@admin/services/emailProviderApi";

import {
  LOG_PROVIDER_TYPE,
  acceptedTest,
  explainSetupFailure,
  loggedTest,
} from "./setup-copy";

/** The provider a test is sent through. */
export interface TestableProvider {
  id: string;
  type: string;
  fromEmail: string;
  fromName: string | null;
}

/** The subject the server gives a test email. */
const TEST_SUBJECT = "Nextly — Test Email";

/** How a result reads: the provider accepted it, Log logged it, or it failed. */
type Outcome = "accepted" | "logged" | "failed";

function outcomeOf(result: TestProviderResult, isLog: boolean): Outcome {
  if (!result.success) return "failed";
  return isLog ? "logged" : "accepted";
}

const OUTCOME_VARIANT: Record<Outcome, "success" | "info" | "destructive"> = {
  accepted: "success",
  logged: "info",
  failed: "destructive",
};

const OUTCOME_ICON: Record<Outcome, typeof CheckCircle2> = {
  accepted: CheckCircle2,
  logged: Terminal,
  failed: AlertTriangle,
};

/** What happened to a test, and what to check when it failed. */
function TestResultAlert({
  result,
  isLog,
  providerLabel,
  from,
  to,
}: {
  result: TestProviderResult;
  isLog: boolean;
  providerLabel: string;
  from: string;
  to: string;
}) {
  const outcome = outcomeOf(result, isLog);
  const explanation = {
    accepted: () => acceptedTest(providerLabel, to),
    logged: () => loggedTest(),
    failed: () =>
      explainSetupFailure(result.setup, providerLabel, { from, to }),
  }[outcome]();
  const Icon = OUTCOME_ICON[outcome];
  return (
    <Alert variant={OUTCOME_VARIANT[outcome]} role="status">
      <Icon className="h-4 w-4" />
      <AlertTitle>{explanation.title}</AlertTitle>
      <AlertDescription>{explanation.check}</AlertDescription>
    </Alert>
  );
}

/** What the test will carry, so the person knows what to look for. */
function TestPreview({ isLog, from }: { isLog: boolean; from: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm">
      <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {isLog ? "What is logged" : "What we'll send"}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">From</dt>
        <dd className="break-all">{from}</dd>
        <dt className="text-muted-foreground">Subject</dt>
        <dd>{TEST_SUBJECT}</dd>
      </dl>
    </div>
  );
}

function SendButtonLabel({
  pending,
  again,
}: {
  pending: boolean;
  again: boolean;
}) {
  if (pending) {
    return (
      <>
        <Loader2 className="h-4 w-4 animate-spin" />
        Sending...
      </>
    );
  }
  return (
    <>
      <Send className="h-4 w-4" />
      {again ? "Send again" : "Send a test"}
    </>
  );
}

/**
 * Sending a test and keeping its result with the address it went to. A
 * request that fails is a result too: the person is told it failed, not
 * left with a button that did nothing.
 */
function useTestSend(
  providerId: string,
  onResult?: (result: TestProviderResult) => void
) {
  const [sent, setSent] = useState<{
    to: string;
    result: TestProviderResult;
  } | null>(null);
  const { mutate: send, isPending } = useTestProvider();

  const record = (to: string, result: TestProviderResult) => {
    setSent({ to, result });
    onResult?.(result);
  };

  const submit = (address: string) => {
    if (!address) return;
    send(
      { id: providerId, email: address },
      {
        onSuccess: next => record(address, next),
        onError: error =>
          record(address, {
            success: false,
            error: error.message,
            setup: "other",
          }),
      }
    );
  };

  return { sent, submit, isPending };
}

/**
 * Send a real test email through a provider, and say what happened.
 *
 * The test goes to the signed-in person's own address, which the server
 * decides: whoever may add providers may test one, and a recipient they chose
 * would let them send through any saved provider to anyone. A refusal is
 * explained by what to check, and the person can send again without leaving.
 * An accepted test is reported as accepted, not delivered; a test through Log
 * as logged.
 */
export function SendTestPanel({
  provider,
  providerLabel,
  onResult,
}: {
  provider: TestableProvider;
  /** The provider type's label, such as "Resend". */
  providerLabel: string;
  /** Told each result, so a caller can offer to turn the provider on. */
  onResult?: (result: TestProviderResult) => void;
}): JSX.Element {
  const inputId = useId();
  const { user } = useDashboardUser();
  const to = user?.email ?? "";
  const { sent, submit, isPending } = useTestSend(provider.id, onResult);

  const isLog = provider.type === LOG_PROVIDER_TYPE;
  const from = provider.fromName
    ? `${provider.fromName} <${provider.fromEmail}>`
    : provider.fromEmail;

  return (
    <div className="space-y-4">
      <form
        className="grid gap-4 md:grid-cols-2"
        onSubmit={event => {
          event.preventDefault();
          submit(to.trim());
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor={inputId}>Send to</Label>
          <Input id={inputId} type="email" value={to} readOnly />
          <p className="text-xs text-muted-foreground">
            A test always goes to your own address.
          </p>
          <Button
            type="submit"
            className="mt-2"
            disabled={isPending || !to.trim()}
          >
            <SendButtonLabel pending={isPending} again={sent !== null} />
          </Button>
        </div>
        <TestPreview isLog={isLog} from={from} />
      </form>

      {sent && (
        <TestResultAlert
          result={sent.result}
          isLog={isLog}
          providerLabel={providerLabel}
          from={provider.fromEmail}
          to={sent.to}
        />
      )}
    </div>
  );
}
