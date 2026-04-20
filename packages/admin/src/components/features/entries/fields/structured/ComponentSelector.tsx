/**
 * Component Selector Dialog
 *
 * A rich dialog-based selector for choosing component types in multi-component
 * (dynamic zone) fields. Shows available components with icons, labels,
 * descriptions, and category grouping with search functionality.
 *
 * @module components/entries/fields/structured/ComponentSelector
 * @since 1.0.0
 */

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
} from "@revnixhq/ui";
import { useCallback, useMemo, useState } from "react";

import type { LucideIcon } from "@admin/components/icons";
import { Puzzle, Search, X } from "@admin/components/icons";
import * as Icons from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import type { ComponentSchema } from "./ComponentInput";

// ============================================================
// Types
// ============================================================

export interface ComponentSelectorProps {
  /**
   * Whether the dialog is open.
   */
  open: boolean;

  /**
   * Callback when the dialog open state changes.
   */
  onOpenChange: (open: boolean) => void;

  /**
   * Available component schemas keyed by slug.
   */
  componentSchemas: Record<string, ComponentSchema>;

  /**
   * List of component slugs that are available for selection.
   */
  availableSlugs: string[];

  /**
   * Callback when a component is selected.
   * Receives the component slug.
   */
  onSelect: (slug: string) => void;

  /**
   * Optional title for the dialog.
   * @default "Add Component"
   */
  title?: string;

  /**
   * Optional description for the dialog.
   * @default "Choose a component type to add."
   */
  description?: string;
}

interface ComponentCategory {
  name: string;
  color: string;
  components: ComponentInfo[];
}

interface ComponentInfo {
  slug: string;
  label: string;
  description?: string;
  icon?: string;
  category?: string;
}

// ============================================================
// Constants
// ============================================================

/**
 * Default category for components without a category.
 */
const DEFAULT_CATEGORY = "General";

/**
 * Category color palette for visual distinction.
 * Colors cycle through this palette based on category name hash.
 */
const CATEGORY_COLORS = [
  "bg-primary",
  "bg-green-500",
  "bg-purple-500",
  "bg-orange-500",
  "bg-pink-500",
  "bg-cyan-500",
  "bg-amber-500",
  "bg-indigo-500",
  "bg-rose-500",
  "bg-teal-500",
];

// Icon map for dynamic icon rendering
const iconMap = Icons as unknown as Record<string, LucideIcon>;

// ============================================================
// Helpers
// ============================================================

/**
 * Generates a consistent color index based on category name.
 */
function getCategoryColorIndex(categoryName: string): number {
  let hash = 0;
  for (let i = 0; i < categoryName.length; i++) {
    hash = (hash << 5) - hash + categoryName.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash) % CATEGORY_COLORS.length;
}

/**
 * Extracts component info from schemas and groups by category.
 */
function groupComponentsByCategory(
  schemas: Record<string, ComponentSchema>,
  slugs: string[]
): ComponentCategory[] {
  // Build component info list
  const componentInfoList: ComponentInfo[] = slugs.map(slug => {
    const schema = schemas[slug];
    return {
      slug,
      label: schema?.label || slug,
      description: schema?.admin?.description,
      icon: schema?.admin?.icon,
      category: schema?.admin?.category || DEFAULT_CATEGORY,
    };
  });

  // Group by category
  const categoryMap = new Map<string, ComponentInfo[]>();

  for (const comp of componentInfoList) {
    const category = comp.category || DEFAULT_CATEGORY;
    const existing = categoryMap.get(category) || [];
    existing.push(comp);
    categoryMap.set(category, existing);
  }

  // Convert to array with colors
  const categories: ComponentCategory[] = [];

  // Sort categories alphabetically, but put "General" last
  const sortedCategoryNames = Array.from(categoryMap.keys()).sort((a, b) => {
    if (a === DEFAULT_CATEGORY) return 1;
    if (b === DEFAULT_CATEGORY) return -1;
    return a.localeCompare(b);
  });

  for (const categoryName of sortedCategoryNames) {
    const components = categoryMap.get(categoryName) || [];
    const colorIndex = getCategoryColorIndex(categoryName);
    categories.push({
      name: categoryName,
      color: CATEGORY_COLORS[colorIndex],
      components: components.sort((a, b) => a.label.localeCompare(b.label)),
    });
  }

  return categories;
}

/**
 * Filters categories and components based on search query.
 */
