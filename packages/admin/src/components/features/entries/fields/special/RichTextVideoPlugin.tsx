"use client";

/**
 * Rich Text Video Plugin
 *
 * A Lexical plugin that provides a dialog-based interface for embedding
 * YouTube and Vimeo videos into the rich text editor.
 *
 * @module components/entries/fields/special/RichTextVideoPlugin
 * @since 1.1.0
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  Button,
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
  $getSelection,
  $isRangeSelection,
  $insertNodes,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  type LexicalCommand,
} from "lexical";
import { useState, useCallback, useEffect } from "react";

import { Video, AlertCircle } from "@admin/components/icons";

import {
  $createVideoNode,
  parseVideoUrl,
  type VideoPayload,
} from "./VideoNode";

// ============================================================
// Commands
// ============================================================

export const OPEN_VIDEO_DIALOG_COMMAND: LexicalCommand<void> = createCommand(
  "OPEN_VIDEO_DIALOG_COMMAND"
);

export const INSERT_VIDEO_COMMAND: LexicalCommand<VideoPayload> = createCommand(
  "INSERT_VIDEO_COMMAND"
);

// ============================================================
// Component
// ============================================================

export interface RichTextVideoPluginProps {
  disabled?: boolean;
}

export function RichTextVideoPlugin({
  disabled = false,
}: RichTextVideoPluginProps) {
  const [editor] = useLexicalComposerContext();
  const [isOpen, setIsOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [altText, setAltText] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [previewInfo, setPreviewInfo] = useState<{
    provider: string;
    videoId: string;
  } | null>(null);

  const resetState = useCallback(() => {
    setUrl("");
    setCaption("");
    setAltText("");
    setTitle("");
    setError(null);
    setPreviewInfo(null);
  }, []);

  const openDialog = useCallback(() => {
    if (disabled) return;
    resetState();
    setIsOpen(true);
  }, [disabled, resetState]);

  // Validate and preview URL as user types
  const handleUrlChange = useCallback((value: string) => {
    setUrl(value);
    setError(null);
    if (value.trim()) {
      const parsed = parseVideoUrl(value);
      if (parsed) {
        setPreviewInfo(parsed);
        setError(null);
      } else {
        setPreviewInfo(null);
        // Show helpful error only if URL looks like it could be a video URL
        if (
          value.includes("youtube") ||
          value.includes("youtu.be") ||
          value.includes("vimeo")
        ) {
          setError(
            "Please enter a valid video URL (e.g., youtube.com/watch?v=... or vimeo.com/123456)"
          );
        }
      }
    } else {
      setPreviewInfo(null);
    }
  }, []);

  const insertVideo = useCallback(() => {
    if (!url.trim()) {
      setError("Please enter a video URL");
      return;
    }

    const parsed = parseVideoUrl(url);
    if (!parsed) {
      setError("Unsupported video URL. Please use a YouTube or Vimeo link.");
      return;
    }

    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        const videoNode = $createVideoNode({
          url,
          provider: parsed.provider,
          videoId: parsed.videoId,
          caption: caption || undefined,
          altText: altText || undefined,
          title: title || undefined,
        });
        $insertNodes([videoNode]);
      }
    });

    setIsOpen(false);
    resetState();
  }, [editor, url, caption, altText, title, resetState]);

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
        insertVideo();
      }
    },
    [insertVideo]
  );

  // Register commands
  useEffect(() => {
    return editor.registerCommand(
      OPEN_VIDEO_DIALOG_COMMAND,
      () => {
        openDialog();
        return true;
      },
      COMMAND_PRIORITY_EDITOR
    );
  }, [editor, openDialog]);

  useEffect(() => {
    return editor.registerCommand(
      INSERT_VIDEO_COMMAND,
      payload => {
        editor.update(() => {
          const videoNode = $createVideoNode(payload);
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            $insertNodes([videoNode]);
          }
        });
        return true;
      },
      COMMAND_PRIORITY_EDITOR
    );
  }, [editor]);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Video className="h-5 w-5" />
            Embed Video
          </DialogTitle>
          <DialogDescription>
            Paste a YouTube or Vimeo URL to embed a video.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* URL Input */}
          <div className="space-y-2">
            <Label htmlFor="video-url">Video URL</Label>
            <Input
              id="video-url"
              type="url"
              placeholder="https://www.youtube.com/watch?v=... or https://vimeo.com/..."
              value={url}
              onChange={e => handleUrlChange(e.target.value)}
              disabled={disabled}
              autoFocus
            />
          </div>

          {/* Preview */}
          {previewInfo && (
            <div className="p-3 rounded-none bg-primary/5 text-sm">
              <span className="font-medium capitalize">
                {previewInfo.provider}
              </span>{" "}
              video detected (ID: {previewInfo.videoId})
            </div>
          )}

          {/* Alt Text Input */}
          <div className="space-y-2">
            <Label htmlFor="video-alt-text">Alt Text (optional)</Label>
            <Input
              id="video-alt-text"
              type="text"
              placeholder="Describe the video for accessibility"
              value={altText}
              onChange={e => setAltText(e.target.value)}
              disabled={disabled}
            />
          </div>

          {/* Title Input */}
          <div className="space-y-2">
            <Label htmlFor="video-title">Title (optional)</Label>
            <Input
              id="video-title"
              type="text"
              placeholder="Internal or display title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              disabled={disabled}
            />
          </div>

          {/* Caption Input */}
          <div className="space-y-2">
            <Label htmlFor="video-caption">Caption (optional)</Label>
            <Input
              id="video-caption"
              type="text"
              placeholder="Add a caption for this video"
              value={caption}
              onChange={e => setCaption(e.target.value)}
              disabled={disabled}
            />
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
          <Button
            type="button"
            onClick={insertVideo}
            disabled={!url.trim() || !previewInfo}
          >
            Embed Video
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
