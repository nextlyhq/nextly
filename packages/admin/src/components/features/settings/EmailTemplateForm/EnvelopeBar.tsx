"use client";

/**
 * Everything that ADDRESSES the mail, in one strip.
 *
 * From, Reply-to, Subject and Preheader answer one question — who receives
 * this and what do they see before opening it — and they were split across two
 * places: Subject sat above the editor while the other three were three clicks
 * away behind a Settings tab. An author writing a subject line and an author
 * setting the preheader are the same person in the same moment, and the
 * preheader is literally the text that follows the subject in an inbox.
 *
 * Kept as a band above the panes rather than inside the inspector because all
 * four change what the preview renders, and a field whose effect is visible
 * belongs where its effect is.
 *
 * A LAYOUT row addresses nothing — it is a wrapper other templates are poured
 * into — so it gets the `{{content}}` guidance in this space instead.
 */
import { Input } from "@nextlyhq/ui";
import type { useForm } from "react-hook-form";

import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@admin/components/ui/form";

import type { TemplateFormValues } from "./schema";

/** One labelled field in the strip, laid out inline so the band stays shallow. */
function EnvelopeField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-baseline gap-2">
      <label
        htmlFor={htmlFor}
        className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        {label}
      </label>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function EnvelopeBar({
  control,
  isPending,
  isLayoutRow,
}: {
  control: ReturnType<typeof useForm<TemplateFormValues>>["control"];
  isPending: boolean;
  isLayoutRow: boolean;
}) {
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
    <div className="flex flex-col gap-2 border-b border-border px-4 py-2.5">
      <FormField
        control={control}
        name="subject"
        render={({ field }) => (
          <FormItem className="space-y-1">
            <EnvelopeField label="Subject" htmlFor="envelope-subject">
              <FormControl>
                <input
                  {...field}
                  id="envelope-subject"
                  disabled={isPending}
                  placeholder="Welcome to {{appName}}"
                  className="w-full bg-transparent text-sm font-medium text-foreground outline-none placeholder:text-muted-foreground"
                />
              </FormControl>
            </EnvelopeField>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* The inbox preview line — the text that follows the subject, which is
          why it sits under it rather than in a settings panel. */}
      <FormField
        control={control}
        name="preheader"
        render={({ field }) => (
          <FormItem className="space-y-1">
            <EnvelopeField label="Preheader" htmlFor="envelope-preheader">
              <FormControl>
                <input
                  {...field}
                  id="envelope-preheader"
                  disabled={isPending}
                  placeholder="Preview line shown after the subject"
                  className="w-full bg-transparent text-sm text-muted-foreground outline-none placeholder:text-muted-foreground"
                />
              </FormControl>
            </EnvelopeField>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 border-t border-border pt-2">
        <FormField
          control={control}
          name="fromOverride"
          render={({ field }) => (
            <FormItem className="min-w-0 flex-1 space-y-1">
              <EnvelopeField label="From" htmlFor="envelope-from">
                <FormControl>
                  <Input
                    {...field}
                    id="envelope-from"
                    disabled={isPending}
                    placeholder="Provider default"
                    className="h-7 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
                  />
                </FormControl>
              </EnvelopeField>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name="replyTo"
          render={({ field }) => (
            <FormItem className="min-w-0 flex-1 space-y-1">
              <EnvelopeField label="Reply-to" htmlFor="envelope-reply-to">
                <FormControl>
                  <Input
                    {...field}
                    id="envelope-reply-to"
                    disabled={isPending}
                    placeholder="replies@example.com"
                    className="h-7 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
                  />
                </FormControl>
              </EnvelopeField>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </div>
  );
}
