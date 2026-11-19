"use client";

/**
 * A Gallery's Content sections the builder draws: Pictures, with
 * "+ Add images", and Layout, with "Columns: 2 / 3 / 4" and
 * "On mobile: 1 / 2" as tiles, the gallery's own "When clicked" following
 * them in the same section.
 *
 * "+ Add images" opens the host's media library to pick several files, and
 * adds one Image per file, in the order they were picked, after the pictures
 * the gallery holds, as ONE step of the history (`addPicturesOps`). The
 * tiles write the gallery's own style values, each choice one step
 * (`gallery-columns.ts`), and are held where a lock holds its design.
 *
 * @module gallery-fields
 */
import { findNode, type BreakpointSet } from "@nextlyhq/blocks-engine";
import { Button } from "@nextlyhq/ui";
import { Plus } from "lucide-react";
import * as React from "react";

import { stackTiers } from "../../columns-layout";
import type { EditorState } from "../../editor-state";
import { HeldByLock } from "../held-by-lock";
import type { PanelSection } from "../panel-section";
import { arrowTo } from "../segment-choices";
import { SettingSlot } from "../settings-filter";

import { ColumnsLayoutGlyph } from "./columns-layout-field";
import type { ContentServices } from "./content-services";
import {
  galleryColumnsHoldValue,
  galleryColumnsOf,
  GALLERY_COLUMNS,
  GALLERY_MOBILE,
  planGalleryColumns,
  planGalleryMobile,
} from "./gallery-columns";
import { addPicturesTo, isGallery, picturesHeld } from "./gallery-pictures";

/** The words these controls use, in one place. */
const GALLERY_FIELD_WORDS = {
  pictures: "Pictures",
  layout: "Layout",
  addImages: "Add images",
  pickerTitle: "Choose images",
  noLibrary: "The media library is not available here.",
  columns: "Columns",
  onMobile: "On mobile",
} as const;

