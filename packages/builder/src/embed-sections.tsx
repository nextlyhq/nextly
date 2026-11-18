"use client";

/**
 * The Embed block's Content section, which the builder draws itself in place
 * of the generated rows: the block's declaration still says what is edited
 * there, and an editor without this draws the generated rows instead.
 *
 * - **Link** is the block's own field, bindable as any is; a link typed or
 *   pasted there takes the provider's shape in the same step (the Content
 *   tab's one write, `commitProp`, uses the canvas field's `embedLinkOp`).
 *   Under it, what was found: "YouTube detected. Size set from the video."
 *   or "Shown as a plain frame".
 * - **Load** and **Poster** only for a link a provider owns, since any other
 *   link is a plain frame loaded with the page; **Poster** only while the
 *   player loads when played, as that is when a poster shows.
 * - **Privacy mode** only for a provider with a privacy-enhanced player.
 * - **Use the video's thumbnail** copies the provider's picture into the
 *   media library through the host, and makes it the poster.
 *
 * @module embed-sections
 */
import { detectEmbed } from "@nextlyhq/blocks-react";
import { Button } from "@nextlyhq/ui";
import * as React from "react";

import { linkNote } from "./canvas/embed-states-model";
import type { ContentServices } from "./content-services";
import type { BlockInspection, EditableProp } from "./inspector";

/** The block this section is drawn for. */
const EMBED_BLOCK = "core/embed";

/** The section the block places its settings in: its own label. */
const EMBED_SECTION = "Embed";

/** The words this section adds to the block's own labels. */
const EMBED_SECTION_WORDS = {
  thumbnail: "Use the video's thumbnail",
  copying: "Copying the thumbnail…",
  copyFailed: "The thumbnail couldn't be copied",
} as const;

/** What drawing the section needs from the Content tab. */
export interface EmbedSectionsContext {
  readonly inspection: BlockInspection;
  /** The block's props as stored. */
  readonly stored: Readonly<Record<string, unknown>>;
  readonly services: ContentServices | undefined;
  /** Whether a prop may be written here: a lock or a content-only area say. */
  readonly writable: (name: string) => boolean;
  readonly onCommit: (name: string, value: unknown) => void;
  /** The generated rows for `rows`, as the tab draws any section's. */
  readonly rowsOf: (rows: readonly EditableProp[]) => React.JSX.Element;
}

/**
 * The body of the Embed's section the builder draws, by its name, or none
 * for any other block.
 */
export function embedSectionBodies(
  context: EmbedSectionsContext
): ReadonlyMap<string, React.JSX.Element> | undefined {
  const { inspection } = context;
  if (inspection.blockName !== EMBED_BLOCK) return undefined;
  return new Map([
    [EMBED_SECTION, <EmbedSection key="embed" context={context} />],
  ]);
}

/** The props, by name, in the order they are drawn. */
function rowsNamed(
  inspection: BlockInspection,
  names: readonly string[]
): EditableProp[] {
  return names.flatMap(name => {
    const row = inspection.props.find(prop => prop.name === name);
    return row === undefined ? [] : [row];
  });
}

function EmbedSection({
  context,
}: {
  readonly context: EmbedSectionsContext;
}): React.JSX.Element {
  const { inspection, stored, writable } = context;
  const link = typeof stored.src === "string" ? stored.src : "";
  const match = detectEmbed(link);
  // As the block reads them: a new Embed stores When played; one stored
  // before the choice reads as Right away.
  const played = match !== undefined && stored.load === "click";
  const names = [
    "title",
    ...(match === undefined ? [] : ["load"]),
    ...(match?.privacyMode === true ? ["privacy"] : []),
    ...(played ? ["poster"] : []),
  ];
  return (
    <>
      {context.rowsOf(rowsNamed(inspection, ["src"]))}
      {/* What the link is, said again whenever it changes, so a screen
          reader hears what was found without leaving the field. */}
      <p className="nx-inspector__note nx-embed-note" role="status">
        {linkNote(link) ?? ""}
      </p>
      {context.rowsOf(
        rowsNamed(inspection, names).map(row =>
          // An Embed stored before Load existed loads with the page, so its
          // unset Load reads as Right away, as the block draws it, rather
          // than as a new Embed's When played.
          row.name === "load" && stored.load === undefined
            ? { ...row, defaultValue: "page" }
            : row
        )
      )}
      {played && match.thumbnail !== undefined ? (
        <ThumbnailCopy
          // One copy per block and link: a reply for another block or link
          // is never stored here, and a new link starts with no copy pending.
          key={`${inspection.nodeId}\n${link}`}
          link={link}
          copy={context.services?.copyEmbedThumbnail}
          disabled={!writable("poster")}
          onCopied={id => context.onCommit("poster", id)}
        />
      ) : null}
    </>
  );
}

/** "Use the video's thumbnail", and what became of the last press. */
function ThumbnailCopy({
  link,
  copy,
  disabled,
  onCopied,
}: {
  readonly link: string;
  readonly copy: ContentServices["copyEmbedThumbnail"];
  readonly disabled: boolean;
  readonly onCopied: (mediaId: string) => void;
}): React.JSX.Element | null {
  const [state, setState] = React.useState<"idle" | "copying" | "failed">(
    "idle"
  );
  // The latest way to store the poster, read when the reply arrives: a
  // callback from the press would write over edits made while it was
  // pending. And whether this copy is still shown, since it is one per
  // block and link.
  const store = React.useRef(onCopied);
  store.current = onCopied;
  const shown = React.useRef(true);
  React.useEffect(
    () => () => {
      shown.current = false;
    },
    []
  );
  if (copy === undefined) return null;
  return (
    <div className="nx-inspector__field">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled || state === "copying"}
        onClick={() => {
          setState("copying");
          copy(link).then(
            media => {
              if (!shown.current) return;
              setState("idle");
              store.current(media.id);
            },
            () => {
              if (shown.current) setState("failed");
            }
          );
        }}
      >
        {state === "copying"
          ? EMBED_SECTION_WORDS.copying
          : EMBED_SECTION_WORDS.thumbnail}
      </Button>
      <p className="nx-inspector__note" role="status">
        {state === "failed" ? `${EMBED_SECTION_WORDS.copyFailed}.` : ""}
      </p>
    </div>
  );
}
