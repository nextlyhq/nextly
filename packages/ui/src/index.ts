/**
 * The presentational half of the plugin-author API surface.
 *
 * Export groups below carry a TSDoc release tag mirroring `STABILITY.md`, which
 * is the authoritative ledger — where the two disagree, the ledger wins. A
 * group is `@public` only once a first-party plugin exercises it; everything
 * else is `@experimental` and may change in any release.
 *
 * `cn` and the Tailwind preset are deliberately NOT re-exported here: this
 * barrel ships a `"use client"` banner (see tsup.config.ts), because all but a
 * couple of these modules use hooks, context, forwardRef or Radix and cannot
 * render in a Server Component. Those two contain no React runtime and are
 * published as "@nextlyhq/ui/utils" and "@nextlyhq/ui/tailwind-preset" so
 * server code and build tooling can import them.
 */

/** @public Button. Exercised by form-builder and page-builder. */
// Components — Button
export { Button } from "./components/button";

/** @experimental Styling helper; no first-party plugin imports it. */
export { buttonVariants } from "./components/button";
/** @public */
export type { ButtonProps } from "./types/button";

/** @public Form controls (input, textarea, label, tooltip label). */
// Components — Input
export { Input } from "./components/input";

/** @experimental Styling helper; no first-party plugin imports it. */
export { inputVariants } from "./components/input";
/** @public */
export type { InputProps } from "./components/input";
/** @public */
export { Textarea } from "./components/textarea";
/** @public */
export { Label } from "./components/label";
/** @public */
export { FormLabelWithTooltip } from "./components/form-label-with-tooltip";
/** @public */
export type { FormLabelWithTooltipProps } from "./components/form-label-with-tooltip";

// Components — Display. Release tags are per clause below.
/** @public */
export { Badge } from "./components/badge";

/** @experimental */
export { badgeVariants } from "./components/badge";
/** @public */
export type { BadgeProps } from "./components/badge";
/** @experimental */
export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
  cardVariants,
} from "./components/card";
/** @experimental */
export type {
  CardProps,
  CardHeaderProps,
  CardTitleProps,
  CardDescriptionProps,
  CardActionProps,
  CardContentProps,
  CardFooterProps,
} from "./components/card";
/** @experimental */
export { Stack, Grid, Stat } from "./components/layout";
/** @experimental */
export type { StackProps, GridProps, StatProps } from "./components/layout";
/** @experimental */
export {
  Alert,
  AlertTitle,
  AlertDescription,
  alertVariants,
} from "./components/alert";
/** @experimental */
export type {
  AlertProps,
  AlertTitleProps,
  AlertDescriptionProps,
} from "./components/alert";
/** @experimental */
export { Separator } from "./components/separator";
/** @experimental */
export { Skeleton } from "./components/skeleton";
/** @experimental */
export type { SkeletonProps } from "./components/skeleton";
/** @experimental */
export { Progress, progressVariants } from "./components/progress";
/** @experimental */
export type { ProgressProps } from "./components/progress";

