"use client";

/**
 * Lexical Video Embed Node
 *
 * A custom DecoratorNode for rendering embedded videos (YouTube, Vimeo)
 * in the Lexical rich text editor. Parses video URLs and renders responsive iframes.
 *
 * @module components/entries/fields/special/VideoNode
 * @since 1.1.0
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

export type VideoProvider = "youtube" | "vimeo" | "unknown";

export interface VideoPayload {
  url: string;
  provider: VideoProvider;
  videoId: string;
  caption?: string;
  altText?: string;
  title?: string;
  key?: NodeKey;
}

export type SerializedVideoNode = Spread<
  {
    url: string;
    provider: VideoProvider;
    videoId: string;
    caption?: string;
    altText?: string;
    title?: string;
  },
  SerializedLexicalNode
>;

// ============================================================
// URL Parsing Utilities
// ============================================================

/**
 * Extract video provider and ID from a URL.
 */
export function parseVideoUrl(url: string): {
  provider: VideoProvider;
  videoId: string;
} | null {
  // YouTube patterns
  const ytMatch = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  if (ytMatch) {
    return { provider: "youtube", videoId: ytMatch[1] };
  }

  // Vimeo patterns
  const vimeoMatch = url.match(
    /(?:vimeo\.com\/(?:video\/)?|player\.vimeo\.com\/video\/)(\d+)/
  );
  if (vimeoMatch) {
    return { provider: "vimeo", videoId: vimeoMatch[1] };
  }

  return null;
}

/**
 * Get the embed URL for a given provider and video ID.
 */
export function getEmbedUrl(provider: VideoProvider, videoId: string): string {
  switch (provider) {
    case "youtube":
      return `https://www.youtube-nocookie.com/embed/${videoId}`;
    case "vimeo":
      return `https://player.vimeo.com/video/${videoId}`;
    default:
      return "";
  }
}

// ============================================================
// Video Component
// ============================================================

interface VideoComponentProps {
  url: string;
  provider: VideoProvider;
  videoId: string;
  caption?: string;
  altText?: string;
  title?: string;
  nodeKey: NodeKey;
}

