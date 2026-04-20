/**
 * ImagePlugin - Handles image insertion via MediaPickerDialog
 *
 * Provides a command to insert images into the Lexical editor.
 * Integrates with Nextly's MediaPickerDialog for image selection.
 *
 * Usage:
 * - Toolbar button dispatches INSERT_IMAGE_COMMAND
 * - Plugin opens MediaPickerDialog
 * - User selects image
 * - Plugin inserts ImageNode at cursor position
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { LexicalCommand } from "lexical";
import { COMMAND_PRIORITY_EDITOR, createCommand, $insertNodes } from "lexical";
import { useEffect } from "react";

import { $createImageNode, ImageNode } from "./ImageNode";

/**
 * Command to insert an image
 */
export const INSERT_IMAGE_COMMAND: LexicalCommand<{
  altText: string;
  src: string;
  width?: number;
  height?: number;
}> = createCommand("INSERT_IMAGE_COMMAND");

/**
 * ImagePlugin component
 *
 * Registers the INSERT_IMAGE_COMMAND handler.
 * Does not render anything (returns null).
 */
export function ImagePlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!editor.hasNodes([ImageNode])) {
      throw new Error("ImagePlugin: ImageNode not registered on editor");
    }

    return editor.registerCommand(
      INSERT_IMAGE_COMMAND,
      payload => {
        const { src, altText, width, height } = payload;

        // Create and insert the image node
        const imageNode = $createImageNode({
          src,
          altText,
          width,
          height,
          maxWidth: 500,
        });

        $insertNodes([imageNode]);

        return true;
      },
      COMMAND_PRIORITY_EDITOR
    );
  }, [editor]);

  return null;
}
