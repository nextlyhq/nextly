"use client";

import { Root, List, Trigger, Content } from "@radix-ui/react-tabs";
import { forwardRef } from "react";

import { cn } from "../lib/utils";
import type {
  TabsListProps,
  TabsListRef,
  TabsTriggerProps,
  TabsTriggerRef,
  TabsContentProps,
  TabsContentRef,
} from "../types/tabs";

/**
 * Tabs Component - Design System Specification
 *
 * A set of layered sections of content—known as tab panels—that are displayed one at a time.
 * Built on Radix UI primitives with WAI-ARIA compliance.
 *
 * Design Specs:
 * - TabsList border-radius: square, independent of `--radius`
 * - TabsTrigger border-radius: square, independent of `--radius`; the active
 *   state is a 2px bottom border that has to stay flush with the tab edges
 * - TabsList height: 40px (h-10)
 * - TabsTrigger padding: 12px 24px (px-3 py-1.5)
 * - Transition duration: 150ms (design system standard)
 * - Active state: bg-background with subtle shadow
 *
 * Structure:
 * <Tabs defaultValue="tab1">
 *   <TabsList>
 *     <TabsTrigger value="tab1">Tab 1</TabsTrigger>
 *     <TabsTrigger value="tab2">Tab 2</TabsTrigger>
 *   </TabsList>
 *   <TabsContent value="tab1">Content 1</TabsContent>
 *   <TabsContent value="tab2">Content 2</TabsContent>
 * </Tabs>
 *
 * Accessibility:
 * - Full keyboard navigation (Arrow keys, Home, End, Tab)
 * - ARIA attributes automatically applied by Radix UI
 * - Focus indicators with 2px ring (WCAG 2.2 compliant)
 * - Disabled state support
 *
 * Features:
 * - Controlled/uncontrolled modes (value/defaultValue)
 * - Horizontal/vertical orientation support
 * - Automatic/manual activation modes
 * - Keyboard navigation built-in
 *
 * Usage Examples:
 *
 * Basic tabs:
 * ```tsx
 * <Tabs defaultValue="overview">
 *   <TabsList>
 *     <TabsTrigger value="overview">Overview</TabsTrigger>
 *     <TabsTrigger value="details">Details</TabsTrigger>
 *   </TabsList>
 *   <TabsContent value="overview">Overview content</TabsContent>
 *   <TabsContent value="details">Details content</TabsContent>
 * </Tabs>
 * ```
 *
 * Controlled tabs:
 * ```tsx
 * const [activeTab, setActiveTab] = useState("tab1");
 * <Tabs value={activeTab} onValueChange={setActiveTab}>
 *   <TabsList>
 *     <TabsTrigger value="tab1">Tab 1</TabsTrigger>
 *     <TabsTrigger value="tab2">Tab 2</TabsTrigger>
 *   </TabsList>
 *   <TabsContent value="tab1">Content 1</TabsContent>
 *   <TabsContent value="tab2">Content 2</TabsContent>
 * </Tabs>
 * ```
 *
 * Vertical tabs:
 * ```tsx
 * <Tabs defaultValue="tab1" orientation="vertical">
 *   <TabsList>
 *     <TabsTrigger value="tab1">Tab 1</TabsTrigger>
 *     <TabsTrigger value="tab2">Tab 2</TabsTrigger>
 *   </TabsList>
 *   <TabsContent value="tab1">Content 1</TabsContent>
 *   <TabsContent value="tab2">Content 2</TabsContent>
 * </Tabs>
 * ```
 *
 * @see https://www.radix-ui.com/primitives/docs/components/tabs
 * @public
 */
const Tabs = Root;

/**
 * TabsList - Container for tab triggers
 *
 * Design Specs:
 * - Height: 40px (h-10)
 * - Border-radius: none (for underline style)
 * - Background: transparent
 * - Layout: inline-flex (horizontal by default, use orientation="vertical" on Tabs root for vertical)
 * @public
 */
