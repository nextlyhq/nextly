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

import { fromAddressProblem } from "./from-address";
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

/**
 * What is wrong with a field as typed: Liquid that doesn't parse, or, for
 * From, a variable in the address, which only the name before it may use.
 */
function problemOf(
  name: EnvelopeField,
  value: string,
  liquid: LiquidProblem | null
): string | null {
  if (liquid) return liquid.message;
  return name === "fromOverride" ? fromAddressProblem(value) : null;
}

/** One labelled line, with its problem (or a refused save's message) under it. */
function EnvelopeRow({
  control,
  field: spec,
  isPending,
  readOnly,
  completion,
  liquid,
}: {
  control: ReturnType<typeof useForm<TemplateFormValues>>["control"];
  field: (typeof FIELDS)[number];
  isPending: boolean;
  readOnly: boolean;
  completion: CompletionData;
  liquid: boolean;
}) {
  const [liquidProblem, setLiquidProblem] = useState<LiquidProblem | null>(
    null
  );
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
            {/* The editor takes the control's id and aria attributes onto its
                text area, where focus lands. */}
            <FormControl>
              <LazyLiquidEditor
                singleLine
                mode="text"
                label={spec.label}
                value={field.value ?? ""}
                onChange={field.onChange}
                onCreateEditor={view =>
                  field.ref({ focus: () => view.focus() })
                }
                readOnly={readOnly}
                disabled={isPending}
                placeholder={spec.placeholder}
                completion={completion}
                liquid={liquid}
                onProblems={problems => setLiquidProblem(problems[0] ?? null)}
              />
            </FormControl>
            <EnvelopeProblem
              message={problemOf(spec.name, field.value ?? "", liquidProblem)}
            />
            <FormMessage />
          </div>
        </FormItem>
      )}
    />
  );
}

function EnvelopeProblem({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="text-xs text-destructive" role="alert">
      {message}
    </p>
  );
}

export function EnvelopeBar({
  control,
  isPending,
  isLayoutRow,
  ownsContent,
  completion,
  liquid,
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
  /**
   * False for a template kept on the previous engine, whose subject and
   * preview text are sent as written. From and Reply-To stay Liquid.
   */
  liquid: boolean;
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
          // From and Reply-To render through Liquid on every engine; only
          // the owner's content is sent as written on the previous one.
          liquid={liquid || !field.owners}
        />
      ))}
    </div>
  );
}
