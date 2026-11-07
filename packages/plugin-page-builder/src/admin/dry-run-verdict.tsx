"use client";

/**
 * What the site says of a destructive template action before the author
 * confirms it: the action run as a dry run, made as the caller and rolled
 * back, and its verdict said in the dialog that offers it.
 *
 * One implementation for every dialog that deletes or removes a template, so
 * each says a refusal the same way, holds its confirm the same way while the
 * check is out, and asks again the same way when the check fails. The
 * confirmed action is still judged by the server: a dry run that passed says
 * the site would accept it at that moment, not that nothing changes before
 * the author confirms.
 *
 * @module admin/dry-run-verdict
 */
import { Alert, AlertDescription } from "@nextlyhq/ui";
import { useEffect, useState, type JSX } from "react";

import type { TemplateAction } from "../templates/template-actions-contract";

import { reasonOf, runTemplateAction } from "./entry-designs-client";

/** The dry run's verdict, as the dialog acts on it. */
export type DryRunVerdict =
  | { readonly kind: "judging" }
  | { readonly kind: "allowed" }
  | { readonly kind: "refused"; readonly refusals: readonly string[] }
  | { readonly kind: "failed"; readonly message: string };

/** What a dialog says while the check is out, and above a refusal. */
export interface DryRunWords {
  readonly judging: string;
  readonly refused: string;
}

/**
 * Run `action` as a dry run, again each time it or `attempt` changes, and
 * answer its verdict; nothing is run while `action` is null (a dialog not
 * open). `action` is compared by identity, so a caller keeps it stable while
 * it means the same thing. An answer for an earlier action or attempt,
 * arriving late, changes nothing. `failedWords` is said when the check could
 * not be made and the site gave no words of its own.
 */
export function useDryRunVerdict(
  action: TemplateAction | null,
  attempt: number,
  failedWords: string
): DryRunVerdict {
  const [verdict, setVerdict] = useState<{
    readonly action: TemplateAction;
    readonly attempt: number;
    readonly verdict: DryRunVerdict;
  } | null>(null);
  useEffect(() => {
    if (action === null) return undefined;
    let live = true;
    const settle = (next: DryRunVerdict): void => {
      if (live) setVerdict({ action, attempt, verdict: next });
    };
    runTemplateAction(action, true).then(
      result => {
        // An answer without a verdict is not a yes: the action is offered
        // only on one that says the site would accept it.
        if (result === undefined) {
          settle({ kind: "failed", message: failedWords });
        } else if (result.refusals.length > 0) {
          settle({ kind: "refused", refusals: result.refusals });
        } else {
          settle({ kind: "allowed" });
        }
      },
      (error: unknown) =>
        settle({ kind: "failed", message: reasonOf(error, failedWords) })
    );
    return () => {
      live = false;
    };
  }, [action, attempt, failedWords]);
  // Until this action's and this attempt's answer lands, it is judging.
  return verdict !== null &&
    verdict.action === action &&
    verdict.attempt === attempt
    ? verdict.verdict
    : { kind: "judging" };
}

/**
 * The verdict where it is not a plain yes: said while it is out, the site's
 * own words when it would refuse, or why it couldn't be asked.
 */
export function DryRunVerdictWords({
  verdict,
  words,
}: {
  verdict: DryRunVerdict;
  words: DryRunWords;
}): JSX.Element | null {
  switch (verdict.kind) {
    case "allowed":
      return null;
    case "judging":
      return (
        <p role="status" className="text-sm text-muted-foreground">
          {words.judging}
        </p>
      );
    case "failed":
      return (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{verdict.message}</AlertDescription>
        </Alert>
      );
    case "refused":
      return (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            <p className="font-medium">{words.refused}</p>
            {verdict.refusals.length === 1 ? (
              <p>{verdict.refusals[0]}</p>
            ) : (
              <ul className="list-disc space-y-0.5 pl-5">
                {verdict.refusals.map((each, index) => (
                  <li key={`${String(index)}-${each}`}>{each}</li>
                ))}
              </ul>
            )}
          </AlertDescription>
        </Alert>
      );
  }
}
