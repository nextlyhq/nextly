"use client";

/**
 * The canvas's "No header yet" band, from the editor's side: where the site's
 * default header & footer set shows nothing, on a page that follows it, the
 * band says so and offers the two ways to fill it.
 *
 * - "Create a header" makes the starter's design into a new header, as the
 *   author, puts it in the default, and opens it for editing in place once
 *   the canvas draws it.
 * - "Use a component" opens the components marked for that area, the same
 *   list the starter's card offers, anchored where the band's button is.
 *
 * Offered only to someone who may update and publish sets, as the list's
 * read says; anyone else is told who can. Not drawn where code draws the
 * site's header and footer, and not before that read answers, so the band
 * never offers what it then takes back.
 *
 * @module admin/editor/empty-region-bands
 */
import type { RegionArea } from "@nextlyhq/blocks-engine";
import type {
  CanvasRegion,
  EmptyRegionAnchor,
  EmptyRegionBandProps,
} from "@nextlyhq/builder/shell";
import { Popover, PopoverAnchor, PopoverContent, toast } from "@nextlyhq/ui";
import { useEffect, useId, useMemo, useRef, useState, type JSX } from "react";

import type { SiteHeaderFooter } from "../../site-header-footer";
import {
  createInDefaultArea,
  useAreaComponents,
  type AreaComponentsRead,
} from "../layout-area-client";
import type { EmptyDefaultArea } from "../page-layout";

import { AreaComponentList, useChooseInArea } from "./use-a-component";

/** What the band says and offers, by area. */
const BAND_WORDS: Readonly<
  Record<RegionArea, { sentence: string; create: string; ask: string }>
> = {
  header: {
    sentence:
      "No header yet. Pages on this site show no header until you add one.",
    create: "Create a header",
    ask: "Ask someone who can change the site's header.",
  },
  footer: {
    sentence:
      "No footer yet. Pages on this site show no footer until you add one.",
    create: "Create a footer",
    ask: "Ask someone who can change the site's footer.",
  },
};

/** What "Use a component" opened: which area, into which set, from where. */
interface OpenMenu {
  readonly area: RegionArea;
  readonly setId: string;
  readonly anchor: EmptyRegionAnchor;
}

export interface EmptyRegionBands {
  /** The bands, by area, for the canvas; none where nothing is empty. */
  readonly bands:
    | Partial<Readonly<Record<RegionArea, EmptyRegionBandProps>>>
    | undefined;
  /** The "Use a component" menu a band opened, while it is open. */
  readonly menu: OpenMenu | null;
  readonly closeMenu: () => void;
  /** The area a header was just created in, until it is opened in place. */
  readonly created: RegionArea | null;
  /** The created header was opened, or there is nothing to open. */
  readonly createdHandled: () => void;
}

/** The ways a band with the right to fill it offers, by area. */
interface BandWays {
  readonly create: (area: RegionArea) => void;
  readonly openMenu: (menu: OpenMenu) => void;
  readonly creating: RegionArea | null;
}

/**
 * One area's band: none until the read says who may fill it, so it never
 * offers what it takes back; who to ask for anyone who may not, or where the
 * read failed; otherwise both ways to fill it.
 */
function bandFor(
  entry: EmptyDefaultArea | undefined,
  read: AreaComponentsRead,
  ways: BandWays
): EmptyRegionBandProps | undefined {
  if (entry === undefined) return undefined;
  if (read.data === undefined && read.error === null) return undefined;
  const words = BAND_WORDS[entry.area];
  if (read.data?.meta.mayChoose !== true) {
    return { sentence: words.sentence, actions: { ask: words.ask } };
  }
  return {
    sentence: words.sentence,
    actions: {
      create: words.create,
      onCreate: () => ways.create(entry.area),
      use: "Use a component",
      onUse: anchor =>
        ways.openMenu({ area: entry.area, setId: entry.setId, anchor }),
      busy: ways.creating === entry.area,
    },
  };
}

/** The bands by area, or none at all where neither area has one. */
function bandsOf(
  header: EmptyRegionBandProps | undefined,
  footer: EmptyRegionBandProps | undefined
): EmptyRegionBands["bands"] {
  if (header === undefined && footer === undefined) return undefined;
  return {
    ...(header === undefined ? {} : { header }),
    ...(footer === undefined ? {} : { footer }),
  };
}

