"use client";

import { Alert, AlertDescription, AlertTitle } from "@nextlyhq/ui";

import type { AuthRefusal } from "@admin/lib/auth/auth-refusal";

export interface AuthRefusalNoticeProps {
  /** The refusal the form's last submission met, or null to show nothing. */
  refusal: AuthRefusal | null;
}

/**
 * The refusal a signed-out form's submission met, shown in the form rather
 * than only in a toast, so it stays on screen while the person acts on it.
 *
 * An address the app doesn't accept is the common case: `next dev` opened at
 * `127.0.0.1` for an app whose address is `localhost`. The notice names both
 * addresses and links to this same page at the app's own, which is the whole
 * fix.
 */
export function AuthRefusalNotice({ refusal }: AuthRefusalNoticeProps) {
  if (refusal === null) return null;

  if (refusal.kind === "origin") {
    return (
      <Alert variant="destructive" role="alert" className="mb-6">
        <AlertTitle>This page is open at a different address</AlertTitle>
        <AlertDescription>
          <p>
            You opened it at{" "}
            <code className="font-mono">{refusal.pageOrigin}</code>, but this
            app only accepts it at{" "}
            <code className="font-mono">{refusal.appOrigin}</code>.
          </p>
          <a
            href={refusal.href}
            className="mt-2 inline-block font-medium underline underline-offset-2"
          >
            Open this page at {refusal.appOrigin}
          </a>
        </AlertDescription>
      </Alert>
    );
  }

  if (refusal.kind === "unlisted") {
    return (
      <Alert variant="destructive" role="alert" className="mb-6">
        <AlertTitle>This app doesn&apos;t recognise its own address</AlertTitle>
        <AlertDescription>
          <p>
            The server sees itself at{" "}
            <code className="font-mono">{refusal.appOrigin}</code>, so it
            refuses requests from{" "}
            <code className="font-mono">{refusal.pageOrigin}</code>. If{" "}
            <code className="font-mono">{refusal.pageOrigin}</code> is this
            app&apos;s address, add it to{" "}
            <code className="font-mono">NEXTLY_ALLOWED_ORIGINS</code> on the
            server.
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="destructive" role="alert" className="mb-6">
      <AlertDescription>{refusal.message}</AlertDescription>
    </Alert>
  );
}
