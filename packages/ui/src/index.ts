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
export { Button, buttonVariants } from "./components/button";
export type { ButtonProps } from "./types/button";

/** @public Form controls (input, textarea, label, tooltip label). */
// Components — Input
export { Input, inputVariants } from "./components/input";
export type { InputProps } from "./components/input";
export { Textarea } from "./components/textarea";
export { Label } from "./components/label";
export { FormLabelWithTooltip } from "./components/form-label-with-tooltip";
export type { FormLabelWithTooltipProps } from "./components/form-label-with-tooltip";

/** Mixed: `Badge` is @public; the rest of this group is @experimental. */
// Components — Display
export { Badge, badgeVariants } from "./components/badge";
export type { BadgeProps } from "./components/badge";
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
export type {
  CardProps,
  CardHeaderProps,
  CardTitleProps,
  CardDescriptionProps,
  CardActionProps,
  CardContentProps,
  CardFooterProps,
} from "./components/card";
export { Stack, Grid, Stat } from "./components/layout";
export type { StackProps, GridProps, StatProps } from "./components/layout";
export {
  Alert,
  AlertTitle,
  AlertDescription,
  alertVariants,
} from "./components/alert";
export type {
  AlertProps,
  AlertTitleProps,
  AlertDescriptionProps,
} from "./components/alert";
export { Separator } from "./components/separator";
export { Skeleton } from "./components/skeleton";
export type { SkeletonProps } from "./components/skeleton";
export { Progress, progressVariants } from "./components/progress";
export type { ProgressProps } from "./components/progress";

/** @public Checkbox, switch and radio group. */
// Components — Toggle
export { Checkbox } from "./components/checkbox";
export { RadioGroup, RadioGroupItem } from "./components/radio-group";
export { Switch } from "./components/switch";
export {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "./components/collapsible";

/** Mixed: `Tabs`, `Tooltip` are @public; the rest @experimental. */
// Components — Radix Primitives
export {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "./components/accordion";
export type {
  AccordionProps,
  AccordionItemProps,
  AccordionTriggerProps,
  AccordionContentProps,
} from "./types/accordion";

export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  avatarVariants,
} from "./components/avatar";
export type {
  AvatarProps,
  AvatarImageProps,
  AvatarFallbackProps,
} from "./types/avatar";

export { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/tabs";
export type {
  TabsProps,
  TabsListProps,
  TabsTriggerProps,
  TabsContentProps,
} from "./types/tabs";

export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "./components/tooltip";

export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
} from "./components/popover";

/** @public Dialog. Exercised by page-builder. */
// Components — Dialog
export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  dialogContentVariants,
} from "./components/dialog";
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
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
} from "./components/dropdown-menu";
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
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  selectTriggerVariants,
  SelectValue,
} from "./components/select";
export type { SelectTriggerProps } from "./components/select";

/** @public Sheet. Exercised by page-builder. */
// Components — Sheet
export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  sheetVariants,
} from "./components/sheet";
export type { SheetContentProps } from "./components/sheet";
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
export type { SpinnerProps } from "./components/spinner";

/** `toast` is @public; the `Toaster` component is @experimental. */
// Components — Toaster
export { Toaster, toast } from "./components/toaster";
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
export type { TableSearchProps } from "./components/table-search";

export {
  TableError,
  TableLoading,
  TableEmpty,
} from "./components/table-states";
export type {
  TableErrorProps,
  TableEmptyProps,
} from "./components/table-states";

export { TableSkeleton } from "./components/table-skeleton";
export type { TableSkeletonProps } from "./components/table-skeleton";

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
