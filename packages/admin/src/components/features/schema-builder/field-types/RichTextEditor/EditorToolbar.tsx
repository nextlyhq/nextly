/**
 * EditorToolbar Component
 *
 * Provides formatting buttons for the Lexical rich text editor.
 * Buttons toggle based on current selection state.
 *
 * Features:
 * - Bold, italic, underline, strikethrough
 * - Headings (H1-H6)
 * - Lists (ordered, unordered)
 * - Links
 * - Images (via MediaPickerDialog)
 * - Code blocks
 * - Blockquotes
 */

"use client";

import { $createCodeNode, $isCodeNode } from "@lexical/code";
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
  $isListNode,
  ListNode,
} from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  HeadingTagType,
} from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import { $getNearestNodeOfType, mergeRegister } from "@lexical/utils";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@revnixhq/ui";
import {
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  SELECTION_CHANGE_COMMAND,
  $createParagraphNode,
} from "lexical";
import { useCallback, useEffect, useState } from "react";

import { MediaPickerDialog } from "@admin/components/features/media-library/MediaPickerDialog";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Link as LinkIcon,
  Image as ImageIcon,
  Code,
  Quote,
} from "@admin/components/icons";
import type { Media } from "@admin/types/media";

import { INSERT_IMAGE_COMMAND } from "./ImagePlugin";

const blockTypeToBlockName = {
  code: "Code Block",
  h1: "Heading 1",
  h2: "Heading 2",
  h3: "Heading 3",
  h4: "Heading 4",
  h5: "Heading 5",
  h6: "Heading 6",
  paragraph: "Normal",
  quote: "Quote",
};

type BlockType = keyof typeof blockTypeToBlockName;

interface EditorToolbarProps {
  toolbarOptions?: {
    basic_formatting?: boolean;
    links?: boolean;
    lists?: boolean;
    images?: boolean;
    code_blocks?: boolean;
  };
}

