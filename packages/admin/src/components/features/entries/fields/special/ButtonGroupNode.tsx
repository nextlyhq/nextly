"use client";

/**
 * Lexical Button Group Node
 *
 * A custom DecoratorNode for rendering a group of styled button links
 * in a horizontal row within the Lexical rich text editor.
 *
 * @module components/entries/fields/special/ButtonGroupNode
 * @since 1.2.0
 */

import {
  DecoratorNode,
  type DOMExportOutput,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import type React from "react";
import { Suspense, useState } from "react";

import { Pencil } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import type { ButtonLinkSize, ButtonLinkVariant } from "./ButtonLinkNode";

// ============================================================
// Types
// ============================================================

export type ButtonAlignment = "left" | "center" | "right";

export interface ButtonGroupItem {
  url: string;
  text: string;
  target?: string;
  variant: ButtonLinkVariant;
  size: ButtonLinkSize;
  bgColor?: string;
  textColor?: string;
}

export interface ButtonGroupPayload {
  buttons: ButtonGroupItem[];
  alignment?: ButtonAlignment;
  key?: NodeKey;
}

export type SerializedButtonGroupNode = Spread<
  {
    buttons: ButtonGroupItem[];
    alignment?: ButtonAlignment;
  },
  SerializedLexicalNode
>;

// ============================================================
// Size Classes
// ============================================================

const SIZE_CLASSES: Record<ButtonLinkSize, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-base",
};

// ============================================================
// Button Group Component
// ============================================================

interface ButtonGroupComponentProps {
  buttons: ButtonGroupItem[];
  alignment: ButtonAlignment;
  nodeKey: NodeKey;
}

function ButtonGroupComponent({
  buttons,
  alignment,
  nodeKey,
}: ButtonGroupComponentProps) {
  const [isHovered, setIsHovered] = useState(false);

  const handleEdit = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Dispatch custom event to open edit dialog
    const event = new CustomEvent("edit-button-group", {
      detail: {
        nodeKey,
        buttons,
        alignment,
      },
    });
    window.dispatchEvent(event);
  };

  const alignmentClass =
    alignment === "left"
      ? "justify-start"
      : alignment === "right"
        ? "justify-end"
        : "justify-center";

  return (
    <span className={`my-4 flex ${alignmentClass}`}>
      <span
        className={`relative inline-flex gap-3 flex-wrap ${alignmentClass} group`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {buttons.map((button, index) => {
          const variantClass =
            button.variant === "outline"
              ? "border border-input bg-background hover:bg-accent hover:text-accent-foreground"
              : "";

          return (
            <span
              key={index}
              className={cn(
                "inline-flex items-center justify-center rounded-none font-medium transition-colors cursor-pointer no-underline",
                variantClass,
                SIZE_CLASSES[button.size]
              )}
              style={{
                ...(button.variant === "filled" && {
                  backgroundColor: button.bgColor || "hsl(var(--primary))",
                  color: button.textColor || "hsl(var(--primary-foreground))",
                }),
                ...(button.variant === "outline" &&
                  button.textColor && {
                    color: button.textColor,
                    borderColor: button.textColor,
                  }),
              }}
              title={button.url}
            >
              {button.text}
            </span>
          );
        })}
        {isHovered && (
          <button
            type="button"
            onClick={handleEdit}
            className="absolute top-0 right-0 bg-primary text-primary-foreground rounded-none p-1 shadow-md hover:bg-primary/90 transition-colors z-10 translate-x-1/4 -translate-y-1/4"
            title="Edit button group"
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
      </span>
    </span>
  );
}

// ============================================================
// ButtonGroupNode Class
// ============================================================

export class ButtonGroupNode extends DecoratorNode<React.JSX.Element> {
  __buttons: ButtonGroupItem[];
  __alignment: ButtonAlignment;

  static getType(): string {
    return "button-group";
  }

  static clone(node: ButtonGroupNode): ButtonGroupNode {
    return new ButtonGroupNode(
      [...node.__buttons],
      node.__alignment,
      node.__key
    );
  }

  constructor(
    buttons: ButtonGroupItem[],
    alignment: ButtonAlignment = "center",
    key?: NodeKey
  ) {
    super(key);
    this.__buttons = buttons;
    this.__alignment = alignment;
  }

  // Serialization
  exportJSON(): SerializedButtonGroupNode {
    return {
      type: "button-group",
      version: 1,
      buttons: this.__buttons,
      alignment: this.__alignment,
    };
  }

  static importJSON(
    serializedNode: SerializedButtonGroupNode
  ): ButtonGroupNode {
    // Handle legacy variants
    const buttons = serializedNode.buttons.map(btn => ({
      ...btn,
      variant:
        btn.variant === ("primary" as string) ||
        btn.variant === ("secondary" as string)
          ? ("filled" as const)
          : btn.variant || ("filled" as const),
    }));
    return $createButtonGroupNode({
      buttons,
      alignment: serializedNode.alignment || "center",
    });
  }

  // DOM
  exportDOM(): DOMExportOutput {
    const div = document.createElement("div");
    div.className = "button-group";
    div.style.display = "flex";
    div.style.justifyContent =
      this.__alignment === "left"
        ? "flex-start"
        : this.__alignment === "right"
          ? "flex-end"
          : "center";
    div.style.gap = "0.75rem";
    div.style.flexWrap = "wrap";

    this.__buttons.forEach(button => {
      const a = document.createElement("a");
      a.setAttribute("href", button.url);
      a.setAttribute(
        "class",
        `button-link button-link--${button.variant} button-link--${button.size}`
      );
      a.textContent = button.text;
      if (button.target) {
        a.setAttribute("target", button.target);
        a.setAttribute("rel", "noopener noreferrer");
      }
      if (button.bgColor) {
        a.style.backgroundColor = button.bgColor;
      }
      if (button.textColor) {
        a.style.color = button.textColor;
      }
      div.appendChild(a);
    });

    return { element: div };
  }

  static importDOM() {
    return null;
  }

  createDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "editor-button-group";
    return span;
  }

  updateDOM(): boolean {
    return false;
  }

  // Accessors
  getButtons(): ButtonGroupItem[] {
    return this.__buttons;
  }

  setButtons(buttons: ButtonGroupItem[]): void {
    const writable = this.getWritable();
    writable.__buttons = buttons;
  }

  getAlignment(): ButtonAlignment {
    return this.__alignment;
  }

  setAlignment(alignment: ButtonAlignment): void {
    const writable = this.getWritable();
    writable.__alignment = alignment;
  }

  // Decorator
  decorate(): React.JSX.Element {
    return (
      <Suspense fallback={null}>
        <ButtonGroupComponent
          buttons={this.__buttons}
          alignment={this.__alignment}
          nodeKey={this.__key}
        />
      </Suspense>
    );
  }
}

// ============================================================
// Helper Functions
// ============================================================

export function $createButtonGroupNode(
  payload: ButtonGroupPayload
): ButtonGroupNode {
  return new ButtonGroupNode(
    payload.buttons,
    payload.alignment || "center",
    payload.key
  );
}

export function $isButtonGroupNode(
  node: LexicalNode | null | undefined
): node is ButtonGroupNode {
  return node instanceof ButtonGroupNode;
}
