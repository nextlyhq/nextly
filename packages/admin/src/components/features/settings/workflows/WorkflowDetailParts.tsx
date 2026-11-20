"use client";

/**
 * The pieces of one workflow's Settings page that hold no state of the page's
 * own: its titled sections, the header's description, the page's loading,
 * missing and failed states, and the notes saying what a reader may not
 * change. Kept apart from `WorkflowSettingsDetail`, which reads and saves, so
 * each part reads at a glance.
 */

import { Alert, AlertDescription, Button, Skeleton } from "@nextlyhq/ui";
import { Copy } from "lucide-react";
import type React from "react";
import { useState } from "react";

import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import type { WorkflowSummary } from "@admin/types/workflows";

import type { WorkflowSettingsAccess } from "./workflow-permissions";
import { attachmentsPhrase } from "./workflow-settings-model";
import { DefinedInCodeBadge } from "./WorkflowList";

/** A titled card of the page, named by its heading. */
export function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section
      aria-labelledby={id}
      className="space-y-4 rounded-lg border border-border bg-card p-4 text-card-foreground sm:p-6"
    >
      <div className="space-y-1">
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

/**
 * Copies the configuration file's path, and says so in its own name for a
 * moment, so a screen reader hears the copy happen.
 */
function CopyPathButton({ path }: { path: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={copied ? "Path copied" : "Copy path"}
      onClick={() => {
        void navigator.clipboard?.writeText(path).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    >
      <Copy aria-hidden="true" className="size-3.5" />
      {copied ? "Copied" : "Copy path"}
    </Button>
  );
}

/** Under the page's title: defined in code, where it is registered, and who uses it. */
export function WorkflowHeaderDescription({
  workflow,
}: {
  workflow: WorkflowSummary;
}): React.JSX.Element {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <DefinedInCodeBadge />
      {workflow.configPath !== null && (
        <span className="inline-flex flex-wrap items-center gap-1">
          Registered in{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
            {workflow.configPath}
          </code>
          <CopyPathButton path={workflow.configPath} />
        </span>
      )}
      <span>Used by {attachmentsPhrase(workflow)}</span>
    </span>
  );
}

/** Why the page has no workflow to show yet: none registered, a failed read, or still reading. */
export type WorkflowDetailUnavailable =
  | { kind: "missing"; slug: string }
  | { kind: "failed"; error: unknown; onRetry: () => void }
  | { kind: "loading" };

/** The page's body while it has no workflow to show, as {@link WorkflowDetailUnavailable} says. */
export function WorkflowDetailUnavailableBody({
  state,
}: {
  state: WorkflowDetailUnavailable;
}): React.JSX.Element {
  if (state.kind === "missing") {
    return (
      <Alert variant="warning" role="alert">
        <AlertDescription>
          No workflow named &ldquo;{state.slug}&rdquo; is registered. A workflow
          is defined in code and attached to a collection or Single.
        </AlertDescription>
      </Alert>
    );
  }
  if (state.kind === "failed") {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription className="space-y-3">
          <p>
            {apiErrorMessage(state.error, "The workflow could not be loaded.")}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={state.onRetry}
          >
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

/**
 * What a reader who may change settings still may not change of who takes
 * each step, and why: reading roles comes first, then updating them.
 */
export function RolesAccessNote({
  access,
}: {
  access: WorkflowSettingsAccess;
}): React.JSX.Element | null {
  if (!access.update) return null;
  if (!access.reviewers) {
    return (
      <p className="text-sm text-muted-foreground">
        Changing who takes a step, or choosing a default reviewer, also needs
        permission to read roles.
      </p>
    );
  }
  if (!access.grants) {
    return (
      <p className="text-sm text-muted-foreground">
        Changing who takes a step also needs permission to update roles.
      </p>
    );
  }
  return null;
}
