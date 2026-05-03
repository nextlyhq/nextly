"use client";

/**
 * Custom Lexical ImageNode
 *
 * Extends DecoratorNode to render images in the rich text editor.
 * Supports lazy loading, alt text, and captions.
 * Integrates with Nextly's MediaPickerDialog for image selection.
 *
 * @see https://lexical.dev/docs/concepts/nodes#decoratornode
 */

import type {
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  EditorConfig,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
} from "lexical";
import { DecoratorNode } from "lexical";
import type { ReactElement } from "react";
import { useState } from "react";

/**
 * Serialized ImageNode format (stored in database)
 */
export type SerializedImageNode = Spread<
  {
    altText: string;
    caption?: string;
    height?: number;
    maxWidth?: number;
    showCaption?: boolean;
    src: string;
    width?: number;
  },
  SerializedLexicalNode
>;

/**
 * ImageNode class
 *
 * Custom Lexical node for rendering images with optional captions.
 * Used by ImagePlugin to insert images from MediaPickerDialog.
 */
export class ImageNode extends DecoratorNode<ReactElement> {
  __src: string;
  __altText: string;
  __maxWidth?: number;
  __width?: number;
  __height?: number;
  __showCaption?: boolean;
  __caption?: string;

  static getType(): string {
    return "image";
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(
      node.__src,
      node.__altText,
      node.__maxWidth,
      node.__width,
      node.__height,
      node.__showCaption,
      node.__caption,
      node.__key
    );
  }

  constructor(
    src: string,
    altText: string,
    maxWidth?: number,
    width?: number,
    height?: number,
    showCaption?: boolean,
    caption?: string,
    key?: NodeKey
  ) {
    super(key);
    this.__src = src;
    this.__altText = altText;
    this.__maxWidth = maxWidth;
    this.__width = width;
    this.__height = height;
    this.__showCaption = showCaption;
    this.__caption = caption;
  }

  /**
   * Create DOM element for this node
   */
  createDOM(config: EditorConfig): HTMLElement {
    const span = document.createElement("span");
    const theme = config.theme;
    const className = theme.image;
    if (className !== undefined) {
      span.className = className;
    }
    return span;
  }

  /**
   * Update DOM (images are immutable, so always return false)
   */
  updateDOM(): false {
    return false;
  }

  /**
   * Serialize to JSON for database storage
   */
  exportJSON(): SerializedImageNode {
    return {
      altText: this.getAltText(),
      caption: this.__caption,
      height: this.__height,
      maxWidth: this.__maxWidth,
      showCaption: this.__showCaption,
      src: this.getSrc(),
      type: "image",
      version: 1,
      width: this.__width,
    };
  }

  /**
   * Deserialize from JSON
   */
  static importJSON(serializedNode: SerializedImageNode): ImageNode {
    const { altText, src, width, height, maxWidth, showCaption, caption } =
      serializedNode;
    const node = $createImageNode({
      altText,
      caption,
      height,
      maxWidth,
      showCaption,
      src,
      width,
    });
    return node;
  }

  /**
   * Export to HTML for copy/paste
   */
  exportDOM(): DOMExportOutput {
    const element = document.createElement("img");
    element.setAttribute("src", this.__src);
    element.setAttribute("alt", this.__altText);
    if (this.__width) {
      element.setAttribute("width", this.__width.toString());
    }
    if (this.__height) {
      element.setAttribute("height", this.__height.toString());
    }
    return { element };
  }

  /**
   * Import from HTML for paste
   */
  static importDOM(): DOMConversionMap | null {
    return {
      img: () => ({
        conversion: convertImageElement,
        priority: 0,
      }),
    };
  }

  /**
   * Render the React component
   */
  decorate(): ReactElement {
    return (
      <ImageComponent
        src={this.__src}
        altText={this.__altText}
        width={this.__width}
        height={this.__height}
        maxWidth={this.__maxWidth}
        showCaption={this.__showCaption}
        caption={this.__caption}
        nodeKey={this.getKey()}
      />
    );
  }

  // Getters
  getSrc(): string {
    return this.__src;
  }

  getAltText(): string {
    return this.__altText;
  }

  getWidth(): number | undefined {
    return this.__width;
  }

  getHeight(): number | undefined {
    return this.__height;
  }

  getMaxWidth(): number | undefined {
    return this.__maxWidth;
  }
}

/**
 * Helper function to create ImageNode
 */
export function $createImageNode({
  altText,
  src,
  height,
  maxWidth = 500,
  width,
  showCaption,
  caption,
  key,
}: {
  altText: string;
  caption?: string;
  height?: number;
  key?: NodeKey;
  maxWidth?: number;
  showCaption?: boolean;
  src: string;
  width?: number;
}): ImageNode {
  return new ImageNode(
    src,
    altText,
    maxWidth,
    width,
    height,
    showCaption,
    caption,
    key
  );
}

/**
 * Type guard to check if node is ImageNode
 */
export function $isImageNode(
  node: LexicalNode | null | undefined
): node is ImageNode {
  return node instanceof ImageNode;
}

/**
 * Convert HTML img element to ImageNode
 */
function convertImageElement(domNode: Node): null | DOMConversionOutput {
  if (domNode instanceof HTMLImageElement) {
    const { alt: altText, src, width, height } = domNode;
    const node = $createImageNode({ altText, src, width, height });
    return { node };
  }
  return null;
}

/**
 * ImageComponent - React component that renders the image
 */
interface ImageComponentProps {
  altText: string;
  caption?: string;
  height?: number;
  maxWidth?: number;
  nodeKey: NodeKey;
  showCaption?: boolean;
  src: string;
  width?: number;
}

function ImageComponent({
  src,
  altText,
  width,
  height,
  maxWidth = 500,
  caption,
  showCaption = false,
}: ImageComponentProps) {
  const [imageError, setImageError] = useState(false);

  if (imageError) {
    return (
      <div
        className="my-4 p-4 bg-red-50 dark:bg-red-900/20  border border-primary/5 border-red-200 dark:border-red-800 rounded-none"
        style={{
          maxWidth: maxWidth ? `${maxWidth}px` : undefined,
        }}
      >
        <p className="text-sm text-red-600 dark:text-red-400">
          Failed to load image: {altText || "Untitled"}
        </p>
        <p className="text-xs text-red-500 dark:text-red-500 mt-1">{src}</p>
      </div>
    );
  }

  return (
    <figure
      className="my-4"
      style={{
        maxWidth: maxWidth ? `${maxWidth}px` : undefined,
      }}
    >
      <img
        src={src}
        alt={altText}
        width={width}
        height={height}
        className="rounded-none w-full h-auto"
        loading="lazy"
        draggable="false"
        onError={() => setImageError(true)}
      />
      {showCaption && caption && (
        <figcaption className="text-sm text-gray-600 dark:text-gray-400 mt-2 text-center italic">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
