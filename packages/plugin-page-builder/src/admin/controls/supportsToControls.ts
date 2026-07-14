/**
 * Maps a block's `supports` declaration to grouped inspector controls (spec §4.1).
 * The Style tab renders these groups; each `ControlRef` names a registered control
 * type + the `StyleValues` key it writes.
 */
import { normalizeSupports, type BlockSupports } from "../../core/supports";
import type { ControlRef } from "../../core/types";

export interface ControlGroup {
  group: string;
  controls: ControlRef[];
}

const opts = (...vs: string[]) => vs.map(v => ({ value: v, label: v }));

const WEIGHTS = opts(
  "normal",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "bold"
);
const TRANSFORMS = opts("none", "uppercase", "lowercase", "capitalize");
const STYLES = opts("normal", "italic");
const DECORATIONS = opts("none", "underline", "line-through", "overline");
const WIDTH_ALIGN = [
  { value: "none", label: "None" },
  { value: "wide", label: "Wide" },
  { value: "full", label: "Full width" },
];
const SHADOW_PRESETS = [
  { value: "none", label: "Unset" },
  { value: "0 1px 2px rgba(0,0,0,0.12)", label: "Natural" },
  { value: "0 8px 24px rgba(0,0,0,0.2)", label: "Deep" },
  { value: "6px 6px 0 rgba(0,0,0,0.85)", label: "Sharp" },
  { value: "0 0 0 1px rgba(0,0,0,0.25)", label: "Outlined" },
  {
    value: "0 3px 6px rgba(0,0,0,0.16), 0 3px 6px rgba(0,0,0,0.23)",
    label: "Crisp",
  },
];

export function supportsToControls(
  supports: BlockSupports = {}
): ControlGroup[] {
  const s = normalizeSupports(supports);
  const groups: ControlGroup[] = [];
  const push = (group: string, controls: ControlRef[]) => {
    if (controls.length) groups.push({ group, controls });
  };

  // Typography
  if (s.typography) {
    const t = s.typography;
    const c: ControlRef[] = [];
    if (t.fontSize)
      c.push({
        control: "dimension",
        styleKey: "fontSize",
        label: "Font size",
      });
    if (t.fontFamily)
      c.push({ control: "text", styleKey: "fontFamily", label: "Font family" });
    if (t.fontWeight)
      c.push({
        control: "select",
        styleKey: "fontWeight",
        label: "Weight",
        options: WEIGHTS,
      });
    if (t.lineHeight)
      c.push({
        control: "dimension",
        styleKey: "lineHeight",
        label: "Line height",
      });
    if (t.letterSpacing)
      c.push({
        control: "dimension",
        styleKey: "letterSpacing",
        label: "Letter spacing",
      });
    if (t.wordSpacing)
      c.push({
        control: "dimension",
        styleKey: "wordSpacing",
        label: "Word spacing",
      });
    if (t.textTransform)
      c.push({
        control: "select",
        styleKey: "textTransform",
        label: "Letter case",
        options: TRANSFORMS,
      });
    if (t.fontStyle)
      c.push({
        control: "select",
        styleKey: "fontStyle",
        label: "Appearance",
        options: STYLES,
      });
    if (t.textDecoration)
      c.push({
        control: "select",
        styleKey: "textDecoration",
        label: "Decoration",
        options: DECORATIONS,
      });
    if (t.textAlign)
      c.push({ control: "align", styleKey: "textAlign", label: "Align" });
    if (t.textShadow)
      c.push({ control: "text", styleKey: "textShadow", label: "Text shadow" });
    push("Typography", c);
  }

  // Color
  if (s.color) {
    const c: ControlRef[] = [];
    if (s.color.text)
      c.push({ control: "color", styleKey: "color", label: "Text color" });
    if (s.color.background)
      c.push({
        control: "color",
        styleKey: "backgroundColor",
        label: "Background",
      });
    if (s.color.link) {
      c.push({ control: "color", styleKey: "linkColor", label: "Link" });
      c.push({
        control: "color",
        styleKey: "linkColorHover",
        label: "Link (hover)",
      });
    }
    push("Color", c);
  }

  // Background (image + gradient)
  if (s.background) {
    const c: ControlRef[] = [
      {
        control: "background",
        styleKey: "backgroundImageObj",
        label: "Background image",
      },
    ];
    if (s.background.gradient || (s.color && s.color.gradient)) {
      c.push({
        control: "gradient",
        styleKey: "backgroundGradient",
        label: "Gradient",
      });
    }
    push("Background", c);
  }

  // Dimensions / layout
  if (s.dimensions) {
    const d = s.dimensions;
    const c: ControlRef[] = [];
    if (d.width)
      c.push({ control: "dimension", styleKey: "width", label: "Width" });
    if (d.maxWidth)
      c.push({
        control: "dimension",
        styleKey: "maxWidth",
        label: "Max width",
      });
    if (d.height)
      c.push({ control: "dimension", styleKey: "height", label: "Height" });
    if (d.minHeight)
      c.push({
        control: "dimension",
        styleKey: "minHeight",
        label: "Min height",
      });
    if (d.objectFit)
      c.push({ control: "select", styleKey: "objectFit", label: "Object fit" });
    if (d.overflow)
      c.push({ control: "select", styleKey: "overflow", label: "Overflow" });
    if (d.aspectRatio)
      c.push({
        control: "dimension",
        styleKey: "aspectRatio",
        label: "Aspect ratio",
      });
    c.push({
      control: "select",
      styleKey: "widthAlign",
      label: "Width alignment",
      options: WIDTH_ALIGN,
    });
    push("Layout & size", c);
  }

  // Spacing
  if (s.spacing) {
    const c: ControlRef[] = [];
    if (s.spacing.padding)
      c.push({ control: "spacing", styleKey: "padding", label: "Padding" });
    if (s.spacing.margin)
      c.push({ control: "spacing", styleKey: "margin", label: "Margin" });
    push("Spacing", c);
  }

  // Border & shadow
  if (s.border || s.shadow) {
    const c: ControlRef[] = [];
    if (s.border)
      c.push({ control: "border", styleKey: "border", label: "Border" });
    if (s.border && s.border.radius)
      c.push({
        control: "dimension",
        styleKey: "borderRadius",
        label: "Radius",
      });
    if (s.shadow)
      c.push({
        control: "select",
        styleKey: "boxShadow",
        label: "Shadow",
        options: SHADOW_PRESETS,
      });
    push("Border & Shadow", c);
  }

  // Filters / opacity
  if (s.filters || s.opacity) {
    const c: ControlRef[] = [];
    if (s.opacity)
      c.push({ control: "slider", styleKey: "opacity", label: "Opacity" });
    if (s.filters)
      c.push({ control: "text", styleKey: "filters", label: "CSS filters" });
    push("Effects", c);
  }

  // Position
  if (s.position) {
    push("Position", [
      { control: "position", styleKey: "position", label: "Position" },
    ]);
  }

  return groups;
}
