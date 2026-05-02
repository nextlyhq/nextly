"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@revnixhq/ui";
import { useState, type ReactElement } from "react";

import { MediaPickerDialog } from "@admin/components/features/media-library/MediaPickerDialog";
import { Pencil, X } from "@admin/components/icons";
import { cn, getAvatarColor, getInitial } from "@admin/lib/utils";

export interface AvatarUploaderProps {
  /** Current avatar URL. Empty string means "no avatar". */
  value: string;
  /** Called with the new URL on pick, or with "" on remove. */
  onChange: (url: string) => void;
  /** Used for the initial-letter fallback and dynamic fallback color. */
  fullName: string;
  /** Disables both pencil and remove buttons. */
  disabled?: boolean;
  /** Optional className applied to the underlying <Avatar>. */
  className?: string;
  /** Optional className overriding the default <AvatarFallback> styling. */
  fallbackClassName?: string;
}

/**
 * Controlled avatar uploader. Parent owns `value` and updates it via `onChange`.
 */
export function AvatarUploader({
  value,
  onChange,
  fullName,
  disabled = false,
  className,
  fallbackClassName,
}: AvatarUploaderProps): ReactElement {
  const [pickerOpen, setPickerOpen] = useState(false);

  const displayName = fullName || "New User";
  const initial = getInitial(fullName);

  return (
    <div className="relative inline-block">
      <Avatar size="2xl" className={className}>
        <AvatarImage
          src={value || undefined}
          alt={`Profile picture for ${displayName}`}
        />
        <AvatarFallback
          className={
            fallbackClassName ??
            cn("text-2xl font-medium bg-primary/5 text-primary")
          }
        >
          {initial}
        </AvatarFallback>
      </Avatar>

      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        disabled={disabled}
        aria-label="Change avatar"
        className={cn(
          "absolute -bottom-1 -right-1 inline-flex h-7 w-7 items-center justify-center rounded-none",
          "bg-primary text-primary-foreground shadow-sm border border-background",
          "hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
          "disabled:opacity-50 disabled:cursor-not-allowed"
        )}
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>

      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          disabled={disabled}
          aria-label="Remove avatar"
          className={cn(
            "absolute -top-1 -right-1 inline-flex h-6 w-6 items-center justify-center rounded-none",
            "bg-destructive text-destructive-foreground shadow-sm border border-background",
            "hover:bg-destructive/90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          <X className="h-3 w-3" />
        </button>
      )}

      {pickerOpen && (
        <MediaPickerDialog
          mode="single"
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          accept="image/*"
          title="Select Avatar"
          onSelect={media => {
            const url = media[0]?.url;
            if (url) onChange(url);
            setPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}
