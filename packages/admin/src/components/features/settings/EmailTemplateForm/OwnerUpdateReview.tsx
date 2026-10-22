"use client";

/**
 * Reviewing an owner's update to an email the site customised, full-screen.
 *
 * Change by change, beside the site's lines at the same place: keep yours,
 * use theirs, or (where both edited the same lines) edit the result. The
 * choices are applied together, and only once every change has one, so a
 * review is never half applied. A side-by-side view shows both versions
 * whole, for the person who wants to read rather than choose.
 *
 * The server holds the merge: this sends the choices and the review token of
 * the comparison they were made on, and the server refuses (CONFLICT) if the
 * email or the owner's version moved since.
 */
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Textarea,
} from "@nextlyhq/ui";
import { useState } from "react";

import { Loader2 } from "@admin/components/icons";
import { toast } from "@admin/components/ui";
import {
  useApplyOwnerUpdate,
  useEmailTemplateComparison,
} from "@admin/hooks/queries/useEmailTemplates";
import { isApiError } from "@admin/lib/api/parseApiError";
import { cn } from "@admin/lib/utils";
import type {
  EmailTemplateComparison,
  EmailTemplateVersion,
  OwnerChange,
  OwnerChangeChoice,
  OwnerUpdateUndo,
} from "@admin/services/emailTemplateApi";

import { Segmented } from "./Segmented";

const FIELD_LABELS: Record<OwnerChange["field"], string> = {
  subject: "Subject",
  preheader: "Preview text",
  htmlContent: "HTML",
  plainTextContent: "Plain text",
};

const VERSION_FIELDS: OwnerChange["field"][] = [
  "subject",
  "preheader",
  "htmlContent",
  "plainTextContent",
];

type Lines = { sign: "-" | "+" | " "; text: string }[];

