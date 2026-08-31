"use client";

/**
 * Region 01 — who this template is, and the acts that leave the page.
 *
 * The exit itself is NOT here: the shell renders it, because the shell derives
 * its claim to hide the admin's navigation from having drawn a way back, and a
 * claim made by whatever happens to be passed in as content is not a claim the
 * resolver can trust.
 */
import { Badge, Button } from "@nextlyhq/ui";
import type { useForm } from "react-hook-form";

import { Loader2, Send, Settings } from "@admin/components/icons";
import { FormField } from "@admin/components/ui/form";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";

import type { TemplateFormValues } from "./schema";

export function EditorBar({
  control,
  isEdit,
  isPending,
  isActive,
  isDirty,
  slug,
  onNameChange,
  onSendTest,
  onOpenSettings,
}: {
  control: ReturnType<typeof useForm<TemplateFormValues>>["control"];
  isEdit: boolean;
  isPending: boolean;
  isActive: boolean;
  isDirty: boolean;
  slug: string;
  onNameChange: (value: string, onChange: (v: string) => void) => void;
  onSendTest: () => void;
  onOpenSettings: () => void;
}) {
  return (
    /* Wraps rather than overflowing. Unwrapped, the six controls exceed the
       space beside the shell's back button on a phone and push Save off-screen,
       reachable only by horizontal panning nobody discovers. */
    <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2">
      <div className="min-w-0 flex-1 basis-full sm:basis-auto">
        <FormField
          control={control}
          name="name"
          render={({ field }) => (
            <input
              {...field}
              onChange={e => onNameChange(e.target.value, field.onChange)}
              disabled={isPending}
              placeholder="Untitled template"
              aria-label="Template name"
              className="w-full max-w-md truncate bg-transparent text-lg font-semibold text-foreground outline-none placeholder:text-muted-foreground"
            />
          )}
        />
        <div className="font-mono text-xs text-muted-foreground">
          {slug || "no-slug"}
        </div>
      </div>

      <Badge variant={isActive ? "default" : "outline"} className="shrink-0">
        {isActive ? "Active" : "Inactive"}
      </Badge>
      {isDirty ? (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
          title="Unsaved changes"
          aria-label="Unsaved changes"
        />
      ) : null}

      <Button
        type="button"
        variant="outline"
        onClick={onOpenSettings}
        disabled={isPending}
      >
        <Settings className="h-4 w-4" />
        Settings
      </Button>
      {isEdit && (
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={onSendTest}
        >
          <Send className="h-4 w-4" />
          Send test
        </Button>
      )}
      <Link href={ROUTES.SETTINGS_EMAIL_TEMPLATES}>
        <Button type="button" variant="outline" disabled={isPending}>
          Cancel
        </Button>
      </Link>
      <Button type="submit" disabled={isPending}>
        {isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {isEdit ? "Saving…" : "Creating…"}
          </>
        ) : isEdit ? (
          "Save"
        ) : (
          "Create template"
        )}
      </Button>
    </div>
  );
}
