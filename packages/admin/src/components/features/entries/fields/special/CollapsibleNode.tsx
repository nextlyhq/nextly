/**
 * Lexical Collapsible / Accordion Node
 *
 * Custom ElementNodes that implement a collapsible (accordion) section
 * for the Lexical rich text editor. Uses <details>/<summary> semantics.
 *
 * Structure: CollapsibleContainerNode > [CollapsibleTitleNode, CollapsibleContentNode]
 *
 * @module components/entries/fields/special/CollapsibleNode
 * @since 1.1.0
 */

import {
  ElementNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedElementNode,
  type Spread,
  type RangeSelection,
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
} from "lexical";

// ============================================================
// CollapsibleContainerNode
// ============================================================

export type SerializedCollapsibleContainerNode = Spread<
  { open: boolean },
  SerializedElementNode
>;

export class CollapsibleContainerNode extends ElementNode {
  __open: boolean;

  static getType(): string {
    return "collapsible-container";
  }

  static clone(node: CollapsibleContainerNode): CollapsibleContainerNode {
    return new CollapsibleContainerNode(node.__open, node.__key);
  }

  constructor(open: boolean = true, key?: NodeKey) {
    super(key);
    this.__open = open;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const dom = document.createElement("details");
    dom.classList.add(
      "my-4",
      "border",
      "border-border",
      "rounded-md",
      "overflow-hidden"
    );
    if (this.__open) {
      dom.setAttribute("open", "");
    }
    return dom;
  }

  updateDOM(
    prevNode: CollapsibleContainerNode,
    dom: HTMLDetailsElement
  ): boolean {
    if (prevNode.__open !== this.__open) {
      if (this.__open) {
        dom.setAttribute("open", "");
      } else {
        dom.removeAttribute("open");
      }
    }
    return false;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("details");
    if (this.__open) {
      element.setAttribute("open", "");
    }
    return { element };
  }

  static importDOM(): DOMConversionMap | null {
    return {
      details: () => ({
        conversion: convertDetailsElement,
        priority: 1,
      }),
    };
  }

  exportJSON(): SerializedCollapsibleContainerNode {
    return {
      ...super.exportJSON(),
      type: "collapsible-container",
      open: this.__open,
      version: 1,
    };
  }

  static importJSON(
    serializedNode: SerializedCollapsibleContainerNode
  ): CollapsibleContainerNode {
    const node = $createCollapsibleContainerNode(serializedNode.open);
    return node;
  }

  getOpen(): boolean {
    return this.getLatest().__open;
  }

  toggleOpen(): void {
    const writable = this.getWritable();
    writable.__open = !writable.__open;
  }

  setOpen(open: boolean): void {
    const writable = this.getWritable();
    writable.__open = open;
  }
}

// ============================================================
// CollapsibleTitleNode
// ============================================================

export type SerializedCollapsibleTitleNode = SerializedElementNode;

export class CollapsibleTitleNode extends ElementNode {
  static getType(): string {
    return "collapsible-title";
  }

  static clone(node: CollapsibleTitleNode): CollapsibleTitleNode {
    return new CollapsibleTitleNode(node.__key);
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const dom = document.createElement("summary");
    dom.classList.add(
      "px-4",
      "py-3",
      "font-medium",
      "cursor-pointer",
      "select-none",
      "bg-muted/50",
      "hover-unified",
      "transition-colors",
      "list-none"
    );
    return dom;
  }

  updateDOM(): boolean {
    return false;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("summary");
    return { element };
  }

  static importDOM(): DOMConversionMap | null {
    return {
      summary: () => ({
        conversion: convertSummaryElement,
        priority: 1,
      }),
    };
  }

  exportJSON(): SerializedCollapsibleTitleNode {
    return {
      ...super.exportJSON(),
      type: "collapsible-title",
      version: 1,
    };
  }

  static importJSON(
    _serializedNode: SerializedCollapsibleTitleNode
  ): CollapsibleTitleNode {
    return $createCollapsibleTitleNode();
  }

  collapseAtStart(_selection: RangeSelection): boolean {
    this.getParentOrThrow().insertBefore(this);
    return true;
  }
}

// ============================================================
// CollapsibleContentNode
// ============================================================

export type SerializedCollapsibleContentNode = SerializedElementNode;

export class CollapsibleContentNode extends ElementNode {
  static getType(): string {
    return "collapsible-content";
  }

  static clone(node: CollapsibleContentNode): CollapsibleContentNode {
    return new CollapsibleContentNode(node.__key);
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const dom = document.createElement("div");
    dom.classList.add("px-4", "py-3", "border-t", "border-border");
    return dom;
  }

  updateDOM(): boolean {
    return false;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("div");
    element.classList.add("collapsible-content");
    return { element };
  }

  static importDOM(): DOMConversionMap | null {
    return null;
  }

  exportJSON(): SerializedCollapsibleContentNode {
    return {
      ...super.exportJSON(),
      type: "collapsible-content",
      version: 1,
    };
  }

  static importJSON(
    _serializedNode: SerializedCollapsibleContentNode
  ): CollapsibleContentNode {
    return $createCollapsibleContentNode();
  }
}

// ============================================================
// DOM Conversion Helpers
// ============================================================

function convertDetailsElement(domNode: Node): DOMConversionOutput | null {
  const isOpen =
    domNode instanceof HTMLDetailsElement && domNode.hasAttribute("open");
  const node = $createCollapsibleContainerNode(isOpen);
  return { node };
}

function convertSummaryElement(): DOMConversionOutput | null {
  const node = $createCollapsibleTitleNode();
  return { node };
}

// ============================================================
// Factory Functions
// ============================================================

export function $createCollapsibleContainerNode(
  open: boolean = true
): CollapsibleContainerNode {
  return new CollapsibleContainerNode(open);
}

export function $createCollapsibleTitleNode(): CollapsibleTitleNode {
  return new CollapsibleTitleNode();
}

export function $createCollapsibleContentNode(): CollapsibleContentNode {
  return new CollapsibleContentNode();
}

export function $isCollapsibleContainerNode(
  node: LexicalNode | null | undefined
): node is CollapsibleContainerNode {
  return node instanceof CollapsibleContainerNode;
}

export function $isCollapsibleTitleNode(
  node: LexicalNode | null | undefined
): node is CollapsibleTitleNode {
  return node instanceof CollapsibleTitleNode;
}

export function $isCollapsibleContentNode(
  node: LexicalNode | null | undefined
): node is CollapsibleContentNode {
  return node instanceof CollapsibleContentNode;
}
