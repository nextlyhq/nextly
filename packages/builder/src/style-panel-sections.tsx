"use client";

/**
 * The Style tab's sections: the accordion of sections a block offers, each
 * section's heading and fields, the background's overlay fields offered only
 * over an image, and "CSS properties" last.
 *
 * @module style-panel-sections
 */
import {
  findNode,
  paintsBackgroundImage,
  type NodeStyles,
  type StyleValues,
  type StyleLeaf,
} from "@nextlyhq/blocks-engine";
import { Accordion, AccordionContent, AccordionItem } from "@nextlyhq/ui";
import * as React from "react";

import { CssPropertiesSection, useAddedProperties } from "./add-css-property";
import { SHORTCUT_IDS } from "./block-shortcuts-field";
import { ContentWidthFields } from "./content-width-fields";
import {
  arrangeCssProperties,
  CSS_PROPERTIES_SECTION,
  offersArrange,
} from "./css-properties";
import { FocalFrame } from "./focal-frame";
import type { InspectorSectionKey } from "./inspector-sections";
import { useTabFolds } from "./panel-folds-context";
import { SectionHeading } from "./panel-section";
import {
  ArrangeFields,
  arrangedAway,
  SPACE_PROPERTIES,
  useArrangeReading,
  type ArrangeReading,
} from "./plain-layout-controls";
import { InsideParentFields, useDrawnChildRows } from "./plain-parent-controls";
import { SectionHeld } from "./section-held";
import { SettingSlot, sectionShown, useSettingsMatch } from "./settings-filter";
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
 * point drawn over it, and "CSS properties" last: what each section's tier
 * doesn't show unasked is added there (`css-properties`).
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
  const target = React.useContext(StyleTargetContext);
  const arranged = arrangeCssProperties(
    sections,
    target.kind === "block"
      ? findNode(surroundings.editor.document.nodes, surroundings.nodeId)?.type
      : undefined
  );
  const added = useAddedProperties(surroundings.nodeId);
  // Drawn wherever the block has any Style section, so the tab always ends
  // the same way.
  const css = sections.length === 0 ? undefined : arranged.extras;
  const { open, onOpenChange } = useTabFolds("style", [
    ...arranged.sections.map(section => ({
      key: section.key,
      label: section.label,
      holdsValue: holdsValues(section),
    })),
    ...(css === undefined
      ? []
      : [
          {
            ...CSS_PROPERTIES_SECTION,
            holdsValue: css.some(each => each.row.set),
          },
        ]),
  ]);
  return (
    <FocalFrame.Provider value={{ picture, position, fit }}>
      <Accordion type="multiple" value={open} onValueChange={onOpenChange}>
        {arranged.sections.map(section => (
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
        {css === undefined ? null : (
          <CssPropertiesSection
            extras={css}
            added={added}
            readOnlyReason={readOnlyReason}
            surroundings={surroundings}
          />
        )}
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
  /** Why every control is read-only. */
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
            // Keyed by node: what a field holds stays with the block it was
            // for, and the next block's fields start from its own values.
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
 * A section's properties drawn: those that show unasked and apply, and those
 * holding a value. While the panel is filtered the same rows stay mounted,
 * hidden where the filter keeps nothing of them, so an unsaved or refused
 * value outlives the search. The rest are added in "CSS properties".
 */
function shownProperties(
  properties: readonly InspectedStyleProperty[]
): readonly InspectedStyleProperty[] {
  return properties.filter(property => property.common);
}

/**
 * An open section's fields: its common properties and any that hold a value.
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
  const { shown, arrange } = useSectionRows(section, surroundings);
  return (
    <SectionFields
      sectionKey={section.key}
      shown={shown}
      readOnly={readOnly}
      surroundings={surroundings}
      arrange={arrange}
    />
  );
}

/**
 * A section's rows drawn, with Layout's Arrange: the rows a section's plain
 * controls draw leave (Arrange's, and Inside its parent's Fill / Fit /
 * Fixed), and the panel's filter hides what it doesn't keep.
 */
function useSectionRows(
  section: StyleSection,
  surroundings: StyleFieldSurroundings
): {
  shown: readonly InspectedStyleProperty[];
  arrange: ArrangedSection["arrange"];
} {
  const reading = useArrangeReading(surroundings, offersArrange(section));
  const drawn = useDrawnChildRows(surroundings);
  const arranged = arrangedSection(section.properties, reading);
  const listed = withoutDrawn(section.key, arranged.listed, drawn);
  return { shown: shownProperties(listed), arrange: arranged.arrange };
}

/** "Inside its parent"'s rows, less those its Fill / Fit / Fixed draw. */
function withoutDrawn(
  key: InspectorSectionKey,
  listed: readonly InspectedStyleProperty[],
  drawn: ReadonlySet<string>
): readonly InspectedStyleProperty[] {
  if (key !== "inside-parent") return listed;
  return listed.filter(property => !drawn.has(property.property));
}

/** A Layout section's raw rows, and the Arrange drawn above them. */
interface ArrangedSection {
  readonly listed: readonly InspectedStyleProperty[];
  readonly arrange:
    | {
        readonly reading: ArrangeReading;
        readonly spacing: readonly InspectedStyleProperty[];
      }
    | undefined;
}

/**
 * A container's Layout says its arrangement in plain words. Arrange's rows
 * hold the properties it draws, so they leave the raw rows, except
 * while it reads Custom, when the raw rows are what hold it.
 */
function arrangedSection(
  properties: readonly InspectedStyleProperty[],
  reading: ArrangeReading | undefined
): ArrangedSection {
  if (reading === undefined) return { listed: properties, arrange: undefined };
  if (reading.arrange.mode === "custom") {
    return { listed: properties, arrange: { reading, spacing: [] } };
  }
  const { mode } = reading.arrange;
  return {
    listed: properties.filter(property => !arrangedAway(property, mode)),
    arrange: {
      reading,
      spacing: properties.filter(property =>
        SPACE_PROPERTIES.has(property.property)
      ),
    },
  };
}

/**
 * "Nothing set here yet" for a section showing no row: not under Arrange,
 * whose rows are what a container's Layout shows. Its other properties are
 * added in "CSS properties".
 */
function NothingSetNote({
  shown,
  arrange,
}: {
  shown: number;
  arrange: ArrangedSection["arrange"];
}): React.JSX.Element | null {
  if (shown > 0 || arrange !== undefined) return null;
  return <p className="nx-inspector__note">Nothing set here yet.</p>;
}

/**
 * What a section draws above its rows: Layout's Content width and Arrange,
 * Inside its parent's Width and Height, Size's shortcuts.
 */
function SectionLead({
  sectionKey,
  surroundings,
  arrange,
  minHeightDrawn,
}: {
  sectionKey: InspectorSectionKey;
  surroundings: StyleFieldSurroundings;
  arrange: ArrangedSection["arrange"];
  minHeightDrawn: boolean;
}): React.JSX.Element | null {
  if (sectionKey === "layout") {
    return <LayoutLead surroundings={surroundings} arrange={arrange} />;
  }
  if (sectionKey === "inside-parent") {
    return <InsideParentFields surroundings={surroundings} />;
  }
  if (sectionKey !== "size") return null;
  return (
    <SettingSlot tab="style" ids={SHORTCUTS}>
      <BlockShortcutsFields
        surroundings={surroundings}
        minHeightDrawn={minHeightDrawn}
      />
    </SettingSlot>
  );
}

/** What leads a Layout section: Content width, then a container's Arrange. */
function LayoutLead({
  surroundings,
  arrange,
}: {
  surroundings: StyleFieldSurroundings;
  arrange: ArrangedSection["arrange"];
}): React.JSX.Element {
  return (
    <>
      <SettingSlot tab="style" ids={CONTENT_WIDTH_IDS}>
        <ContentWidthFields surroundings={surroundings} />
      </SettingSlot>
      {arrange === undefined ? null : (
        <ArrangeFields
          surroundings={surroundings}
          reading={arrange.reading}
          spacing={arrange.spacing}
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
  arrange,
}: {
  sectionKey: InspectorSectionKey;
  shown: readonly InspectedStyleProperty[];
  readOnly: boolean;
  surroundings: StyleFieldSurroundings;
  /** A container's Arrange, with the space fields it draws. */
  arrange?: ArrangedSection["arrange"];
}): React.JSX.Element {
  const target = React.useContext(StyleTargetContext);
  const rings =
    sectionKey === "spacing"
      ? spacingRings(shown, surroundings.orientation)
      : undefined;
  return (
    <fieldset className="nx-inspector__fields" disabled={readOnly}>
      <SectionHeld.Provider value={readOnly}>
        <SectionLead
          sectionKey={sectionKey}
          surroundings={surroundings}
          arrange={arrange}
          minHeightDrawn={(rings?.rest ?? shown).some(
            property => property.property === "minHeight"
          )}
        />
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
        <NothingSetNote shown={shown.length} arrange={arrange} />
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
