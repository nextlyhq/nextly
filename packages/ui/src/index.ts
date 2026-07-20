// `cn` and the Tailwind preset are deliberately NOT re-exported here: this
// barrel ships a `"use client"` banner, and a server-rendered page or a
// Tailwind config importing them through it would load a client module. They
// are published as "@nextlyhq/ui/utils" and "@nextlyhq/ui/tailwind-preset".
//
// This barrel is published with a `"use client"` banner (see tsup.config.ts):
// all but a couple of these modules use hooks, context, forwardRef or Radix
// and cannot render in a Server Component. Build-time-only exports are
// published separately as "@nextlyhq/ui/tailwind-preset".

// Components — Button
export { Button, buttonVariants } from "./components/button";
export type { ButtonProps } from "./types/button";

// Components — Input
export { Input, inputVariants } from "./components/input";
export type { InputProps } from "./components/input";
export { Textarea } from "./components/textarea";
export { Label } from "./components/label";
export { FormLabelWithTooltip } from "./components/form-label-with-tooltip";
export type { FormLabelWithTooltipProps } from "./components/form-label-with-tooltip";

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

// Components — Toggle
export { Checkbox } from "./components/checkbox";
export { RadioGroup, RadioGroupItem } from "./components/radio-group";
export { Switch } from "./components/switch";
export {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "./components/collapsible";

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

// Components — Spinner
export { Spinner, spinnerVariants } from "./components/spinner";
export type { SpinnerProps } from "./components/spinner";

// Components — Toaster
export { Toaster, toast } from "./components/toaster";
export type { ToasterProps } from "sonner";

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

// Providers
export {
  PortalProvider,
  usePortalContainer,
} from "./providers/portal-provider";

// Utilities

// Tailwind Preset
