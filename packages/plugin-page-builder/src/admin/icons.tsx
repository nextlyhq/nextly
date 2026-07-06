"use client";

/**
 * Explicit lucide icon map for the editor chrome. We map by NAME (an explicit object, not
 * `import * as`) so the admin bundle only pulls the icons we actually use. Block definitions
 * already carry a lucide icon name in `def.icon` (e.g. "Heading", "Image"); `blockIcon`
 * resolves that to a component, falling back to a neutral square.
 */
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  GripVertical,
  Heading,
  Image,
  LayoutGrid,
  Link2,
  Monitor,
  MousePointerClick,
  Plus,
  Repeat,
  Search,
  Smartphone,
  Square,
  Tablet,
  Trash2,
  Type,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";

const BLOCK_ICONS: Record<string, LucideIcon> = {
  Heading,
  Image,
  LayoutGrid,
  MousePointerClick,
  Repeat,
  Square,
  Type,
  Video,
};

/** Resolve a block definition's `icon` name to a lucide component. */
export function blockIcon(name: string | undefined): LucideIcon {
  return (name && BLOCK_ICONS[name]) || Square;
}

export {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  GripVertical,
  Link2,
  Monitor,
  Plus,
  Search,
  Smartphone,
  Tablet,
  Trash2,
  X,
};