export function EditorToolbar({ toolbarOptions }: EditorToolbarProps) {
  const [editor] = useLexicalComposerContext();
  const [activeFormats, setActiveFormats] = useState({
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    code: false,
  });
  const [blockType, setBlockType] = useState<BlockType>("paragraph");
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);

  // Default all toolbar options to true if not specified
  const options = {
    basic_formatting: toolbarOptions?.basic_formatting ?? true,
    links: toolbarOptions?.links ?? true,
    lists: toolbarOptions?.lists ?? true,
    images: toolbarOptions?.images ?? true,
    code_blocks: toolbarOptions?.code_blocks ?? true,
  };

  // Update active format state when selection changes
  const updateToolbar = useCallback(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      // Update text format states
      setActiveFormats({
        bold: selection.hasFormat("bold"),
        italic: selection.hasFormat("italic"),
        underline: selection.hasFormat("underline"),
        strikethrough: selection.hasFormat("strikethrough"),
        code: selection.hasFormat("code"),
      });

      // Update block type
      const anchorNode = selection.anchor.getNode();
      const element =
        anchorNode.getKey() === "root"
          ? anchorNode
          : anchorNode.getTopLevelElementOrThrow();
      const elementKey = element.getKey();
      const elementDOM = editor.getElementByKey(elementKey);

      if (elementDOM !== null) {
        if ($isListNode(element)) {
          // Lists aren't block types in our UI - keep current selection's paragraph type
          // This allows the dropdown to show what format the text would have outside the list
          // No-op: keep the current blockType
        } else {
          const type = $isHeadingNode(element)
            ? element.getTag()
            : element.getType();
          setBlockType(type as BlockType);
        }
      }
    }
  }, [editor]);

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          updateToolbar();
        });
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          updateToolbar();
          return false;
        },
        1
      )
    );
  }, [editor, updateToolbar]);

  // Format text (bold, italic, etc.)
  const formatText = (
    format: "bold" | "italic" | "underline" | "strikethrough" | "code"
  ) => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
  };

  // Change block type (heading, paragraph, etc.)
  const formatBlock = (type: BlockType) => {
    if (type === "paragraph") {
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          $setBlocksType(selection, () => $createParagraphNode());
        }
      });
    } else if (
      type === "h1" ||
      type === "h2" ||
      type === "h3" ||
      type === "h4" ||
      type === "h5" ||
      type === "h6"
    ) {
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          $setBlocksType(selection, () =>
            $createHeadingNode(type as HeadingTagType)
          );
        }
      });
    } else if (type === "quote") {
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          $setBlocksType(selection, () => $createQuoteNode());
        }
      });
    } else if (type === "code") {
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          $setBlocksType(selection, () => $createCodeNode());
        }
      });
    }
    setBlockType(type);
  };

  // Insert ordered list
  const insertOrderedList = () => {
    editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
  };

  // Insert unordered list
  const insertUnorderedList = () => {
    editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
  };

  // Insert image via MediaPickerDialog
  const handleImageSelect = (selectedMedia: Media[]) => {
    if (selectedMedia.length > 0) {
      const media = selectedMedia[0];
      editor.dispatchCommand(INSERT_IMAGE_COMMAND, {
        src: media.url,
        altText: media.altText || media.originalFilename,
        width: media.width ?? undefined,
        height: media.height ?? undefined,
      });
    }
    setMediaPickerOpen(false);
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-1 p-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
        {/* Block type selector */}
        <Select
          value={blockType}
          onValueChange={value => formatBlock(value as BlockType)}
        >
          <SelectTrigger className="w-[140px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="paragraph">Normal</SelectItem>
            <SelectItem value="h1">Heading 1</SelectItem>
            <SelectItem value="h2">Heading 2</SelectItem>
            <SelectItem value="h3">Heading 3</SelectItem>
            <SelectItem value="h4">Heading 4</SelectItem>
            <SelectItem value="h5">Heading 5</SelectItem>
            <SelectItem value="h6">Heading 6</SelectItem>
            {options.code_blocks && (
              <SelectItem value="code">Code Block</SelectItem>
            )}
            <SelectItem value="quote">Quote</SelectItem>
          </SelectContent>
        </Select>

        <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />

        {/* Basic formatting */}
        {options.basic_formatting && (
          <>
            <Button
              type="button"
              variant={activeFormats.bold ? "default" : "ghost"}
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => formatText("bold")}
              title="Bold (Cmd+B)"
              aria-label="Toggle bold formatting"
              aria-pressed={activeFormats.bold}
            >
              <Bold className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant={activeFormats.italic ? "default" : "ghost"}
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => formatText("italic")}
              title="Italic (Cmd+I)"
              aria-label="Toggle italic formatting"
              aria-pressed={activeFormats.italic}
            >
              <Italic className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant={activeFormats.underline ? "default" : "ghost"}
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => formatText("underline")}
              title="Underline (Cmd+U)"
              aria-label="Toggle underline formatting"
              aria-pressed={activeFormats.underline}
            >
              <Underline className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant={activeFormats.strikethrough ? "default" : "ghost"}
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => formatText("strikethrough")}
              title="Strikethrough"
              aria-label="Toggle strikethrough formatting"
              aria-pressed={activeFormats.strikethrough}
            >
              <Strikethrough className="h-4 w-4" aria-hidden="true" />
            </Button>

            <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />
          </>
        )}

        {/* Lists */}
        {options.lists && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={insertUnorderedList}
              title="Bullet List"
              aria-label="Insert bullet list"
            >
              <List className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={insertOrderedList}
              title="Numbered List"
              aria-label="Insert numbered list"
            >
              <ListOrdered className="h-4 w-4" aria-hidden="true" />
            </Button>

            <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />
          </>
        )}

        {/* Image */}
        {options.images && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setMediaPickerOpen(true)}
              title="Insert Image"
              aria-label="Insert image from media library"
            >
              <ImageIcon className="h-4 w-4" aria-hidden="true" />
            </Button>
            <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />
          </>
        )}

        {/* Code */}
        {options.code_blocks && (
          <Button
            type="button"
            variant={activeFormats.code ? "default" : "ghost"}
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => formatText("code")}
            title="Inline Code"
            aria-label="Toggle inline code formatting"
            aria-pressed={activeFormats.code}
          >
            <Code className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </div>

      {/* MediaPickerDialog */}
      {options.images && (
        <MediaPickerDialog
          mode="single"
          open={mediaPickerOpen}
          onOpenChange={setMediaPickerOpen}
          onSelect={handleImageSelect}
          accept="image/*"
          title="Select Image"
        />
      )}
    </>
  );
}
