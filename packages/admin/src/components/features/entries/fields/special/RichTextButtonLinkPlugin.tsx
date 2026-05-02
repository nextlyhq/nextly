"use client";

/**
 * Rich Text Button Link Plugin
 *
 * A Lexical plugin that provides a dialog-based interface for inserting
 * styled button links into the rich text editor.
 *
 * @module components/entries/fields/special/RichTextButtonLinkPlugin
 * @since 1.1.0
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@revnixhq/ui";
import {
  $getSelection,
  $isRangeSelection,
  $insertNodes,
  $getNodeByKey,
  $getRoot,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  type LexicalCommand,
  type NodeKey,
} from "lexical";
import { useState, useCallback, useEffect } from "react";

import {
  MousePointerClick,
  AlertCircle,
  AlignLeft,
  AlignCenter,
  AlignRight,
} from "@admin/components/icons";

import {
  $createButtonLinkNode,
  $isButtonLinkNode,
  type ButtonLinkPayload,
  type ButtonLinkVariant,
  type ButtonLinkSize,
  type ButtonAlignment,
} from "./ButtonLinkNode";

// ============================================================
// Commands
// ============================================================

export const OPEN_BUTTON_LINK_DIALOG_COMMAND: LexicalCommand<void> =
  createCommand("OPEN_BUTTON_LINK_DIALOG_COMMAND");

export const INSERT_BUTTON_LINK_COMMAND: LexicalCommand<ButtonLinkPayload> =
  createCommand("INSERT_BUTTON_LINK_COMMAND");

// ============================================================
// Component
// ============================================================

export interface RichTextButtonLinkPluginProps {
  disabled?: boolean;
}

export function RichTextButtonLinkPlugin({
  disabled = false,
}: RichTextButtonLinkPluginProps) {
  const [editor] = useLexicalComposerContext();
  const [isOpen, setIsOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [openInNewTab, setOpenInNewTab] = useState(true);
  const [variant, setVariant] = useState<ButtonLinkVariant>("filled");
  const [size, setSize] = useState<ButtonLinkSize>("md");
  const [bgColor, setBgColor] = useState("#000000");
  const [textColor, setTextColor] = useState("#ffffff");
  const [alignment, setAlignment] = useState<ButtonAlignment>("center");
  const [error, setError] = useState<string | null>(null);
  const [editingNodeKey, setEditingNodeKey] = useState<NodeKey | null>(null);

  const resetState = useCallback(() => {
    setUrl("");
    setText("");
    setOpenInNewTab(true);
    setVariant("filled");
    setSize("md");
    setBgColor("#000000");
    setTextColor("#ffffff");
    setAlignment("center");
    setError(null);
    setEditingNodeKey(null);
  }, []);

  const openDialog = useCallback(() => {
    if (disabled) return;
    resetState();
    setIsOpen(true);
  }, [disabled, resetState]);

  const isValidUrl = useCallback((url: string): boolean => {
    if (!url.trim()) return false;
    // Allow relative URLs starting with /
    if (url.startsWith("/")) return true;
    try {
      const parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }, []);

  const insertButtonLink = useCallback(() => {
    if (!text.trim()) {
      setError("Please enter button text");
      return;
    }

    if (!url.trim()) {
      setError("Please enter a URL");
      return;
    }

    if (!isValidUrl(url)) {
      setError("Please enter a valid URL");
      return;
    }

    // Normalize URL
    let normalizedUrl = url.trim();
    if (
      !normalizedUrl.startsWith("/") &&
      !normalizedUrl.startsWith("http://") &&
      !normalizedUrl.startsWith("https://")
    ) {
      normalizedUrl = `https://${normalizedUrl}`;
    }

    editor.update(() => {
      if (editingNodeKey) {
        // Update existing node
        const node = $getNodeByKey(editingNodeKey);
        if (node && $isButtonLinkNode(node)) {
          const newNode = $createButtonLinkNode({
            url: normalizedUrl,
            text: text.trim(),
            target: openInNewTab ? "_blank" : undefined,
            variant,
            size,
            bgColor: variant === "filled" ? bgColor : undefined,
            textColor,
            alignment,
          });
          node.replace(newNode);
        }
      } else {
        // Insert new node
        const buttonNode = $createButtonLinkNode({
          url: normalizedUrl,
          text: text.trim(),
          target: openInNewTab ? "_blank" : undefined,
          variant,
          size,
          bgColor: variant === "filled" ? bgColor : undefined,
          textColor,
          alignment,
        });

        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          $insertNodes([buttonNode]);
        } else {
          // If no selection, append to the end of the root
          const root = $getRoot();
          root.append(buttonNode);
        }
      }
    });

    setIsOpen(false);
    resetState();
  }, [
    editor,
    url,
    text,
    openInNewTab,
    variant,
    size,
    bgColor,
    textColor,
    alignment,
    isValidUrl,
    resetState,
    editingNodeKey,
  ]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        resetState();
      }
      setIsOpen(open);
    },
    [resetState]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        insertButtonLink();
      }
    },
    [insertButtonLink]
  );

  // Register commands
  useEffect(() => {
    return editor.registerCommand(
      OPEN_BUTTON_LINK_DIALOG_COMMAND,
      () => {
        openDialog();
        return true;
      },
      COMMAND_PRIORITY_EDITOR
    );
  }, [editor, openDialog]);

  useEffect(() => {
    return editor.registerCommand(
      INSERT_BUTTON_LINK_COMMAND,
      payload => {
        editor.update(() => {
          const buttonNode = $createButtonLinkNode(payload);
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            $insertNodes([buttonNode]);
          }
        });
        return true;
      },
      COMMAND_PRIORITY_EDITOR
    );
  }, [editor]);

  // Listen for edit events from ButtonLinkNode
  useEffect(() => {
    const handleEditEvent = (event: Event) => {
      const customEvent = event as CustomEvent;
      const {
        nodeKey,
        url: editUrl,
        text: editText,
        target: editTarget,
        variant: editVariant,
        size: editSize,
        bgColor: editBgColor,
        textColor: editTextColor,
        alignment: editAlignment,
      } = customEvent.detail;

      setEditingNodeKey(nodeKey);
      setUrl(editUrl);
      setText(editText);
      setOpenInNewTab(editTarget === "_blank");
      setVariant(editVariant);
      setSize(editSize);
      setBgColor(editBgColor || "#000000");
      setTextColor(editTextColor || "#ffffff");
      setAlignment(editAlignment || "center");
      setIsOpen(true);
    };

    window.addEventListener("edit-button-link", handleEditEvent);
    return () => {
      window.removeEventListener("edit-button-link", handleEditEvent);
    };
  }, []);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MousePointerClick className="h-5 w-5" />
            {editingNodeKey ? "Edit Button Link" : "Insert Button Link"}
          </DialogTitle>
          <DialogDescription>
            {editingNodeKey
              ? "Update the properties of your button link."
              : "Create a styled button that links to a URL."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Button Text */}
          <div className="space-y-2">
            <Label htmlFor="button-text">Button Text</Label>
            <Input
              id="button-text"
              type="text"
              placeholder="Click here"
              value={text}
              onChange={e => {
                setText(e.target.value);
                setError(null);
              }}
              disabled={disabled}
              autoFocus
            />
          </div>

          {/* URL Input */}
          <div className="space-y-2">
            <Label htmlFor="button-url">URL</Label>
            <Input
              id="button-url"
              type="url"
              placeholder="https://example.com or /page"
              value={url}
              onChange={e => {
                setUrl(e.target.value);
                setError(null);
              }}
              disabled={disabled}
            />
          </div>

          {/* Style & Size */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Style</Label>
              <Select
                value={variant}
                onValueChange={v => setVariant(v as ButtonLinkVariant)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="filled">Filled</SelectItem>
                  <SelectItem value="outline">Outline</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Size</Label>
              <Select
                value={size}
                onValueChange={v => setSize(v as ButtonLinkSize)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sm">Small</SelectItem>
                  <SelectItem value="md">Medium</SelectItem>
                  <SelectItem value="lg">Large</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Alignment */}
          <div className="space-y-2">
            <Label>Alignment</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={alignment === "left" ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => setAlignment("left")}
              >
                <AlignLeft className="h-4 w-4 mr-2" />
                Left
              </Button>
              <Button
                type="button"
                variant={alignment === "center" ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => setAlignment("center")}
              >
                <AlignCenter className="h-4 w-4 mr-2" />
                Center
              </Button>
              <Button
                type="button"
                variant={alignment === "right" ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => setAlignment("right")}
              >
                <AlignRight className="h-4 w-4 mr-2" />
                Right
              </Button>
            </div>
          </div>

          {/* Colors */}
          <div className="grid grid-cols-2 gap-4">
            {variant === "filled" && (
              <div className="space-y-2">
                <Label htmlFor="button-bg-color">Background Color</Label>
                <div className="flex items-center gap-2">
                  <input
                    id="button-bg-color"
                    type="color"
                    value={bgColor}
                    onChange={e => setBgColor(e.target.value)}
                    className="h-9 w-9 rounded-none border border-input cursor-pointer p-0.5"
                  />
                  <Input
                    value={bgColor}
                    onChange={e => setBgColor(e.target.value)}
                    className="flex-1"
                    placeholder="#000000"
                  />
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="button-text-color">Text Color</Label>
              <div className="flex items-center gap-2">
                <input
                  id="button-text-color"
                  type="color"
                  value={textColor}
                  onChange={e => setTextColor(e.target.value)}
                  className="h-9 w-9 rounded-none border border-input cursor-pointer p-0.5"
                />
                <Input
                  value={textColor}
                  onChange={e => setTextColor(e.target.value)}
                  className="flex-1"
                  placeholder="#ffffff"
                />
              </div>
            </div>
          </div>

          {/* Open in new tab */}
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={openInNewTab}
              onCheckedChange={checked => setOpenInNewTab(checked === true)}
            />
            <span className="text-sm">Open in new tab</span>
          </label>

          {/* Preview */}
          {text.trim() && (
            <div className="p-4 rounded-none bg-primary/5">
              <p className="text-xs text-muted-foreground mb-2">Preview:</p>
              <div className="flex justify-center">
                <span
                  className={`inline-flex items-center justify-center rounded-none font-medium transition-colors ${
                    variant === "outline"
                      ? "border border-input bg-background"
                      : ""
                  } ${
                    size === "sm"
                      ? "px-3 py-1.5 text-sm"
                      : size === "lg"
                        ? "px-6 py-3 text-base"
                        : "px-4 py-2 text-sm"
                  }`}
                  style={{
                    ...(variant === "filled" && {
                      backgroundColor: bgColor,
                      color: textColor,
                    }),
                    ...(variant === "outline" && {
                      color: textColor,
                      borderColor: textColor,
                    }),
                  }}
                >
                  {text}
                </span>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={insertButtonLink}
            disabled={!text.trim() || !url.trim()}
          >
            {editingNodeKey ? "Update Button" : "Insert Button"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
