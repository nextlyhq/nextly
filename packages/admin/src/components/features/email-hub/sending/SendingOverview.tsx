"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Skeleton,
} from "@nextlyhq/ui";
import type { JSX } from "react";

import { AlertTriangle, Lock, Mail } from "@admin/components/icons";
import {
  useEmailProviders,
  useSendingSettings,
} from "@admin/hooks/queries/useEmailProviders";
import type {
  EmailProviderRecord,
  SendingSettings,
} from "@admin/services/emailProviderApi";

import { LOG_PROVIDER_TYPE } from "./setup-copy";

/** Who sends an email that has no provider of its own. */
export interface DefaultSender {
  /** Where it is chosen: a provider here, or the site's code. */
  source: "provider" | "code";
  type: string;
  /** The provider's name, or the code provider's label. */
  name: string;
  from: string | null;
}

/**
 * The default sender, as the server resolves it: the default provider here
 * when it is on, otherwise the provider set in the site's code, otherwise
 * none.
 */
export function defaultSenderOf(
  providers: readonly EmailProviderRecord[],
  settings: SendingSettings | undefined
): DefaultSender | null {
  const chosen = providers.find(p => p.isDefault && p.isActive);
  if (chosen) {
    return {
      source: "provider",
      type: chosen.type,
      name: chosen.name,
      from: chosen.fromName
        ? `${chosen.fromName} <${chosen.fromEmail}>`
        : chosen.fromEmail,
    };
  }
  if (settings?.codeProvider) {
    return {
      source: "code",
      type: settings.codeProvider.type,
      name: settings.codeProvider.label,
      from: settings.from,
    };
  }
  return null;
}

interface Read {
  isSuccess: boolean;
  isError: boolean;
  refetch: () => unknown;
}

/**
 * The card when no sender was found: said only once both reads are in, since
 * a site with a default would otherwise be told it has none while they load.
 * A read that failed says so, with a retry.
 */
function NoSender({ reads }: { reads: Read[] }): JSX.Element {
  if (reads.some(read => read.isError)) {
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>The default sender couldn&apos;t be read.</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            for (const read of reads) if (read.isError) void read.refetch();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }
  if (!reads.every(read => read.isSuccess)) {
    return <Skeleton className="h-10 w-full" />;
  }
  return (
    <div className="text-sm">
      <div className="font-medium">No provider sends email yet</div>
      <p className="text-muted-foreground">
        Add a provider and send a test to start sending.
      </p>
    </div>
  );
}

/**
 * How email goes out, at a glance: the default sender, the provider set in
 * the site's code, and a warning when the default delivers nothing on a site
 * that is not in development.
 */
export function SendingOverview(): JSX.Element {
  const settingsQuery = useSendingSettings();
  // Every provider, to find the default; the list below pages its own.
  const providersQuery = useEmailProviders(
    { page: 0, pageSize: 100, search: "" },
    { staleTime: 30_000 }
  );
  const settings = settingsQuery.data;
  const providers = providersQuery.data;
  const sender = defaultSenderOf(providers?.data ?? [], settings);
  const logOutsideDevelopment =
    sender?.type === LOG_PROVIDER_TYPE && settings?.development === false;

  return (
    <div className="space-y-4">
      {logOutsideDevelopment && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Email is being logged, not sent</AlertTitle>
          <AlertDescription>
            The default is the Log provider, which writes each email to the
            server log and delivers nothing. Add a provider that sends, and make
            it the default.
          </AlertDescription>
        </Alert>
      )}

      <section aria-labelledby="default-sender-heading" className="space-y-2">
        <h2 id="default-sender-heading" className="text-base font-semibold">
          Default sender
        </h2>
        <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-4">
          <span className="rounded-full bg-muted p-2">
            <Mail className="h-4 w-4" />
          </span>
          {sender ? (
            <div className="min-w-0 text-sm">
              <div className="break-all font-medium">
                {sender.from ?? "No From address set"}
              </div>
              <p className="text-muted-foreground">
                Every email goes out through {sender.name}
                {sender.source === "code"
                  ? ", set in the site's code,"
                  : ""}{" "}
                from this address, unless the email or its provider sets its
                own.
              </p>
            </div>
          ) : (
            <NoSender reads={[settingsQuery, providersQuery]} />
          )}
        </div>
      </section>

      {settings?.codeProvider && (
        <section aria-labelledby="code-provider-heading" className="space-y-2">
          <h2 id="code-provider-heading" className="text-base font-semibold">
            Set in code
          </h2>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-4 text-sm">
            <span className="font-medium">{settings.codeProvider.label}</span>
            <Badge variant="outline">
              <Lock className="h-3 w-3" />
              Set in code
            </Badge>
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              email.providerConfig
            </code>
            <p className="basis-full text-muted-foreground">
              Read-only here. Sends when no provider below is the default and
              on; change it in the site&apos;s code.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
