"use client";

import {
  Badge,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import { useId, useMemo, useState } from "react";

import { buildSampleData } from "@admin/components/features/settings/EmailTemplateForm/sample-data";
import { PreviewPane } from "@admin/components/features/settings/EmailTemplateForm/TemplatePreview";
import { Info } from "@admin/components/icons";
import { useBrandPreview } from "@admin/hooks/queries/useEmailBrand";
import { useDebouncedValue } from "@admin/hooks/useDebouncedValue";
import type { BrandSettingsChange } from "@admin/services/emailBrandApi";
import type {
  DraftPreviewTemplate,
  EmailTemplateRecord,
} from "@admin/services/emailTemplateApi";

/** How long the preview waits for typing to pause before rendering again. */
const PREVIEW_DELAY_MS = 250;

/** The fields a render reads, from a saved email. */
function draftTemplateOf(email: EmailTemplateRecord): DraftPreviewTemplate {
  return {
    subject: email.subject,
    htmlContent: email.htmlContent,
    plainTextContent: email.plainTextContent,
    preheader: email.preheader,
    useLayout: email.useLayout,
    kind: email.kind,
    layoutId: email.layoutId,
    id: email.id,
  };
}

function EmailPicker({
  emails,
  value,
  onChange,
}: {
  emails: EmailTemplateRecord[];
  value: string;
  onChange: (id: string) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="sr-only">
        Email to preview
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full sm:w-72">
          <SelectValue placeholder="Choose an email" />
        </SelectTrigger>
        <SelectContent>
          {emails.map(email => (
            <SelectItem key={email.id} value={email.id}>
              {email.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** One email rendered with the settings being edited. */
function RenderedEmail({
  email,
  change,
}: {
  email: EmailTemplateRecord;
  change: BrandSettingsChange | undefined;
}) {
  const template = useMemo(() => draftTemplateOf(email), [email]);
  const data = useMemo(
    () =>
      buildSampleData(
        (email.variables ?? []).map(variable => ({
          name: variable.name,
          description: variable.description ?? "",
          required: false,
        })),
        { isLayoutRow: email.kind === "layout" }
      ),
    [email]
  );
  const brand = useDebouncedValue(change, PREVIEW_DELAY_MS);
  const {
    data: rendered,
    isPending,
    error,
  } = useBrandPreview(template, data, brand);
  return (
    <div className="h-[640px] min-h-0">
      <PreviewPane
        html={rendered?.html ?? ""}
        text={rendered?.text ?? ""}
        subject={rendered?.subject ?? email.subject}
        format="html"
        isPending={isPending}
        error={error ? error.message : null}
      />
    </div>
  );
}

/**
 * A live preview of a chosen email with the settings being edited, before
 * they are saved.
 */
export function BrandPreview({
  emails,
  change,
  unsaved,
  layoutKept,
}: {
  /** The emails to choose from, the ones the settings reach first. */
  emails: EmailTemplateRecord[];
  /** The settings that differ from the saved ones. */
  change: BrandSettingsChange | undefined;
  unsaved: boolean;
  /** The site changed the Default layout, so emails don't look like this yet. */
  layoutKept: boolean;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const email = emails.find(entry => entry.id === chosen) ?? emails[0] ?? null;
  return (
    <section
      aria-labelledby="brand-preview-heading"
      className="min-w-0 overflow-hidden rounded-lg border border-border bg-card"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border p-4">
        <h2 id="brand-preview-heading" className="text-base font-semibold">
          Preview
        </h2>
        {unsaved && <Badge variant="warning">Unsaved</Badge>}
      </div>
      {email ? (
        <>
          <div className="space-y-3 border-b border-border p-4">
            <EmailPicker
              emails={emails}
              value={email.id}
              onChange={setChosen}
            />
            {layoutKept && (
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Your site changed the Default layout, so emails don&apos;t look
                like this yet. This is how they&apos;ll look once it&apos;s
                reset.
              </p>
            )}
          </div>
          <RenderedEmail email={email} change={change} />
        </>
      ) : (
        <p className="p-8 text-center text-sm text-muted-foreground">
          No email uses the Default layout.
        </p>
      )}
    </section>
  );
}
