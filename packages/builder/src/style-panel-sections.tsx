"use client";

/**
 * The Style tab's sections: the accordion of sections a block offers, each
 * section's heading and fields, the background's overlay fields offered only
 * over an image, and the More properties list.
 *
 * @module style-panel-sections
 */
import {
  paintsBackgroundImage,
  type NodeStyles,
  type StyleValues,
  type StyleLeaf,
} from "@nextlyhq/blocks-engine";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import * as React from "react";

import { ContentWidthFields } from "./content-width-fields";
import { FocalFrame } from "./focal-frame";
import type { InspectorSectionKey } from "./inspector-sections";
import { useTabFolds } from "./panel-folds-context";
import { SHORTCUT_IDS } from "./block-shortcuts-field";
import {
  SettingSlot,
  sectionShown,
  useSettingsMatch,
  type SettingsMatch,
} from "./settings-filter";
import { SectionHeading } from "./panel-section";
import { SectionHeld } from "./section-held";
import { spacingRings } from "./spacing-box";
import { SpacingBox } from "./spacing-box-fields";
import {
  BlockShortcutsFields,
  BlockPresetsOver,
} from "./style-block-shortcuts";
import {
  StyleTargetContext,
  type StyleFieldSurroundings,
} from "./style-field-surroundings";
import { fieldStyles } from "./style-field-target";
import type { InspectedStyleProperty, StyleSection } from "./style-inspector";
import { StylePropertyFields } from "./style-property-fields";
import type { StyleProvenance } from "./style-provenance";
import type { StyleTarget } from "./style-target";

/**
 * The panel's sections, each folding on its own and remembered as the author
 * left it (`panel-folds`), with the block's picture and fit for the focal
 * point drawn over it.
 */
export function StyleSections({
  sections,
  readOnlyReason,
  surroundings,
  fit,
}: {
  sections: readonly StyleSection[];
  readOnlyReason: React.ComponentProps<
    typeof StyleSectionItem
  >["readOnlyReason"];
  surroundings: StyleFieldSurroundings;
  fit: string | undefined;
}): React.JSX.Element {
  // The picture lent from above, with the fit in force here.
  const { picture, position } = React.useContext(FocalFrame);
  const match = useSettingsMatch();
  const { open, onOpenChange } = useTabFolds(
    "style",
    sections.map(section => ({
      key: section.key,
      label: section.label,
      holdsValue: holdsValues(section),
    }))
  );
  return (
    <FocalFrame.Provider value={{ picture, position, fit }}>
      <Accordion type="multiple" value={open} onValueChange={onOpenChange}>
        {sections.map(section => (
          <StyleSectionItem
            // Keyed by group alone, so a closed section whose heading reads
            // the same is kept as it is for the next block. What a field
            // holds is keyed by node inside it (`SectionBody`).
            key={section.key}
            section={section}
            open={open.includes(section.key)}
            hidden={!sectionShown(match, "style", section.key)}
            readOnlyReason={readOnlyReason}
            {...surroundings}
          />
        ))}
      </Accordion>
    </FocalFrame.Provider>
  );
}

/**
 * The elements whose content is an external resource the box fits, which is
 * where the media fit properties show without being asked for. Not
 * `<picture>`: it only chooses a source, and the `<img>` inside it is the
 * element `object-fit` applies to.
 */
const REPLACED_ELEMENTS: ReadonlySet<string> = new Set([
  "img",
  "video",
  "iframe",
  "embed",
  "object",
  "canvas",
]);

/** Whether the block renders as one of {@link REPLACED_ELEMENTS}. */
export function rendersMedia(
  renderedTag: string | undefined,
  renderedPicture?: string
): boolean {
  // A replaced element, or a picture of the block's own inside a link or a
  // figure: a captioned or linked image's root is not the image.
  if (renderedPicture !== undefined) return true;
  return renderedTag !== undefined && REPLACED_ELEMENTS.has(renderedTag);
}

