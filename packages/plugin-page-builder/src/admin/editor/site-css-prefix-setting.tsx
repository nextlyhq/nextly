"use client";

/**
 * Settings → Site → Advanced: the CSS variable prefix the site's variables
 * are written under (`--site-` unless changed).
 *
 * A change breaks any CSS of the site's own that names the old prefix, so it
 * is a site setting under the site permission, it asks first, and the
 * question says what it leaves behind: the site's own CSS, and any shadow
 * that names a colour variable through the old prefix (counted by the
 * route's dry run). A prefix the engine refuses is refused here, as the
 * engine words it, before anything is sent.
 *
 * Where the site's code sets a prefix, the section shows it and says that a
 * prefix saved here replaces it.
 *
 * @module admin/editor/site-css-prefix-setting
 */
import { resolveTokenPrefix } from "@nextlyhq/blocks-engine";
import { writePluginRoute } from "@nextlyhq/plugin-sdk/admin";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Input,
  Label,
} from "@nextlyhq/ui";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { useId, useState, type JSX } from "react";

import {
  PAGE_BUILDER_PLUGIN_NAME,
  SITE_CSS_PREFIX_ROUTE_PATH,
  type SiteCssPrefixDryRun,
  type SiteCssPrefixRead,
  type SiteCssPrefixRequest,
  type SiteCssPrefixSaved,
} from "../../library-contract";

/** A mutation route's answer: its message and the item it carries. */
interface Envelope<T> {
  readonly message: string;
  readonly item: T;
}

/** One request to the prefix route, answered with its item. */
async function sendPrefix<T>(body: SiteCssPrefixRequest): Promise<T> {
  const answer = await writePluginRoute<Envelope<T>>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: SITE_CSS_PREFIX_ROUTE_PATH,
    body,
  });
  if (answer === undefined) {
    throw new Error("The site did not answer. Try again.");
  }
  return answer.item;
}

/** Where a change stands: asked about, being saved, done or refused. */
type Step =
  | { kind: "idle" }
  | { kind: "counting" }
  | { kind: "confirming"; uses: number; complete: boolean }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "failed"; message: string };

/** The note under the field: what a change asks of the site's own CSS. */
function ownCssNote(current: string): string {
  return `Your site's own CSS that uses ${current} names must change too.`;
}

/**
 * The confirmation's line about shadows that name a colour variable through
 * the old prefix, or nothing when none does. A count the usage index could
 * not finish is a lower bound, and says so.
 */
function shadowsNote(uses: number, complete: boolean): string | null {
  if (uses === 0) return null;
  const count = complete ? `${uses}` : `At least ${uses}`;
  const shadows =
    uses === 1
      ? "shadow uses a colour variable"
      : "shadows use a colour variable";
  return `${count} ${shadows} through the old prefix. They lose that colour until you pick it again.`;
}

/**
 * What the section says of a prefix the site's code sets: that a prefix
 * saved here replaces it, or, where the engine refuses it, why the pages are
 * written under another, in the engine's own words.
 */
function codeNote(code: string): string {
  const { refusal } = resolveTokenPrefix(code);
  return refusal === undefined
    ? `Your site's code sets ${code}. A prefix saved here replaces it.`
    : `Your site's code sets ${code}, which can't be used: ${refusal}`;
}

/** The message a refused request carries, else a plain fallback. */
function messageOf(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message !== ""
    ? reason.message
    : fallback;
}

/**
 * The Advanced section of Settings → Site. `reread` reads the Site tab
 * again; `refreshStyle` reads the site style again, so the canvas and the
 * Design panel's code names are written under the new prefix at once.
 */