/** "+ Add images", and the library's picker it opens to pick several. */
function AddImages({
  editor,
  nodeId,
  services,
  reasonId,
}: {
  editor: EditorState;
  nodeId: string;
  services: ContentServices | undefined;
  reasonId: string;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const Picker = services?.MediaPicker;
  if (Picker === undefined) {
    return (
      <p className="nx-inspector__note">{GALLERY_FIELD_WORDS.noLibrary}</p>
    );
  }
  const held = picturesHeld(editor, nodeId);
  return (
    <SettingSlot ids={["galleryAddImages"]}>
      <HeldByLock reasonId={held ? reasonId : undefined}>
        <div className="nx-inspector__field" data-content-control="gallery-add">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={held}
            onClick={() => setOpen(true)}
          >
            <Plus size={14} aria-hidden="true" />
            {GALLERY_FIELD_WORDS.addImages}
          </Button>
        </div>
      </HeldByLock>
      {/* Mounted only while open, so each opening starts with nothing
          picked: every pick is a picture to add. */}
      {open ? (
        <Picker
          open
          mode="multi"
          onOpenChange={setOpen}
          title={GALLERY_FIELD_WORDS.pickerTitle}
          accept="image/*"
          initialSelectedIds={new Set()}
          onSelect={media => {
            // Closed here: the picker leaves closing to whoever opened it.
            setOpen(false);
            addPicturesTo(
              editor,
              nodeId,
              media.map(each => each.id)
            );
          }}
        />
      ) : null}
    </SettingSlot>
  );
}

/** A row of count tiles: one tab stop, arrows choosing, as a radio group. */
function CountTiles({
  label,
  counts,
  chosen,
  held,
  onChoose,
}: {
  label: string;
  counts: readonly number[];
  chosen: number | undefined;
  held: boolean;
  onChoose: (count: number) => void;
}): React.JSX.Element {
  const labelId = React.useId();
  const stop = Math.max(0, counts.indexOf(chosen ?? -1));
  const allowed = counts.map(() => !held);
  const choose = (index: number) => {
    const count = counts[index];
    if (!held && count !== undefined) onChoose(count);
  };
  return (
    <div className="nx-inspector__field nx-gallery-columns__row">
      <span className="nx-inspector__field-name" id={labelId}>
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="nx-columns-layout__tiles nx-gallery-columns__tiles"
      >
        {counts.map((count, index) => (
          <button
            key={count}
            type="button"
            role="radio"
            aria-checked={count === chosen}
            tabIndex={index === stop ? 0 : -1}
            className="nx-columns-layout__tile"
            onKeyDown={event => arrowTo(event, index, allowed, choose)}
            onClick={() => choose(index)}
          >
            {/* The count as equal bars, as the Columns row's tiles draw
                theirs; the number is the tile's name. */}
            <ColumnsLayoutGlyph
              layout={{
                key: String(count),
                label: String(count),
                template: undefined,
                count,
                tracks: Array.from({ length: count }, () => 1),
              }}
            />
            <span>{count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Columns and On mobile, writing the gallery's own style values. */
function GalleryColumnsControl({
  editor,
  nodeId,
  breakpoints,
  heldBy,
}: {
  editor: EditorState;
  nodeId: string;
  breakpoints: BreakpointSet | undefined;
  heldBy: string | undefined;
}): React.JSX.Element | null {
  const gallery = findNode(editor.document.nodes, nodeId);
  if (gallery === undefined) return null;
  const tiers = stackTiers(breakpoints);
  const shown = galleryColumnsOf(gallery, tiers);
  const held = heldBy !== undefined;
  const write = (op: ReturnType<typeof planGalleryColumns>) => {
    if (!held && op !== null) editor.apply(op);
  };
  return (
    <HeldByLock reasonId={heldBy}>
      <div className="nx-gallery-columns" data-control="gallery-columns">
        <SettingSlot ids={["galleryColumns"]}>
          <CountTiles
            label={GALLERY_FIELD_WORDS.columns}
            counts={GALLERY_COLUMNS}
            chosen={shown.columns}
            held={held}
            onChoose={count => write(planGalleryColumns(gallery, count, tiers))}
          />
        </SettingSlot>
        {/* Only where the site has a tier at a phone's width. */}
        {tiers.mobile === undefined ? null : (
          <SettingSlot ids={["galleryMobile"]}>
            <CountTiles
              label={GALLERY_FIELD_WORDS.onMobile}
              counts={GALLERY_MOBILE}
              chosen={shown.mobile}
              held={held}
              onChoose={count =>
                write(planGalleryMobile(gallery, count, tiers))
              }
            />
          </SettingSlot>
        )}
      </div>
    </HeldByLock>
  );
}

/** What the Content tab knows of the page around a gallery. */
export interface GallerySectionContext {
  readonly editor: EditorState;
  readonly nodeId: string;
  readonly breakpoints: BreakpointSet | undefined;
  readonly services: ContentServices | undefined;
  /** The id of the lock reason held controls point to. */
  readonly reasonId: string;
  /** That id while a lock holds the gallery's design, else `undefined`. */
  readonly designHeldBy: string | undefined;
}

/**
 * A gallery's builder-drawn Content sections, by the names the inspector
 * gives them (`builderContentSectionsOf`), or none for any other block.
 */
export function galleryContentSections(
  context: GallerySectionContext,
  labels: readonly string[]
): PanelSection[] {
  const { editor, nodeId, breakpoints } = context;
  const gallery = findNode(editor.document.nodes, nodeId);
  if (gallery === undefined || !isGallery(gallery)) return [];
  const sections: PanelSection[] = [];
  for (const label of labels) {
    if (label === GALLERY_FIELD_WORDS.pictures) {
      sections.push({
        key: label,
        label,
        holdsValue: false,
        body: (
          <AddImages
            editor={editor}
            nodeId={nodeId}
            services={context.services}
            reasonId={context.reasonId}
          />
        ),
      });
    } else if (label === GALLERY_FIELD_WORDS.layout) {
      sections.push({
        key: label,
        label,
        holdsValue: galleryColumnsHoldValue(gallery, stackTiers(breakpoints)),
        body: (
          <GalleryColumnsControl
            editor={editor}
            nodeId={nodeId}
            breakpoints={breakpoints}
            heldBy={context.designHeldBy}
          />
        ),
      });
    }
  }
  return sections;
}
