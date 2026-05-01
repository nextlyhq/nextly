"use client";

/**
 * Draggable Block Menu Plugin
 *
 * Shows a floating menu (plus icon + drag handle) on the left side of each
 * block when hovered. Allows users to drag blocks to reorder them and
 * add new blocks via the plus button.
 *
 * Uses Lexical's DraggableBlockPlugin_EXPERIMENTAL under the hood.
 * The plugin portals its content into `anchorElem` and positions the
 * menu via CSS `transform` and `opacity` on the `menuRef` element.
 *
 * @module components/entries/fields/special/DraggableBlockMenuPlugin
 * @since 1.0.0
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { DraggableBlockPlugin_EXPERIMENTAL } from "@lexical/react/LexicalDraggableBlockPlugin";
import {
  $createParagraphNode,
  $getNearestNodeFromDOMNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isRootOrShadowRoot,
} from "lexical";
import { useCallback, useRef, useState } from "react";

import { GripVertical, Plus } from "@admin/components/icons";

interface DraggableBlockMenuPluginProps {
  disabled?: boolean;
  anchorElem: HTMLElement;
}

export function DraggableBlockMenuPlugin({
  disabled = false,
  anchorElem,
}: DraggableBlockMenuPluginProps) {
  const [editor] = useLexicalComposerContext();
  const menuRef = useRef<HTMLDivElement>(null);
  const targetLineRef = useRef<HTMLDivElement>(null);
  // Keep a stable ref to the last hovered block element.
  // When the cursor moves onto the menu button, the plugin calls
  // onElementChanged(null), which would clear state before handleAddBlock
  // runs — causing insertions to fall back to root.append() (end of editor).
  const lastHoveredElementRef = useRef<HTMLElement | null>(null);
  const [_hoveredElement, setHoveredElement] = useState<HTMLElement | null>(
    null
  );

  const handleAddBlock = useCallback(() => {
    // Use the ref so we still have the block even if hoveredElement was
    // reset to null when the mouse moved onto the menu button.
    const targetElement = lastHoveredElementRef.current;
    if (!targetElement) return;

    editor.update(() => {
      // Resolve the Lexical node from the hovered DOM element using
      // Lexical's own API. The old getAttribute("data-lexical-node-key")
      // never worked because Lexical stores keys internally, not as
      // DOM attributes.
      const node = $getNearestNodeFromDOMNode(targetElement);

      const paragraph = $createParagraphNode();

      if (!node) {
        // Fallback: append at root only if we truly cannot resolve a node
        const root = $getRoot();
        root.append(paragraph);
      } else {
        // Walk up to the top-level block (direct child of root)
        let topLevel = node;
        let parent = topLevel.getParent();
        while (parent && !$isRootOrShadowRoot(parent)) {
          topLevel = parent;
          parent = topLevel.getParent();
        }
        topLevel.insertAfter(paragraph);
      }

      paragraph.select();
    });

    // After paragraph is created and selected, insert "/" via the
    // normal text input pipeline so the typeahead menu detects it
    setTimeout(() => {
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          selection.insertText("/");
        }
      });
      editor.focus();
    }, 0);
  }, [editor]);

  const isOnMenu = useCallback((element: HTMLElement) => {
    return menuRef.current?.contains(element) ?? false;
  }, []);

  const onElementChanged = useCallback((element: HTMLElement | null) => {
    if (element) {
      // Only update the ref when we have a real block — never on null.
      // This preserves the target even as the mouse travels to the button.
      lastHoveredElementRef.current = element;
    }
    setHoveredElement(element);
  }, []);

  if (disabled) return null;

  return (
    <DraggableBlockPlugin_EXPERIMENTAL
      anchorElem={anchorElem}
      menuRef={menuRef}
      targetLineRef={targetLineRef}
      isOnMenu={isOnMenu}
      onElementChanged={onElementChanged}
      menuComponent={
        <div
          ref={menuRef}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            willChange: "transform",
            transition:
              "transform 140ms ease-in-out, opacity 160ms ease-in-out",
          }}
          className="flex items-center gap-0.5 rounded-[4px] p-[2px_1px] z-10"
        >
          <button
            type="button"
            onMouseDown={e => e.preventDefault()}
            onClick={handleAddBlock}
            className="flex items-center justify-center h-4 w-4 rounded-sm opacity-30 hover:opacity-100 hover-unified transition-all cursor-pointer"
            title="Click to add block below"
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
          </button>
          <div className="flex items-center justify-center h-4 w-4 rounded-sm opacity-30 hover:opacity-100 hover-unified transition-all cursor-grab active:cursor-grabbing">
            <GripVertical className="h-4 w-4" strokeWidth={2.5} />
          </div>
        </div>
      }
      targetLineComponent={
        <div
          ref={targetLineRef}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            willChange: "transform",
            height: "4px",
            backgroundColor: "deepskyblue",
            borderRadius: "4px",
          }}
          className="pointer-events-none"
        />
      }
    />
  );
}
