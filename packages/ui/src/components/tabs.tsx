"use client";

import { Root, List, Trigger, Content } from "@radix-ui/react-tabs";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { cn } from "../lib/utils";
import type {
  TabsListProps as TabsListBaseProps,
  TabsListRef,
  TabsTriggerProps as TabsTriggerBaseProps,
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
 * The list's own appearance, as variants rather than as classes each caller
 * repeats.
 *
 * `ghost` is the compact, surface-less list used where tabs sit inside another
 * panel and must not draw a bar of their own. It was spelled `h-8 bg-transparent
 * p-0` at one call site and `h-7 bg-transparent p-0` at another; naming it here
 * settles the height rather than leaving two answers in the tree.
 *
 * Only APPEARANCE is promoted. Layout a caller chooses -- `w-full`,
 * `justify-start`, margins -- stays on `className`, because a variant names a
 * decision this component owns and layout is the caller's.
 *
 * Horizontal SCROLLING is the exception, and it moved to the `scrollable` prop
 * for a reason rather than as tidying: a caller putting `overflow-x-auto` on the
 * list makes the list itself the scroll container, which breaks the rail
 * contract this file's other half depends on. See that prop.
 *
 * The arms are a named declaration rather than an object literal inside `cva`,
 * because `cva` does not expose its configuration on the function it returns —
 * so anything checking which arms exist would otherwise have to restate them,
 * and the two drift the moment an arm is added.
 */
const TABS_LIST_VARIANTS = {
  default: "h-10",
  ghost: "h-8 bg-transparent",
} as const;

const tabsListVariants = cva(
  // Square corners: underline tabs, so the list never draws a rounded surface.
  // `gap-1` and `p-0` are invariant across the variants, so they belong here —
  // repeating them in each arm gives any future adjustment two sites to change
  // and one to forget.
  //
  // The rail the triggers sit on, and it is load-bearing rather than
  // decoration. Each trigger draws a 2px border on its trailing edge and pulls
  // itself half a step onto this one: with no rail here, that pull put a 2px
  // line onto whatever followed the strip in the document, and above a rounded
  // panel that is the corner curve — a straight bar crossing an 8px arc. The
  // rail also gives an inactive tab somewhere to be inactive, which is what
  // makes the active one read as selected rather than as the only tab.
  //
  // Which edge is the trailing one depends on orientation, so the rail follows
  // it. Radix stamps `data-orientation` on the list and on every trigger, so
  // both halves read the same source and cannot disagree about the axis. A
  // fixed bottom rail draws a horizontal line beneath a vertical list.
  "inline-flex items-center justify-center gap-1 rounded-none border-b border-border p-0 text-muted-foreground data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-stretch data-[orientation=vertical]:border-b-0 data-[orientation=vertical]:border-r",
  {
    variants: { variant: TABS_LIST_VARIANTS },
    defaultVariants: { variant: "default" },
  }
);

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
const TabsList = forwardRef<
  TabsListRef,
  TabsListBaseProps &
    VariantProps<typeof tabsListVariants> & {
      /**
       * Let a strip too wide for its container scroll sideways.
       *
       * The scroll container is a WRAPPER, never the list, and that is why this
       * prop exists rather than callers reaching for `overflow-x-auto`
       * themselves. Two things go wrong when the list is the scroller, and the
       * second is why the obvious remedy is also wrong:
       *
       *  - Per the CSS overflow rules, `visible` computes to `auto` when the
       *    other axis is neither `visible` nor `clip`, so `overflow-x` alone
       *    always makes the element a VERTICAL scroll container too.
       *  - `TabsTrigger` carries `-mb-0.5` so its 2px underline lands ON this
       *    list's rail rather than below it. That pull-up puts content past the
       *    content-box edge, which the new scroll container reports as vertical
       *    overflow — so `overflow-y-hidden` would clip the 2px the underline is
       *    made of, silencing a scrollbar by deleting the indicator.
       *
       * With the wrapper scrolling instead, the list keeps its rail and
       * `w-max min-w-full` makes that rail span the full scroll width rather
       * than stopping where the triggers do.
       */
      scrollable?: boolean;
    }
>(({ className, variant, scrollable = false, ...props }, ref) => {
  const list = (
    <List
      ref={ref}
      data-slot="tabs-list"
      className={cn(
        tabsListVariants({ variant }),
        scrollable && "w-max min-w-full",
        className
      )}
      {...props}
    />
  );

  if (!scrollable) return list;

  return (
    <div data-slot="tabs-list-scroller" className="w-full overflow-x-auto">
      {list}
    </div>
  );
});
TabsList.displayName = List.displayName;

/**
 * The trigger's own appearance. `size` carries the type scale only: everything
 * that draws the tab -- the square corners, the 2px underline, the active and
 * hover colours, the focus ring -- is in the base and is not a caller's to
 * choose, which is the property `tabs-contract.test.ts` watches for.
 *
 * Arms declared separately for the same reason as the list's.
 */
const TABS_TRIGGER_SIZES = {
  default: "text-sm",
  sm: "text-xs",
} as const;

const tabsTriggerVariants = cva(
  // Square corners: the active state is a 2px border on the trailing edge that
  // has to run the full length of the trigger and stay flush with its ends.
  //
  // The active colour is NOT important-marked. Nothing inside this component
  // competes for it — the inactive arm is mutually exclusive with the active
  // one — so the only thing an `!` could win against is a caller's class, which
  // is precisely what a theme supplies. Marking it made the one line under
  // every selected tab the one line a theme could not restyle, and the failure
  // read as "the theme did not apply here" rather than as an opt-out.
  //
  // The trailing edge is the bottom when the strip is horizontal and the right
  // when it is vertical, so the indicator, the half-step pull onto the rail and
  // the active colour all switch axis together off the same `data-orientation`
  // the list reads. Switching only some of them puts the selection affordance
  // on one axis and the line it sits on the other.
  "inline-flex items-center justify-center whitespace-nowrap rounded-none bg-transparent px-4 py-2 font-medium cursor-pointer transition-all duration-200 border-b-2 relative -mb-0.5 data-[state=active]:border-b-primary data-[state=active]:text-primary data-[state=inactive]:border-transparent data-[state=inactive]:text-muted-foreground hover:text-primary hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed data-[orientation=vertical]:border-b-0 data-[orientation=vertical]:mb-0 data-[orientation=vertical]:border-r-2 data-[orientation=vertical]:-mr-0.5 data-[orientation=vertical]:data-[state=active]:border-r-primary",
  {
    variants: { size: TABS_TRIGGER_SIZES },
    defaultVariants: { size: "default" },
  }
);

/**
 * TabsTrigger - Clickable tab button
 *
 * Design Specs:
 * - Border-radius: none (Gmail-style underline tabs)
 * - Padding: 6px 16px (px-4 py-2)
 * - Font: text-sm (14px), font-medium (500)
 * - Transition: 150ms (design system standard)
 * - Active state: the accent colour on the text and on the 2px trailing border
 * - Hover: the same accent, so the target reads before it is chosen
 * - Gmail-inspired clean underline style
 *
 * Accessibility:
 * - Keyboard navigation: Arrow keys, Home, End
 * - Focus ring: 2px with offset (WCAG 2.2 compliant)
 * - Disabled state: pointer-events-none, opacity-50
 * - Data attributes: [data-state="active|inactive"], [data-disabled]
 * @public
 */
const TabsTrigger = forwardRef<
  TabsTriggerRef,
  TabsTriggerBaseProps & VariantProps<typeof tabsTriggerVariants>
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
export { TABS_LIST_VARIANTS, TABS_TRIGGER_SIZES };
export type { TabsProps, TabsContentProps } from "../types/tabs";

/**
 * The public prop types, DERIVED from the components rather than restated.
 *
 * `../types/tabs` describes the Radix props alone, so an alias taken from there
 * rejects `variant` and `size` — and a consumer typing a wrapper around
 * `TabsList` would be told the prop it can see in the signature does not exist.
 * Reading the component's own props keeps the two from drifting: a variant
 * added later reaches every consumer without a second edit.
 */
/**
 * The list's props, including its `variant`.
 * @public
 */
export type TabsListProps = ComponentPropsWithoutRef<typeof TabsList>;

/**
 * The trigger's props, including its `size`.
 * @public
 */
export type TabsTriggerProps = ComponentPropsWithoutRef<typeof TabsTrigger>;
