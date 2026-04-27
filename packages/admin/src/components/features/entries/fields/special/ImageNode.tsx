/**
 * Lexical Image Node
 *
 * A custom DecoratorNode for rendering images in the Lexical rich text editor.
 * Supports alt text and optional caption. Images are displayed with CSS
 * max-width constraints and cannot be resized via drag handles.
 *
 * This node handles:
 * - JSON serialization/deserialization for persistence
 * - DOM import/export for clipboard operations
 * - React component rendering via the decorate() method
 *
 * @module components/entries/fields/special/ImageNode
 * @since 1.0.0
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from "@revnixhq/ui";
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
import { Suspense, useState, useCallback } from "react";

import { Edit } from "@admin/components/icons";

// ============================================================
// Types
// ============================================================

export interface ImagePayload {
  src: string;
  altText: string;
  width?: number;
  height?: number;
  caption?: string;
  title?: string;
  key?: NodeKey;
}

export type SerializedImageNode = Spread<
  {
    src: string;
    altText: string;
    width?: number;
    height?: number;
    caption?: string;
    title?: string;
  },
  SerializedLexicalNode
>;

// ============================================================
// Image Component
// ============================================================

interface ImageComponentProps {
  src: string;
  altText: string;
  width?: number;
  height?: number;
  caption?: string;
  title?: string;
  nodeKey: NodeKey;
}

function ImageComponent({
  src,
  altText,
  width,
  height,
  caption,
  title,
  nodeKey,
}: ImageComponentProps) {
  const [editor] = useLexicalComposerContext();
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editData, setEditData] = useState({
    altText: altText || "",
    title: title || "",
    caption: caption || "",
  });

  const handleEdit = useCallback(() => {
    setEditData({
      altText: altText || "",
      title: title || "",
      caption: caption || "",
    });
    setIsEditDialogOpen(true);
  }, [altText, title, caption]);

  const handleSave = useCallback(() => {
    editor.update(() => {
      const node = editor.getEditorState()._nodeMap.get(nodeKey);
      if (node && $isImageNode(node)) {
        const writableNode = node.getWritable() as ImageNode;
        writableNode.setAltText(editData.altText || "");
        writableNode.setTitle(editData.title || undefined);
        writableNode.setCaption(editData.caption || undefined);
      }
    });
    setIsEditDialogOpen(false);
  }, [editor, nodeKey, editData]);

  return (
    <>
      <figure className="my-4 relative group">
        <div className="relative">
          <img
            src={src}
            alt={altText}
            title={title}
            width={width}
            height={height}
            className="w-full h-auto rounded-md"
            draggable={false}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={handleEdit}
          >
            <Edit className="h-4 w-4 mr-1" />
            Edit
          </Button>
        </div>
        {caption && (
          <figcaption className="mt-2 text-center text-sm text-muted-foreground">
            {caption}
          </figcaption>
        )}
      </figure>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Image Metadata</DialogTitle>
            <DialogDescription>
              Update accessibility information and metadata for this image.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-altText">
                Alt Text{" "}
                <span className="text-sm text-muted-foreground">
                  (recommended)
                </span>
              </Label>
              <Input
                id="edit-altText"
                value={editData.altText}
                onChange={e =>
                  setEditData(prev => ({ ...prev, altText: e.target.value }))
                }
                placeholder="Describe the image..."
              />
              <p className="text-sm text-muted-foreground">
                Brief description for accessibility. Max 500 characters.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-title">
                Title{" "}
                <span className="text-sm text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <Input
                id="edit-title"
                value={editData.title}
                onChange={e =>
                  setEditData(prev => ({ ...prev, title: e.target.value }))
                }
                placeholder="Image title..."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-caption">
                Caption{" "}
                <span className="text-sm text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <Textarea
                id="edit-caption"
                value={editData.caption}
                onChange={e =>
                  setEditData(prev => ({ ...prev, caption: e.target.value }))
                }
                placeholder="Caption to display below the image..."
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsEditDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleSave}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ============================================================
// ImageNode Class
// ============================================================

export class ImageNode extends DecoratorNode<React.JSX.Element> {
  __src: string;
  __altText: string;
  __width: number | undefined;
  __height: number | undefined;
  __caption: string | undefined;
  __title: string | undefined;

  static getType(): string {
    return "image";
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(
      node.__src,
      node.__altText,
      node.__width,
      node.__height,
      node.__caption,
      node.__title,
      node.__key
    );
  }

  constructor(
    src: string,
    altText: string,
    width?: number,
    height?: number,
    caption?: string,
    title?: string,
    key?: NodeKey
  ) {
    super(key);
    this.__src = src;
    this.__altText = altText;
    this.__width = width;
    this.__height = height;
    this.__caption = caption;
    this.__title = title;
  }

  // ============================================================
  // Serialization Methods
  // ============================================================

  exportJSON(): SerializedImageNode {
    return {
      type: "image",
      version: 1,
      src: this.__src,
      altText: this.__altText,
      width: this.__width,
      height: this.__height,
      caption: this.__caption,
      title: this.__title,
    };
  }

  static importJSON(serializedNode: SerializedImageNode): ImageNode {
    return $createImageNode({
      src: serializedNode.src,
      altText: serializedNode.altText,
      width: serializedNode.width,
      height: serializedNode.height,
      caption: serializedNode.caption,
      title: serializedNode.title,
    });
  }

  // ============================================================
  // DOM Methods
  // ============================================================

  exportDOM(): DOMExportOutput {
    if (this.__caption) {
      const figure = document.createElement("figure");
      const img = document.createElement("img");
      img.setAttribute("src", this.__src);
      img.setAttribute("alt", this.__altText);
      if (this.__title) img.setAttribute("title", this.__title);
      if (this.__width) img.setAttribute("width", String(this.__width));
      if (this.__height) img.setAttribute("height", String(this.__height));
      figure.appendChild(img);

      const figcaption = document.createElement("figcaption");
      figcaption.textContent = this.__caption;
      figure.appendChild(figcaption);

      return { element: figure };
    }

    const element = document.createElement("img");
    element.setAttribute("src", this.__src);
    element.setAttribute("alt", this.__altText);
    if (this.__title) element.setAttribute("title", this.__title);
    if (this.__width) {
      element.setAttribute("width", String(this.__width));
    }
    if (this.__height) {
      element.setAttribute("height", String(this.__height));
    }
    return { element };
  }

  static importDOM(): DOMConversionMap | null {
    return {
      img: () => ({
        conversion: convertImageElement,
        priority: 0,
      }),
      figure: () => ({
        conversion: convertFigureElement,
        priority: 0,
      }),
    };
  }

  createDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "editor-image";
    return span;
  }

  updateDOM(): boolean {
    return false;
  }

  // ============================================================
  // Accessor Methods
  // ============================================================

  getSrc(): string {
    return this.__src;
  }

  getAltText(): string {
    return this.__altText;
  }

  setAltText(altText: string): void {
    const writable = this.getWritable();
    writable.__altText = altText;
  }

  getCaption(): string | undefined {
    return this.__caption;
  }

  setCaption(caption: string | undefined): void {
    const writable = this.getWritable();
    writable.__caption = caption;
  }

  getTitle(): string | undefined {
    return this.__title;
  }

  setTitle(title: string | undefined): void {
    const writable = this.getWritable();
    writable.__title = title;
  }

  setWidthAndHeight(width?: number, height?: number): void {
    const writable = this.getWritable();
    writable.__width = width;
    writable.__height = height;
  }

  // ============================================================
  // Decorator Method
  // ============================================================

  decorate(): React.JSX.Element {
    return (
      <Suspense fallback={null}>
        <ImageComponent
          src={this.__src}
          altText={this.__altText}
          width={this.__width}
          height={this.__height}
          caption={this.__caption}
          title={this.__title}
          nodeKey={this.__key}
        />
      </Suspense>
    );
  }
}

// ============================================================
// Helper Functions
// ============================================================

function convertImageElement(domNode: Node): DOMConversionOutput | null {
  if (domNode instanceof HTMLImageElement) {
    // Skip if the image is inside a <figure> (handled by convertFigureElement)
    if (domNode.parentElement?.tagName === "FIGURE") {
      return null;
    }

    const src = domNode.getAttribute("src");
    const alt = domNode.getAttribute("alt") || "";
    const title = domNode.getAttribute("title") || undefined;
    const width = domNode.width || undefined;
    const height = domNode.height || undefined;

    if (src) {
      return {
        node: $createImageNode({
          src,
          altText: alt,
          title,
          width,
          height,
        }),
      };
    }
  }
  return null;
}

function convertFigureElement(domNode: Node): DOMConversionOutput | null {
  if (domNode instanceof HTMLElement) {
    const img = domNode.querySelector("img");
    if (img) {
      const src = img.getAttribute("src");
      const alt = img.getAttribute("alt") || "";
      const title = img.getAttribute("title") || undefined;
      const width = img.width || undefined;
      const height = img.height || undefined;
      const figcaption = domNode.querySelector("figcaption");
      const caption = figcaption?.textContent || undefined;

      if (src) {
        return {
          node: $createImageNode({
            src,
            altText: alt,
            title,
            width,
            height,
            caption,
          }),
        };
      }
    }
  }
  return null;
}

export function $createImageNode(payload: ImagePayload): ImageNode {
  return new ImageNode(
    payload.src,
    payload.altText,
    payload.width,
    payload.height,
    payload.caption,
    payload.title,
    payload.key
  );
}

export function $isImageNode(
  node: LexicalNode | null | undefined
): node is ImageNode {
  return node instanceof ImageNode;
}