export function SiteCssPrefixSetting({
  prefix,
  reread,
  refreshStyle,
}: {
  prefix: SiteCssPrefixRead;
  reread: () => void;
  refreshStyle: () => void;
}): JSX.Element {
  const id = useId();
  const noteId = `${id}-note`;
  const refusalId = `${id}-refusal`;
  // The typed prefix, or null while the field shows the current one.
  const [draft, setDraft] = useState<string | null>(null);
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const value = draft ?? prefix.current;
  const changed = value !== prefix.current;
  // The engine's own verdict, so what is refused here is exactly what the
  // compiler would refuse to write under.
  const refusal = changed ? resolveTokenPrefix(value).refusal : undefined;
  const busy =
    step.kind === "counting" ||
    step.kind === "saving" ||
    step.kind === "confirming";

  // First the dry run, so the question can say what the change leaves behind.
  const ask = (): void => {
    if (!changed || refusal !== undefined || busy) return;
    setStep({ kind: "counting" });
    sendPrefix<SiteCssPrefixDryRun>({ prefix: value, dryRun: true }).then(
      counted =>
        setStep({
          kind: "confirming",
          uses: counted.oldPrefixUses,
          complete: counted.usesComplete,
        }),
      (reason: unknown) =>
        setStep({
          kind: "failed",
          message: messageOf(reason, "The prefix could not be checked."),
        })
    );
  };

  const confirm = (): void => {
    setStep({ kind: "saving" });
    sendPrefix<SiteCssPrefixSaved>({ prefix: value }).then(
      () => {
        setDraft(null);
        setStep({ kind: "saved" });
        reread();
        refreshStyle();
      },
      (reason: unknown) =>
        setStep({
          kind: "failed",
          message: messageOf(reason, "The prefix could not be changed."),
        })
    );
  };

  const shadows =
    step.kind === "confirming" ? shadowsNote(step.uses, step.complete) : null;

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-2">
      <h3 id={`${id}-title`} className="text-sm font-semibold">
        Advanced
      </h3>
      <div className="space-y-1.5">
        <Label htmlFor={id}>CSS variable prefix</Label>
        {/* Not a form: Settings is drawn inside the page's own form. */}
        <div className="flex items-center gap-2">
          <Input
            id={id}
            className="w-56 font-mono"
            value={value}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            disabled={step.kind === "saving"}
            aria-invalid={refusal !== undefined}
            aria-describedby={
              refusal === undefined ? noteId : `${refusalId} ${noteId}`
            }
            onKeyDown={event => {
              // Enter asks, as the button does. The Site tab already keeps
              // Enter in a field from submitting the page.
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                ask();
              }
            }}
            onChange={event => {
              setDraft(event.target.value);
              if (step.kind === "saved" || step.kind === "failed") {
                setStep({ kind: "idle" });
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!changed || refusal !== undefined || busy}
            onClick={ask}
          >
            {step.kind === "counting" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : null}
            Change prefix
          </Button>
          {changed && !busy ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(null);
                setStep({ kind: "idle" });
              }}
            >
              Cancel
            </Button>
          ) : null}
        </div>
        {refusal === undefined ? null : (
          <p id={refusalId} role="alert" className="text-sm text-destructive">
            {refusal}
          </p>
        )}
        <p id={noteId} className="text-sm text-muted-foreground">
          {ownCssNote(prefix.current)}
        </p>
        {prefix.code === undefined ? null : (
          <p className="text-sm text-muted-foreground">
            {codeNote(prefix.code)}
          </p>
        )}
        <StepWords step={step} />
      </div>
      <AlertDialog
        open={step.kind === "confirming"}
        onOpenChange={open => {
          if (!open && step.kind === "confirming") setStep({ kind: "idle" });
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{`Change the prefix to ${value}?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {`The canvas and every published page switch to ${value} names at once. ${ownCssNote(prefix.current)}`}
            </AlertDialogDescription>
            {shadows === null ? null : (
              <p className="text-sm text-muted-foreground">{shadows}</p>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep {prefix.current}</AlertDialogCancel>
            <AlertDialogAction onClick={confirm}>
              Change prefix
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** Where a change stands, in the Site tab's save words. */
function StepWords({ step }: { step: Step }): JSX.Element | null {
  if (step.kind === "saving") {
    return (
      <p
        role="status"
        className="flex items-center gap-1.5 text-sm text-muted-foreground"
      >
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Saving…
      </p>
    );
  }
  if (step.kind === "saved") {
    return (
      <p
        role="status"
        className="flex items-center gap-1.5 text-sm text-muted-foreground"
      >
        <Check className="size-4 text-success" aria-hidden="true" />
        Saved
      </p>
    );
  }
  if (step.kind === "failed") {
    return (
      <p
        role="alert"
        className="flex items-center gap-1.5 text-sm text-destructive"
      >
        <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
        {step.message}
      </p>
    );
  }
  return null;
}
