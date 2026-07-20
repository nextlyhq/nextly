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

/** Release tags are per clause below. */
// Components — Display
/** @public */
export { Badge } from "./components/badge";

/** @experimental */
export { badgeVariants } from "./components/badge";
/** @experimental */
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

/** Release tags are per clause below. */
/** @experimental */
// Components — Radix Primitives
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
/** @experimental */
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

/** @public Dialog. Exercised by page-builder. */
// Components — Dialog
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
/** @experimental */
export type {
  DialogOverlayProps,
  DialogContentProps,
  DialogHeaderProps,
  DialogFooterProps,
  DialogTitleProps,
  DialogDescriptionProps,
} from "./components/dialog";

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

/** @public Dropdown menu. Exercised by page-builder. */
// Components — DropdownMenu
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
/** @experimental */
export type {
  DropdownMenuSubTriggerProps,
  DropdownMenuSubContentProps,
  DropdownMenuContentProps,
  DropdownMenuItemProps,
  DropdownMenuCheckboxItemProps,
  DropdownMenuRadioItemProps,
  DropdownMenuLabelProps,
  DropdownMenuSeparatorProps,
  DropdownMenuShortcutProps,
} from "./types/dropdown-menu";

/** @public Select. Exercised by both first-party plugins. */
// Components — Select
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
/** @experimental */
export type { SelectTriggerProps } from "./components/select";

/** @public Sheet. Exercised by page-builder. */
// Components — Sheet
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
/** @experimental */
export type { SheetContentProps } from "./components/sheet";
/** @experimental */
export type {
  SheetProps,
  SheetTriggerProps,
  SheetCloseProps,
  SheetOverlayProps,
  SheetHeaderProps,
  SheetFooterProps,
  SheetTitleProps,
  SheetDescriptionProps,
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

/** @experimental Portal provider; the admin mounts it, no plugin does. */
// Providers
export {
  PortalProvider,
  usePortalContainer,
} from "./providers/portal-provider";

// Utilities

// Tailwind Preset
