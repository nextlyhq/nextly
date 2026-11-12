/**
 * The Advanced section's share image row: the picture shared links show, its
 * file and size, where it comes from, and what keeps it from showing in full,
 * with the action that makes a copy of the right size.
 *
 * @module admin/share-image-row
 */
import { Button } from "@nextlyhq/plugin-sdk/admin";
import { Check } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { SeoAnswer } from "../resolver/order";
import { fileNameOf } from "../tab/display";
import { thingsToFix } from "../tab/problems";

import type { AdvancedProps } from "./advanced";
import { AutomaticSource, Chip, LinkAction, Note, SourceRow } from "./parts";
import { Row, RowButton } from "./rows";
import { imageIdOf, type ChosenImage } from "./values";

/** A file's size as a person reads it: `212 KB`. */
function bytesText(bytes: number): string {
  return bytes < 1_000_000
    ? `${Math.max(1, Math.round(bytes / 1000))} KB`
    : `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** A file's kind from its type: `WebP` for `image/webp`. */
function kindText(mimeType: string): string {
  const kind = mimeType.split("/")[1] ?? mimeType;
  const named: Record<string, string> = {
    jpeg: "JPEG",
    png: "PNG",
    webp: "WebP",
    gif: "GIF",
    avif: "AVIF",
    "svg+xml": "SVG",
  };
  return named[kind] ?? kind.toUpperCase();
}

/** The image's name, and its size, weight and kind in one line. */
function ImageSummary({
  shown,
}: {
  shown: ChosenImage | undefined;
}): ReactNode {
  if (shown === undefined) {
    return <div className="text-muted-foreground">No share image yet.</div>;
  }
  const facts = [
    shown.width !== undefined && shown.height !== undefined
      ? `${shown.width} × ${shown.height}`
      : undefined,
    shown.bytes === undefined ? undefined : bytesText(shown.bytes),
    shown.mimeType === undefined ? undefined : kindText(shown.mimeType),
  ].filter((fact): fact is string => fact !== undefined);
  return (
    <>
      <div className="break-all">{shown.filename ?? fileNameOf(shown.url)}</div>
      {facts.length === 0 ? null : (
        <div className="font-mono text-xs text-muted-foreground">
          {facts.join(" · ")}
        </div>
      )}
    </>
  );
}

/** What keeps the picture from showing in full, and the action that fixes it. */
function ImageProblems({
  problems,
  onMake,
  writable,
}: {
  problems: readonly { message: string; fix: string }[];
  onMake: (() => void) | undefined;
  writable: boolean;
}): ReactNode {
  if (problems.length === 0) return null;
  const makeable = onMake !== undefined && problems.some(p => p.fix === "make");
  return (
    <Note tone="warning">
      <b className="font-semibold">
        {thingsToFix(problems.length).replace(/ to fix$/, "")} to fix:{" "}
        {problems.map(problem => problem.message).join("; ")}.
      </b>{" "}
      {/* What every network shows in full: a size and a format alike. */}
      Share images show in full on every network as a 1200 × 630 JPEG or PNG.
      {makeable ? (
        <div className="mt-2">
          <Button
            type="button"
            size="sm"
            className="h-7 px-2.5 text-xs"
            disabled={!writable}
            onClick={onMake}
          >
            Make a share image
          </Button>
        </div>
      ) : null}
    </Note>
  );
}

/** The picture a share image was made from, as the row names it. */
interface MadeFrom {
  /** Its name in a sentence, such as `cover image`. */
  name: string;
  /** Whether it is one of the page's own fields, shown on the page. */
  onPage: boolean;
}

/** A share image made in this visit, and what it was made from. */
interface Made {
  id: string;
  from: MadeFrom;
}

/**
 * What a share image made now is made from: the image chosen for the page,
 * or the page's own picture the automatic one is taken from.
 */
function madeFromOf(props: AdvancedProps, chosen: boolean): MadeFrom {
  if (chosen) return { name: "chosen image", onPage: false };
  const field = props.answer?.image?.field;
  const label =
    field === undefined ? undefined : (props.names.fieldLabels[field] ?? field);
  return { name: label?.toLowerCase() ?? "picture", onPage: true };
}

/** Where the picture comes from, with one way back once one is chosen. */
function ImageSource({
  chosen,
  made,
  image,
  names,
  writable,
  onAutomatic,
}: {
  chosen: boolean;
  made: MadeFrom | undefined;
  image: SeoAnswer["image"];
  names: AdvancedProps["names"];
  writable: boolean;
  onAutomatic: () => void;
}): ReactNode {
  if (!chosen) {
    return image ? (
      <AutomaticSource sourced={image} value="image" names={names} />
    ) : null;
  }
  return (
    <>
      <Chip kind="typed">
        {made ? "Made for this page" : "Chosen for this page"}
      </Chip>
      {made ? <span>from the {made.name}</span> : null}
      <LinkAction disabled={!writable} onClick={onAutomatic}>
        Go back to automatic
      </LinkAction>
    </>
  );
}

/** The picture the row shows: the one chosen, else the automatic one. */
function shownImage(
  props: AdvancedProps,
  chosen: boolean
): ChosenImage | undefined {
  if (chosen) return props.chosenImage;
  const image = props.answer?.image;
  return (
    props.shownImageFile ??
    (image && { ...image.value, filename: fileNameOf(image.value.url) })
  );
}

/** Whether the last share image copy asked for could not be made. */
export interface MakeFailure {
  failed: boolean;
  /** Follows a copy asked for: cleared as it starts, set if none comes back. */
  track: (asked: Promise<string | undefined>) => void;
}

/**
 * A copy that could not be made, said only while the page's image is still
 * the one it was asked for from: choosing another image, or asking again,
 * lets the warning go.
 */
export function useMakeFailure(ogImage: unknown): MakeFailure {
  const image = imageIdOf(ogImage) ?? null;
  const [failedFor, setFailedFor] = useState<
    { image: string | null } | undefined
  >(undefined);
  return {
    failed: failedFor !== undefined && failedFor.image === image,
    track: asked => {
      setFailedFor(undefined);
      void asked.then(id =>
        setFailedFor(id === undefined ? { image } : undefined)
      );
    },
  };
}

/** The picture shown when someone shares the page. */
export function ShareImageRow(props: AdvancedProps): ReactNode {
  const {
    values,
    answer,
    context,
    names,
    writable,
    errors,
    onSet,
    onChooseImage,
    onMakeShareImage,
  } = props;
  // The copy made in this visit; the row says so while it is the page's image.
  const [copy, setCopy] = useState<Made | undefined>(undefined);
  // Whether the last copy asked for could not be made, said in the row.
  const failure = useMakeFailure(values.ogImage);
  const chosen = values.ogImage !== null && values.ogImage !== undefined;
  const made =
    copy !== undefined && copy.id === imageIdOf(values.ogImage)
      ? copy.from
      : undefined;
  const shown = shownImage(props, chosen);
  const make =
    onMakeShareImage &&
    (() => {
      // Named as it was when the copy was asked for, before it replaces it.
      const from = madeFromOf(props, chosen);
      const asked = onMakeShareImage();
      failure.track(asked);
      void asked.then(id => {
        setCopy(id === undefined ? undefined : { id, from });
      });
    });
  return (
    <Row
      error={errors.ogImage}
      label="Share image"
      help="The picture shown when someone shares this page on LinkedIn, X, Slack and others."
      control={
        onChooseImage && (
          <RowButton disabled={!writable} onClick={onChooseImage}>
            {shown === undefined ? "Choose an image" : "Choose another image"}
          </RowButton>
        )
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative h-[62px] w-[88px] flex-none overflow-hidden rounded-md bg-muted">
          {shown && (
            <img
              src={shown.url}
              alt={shown.alt ?? ""}
              className="size-full object-cover"
            />
          )}
        </div>
        <div className="min-w-0 text-[13px] leading-normal text-foreground">
          <ImageSummary shown={shown} />
          <SourceRow>
            <ImageSource
              chosen={chosen}
              made={made}
              image={answer?.image}
              names={names}
              writable={writable}
              onAutomatic={() => onSet("ogImage", null)}
            />
          </SourceRow>
        </div>
      </div>
      {failure.failed ? (
        <Note tone="warning">
          The share image couldn&apos;t be made. Try again, or choose another
          image.
        </Note>
      ) : null}
      {made ? (
        <Note tone="success" icon={<Check className="size-4" />}>
          <span data-testid="seo-share-made">
            Made a 1200 × 630 copy for sharing. The {made.name}
            {made.onPage ? " on the page" : ""} is unchanged.
          </span>
        </Note>
      ) : (
        <ImageProblems
          problems={context?.shareImage?.problems ?? []}
          onMake={make}
          writable={writable}
        />
      )}
    </Row>
  );
}
