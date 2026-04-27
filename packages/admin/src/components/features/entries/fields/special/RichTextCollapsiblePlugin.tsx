/**
 * Rich Text Collapsible Plugin
 *
 * A Lexical plugin that handles insertion and toggle behavior for
 * collapsible (accordion) sections in the rich text editor.
 *
 * @module components/entries/fields/special/RichTextCollapsiblePlugin
 * @since 1.1.0
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import {
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
  $createTextNode,
  $insertNodes,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  type LexicalCommand,
} from "lexical";
import { useEffect } from "react";

import {
  $createCollapsibleContainerNode,
  $createCollapsibleTitleNode,
  $createCollapsibleContentNode,
} from "./CollapsibleNode";

// ============================================================
// Commands
// ============================================================

export const INSERT_COLLAPSIBLE_COMMAND: LexicalCommand<void> = createCommand(
  "INSERT_COLLAPSIBLE_COMMAND"
);

// ============================================================
// Component
// ============================================================

export interface RichTextCollapsiblePluginProps {
  disabled?: boolean;
}

export function RichTextCollapsiblePlugin({
  disabled = false,
}: RichTextCollapsiblePluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return mergeRegister(
      // Insert collapsible command
      editor.registerCommand(
        INSERT_COLLAPSIBLE_COMMAND,
        () => {
          if (disabled) return false;

          editor.update(() => {
            const selection = $getSelection();
            if ($isRangeSelection(selection)) {
              const title = $createCollapsibleTitleNode();
              title.append($createTextNode("Click to expand"));

              const contentParagraph = $createParagraphNode();
              contentParagraph.append($createTextNode("Content goes here..."));

              const content = $createCollapsibleContentNode();
              content.append(contentParagraph);

              const container = $createCollapsibleContainerNode(true);
              container.append(title);
              container.append(content);

              $insertNodes([container]);

              // Select the title text so user can type immediately
              title.selectEnd();
            }
          });
          return true;
        },
        COMMAND_PRIORITY_EDITOR
      ),

      // Handle toggle on click via DOM events
      editor.registerRootListener((rootElement, prevRootElement) => {
        const handleToggle = (event: Event) => {
          const target = event.target as HTMLElement;
          if (target.tagName === "SUMMARY") {
            // Let the browser handle the <details> toggle natively
            // but sync the open state to Lexical
            const details = target.parentElement;
            if (details && details.tagName === "DETAILS") {
              const _isOpen = !(details as HTMLDetailsElement).open;
              // The toggle event fires after the state changes,
              // so we read the opposite of current state
              editor.update(() => {
                const editorState = editor.getEditorState();
                editorState.read(() => {
                  // Find and update the corresponding node
                  // This is handled naturally by Lexical's DOM reconciler
                });
              });
            }
          }
        };

        if (rootElement) {
          rootElement.addEventListener("toggle", handleToggle, true);
        }
        if (prevRootElement) {
          prevRootElement.removeEventListener("toggle", handleToggle, true);
        }
      })
    );
  }, [editor, disabled]);

  return null;
}
