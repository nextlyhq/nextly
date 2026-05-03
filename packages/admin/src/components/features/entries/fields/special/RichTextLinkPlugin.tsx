"use client";

/**
 * Rich Text Link Plugin
 *
 * A Lexical plugin that provides a dialog-based interface for inserting and editing
 * hyperlinks in the rich text editor. Supports URL input, "Open in new tab" option,
 * and link removal.
 *
 * This plugin registers a custom command (OPEN_LINK_DIALOG_COMMAND) that opens
 * the link dialog. The toolbar button dispatches this command instead of using
 * the browser's prompt().
 *
 * @module components/entries/fields/special/RichTextLinkPlugin
 * @since 1.0.0
 */

// UI Components
import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $findMatchingParent, mergeRegister } from "@lexical/utils";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
  Input,
  Label,
} from "@revnixhq/ui";
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  type LexicalCommand,
} from "lexical";
import { useState, useCallback, useEffect } from "react";

import { Link, Trash2 } from "@admin/components/icons";

// Icons

// ============================================================
// Types & Commands
// ============================================================

/**
 * Command to open the link dialog.
 * Dispatched by the toolbar link button.
 */
export const OPEN_LINK_DIALOG_COMMAND: LexicalCommand<void> = createCommand(
  "OPEN_LINK_DIALOG_COMMAND"
);

interface LinkData {
  url: string;
  openInNewTab: boolean;
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Normalizes a URL by adding protocol if missing.
 * - Adds https:// for regular URLs
 * - Adds mailto: for email addresses
 * - Preserves existing protocols
 */
function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";

  // Already has a protocol
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//i.test(trimmed)) {
    return trimmed;
  }

  // mailto: links (no //)
  if (/^mailto:/i.test(trimmed)) {
    return trimmed;
  }

  // tel: links (no //)
  if (/^tel:/i.test(trimmed)) {
    return trimmed;
  }

  // Looks like an email address
  if (
    trimmed.includes("@") &&
    !trimmed.includes("/") &&
    !trimmed.includes(" ")
  ) {
    return `mailto:${trimmed}`;
  }

  // Looks like a phone number (starts with + or contains only digits, spaces, dashes, parens)
  if (/^[+\d][\d\s()-]*$/.test(trimmed)) {
    return `tel:${trimmed.replace(/[\s()-]/g, "")}`;
  }

  // Add https:// by default
  return `https://${trimmed}`;
}

/**
 * Validates that a URL is not empty and has a valid format.
 */
