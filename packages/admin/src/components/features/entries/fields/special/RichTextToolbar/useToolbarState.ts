/**
 * Toolbar State Hook
 *
 * Manages all state, editor listeners, and command handlers for the rich text toolbar.
 * Extracted from RichTextToolbar to keep the component focused on rendering.
 *
 * @module components/entries/fields/special/RichTextToolbar/useToolbarState
 * @since 1.0.0
 */

import { $createCodeNode, $isCodeNode } from "@lexical/code";
import { $isLinkNode } from "@lexical/link";
import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
  $isListNode,
  ListNode,
} from "@lexical/list";
import { INSERT_HORIZONTAL_RULE_COMMAND } from "@lexical/react/LexicalHorizontalRuleNode";
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  type HeadingTagType,
} from "@lexical/rich-text";
import {
  $getSelectionStyleValueForProperty,
  $patchStyleText,
  $setBlocksType,
} from "@lexical/selection";
import {
  $findMatchingParent,
  $getNearestNodeOfType,
  mergeRegister,
} from "@lexical/utils";
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  $isElementNode,
  FORMAT_TEXT_COMMAND,
  FORMAT_ELEMENT_COMMAND,
  CAN_UNDO_COMMAND,
  CAN_REDO_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  type LexicalEditor,
  type TextFormatType,
  type ElementFormatType,
} from "lexical";
import { useCallback, useEffect, useRef, useState } from "react";

import { OPEN_BUTTON_GROUP_DIALOG_COMMAND } from "../RichTextButtonGroupPlugin";
import { OPEN_BUTTON_LINK_DIALOG_COMMAND } from "../RichTextButtonLinkPlugin";
import { INSERT_COLLAPSIBLE_COMMAND } from "../RichTextCollapsiblePlugin";
import { OPEN_GALLERY_DIALOG_COMMAND } from "../RichTextGalleryPlugin";
import { OPEN_LINK_DIALOG_COMMAND } from "../RichTextLinkPlugin";
import { OPEN_IMAGE_DIALOG_COMMAND } from "../RichTextMediaPlugin";
import { OPEN_TABLE_DIALOG_COMMAND } from "../RichTextTablePlugin";
import { OPEN_VIDEO_DIALOG_COMMAND } from "../RichTextVideoPlugin";

// ============================================================
// Hook
// ============================================================