/** The props one section is drawn from. */
type StyleSectionItemProps = {
  section: StyleSection;
  /** Whether it is the section open, whose fields are drawn. */
  open: boolean;
  /** Whether the panel's filter keeps nothing in it, so it is not drawn. */
  hidden: boolean;
  /** Why every control is read-only, which also withholds "+ More". */
  readOnlyReason: string | undefined;
} & StyleFieldSurroundings;

/** Whether any of a section's properties holds a value. */
function holdsValues(section: StyleSection): boolean {
  return section.properties.some(property => property.set);
}

/**
 * Whether a section draws nothing new: closed both times, it draws only its
 * heading, so it is drawn again only when what the heading says changes. An
 * open section draws its fields, which read everything, and is always drawn.
 */
function sameClosedSection(
  before: StyleSectionItemProps,
  after: StyleSectionItemProps
): boolean {
  if (before.open || after.open) return false;
  return (
    before.hidden === after.hidden &&
    before.section.key === after.section.key &&
    before.section.label === after.section.label &&
    holdsValues(before.section) === holdsValues(after.section)
  );
}

/**
 * One section: its heading, and while it is open, its fields.
 *
 * **The header marks a section that holds values** with a dot and the words
 * "has values" for a screen reader, so an author can see which sections they
 * have touched without opening each one, and the dot is never colour alone.
 *
 * Kept as it is while it stays closed and its heading reads the same, so a
 * selection rebuilds only the sections that change: the open one, and any
 * whose dot comes or goes.
 */
const StyleSectionItem: React.NamedExoticComponent<StyleSectionItemProps> =
  React.memo(function StyleSectionItem({
    section,
    open: _open,
    hidden,
    readOnlyReason,
    ...surroundings
  }: StyleSectionItemProps): React.JSX.Element {
    return (
      <AccordionItem
        value={section.key}
        data-section={section.key}
        hidden={hidden}
      >
        <SectionHeading
          label={section.label}
          holdsValues={holdsValues(section)}
        />
        <AccordionContent>
          <SectionBody
            // Keyed by node: what a field holds, and what "+ More" brought
            // out, stay with the block they were for, and the next block's
            // fields start from its own values.
            key={surroundings.nodeId}
            section={section}
            readOnlyReason={readOnlyReason}
            {...surroundings}
          />
        </AccordionContent>
      </AccordionItem>
    );
  }, sameClosedSection);

/** The spacing box's properties, which the filter keeps it by. */
const SPACING_IDS: readonly string[] = ["margin", "padding"];

/** The block's settings Content width draws, which the filter keeps it by. */
const CONTENT_WIDTH_IDS: readonly string[] = ["contained", "contentWidth"];

/** The Size shortcuts, which the filter keeps them by. */
const SHORTCUTS: readonly string[] = Object.values(SHORTCUT_IDS);

/**
 * A section's properties drawn at once, and those behind "+ More". While the
 * panel is filtered, every property it keeps is drawn at once, "+ More"'s
 * included, and nothing else.
 */
function shownProperties(
  section: StyleSection,
  isRevealed: (property: string) => boolean,
  match: SettingsMatch
): {
  shown: readonly InspectedStyleProperty[];
  more: readonly InspectedStyleProperty[];
} {
  if (match.active) {
    // Every row drawn before stays mounted, hidden where the filter keeps
    // nothing of it, so an unsaved or refused value outlives the search; a
    // kept one from "+ More" is drawn too.
    const kept = match.kept.get("style");
    return {
      shown: section.properties.filter(
        property =>
          property.common ||
          isRevealed(property.property) ||
          kept?.has(property.property) === true
      ),
      more: [],
    };
  }
  return {
    shown: section.properties.filter(
      property => property.common || isRevealed(property.property)
    ),
    more: section.properties.filter(
      property => !property.common && !isRevealed(property.property)
    ),
  };
}

/**
 * An open section's fields: its common properties, any that hold a value,
 * and the rest behind "+ More".
 */
