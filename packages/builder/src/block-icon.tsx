/**
 * The mark drawn beside a block's name, in the palette and in the layers tree.
 *
 * The engine names a CONCEPT — `"columns"`, `"quote"` — and this file is the
 * only place that decides what that concept looks like. That separation is the
 * whole point of the vocabulary: art direction changes here, and no block
 * definition, no plugin and no stored document changes with it.
 *
 * Every mark is DECORATIVE. A block's name is always rendered beside it as
 * text, so an icon that announced itself would make a screen reader say the
 * same thing twice, and one announcing as an unnamed image would be worse than
 * silence. The same bargain the layers badges already strike.
 */
import {
  AudioLines,
  Blocks,
  Calendar,
  ChartColumn,
  ChevronsUpDown,
  Code,
  Columns3,
  Frame,
  Grid3x3,
  Heading,
  Image,
  Images,
  Link,
  List,
  Map,
  Minus,
  MousePointerClick,
  PanelTop,
  PanelTopOpen,
  Quote,
  RectangleVertical,
  Repeat,
  Search,
  ShoppingCart,
  Square,
  SquareCheck,
  SquareDashed,
  SquareStack,
  StretchVertical,
  Star,
  Table2,
  Type,
  User,
  Video,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type React from "react";

/**
 * One drawing per concept in the engine's vocabulary.
 *
 * Written out rather than derived, because there is nothing to derive it from:
 * a concept and the glyph that reads as that concept are related by judgement,
 * not by rule. `blockIconsCoverTheVocabulary` in the tests is what holds this
 * table to `BLOCK_ICONS`, so a concept added to the engine and not drawn here
 * fails rather than silently falling back to the generic mark.
 */
const ICONS: Record<string, LucideIcon> = {
  // Structure
  section: PanelTop,
  container: Square,
  columns: Columns3,
  column: RectangleVertical,
  card: SquareStack,
  grid: Grid3x3,
  accordion: ChevronsUpDown,
  panel: PanelTopOpen,
  tabs: StretchVertical,
  divider: Minus,
  spacer: SquareDashed,
  // Content
  heading: Heading,
  text: Type,
  list: List,
  quote: Quote,
  code: Code,
  table: Table2,
  link: Link,
  // Media
  image: Image,
  gallery: Images,
  video: Video,
  audio: AudioLines,
  embed: Frame,
  map: Map,
  // Interactive and data
  button: MousePointerClick,
  form: SquareCheck,
  search: Search,
  loop: Repeat,
  chart: ChartColumn,
  calendar: Calendar,
  user: User,
  cart: ShoppingCart,
  star: Star,
};

/**
 * What is drawn for a block that names no icon, or names one this editor has
 * never heard of.
 *
 * The same mark for both, deliberately. An editor cannot tell a plugin author's
 * typo from a concept a newer engine added, and drawing a warning for one would
 * put a defect badge on a block that is merely newer than the editor reading
 * it. A block that draws SOMETHING keeps its row the same shape as every other,
 * which is what makes a list of them scannable at all.
 */
const FALLBACK: LucideIcon = Blocks;

/** Props for {@link BlockIconMark}. */
export interface BlockIconMarkProps {
  /** The concept the block named, if it named one. */
  readonly icon?: string;
  /** Edge length in pixels. */
  readonly size?: number;
}

/**
 * Draw a block's mark.
 *
 * `Object.hasOwn` before the lookup, because the name is a string that reached
 * here from a block definition — a plugin's, in the general case — and this
 * table inherits from `Object.prototype`. An icon named `"constructor"` or
 * `"toString"` would otherwise resolve to an inherited FUNCTION, which is then
 * used as a JSX element type and throws while rendering the panel. The same
 * hazard the rich-text renderer already guards its node tables against.
 */
export function BlockIconMark({
  icon,
  size = 16,
}: BlockIconMarkProps): React.JSX.Element {
  const Mark =
    icon !== undefined && Object.hasOwn(ICONS, icon)
      ? (ICONS[icon] ?? FALLBACK)
      : FALLBACK;
  return (
    <span className="nx-block-icon" aria-hidden="true">
      <Mark size={size} />
    </span>
  );
}

/** The concepts this editor can draw. Exported for the coverage test. */
export const DRAWN_ICONS: readonly string[] = Object.keys(ICONS);
