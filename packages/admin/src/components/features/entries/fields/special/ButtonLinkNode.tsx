"use client";

/**
 * Lexical Button Link Node
 *
 * A custom DecoratorNode for rendering styled button links   const handleEdit = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Dispatch custom event to open edit dialog
    const event = new CustomEvent("edit-button-link", {
      detail: {
        nodeKey,
        url,
        text,
        target: target || undefined,
        variant,
        size,
        bgColor,
        textColor,
      },
    });
    window.dispatchEvent(event);
  }; rich text editor. Supports variant and size options.
 *
 * @module components/entries/fields/special/ButtonLinkNode
 * @since 1.1.0
 */

import {
  DecoratorNode,
  type DOMConversionMap,
  type DOMConversionOutput,
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

// ============================================================
// Types
// ============================================================

export type ButtonLinkVariant = "filled" | "outline";
export type ButtonLinkSize = "sm" | "md" | "lg";
export type ButtonAlignment = "left" | "center" | "right";

export interface ButtonLinkPayload {
  url: string;
  text: string;
  target?: string;
  variant?: ButtonLinkVariant;
  size?: ButtonLinkSize;
  bgColor?: string;
  textColor?: string;
  alignment?: ButtonAlignment;
  key?: NodeKey;
}

export type SerializedButtonLinkNode = Spread<
  {
    url: string;
    text: string;
    target?: string;
    variant: ButtonLinkVariant;
    size: ButtonLinkSize;
    bgColor?: string;
    textColor?: string;
    alignment?: ButtonAlignment;
  },
  SerializedLexicalNode
>;

// ============================================================
// Style Utilities
// ============================================================

const SIZE_CLASSES: Record<ButtonLinkSize, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-base",
};

// ============================================================
// Button Link Component
// ============================================================

interface ButtonLinkComponentProps {
  url: string;
  text: string;
  target?: string;
  variant: ButtonLinkVariant;
  size: ButtonLinkSize;
  bgColor?: string;
  textColor?: string;
  alignment: ButtonAlignment;
  nodeKey: NodeKey;
}

