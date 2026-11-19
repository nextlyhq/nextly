"use client";

/**
 * The publish dialog's workflow parts: "Ready to publish?", what holds the chosen parts with each
 * one's fix or who can unblock it, and the reason a person gives to publish without review.
 *
 * @experimental Until publishing per language is complete.
 *
 * @module components/features/entries/publish-parts/ReadyToPublish
 */

import type { JSX } from "react";
import { useId } from "react";

import { AlertTriangle } from "@admin/components/icons";
import { Button, Label, Textarea, toast } from "@admin/components/ui";
import { useTakeStep } from "@admin/hooks/queries/useReviewState";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import type { ReleaseDocumentRef } from "@admin/types/releases";

import type { ReadyProblem } from "./ready-to-publish";

/** The longest reason the publish route takes, as its body schema bounds it. */
const WITHOUT_REVIEW_REASON_MAX = 2000;

/** What holds Publish, each with its fix or who can unblock it. Nothing where nothing does. */
export function ReadyToPublish({
  document,
  problems,
}: {
  document: ReleaseDocumentRef;
  problems: readonly ReadyProblem[];
}): JSX.Element | null {
  const headingId = useId();
  const step = useTakeStep(document);
  if (problems.length === 0) return null;
  return (
    <section
      aria-labelledby={headingId}
      className="space-y-2 rounded-md border border-border p-3"
    >
      <h3 id={headingId} className="text-sm font-medium text-foreground">
        Ready to publish?
      </h3>
      <ul className="space-y-2">
        {problems.map(problem => (
          <li key={problem.key} className="flex items-start gap-2 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-foreground">{problem.text}</p>
              {problem.waitingFor === undefined ? null : (
                <p className="text-muted-foreground">
                  Waiting for {problem.waitingFor}
                </p>
              )}
              {problem.fix === undefined ? null : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  disabled={step.isPending || problem.fix.part.version === null}
                  onClick={() => {
                    const fix = problem.fix;
                    if (fix === undefined || fix.part.version === null) return;
                    step.mutate(
                      {
                        step: fix.step.name,
                        parts: [fix.part.part],
                        seen: [
                          {
                            part: fix.part.part,
                            revision: fix.part.revision,
                            version: fix.part.version,
                          },
                        ],
                      },
                      {
                        onSuccess: () =>
                          toast.success(`${fix.step.label}: done.`),
                        onError: reason =>
                          toast.error(
                            apiErrorMessage(
                              reason,
                              `${fix.step.label} didn't go through.`
                            )
                          ),
                      }
                    );
                  }}
                >
                  {problem.fix.step.label}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The reason a person gives to publish past the workflow: required, and sent trimmed, as the
 * route requires it (1 to 2000 characters once trimmed).
 */
export function WithoutReviewReason({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}): JSX.Element {
  const fieldId = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={fieldId}>Reason</Label>
      <p className="text-sm text-muted-foreground">
        Publishing without review skips the approval this document waits for.
        Say why; the reason is kept with the publish.
      </p>
      <Textarea
        id={fieldId}
        value={value}
        maxLength={WITHOUT_REVIEW_REASON_MAX}
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
      />
    </div>
  );
}
