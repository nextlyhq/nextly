import type { Root, List, Trigger, Content } from "@radix-ui/react-tabs";
import type { ComponentPropsWithoutRef, ElementRef } from "react";

/**
 * Props for the Tabs root component
 * @see https://www.radix-ui.com/primitives/docs/components/tabs
 */
export type TabsProps = ComponentPropsWithoutRef<typeof Root>;

/**
 * Props for the TabsList component (container for tab triggers)
 */
export type TabsListProps = ComponentPropsWithoutRef<typeof List>;

/**
 * Ref type for TabsList component
 */
export type TabsListRef = ElementRef<typeof List>;

/**
 * Props for the TabsTrigger component (clickable tab button)
 */
export type TabsTriggerProps = ComponentPropsWithoutRef<typeof Trigger>;

/**
 * Ref type for TabsTrigger component
 */
export type TabsTriggerRef = ElementRef<typeof Trigger>;

/**
 * Props for the TabsContent component (content panel for each tab)
 */
export type TabsContentProps = ComponentPropsWithoutRef<typeof Content>;

/**
 * Ref type for TabsContent component
 */
export type TabsContentRef = ElementRef<typeof Content>;
