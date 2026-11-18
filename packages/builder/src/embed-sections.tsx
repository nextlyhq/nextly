"use client";

/**
 * The Embed block's Content section, which the builder draws itself in place
 * of the generated rows: the block's declaration still says what is edited
 * there, and an editor without this draws the generated rows instead.
 *
 * - **Link** takes a link as typed or pasted, and stores it through the same
 *   write the canvas's field uses (`embedLinkOp`): with a provider the block
 *   knows, the provider's shape is written as the block's own style values
 *   in the same step. Under it, what was found: "YouTube detected. Size set
 *   from the video." or "Shown as a plain frame".
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
import { Button, Input, Label } from "@nextlyhq/ui";
import * as React from "react";

import { embedLinkOp, linkNote } from "./canvas/embed-states-model";
import type { ContentServices } from "./content-services";
import type { BlockInspection, EditableProp } from "./inspector";
import type { BuilderOp } from "./op-vocabulary";
import { useStoredDraft } from "./stored-draft";

/** The block this section is drawn for. */
const EMBED_BLOCK = "core/embed";

/** The section the block places its settings in: its own label. */
const EMBED_SECTION = "Embed";

/** The words this section adds to the block's own labels. */
export const EMBED_SECTION_WORDS = {
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
  /**
   * Apply an edit as any other edit of the block; whether the editor took
   * it. Used for a link, whose shape is written in the same step.
   */
  readonly onApply: (op: BuilderOp) => boolean;
  /** The document the block is in, for the link's write. */
  readonly document: Parameters<typeof embedLinkOp>[0];
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
      <EmbedLinkField
        id={`${inspection.nodeId}-embed-link`}
        stored={link}
        disabled={!writable("src")}
        onLink={typed => {
          if (typed === "") {
            context.onCommit("src", "");
            return;
          }
          const op = embedLinkOp(context.document, inspection.nodeId, typed);
          if (op !== null) context.onApply(op);
        }}
      />
      {context.rowsOf(rowsNamed(inspection, names))}
      {played && match.thumbnail !== undefined ? (
        <ThumbnailCopy
          link={link}
          copy={context.services?.copyEmbedThumbnail}
          disabled={!writable("poster")}
          onCopied={id => context.onCommit("poster", id)}
        />
      ) : null}
    </>
  );
}

/**
 * The Link field: holds what is typed while focused, stores it on Enter, on
 * leaving the field or at once when pasted, and says what was found.
 */
function EmbedLinkField({
  id,
  stored,
  disabled,
  onLink,
}: {
  readonly id: string;
  readonly stored: string;
  readonly disabled: boolean;
  readonly onLink: (typed: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useStoredDraft(stored);
  const send = (value: string): void => {
    const typed = value.trim();
    if (typed === stored.trim()) return;
    onLink(typed);
  };
  const note = linkNote(stored);
  return (
    <div className="nx-inspector__field" data-content-control="url">
      <Label htmlFor={id}>Link</Label>
      <Input
        id={id}
        type="text"
        inputMode="url"
        value={draft}
        disabled={disabled}
        {...(note === undefined ? {} : { "aria-describedby": `${id}-note` })}
        onChange={event => setDraft(event.currentTarget.value)}
        onBlur={() => send(draft)}
        onKeyDown={event => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          send(draft);
        }}
        onPaste={event => {
          // A link pasted into an empty field is the whole act, as on the
          // canvas: stored at once. Pasting into a link being edited is left
          // to the field.
          if (draft.trim() !== "") return;
          const pasted = event.clipboardData.getData("text/plain").trim();
          if (pasted === "" || /\s/.test(pasted)) return;
          event.preventDefault();
          setDraft(pasted);
          send(pasted);
        }}
      />
      {/* Said again whenever the link changes, so a screen reader hears what
          was found without leaving the field. */}
      <p className="nx-inspector__note" id={`${id}-note`} role="status">
        {note ?? ""}
      </p>
    </div>
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
  // Only the press for the link still stored may store its answer.
  const current = React.useRef(link);
  current.current = link;
  if (copy === undefined) return null;
  return (
    <div className="nx-inspector__field">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled || state === "copying"}
        onClick={() => {
          const asked = link;
          setState("copying");
          copy(asked).then(
            media => {
              if (current.current !== asked) return;
              setState("idle");
              onCopied(media.id);
            },
            () => {
              if (current.current !== asked) return;
              setState("failed");
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
