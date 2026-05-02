"use client";

/**
 * Rich Text Gallery Plugin
 *
 * A Lexical plugin that provides a two-step interface for creating
 * image galleries:
 * 1. Select images via MediaPickerDialog (multi-select)
 * 2. Configure gallery layout (columns, caption)
 *
 * @module components/entries/fields/special/RichTextGalleryPlugin
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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

import { MediaPickerDialog } from "@admin/components/features/media-library/MediaPickerDialog";
import { GalleryHorizontalEnd, X, AlertCircle } from "@admin/components/icons";
import type { Media } from "@admin/types/media";

import {
  $createGalleryNode,
  type GalleryPayload,
  type GalleryImage,
  type GalleryColumns,
} from "./GalleryNode";

// ============================================================
// Commands
// ============================================================

export const OPEN_GALLERY_DIALOG_COMMAND: LexicalCommand<void> = createCommand(
  "OPEN_GALLERY_DIALOG_COMMAND"
);

export const INSERT_GALLERY_COMMAND: LexicalCommand<GalleryPayload> =
  createCommand("INSERT_GALLERY_COMMAND");

// ============================================================
// Component
// ============================================================

export interface RichTextGalleryPluginProps {
  disabled?: boolean;
}

type DialogStep = "closed" | "select" | "configure";

export function RichTextGalleryPlugin({
  disabled = false,
}: RichTextGalleryPluginProps) {
  const [editor] = useLexicalComposerContext();
  const [step, setStep] = useState<DialogStep>("closed");
  const [selectedImages, setSelectedImages] = useState<GalleryImage[]>([]);
  const [columns, setColumns] = useState<GalleryColumns>(3);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);

  /**
   * Opens the gallery dialog (starts with media picker)
   */
  const openDialog = useCallback(() => {
    if (disabled) return;
    setSelectedImages([]);
    setColumns(3);
    setCaption("");
    setError(null);
    setStep("select");
  }, [disabled]);

  /**
   * Handles media selection from MediaPickerDialog
   */
  const handleMediaSelect = useCallback((media: Media[]) => {
    if (media.length < 2) {
      setError("Please select at least 2 images for a gallery");
      return;
    }

    // Convert Media objects to GalleryImage format
    const galleryImages: GalleryImage[] = media.map(m => ({
      src: m.url,
      alt: m.altText || m.originalFilename || "Image",
      title: m.caption ?? undefined,
      width: m.width ?? undefined,
      height: m.height ?? undefined,
    }));

    setSelectedImages(galleryImages);
    setError(null);
    setStep("configure");
  }, []);

  /**
   * Handles MediaPickerDialog close
   */
  const handlePickerOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setStep("closed");
      setSelectedImages([]);
    }
  }, []);

  /**
   * Handles configuration dialog close
   */
  const handleConfigOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setStep("closed");
      setSelectedImages([]);
      setColumns(3);
      setCaption("");
      setError(null);
    }
  }, []);

  /**
   * Goes back to image selection
   */
  const goBackToSelect = useCallback(() => {
    setStep("select");
    setError(null);
  }, []);

  /**
   * Removes an image from the selection
   */
  const removeImage = useCallback((index: number) => {
    setSelectedImages(prev => prev.filter((_, i) => i !== index));
  }, []);

  /**
   * Updates alt text for an image
   */
  const updateAlt = useCallback((index: number, alt: string) => {
    setSelectedImages(prev =>
      prev.map((img, i) => (i === index ? { ...img, alt } : img))
    );
  }, []);

  /**
   * Updates title for an image
   */
  const updateTitle = useCallback((index: number, title: string) => {
    setSelectedImages(prev =>
      prev.map((img, i) => (i === index ? { ...img, title } : img))
    );
  }, []);

  /**
   * Inserts the gallery into the editor
   */
  const insertGallery = useCallback(() => {
    if (selectedImages.length < 2) {
      setError("Please select at least 2 images for a gallery");
      return;
    }

    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        const galleryNode = $createGalleryNode({
          images: selectedImages,
          columns,
          caption: caption || undefined,
        });
        $insertNodes([galleryNode]);
      }
    });

    // Reset and close
    setStep("closed");
    setSelectedImages([]);
    setColumns(3);
    setCaption("");
    setError(null);
  }, [editor, selectedImages, columns, caption]);

  // Register commands
  useEffect(() => {
    return editor.registerCommand(
      OPEN_GALLERY_DIALOG_COMMAND,
      () => {
        openDialog();
        return true;
      },
      COMMAND_PRIORITY_EDITOR
    );
  }, [editor, openDialog]);

  useEffect(() => {
    return editor.registerCommand(
      INSERT_GALLERY_COMMAND,
      payload => {
        editor.update(() => {
          const galleryNode = $createGalleryNode(payload);
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            $insertNodes([galleryNode]);
          }
        });
        return true;
      },
      COMMAND_PRIORITY_EDITOR
    );
  }, [editor]);

  return (
    <>
      {/* Step 1: Media Picker Dialog */}
      <MediaPickerDialog
        mode="multi"
        open={step === "select"}
        onOpenChange={handlePickerOpenChange}
        onSelect={handleMediaSelect}
        accept="image/*"
        title="Select Gallery Images"
      />

      {/* Step 2: Gallery Configuration Dialog */}
      <Dialog open={step === "configure"} onOpenChange={handleConfigOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GalleryHorizontalEnd className="h-5 w-5" />
              Configure Gallery
            </DialogTitle>
            <DialogDescription>
              Adjust your gallery layout and add an optional caption.
            </DialogDescription>
          </DialogHeader>

          {/* Image Preview Grid */}
          {selectedImages.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">
                  {selectedImages.length} image
                  {selectedImages.length !== 1 ? "s" : ""} selected
                </Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={goBackToSelect}
                >
                  Change Selection
                </Button>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {selectedImages.map((image, index) => (
                  <div key={index} className="relative group">
                    <div className="aspect-square rounded-none overflow-hidden bg-primary/5">
                      <img
                        src={image.src}
                        alt={image.alt}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <button
                      type="button"
                      className="absolute top-1 right-1 h-5 w-5 rounded-none bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => removeImage(index)}
                    >
                      <X className="h-3 w-3" />
                    </button>
                    <Input
                      type="text"
                      className="mt-1 h-6 text-xs"
                      placeholder="Alt text"
                      value={image.alt}
                      onChange={e => updateAlt(index, e.target.value)}
                    />
                    <Input
                      type="text"
                      className="mt-1 h-6 text-xs"
                      placeholder="Title"
                      value={image.title || ""}
                      onChange={e => updateTitle(index, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Layout Options */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Columns</Label>
              <Select
                value={String(columns)}
                onValueChange={v =>
                  setColumns(parseInt(v, 10) as GalleryColumns)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">2 Columns</SelectItem>
                  <SelectItem value="3">3 Columns</SelectItem>
                  <SelectItem value="4">4 Columns</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="gallery-caption">Caption (optional)</Label>
              <Input
                id="gallery-caption"
                type="text"
                placeholder="Gallery caption"
                value={caption}
                onChange={e => setCaption(e.target.value)}
              />
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleConfigOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={insertGallery}
              disabled={selectedImages.length < 2}
            >
              Create Gallery ({selectedImages.length} images)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