function isValidUrl(url: string): boolean {
  if (!url.trim()) return false;

  const normalized = normalizeUrl(url);

  // Allow mailto: and tel: links
  if (/^(mailto:|tel:)/i.test(normalized)) {
    return true;
  }

  // Check for valid URL format
  try {
    new URL(normalized);
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// Component
// ============================================================

export interface RichTextLinkPluginProps {
  /**
   * Whether the editor is disabled.
   * When disabled, the dialog cannot be opened.
   */
  disabled?: boolean;
}

/**
 * RichTextLinkPlugin provides a dialog-based interface for link management.
 *
 * Features:
 * - Dialog with URL input and "Open in new tab" checkbox
 * - Auto-detects and pre-fills URL when cursor is inside existing link
 * - URL normalization (auto-adds https://, mailto:, tel:)
 * - Link removal via "Remove Link" button
 * - Keyboard accessible (Escape to close, Enter to submit)
 *
 * Must be rendered inside a LexicalComposer.
 *
 * @example
 * ```tsx
 * <LexicalComposer initialConfig={config}>
 *   <RichTextLinkPlugin />
 *   <RichTextPlugin ... />
 * </LexicalComposer>
 * ```
 */
export function RichTextLinkPlugin({
  disabled = false,
}: RichTextLinkPluginProps) {
  const [editor] = useLexicalComposerContext();
  const [isOpen, setIsOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [linkData, setLinkData] = useState<LinkData>({
    url: "",
    openInNewTab: true,
  });
  const [error, setError] = useState<string | null>(null);

  /**
   * Opens the dialog and detects if cursor is inside an existing link.
   */
  const openDialog = useCallback(() => {
    if (disabled) return;

    editor.getEditorState().read(() => {
      const selection = $getSelection();

      if ($isRangeSelection(selection)) {
        // Check if we're inside a link
        const node = selection.anchor.getNode();
        const linkNode = $findMatchingParent(node, $isLinkNode);

        if (linkNode && $isLinkNode(linkNode)) {
          // Editing existing link - pre-fill the URL
          const url = linkNode.getURL();
          const target = linkNode.getTarget();

          setLinkData({
            url: url || "",
            openInNewTab: target === "_blank",
          });
          setIsEditing(true);
        } else {
          // Creating new link
          setLinkData({
            url: "",
            openInNewTab: true,
          });
          setIsEditing(false);
        }

        setError(null);
        setIsOpen(true);
      }
    });
  }, [editor, disabled]);

  /**
   * Inserts or updates the link.
   */
  const insertLink = useCallback(() => {
    const { url, openInNewTab } = linkData;

    // Validate URL
    if (!isValidUrl(url)) {
      setError("Please enter a valid URL");
      return;
    }

    // Normalize the URL
    const normalizedUrl = normalizeUrl(url);

    // Build link attributes
    const target = openInNewTab ? "_blank" : null;
    const rel = openInNewTab ? "noopener noreferrer" : null;

    // Dispatch the toggle link command with attributes
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, {
      url: normalizedUrl,
      target,
      rel,
    });

    // Close dialog and reset state
    setIsOpen(false);
    setLinkData({ url: "", openInNewTab: true });
    setError(null);
  }, [editor, linkData]);

  /**
   * Removes the link from selected text.
   */
  const removeLink = useCallback(() => {
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
    setIsOpen(false);
    setLinkData({ url: "", openInNewTab: true });
    setError(null);
  }, [editor]);

  /**
   * Handles dialog close.
   */
  const handleOpenChange = useCallback((open: boolean) => {
    setIsOpen(open);
    if (!open) {
      // Reset state when closing
      setLinkData({ url: "", openInNewTab: true });
      setError(null);
    }
  }, []);

  /**
   * Handles form submission on Enter key.
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        insertLink();
      }
    },
    [insertLink]
  );

  // Register command listener
  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        OPEN_LINK_DIALOG_COMMAND,
        () => {
          openDialog();
          return true;
        },
        COMMAND_PRIORITY_EDITOR
      )
    );
  }, [editor, openDialog]);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent size="md" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link className="h-5 w-5" />
            {isEditing ? "Edit Link" : "Insert Link"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the link URL or remove the link."
              : "Enter a URL to create a link from the selected text."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* URL Input */}
          <div className="space-y-2">
            <Label htmlFor="link-url">URL</Label>
            <Input
              id="link-url"
              type="text"
              placeholder="https://example.com or email@example.com"
              value={linkData.url}
              onChange={e => {
                setLinkData(prev => ({ ...prev, url: e.target.value }));
                setError(null);
              }}
              autoFocus
              aria-invalid={!!error}
              aria-describedby={error ? "link-url-error" : undefined}
            />
            {error && (
              <p id="link-url-error" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              URLs without a protocol will have https:// added automatically.
              Email addresses will be converted to mailto: links.
            </p>
          </div>

          {/* Open in new tab checkbox */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="link-new-tab"
              checked={linkData.openInNewTab}
              onCheckedChange={checked =>
                setLinkData(prev => ({
                  ...prev,
                  openInNewTab: checked === true,
                }))
              }
            />
            <Label
              htmlFor="link-new-tab"
              className="text-sm font-normal cursor-pointer"
            >
              Open in new tab
            </Label>
          </div>
        </div>

        <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-between gap-2">
          {/* Remove Link button - only shown when editing */}
          {isEditing && (
            <Button
              type="button"
              variant="destructive"
              onClick={removeLink}
              className="sm:mr-auto"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Remove Link
            </Button>
          )}

          <div className="flex gap-2 sm:ml-auto">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={insertLink}
              disabled={!linkData.url.trim()}
            >
              {isEditing ? "Update Link" : "Insert Link"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Exports
// ============================================================
