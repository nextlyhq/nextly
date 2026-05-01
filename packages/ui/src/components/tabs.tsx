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
 * - TabsList border-radius: 0px (rounded-none)
 * - TabsTrigger border-radius: 0px (rounded-none)
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
 */
const TabsList = forwardRef<TabsListRef, TabsListProps>(
  ({ className, ...props }, ref) => (
    <List
      ref={ref}
      data-slot="tabs-list"
      className={cn(
        "inline-flex h-10 items-center justify-center gap-1 rounded-none p-0 text-muted-foreground",
        className
      )}
      {...props}
    />
  )
);
TabsList.displayName = List.displayName;

/**
 * TabsTrigger - Clickable tab button
 *
 * Design Specs:
 * - Border-radius: none (Gmail-style underline tabs)
 * - Padding: 6px 16px (px-4 py-2)
 * - Font: text-sm (14px), font-medium (500)
 * - Transition: 150ms (design system standard)
 * - Active state: blue text with blue bottom border (2px)
 * - Hover: blue text with blue bottom border
 * - Gmail-inspired clean underline style
 *
 * Accessibility:
 * - Keyboard navigation: Arrow keys, Home, End
 * - Focus ring: 2px with offset (WCAG 2.2 compliant)
 * - Disabled state: pointer-events-none, opacity-50
 * - Data attributes: [data-state="active|inactive"], [data-disabled]
 */
const TabsTrigger = forwardRef<TabsTriggerRef, TabsTriggerProps>(
  ({ className, ...props }, ref) => (
    <Trigger
      ref={ref}
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-none bg-transparent px-4 py-2 text-sm font-medium cursor-pointer transition-all duration-200 border-b-2 relative -mb-0.5 data-[state=active]:!border-b-primary data-[state=active]:text-primary data-[state=inactive]:border-transparent data-[state=inactive]:text-muted-foreground hover:text-primary hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed",
        className
      )}
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
 */
const TabsContent = forwardRef<TabsContentRef, TabsContentProps>(
  ({ className, ...props }, ref) => (
    <Content
      ref={ref}
      data-slot="tabs-content"
      className={cn(
        "mt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:ring-offset-2",
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
