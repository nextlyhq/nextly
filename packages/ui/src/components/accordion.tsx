"use client";

import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";
import { forwardRef } from "react";

import { cn } from "../lib/utils";
import type {
  AccordionItemProps,
  AccordionItemRef,
  AccordionTriggerProps,
  AccordionTriggerRef,
  AccordionContentProps,
  AccordionContentRef,
} from "../types/accordion";

/**
 * Accordion Component - Design System Specification
 *
 * A vertically stacked set of interactive headings that each reveal a section of content.
 * Built on Radix UI primitives with WAI-ARIA compliance.
 *
 * Design Specs:
 * - AccordionItem border: 1px bottom border (border-b)
 * - AccordionTrigger padding: 16px vertical (py-4)
 * - AccordionTrigger font: font-medium (500 weight)
 * - AccordionContent padding: 16px bottom, 0 top (pb-4 pt-0)
 * - Icon size: 16×16px (h-4 w-4)
 * - Icon rotation: 180° when expanded
 * - Transition duration: 150ms (design system standard)
 *
 * Structure:
 * <Accordion type="single" collapsible>
 *   <AccordionItem value="item-1">
 *     <AccordionTrigger>Is it accessible?</AccordionTrigger>
 *     <AccordionContent>
 *       Yes. It adheres to the WAI-ARIA design pattern.
 *     </AccordionContent>
 *   </AccordionItem>
 * </Accordion>
 *
 * Accessibility:
 * - Full keyboard navigation (Arrow keys, Home, End, Space, Enter)
 * - ARIA attributes automatically applied by Radix UI
 * - aria-expanded indicates open/closed state
 * - aria-controls associates trigger with content
 * - aria-labelledby provides context to assistive technologies
 * - role="region" on content panels
 * - Focus indicators visible (Tailwind default focus-visible)
 *
 * Features:
 * - Single mode: Only one item can be open at a time (type="single")
 * - Multiple mode: Multiple items can be open (type="multiple")
 * - Collapsible: Items can be collapsed when clicked again (collapsible prop)
 * - Disabled state support (disabled prop on items)
 * - Controlled/uncontrolled modes (value/defaultValue)
 * - Smooth height animations (data-state animations)
 *
 * Usage Examples:
 *
 * Basic accordion (single mode):
 * ```tsx
 * <Accordion type="single" collapsible>
 *   <AccordionItem value="item-1">
 *     <AccordionTrigger>Is it accessible?</AccordionTrigger>
 *     <AccordionContent>
 *       Yes. It adheres to the WAI-ARIA design pattern.
 *     </AccordionContent>
 *   </AccordionItem>
 *   <AccordionItem value="item-2">
 *     <AccordionTrigger>Is it styled?</AccordionTrigger>
 *     <AccordionContent>
 *       Yes. It comes with default styles that match the design system.
 *     </AccordionContent>
 *   </AccordionItem>
 * </Accordion>
 * ```
 *
 * Multiple items open (multiple mode):
 * ```tsx
 * <Accordion type="multiple">
 *   <AccordionItem value="item-1">
 *     <AccordionTrigger>Section 1</AccordionTrigger>
 *     <AccordionContent>Content 1</AccordionContent>
 *   </AccordionItem>
 *   <AccordionItem value="item-2">
 *     <AccordionTrigger>Section 2</AccordionTrigger>
 *     <AccordionContent>Content 2</AccordionContent>
 *   </AccordionItem>
 * </Accordion>
 * ```
 *
 * Controlled accordion:
 * ```tsx
 * const [value, setValue] = useState("item-1");
 * <Accordion type="single" value={value} onValueChange={setValue}>
 *   <AccordionItem value="item-1">
 *     <AccordionTrigger>Item 1</AccordionTrigger>
 *     <AccordionContent>Content 1</AccordionContent>
 *   </AccordionItem>
 *   <AccordionItem value="item-2">
 *     <AccordionTrigger>Item 2</AccordionTrigger>
 *     <AccordionContent>Content 2</AccordionContent>
 *   </AccordionItem>
 * </Accordion>
 * ```
 *
 * @see https://www.radix-ui.com/primitives/docs/components/accordion
 */
