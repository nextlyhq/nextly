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

import {
  chosenFile,
  failureWords,
  IMAGE_STATE_WORDS,
} from "./canvas/image-states-model";
import { commitOnEnter } from "./commit-on-enter";
import { ContentServicesContext, type PickedMedia } from "./content-services";
import { useFieldDescription } from "./css-hint";
import { refusedBy } from "./focal-point-field";
import { InheritedValue } from "./inherited-value";
import { MediaChoice } from "./media-controls";

type CommitOutcome = "applied" | "refused" | "unchanged";

/**
 * Words that name no image: `none`, which clears an image set at an earlier
 * state, and the CSS-wide keywords, in any case, as the page reads them.
 */
const NO_IMAGE_WORDS = /^(none|inherit|initial|unset|revert|revert-layer)$/i;

/** What a stored value says about the image: an image, a keyword, or nothing. */
function readStored(
  stored: StyleValue | undefined
): { image: string } | { keyword: string } | undefined {
  if (typeof stored !== "string") return undefined;
  const value = stored.trim();
  if (value === "") return undefined;
  return NO_IMAGE_WORDS.test(value) ? { keyword: value } : { image: value };
}

/**
 * A short name for an image's address: its file name, decoded where it can
 * be, else as written (a `%` that starts no escape is a character).
 */
function imageName(address: string): string {
  const path = address.split(/[?#]/, 1)[0] ?? address;
  const last = path.split("/").filter(Boolean).pop();
  if (last === undefined) return address;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
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
  const read = readStored(stored);
  const image = read !== undefined && "image" in read ? read.image : undefined;
  const keyword =
    read !== undefined && "keyword" in read ? read.keyword : undefined;
  // What reaches the field from elsewhere (an earlier state or a wider
  // device), said when nothing is set here.
  const inherited = readStored(React.useContext(InheritedValue));
  const [issue, setIssue] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);
  // Counts the writes started here, so an upload that finishes after a later
  // choice (a pasted link) does not overwrite it.
  const writes = React.useRef(0);

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
  // The file chosen is checked as the canvas's Image checks it, and its
  // failure is said in the same words.
  const upload = async (files: FileList | null) => {
    const uploadMedia = services?.uploadMedia;
    const chosen = chosenFile(files);
    if (uploadMedia === undefined || chosen === undefined) return;
    if (!chosen.image) {
      setIssue(`${IMAGE_STATE_WORDS.notImage}.`);
      return;
    }
    const ticket = ++writes.current;
    setIssue(null);
    setUploading(true);
    try {
      const media = await uploadMedia(chosen.file);
      if (ticket === writes.current) writePicked(media);
    } catch (error) {
      if (ticket === writes.current) setIssue(failureWords(error));
    } finally {
      setUploading(false);
    }
  };

  // A pasted link is written as it is; the field empties once it holds.
  const commitLink = (input: HTMLInputElement) => {
    const link = input.value.trim();
    if (link === "") return;
    writes.current += 1;
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
      {keyword === undefined ? null : (
        // A keyword set here (`none` clears an earlier image): said, and
        // removable, rather than looking like nothing is set.
        <p className="nx-inspector__note">No image here ({keyword}).</p>
      )}
      {read === undefined && inherited !== undefined && "image" in inherited ? (
        <p className="nx-inspector__note" title={inherited.image}>
          Inherits {imageName(inherited.image)}
        </p>
      ) : null}
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
            stored={image ?? null}
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
                const files = event.currentTarget.files;
                void upload(files);
                event.currentTarget.value = "";
              }}
            />
          </>
        ) : null}
        {image === undefined && keyword === undefined ? null : (
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
          disabled={uploading}
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
