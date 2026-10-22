"use client";

/**
 * Everything about an email that isn't its content, in the side sheet's
 * Details tab: what it's sent for, how it's sent, who it copies, its
 * attachments and the variables it expects.
 *
 * The description and the declared variables are what an owner says about its
 * email, so they lock with the content until the site overrides it. The rest
 * are the site's settings on any email.
 */
import { Input, Textarea } from "@nextlyhq/ui";
import { useState } from "react";
import type { useForm } from "react-hook-form";

import { X } from "@admin/components/icons";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@admin/components/ui/form";

import type { TemplateFormValues, TemplateFormVariable } from "./schema";
import { SettingsRail, type TemplateSettingsProps } from "./SettingsRail";
import { VariablesRail } from "./VariablesRail";

const sectionLabel =
  "text-xs font-medium uppercase tracking-wide text-muted-foreground";

/** A list of addresses as chips, with a field that adds one on Enter. */
function CopiesField({
  control,
  name,
  label,
  isPending,
}: {
  control: ReturnType<typeof useForm<TemplateFormValues>>["control"];
  name: "cc" | "bcc";
  label: string;
  isPending: boolean;
}) {
  const [draft, setDraft] = useState("");
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        const add = () => {
          const address = draft.trim();
          if (!address || field.value.includes(address)) return;
          field.onChange([...field.value, address]);
          setDraft("");
        };
        return (
          <FormItem className="space-y-1.5">
            <FormLabel className={sectionLabel}>{label}</FormLabel>
            <div className="flex flex-wrap items-center gap-1.5">
              {field.value.map(address => (
                <span
                  key={address}
                  className="inline-flex h-7 items-center gap-1 rounded-sm bg-secondary pl-2 pr-1 text-sm"
                >
                  {address}
                  <button
                    type="button"
                    aria-label={`Remove ${address} from ${label}`}
                    disabled={isPending}
                    onClick={() =>
                      field.onChange(
                        field.value.filter(item => item !== address)
                      )
                    }
                    className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <FormControl>
                <Input
                  value={draft}
                  disabled={isPending}
                  aria-label={`Add an address to ${label}`}
                  placeholder="name@example.com"
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      add();
                    }
                  }}
                  onBlur={add}
                  className="h-8 min-w-36 flex-1 text-sm"
                />
              </FormControl>
            </div>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}

export function DetailsPanel({
  control,
  isEdit,
  isPending,
  isLayoutRow,
  providers,
  layouts,
  declared,
  onInsert,
  ownsContent,
  carriesSecret,
}: TemplateSettingsProps & {
  declared: TemplateFormVariable[];
  onInsert: (name: string) => void;
  /** Whether the description and declarations are the site's to change. */
  ownsContent: boolean;
  /** A template carrying a secret takes no copies. */
  carriesSecret: boolean;
}) {
  return (
    <div className="flex flex-col gap-6" data-testid="details-panel">
      <FormField
        control={control}
        name="description"
        render={({ field }) => (
          <FormItem className="space-y-1.5">
            <FormLabel className={sectionLabel}>Sent when</FormLabel>
            <FormControl>
              <Textarea
                {...field}
                readOnly={!ownsContent}
                disabled={isPending}
                placeholder="Sent when a customer asks to reset their password"
                className="min-h-24 text-sm"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <SettingsRail
        control={control}
        isEdit={isEdit}
        isPending={isPending}
        isLayoutRow={isLayoutRow}
        providers={providers}
        layouts={layouts}
      />

      {!isLayoutRow ? (
        <section className="flex flex-col gap-3" aria-label="Copies">
          {carriesSecret ? (
            <p className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
              This email carries a secret, such as a sign-in or reset link, so
              it never copies anyone.
            </p>
          ) : (
            <>
              <CopiesField
                control={control}
                name="cc"
                label="Cc"
                isPending={isPending}
              />
              <CopiesField
                control={control}
                name="bcc"
                label="Bcc"
                isPending={isPending}
              />
            </>
          )}
        </section>
      ) : null}

      {!isLayoutRow ? (
        <VariablesRail
          control={control}
          declared={declared}
          onInsert={onInsert}
          locked={!ownsContent}
        />
      ) : null}
    </div>
  );
}