function ButtonLinkComponent({
  url,
  text,
  target,
  variant,
  size,
  bgColor,
  textColor,
  alignment,
  nodeKey,
}: ButtonLinkComponentProps) {
  const [isHovered, setIsHovered] = useState(false);

  const variantClass =
    variant === "outline"
      ? "border border-primary/5 bg-background hover:bg-accent hover:text-accent-foreground"
      : "";

  const handleEdit = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Dispatch custom event to open edit dialog
    const event = new CustomEvent("edit-button-link", {
      detail: {
        nodeKey,
        url,
        text,
        target,
        variant,
        size,
        bgColor,
        textColor,
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
        className="relative inline-block group"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <span
          className={cn(
            "inline-flex items-center justify-center rounded-none font-medium transition-colors cursor-pointer no-underline",
            variantClass,
            SIZE_CLASSES[size]
          )}
          style={{
            ...(variant === "filled" && {
              backgroundColor: bgColor || "hsl(var(--primary))",
              color: textColor || "hsl(var(--primary-foreground))",
            }),
            ...(variant === "outline" &&
              textColor && {
                color: textColor,
                borderColor: textColor,
              }),
          }}
          title={url}
        >
          {text}
        </span>
        {isHovered && (
          <button
            type="button"
            onClick={handleEdit}
            className="absolute top-0 right-0 bg-primary text-primary-foreground rounded-none p-1 shadow-md hover:bg-primary/90 transition-colors z-10 translate-x-1/4 -translate-y-1/4"
            title="Edit button"
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
      </span>
    </span>
  );
}

// ============================================================
// ButtonLinkNode Class
// ============================================================

export class ButtonLinkNode extends DecoratorNode<React.JSX.Element> {
  __url: string;
  __text: string;
  __target: string | undefined;
  __variant: ButtonLinkVariant;
  __size: ButtonLinkSize;
  __bgColor: string | undefined;
  __textColor: string | undefined;
  __alignment: ButtonAlignment;

  static getType(): string {
    return "button-link";
  }

  static clone(node: ButtonLinkNode): ButtonLinkNode {
    return new ButtonLinkNode(
      node.__url,
      node.__text,
      node.__target,
      node.__variant,
      node.__size,
      node.__bgColor,
      node.__textColor,
      node.__alignment,
      node.__key
    );
  }

  constructor(
    url: string,
    text: string,
    target?: string,
    variant: ButtonLinkVariant = "filled",
    size: ButtonLinkSize = "md",
    bgColor?: string,
    textColor?: string,
    alignment: ButtonAlignment = "center",
    key?: NodeKey
  ) {
    super(key);
    this.__url = url;
    this.__text = text;
    this.__target = target;
    this.__variant = variant;
    this.__size = size;
    this.__bgColor = bgColor;
    this.__textColor = textColor;
    this.__alignment = alignment;
  }

  // Serialization
  exportJSON(): SerializedButtonLinkNode {
    return {
      type: "button-link",
      version: 1,
      url: this.__url,
      text: this.__text,
      target: this.__target,
      variant: this.__variant,
      size: this.__size,
      bgColor: this.__bgColor,
      textColor: this.__textColor,
      alignment: this.__alignment,
    };
  }

  static importJSON(serializedNode: SerializedButtonLinkNode): ButtonLinkNode {
    // Handle legacy "primary"/"secondary" variants from existing data
    const variant =
      serializedNode.variant === ("primary" as string) ||
      serializedNode.variant === ("secondary" as string)
        ? "filled"
        : serializedNode.variant || "filled";

    return $createButtonLinkNode({
      url: serializedNode.url,
      text: serializedNode.text,
      target: serializedNode.target,
      variant,
      size: serializedNode.size,
      bgColor: serializedNode.bgColor,
      textColor: serializedNode.textColor,
      alignment: serializedNode.alignment || "center",
    });
  }

  // DOM
  exportDOM(): DOMExportOutput {
    const element = document.createElement("a");
    element.setAttribute("href", this.__url);
    element.setAttribute(
      "class",
      `button-link button-link--${this.__variant} button-link--${this.__size}`
    );
    element.textContent = this.__text;
    if (this.__target) {
      element.setAttribute("target", this.__target);
      element.setAttribute("rel", "noopener noreferrer");
    }
    if (this.__bgColor) {
      element.style.backgroundColor = this.__bgColor;
    }
    if (this.__textColor) {
      element.style.color = this.__textColor;
    }
    return { element };
  }

  static importDOM(): DOMConversionMap | null {
    return {
      a: (domNode: HTMLElement) => {
        if (domNode.classList.contains("button-link")) {
          return {
            conversion: convertButtonLinkElement,
            priority: 1,
          };
        }
        return null;
      },
    };
  }

  createDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "editor-button-link";
    return span;
  }

  updateDOM(): boolean {
    return false;
  }

  // Accessors
  getUrl(): string {
    return this.__url;
  }

  getText(): string {
    return this.__text;
  }

  getTarget(): string | undefined {
    return this.__target;
  }

  getVariant(): ButtonLinkVariant {
    return this.__variant;
  }

  getSize(): ButtonLinkSize {
    return this.__size;
  }

  getBgColor(): string | undefined {
    return this.__bgColor;
  }

  getTextColor(): string | undefined {
    return this.__textColor;
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
        <ButtonLinkComponent
          url={this.__url}
          text={this.__text}
          target={this.__target}
          variant={this.__variant}
          size={this.__size}
          bgColor={this.__bgColor}
          textColor={this.__textColor}
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

function convertButtonLinkElement(domNode: Node): DOMConversionOutput | null {
  if (domNode instanceof HTMLAnchorElement) {
    const url = domNode.getAttribute("href") || "";
    const text = domNode.textContent || "";
    const target = domNode.getAttribute("target") || undefined;

    // Detect variant from class
    let variant: ButtonLinkVariant = "filled";
    if (domNode.classList.contains("button-link--outline")) variant = "outline";

    // Detect size from class
    let size: ButtonLinkSize = "md";
    if (domNode.classList.contains("button-link--sm")) size = "sm";
    if (domNode.classList.contains("button-link--lg")) size = "lg";

    // Detect colors from inline styles
    const bgColor = domNode.style.backgroundColor || undefined;
    const textColor = domNode.style.color || undefined;

    if (url && text) {
      return {
        node: $createButtonLinkNode({
          url,
          text,
          target,
          variant,
          size,
          bgColor,
          textColor,
        }),
      };
    }
  }
  return null;
}

export function $createButtonLinkNode(
  payload: ButtonLinkPayload
): ButtonLinkNode {
  return new ButtonLinkNode(
    payload.url,
    payload.text,
    payload.target,
    payload.variant || "filled",
    payload.size || "md",
    payload.bgColor,
    payload.textColor,
    payload.alignment || "center",
    payload.key
  );
}

export function $isButtonLinkNode(
  node: LexicalNode | null | undefined
): node is ButtonLinkNode {
  return node instanceof ButtonLinkNode;
}
