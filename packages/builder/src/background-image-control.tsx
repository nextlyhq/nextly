/**
 * The Background section's image: chosen from the Media library, uploaded, or
 * given by a link, and shown as a thumbnail with Replace and Remove once set.
 *
 * A background image is stored as its address (`background.url` is a URL the
 * page's CSS reads directly), so a file picked from the library or uploaded
 * is written by its URL. Remove clears only the image; nothing else in the
 * Background section changes.
 *
 * @module background-image-control
 */
import type { StyleValue } from "@nextlyhq/blocks-engine";
import { Button, Input } from "@nextlyhq/ui";
import * as React from "react";

import { commitOnEnter } from "./commit-on-enter";
import { ContentServicesContext, type PickedMedia } from "./content-services";
import { useFieldDescription } from "./css-hint";
import { refusedBy } from "./focal-point-field";
import { MediaChoice } from "./media-controls";

type CommitOutcome = "applied" | "refused" | "unchanged";

/** The keyword that clears an image set at an earlier state, not an image. */
const NO_IMAGE = "none";

/** The image a stored value names, or `undefined` for none. */
function storedImage(stored: StyleValue | undefined): string | undefined {
  if (typeof stored !== "string") return undefined;
  const value = stored.trim();
  return value === "" || value === NO_IMAGE ? undefined : value;
}

/** A short name for an image's address: its file name, else the address. */
function imageName(address: string): string {
  const path = address.split(/[?#]/, 1)[0] ?? address;
  const last = path.split("/").filter(Boolean).pop();
  return last === undefined ? address : decodeURIComponent(last);
}

export function BackgroundImageField({
  id,
  labelledBy,
  stored,
  describedBy,
  onCommit,
}: {
  id: string;
  labelledBy: string;
  stored: StyleValue | undefined;
  actionName: string;
  describedBy: string | undefined;
  onCommit: (value: StyleValue | null) => CommitOutcome;
}): React.JSX.Element {
  const services = React.useContext(ContentServicesContext);
  const described = useFieldDescription(describedBy);
  const image = storedImage(stored);
  const [issue, setIssue] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);

  // A picked or uploaded file is written by its address; one without an
  // address has nothing a page could draw.
  const writePicked = (media: PickedMedia) => {
    if (typeof media.url !== "string" || media.url === "") {
      setIssue("That file has no address to show it from.");
      return;
    }
    setIssue(null);
    onCommit(media.url);
  };
  const upload = async (file: File) => {
    const uploadMedia = services?.uploadMedia;
    if (uploadMedia === undefined) return;
    setUploading(true);
    try {
      writePicked(await uploadMedia(file));
    } catch {
      setIssue("The image couldn't be uploaded. Try again.");
    } finally {
      setUploading(false);
    }
  };

  // A pasted link is written as it is; the field empties once it holds.
  const commitLink = (input: HTMLInputElement) => {
    const link = input.value.trim();
    if (link === "") return;
    setIssue(null);
    if (onCommit(link) === "applied") input.value = "";
  };

  return (
    <div
      id={id}
      role="group"
      aria-labelledby={labelledBy}
      className="nx-background-image"
    >
      {image === undefined ? null : (
        <div className="nx-inspector__media-chosen">
          <img
            className="nx-inspector__media-thumb"
            src={image}
            alt=""
            aria-hidden="true"
          />
          <div className="nx-inspector__media-text">
            <p className="nx-inspector__media-name" title={image}>
              {imageName(image)}
            </p>
          </div>
        </div>
      )}
      <div className="nx-background-image__actions">
        {services?.MediaPicker === undefined ? null : (
          <MediaChoice
            Picker={services.MediaPicker}
            label="Background image"
            // The library is asked for files, not addresses, so nothing is
            // preselected; the button reads "Replace" once an image is set.
            stored={image === undefined ? null : ""}
            accept="image/*"
            disabled={uploading}
            onChoose={writePicked}
          />
        )}
        {image === undefined && services?.uploadMedia !== undefined ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
            >
              {uploading ? "Uploading…" : "Upload"}
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={event => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file !== undefined) void upload(file);
              }}
            />
          </>
        ) : null}
        {image === undefined ? null : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label="Remove background image"
            onClick={() => {
              setIssue(null);
              onCommit(null);
            }}
          >
            Remove
          </Button>
        )}
      </div>
      {image === undefined ? (
        <Input
          type="url"
          inputMode="url"
          aria-label="Image link"
          // A refused link (a host the site does not load from) stays in the
          // field, marked, with the reason read beside it.
          aria-invalid={refusedBy(describedBy)}
          aria-describedby={described}
          placeholder="Or paste an image link"
          className="nx-background-image__link"
          onKeyDown={event => {
            const input = event.currentTarget;
            // Enter commits as leaving the field does.
            commitOnEnter(event, () => commitLink(input));
          }}
          onBlur={event => commitLink(event.currentTarget)}
        />
      ) : null}
      {issue === null ? null : (
        <p className="nx-inspector__note" role="alert">
          {issue}
        </p>
      )}
    </div>
  );
}
