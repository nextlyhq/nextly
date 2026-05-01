"use client";

/**
 * Rich Text Table Plugin
 *
 * A Lexical plugin that provides a dialog-based interface for inserting
 * tables into the rich text editor. Uses @lexical/table for table support.
 *
 * @module components/entries/fields/special/RichTextTablePlugin
 * @since 1.1.0
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { INSERT_TABLE_COMMAND } from "@lexical/table";
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
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  type LexicalCommand,
} from "lexical";
import { useState, useCallback, useEffect } from "react";

import { Table, AlertCircle } from "@admin/components/icons";

// ============================================================
// Commands
// ============================================================

export const OPEN_TABLE_DIALOG_COMMAND: LexicalCommand<void> = createCommand(
  "OPEN_TABLE_DIALOG_COMMAND"
);

// ============================================================
// Component
// ============================================================

export interface RichTextTablePluginProps {
  disabled?: boolean;
}

export function RichTextTablePlugin({
  disabled = false,
}: RichTextTablePluginProps) {
  const [editor] = useLexicalComposerContext();
  const [isOpen, setIsOpen] = useState(false);
  const [rows, setRows] = useState("3");
  const [columns, setColumns] = useState("3");
  const [includeHeaders, setIncludeHeaders] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const resetState = useCallback(() => {
    setRows("3");
    setColumns("3");
    setIncludeHeaders(true);
    setError(null);
  }, []);

  const openDialog = useCallback(() => {
    if (disabled) return;
    resetState();
    setIsOpen(true);
  }, [disabled, resetState]);

  const insertTable = useCallback(() => {
    const rowCount = parseInt(rows, 10);
    const colCount = parseInt(columns, 10);

    if (isNaN(rowCount) || rowCount < 1 || rowCount > 20) {
      setError("Rows must be between 1 and 20");
      return;
    }

    if (isNaN(colCount) || colCount < 1 || colCount > 10) {
      setError("Columns must be between 1 and 10");
      return;
    }

    editor.dispatchCommand(INSERT_TABLE_COMMAND, {
      rows: String(rowCount),
      columns: String(colCount),
      includeHeaders,
    });

    setIsOpen(false);
    resetState();
  }, [editor, rows, columns, includeHeaders, resetState]);

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
        insertTable();
      }
    },
    [insertTable]
  );

  // Register command
  useEffect(() => {
    return editor.registerCommand(
      OPEN_TABLE_DIALOG_COMMAND,
      () => {
        openDialog();
        return true;
      },
      COMMAND_PRIORITY_EDITOR
    );
  }, [editor, openDialog]);

  // Preview grid
  const previewRows = Math.min(parseInt(rows, 10) || 3, 6);
  const previewCols = Math.min(parseInt(columns, 10) || 3, 6);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Table className="h-5 w-5" />
            Insert Table
          </DialogTitle>
          <DialogDescription>
            Choose the number of rows and columns for your table.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Row & Column inputs */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="table-rows">Rows</Label>
              <Input
                id="table-rows"
                type="number"
                min="1"
                max="20"
                value={rows}
                onChange={e => {
                  setRows(e.target.value);
                  setError(null);
                }}
                disabled={disabled}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="table-columns">Columns</Label>
              <Input
                id="table-columns"
                type="number"
                min="1"
                max="10"
                value={columns}
                onChange={e => {
                  setColumns(e.target.value);
                  setError(null);
                }}
                disabled={disabled}
              />
            </div>
          </div>

          {/* Include headers */}
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={includeHeaders}
              onCheckedChange={checked => setIncludeHeaders(checked === true)}
            />
            <span className="text-sm">Include header row</span>
          </label>

          {/* Preview */}
          <div className="p-3 rounded-md bg-muted/50">
            <p className="text-xs text-muted-foreground mb-2">Preview:</p>
            <div className="overflow-auto">
              <table className="w-full border-collapse text-xs">
                <tbody>
                  {Array.from({ length: previewRows }).map((_, rowIdx) => (
                    <tr key={rowIdx}>
                      {Array.from({ length: previewCols }).map((_, colIdx) => {
                        const isHeader = includeHeaders && rowIdx === 0;
                        const CellTag = isHeader ? "th" : "td";
                        return (
                          <CellTag
                            key={colIdx}
                            className={`border border-border px-2 py-1 ${
                              isHeader
                                ? "bg-muted font-medium"
                                : "bg-background"
                            }`}
                          >
                            {isHeader ? `Header ${colIdx + 1}` : `Cell`}
                          </CellTag>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

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
          <Button type="button" onClick={insertTable}>
            Insert Table
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