function CodeLines({ lines, label }: { lines: Lines; label: string }) {
  return (
    <div
      aria-label={label}
      className="overflow-x-auto rounded-md bg-muted py-1.5 font-mono text-xs leading-5"
    >
      {lines.length === 0 ? (
        <div className="px-3 text-muted-foreground">(nothing)</div>
      ) : (
        lines.map((line, index) => (
          <div
            // Lines repeat, so position is the identity.

            key={index}
            className={cn(
              "grid grid-cols-[1.5rem_minmax(0,1fr)]",
              line.sign === "-" && "bg-destructive/10",
              line.sign === "+" && "bg-success/10"
            )}
          >
            <span aria-hidden className="text-center text-muted-foreground">
              {line.sign === " " ? "" : line.sign}
            </span>
            <span className="whitespace-pre-wrap break-words pr-3">
              {line.text}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function ChangeCard({
  change,
  index,
  total,
  owner,
  choice,
  onChoose,
}: {
  change: OwnerChange;
  index: number;
  total: number;
  owner: string;
  choice: OwnerChangeChoice | undefined;
  onChoose: (choice: OwnerChangeChoice) => void;
}) {
  const options: { use: OwnerChangeChoice["use"]; label: string }[] = [
    { use: "mine", label: "Keep yours" },
    { use: "theirs", label: "Use theirs" },
    ...(change.conflict
      ? [{ use: "edited" as const, label: "Edit the result" }]
      : []),
  ];
  return (
    <section
      data-testid="review-change"
      aria-label={`Change ${index + 1} of ${total}`}
      className={cn(
        "overflow-hidden rounded-lg border bg-card",
        choice ? "border-border-strong" : "border-border"
      )}
    >
      <div className="flex flex-wrap items-start gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-sm font-medium">
            Change {index + 1} of {total} · {FIELD_LABELS[change.field]}
          </span>
          <Badge variant="outline" className="w-fit">
            {change.conflict
              ? "You edited these lines too"
              : "You didn't change these lines"}
          </Badge>
        </div>
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label="Choose"
        >
          {options.map(option => (
            <Button
              key={option.use}
              type="button"
              size="sm"
              variant={choice?.use === option.use ? "default" : "outline"}
              aria-pressed={choice?.use === option.use}
              onClick={() =>
                onChoose(
                  option.use === "edited"
                    ? { use: "edited", text: change.mine.join("\n") }
                    : { use: option.use }
                )
              }
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2">
        <div className="min-w-0 px-4 pt-2.5 pb-3.5">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {owner}&apos;s change
          </div>
          <CodeLines
            label={`${owner}'s change`}
            lines={[
              ...change.base.map(text => ({ sign: "-" as const, text })),
              ...change.theirs.map(text => ({ sign: "+" as const, text })),
            ]}
          />
        </div>
        <div className="min-w-0 border-t border-border px-4 pt-2.5 pb-3.5 md:border-t-0 md:border-l">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Your version now
          </div>
          <CodeLines
            label="Your version now"
            lines={change.mine.map(text => ({ sign: " " as const, text }))}
          />
        </div>
      </div>
      {choice?.use === "edited" ? (
        <div className="flex flex-col gap-1.5 px-4 pb-4">
          <label
            htmlFor={`edit-${change.id}`}
            className="text-xs font-medium text-muted-foreground"
          >
            The result
          </label>
          <Textarea
            id={`edit-${change.id}`}
            value={choice.text}
            spellCheck={false}
            onChange={e => onChoose({ use: "edited", text: e.target.value })}
            className="min-h-24 font-mono text-xs"
          />
        </div>
      ) : null}
    </section>
  );
}

function SideBySide({
  mine,
  theirs,
  owner,
}: {
  mine: EmailTemplateVersion;
  theirs: EmailTemplateVersion;
  owner: string;
}) {
  const fields = VERSION_FIELDS.filter(
    field => (mine[field] ?? "") !== (theirs[field] ?? "")
  );
  return (
    <div className="flex flex-col gap-4">
      {fields.map(field => (
        <section
          key={field}
          className="overflow-hidden rounded-lg border border-border bg-card"
        >
          <h3 className="border-b border-border px-4 py-2.5 text-sm font-medium">
            {FIELD_LABELS[field]}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2">
            {(
              [
                ["Your version", mine[field]],
                [`${owner}'s version`, theirs[field]],
              ] as const
            ).map(([label, text], index) => (
              <div
                key={label}
                className={cn(
                  "min-w-0 px-4 pt-2.5 pb-3.5",
                  index === 1 &&
                    "border-t border-border md:border-t-0 md:border-l"
                )}
              >
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {label}
                </div>
                <div className="max-h-[60vh] overflow-auto">
                  <CodeLines
                    label={label}
                    lines={(text ?? "")
                      .split("\n")
                      .map(line => ({ sign: " " as const, text: line }))}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** The changes, one by one or both versions whole. */
function ReviewChanges({
  comparison,
  owner,
  choices,
  onChoose,
}: {
  comparison: EmailTemplateComparison;
  owner: string;
  choices: Record<string, OwnerChangeChoice>;
  onChoose: (id: string, choice: OwnerChangeChoice) => void;
}) {
  const [view, setView] = useState<"changes" | "side">("changes");
  const { changes } = comparison;
  return (
    <>
      <Segmented<"changes" | "side">
        value={view}
        onChange={setView}
        options={[
          { value: "changes", label: `Changes one by one (${changes.length})` },
          { value: "side", label: "Side by side" },
        ]}
      />
      {view === "side" ? (
        <SideBySide
          mine={comparison.mine}
          theirs={comparison.theirs}
          owner={owner}
        />
      ) : (
        changes.map((change, index) => (
          <ChangeCard
            key={change.id}
            change={change}
            index={index}
            total={changes.length}
            owner={owner}
            choice={choices[change.id]}
            onChoose={choice => onChoose(change.id, choice)}
          />
        ))
      )}
    </>
  );
}

/** What the comparison holds: still loading, failed, nothing, or changes. */
function ReviewBody({
  comparison,
  owner,
  choices,
  onChoose,
}: {
  comparison: ReturnType<typeof useEmailTemplateComparison>;
  owner: string;
  choices: Record<string, OwnerChangeChoice>;
  onChoose: (id: string, choice: OwnerChangeChoice) => void;
}) {
  if (comparison.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Comparing the versions…
      </div>
    );
  }
  if (comparison.error) {
    return (
      <p className="text-sm text-destructive" role="alert">
        The versions couldn&apos;t be compared: {comparison.error.message}
      </p>
    );
  }
  if (!comparison.data) return null;
  if (comparison.data.changes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing to review: your version already matches {owner}&apos;s.
      </p>
    );
  }
  return (
    <ReviewChanges
      comparison={comparison.data}
      owner={owner}
      choices={choices}
      onChoose={onChoose}
    />
  );
}

function ReviewFooter({
  chosen,
  total,
  isPending,
  onCancel,
  onApply,
}: {
  chosen: number;
  total: number;
  isPending: boolean;
  onCancel: () => void;
  onApply: () => void;
}) {
  const complete = total > 0 && chosen === total;
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-3">
      {total > 0 ? (
        <span className="mr-auto text-sm text-muted-foreground">
          {chosen} of {total} chosen
        </span>
      ) : null}
      <Button
        type="button"
        variant="outline"
        disabled={isPending}
        onClick={onCancel}
      >
        Cancel
      </Button>
      <Button type="button" disabled={!complete || isPending} onClick={onApply}>
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {isPending ? "Applying…" : "Apply"}
      </Button>
    </div>
  );
}

/** Whether the server refused an apply because the email moved since. */
function isStaleReview(error: Error): boolean {
  return isApiError(error) && error.code === "CONFLICT";
}

export function OwnerUpdateReview({
  open,
  onOpenChange,
  templateId,
  name,
  owner,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string;
  name: string;
  owner: string;
  /** Called with what Undo needs once the review is applied. */
  onApplied: (undo: OwnerUpdateUndo) => void;
}) {
  const comparison = useEmailTemplateComparison(templateId, open);
  const apply = useApplyOwnerUpdate();
  const [choices, setChoices] = useState<Record<string, OwnerChangeChoice>>({});

  const changes = comparison.data?.changes ?? [];
  const chosen = changes.filter(change => choices[change.id]).length;

  const close = (next: boolean) => {
    if (!next) setChoices({});
    onOpenChange(next);
  };

  const onStale = () => {
    toast.error("This email changed since you opened the review", {
      description: "The review has been reloaded. Choose again.",
    });
    setChoices({});
    void comparison.refetch();
  };

  const submit = () => {
    if (!comparison.data || chosen !== changes.length) return;
    apply.mutate(
      { id: templateId, choices, review: comparison.data.review },
      {
        onSuccess: ({ undo }) => {
          toast.success("Update applied", {
            description: `${name} now includes the changes you chose.`,
          });
          onApplied(undo);
          close(false);
        },
        onError: error =>
          isStaleReview(error)
            ? onStale()
            : toast.error("The update couldn't be applied", {
                description: error.message,
              }),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[1180px] flex-col gap-0 p-0 sm:max-w-[1180px]">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle>Review {owner}&apos;s update</DialogTitle>
          <DialogDescription>
            {owner} changed {name} since your site customised it. Choose, for
            each change, whether to keep your lines or use theirs.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
          <ReviewBody
            comparison={comparison}
            owner={owner}
            choices={choices}
            onChoose={(id, choice) =>
              setChoices(previous => ({ ...previous, [id]: choice }))
            }
          />
        </div>
        <ReviewFooter
          chosen={chosen}
          total={changes.length}
          isPending={apply.isPending}
          onCancel={() => close(false)}
          onApply={submit}
        />
      </DialogContent>
    </Dialog>
  );
}
