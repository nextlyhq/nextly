/**
 * Table Action Menu Plugin
 *
 * A Lexical plugin that provides a floating action menu when the cursor
 * is inside a table cell, allowing users to add/remove rows and columns.
 *
 * @module components/entries/fields/special/TableActionMenuPlugin
 * @since 1.2.0
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $deleteTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $getTableCellNodeFromLexicalNode,
  $getTableNodeFromLexicalNodeOrThrow,
  $insertTableColumnAtSelection,
  $insertTableRowAtSelection,
} from "@lexical/table";
import { $getSelection, $isRangeSelection } from "lexical";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { Trash2 } from "@admin/components/icons";

// ============================================================
// Types
// ============================================================

interface MenuPosition {
  top: number;
  left: number;
}

// ============================================================
// Styles
// ============================================================

const menuStyle: React.CSSProperties = {
  position: "fixed",
  zIndex: 50,
  display: "flex",
  alignItems: "center",
  gap: "2px",
  padding: "3px 4px",
  backgroundColor: "hsl(var(--background))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "6px",
  boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
  fontSize: "12px",
  fontFamily: "inherit",
};

const actionBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  height: "24px",
  padding: "0 6px",
  border: "none",
  background: "transparent",
  borderRadius: "4px",
  cursor: "pointer",
  color: "hsl(var(--muted-foreground))",
  fontSize: "11px",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
  transition: "background-color 0.15s, color 0.15s",
};

const destructiveBtnStyle: React.CSSProperties = {
  ...actionBtnStyle,
};

const separatorStyle: React.CSSProperties = {
  width: "1px",
  height: "16px",
  backgroundColor: "hsl(var(--border))",
  margin: "0 2px",
  flexShrink: 0,
};

// ============================================================
// ActionButton Component
// ============================================================

function ActionButton({
  label,
  title,
  onClick,
  destructive = false,
}: {
  label: React.ReactNode;
  title: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      style={destructive ? destructiveBtnStyle : actionBtnStyle}
      onClick={onClick}
      title={title}
      onMouseEnter={e => {
        if (destructive) {
          e.currentTarget.style.backgroundColor = "hsl(var(--destructive)/0.1)";
          e.currentTarget.style.color = "hsl(var(--destructive))";
        } else {
          e.currentTarget.style.backgroundColor = "hsl(var(--accent))";
          e.currentTarget.style.color = "hsl(var(--accent-foreground))";
        }
      }}
      onMouseLeave={e => {
        e.currentTarget.style.backgroundColor = "transparent";
        e.currentTarget.style.color = "hsl(var(--muted-foreground))";
      }}
    >
      {label}
    </button>
  );
}

// ============================================================
// Plugin Component
// ============================================================

export interface TableActionMenuPluginProps {
  disabled?: boolean;
}

export function TableActionMenuPlugin({
  disabled = false,
}: TableActionMenuPluginProps) {
  const [editor] = useLexicalComposerContext();
  const [isInTable, setIsInTable] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);

  useEffect(() => {
    if (disabled) return;

    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          setIsInTable(false);
          setMenuPosition(null);
          return;
        }

        const anchorNode = selection.anchor.getNode();
        const cellNode = $getTableCellNodeFromLexicalNode(anchorNode);

        if (!cellNode) {
          setIsInTable(false);
          setMenuPosition(null);
          return;
        }

        setIsInTable(true);

        const cellElement = editor.getElementByKey(cellNode.getKey());
        if (!cellElement) {
          setMenuPosition(null);
          return;
        }

        const tableNode = $getTableNodeFromLexicalNodeOrThrow(cellNode);
        const tableElement = editor.getElementByKey(tableNode.getKey());
        if (!tableElement) {
          setMenuPosition(null);
          return;
        }

        const tableRect = tableElement.getBoundingClientRect();
        setMenuPosition({
          top: tableRect.top - 34,
          left: tableRect.left,
        });
      });
    });
  }, [editor, disabled]);

  const insertRowAbove = useCallback(() => {
    editor.update(() => {
      $insertTableRowAtSelection(false);
    });
  }, [editor]);

  const insertRowBelow = useCallback(() => {
    editor.update(() => {
      $insertTableRowAtSelection(true);
    });
  }, [editor]);

  const insertColumnLeft = useCallback(() => {
    editor.update(() => {
      $insertTableColumnAtSelection(false);
    });
  }, [editor]);

  const insertColumnRight = useCallback(() => {
    editor.update(() => {
      $insertTableColumnAtSelection(true);
    });
  }, [editor]);

  const deleteRow = useCallback(() => {
    editor.update(() => {
      $deleteTableRowAtSelection();
    });
  }, [editor]);

  const deleteColumn = useCallback(() => {
    editor.update(() => {
      $deleteTableColumnAtSelection();
    });
  }, [editor]);

  const deleteTable = useCallback(() => {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      const anchorNode = selection.anchor.getNode();
      const cellNode = $getTableCellNodeFromLexicalNode(anchorNode);
      if (!cellNode) return;
      const tableNode = $getTableNodeFromLexicalNodeOrThrow(cellNode);
      tableNode.remove();
    });
  }, [editor]);

  if (disabled || !isInTable || !menuPosition) {
    return null;
  }

  return createPortal(
    <div
      style={{
        ...menuStyle,
        top: `${menuPosition.top}px`,
        left: `${menuPosition.left}px`,
      }}
    >
      {/* Row actions */}
      <ActionButton
        label="+ Row above"
        title="Insert row above"
        onClick={insertRowAbove}
      />
      <ActionButton
        label="+ Row below"
        title="Insert row below"
        onClick={insertRowBelow}
      />

      <div style={separatorStyle} />

      {/* Column actions */}
      <ActionButton
        label="+ Col left"
        title="Insert column to the left"
        onClick={insertColumnLeft}
      />
      <ActionButton
        label="+ Col right"
        title="Insert column to the right"
        onClick={insertColumnRight}
      />

      <div style={separatorStyle} />

      {/* Delete actions */}
      <ActionButton
        label="Del row"
        title="Delete current row"
        onClick={deleteRow}
        destructive
      />
      <ActionButton
        label="Del col"
        title="Delete current column"
        onClick={deleteColumn}
        destructive
      />

      <div style={separatorStyle} />

      <ActionButton
        label={<Trash2 style={{ width: "13px", height: "13px" }} />}
        title="Delete entire table"
        onClick={deleteTable}
        destructive
      />
    </div>,
    document.body
  );
}
