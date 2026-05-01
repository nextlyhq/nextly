"use client";

/**
 * Rich Text Media Plugin
 *
 * A Lexical plugin that provides image insertion via MediaPickerDialog.
 * Supports selecting from existing media library or uploading new images.
 *
 * This plugin registers custom commands for opening the image dialog and
 * inserting images programmatically.
 *
 * @module components/entries/fields/special/RichTextMediaPlugin
 * @since 1.0.0
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  $insertNodes,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  type LexicalCommand,
} from "lexical";
import { useState, useCallback, useEffect } from "react";

import { MediaPickerDialog } from "@admin/components/features/media-library/MediaPickerDialog";
import type { Media } from "@admin/types/media";

// Local components
import { $createImageNode, type ImagePayload } from "./ImageNode";

// ============================================================
// Types & Commands
// ============================================================

/**
 * Command to open the image dialog.
 * Dispatched by the toolbar image button.
 */
export const OPEN_IMAGE_DIALOG_COMMAND: LexicalCommand<void> = createCommand(
  "OPEN_IMAGE_DIALOG_COMMAND"
);

/**
 * Command to insert an image directly.
 * Can be used programmatically without opening the dialog.
 */
export const INSERT_IMAGE_COMMAND: LexicalCommand<ImagePayload> = createCommand(
  "INSERT_IMAGE_COMMAND"
);

// ============================================================
// Component
// ============================================================

export interface RichTextMediaPluginProps {
  /**
   * Whether the editor is disabled.
   * When disabled, the dialog cannot be opened.
   */
  disabled?: boolean;
}

/**
 * RichTextMediaPlugin provides image insertion via MediaPickerDialog.
 *
 * Features:
 * - Select from existing media library
 * - Upload new images
 * - Search and filter media
 * - Alt text from media metadata
 *
 * Must be rendered inside a LexicalComposer.
 *
 * @example
 * ```tsx
 * <LexicalComposer initialConfig={config}>
 *   <RichTextMediaPlugin />
 *   <RichTextPlugin ... />
 * </LexicalComposer>
 * ```
 */
export function RichTextMediaPlugin({
  disabled = false,
}: RichTextMediaPluginProps) {
  const [editor] = useLexicalComposerContext();
  const [isOpen, setIsOpen] = useState(false);

  /**
   * Opens the media picker dialog
   */
  const openDialog = useCallback(() => {
    if (disabled) return;
    setIsOpen(true);
  }, [disabled]);

  /**
   * Handles media selection from MediaPickerDialog
   */
  const handleMediaSelect = useCallback(
    (selectedMedia: Media[]) => {
      if (selectedMedia.length > 0) {
        const media = selectedMedia[0];

        // Insert the image node
        editor.update(() => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            const imageNode = $createImageNode({
              src: media.url,
              altText: media.altText || media.originalFilename || "Image",
              width: media.width ?? undefined,
              height: media.height ?? undefined,
            });
            $insertNodes([imageNode]);
          }
        });
      }
      setIsOpen(false);
    },
    [editor]
  );

  /**
   * Handles dialog close
   */
  const handleOpenChange = useCallback((open: boolean) => {
    setIsOpen(open);
  }, []);

  // Register command to open the image dialog
  useEffect(() => {
    return editor.registerCommand(
      OPEN_IMAGE_DIALOG_COMMAND,
      () => {
        openDialog();
        return true;
      },
      COMMAND_PRIORITY_EDITOR
    );
  }, [editor, openDialog]);

  // Register command to insert an image directly (programmatic use)
  useEffect(() => {
    return editor.registerCommand(
      INSERT_IMAGE_COMMAND,
      payload => {
        editor.update(() => {
          const imageNode = $createImageNode(payload);
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            $insertNodes([imageNode]);
          }
        });
        return true;
      },
      COMMAND_PRIORITY_EDITOR
    );
  }, [editor]);

  return (
    <MediaPickerDialog
      mode="single"
      open={isOpen}
      onOpenChange={handleOpenChange}
      onSelect={handleMediaSelect}
      accept="image/*"
      title="Insert Image"
    />
  );
}

// ============================================================
// Exports
// ============================================================
