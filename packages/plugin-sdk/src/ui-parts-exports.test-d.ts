/**
 * The notice, side panel, tabs, progress bar, menu and hint a plugin page
 * draws, as the admin entry hands them: each name is there, and each carries
 * the props a page passes, because forwarding a component through two barrels
 * is where a prop can go missing without the name doing so.
 *
 * Every assertion is one the checker evaluates; none rests on
 * `@ts-expect-error`.
 */
import type { ComponentProps, ReactNode } from "react";
import { expectTypeOf } from "vitest";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Progress,
  Sheet,
  SheetContent,
  SheetTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@nextlyhq/plugin-sdk/admin";
import type {
  AlertProps,
  DropdownMenuItemProps,
  ProgressProps,
  SheetContentProps,
  SheetProps,
  TabsProps,
  TabsTriggerProps,
} from "@nextlyhq/plugin-sdk/admin";

// The alert's four tones, and only those.
type AlertVariant = NonNullable<ComponentProps<typeof Alert>["variant"]>;
expectTypeOf<AlertVariant>().toEqualTypeOf<
  "info" | "success" | "warning" | "destructive"
>();
expectTypeOf<
  NonNullable<AlertProps["variant"]>
>().toEqualTypeOf<AlertVariant>();
expectTypeOf<"error">().not.toExtend<AlertVariant>();
expectTypeOf<{ children: ReactNode }>().toExtend<
  ComponentProps<typeof AlertTitle>
>();
expectTypeOf<{ children: ReactNode }>().toExtend<
  ComponentProps<typeof AlertDescription>
>();

// The side panel opens under the page's control and comes in from one edge.
expectTypeOf<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>().toExtend<SheetProps>();
expectTypeOf<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>().toExtend<ComponentProps<typeof Sheet>>();
type SheetSide = NonNullable<SheetContentProps["side"]>;
expectTypeOf<SheetSide>().toEqualTypeOf<"top" | "bottom" | "left" | "right">();
expectTypeOf<{ side: "right"; children: ReactNode }>().toExtend<
  ComponentProps<typeof SheetContent>
>();
expectTypeOf<{ children: ReactNode }>().toExtend<
  ComponentProps<typeof SheetTitle>
>();

// Tabs are controlled by value, and each trigger names the panel it shows.
expectTypeOf<{
  value: string;
  onValueChange: (value: string) => void;
}>().toExtend<TabsProps>();
expectTypeOf<{ value: string }>().toExtend<ComponentProps<typeof Tabs>>();
expectTypeOf<{ value: string }>().toExtend<TabsTriggerProps>();
expectTypeOf<{ value: string }>().toExtend<
  ComponentProps<typeof TabsTrigger>
>();
expectTypeOf<{ value: string }>().toExtend<
  ComponentProps<typeof TabsContent>
>();
expectTypeOf<{ children: ReactNode }>().toExtend<
  ComponentProps<typeof TabsList>
>();

// The progress bar needs its value; its maximum and tone are optional.
expectTypeOf<ProgressProps["value"]>().toEqualTypeOf<number>();
expectTypeOf<{ max: number }>().not.toExtend<ComponentProps<typeof Progress>>();
expectTypeOf<{ value: number; max: number; variant: "success" }>().toExtend<
  ComponentProps<typeof Progress>
>();

// A menu behind a button: the item runs on select and can be turned off.
expectTypeOf<{ children: ReactNode }>().toExtend<
  ComponentProps<typeof DropdownMenu>
>();
expectTypeOf<{ asChild: true; children: ReactNode }>().toExtend<
  ComponentProps<typeof DropdownMenuTrigger>
>();
expectTypeOf<{ align: "end"; children: ReactNode }>().toExtend<
  ComponentProps<typeof DropdownMenuContent>
>();
expectTypeOf<{
  onSelect: (event: Event) => void;
  disabled: boolean;
}>().toExtend<DropdownMenuItemProps>();
expectTypeOf<{ onSelect: (event: Event) => void }>().toExtend<
  ComponentProps<typeof DropdownMenuItem>
>();

// A hint on hover or focus, with its provider for a page outside the admin.
expectTypeOf<{ children: ReactNode }>().toExtend<
  ComponentProps<typeof TooltipProvider>
>();
expectTypeOf<{ children: ReactNode }>().toExtend<
  ComponentProps<typeof Tooltip>
>();
expectTypeOf<{ asChild: true; children: ReactNode }>().toExtend<
  ComponentProps<typeof TooltipTrigger>
>();
expectTypeOf<{ side: "top"; children: ReactNode }>().toExtend<
  ComponentProps<typeof TooltipContent>
>();
