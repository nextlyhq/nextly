"use client";

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import type { FieldConfig } from "nextly/config";
import { useEffect, useRef, useState } from "react";
import { useFormContext } from "react-hook-form";

import {
  Code,
  Copy,
  EyeOff,
  Globe,
  Loader2,
  MoreHorizontal,
  PanelRight,
  PanelRightClose,
  RotateCcw,
  Trash2,
} from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import { LanguageSwitcher } from "../LanguageSwitcher";

import { ShowJSONDialog } from "./ShowJSONDialog";
import { UnpublishConfirmDialog } from "./UnpublishConfirmDialog";
import type { EntryData, EntryFormMode } from "./useEntryForm";

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
  /** Active content locale (i18n M7). Shown/selected in the language switcher. */
  locale?: string;
  /** Called when the user switches the active content language (i18n M7). When omitted, the
   *  language switcher is not rendered. */
  onLocaleChange?: (locale: string) => void;

  /** Save Draft handler — routed through useEntryForm.handleSubmit('save-draft').
   *  Used in create mode and when editing a draft entry. */
  onSaveDraft?: () => void;
  /** Publish handler — routed through useEntryForm.handleSubmit('publish').
   *  Used in create mode and when promoting a draft to published. */
  onPublish?: () => void;
  /** Save changes handler — routed through useEntryForm.handleSubmit('save-changes').
   *  Used when editing a published entry; submits dirty fields with
   *  status="published" so the lifecycle stays the same. */
  onSaveChanges?: () => void;
  /** Unpublish handler — routed through useEntryForm.handleSubmit('unpublish').
   *  Fires only after the user confirms the modal. Sends `{ status: "draft" }`
   *  with no other field changes (matches Payload's Unpublish pattern). */
  onUnpublish?: () => void;
  /** Discard / Cancel handler. */
  onCancel?: () => void;
  /** Delete handler (edit mode only). */
  onDelete?: () => void;
  /** Duplicate handler (edit mode only). When provided, the menu item is
   *  enabled; otherwise hidden. */
  onDuplicate?: () => void;
  /** View API response handler — opens a modal styled like Show JSON. */
  onViewApi?: () => void;

  /**
   * Whether to render the built-in Show JSON dropdown item (which uses
   * `ShowJSONDialog`). Defaults to `true`. Set `false` to suppress the
   * menu item entirely (e.g. for resources whose API surface isn't
   * representable as a single GET).
   *
   * @default true
   */
  showJson?: boolean;

  /**
   * Resource scope passed through to the Show JSON dialog and used by the
   * `View API response` URL display. Determines whether the dialog hits
   * `/api/collections/{slug}/entries/{id}` or `/api/singles/{slug}`.
   *
   * @default "collection"
   */
  scope?: "collection" | "single";

  /**
   * When true (Singles), the title is fixed by the single's config: render the
   * title input read-only and drop its required validation. Defaults to false
   * so collection entry forms keep the editable, optionally-required title.
   */
  lockIdentity?: boolean;

  /** Rail collapsed state. */
  isRailCollapsed?: boolean;
  /** Rail toggle handler. */
  onToggleRail?: () => void;
  /**
   * Plugin-contributed toolbar controls, rendered at the start of the action
   * cluster (left of Save/Publish). Kept as an opaque node so the header stays
   * plugin-agnostic — the caller builds it from `entryFormToolbarSlot`.
   */
  toolbarSlot?: React.ReactNode;
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
  locale,
  onLocaleChange,
  onSaveDraft,
  onPublish,
  onSaveChanges,
  onUnpublish,
  onCancel,
  onDelete,
  onDuplicate,
  onViewApi,
  showJson = true,
  scope = "collection",
  lockIdentity = false,
  isRailCollapsed = false,
  onToggleRail,
  toolbarSlot,
}: EntrySystemHeaderProps) {
  const form = useFormContext();
  const inputRef = useRef<HTMLInputElement>(null);
  const [unpublishOpen, setUnpublishOpen] = useState(false);

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
    required: !lockIdentity && titleRequired ? "Title is required" : false,
  });

  const showEditMenuItems = mode === "edit" && entry?.id;

  // - hasStatus + create or hasStatus+edit+draft → Save Draft + Publish
  //   (the user is working on something not yet live).
  // - hasStatus + edit + published → Save changes + Unpublish (the user
  //   is editing live content). Save changes is disabled when there are
  //   no dirty edits — there's nothing to save in that state, so the
  //   button greys out and Unpublish becomes the only enabled action.
  // - !hasStatus → single Save button (collections without drafts).
  const isPublishedEdit = mode === "edit" && entry?.status === "published";
  const entryLabel =
    typeof entry?.title === "string" && entry.title.trim().length > 0
      ? entry.title
      : ((entry?.slug as string | undefined) ?? null);

  return (
    <div className="px-6 py-3 border-b border-border flex items-center gap-3 sticky top-0 z-30 bg-background">
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
          readOnly={lockIdentity}
          className={cn(
            "w-full text-[19px] font-semibold tracking-tight text-foreground",
            "bg-transparent outline-none placeholder:text-muted-foreground/50",
            isSubmitting && "opacity-60 cursor-not-allowed",
            lockIdentity && "cursor-default text-foreground/80"
          )}
        />
      </div>

      {/* Action cluster — right-aligned */}
      <div className="flex items-center gap-1.5 shrink-0">
        {toolbarSlot}
        {/* i18n M7: content-language switcher. Renders only when a change handler is wired AND
            localization is configured (the component self-hides otherwise). */}
        {onLocaleChange && (
          <LanguageSwitcher value={locale} onChange={onLocaleChange} />
        )}
        {hasStatus && isPublishedEdit ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isSubmitting || isInvalid || !isDirty}
              onClick={onSaveChanges}
              data-status="save-changes"
            >
              {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save changes
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isSubmitting}
              onClick={() => setUnpublishOpen(true)}
              data-status="unpublish"
            >
              <EyeOff className="h-3.5 w-3.5" />
              Unpublish
            </Button>
          </>
        ) : hasStatus ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isSubmitting || isInvalid}
              onClick={onSaveDraft}
              data-status="draft"
            >
              {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
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
              Publish
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
            ) : mode === "create" ? (
              "Create"
            ) : (
              "Save"
            )}
          </Button>
        )}

        {/* Single consolidated More menu — hidden entirely in create mode.
            Why: in create mode the entry doesn't exist server-side yet, so
            Duplicate / Show JSON / View API / Delete have nothing to act on,
            and Discard changes is redundant with navigating away. Once the
            entry is persisted (mode === "edit"), the full action set
            appears. Resolves item 11 of 07-admin-bugs-feedback (PR-8). */}
        {showEditMenuItems && (
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
              {onDuplicate && (
                <>
                  {isDirty && onCancel && <DropdownMenuSeparator />}
                  <DropdownMenuItem
                    onClick={onDuplicate}
                    disabled={isSubmitting}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Duplicate
                  </DropdownMenuItem>
                </>
              )}
              {showJson && (
                <ShowJSONDialog
                  scope={scope}
                  collectionSlug={collectionSlug}
                  /* Why: collection scope needs the entry id to build
                     /api/collections/{slug}/entries/{id}; single scope is
                     keyed only by slug so entryId is unused. The outer
                     showEditMenuItems gate guarantees entry?.id exists
                     for the collection branch. */
                  entryId={scope === "single" ? undefined : entry.id}
                  trigger={
                    <DropdownMenuItem onSelect={e => e.preventDefault()}>
                      <Code className="h-3.5 w-3.5" />
                      Show JSON
                    </DropdownMenuItem>
                  }
                />
              )}
              {onViewApi && (
                <DropdownMenuItem onClick={onViewApi}>
                  <Code className="h-3.5 w-3.5" />
                  View API response
                </DropdownMenuItem>
              )}
              {onDelete && (
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
        )}

        {/* Rail toggle — far right, separated by a thin divider */}
        {onToggleRail && (
          <>
            <span className="w-px h-5 bg-border mx-1" />
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

      {/* Why: render the confirm modal at the component root so it's
          mounted regardless of which button matrix branch fired. The
          dialog itself controls open state via the prop; we close
          immediately on confirm and let the parent's mutation toast
          handle success/error feedback. Loading state is intentionally
          short-lived since unpublish is a single-field PATCH. */}
      <UnpublishConfirmDialog
        open={unpublishOpen}
        onOpenChange={setUnpublishOpen}
        entryLabel={entryLabel}
        onConfirm={() => {
          setUnpublishOpen(false);
          onUnpublish?.();
        }}
        isLoading={isSubmitting}
      />
    </div>
  );
}
