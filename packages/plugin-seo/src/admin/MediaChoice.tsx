/**
 * One image the settings name, such as the logo or the default share image:
 * the image chosen, with its size, and a way to choose another from the media
 * library or to remove it.
 *
 * @module admin/MediaChoice
 */
import {
  Button,
  MediaPickerDialog,
  useMediaItem,
} from "@nextlyhq/plugin-sdk/admin";
import { useId, useState, type JSX } from "react";

import { Icon } from "./styles";

/** A media item's id, chosen in the media library, or none. */
export function MediaChoice({
  label,
  value,
  onChange,
  emptyHelp,
  chosenHelp,
  shape = "wide",
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  /** What the image is for, said while none is chosen. */
  emptyHelp: string;
  /** Said after the chosen image's size. */
  chosenHelp?: string;
  /** A logo is shown square; a share image wide. */
  shape?: "wide" | "square";
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const labelId = useId();
  const item = useMediaItem(value ?? undefined);
  const media = value === null ? undefined : item.data;
  const size =
    media?.width && media.height ? `${media.width} × ${media.height}` : null;
  const thumbClass =
    shape === "square" ? "nx-seo-thumb square" : "nx-seo-thumb";

  return (
    <div className="nx-seo-field" role="group" aria-labelledby={labelId}>
      <span className="nx-seo-label" id={labelId}>
        {label}
      </span>
      <div className="nx-seo-upl">
        <div className={thumbClass}>
          {media?.url ? (
            <img src={media.thumbnailUrl ?? media.url} alt="" />
          ) : (
            <Icon name="image" />
          )}
        </div>
        <div className="nx-seo-upl-text">
          {value === null ? (
            <p className="nx-seo-help">{emptyHelp}</p>
          ) : (
            <>
              <span>
                {media?.originalFilename ?? media?.filename ?? "Loading…"}
              </span>
              <span className="nx-seo-help">
                {[size, chosenHelp].filter(Boolean).join(" · ")}
              </span>
            </>
          )}
        </div>
        <div className="nx-seo-upl-acts">
          {value !== null ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange(null)}
            >
              Remove
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(true)}
          >
            {value === null ? `Choose ${label.toLowerCase()}` : "Replace"}
          </Button>
        </div>
      </div>
      <MediaPickerDialog
        mode="single"
        open={open}
        onOpenChange={setOpen}
        accept="image/*"
        title={label}
        onSelect={chosen => {
          const [first] = chosen;
          if (first !== undefined) onChange(String(first.id));
          setOpen(false);
        }}
      />
    </div>
  );
}