function SectionBody({
  section,
  readOnlyReason,
  orientation,
  nodeId,
  state,
  breakpoint,
  editor,
  policy,
  tokens,
  prefersDark,
  provenanceOf,
  editing,
  onChooseForm,
  breakpoints,
}: Omit<StyleSectionItemProps, "open" | "hidden">): React.JSX.Element {
  const readOnly = readOnlyReason !== undefined;
  /*
   * What the author brought out from "+ More". Held here, in a body keyed by
   * node inside its section, so it lasts while this block stays selected and
   * starts empty for the next. Panel state, like the open section: what the
   * author chose to look at, not anything the page stores — and a property
   * holding a value shows whatever this says, so it can hide nothing set.
   */
  const [revealed, setRevealed] = React.useState<ReadonlySet<string>>(
    () => new Set()
  );
  const isRevealed = (property: string) => revealed.has(property);
  const match = useSettingsMatch();
  const { shown, more } = shownProperties(section, isRevealed, match);
  const surroundings: StyleFieldSurroundings = {
    orientation,
    nodeId,
    state,
    breakpoint,
    editor,
    policy,
    tokens,
    prefersDark,
    provenanceOf,
    editing,
    onChooseForm,
    breakpoints,
  };
  return (
    <>
      <SectionFields
        sectionKey={section.key}
        shown={shown}
        readOnly={readOnly}
        surroundings={surroundings}
      />
      {readOnly || more.length === 0 ? null : (
        <MoreProperties
          sectionLabel={section.label}
          properties={more}
          onReveal={property =>
            setRevealed(current => new Set(current).add(property))
          }
        />
      )}
    </>
  );
}

/**
 * A section's fields: the spacing box where the section draws one, then each
 * shown property as before.
 */
function SectionFields({
  sectionKey,
  shown,
  readOnly,
  surroundings,
}: {
  sectionKey: InspectorSectionKey;
  shown: readonly InspectedStyleProperty[];
  readOnly: boolean;
  surroundings: StyleFieldSurroundings;
}): React.JSX.Element {
  const target = React.useContext(StyleTargetContext);
  const rings =
    sectionKey === "spacing"
      ? spacingRings(shown, surroundings.orientation)
      : undefined;
  return (
    <fieldset className="nx-inspector__fields" disabled={readOnly}>
      <SectionHeld.Provider value={readOnly}>
        {sectionKey === "layout" ? (
          <SettingSlot tab="style" ids={CONTENT_WIDTH_IDS}>
            <ContentWidthFields surroundings={surroundings} />
          </SettingSlot>
        ) : null}
        {sectionKey === "size" ? (
          <SettingSlot tab="style" ids={SHORTCUTS}>
            <BlockShortcutsFields
              surroundings={surroundings}
              minHeightDrawn={(rings?.rest ?? shown).some(
                property => property.property === "minHeight"
              )}
            />
          </SettingSlot>
        ) : null}
        {rings === undefined ? null : (
          <SettingSlot tab="style" ids={SPACING_IDS}>
            <SpacingBox
              margin={rings.margin}
              padding={rings.padding}
              surroundings={surroundings}
            />
          </SettingSlot>
        )}
        {(rings?.rest ?? shown).map(property => (
          <SettingSlot
            key={`${surroundings.nodeId}:${property.property}`}
            tab="style"
            // Min height draws a Section's Height presets over it, so the
            // row is kept for those as well.
            ids={
              property.property === "minHeight"
                ? [property.property, SHORTCUT_IDS.height]
                : [property.property]
            }
          >
            {property.property === "minHeight" ? (
              <BlockPresetsOver surroundings={surroundings} />
            ) : null}
            <StylePropertyFields
              property={withOverlayOffered(property, surroundings, target)}
              namesSection={property.property === sectionKey}
              {...surroundings}
            />
          </SettingSlot>
        ))}
        {shown.length === 0 ? (
          <p className="nx-inspector__note">
            Nothing set here yet. Add a property from More.
          </p>
        ) : null}
      </SectionHeld.Provider>
    </fieldset>
  );
}

/** The background's overlay fields, offered only over an image. */
const OVERLAY_FIELDS: ReadonlySet<string> = new Set([
  "overlay",
  "overlayStrength",
]);

/** The leaf an image or a gradient is traced by. */
const BACKGROUND_IMAGE_LEAF: StyleLeaf = {
  kind: "cssValue",
  cssProperty: "background-image",
  tokenKinds: [],
};

