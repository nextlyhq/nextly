"use client";

import { Root, List, Trigger, Content } from "@radix-ui/react-tabs";
import { cva, type VariantProps } from "class-variance-authority";
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
/**
 * The list's own appearance, as variants rather than as classes each caller
 * repeats.
 *
 * `ghost` is the compact, surface-less list used where tabs sit inside another
 * panel and must not draw a bar of their own. It was spelled `h-8 bg-transparent
 * p-0` at one call site and `h-7 bg-transparent p-0` at another; naming it here
 * settles the height rather than leaving two answers in the tree.
 *
 * Only APPEARANCE is promoted. Layout a caller chooses -- `w-full`,
 * `justify-start`, margins, `overflow-x-auto` -- stays on `className`, because
 * a variant names a decision this component owns and layout is the caller's.
 */
const tabsListVariants = cva(
  // Square corners: underline tabs, so the list never draws a rounded surface.
  "inline-flex items-center justify-center rounded-none text-muted-foreground",
  {
    variants: {
      variant: {
        default: "h-10 gap-1 p-0",
        ghost: "h-8 gap-1 bg-transparent p-0",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

const TabsList = forwardRef<
  TabsListRef,
  TabsListProps & VariantProps<typeof tabsListVariants>
>(({ className, variant, ...props }, ref) => (
  <List
    ref={ref}
    data-slot="tabs-list"
    className={cn(tabsListVariants({ variant }), className)}
    {...props}
  />
));
TabsList.displayName = List.displayName;

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
/**
 * The trigger's own appearance. `size` carries the type scale only: everything
 * that draws the tab -- the square corners, the 2px underline, the active and
 * hover colours, the focus ring -- is in the base and is not a caller's to
 * choose, which is the property `tabs-contract.test.ts` watches for.
 */
const tabsTriggerVariants = cva(
  // Square corners: the active state is a 2px bottom border that has to run the
  // full width of the trigger.
  "inline-flex items-center justify-center whitespace-nowrap rounded-none bg-transparent px-4 py-2 font-medium cursor-pointer transition-all duration-200 border-b-2 relative -mb-0.5 data-[state=active]:border-b-primary! data-[state=active]:text-primary data-[state=inactive]:border-transparent data-[state=inactive]:text-muted-foreground hover:text-primary hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed",
  {
    variants: {
      size: {
        default: "text-sm",
        sm: "text-xs",
      },
    },
    defaultVariants: { size: "default" },
  }
);

const TabsTrigger = forwardRef<
  TabsTriggerRef,
  TabsTriggerProps & VariantProps<typeof tabsTriggerVariants>
>(({ className, size, ...props }, ref) => (
  <Trigger
    ref={ref}
    data-slot="tabs-trigger"
    className={cn(tabsTriggerVariants({ size }), className)}
    {...props}
  />
));
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
export { tabsListVariants, tabsTriggerVariants };
export type {
  TabsProps,
  TabsListProps,
  TabsTriggerProps,
  TabsContentProps,
} from "../types/tabs";