/** @public Checkbox, switch and radio group. */
// Components — Toggle
export { Checkbox } from "./components/checkbox";
/** @public */
export { RadioGroup, RadioGroupItem } from "./components/radio-group";
/** @public */
export { Switch } from "./components/switch";
/** @experimental */
export {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "./components/collapsible";

// Components — Radix Primitives. Release tags are per clause below.
/** @experimental */
export {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "./components/accordion";
/** @experimental */
export type {
  AccordionProps,
  AccordionItemProps,
  AccordionTriggerProps,
  AccordionContentProps,
} from "./types/accordion";

/** @experimental */
export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  avatarVariants,
} from "./components/avatar";
/** @experimental */
export type {
  AvatarProps,
  AvatarImageProps,
  AvatarFallbackProps,
} from "./types/avatar";

/** @public */
export { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/tabs";
/** @public */
export type {
  TabsProps,
  TabsListProps,
  TabsTriggerProps,
  TabsContentProps,
} from "./types/tabs";

/** @public */
export { Tooltip, TooltipTrigger, TooltipContent } from "./components/tooltip";

/** @experimental */
export { TooltipProvider } from "./components/tooltip";

/** @experimental */
export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
} from "./components/popover";

// Components — Dialog. Exercised by page-builder.
/** @public */
export {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "./components/dialog";

/** @experimental */
export {
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  dialogContentVariants,
} from "./components/dialog";
/** @public Prop types carry the same guarantee as their component. */
export type {
  DialogContentProps,
  DialogHeaderProps,
  DialogFooterProps,
  DialogTitleProps,
  DialogDescriptionProps,
} from "./components/dialog";

/** @experimental */
export type { DialogOverlayProps } from "./components/dialog";

/** @experimental No first-party plugin depends on it yet. */
// Components — AlertDialog
export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "./components/alert-dialog";
/** @experimental */
export type {
  AlertDialogOverlayProps,
  AlertDialogContentProps,
  AlertDialogHeaderProps,
  AlertDialogFooterProps,
  AlertDialogTitleProps,
  AlertDialogDescriptionProps,
  AlertDialogActionProps,
  AlertDialogCancelProps,
} from "./components/alert-dialog";

// Components — DropdownMenu. Exercised by page-builder.
/** @public */
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from "./components/dropdown-menu";

/** @experimental */
export {
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
} from "./components/dropdown-menu";
/** @public Prop types carry the same guarantee as their component. */
export type {
  DropdownMenuContentProps,
  DropdownMenuItemProps,
  DropdownMenuCheckboxItemProps,
  DropdownMenuSeparatorProps,
} from "./types/dropdown-menu";

/** @experimental */
export type {
  DropdownMenuSubTriggerProps,
  DropdownMenuSubContentProps,
  DropdownMenuRadioItemProps,
  DropdownMenuLabelProps,
  DropdownMenuShortcutProps,
} from "./types/dropdown-menu";

// Components — Select. Exercised by both first-party plugins.
/** @public */
export {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/select";

/** @experimental */
export {
  SelectGroup,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  selectTriggerVariants,
} from "./components/select";
/** @public */
export type { SelectTriggerProps } from "./components/select";

// Components — Sheet. Exercised by page-builder.
/** @public */
export {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "./components/sheet";

/** @experimental */
export {
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetFooter,
  sheetVariants,
} from "./components/sheet";
/** @public */
export type { SheetContentProps } from "./components/sheet";
/** @public Prop types carry the same guarantee as their component. */
export type {
  SheetProps,
  SheetHeaderProps,
  SheetTitleProps,
  SheetDescriptionProps,
} from "./types/sheet";

/** @experimental */
export type {
  SheetTriggerProps,
  SheetCloseProps,
  SheetOverlayProps,
  SheetFooterProps,
  SheetOverlayRef,
  SheetContentRef,
  SheetTitleRef,
  SheetDescriptionRef,
} from "./types/sheet";

/** @experimental No first-party plugin depends on it yet. */
// Components — Command
export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
} from "./components/command";
/** @experimental */
export type {
  CommandProps,
  CommandDialogProps,
  CommandInputProps,
  CommandListProps,
  CommandEmptyProps,
  CommandGroupProps,
  CommandItemProps,
  CommandSeparatorProps,
  CommandShortcutProps,
} from "./components/command";

/** @experimental No first-party plugin depends on it yet. */
// Components — Spinner
export { Spinner, spinnerVariants } from "./components/spinner";
/** @experimental */
export type { SpinnerProps } from "./components/spinner";

// Components — Toaster
/** @public */
export { toast } from "./components/toaster";

/** @experimental */
export { Toaster } from "./components/toaster";
/** @experimental */
export type { ToasterProps } from "sonner";

/** @experimental No first-party plugin depends on them yet. */
// Components — Table Primitives
export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
} from "./components/table";

/** @experimental No first-party plugin depends on them yet. */
// Components — Table Utilities
export { TableSearch } from "./components/table-search";
/** @experimental */
export type { TableSearchProps } from "./components/table-search";

/** @experimental */
export {
  TableError,
  TableLoading,
  TableEmpty,
} from "./components/table-states";
/** @experimental */
export type {
  TableErrorProps,
  TableEmptyProps,
} from "./components/table-states";

/** @experimental */
export { TableSkeleton } from "./components/table-skeleton";
/** @experimental */
export type { TableSkeletonProps } from "./components/table-skeleton";

/** @experimental */
// Types: Table
export type {
  PaginationMeta,
  SortInfo,
  FilterInfo,
  TableParams,
  ListResponse,
  PaginationConfig,
  ActionCallbacks,
  DataFetcher,
} from "./types/table";

/** @public Required to use styles.scoped.css correctly; see STABILITY.md. */
// Providers
export {
  PortalProvider,
  usePortalContainer,
} from "./providers/portal-provider";

// Utilities

// Tailwind Preset

/**
 * @experimental Editor-shell primitives.
 *
 * A right-click menu and a resizable split. Nothing in a first-party plugin imports them yet, so
 * they stay experimental: this kit graduates a surface only once one does.
 */
export {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "./components/context-menu";

/** @experimental */
export {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "./components/resizable";

/**
 * @experimental A virtualized, keyboard-operable tree — the layers panel of an editor.
 *
 * Renders only the visible window, which is what makes a document of thousands of blocks usable
 * and what forces the flat `aria-level` markup: an item's children may not be in the DOM at all.
 */
export { TreeView } from "./components/tree-view";
/** @experimental The node shape a tree is built from, and the control's props. */
export type { TreeNode, TreeViewProps } from "./components/tree-view";

/**
 * @experimental A bounded numeric value chosen by dragging.
 *
 * Every inspector is full of these — opacity, blur radius, letter spacing, a colour's alpha —
 * and each is a property where "more or less?" is the useful question. `value` is an ARRAY even
 * for one thumb, which is what makes a range slider the same component rather than a second one.
 */
export { Slider } from "./components/slider";
/**
 * @experimental The slider's props, and the per-thumb attributes assistive
 * technology reads — which are read from the THUMB and inherited from nothing,
 * so they cannot be passed through the root.
 */
export type { SliderProps, SliderThumbProps } from "./components/slider";
 * @experimental The application's single owner of keyboard shortcuts.
 *
 * Replaces per-component `document` listeners, which cannot decide who owns a key:
 * `stopPropagation` does not stop siblings on the same node, so every global handler runs and
 * the winner is whichever component mounted first. Precedence here follows the component tree,
 * and a blocking layer lets a drag or a modal hold the keyboard while it is up.
 */
export {
  ShortcutProvider,
  ShortcutScope,
  useActiveShortcuts,
  useShortcutManager,
  useShortcuts,
} from "./lib/shortcuts/react";
/** @experimental The provider's props, and the options a layer registers with. */
export type {
  ShortcutProviderProps,
  UseShortcutsOptions,
} from "./lib/shortcuts/react";
/** @experimental The binding shape, and the manager for a host that drives its own events. */
export { createShortcutManager } from "./lib/shortcuts/manager";
/** @experimental */
export type {
  ActiveShortcut,
  ShortcutBinding,
  ShortcutLayerOptions,
  ShortcutManager,
  ShortcutManagerOptions,
  ShortcutRegistration,
} from "./lib/shortcuts/manager";
/** @experimental Key-spec parsing, for a host rendering its own shortcut hints. */
export { parseKeys } from "./lib/shortcuts/key-spec";
/** @experimental */
export type { KeyChord, KeySequence } from "./lib/shortcuts/key-spec";