/**
 * The background's controls without its overlay while there is nothing for
 * one to cover: no image or gradient reaching what is edited (from the
 * cascade where it answers, else from what the target stores anywhere), and
 * no overlay of its own to clear.
 */
function withOverlayOffered(
  property: InspectedStyleProperty,
  surroundings: StyleFieldSurroundings,
  target: StyleTarget
): InspectedStyleProperty {
  if (property.property !== "background") return property;
  if (overlayCovers(surroundings, target)) return property;
  return {
    ...property,
    controls: property.controls.filter(
      control => !OVERLAY_FIELDS.has(control.path[0] ?? "")
    ),
  };
}

/**
 * Whether the overlay has something to cover where it is edited, or an overlay
 * of its own to clear. Where the cascade answers, the image that wins here
 * decides, judged as the compiler paints it, so `none` covers nothing whatever
 * another device or state stores; where it cannot answer (a shared style being
 * edited, which the panel does not trace), what the target stores anywhere.
 */
function overlayCovers(
  surroundings: StyleFieldSurroundings,
  target: StyleTarget
): boolean {
  const { styles } = fieldStyles(
    target,
    surroundings.editor,
    surroundings.nodeId
  );
  if (anyAddress(styles, storesOverlay)) return true;
  const answer = surroundings.provenanceOf(BACKGROUND_IMAGE_LEAF);
  if (answer !== undefined) return winningImagePaints(answer.provenance);
  return anyAddress(styles, paintsImage);
}

/**
 * Whether the image a provenance names paints one: a value rather than a
 * keyword that clears it, by the compiler's own judgement. The image and the
 * gradient both write `background-image`, so the trace often cannot say which
 * control wrote the winner; it is still the winner, and its value decides.
 */
function winningImagePaints(provenance: StyleProvenance): boolean {
  return (
    provenance.kind !== "unset" &&
    paintsBackgroundImage("gradient", provenance.entry.value)
  );
}

/** Whether any state and device of these styles holds what `test` asks. */
function anyAddress(
  styles: NodeStyles | undefined,
  test: (values: StyleValues | undefined) => boolean
): boolean {
  return Object.values(styles ?? {}).some(byBreakpoint =>
    Object.values(byBreakpoint ?? {}).some(test)
  );
}

/** One address's background, when it is an object. */
function backgroundAt(
  values: StyleValues | undefined
): Record<string, unknown> | undefined {
  const background = values?.background;
  return typeof background === "object" &&
    background !== null &&
    !Array.isArray(background)
    ? (background as Record<string, unknown>)
    : undefined;
}

/** Whether one address stores an overlay of its own. */
function storesOverlay(values: StyleValues | undefined): boolean {
  const background = backgroundAt(values);
  return (
    background !== undefined &&
    [...OVERLAY_FIELDS].some(field => Object.hasOwn(background, field))
  );
}

/**
 * Whether one address's values paint an image or a gradient, judged as the
 * compiler judges it: `none` clears an image, and an overlay over it would
 * cover nothing.
 */
function paintsImage(values: StyleValues | undefined): boolean {
  return (
    paintsBackgroundImage("gradient", values?.backgroundGradient) ||
    paintsBackgroundImage("url", backgroundAt(values)?.url)
  );
}

/**
 * The section's "+ More": a menu of the properties it does not show yet.
 *
 * Choosing one shows its control; it stays shown for this block until the
 * panel is left, and for good once it holds a value.
 */
function MoreProperties({
  sectionLabel,
  properties,
  onReveal,
}: {
  sectionLabel: string;
  properties: readonly InspectedStyleProperty[];
  onReveal: (property: string) => void;
}): React.JSX.Element {
  return (
    // Not modal: a modal menu marks the editor around it aria-hidden while
    // its controls stay focusable (axe: aria-hidden-focus).
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="nx-style-inspector__more"
          aria-label={`More ${sectionLabel.toLowerCase()} properties`}
        >
          + More
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {properties.map(property => (
          <DropdownMenuItem
            key={property.property}
            onSelect={() => onReveal(property.property)}
            title={property.summary}
          >
            {property.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