function filterCategories(
  categories: ComponentCategory[],
  searchQuery: string
): ComponentCategory[] {
  if (!searchQuery.trim()) {
    return categories;
  }

  const query = searchQuery.toLowerCase();

  return categories
    .map(category => ({
      ...category,
      components: category.components.filter(
        comp =>
          comp.label.toLowerCase().includes(query) ||
          comp.slug.toLowerCase().includes(query) ||
          (comp.description?.toLowerCase() || "").includes(query)
      ),
    }))
    .filter(category => category.components.length > 0);
}

// ============================================================
// Component Card
// ============================================================

interface ComponentCardProps {
  component: ComponentInfo;
  onSelect: () => void;
}

function ComponentCard({ component, onSelect }: ComponentCardProps) {
  // Get icon component or use default
  const IconComponent = component.icon
    ? iconMap[component.icon] || Puzzle
    : Puzzle;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex flex-col items-start gap-2 p-3 rounded-lg border border-border",
        "bg-background hover:bg-accent hover:border-accent-foreground/20",
        "transition-colors text-left w-full",
        "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
      )}
    >
      <div className="flex items-center gap-2">
        <IconComponent className="h-5 w-5 text-muted-foreground shrink-0" />
        <span className="font-medium text-sm text-foreground truncate">
          {component.label}
        </span>
      </div>
      {component.description && (
        <p className="text-xs text-muted-foreground line-clamp-2">
          {component.description}
        </p>
      )}
    </button>
  );
}

// ============================================================
// Main Component
// ============================================================

/**
 * ComponentSelector - A dialog for selecting component types
 *
 * Features:
 * - Search functionality across label, slug, and description
 * - Category grouping with colored indicators
 * - 2-column grid layout for components
 * - Icon, label, and description display
 * - Keyboard accessible
 *
 * @example
 * ```tsx
 * <ComponentSelector
 *   open={selectorOpen}
 *   onOpenChange={setSelectorOpen}
 *   componentSchemas={componentSchemas}
 *   availableSlugs={['hero', 'cta', 'content']}
 *   onSelect={(slug) => {
 *     handleAdd(slug);
 *     setSelectorOpen(false);
 *   }}
 * />
 * ```
 */
export function ComponentSelector({
  open,
  onOpenChange,
  componentSchemas,
  availableSlugs,
  onSelect,
  title = "Add Component",
  description = "Choose a component type to add.",
}: ComponentSelectorProps) {
  // Search state
  const [searchQuery, setSearchQuery] = useState("");

  // Group components by category
  const categories = useMemo(
    () => groupComponentsByCategory(componentSchemas, availableSlugs),
    [componentSchemas, availableSlugs]
  );

  // Filter categories based on search
  const filteredCategories = useMemo(
    () => filterCategories(categories, searchQuery),
    [categories, searchQuery]
  );

  // Handle selection
  const handleSelect = useCallback(
    (slug: string) => {
      onSelect(slug);
      setSearchQuery("");
      onOpenChange(false);
    },
    [onSelect, onOpenChange]
  );

  // Handle dialog close
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        setSearchQuery("");
      }
      onOpenChange(newOpen);
    },
    [onOpenChange]
  );

  // Count total components
  const totalCount = availableSlugs.length;
  const filteredCount = filteredCategories.reduce(
    (sum, cat) => sum + cat.components.length,
    0
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="lg" className="max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Puzzle className="h-5 w-5" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            type="search"
            placeholder="Search components..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-10 pr-10"
            autoFocus
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Component count badge */}
        {searchQuery && filteredCount !== totalCount && (
          <div className="flex items-center gap-2">
            <Badge variant="default" className="text-xs">
              {filteredCount} of {totalCount} components
            </Badge>
          </div>
        )}

        {/* Component Grid */}
        <div className="flex-1 overflow-y-auto -mx-6 px-6 max-h-[50vh]">
          <div className="space-y-6 pb-4">
            {filteredCategories.length > 0 ? (
              filteredCategories.map(category => (
                <div key={category.name}>
                  {/* Category Header */}
                  <div className="flex items-center gap-2 mb-3">
                    <div
                      className={cn("w-2 h-2 rounded-full", category.color)}
                      aria-hidden="true"
                    />
                    <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      {category.name}
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      ({category.components.length})
                    </span>
                  </div>

                  {/* Component Cards Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {category.components.map(component => (
                      <ComponentCard
                        key={component.slug}
                        component={component}
                        onSelect={() => handleSelect(component.slug)}
                      />
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8">
                <Puzzle className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                <p className="text-muted-foreground">
                  {searchQuery
                    ? "No components match your search."
                    : "No components available."}
                </p>
                {searchQuery && (
                  <Button
                    type="button"
                    variant="link"
                    onClick={() => setSearchQuery("")}
                    className="mt-2"
                  >
                    Clear search
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Exports
// ============================================================
