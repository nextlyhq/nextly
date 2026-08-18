"use client";

import { Alert, AlertDescription } from "@nextlyhq/ui";

import type { ProviderAvailability } from "../../../../services/emailProviderApi";

interface ProviderAvailabilityNoticeProps {
  /** The provider's own label, so the notice names what the user picked. */
  providerLabel: string;
  /**
   * Optional because a server that predates this field sends no `availability`
   * at all, and absent information must not become a warning. An install
   * talking to an older server sees the behaviour it had before rather than a
   * notice claiming a package is missing on evidence nobody supplied.
   */
  availability?: ProviderAvailability;
}

/**
 * Explain why a selected provider cannot send yet, and what to run.
 *
 * A provider whose transport library is an optional peer dependency stays
 * SELECTABLE rather than being hidden or disabled. Hiding it makes a supported
 * provider look unsupported, and disabling it states a problem while
 * withholding the remedy; selecting it and being handed the exact command is
 * the only version that leaves the operator able to act.
 *
 * The form deliberately does not block on this. Whoever configures the mail
 * settings is often not whoever administers the server, so the configuration
 * has to be savable before the package arrives.
 */
export function ProviderAvailabilityNotice({
  providerLabel,
  availability,
}: ProviderAvailabilityNoticeProps) {
  if (availability?.status !== "needs-dependency") return null;

  return (
    <Alert variant="warning" className="mb-6">
      <AlertDescription>
        <p>
          {providerLabel} needs the{" "}
          <code className="font-mono">{availability.packageName}</code> package,
          which is not installed on this server. You can save this configuration
          now, but sending will fail until it is installed.
        </p>
        {/*
          Selectable text rather than a copy button: this is read into a
          terminal, and a clipboard call silently fails over plain HTTP, which
          is worse than showing the command plainly. One text node, so a
          selection copies the whole command rather than part of it.
        */}
        <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-2">
          <code className="font-mono text-xs">
            {availability.installCommand}
          </code>
        </pre>
        {availability.docsUrl ? (
          <a
            className="mt-2 inline-block underline underline-offset-2"
            href={availability.docsUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            {providerLabel} setup documentation
          </a>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
