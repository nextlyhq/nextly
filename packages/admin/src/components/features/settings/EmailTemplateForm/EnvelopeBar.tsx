"use client";

/**
 * Everything that ADDRESSES the mail: who it's from, who replies go to, the
 * subject, and the preview text an inbox shows after it.
 *
 * Each is a single line of Liquid in the email editor, so a variable or a
 * filter completes here as it does in the body, and a problem is named under
 * its field. The subject and preview text are the owner's on an owner's email,
 * read-only until the site overrides it; From and Reply-To are the site's on
 * any email.
 *
 * A LAYOUT row addresses nothing (it's a wrapper other emails are poured
 * into), so it gets the `{{content}}` guidance in this space instead.
 */
import { useState, type JSX } from "react";
import type { useForm } from "react-hook-form";

import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@admin/components/ui/form";

import { LazyLiquidEditor } from "./liquid/LazyLiquidEditor";
import type { CompletionData } from "./liquid/liquid-completion";
import type { LiquidProblem } from "./liquid/liquid-problems";
import type { TemplateFormValues } from "./schema";

type EnvelopeField = "subject" | "preheader" | "fromOverride" | "replyTo";

const FIELDS: {
  name: EnvelopeField;
  label: string;
  placeholder: string;
  /** The owner's part of the email, locked until the site overrides it. */
  owners: boolean;
}[] = [
  {
    name: "subject",
    label: "Subject",
    placeholder: "Welcome to {{appName}}",
    owners: true,
  },
  {
    name: "preheader",
    label: "Preview text",
    placeholder: "The line an inbox shows after the subject",
    owners: true,
  },
  {
    name: "fromOverride",
    label: "From",
    placeholder: "The provider's sender",
    owners: false,
  },
  {
    name: "replyTo",
    label: "Reply-To",
    placeholder: "replies@example.com",
    owners: false,
  },
];

/** One labelled line, with its problem (or a refused save's message) under it. */
function EnvelopeRow({
  control,
  field: spec,
  isPending,
  readOnly,
  completion,
}: {
  control: ReturnType<typeof useForm<TemplateFormValues>>["control"];
  field: (typeof FIELDS)[number];
  isPending: boolean;
  readOnly: boolean;
  completion: CompletionData;
}) {
  const [problem, setProblem] = useState<LiquidProblem | null>(null);
  return (
    <FormField
      control={control}
      name={spec.name}
      render={({ field }) => (
        <FormItem className="grid grid-cols-1 items-start gap-1 space-y-0 sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:gap-3">
          <span className="pt-2 text-sm font-medium text-foreground">
            {spec.label}
          </span>
          <div className="min-w-0 space-y-1">
            <FormControl>
              <div>
                <LazyLiquidEditor
                  singleLine
                  mode="text"
                  label={spec.label}
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  readOnly={readOnly}
                  disabled={isPending}
                  placeholder={spec.placeholder}
                  completion={completion}
                  onProblems={problems => setProblem(problems[0] ?? null)}
                />
              </div>
            </FormControl>
            {problem ? (
              <p className="text-xs text-destructive" role="alert">
                {problem.message}
              </p>
            ) : null}
            <FormMessage />
          </div>
        </FormItem>
      )}
    />
  );
}

export function EnvelopeBar({
  control,
  isPending,
  isLayoutRow,
  ownsContent,
  completion,
}: {
  control: ReturnType<typeof useForm<TemplateFormValues>>["control"];
  isPending: boolean;
  isLayoutRow: boolean;
  /**
   * Whether the site may change the subject and preview text. From and
   * Reply-To are the site's settings on any email.
   */
  ownsContent: boolean;
  /** What the fields complete: the template's variables and test data. */
  completion: CompletionData;
}): JSX.Element {
  if (isLayoutRow) {
    return (
      <div className="border-b border-border bg-muted/40 px-4 py-2.5">
        <p className="text-xs text-muted-foreground">
          This is a layout. Place{" "}
          <code className="font-mono text-foreground">{"{{content}}"}</code>{" "}
          where each email body should be injected.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 px-4 py-3">
      {FIELDS.map(field => (
        <EnvelopeRow
          key={field.name}
          control={control}
          field={field}
          isPending={isPending}
          readOnly={field.owners && !ownsContent}
          completion={completion}
        />
      ))}
    </div>
  );
}
