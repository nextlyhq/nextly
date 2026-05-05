"use client";

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@revnixhq/ui";
import type React from "react";

import {
  Copy,
  Eye,
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

import type { EntryData, EntryFormMode } from "./useEntryForm";

// ============================================================================
// Types
// ============================================================================

export interface ActionBarProps {
  /** Form mode — affects which buttons are shown (Delete only in edit mode). */
  mode: EntryFormMode;
  /** Entry data; provides current status for the pill and id for the More menu. */
  entry?: EntryData | null;
  /** Singular collection label (e.g. "Post"); used in fallback title. */
  singularLabel?: string;
  /** Whether this collection has Draft/Published status enabled.
   *  When true → render Save Draft + Publish split.
   *  When false → render single Save button. */
  hasStatus?: boolean;
  /** Whether the form is currently submitting; disables buttons + shows spinner. */
  isSubmitting?: boolean;
  /** Whether form has validation errors. */
  isInvalid?: boolean;
  /** Form id used as a fallback for the single Save button when drafts
   *  are disabled. Save Draft / Publish always go through onClick so the
   *  status payload is attached. */
  formId?: string;

  /** Preview availability + handler. */
  isPreviewAvailable?: boolean;
  onPreview?: () => void;
  previewLabel?: string;

  /** Save Draft handler (PR 7). Routed through useEntryForm.handleSubmit
   *  with status='draft'. Required when hasStatus is true. */
  onSaveDraft?: () => void;
  /** Publish handler (PR 7). Routed through useEntryForm.handleSubmit
   *  with status='published'. Required when hasStatus is true. */
  onPublish?: () => void;

  /** Cancel / Discard handler — moved into the More menu. */
  onCancel?: () => void;
  /** Delete handler (edit mode only) — in the More menu. */
  onDelete?: () => void;

  /** Rail toggle state + handler. */
  isRailCollapsed?: boolean;
  onToggleRail?: () => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * ActionBar — Payload-style sticky horizontal bar above the entry form.
 *
 * Layout (Q-D2=A in the redesign spec):
 *   [Title (truncated) · Status pill]            [Preview · Save Draft · Publish · More · Rail toggle]
 *
 * • When the collection's Draft/Published feature is off (hasStatus=false),
 *   the Status pill is hidden and Save Draft + Publish merge into a single
 *   "Save" button.
 * • The split Save/Publish click handlers route to the same form submit;
 *   PR 7 of the redesign threads the status payload through useEntryForm
 *   so each button writes the appropriate status.
 * • The More menu hosts secondary actions: Discard, Duplicate (future),
 *   Delete (edit mode only).
 */
export function ActionBar({
  mode,
  entry,
  singularLabel,
  hasStatus = false,
  isSubmitting = false,
  isInvalid = false,
  formId = "entry-form",
  isPreviewAvailable = false,
  onPreview,
  previewLabel = "Preview",
  onSaveDraft,
  onPublish,
  onCancel,
  onDelete,
  isRailCollapsed = false,
  onToggleRail,
}: ActionBarProps): React.ReactElement {
  const status = (entry?.status as string | undefined) ?? "draft";

  const titleText =
    (entry as { title?: string } | null)?.title ??
    (mode === "create" ? `New ${singularLabel ?? "entry"}` : "Untitled");

  return (
    <div className="px-6 py-3 border-b border-primary/5 flex items-center gap-3">
      {/* Left: title + status pill */}
      <div className="flex items-center gap-3 min-w-0">
        <h2 className="text-[15px] font-semibold text-foreground truncate">
          {titleText}
        </h2>
        {hasStatus && <StatusPill status={status} />}
      </div>

      {/* Right: action buttons + rail toggle */}
      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        {isPreviewAvailable && onPreview && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onPreview}
            disabled={isSubmitting}
          >
            <Eye className="h-3.5 w-3.5" />
            {previewLabel}
          </Button>
        )}

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
            ) : (
              <>
                <Save className="h-3.5 w-3.5" />
                {mode === "create" ? "Create" : "Save"}
              </>
            )}
          </Button>
        )}

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
            {onCancel && (
              <DropdownMenuItem onClick={onCancel} disabled={isSubmitting}>
                <RotateCcw className="h-3.5 w-3.5" />
                Discard changes
              </DropdownMenuItem>
            )}
            {mode === "edit" && (
              <DropdownMenuItem disabled>
                <Copy className="h-3.5 w-3.5" />
                Duplicate
              </DropdownMenuItem>
            )}
            {mode === "edit" && onDelete && (
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

// ============================================================================
// Status pill
// ============================================================================

function StatusPill({ status }: { status: string }) {
  const isPublished = status === "published";
  return (
    <span
      className={cn(
        "px-2 py-1 text-[10px] font-bold tracking-[0.1em] uppercase rounded shrink-0",
        isPublished
          ? "bg-green-50 text-green-800"
          : "bg-amber-50 text-amber-800"
      )}
    >
      {isPublished ? "Published" : "Draft"}
    </span>
  );
}
