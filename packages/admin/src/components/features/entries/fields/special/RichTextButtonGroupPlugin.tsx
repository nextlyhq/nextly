"use client";

/**
 * Rich Text Button Group Plugin
 *
 * A Lexical plugin that provides a dialog for inserting a group of
 * styled button links displayed side-by-side.
 *
 * @module components/entries/fields/special/RichTextButtonGroupPlugin
 * @since 1.2.0
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
  AlertCircle,
  Plus,
  Trash2,
  AlignLeft,
  AlignCenter,
  AlignRight,
} from "@admin/components/icons";

import {
  $createButtonGroupNode,
  $isButtonGroupNode,
  type ButtonGroupItem,
  type ButtonGroupPayload,
  type ButtonAlignment,
} from "./ButtonGroupNode";
import type { ButtonLinkSize, ButtonLinkVariant } from "./ButtonLinkNode";

// ============================================================
// Commands
// ============================================================

export const OPEN_BUTTON_GROUP_DIALOG_COMMAND: LexicalCommand<void> =
  createCommand("OPEN_BUTTON_GROUP_DIALOG_COMMAND");

export const INSERT_BUTTON_GROUP_COMMAND: LexicalCommand<ButtonGroupPayload> =
  createCommand("INSERT_BUTTON_GROUP_COMMAND");

// ============================================================
// Default Button
// ============================================================

interface DialogButton extends ButtonGroupItem {
  openInNewTab: boolean;
}

function createDefaultButton(): DialogButton {
  return {
    url: "",
    text: "",
    variant: "filled",
    size: "md",
    bgColor: "#000000",
    textColor: "#ffffff",
    openInNewTab: true,
  };
}

// ============================================================
// Component
// ============================================================

export interface RichTextButtonGroupPluginProps {
  disabled?: boolean;
}

export function RichTextButtonGroupPlugin({
  disabled = false,
}: RichTextButtonGroupPluginProps) {
  const [editor] = useLexicalComposerContext();
  const [isOpen, setIsOpen] = useState(false);
  const [buttons, setButtons] = useState<DialogButton[]>([
    createDefaultButton(),
    createDefaultButton(),
  ]);
  const [alignment, setAlignment] = useState<ButtonAlignment>("center");
  const [error, setError] = useState<string | null>(null);
  const [editingNodeKey, setEditingNodeKey] = useState<NodeKey | null>(null);

  const resetState = useCallback(() => {
    setButtons([createDefaultButton(), createDefaultButton()]);
    setAlignment("center");
    setError(null);
    setEditingNodeKey(null);
  }, []);

  const openDialog = useCallback(() => {
    if (disabled) return;
    resetState();
    setIsOpen(true);
  }, [disabled, resetState]);

  const updateButton = useCallback(
    (index: number, updates: Partial<DialogButton>) => {
      setButtons(prev =>
        prev.map((btn, i) => (i === index ? { ...btn, ...updates } : btn))
      );
      setError(null);
    },
    []
  );

  const addButton = useCallback(() => {
    if (buttons.length >= 4) return;
    setButtons(prev => [...prev, createDefaultButton()]);
  }, [buttons.length]);

  const removeButton = useCallback(
    (index: number) => {
      if (buttons.length <= 1) return;
      setButtons(prev => prev.filter((_, i) => i !== index));
    },
    [buttons.length]
  );

  const isValidUrl = useCallback((url: string): boolean => {
    if (!url.trim()) return false;

    // Allow relative URLs
    if (url.startsWith("/")) return true;

    // Allow common URI schemes: http, https, mailto, tel, sms, etc.
    if (url.match(/^(https?|mailto|tel|sms|ftp|ftps):/i)) return true;

    // Allow URLs without protocol (will be prefixed with https://)
    try {
      new URL(`https://${url}`);
      return true;
    } catch {
      return false;
    }
  }, []);

  const insertButtonGroup = useCallback(() => {
    // Validate all buttons
    for (let i = 0; i < buttons.length; i++) {
      if (!buttons[i].text.trim()) {
        setError(`Button ${i + 1}: Please enter button text`);
        return;
      }
      if (!buttons[i].url.trim()) {
        setError(`Button ${i + 1}: Please enter a URL`);
        return;
      }
      if (!isValidUrl(buttons[i].url)) {
        setError(`Button ${i + 1}: Please enter a valid URL`);
        return;
      }
    }

    const normalizedButtons = buttons.map(btn => {
      let normalizedUrl = btn.url.trim();

      // Don't modify URLs that already have a protocol/scheme
      if (
        !normalizedUrl.startsWith("/") &&
        !normalizedUrl.match(/^(https?|mailto|tel|sms|ftp|ftps):/i)
      ) {
        // Auto-prefix with https:// only for web URLs
        normalizedUrl = `https://${normalizedUrl}`;
      }

      return {
        url: normalizedUrl,
        text: btn.text.trim(),
        target: btn.openInNewTab ? "_blank" : undefined,
        variant: btn.variant,
        size: btn.size,
        bgColor: btn.variant === "filled" ? btn.bgColor : undefined,
        textColor: btn.textColor,
      };
    });

    editor.update(() => {
      if (editingNodeKey) {
        // Update existing node
        const node = $getNodeByKey(editingNodeKey);
        if (node && $isButtonGroupNode(node)) {
          const newNode = $createButtonGroupNode({
            buttons: normalizedButtons,
            alignment,
          });
          node.replace(newNode);
        }
      } else {
        // Insert new node
        const groupNode = $createButtonGroupNode({
          buttons: normalizedButtons,
          alignment,
        });

        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          $insertNodes([groupNode]);
        } else {
          // If no selection, append to the end of the root
          const root = $getRoot();
          root.append(groupNode);
        }
      }
    });

    setIsOpen(false);
    resetState();
  }, [editor, buttons, alignment, isValidUrl, resetState, editingNodeKey]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        resetState();
      }
      setIsOpen(open);
    },
    [resetState]
  );

  // Register commands
  useEffect(() => {
    return editor.registerCommand(
      OPEN_BUTTON_GROUP_DIALOG_COMMAND,
      () => {
        openDialog();
        return true;
      },
      COMMAND_PRIORITY_EDITOR
    );
  }, [editor, openDialog]);

  useEffect(() => {
    return editor.registerCommand(
      INSERT_BUTTON_GROUP_COMMAND,
      payload => {
        editor.update(() => {
          const groupNode = $createButtonGroupNode(payload);
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            $insertNodes([groupNode]);
          }
        });
        return true;
      },
      COMMAND_PRIORITY_EDITOR
    );
  }, [editor]);

  // Listen for edit events from ButtonGroupNode
  useEffect(() => {
    const handleEditEvent = (event: Event) => {
      const customEvent = event as CustomEvent;
      const {
        nodeKey,
        buttons: editButtons,
        alignment: editAlignment,
      } = customEvent.detail;

      // Convert ButtonGroupItem[] to DialogButton[]
      const dialogButtons: DialogButton[] = editButtons.map(
        (btn: ButtonGroupItem) => ({
          ...btn,
          openInNewTab: btn.target === "_blank",
          bgColor: btn.bgColor || "#000000",
          textColor: btn.textColor || "#ffffff",
        })
      );

      setEditingNodeKey(nodeKey);
      setButtons(dialogButtons);
      setAlignment(editAlignment || "center");
      setIsOpen(true);
    };

    window.addEventListener("edit-button-group", handleEditEvent);
    return () => {
      window.removeEventListener("edit-button-group", handleEditEvent);
    };
  }, []);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editingNodeKey ? "Edit Button Group" : "Insert Button Group"}
          </DialogTitle>
          <DialogDescription>
            {editingNodeKey
              ? "Update the buttons in your button group."
              : "Create a group of buttons displayed side-by-side."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Alignment Controls */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">
              Button Group Alignment
            </Label>
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

          {/* Individual Button Settings */}
          {buttons.map((button, index) => (
            <div key={index} className="space-y-3 p-3 rounded-md border">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">
                  Button {index + 1}
                </Label>
                {buttons.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => removeButton(index)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Text</Label>
                  <Input
                    placeholder="Click here"
                    value={button.text}
                    onChange={e =>
                      updateButton(index, { text: e.target.value })
                    }
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">URL</Label>
                  <Input
                    placeholder="https://example.com"
                    value={button.url}
                    onChange={e => updateButton(index, { url: e.target.value })}
                    disabled={disabled}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Style</Label>
                  <Select
                    value={button.variant}
                    onValueChange={v =>
                      updateButton(index, {
                        variant: v as ButtonLinkVariant,
                      })
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="filled">Filled</SelectItem>
                      <SelectItem value="outline">Outline</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Size</Label>
                  <Select
                    value={button.size}
                    onValueChange={v =>
                      updateButton(index, { size: v as ButtonLinkSize })
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sm">Small</SelectItem>
                      <SelectItem value="md">Medium</SelectItem>
                      <SelectItem value="lg">Large</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Colors</Label>
                  <div className="flex items-center gap-1.5">
                    {button.variant === "filled" && (
                      <input
                        type="color"
                        value={button.bgColor || "#000000"}
                        onChange={e =>
                          updateButton(index, { bgColor: e.target.value })
                        }
                        className="h-8 w-8 rounded border border-input cursor-pointer p-0.5"
                        title="Background color"
                      />
                    )}
                    <input
                      type="color"
                      value={button.textColor || "#ffffff"}
                      onChange={e =>
                        updateButton(index, { textColor: e.target.value })
                      }
                      className="h-8 w-8 rounded border border-input cursor-pointer p-0.5"
                      title="Text color"
                    />
                  </div>
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={button.openInNewTab}
                  onCheckedChange={checked =>
                    updateButton(index, { openInNewTab: checked === true })
                  }
                />
                <span className="text-xs">Open in new tab</span>
              </label>
            </div>
          ))}

          {buttons.length < 4 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={addButton}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Button
            </Button>
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
          <Button type="button" onClick={insertButtonGroup}>
            {editingNodeKey ? "Update Button Group" : "Insert Button Group"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