/** What a refused create says: the route's own words, or a plain fallback. */
function createRefusal(error: unknown, area: RegionArea): string {
  return error instanceof Error && error.message !== ""
    ? error.message
    : `The ${area} could not be created. Try again.`;
}

/**
 * The bands for the default's empty areas, as the module docblock describes.
 * What they open is drawn over the canvas by {@link EmptyRegionBandsOverlay}.
 */
export function useEmptyRegionBands({
  empty,
  siteHeaderFooter,
  reread,
}: {
  readonly empty: readonly EmptyDefaultArea[];
  readonly siteHeaderFooter: SiteHeaderFooter;
  /** Read the regions again, so the canvas draws the header just made. */
  readonly reread: () => void;
}): EmptyRegionBands {
  // Code draws the site's header and footer: nothing for the band to fill.
  const live = siteHeaderFooter === "page-builder" ? empty : [];
  const header = live.find(entry => entry.area === "header");
  const footer = live.find(entry => entry.area === "footer");
  // Whether this author may fill an area, asked of the list's read, only
  // where an area is empty.
  const headerRead = useAreaComponents("header", {
    enabled: header !== undefined,
  });
  const footerRead = useAreaComponents("footer", {
    enabled: footer !== undefined,
  });
  const [creating, setCreating] = useState<RegionArea | null>(null);
  const [created, setCreated] = useState<RegionArea | null>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);

  const create = async (area: RegionArea) => {
    setCreating(area);
    try {
      const { message } = await createInDefaultArea(area);
      toast.success(message);
      reread();
      setCreated(area);
    } catch (error) {
      toast.error(createRefusal(error, area));
    } finally {
      setCreating(null);
    }
  };
  const ways: BandWays = {
    create: area => void create(area),
    openMenu: setMenu,
    creating,
  };
  return {
    bands: bandsOf(
      bandFor(header, headerRead, ways),
      bandFor(footer, footerRead, ways)
    ),
    // Closed once its area is filled, whoever filled it.
    menu:
      menu !== null && live.some(entry => entry.area === menu.area)
        ? menu
        : null,
    closeMenu: () => setMenu(null),
    created,
    createdHandled: () => setCreated(null),
  };
}

/**
 * What the bands open, drawn over the canvas: the "Use a component" menu,
 * and the header just created opened for editing in place once the canvas
 * draws it, since it is drawn only after the choices are read again.
 */
export function EmptyRegionBandsOverlay({
  bands,
  regions,
  requestEdit,
}: {
  readonly bands: EmptyRegionBands;
  /** The regions the canvas draws, watched for the one just created. */
  readonly regions: readonly CanvasRegion[] | undefined;
  /** Edit a region in place; absent for someone who may not. */
  readonly requestEdit: ((area: RegionArea) => void) | undefined;
}): JSX.Element | null {
  const { created, createdHandled, menu, closeMenu } = bands;
  useEffect(() => {
    if (created === null) return;
    if (!(regions ?? []).some(region => region.area === created)) return;
    createdHandled();
    requestEdit?.(created);
  }, [created, createdHandled, regions, requestEdit]);
  return menu === null ? null : (
    <BandMenu
      key={`${menu.area}:${menu.setId}`}
      menu={menu}
      onClose={closeMenu}
    />
  );
}

/**
 * "Use a component", opened from the band: the components marked for the
 * area, anchored on the band's button as the editor's document places it.
 */
function BandMenu({
  menu,
  onClose,
}: {
  readonly menu: OpenMenu;
  readonly onClose: () => void;
}): JSX.Element {
  const listRoot = useRef<HTMLDivElement>(null);
  const listId = useId();
  const { choose } = useChooseInArea(menu.area, menu.setId);
  const { x, y, width, height } = menu.anchor;
  // The button's box, as Radix measures an anchor it cannot hold.
  const anchor = useMemo(
    () => ({
      current: {
        getBoundingClientRect: () => DOMRect.fromRect({ x, y, width, height }),
      },
    }),
    [x, y, width, height]
  );
  return (
    <Popover
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        align="start"
        className="w-72 p-0"
        onOpenAutoFocus={event => {
          // Into the list, so the arrow keys move through it at once.
          event.preventDefault();
          listRoot.current?.focus();
        }}
      >
        <AreaComponentList
          area={menu.area}
          current={null}
          listId={listId}
          listRef={listRoot}
          onChoose={component => {
            onClose();
            void choose(component);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
