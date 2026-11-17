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
import {
  paintsBackgroundImage,
  type StyleValue,
} from "@nextlyhq/blocks-engine";
import { Button, Input } from "@nextlyhq/ui";
import * as React from "react";

import {
  chosenFile,
  failureWords,
  IMAGE_STATE_WORDS,
} from "./canvas/image-states-model";
import { commitOnEnter } from "./commit-on-enter";
import {
  ContentServicesContext,
  type ContentServices,
  type PickedMedia,
} from "./content-services";
import { useFieldDescription } from "./css-hint";
import { refusedBy } from "./focal-point-field";
import { InheritedValue } from "./inherited-value";
import { MediaChoice } from "./media-controls";
import { StyleTargetContext } from "./style-field-surroundings";
import { targetKey } from "./style-field-target";

type CommitOutcome = "applied" | "refused" | "unchanged";

/**
 * What a stored value says about the image: an image, a keyword that paints
 * none (`none`, `inherit`, however escaped), or nothing. Whether it paints is
 * the compiler's own answer, so the field and the page never disagree.
 */
function readStored(
  stored: StyleValue | undefined
): { image: string } | { keyword: string } | undefined {
  if (typeof stored !== "string") return undefined;
  const value = stored.trim();
  if (value === "") return undefined;
  return paintsBackgroundImage("url", value)
    ? { image: value }
    : { keyword: value };
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

/** The image's writes, and what this field says about them. */
function useImageWrites(
  services: ContentServices | undefined,
  onCommit: (value: StyleValue | null) => CommitOutcome
) {
  const [issue, setIssue] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  // Counts the writes started here, so an upload that finishes after a later
  // choice (a pasted link) does not overwrite it.
  const writes = React.useRef(0);
  // The newest commit, which writes against the page as it is now: an upload
  // finishing later must not write through the one it started with, whose
  // page may since have changed (another style set meanwhile).
  const commitNow = React.useRef(onCommit);
  // What the field edits now: the block, or one of its shared styles. An
  // upload belongs to the one it started on, and is dropped if the author
  // has since moved to another, rather than written there.
  const target = targetKey(React.useContext(StyleTargetContext));
  const targetNow = React.useRef(target);
  React.useEffect(() => {
    commitNow.current = onCommit;
    targetNow.current = target;
  });

  // A picked or uploaded file is written by its address; one without an
  // address has nothing a page could draw.
  const writePicked = (media: PickedMedia) => {
    if (typeof media.url !== "string" || media.url === "") {
      setIssue("That file has no address to show it from.");
      return;
    }
    setIssue(null);
    commitNow.current(media.url);
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
    const startedOn = targetNow.current;
    setIssue(null);
    setUploading(true);
    try {
      const media = await uploadMedia(chosen.file);
      if (ticket !== writes.current) return;
      if (targetNow.current !== startedOn) {
        setIssue(
          "The upload finished after you switched to another style, so it wasn't used here. Choose it again."
        );
        return;
      }
      writePicked(media);
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
  // A newer choice than any upload still running, which it must not undo.
  const remove = () => {
    writes.current += 1;
    setIssue(null);
    onCommit(null);
  };
  return { issue, uploading, writePicked, upload, commitLink, remove };
}

/**
 * What the field says is set: a keyword set here, the image reaching it
 * from elsewhere while nothing is set here, or the image's thumbnail.
 */
function ImageSummary({
  read,
  inherited,
}: {
  read: ReturnType<typeof readStored>;
  inherited: ReturnType<typeof readStored>;
}): React.JSX.Element | null {
  if (read !== undefined && "keyword" in read) {
    // `none` clears an earlier image: said, and removable, rather than
    // looking like nothing is set.
    return (
      <p className="nx-inspector__note">No image here ({read.keyword}).</p>
    );
  }
  if (read === undefined) {
    return inherited !== undefined && "image" in inherited ? (
      <p className="nx-inspector__note" title={inherited.image}>
        Inherits {imageName(inherited.image)}
      </p>
    ) : null;
  }
  return (
    <div className="nx-inspector__media-chosen">
      <img
        className="nx-inspector__media-thumb"
        src={read.image}
        alt=""
        aria-hidden="true"
      />
      <div className="nx-inspector__media-text">
        <p className="nx-inspector__media-name" title={read.image}>
          {imageName(read.image)}
        </p>
      </div>
    </div>
  );
}

/** Upload, with the hidden file chooser it opens. */
function UploadButton({
  uploading,
  onFiles,
}: {
  uploading: boolean;
  onFiles: (files: FileList | null) => void;
}): React.JSX.Element {
  const fileInput = React.useRef<HTMLInputElement>(null);
  return (
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
          onFiles(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />
    </>
  );
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
  // What reaches the field from elsewhere (an earlier state or a wider
  // device), said when nothing is set here.
  const inherited = readStored(React.useContext(InheritedValue));
  const { issue, uploading, writePicked, upload, commitLink, remove } =
    useImageWrites(services, onCommit);
  const Picker = services?.MediaPicker;
  const canUpload = image === undefined && services?.uploadMedia !== undefined;

  return (
    <div
      id={id}
      role="group"
      aria-labelledby={labelledBy}
      className="nx-background-image"
    >
      <ImageSummary read={read} inherited={inherited} />
      <div className="nx-background-image__actions">
        {Picker === undefined ? null : (
          <MediaChoice
            Picker={Picker}
            label="Background image"
            // The library is asked for files, not addresses, so nothing is
            // preselected; the button reads "Replace" once an image is set.
            stored={image ?? null}
            // An address is no media id: the library opens with nothing
            // selected, and the button still reads "Replace".
            selected={null}
            accept="image/*"
            disabled={uploading}
            onChoose={writePicked}
          />
        )}
        {canUpload ? (
          <UploadButton
            uploading={uploading}
            onFiles={files => void upload(files)}
          />
        ) : null}
        {read === undefined ? null : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label="Remove background image"
            onClick={remove}
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
