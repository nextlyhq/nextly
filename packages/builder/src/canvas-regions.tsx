/**
 * The regions of a page's Layout, drawn on the canvas around the page and
 * locked.
 *
 * A Layout's header and footer are what a visitor sees around the page, so the
 * canvas draws them, from the PUBLISHED Layout and components the host hands
 * over. They are not the page's to edit: nothing in them can be selected,
 * dragged onto or typed into, and a click shows where they come from, with a
 * way to edit the Layout in a new tab so the page's own undo history survives.
 *
 * Drawn as part of the canvas's rendered subtree, inside the canvas root, so
 * whatever surface the canvas lives on (today the admin page, later the
 * editor's own frame) carries them with the page.
 *
 * @module canvas-regions
 */
import type {
  BlockDocument,
  DefinitionsById,
  RegionArea,
} from "@nextlyhq/blocks-engine";
import {
  PageRenderer,
  type PageRendererProps,
  type PartSheet,
} from "@nextlyhq/blocks-react";
import { Lock } from "lucide-react";
import { useId, useRef, useState, type JSX, type KeyboardEvent } from "react";

import { CHROME_ATTRIBUTE } from "./canvas-chrome";

/** One region of the page's Layout, as the host hands it to the canvas. */
export interface CanvasRegion {
  /** Which area: drawn before the page for a header, after it for a footer. */
  readonly area: RegionArea;
  /** The region's document: one instance of the component filling the area. */
  readonly document: BlockDocument;
  /** The PUBLISHED definitions that document reaches, nested ones included. */
  readonly definitions?: DefinitionsById;
  /** What the region is and where it comes from: "Header, from Layout Main". */
  readonly label: string;
  /** A short form shown on the region at rest: "Header · from Layout". */
  readonly badge: string;
  /**
   * The way to edit the Layout, for someone who may update it: a link that
   * opens in a new tab. Absent for anyone else, who gets the label alone.
   */
  readonly edit?: {
    readonly href: string;
    /** The visible text, "Edit Layout ↗". */
    readonly text: string;
    /** The accessible name, which says it opens in a new tab. */
    readonly name: string;
  };
  /** Which part has changes a visitor does not see yet, when one does. */
  readonly note?: string;
}

/** The attribute naming a drawn region's area, for a host scrolling to it. */
export const REGION_ATTRIBUTE = "data-nx-region";

/**
 * One locked region on the canvas.
 *
 * Its content is `inert`: the region's links and forms cannot be followed or
 * focused, and the pointer falls through to the region itself, which answers a
 * click by showing its tag. The region is one focus stop; Enter or Space shows
 * the tag, Tab then reaches the Edit link inside it, and Escape hides it and
 * returns focus to the region.
 *
 * Marked as chrome, so the canvas's selection, hit-testing and link guard all
 * leave it alone: it is not part of the document being edited.
 */
export function CanvasRegionFrame({
  region,
  rendered,
  sheet,
}: {
  region: CanvasRegion;
  /** The canvas's own renderer inputs, less what belongs to the page alone. */
  rendered: Omit<PageRendererProps, "document" | "siteStyles"> | undefined;
  /** How this part treats the site sheet, and the scope it compiles under. */
  sheet: PartSheet;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const frame = useRef<HTMLDivElement | null>(null);
  const tagId = useId();
  const {
    styles: _pageStyles,
    definitions: _pageDefinitions,
    ...shared
  } = rendered ?? {};

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== frame.current) {
      if (event.key === "Escape") {
        setOpen(false);
        frame.current?.focus();
      }
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(true);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div
      ref={frame}
      className="nx-canvas-region"
      {...{ [CHROME_ATTRIBUTE]: "", [REGION_ATTRIBUTE]: region.area }}
      role="group"
      aria-label={region.label}
      aria-describedby={open ? tagId : undefined}
      tabIndex={0}
      data-open={open ? "" : undefined}
      onClick={() => setOpen(true)}
      onKeyDown={onKeyDown}
      onBlur={event => {
        // Closed once focus leaves the region and its tag together, so moving
        // from the region to its Edit link keeps the tag open.
        if (!frame.current?.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <div className="nx-canvas-region__content" inert>
        <PageRenderer
          {...shared}
          {...sheet}
          document={region.document}
          {...(region.definitions === undefined || region.definitions.size === 0
            ? {}
            : { definitions: region.definitions })}
        />
      </div>
      <span className="nx-canvas-region__badge" aria-hidden="true">
        <Lock size={12} />
        {region.badge}
      </span>
      {open ? (
        <div className="nx-canvas-region__tag" id={tagId} role="status">
          <Lock size={14} aria-hidden="true" />
          <span>{region.label}</span>
          {region.note === undefined ? null : (
            <span className="nx-canvas-region__note">{region.note}</span>
          )}
          {region.edit === undefined ? null : (
            <a
              className="nx-canvas-region__edit"
              href={region.edit.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={region.edit.name}
            >
              {region.edit.text}
            </a>
          )}
        </div>
      ) : null}
    </div>
  );
}
