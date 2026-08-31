"use client";

import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@nextlyhq/ui";
import { useCallback, useMemo, useState } from "react";
import type { useForm } from "react-hook-form";
import { useFieldArray } from "react-hook-form";

import { MediaPickerDialog } from "@admin/components/features/media-library/MediaPickerDialog";
import { Paperclip, Plus, Trash2 } from "@admin/components/icons";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@admin/components/ui/form";
import { type Media } from "@admin/types/media";

import {
  USE_DEFAULT_LAYOUT,
  USE_DEFAULT_PROVIDER,
  type TemplateFormValues,
} from "./schema";

// ============================================================
// Rail: Settings tab
// ============================================================

function AttachmentsField({
  control,
}: {
  control: ReturnType<typeof useForm<TemplateFormValues>>["control"];
}) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: "attachments",
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const selectedIds = useMemo(
    () => new Set(fields.map(f => f.mediaId)),
    [fields]
  );

  const handlePick = useCallback(
    (media: Media[]) => {
      for (const m of media) {
        if (selectedIds.has(m.id)) continue;
        append({
          mediaId: m.id,
          displayName: m.originalFilename ?? m.filename ?? m.id,
          mimeType: m.mimeType,
        });
      }
      setPickerOpen(false);
    },
    [append, selectedIds]
  );

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Attachments
        </h4>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => setPickerOpen(true)}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add
        </Button>
      </div>
      {fields.length > 0 ? (
        <div className="space-y-2">
          {fields.map((field, index) => (
            <div
              key={field.id}
              className="flex items-center gap-2 rounded-md border border-border bg-muted p-2.5"
            >
              <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{field.displayName}</p>
                {field.mimeType ? (
                  <p className="text-xs text-muted-foreground">
                    {field.mimeType}
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => remove(index)}
                aria-label="Remove attachment"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
          No default attachments.
        </p>
      )}
      <MediaPickerDialog
        mode="multi"
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={handlePick}
        initialSelectedIds={selectedIds}
        title="Select default attachments"
      />
    </div>
  );
}

/**
 * What the settings surface needs, named once.
 *
 * The inspector wraps this rail and takes the same six values, so a second
 * spelling of the shape is a second thing to keep in step — and the two drift
 * silently, because both compile.
 */
export interface TemplateSettingsProps {
  control: ReturnType<typeof useForm<TemplateFormValues>>["control"];
  isEdit: boolean;
  isPending: boolean;
  isLayoutRow: boolean;
  providers: { id: string; name: string; isDefault?: boolean }[];
  layouts: { id: string; name: string; slug: string }[];
}

export function SettingsRail({
  control,
  isEdit,
  isPending,
  isLayoutRow,
  providers,
  layouts,
}: TemplateSettingsProps) {
  return (
    <div className="space-y-5">
      {isLayoutRow && (
        <p className="rounded-md border border-border-strong bg-muted px-3 py-2 text-xs text-muted-foreground">
          This is a layout. Place{" "}
          <code className="font-mono text-foreground">{"{{content}}"}</code>{" "}
          where each email body should be injected.
        </p>
      )}
      <FormField
        control={control}
        name="slug"
        render={({ field }) => (
          <FormItem className="space-y-1.5">
            <FormLabel className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Slug
            </FormLabel>
            <FormControl>
              <Input
                placeholder="welcome-email"
                disabled={isEdit || isPending}
                className="h-8 font-mono text-sm"
                {...field}
              />
            </FormControl>
            <p className="text-xs text-muted-foreground">
              {isEdit
                ? "Fixed after creation."
                : "Programmatic reference; auto-generated from the name."}
            </p>
            <FormMessage />
          </FormItem>
        )}
      />

      {!isLayoutRow && (
        <FormField
          control={control}
          name="providerId"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Provider
              </FormLabel>
              <Select
                value={field.value || USE_DEFAULT_PROVIDER}
                onValueChange={val =>
                  field.onChange(val === USE_DEFAULT_PROVIDER ? "" : val)
                }
                disabled={isPending}
              >
                <FormControl>
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Use default provider" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value={USE_DEFAULT_PROVIDER}>
                    Use default provider
                  </SelectItem>
                  {providers.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      {p.isDefault ? " (Default)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Override the default sending provider for this template.
              </p>
            </FormItem>
          )}
        />
      )}

      {!isLayoutRow && (
        <FormField
          control={control}
          name="useLayout"
          render={({ field }) => (
            <FormItem className="flex items-start justify-between gap-3">
              <div className="space-y-0.5">
                <FormLabel className="text-sm text-foreground">
                  Use layout
                </FormLabel>
                <p className="text-xs text-muted-foreground">
                  Wrap the body in a layout at its {"{{content}}"}.
                </p>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={isPending}
                />
              </FormControl>
            </FormItem>
          )}
        />
      )}

      {!isLayoutRow && layouts.length > 0 && (
        <FormField
          control={control}
          name="layoutId"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Layout
              </FormLabel>
              <Select
                value={field.value || USE_DEFAULT_LAYOUT}
                onValueChange={val =>
                  field.onChange(val === USE_DEFAULT_LAYOUT ? "" : val)
                }
                disabled={isPending}
              >
                <FormControl>
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Default layout" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value={USE_DEFAULT_LAYOUT}>
                    Default layout
                  </SelectItem>
                  {layouts.map(l => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Which layout wraps this template.
              </p>
            </FormItem>
          )}
        />
      )}

      {!isLayoutRow && (
        <FormField
          control={control}
          name="isActive"
          render={({ field }) => (
            <FormItem className="flex items-start justify-between gap-3">
              <div className="space-y-0.5">
                <FormLabel className="text-sm text-foreground">
                  Active
                </FormLabel>
                <p className="text-xs text-muted-foreground">
                  Inactive templates cannot be used to send.
                </p>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={isPending}
                />
              </FormControl>
            </FormItem>
          )}
        />
      )}

      {!isLayoutRow && <AttachmentsField control={control} />}
    </div>
  );
}
