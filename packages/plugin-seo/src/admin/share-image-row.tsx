/**
 * The Advanced section's share image row: the picture shared links show, its
 * file and size, where it comes from, and what keeps it from showing in full,
 * with the action that makes a copy of the right size.
 *
 * @module admin/share-image-row
 */
import { Button } from "@nextlyhq/plugin-sdk/admin";
import { Check } from "lucide-react";
import type { ReactNode } from "react";

import type { SeoAnswer } from "../resolver/order";
import { fileNameOf } from "../tab/display";
import { thingsToFix } from "../tab/problems";

import type { AdvancedProps } from "./advanced";
import { AutomaticSource, Chip, LinkAction, Note, SourceRow } from "./parts";
import { Row, RowButton } from "./rows";
import {
  failureText,
  makeLabel,
  MAKING_TEXT,
  type MadeFrom,
  type ShareImageMaking,
} from "./share-image-making";
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
/**
 * Whether a 1200 × 630 copy made from the image fixes any of its problems:
 * the one decision behind "Make a share image", beside the notice above the
 * fields and in this row alike.
 */
export function copyFixes(
  problems: readonly { fix: string }[] | undefined
): boolean {
  return (problems ?? []).some(problem => problem.fix === "make");
}

function ImageProblems({
  problems,
  onMake,
  busy,
  writable,
}: {
  problems: readonly { message: string; fix: string }[];
  onMake: (() => void) | undefined;
  /** Whether a copy is being made now, from here or the notice. */
  busy: boolean;
  writable: boolean;
}): ReactNode {
  if (problems.length === 0) return null;
  const makeable = onMake !== undefined && copyFixes(problems);
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
            disabled={!writable || busy}
            onClick={onMake}
          >
            {makeLabel(busy)}
          </Button>
        </div>
      ) : null}
    </Note>
  );
}

/**
 * What a share image made now is made from: the image chosen for the page,
 * or the page's own picture the automatic one is taken from. Named as it is
 * when the copy is asked for, before the copy replaces it.
 */
export function madeFromOf(
  answer: SeoAnswer | undefined,
  names: AdvancedProps["names"],
  chosen: boolean
): MadeFrom {
  if (chosen) return { name: "chosen image", onPage: false };
  const field = answer?.image?.field;
  const label =
    field === undefined ? undefined : (names.fieldLabels[field] ?? field);
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
  // A card cut from the page's picture is what networks are given, so the
  // row shows the card rather than the picture's own file.
  if (image?.madeFrom !== undefined) {
    return {
      ...image.value,
      filename: `share card of ${fileNameOf(image.madeFrom.url)}`,
      mimeType: "image/jpeg",
    };
  }
  return (
    props.shownImageFile ??
    (image && { ...image.value, filename: fileNameOf(image.value.url) })
  );
}

/**
 * What the row says of a card the plugin cut from the page's picture: what
 * it was cut from, and that it follows that picture.
 */
function CardMade({
  props,
  madeFrom,
}: {
  props: AdvancedProps;
  madeFrom: NonNullable<SeoAnswer["image"]>["madeFrom"];
}): ReactNode {
  if (madeFrom === undefined) return null;
  const name = madeFromOf(props.answer, props.names, false).name;
  const size =
    madeFrom.width === undefined || madeFrom.height === undefined
      ? ""
      : ` (${madeFrom.width} × ${madeFrom.height})`;
  return (
    <Note>
      <span data-testid="seo-share-card-made">
        Networks show the {name}
        {size} as this 1200 × 630 copy, cut around its focal point and made
        automatically. It follows the {name}: a new picture or focal point makes
        a new copy.
      </span>
    </Note>
  );
}

/**
 * What the row says of a copy asked for from it: a status kept in place, so
 * a screen reader hears the copy being made and why one couldn't be, and the
 * note that shows a failure.
 */
function MakeStatus({ making }: { making: ShareImageMaking }): ReactNode {
  const failure = making.failureAt("row");
  return (
    <>
      {/* Said in short: the note below shows the rest. */}
      <p role="status" className="sr-only">
        {making.busy
          ? MAKING_TEXT
          : failure === undefined
            ? ""
            : failureText(failure, "").trim()}
      </p>
      {failure === undefined ? null : (
        <Note tone="warning">
          {failureText(failure, "Try again, or choose another image.")}
        </Note>
      )}
    </>
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
    making,
  } = props;
  const chosen = values.ogImage !== null && values.ogImage !== undefined;
  // The copy made in this visit, from here or the notice, while it is the
  // page's image: the panel keeps one state for both.
  const made = making?.made?.from;
  const shown = shownImage(props, chosen);
  const ask = making?.make;
  const make = ask && (() => ask("row", madeFromOf(answer, names, chosen)));
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
      {making === undefined ? null : <MakeStatus making={making} />}
      {chosen ? null : (
        <CardMade props={props} madeFrom={answer?.image?.madeFrom} />
      )}
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
          busy={making?.busy ?? false}
          writable={writable}
        />
      )}
    </Row>
  );
}