const Accordion = AccordionPrimitive.Root;

/**
 * AccordionItem - Container for trigger and content
 *
 * Design Specs:
 * - Border: 1px bottom border (border-b) for visual separation
 * - Each item represents a collapsible section
 *
 * Accessibility:
 * - Each item requires a unique value prop for identification
 * - Disabled state can be set via disabled prop
 */
const AccordionItem = forwardRef<AccordionItemRef, AccordionItemProps>(
  ({ className, ...props }, ref) => (
    <AccordionPrimitive.Item
      ref={ref}
      data-slot="accordion-item"
      className={cn("border-b", className)}
      {...props}
    />
  )
);
AccordionItem.displayName = "AccordionItem";

/**
 * AccordionTrigger - Clickable header button that toggles content visibility
 *
 * Design Specs:
 * - Padding: 16px vertical (py-4) for adequate touch target
 * - Font: font-medium (500 weight) for emphasis
 * - Hover: underline text on hover for better feedback
 * - Icon: ChevronDown (16×16px) with 180° rotation when expanded
 * - Transition: 150ms (design system standard)
 * - Layout: flex with space-between for trigger text and icon
 *
 * Accessibility:
 * - Button element with proper ARIA attributes
 * - aria-expanded indicates open/closed state
 * - aria-controls associates trigger with content panel
 * - Keyboard: Space/Enter to toggle, Arrow keys to navigate
 * - Focus indicator visible via default focus-visible styles
 *
 * Note:
 * - The ChevronDown icon is included by default
 * - Icon rotates 180° when item is expanded ([data-state=open])
 * - Trigger includes AccordionPrimitive.Header wrapper for proper semantics
 */
const AccordionTrigger = forwardRef<AccordionTriggerRef, AccordionTriggerProps>(
  ({ className, children, ...props }, ref) => (
    <AccordionPrimitive.Header className="flex" data-slot="accordion-header">
      <AccordionPrimitive.Trigger
        ref={ref}
        data-slot="accordion-trigger"
        className={cn(
          "flex flex-1 items-center justify-between py-4 font-medium transition-all duration-150 hover:underline [&[data-state=open]>svg]:rotate-180",
          className
        )}
        {...props}
      >
        {children}
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-150" />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
);
AccordionTrigger.displayName = AccordionPrimitive.Trigger.displayName;

/**
 * AccordionContent - Collapsible content panel
 *
 * Design Specs:
 * - Padding: 16px bottom, 0 top (pb-4 pt-0) for proper spacing
 * - Font: text-sm (14px) for body content
 * - Animation: Smooth height transition via data-state animations
 * - Overflow: hidden during animation for smooth reveal
 *
 * Accessibility:
 * - role="region" for screen reader context
 * - aria-labelledby associates content with trigger
 * - Only visible when item is expanded (data-state="open")
 * - Content is hidden but still in DOM when collapsed
 *
 * Animations:
 * - data-state="open": animate-accordion-down (Tailwind built-in)
 * - data-state="closed": animate-accordion-up (Tailwind built-in)
 * - Height transitions smoothly from 0 to auto
 */
const AccordionContent = forwardRef<AccordionContentRef, AccordionContentProps>(
  ({ className, children, ...props }, ref) => (
    <AccordionPrimitive.Content
      ref={ref}
      data-slot="accordion-content"
      className="overflow-hidden text-sm transition-all data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down"
      {...props}
    >
      <div className={cn("pb-4 pt-0", className)}>{children}</div>
    </AccordionPrimitive.Content>
  )
);

AccordionContent.displayName = AccordionPrimitive.Content.displayName;

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
export type {
  AccordionProps,
  AccordionItemProps,
  AccordionTriggerProps,
  AccordionContentProps,
} from "../types/accordion";
