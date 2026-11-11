/**
 * The Advanced section's share image row: the picture shared links show, its
 * file and size, where it comes from, and what keeps it from showing in full,
 * with the action that makes a copy of the right size.
 *
 * @module admin/share-image-row
 */
import { Button } from "@nextlyhq/ui";
import { CircleCheck } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { SeoAnswer } from "../resolver/order";
import { fileNameOf } from "../tab/display";
import { thingsToFix } from "../tab/problems";

import type { AdvancedProps } from "./advanced";
import { AutomaticSource, Chip, LinkAction, Note, SourceRow } from "./parts";
import { Row, RowButton } from "./rows";
import type { ChosenImage } from "./values";

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
      Share images show in full at 1200 × 630.
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
  made: boolean;
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
  // Made in this visit: what the row says once the copy is the page's image.
  const [made, setMade] = useState(false);
  const chosen = values.ogImage !== null && values.ogImage !== undefined;
  const shown = shownImage(props, chosen);
  const make =
    onMakeShareImage &&
    (() => {
      void onMakeShareImage().then(setMade);
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
              onAutomatic={() => {
                setMade(false);
                onSet("ogImage", null);
              }}
            />
          </SourceRow>
        </div>
      </div>
      {made && chosen ? (
        <Note icon={<CircleCheck className="size-4 text-success-text" />}>
          Made a 1200 × 630 copy for sharing. The picture on the page is
          unchanged.
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
