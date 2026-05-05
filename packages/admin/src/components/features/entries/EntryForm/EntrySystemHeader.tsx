"use client";

import type { FieldConfig } from "@revnixhq/nextly/config";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@revnixhq/ui";
import { useEffect, useRef } from "react";
import { useFormContext } from "react-hook-form";

import {
  Code,
  Copy,
  Globe,
  Loader2,
  MoreHorizontal,
  PanelRight,
  PanelRightClose,
  RotateCcw,
  Save,
  Trash2,
} from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import { ShowJSONDialog } from "./ShowJSONDialog";
import type { EntryData, EntryFormMode } from "./useEntryForm";

// Why: Task 5 PR 4 unifies ActionBar + EntryFormHeader + TitleHeadlineInput
// into one component. The title input lives in the action-bar row (autofocus
// on create, blinking caret), the dropdown is a single consolidated menu
// (Discard / Duplicate / Show JSON / View API / Delete), and the rail
// toggle is right-aligned. Status pill moves to the meta strip (when rail
// collapsed) and the Document panel (when rail expanded), so the system
// header itself has no status affordance.

export interface EntrySystemHeaderProps {
  /** Form mode — determines button labels (Create/Publish vs Save/Update) and
   *  whether the More menu shows edit-only items (Duplicate, Show JSON, etc). */
  mode: EntryFormMode;
  /** Title field config (from Builder schema). Determines the placeholder
   *  fallback and the required-validation flag. */
  titleField?: FieldConfig;
  /** Whether the collection has the Draft/Published feature enabled.
   *  Splits the primary submit into Save Draft + Publish/Update. */
  hasStatus: boolean;
  /** Whether the form is currently submitting. Disables buttons + spinner. */
  isSubmitting?: boolean;
  /** Whether the form has validation errors. Disables submit. */
  isInvalid?: boolean;
  /** Whether the form has unsaved changes. Toggles Discard menu item. */
  isDirty?: boolean;
  /** Form id for the single submit button when drafts are off. */
  formId?: string;
  /** Entry data; needed for Show JSON dialog (entry id) and Duplicate (id). */
  entry?: EntryData | null;
  /** Collection slug for the Show JSON dialog. */
  collectionSlug: string;

  /** Save Draft handler — routed through useEntryForm.handleSubmit('draft'). */
  onSaveDraft?: () => void;
  /** Publish handler — routed through useEntryForm.handleSubmit('published'). */
  onPublish?: () => void;
  /** Discard / Cancel handler. */
  onCancel?: () => void;
  /** Delete handler (edit mode only). */
  onDelete?: () => void;
  /** Duplicate handler (edit mode only). When provided, the menu item is
   *  enabled; otherwise hidden. */
  onDuplicate?: () => void;
  /** View API response handler — opens a modal styled like Show JSON. */
  onViewApi?: () => void;

  /** Rail collapsed state. */
  isRailCollapsed?: boolean;
  /** Rail toggle handler. */
  onToggleRail?: () => void;
}

export function EntrySystemHeader({
  mode,
  titleField,
  hasStatus,
  isSubmitting = false,
  isInvalid = false,
  isDirty = false,
  formId = "entry-form",
  entry,
  collectionSlug,
  onSaveDraft,
  onPublish,
  onCancel,
  onDelete,
  onDuplicate,
  onViewApi,
  isRailCollapsed = false,
  onToggleRail,
}: EntrySystemHeaderProps) {
  const form = useFormContext();
  const inputRef = useRef<HTMLInputElement>(null);

  // Why: autofocus the title input on create so the cursor blinks ready for
  // typing. Skip in edit mode — focusing a populated title interrupts the
  // user's reading flow.
  useEffect(() => {
    if (mode === "create") {
      inputRef.current?.focus();
    }
  }, [mode]);

  if (!form) {
    return null;
  }

  const titleName =
    titleField && "name" in titleField ? (titleField.name as string) : "title";
  const titleRequired =
    (titleField as { required?: boolean } | undefined)?.required === true;
  const titleLabel =
    (titleField as { label?: string } | undefined)?.label ?? "Title";

  const { ref: rhfRef, ...rhfRegister } = form.register(titleName, {
    required: titleRequired ? "Title is required" : false,
  });

  const showEditMenuItems = mode === "edit" && entry?.id;

  return (
    <div className="px-6 py-3 border-b border-primary/5 flex items-center gap-3">
      {/* Title input — borderless, 19px, autofocus on create */}
      <div className="flex-1 min-w-0">
        <input
          {...rhfRegister}
          ref={el => {
            rhfRef(el);
            inputRef.current = el;
          }}
          type="text"
          placeholder="Untitled"
          aria-label={titleLabel}
          disabled={isSubmitting}
          className={cn(
            "w-full text-[19px] font-semibold tracking-tight text-foreground",
            "bg-transparent outline-none placeholder:text-muted-foreground/50",
            isSubmitting && "opacity-60 cursor-not-allowed"
          )}
        />
      </div>

      {/* Action cluster — right-aligned */}
      <div className="flex items-center gap-1.5 shrink-0">
        {hasStatus ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isSubmitting || isInvalid}
              onClick={onSaveDraft}
              data-status="draft"
            >
              {isSubmitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save Draft
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isSubmitting || isInvalid}
              onClick={onPublish}
              data-status="published"
            >
              {isSubmitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Globe className="h-3.5 w-3.5" />
              )}
              {mode === "create" ? "Publish" : "Update"}
            </Button>
          </>
        ) : (
          <Button
            type="submit"
            form={formId}
            size="sm"
            disabled={isSubmitting || isInvalid}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save className="h-3.5 w-3.5" />
                {mode === "create" ? "Create" : "Save"}
              </>
            )}
          </Button>
        )}

        {/* Single consolidated More menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="px-2"
              aria-label="More actions"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {isDirty && onCancel && (
              <DropdownMenuItem onClick={onCancel} disabled={isSubmitting}>
                <RotateCcw className="h-3.5 w-3.5" />
                Discard changes
              </DropdownMenuItem>
            )}
            {showEditMenuItems && onDuplicate && (
              <>
                {isDirty && onCancel && <DropdownMenuSeparator />}
                <DropdownMenuItem onClick={onDuplicate} disabled={isSubmitting}>
                  <Copy className="h-3.5 w-3.5" />
                  Duplicate
                </DropdownMenuItem>
              </>
            )}
            {showEditMenuItems && (
              <ShowJSONDialog
                collectionSlug={collectionSlug}
                entryId={entry.id}
                trigger={
                  <DropdownMenuItem onSelect={e => e.preventDefault()}>
                    <Code className="h-3.5 w-3.5" />
                    Show JSON
                  </DropdownMenuItem>
                }
              />
            )}
            {showEditMenuItems && onViewApi && (
              <DropdownMenuItem onClick={onViewApi}>
                <Code className="h-3.5 w-3.5" />
                View API response
              </DropdownMenuItem>
            )}
            {showEditMenuItems && onDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onDelete}
                  disabled={isSubmitting}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Rail toggle — far right, separated by a thin divider */}
        {onToggleRail && (
          <>
            <span className="w-px h-5 bg-black/10 mx-1" />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="px-2"
              onClick={onToggleRail}
              aria-label={isRailCollapsed ? "Show rail" : "Hide rail"}
              aria-pressed={isRailCollapsed}
            >
              {isRailCollapsed ? (
                <PanelRightClose className="h-4 w-4" />
              ) : (
                <PanelRight className="h-4 w-4" />
              )}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