function VideoComponent({
  provider,
  videoId,
  caption,
  title,
  altText,
  nodeKey,
}: VideoComponentProps) {
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
      if (node && $isVideoNode(node)) {
        const writableNode = node.getWritable();
        writableNode.setAltText(editData.altText || undefined);
        writableNode.setTitle(editData.title || undefined);
        writableNode.setCaption(editData.caption || undefined);
      }
    });
    setIsEditDialogOpen(false);
  }, [editor, nodeKey, editData]);

  const embedUrl = getEmbedUrl(provider, videoId);

  if (!embedUrl) {
    return (
      <div className="my-4 p-4  border border-primary/5 rounded-none bg-primary/5 text-center text-sm text-muted-foreground">
        Unsupported video URL
      </div>
    );
  }

  return (
    <>
      <figure className="my-4 relative group">
        <div
          className="relative w-full overflow-hidden rounded-none"
          style={{ paddingBottom: "56.25%" }}
        >
          <iframe
            src={embedUrl}
            className="absolute inset-0 w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            title={title || caption || "Embedded video"}
            aria-label={altText || title || caption || "Embedded video"}
            loading="lazy"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10"
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
            <DialogTitle>Edit Video Metadata</DialogTitle>
            <DialogDescription>
              Update accessibility information and metadata for this embedded
              video.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-video-altText">
                Alt Text{" "}
                <span className="text-sm text-muted-foreground">
                  (recommended)
                </span>
              </Label>
              <Input
                id="edit-video-altText"
                value={editData.altText}
                onChange={e =>
                  setEditData(prev => ({ ...prev, altText: e.target.value }))
                }
                placeholder="Describe the video content..."
              />
              <p className="text-sm text-muted-foreground">
                Brief description for accessibility.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-video-title">
                Title{" "}
                <span className="text-sm text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <Input
                id="edit-video-title"
                value={editData.title}
                onChange={e =>
                  setEditData(prev => ({ ...prev, title: e.target.value }))
                }
                placeholder="Video title..."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-video-caption">
                Caption{" "}
                <span className="text-sm text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <Textarea
                id="edit-video-caption"
                value={editData.caption}
                onChange={e =>
                  setEditData(prev => ({ ...prev, caption: e.target.value }))
                }
                placeholder="Caption to display below the video..."
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
// VideoNode Class
// ============================================================

export class VideoNode extends DecoratorNode<React.JSX.Element> {
  __url: string;
  __provider: VideoProvider;
  __videoId: string;
  __caption: string | undefined;
  __altText: string | undefined;
  __title: string | undefined;

  static getType(): string {
    return "video";
  }

  static clone(node: VideoNode): VideoNode {
    return new VideoNode(
      node.__url,
      node.__provider,
      node.__videoId,
      node.__caption,
      node.__altText,
      node.__title,
      node.__key
    );
  }

  constructor(
    url: string,
    provider: VideoProvider,
    videoId: string,
    caption?: string,
    altText?: string,
    title?: string,
    key?: NodeKey
  ) {
    super(key);
    this.__url = url;
    this.__provider = provider;
    this.__videoId = videoId;
    this.__caption = caption;
    this.__altText = altText;
    this.__title = title;
  }

  // Serialization
  exportJSON(): SerializedVideoNode {
    return {
      type: "video",
      version: 1,
      url: this.__url,
      provider: this.__provider,
      videoId: this.__videoId,
      caption: this.__caption,
      altText: this.__altText,
      title: this.__title,
    };
  }

  static importJSON(serializedNode: SerializedVideoNode): VideoNode {
    return $createVideoNode({
      url: serializedNode.url,
      provider: serializedNode.provider,
      videoId: serializedNode.videoId,
      caption: serializedNode.caption,
      altText: serializedNode.altText,
      title: serializedNode.title,
    });
  }

  // DOM
  exportDOM(): DOMExportOutput {
    const div = document.createElement("div");
    div.setAttribute("data-video-provider", this.__provider);
    div.setAttribute("data-video-id", this.__videoId);
    div.setAttribute("data-video-url", this.__url);
    if (this.__altText) div.setAttribute("data-video-alt", this.__altText);
    if (this.__title) div.setAttribute("data-video-title", this.__title);

    const iframe = document.createElement("iframe");
    iframe.setAttribute("src", getEmbedUrl(this.__provider, this.__videoId));
    iframe.setAttribute("allowfullscreen", "true");
    iframe.setAttribute("fram eborder border-primary/5", "0");
    iframe.style.width = "100%";
    iframe.style.aspectRatio = "16/9";
    div.appendChild(iframe);

    if (this.__caption) {
      const caption = document.createElement("p");
      caption.textContent = this.__caption;
      div.appendChild(caption);
    }

    return { element: div };
  }

  static importDOM(): DOMConversionMap | null {
    return {
      iframe: () => ({
        conversion: convertIframeElement,
        priority: 0,
      }),
    };
  }

  createDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "editor-video";
    return span;
  }

  updateDOM(): boolean {
    return false;
  }

  // Accessors
  getUrl(): string {
    return this.__url;
  }

  getProvider(): VideoProvider {
    return this.__provider;
  }

  getVideoId(): string {
    return this.__videoId;
  }

  getCaption(): string | undefined {
    return this.__caption;
  }

  setCaption(caption: string | undefined): void {
    const writable = this.getWritable();
    writable.__caption = caption;
  }

  getAltText(): string | undefined {
    return this.__altText;
  }

  setAltText(altText: string | undefined): void {
    const writable = this.getWritable();
    writable.__altText = altText;
  }

  getTitle(): string | undefined {
    return this.__title;
  }

  setTitle(title: string | undefined): void {
    const writable = this.getWritable();
    writable.__title = title;
  }

  // Decorator
  decorate(): React.JSX.Element {
    return (
      <Suspense fallback={null}>
        <VideoComponent
          url={this.__url}
          provider={this.__provider}
          videoId={this.__videoId}
          caption={this.__caption}
          altText={this.__altText}
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

function convertIframeElement(domNode: Node): DOMConversionOutput | null {
  if (domNode instanceof HTMLIFrameElement) {
    const src = domNode.getAttribute("src") || "";
    const parsed = parseVideoUrl(src);
    if (parsed) {
      return {
        node: $createVideoNode({
          url: src,
          provider: parsed.provider,
          videoId: parsed.videoId,
          altText: domNode.getAttribute("title") || undefined,
          title: domNode.getAttribute("title") || undefined,
        }),
      };
    }
  }
  return null;
}

export function $createVideoNode(payload: VideoPayload): VideoNode {
  return new VideoNode(
    payload.url,
    payload.provider,
    payload.videoId,
    payload.caption,
    payload.altText,
    payload.title,
    payload.key
  );
}

export function $isVideoNode(
  node: LexicalNode | null | undefined
): node is VideoNode {
  return node instanceof VideoNode;
}
