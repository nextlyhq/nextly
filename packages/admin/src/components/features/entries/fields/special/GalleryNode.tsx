"use client";

/**
 * Lexical Gallery Node
 *
 * A custom DecoratorNode for rendering image galleries in the
 * Lexical rich text editor. Supports multiple images with responsive grid layout.
 *
 * @module components/entries/fields/special/GalleryNode
 * @since 1.1.0
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

import { X } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

// ============================================================
// Types
// ============================================================

export interface GalleryImage {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  title?: string;
}

export type GalleryColumns = 2 | 3 | 4;

export interface GalleryPayload {
  images: GalleryImage[];
  columns?: GalleryColumns;
  caption?: string;
  key?: NodeKey;
}

export type SerializedGalleryNode = Spread<
  {
    images: GalleryImage[];
    columns: GalleryColumns;
    caption?: string;
  },
  SerializedLexicalNode
>;

// ============================================================
// Gallery Component
// ============================================================

interface GalleryComponentProps {
  images: GalleryImage[];
  columns: GalleryColumns;
  caption?: string;
  nodeKey: NodeKey;
}

function GalleryComponent({ images, columns, caption }: GalleryComponentProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const gridClass =
    columns === 2
      ? "grid-cols-2"
      : columns === 4
        ? "grid-cols-2 sm:grid-cols-4"
        : "grid-cols-2 sm:grid-cols-3";

  return (
    <figure className="my-4">
      <div className={cn("grid gap-2", gridClass)}>
        {images.map((image, index) => (
          <button
            key={index}
            type="button"
            className="relative overflow-hidden rounded-none aspect-square bg-primary/5 cursor-pointer hover:opacity-90 transition-opacity"
            onClick={() => setLightboxIndex(index)}
          >
            <img
              src={image.src}
              alt={image.alt}
              title={image.title}
              className="w-full h-full object-cover"
              loading="lazy"
              draggable={false}
            />
          </button>
        ))}
      </div>
      {caption && (
        <figcaption className="mt-2 text-center text-sm text-muted-foreground">
          {caption}
        </figcaption>
      )}

      {/* Lightbox */}
      {lightboxIndex !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightboxIndex(null)}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            className="absolute top-4 right-4 text-white hover:text-white/80 z-10"
            onClick={() => setLightboxIndex(null)}
          >
            <X className="h-6 w-6" />
          </button>

          <div className="flex items-center gap-4 max-w-5xl max-h-[90vh]">
            {lightboxIndex > 0 && (
              <button
                type="button"
                className="text-white hover:text-white/80 text-3xl px-2"
                onClick={e => {
                  e.stopPropagation();
                  setLightboxIndex(lightboxIndex - 1);
                }}
              >
                &lsaquo;
              </button>
            )}

            <img
              src={images[lightboxIndex].src}
              alt={images[lightboxIndex].alt}
              title={images[lightboxIndex].title}
              className="max-w-full max-h-[85vh] object-contain rounded-none"
              onClick={e => e.stopPropagation()}
            />

            {lightboxIndex < images.length - 1 && (
              <button
                type="button"
                className="text-white hover:text-white/80 text-3xl px-2"
                onClick={e => {
                  e.stopPropagation();
                  setLightboxIndex(lightboxIndex + 1);
                }}
              >
                &rsaquo;
              </button>
            )}
          </div>

          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white text-sm">
            {lightboxIndex + 1} / {images.length}
            {images[lightboxIndex].alt && (
              <span className="ml-2 text-white/70">
                — {images[lightboxIndex].title || images[lightboxIndex].alt}
              </span>
            )}
          </div>
        </div>
      )}
    </figure>
  );
}

// ============================================================
// GalleryNode Class
// ============================================================

export class GalleryNode extends DecoratorNode<React.JSX.Element> {
  __images: GalleryImage[];
  __columns: GalleryColumns;
  __caption: string | undefined;

  static getType(): string {
    return "gallery";
  }

  static clone(node: GalleryNode): GalleryNode {
    return new GalleryNode(
      [...node.__images],
      node.__columns,
      node.__caption,
      node.__key
    );
  }

  constructor(
    images: GalleryImage[],
    columns: GalleryColumns = 3,
    caption?: string,
    key?: NodeKey
  ) {
    super(key);
    this.__images = images;
    this.__columns = columns;
    this.__caption = caption;
  }

  // Serialization
  exportJSON(): SerializedGalleryNode {
    return {
      type: "gallery",
      version: 1,
      images: this.__images,
      columns: this.__columns,
      caption: this.__caption,
    };
  }

  static importJSON(serializedNode: SerializedGalleryNode): GalleryNode {
    return $createGalleryNode({
      images: serializedNode.images,
      columns: serializedNode.columns,
      caption: serializedNode.caption,
    });
  }

  // DOM
  exportDOM(): DOMExportOutput {
    const figure = document.createElement("figure");
    figure.className = `gallery gallery--cols-${this.__columns}`;

    const grid = document.createElement("div");
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = `repeat(${this.__columns}, 1fr)`;
    grid.style.gap = "0.5rem";

    this.__images.forEach(image => {
      const img = document.createElement("img");
      img.setAttribute("src", image.src);
      img.setAttribute("alt", image.alt);
      if (image.title) img.setAttribute("title", image.title);
      img.style.width = "100%";
      img.style.height = "auto";
      img.style.objectFit = "cover";
      img.style.borderRadius = "0.375rem";
      grid.appendChild(img);
    });

    figure.appendChild(grid);

    if (this.__caption) {
      const figcaption = document.createElement("figcaption");
      figcaption.textContent = this.__caption;
      figure.appendChild(figcaption);
    }

    return { element: figure };
  }

  static importDOM() {
    return null;
  }

  createDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "editor-gallery";
    return span;
  }

  updateDOM(): boolean {
    return false;
  }

  // Accessors
  getImages(): GalleryImage[] {
    return this.__images;
  }

  getColumns(): GalleryColumns {
    return this.__columns;
  }

  getCaption(): string | undefined {
    return this.__caption;
  }

  addImage(image: GalleryImage): void {
    const writable = this.getWritable();
    writable.__images = [...writable.__images, image];
  }

  removeImage(index: number): void {
    const writable = this.getWritable();
    writable.__images = writable.__images.filter((_, i) => i !== index);
  }

  setColumns(columns: GalleryColumns): void {
    const writable = this.getWritable();
    writable.__columns = columns;
  }

  setCaption(caption: string | undefined): void {
    const writable = this.getWritable();
    writable.__caption = caption;
  }

  // Decorator
  decorate(): React.JSX.Element {
    return (
      <Suspense fallback={null}>
        <GalleryComponent
          images={this.__images}
          columns={this.__columns}
          caption={this.__caption}
          nodeKey={this.__key}
        />
      </Suspense>
    );
  }
}

// ============================================================
// Helper Functions
// ============================================================

export function $createGalleryNode(payload: GalleryPayload): GalleryNode {
  return new GalleryNode(
    payload.images,
    payload.columns || 3,
    payload.caption,
    payload.key
  );
}

export function $isGalleryNode(
  node: LexicalNode | null | undefined
): node is GalleryNode {
  return node instanceof GalleryNode;
}
