import type { Root, Item, Trigger, Content } from "@radix-ui/react-accordion";
import type { ComponentPropsWithoutRef, ElementRef } from "react";

/**
 * Props for the Accordion root component
 * @see https://www.radix-ui.com/primitives/docs/components/accordion
 */
export type AccordionProps = ComponentPropsWithoutRef<typeof Root>;

/**
 * Props for the AccordionItem component (container for trigger and content)
 */
export type AccordionItemProps = ComponentPropsWithoutRef<typeof Item>;

/**
 * Ref type for AccordionItem component
 */
export type AccordionItemRef = ElementRef<typeof Item>;

/**
 * Props for the AccordionTrigger component (clickable header button)
 */
export type AccordionTriggerProps = ComponentPropsWithoutRef<typeof Trigger>;

/**
 * Ref type for AccordionTrigger component
 */
export type AccordionTriggerRef = ElementRef<typeof Trigger>;

/**
 * Props for the AccordionContent component (collapsible content panel)
 */
export type AccordionContentProps = ComponentPropsWithoutRef<typeof Content>;

/**
 * Ref type for AccordionContent component
 */
export type AccordionContentRef = ElementRef<typeof Content>;