export function useToolbarState(editor: LexicalEditor, features: string[]) {
  // Active format state
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [isStrikethrough, setIsStrikethrough] = useState(false);
  const [isCode, setIsCode] = useState(false);
  const [isHighlight, setIsHighlight] = useState(false);
  const [isLink, setIsLink] = useState(false);

  // Block type state
  const [blockType, setBlockType] = useState<string>("paragraph");

  // Alignment state
  const [elementFormat, setElementFormat] = useState<string>("left");

  // Text style state
  const [fontFamily, setFontFamily] = useState("");
  const [fontSize, setFontSize] = useState("");
  const [fontColor, setFontColor] = useState("#000000");
  const [bgColor, setBgColor] = useState("#ffffff");
  const fontColorRef = useRef<HTMLInputElement>(null);
  const bgColorRef = useRef<HTMLInputElement>(null);

  // History state
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Check if a feature is enabled
  const hasFeature = useCallback(
    (feature: string) => {
      if (features.length === 0) return true;
      return features.includes(feature);
    },
    [features]
  );

  // Update toolbar state based on editor selection
  const updateToolbar = useCallback(() => {
    const selection = $getSelection();

    if ($isRangeSelection(selection)) {
      // Update text format states
      setIsBold(selection.hasFormat("bold"));
      setIsItalic(selection.hasFormat("italic"));
      setIsUnderline(selection.hasFormat("underline"));
      setIsStrikethrough(selection.hasFormat("strikethrough"));
      setIsCode(selection.hasFormat("code"));
      setIsHighlight(selection.hasFormat("highlight"));

      // Update text style states
      setFontFamily(
        $getSelectionStyleValueForProperty(selection, "font-family", "")
      );
      setFontSize(
        $getSelectionStyleValueForProperty(selection, "font-size", "")
      );
      setFontColor(
        $getSelectionStyleValueForProperty(selection, "color", "#000000")
      );
      setBgColor(
        $getSelectionStyleValueForProperty(
          selection,
          "background-color",
          "#ffffff"
        )
      );

      // Check for link
      const node = selection.anchor.getNode();
      const parent = node.getParent();
      setIsLink($isLinkNode(parent) || $isLinkNode(node));

      // Check block type
      const anchorNode = selection.anchor.getNode();
      let element =
        anchorNode.getKey() === "root"
          ? anchorNode
          : $findMatchingParent(anchorNode, e => {
              const p = e.getParent();
              return p !== null && p.getKey() === "root";
            });

      if (element === null) {
        element = anchorNode.getTopLevelElementOrThrow();
      }

      const elementKey = element.getKey();
      const elementDOM = editor.getElementByKey(elementKey);

      if (elementDOM !== null) {
        // Check for list
        if ($isListNode(element)) {
          const parentList = $getNearestNodeOfType<ListNode>(
            anchorNode,
            ListNode
          );
          const type = parentList
            ? parentList.getListType()
            : element.getListType();
          setBlockType(
            type === "check" ? "check" : type === "bullet" ? "ul" : "ol"
          );
        } else if ($isCodeNode(element)) {
          setBlockType("code");
        } else {
          const type = $isHeadingNode(element)
            ? element.getTag()
            : element.getType();
          setBlockType(type);
        }

        // Check alignment
        if ($isElementNode(element)) {
          const format = element.getFormatType();
          setElementFormat(format || "left");
        }
      }
    }
  }, [editor]);

  // Register update listener
  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          updateToolbar();
        });
      }),
      editor.registerCommand(
        CAN_UNDO_COMMAND,
        payload => {
          setCanUndo(payload);
          return false;
        },
        COMMAND_PRIORITY_CRITICAL
      ),
      editor.registerCommand(
        CAN_REDO_COMMAND,
        payload => {
          setCanRedo(payload);
          return false;
        },
        COMMAND_PRIORITY_CRITICAL
      )
    );
  }, [editor, updateToolbar]);

  // ============================================================
  // Handlers
  // ============================================================

  const formatText = useCallback(
    (format: TextFormatType) => {
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
    },
    [editor]
  );

  const formatHeading = useCallback(
    (headingType: HeadingTagType) => {
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          if (blockType === headingType) {
            $setBlocksType(selection, () => $createParagraphNode());
          } else {
            $setBlocksType(selection, () => $createHeadingNode(headingType));
          }
        }
      });
    },
    [editor, blockType]
  );

  const formatCodeBlock = useCallback(() => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        if (blockType === "code") {
          $setBlocksType(selection, () => $createParagraphNode());
        } else {
          $setBlocksType(selection, () => $createCodeNode());
        }
      }
    });
  }, [editor, blockType]);

  const formatList = useCallback(
    (type: "bullet" | "number" | "check") => {
      const currentType =
        blockType === "ul"
          ? "bullet"
          : blockType === "ol"
            ? "number"
            : blockType === "check"
              ? "check"
              : null;

      if (currentType === type) {
        editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
      } else {
        if (type === "bullet") {
          editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
        } else if (type === "number") {
          editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
        } else {
          editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined);
        }
      }
    },
    [editor, blockType]
  );

  const formatQuote = useCallback(() => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        if (blockType === "quote") {
          $setBlocksType(selection, () => $createParagraphNode());
        } else {
          $setBlocksType(selection, () => $createQuoteNode());
        }
      }
    });
  }, [editor, blockType]);

  const formatParagraph = useCallback(() => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        if (blockType !== "paragraph") {
          $setBlocksType(selection, () => $createParagraphNode());
        }
      }
    });
  }, [editor, blockType]);

  const formatAlignment = useCallback(
    (alignment: ElementFormatType) => {
      editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, alignment);
    },
    [editor]
  );

  const insertHorizontalRule = useCallback(() => {
    editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined);
  }, [editor]);

  const toggleLink = useCallback(() => {
    editor.dispatchCommand(OPEN_LINK_DIALOG_COMMAND, undefined);
  }, [editor]);

  const insertImage = useCallback(() => {
    editor.dispatchCommand(OPEN_IMAGE_DIALOG_COMMAND, undefined);
  }, [editor]);

  const insertVideo = useCallback(() => {
    editor.dispatchCommand(OPEN_VIDEO_DIALOG_COMMAND, undefined);
  }, [editor]);

  const insertButtonLink = useCallback(() => {
    editor.dispatchCommand(OPEN_BUTTON_LINK_DIALOG_COMMAND, undefined);
  }, [editor]);

  const insertTable = useCallback(() => {
    editor.dispatchCommand(OPEN_TABLE_DIALOG_COMMAND, undefined);
  }, [editor]);

  const insertCollapsible = useCallback(() => {
    editor.dispatchCommand(INSERT_COLLAPSIBLE_COMMAND, undefined);
  }, [editor]);

  const insertButtonGroup = useCallback(() => {
    editor.dispatchCommand(OPEN_BUTTON_GROUP_DIALOG_COMMAND, undefined);
  }, [editor]);

  const insertGallery = useCallback(() => {
    editor.dispatchCommand(OPEN_GALLERY_DIALOG_COMMAND, undefined);
  }, [editor]);

  const applyFontFamily = useCallback(
    (family: string) => {
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          $patchStyleText(selection, { "font-family": family || null });
        }
      });
    },
    [editor]
  );

  const applyFontSize = useCallback(
    (size: string) => {
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          $patchStyleText(selection, { "font-size": size || null });
        }
      });
    },
    [editor]
  );

  const applyFontColor = useCallback(
    (color: string) => {
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          $patchStyleText(selection, { color });
        }
      });
    },
    [editor]
  );

  const applyBgColor = useCallback(
    (color: string) => {
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          $patchStyleText(selection, { "background-color": color });
        }
      });
    },
    [editor]
  );

  const clearFormatting = useCallback(() => {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        const formats: TextFormatType[] = [
          "bold",
          "italic",
          "underline",
          "strikethrough",
          "code",
          "highlight",
          "subscript",
          "superscript",
        ];

        selection.format = 0;

        if (!selection.isCollapsed()) {
          formats.forEach(format => {
            if (selection.hasFormat(format)) {
              selection.toggleFormat(format);
            }
          });
        }

        $patchStyleText(selection, {
          "font-family": null,
          "font-size": null,
          color: null,
          "background-color": null,
        });
      }
    });
  }, [editor]);

  // ============================================================
  // Feature flags
  // ============================================================

  const hasBlockType =
    hasFeature("h2") ||
    hasFeature("h3") ||
    hasFeature("h4") ||
    hasFeature("h5") ||
    hasFeature("h6") ||
    hasFeature("unorderedList") ||
    hasFeature("orderedList") ||
    hasFeature("checklist") ||
    hasFeature("blockquote") ||
    hasFeature("codeBlock");

  const hasFontSelects = hasFeature("fontFamily") || hasFeature("fontSize");

  const hasTextFormatting =
    hasFeature("bold") ||
    hasFeature("italic") ||
    hasFeature("underline") ||
    hasFeature("fontColor") ||
    hasFeature("bgColor");

  const hasMoreFormatting =
    hasFeature("strikethrough") ||
    hasFeature("code") ||
    hasFeature("highlight") ||
    hasFeature("horizontalRule");

  const hasAlignment = hasFeature("align");

  const hasMedia =
    hasFeature("link") ||
    hasFeature("upload") ||
    hasFeature("video") ||
    hasFeature("buttonLink") ||
    hasFeature("buttonGroup") ||
    hasFeature("table") ||
    hasFeature("collapsible") ||
    hasFeature("gallery");

  return {
    // State
    isBold,
    isItalic,
    isUnderline,
    isStrikethrough,
    isCode,
    isHighlight,
    isLink,
    blockType,
    elementFormat,
    fontFamily,
    fontSize,
    fontColor,
    bgColor,
    fontColorRef,
    bgColorRef,
    canUndo,
    canRedo,
    // Handlers
    hasFeature,
    formatText,
    formatHeading,
    formatCodeBlock,
    formatList,
    formatQuote,
    formatParagraph,
    formatAlignment,
    insertHorizontalRule,
    toggleLink,
    insertImage,
    insertVideo,
    insertButtonLink,
    insertTable,
    insertCollapsible,
    insertButtonGroup,
    insertGallery,
    applyFontFamily,
    applyFontSize,
    applyFontColor,
    applyBgColor,
    clearFormatting,
    // Feature flags
    hasBlockType,
    hasFontSelects,
    hasTextFormatting,
    hasMoreFormatting,
    hasAlignment,
    hasMedia,
  };
}