const TabsList = forwardRef<TabsListRef, TabsListProps>(
  ({ className, ...props }, ref) => (
    <List
      ref={ref}
      data-slot="tabs-list"
      className={cn(
        "inline-flex h-10 items-center justify-center gap-1 p-0 text-muted-foreground",
        className,
        // Last in the merge, so no call site can round the strip: these are
        // underline tabs and the list never draws a rounded surface.
        "rounded-none"
      )}
      {...props}
    />
  )
);
TabsList.displayName = List.displayName;

/**
 * What a caller may change: size, spacing, weight, local surface tints.
 *
 * First in the merge, so a call site that passes `h-8`, `w-full` or `px-0`
 * overrides these — a tab strip in a dialog is a different shape from one in a
 * sheet, and that is a layout decision the surface owns.
 */
const TRIGGER_LAYOUT =
  "inline-flex items-center justify-center whitespace-nowrap bg-transparent px-4 py-2 text-sm font-medium cursor-pointer transition-all duration-200 relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed";

/**
 * What a caller may NOT change: the underline that IS the active state.
 *
 * Placed AFTER `className` in the merge rather than before it. `cn()` resolves
 * through tailwind-merge, so the last class on a property wins — putting these
 * last means a call site cannot take the indicator over, whatever route the
 * class arrives by. That matters because the routes are unbounded: a literal
 * `className`, an identifier, a spread, an aliased import. A source scan sees
 * only the first; the merge order sees all of them, because it acts on the
 * resolved value rather than on the text that produced it.
 *
 * Square is part of the indicator, not a decoration: the border has to run
 * flush to the trigger's edges. `radius-tier-contract` pins the same fact.
 *
 * This does not cover an INLINE STYLE — a `style` prop beats any class by CSS
 * specificity, and no merge order changes that. That gap is what
 * `__tests__/tabs-contract.test.ts` scans for, and it is the only thing it has
 * to scan for now.
 */
const TRIGGER_INDICATOR =
  "rounded-none border-b-2 -mb-0.5 data-[state=active]:border-b-primary! data-[state=active]:text-primary data-[state=inactive]:border-transparent data-[state=inactive]:text-muted-foreground hover:text-primary hover:border-primary";

/**
 * TabsTrigger - Clickable tab button
 *
 * Design Specs:
 * - Border-radius: none (Gmail-style underline tabs)
 * - Padding: 6px 16px (px-4 py-2)
 * - Font: text-sm (14px), font-medium (500)
 * - Transition: 150ms (design system standard)
 * - Active state: blue text with blue bottom  border border-border (2px)
 * - Hover: blue text with blue bottom  border border-border
 * - Gmail-inspired clean underline style
 *
 * Accessibility:
 * - Keyboard navigation: Arrow keys, Home, End
 * - Focus ring: 2px with offset (WCAG 2.2 compliant)
 * - Disabled state: pointer-events-none, opacity-50
 * - Data attributes: [data-state="active|inactive"], [data-disabled]
 * @public
 */
const TabsTrigger = forwardRef<TabsTriggerRef, TabsTriggerProps>(
  ({ className, ...props }, ref) => (
    <Trigger
      ref={ref}
      data-slot="tabs-trigger"
      className={cn(TRIGGER_LAYOUT, className, TRIGGER_INDICATOR)}
      {...props}
    />
  )
);
TabsTrigger.displayName = Trigger.displayName;

/**
 * TabsContent - Content panel for each tab
 *
 * Design Specs:
 * - Margin top: 8px (mt-2) to separate from TabsList
 * - Focus ring: 2px with offset (for keyboard navigation)
 *
 * Accessibility:
 * - Focus indicator when navigating with Tab key
 * - Data attributes: [data-state="active|inactive"], [data-orientation]
 * - Only active content is visible, inactive content is hidden
 * @public
 */
const TabsContent = forwardRef<TabsContentRef, TabsContentProps>(
  ({ className, ...props }, ref) => (
    <Content
      ref={ref}
      data-slot="tabs-content"
      className={cn(
        "mt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className
      )}
      {...props}
    />
  )
);
TabsContent.displayName = Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
export type {
  TabsProps,
  TabsListProps,
  TabsTriggerProps,
  TabsContentProps,
} from "../types/tabs";
