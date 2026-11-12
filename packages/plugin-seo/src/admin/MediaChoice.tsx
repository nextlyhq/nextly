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
  SettingsRowGroup,
  useMediaItem,
} from "@nextlyhq/plugin-sdk/admin";
import { ImageIcon } from "lucide-react";
import { useId, useState, type JSX, type ReactNode } from "react";

/** The chosen image, small, with its file name and size; or what it is for. */
function MediaSummary({
  value,
  shape,
  emptyHelp,
  chosenHelp,
}: {
  value: string | null;
  shape: "wide" | "square";
  emptyHelp: string;
  chosenHelp?: string;
}): JSX.Element {
  const item = useMediaItem(value ?? undefined);
  const media = value === null ? undefined : item.data;
  const size =
    media?.width && media.height ? `${media.width} × ${media.height}` : null;
  const name = media?.originalFilename ?? media?.filename ?? "Loading…";
  return (
    <>
      <div
        className={`flex h-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted text-muted-foreground ${shape === "square" ? "w-14" : "w-[107px]"}`}
      >
        {media?.url ? (
          <img
            src={media.thumbnailUrl ?? media.url}
            alt=""
            className="size-full object-cover"
          />
        ) : (
          <ImageIcon className="size-5" aria-hidden="true" />
        )}
      </div>
      {/* A floor on the text's width, so on a narrow screen the buttons wrap
          under it rather than squeezing it into a column of single words. */}
      <div className="grid min-w-40 flex-1 gap-0.5">
        {value === null ? (
          <p className="text-xs leading-normal text-muted-foreground">
            {emptyHelp}
          </p>
        ) : (
          <>
            <span className="truncate text-sm font-medium text-foreground">
              {name}
            </span>
            <span className="text-xs text-muted-foreground">
              {[size, chosenHelp].filter(Boolean).join(" · ")}
            </span>
          </>
        )}
      </div>
    </>
  );
}

/**
 * A media item's id, chosen in the media library, or none: as a Settings row
 * (its label and sentence on the left) or, in first-time setup, stacked.
 */
export function MediaChoice({
  label,
  description,
  value,
  onChange,
  emptyHelp,
  chosenHelp,
  shape = "wide",
  layout = "row",
}: {
  label: string;
  /** The row's one plain sentence, beside the label. */
  description?: ReactNode;
  value: string | null;
  onChange: (value: string | null) => void;
  /** What the image is for, said while none is chosen. */
  emptyHelp: string;
  /** Said after the chosen image's size. */
  chosenHelp?: string;
  /** A logo is shown square; a share image wide. */
  shape?: "wide" | "square";
  layout?: "row" | "stacked";
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const labelId = useId();
  const control = (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <MediaSummary
          value={value}
          shape={shape}
          emptyHelp={emptyHelp}
          {...(chosenHelp === undefined ? {} : { chosenHelp })}
        />
        <div className="flex items-center gap-2">
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
            {value === null
              ? shape === "square"
                ? "Upload logo"
                : "Upload image"
              : "Replace"}
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
    </>
  );
  if (layout === "row") {
    return (
      <SettingsRowGroup label={label} description={description}>
        {control}
      </SettingsRowGroup>
    );
  }
  return (
    <div className="grid gap-2" role="group" aria-labelledby={labelId}>
      <span className="text-sm font-semibold text-foreground" id={labelId}>
        {label}
      </span>
      {control}
    </div>
  );
}
