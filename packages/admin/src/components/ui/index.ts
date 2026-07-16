/**
 * UI Components Barrel Export
 *
 * Moved components are re-exported from @nextlyhq/ui.
 * Staying components (form, link, table/DataTable) are local.
 */

// ─── Re-exported from @nextlyhq/ui ────────────────────────────
// Core Primitives
export { Button, buttonVariants } from "@nextlyhq/ui";
export { Input, inputVariants } from "@nextlyhq/ui";
export { Checkbox } from "@nextlyhq/ui";
export { Label } from "@nextlyhq/ui";
export { RadioGroup, RadioGroupItem } from "@nextlyhq/ui";
export { Switch } from "@nextlyhq/ui";
export { Textarea } from "@nextlyhq/ui";
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  SelectScrollUpButton,
  SelectScrollDownButton,
} from "@nextlyhq/ui";

// Overlay Components
export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@nextlyhq/ui";
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "@nextlyhq/ui";
export {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@nextlyhq/ui";
export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
} from "@nextlyhq/ui";
export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@nextlyhq/ui";
export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@nextlyhq/ui";
export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";

// Feedback & Display
export { Alert, AlertDescription, AlertTitle } from "@nextlyhq/ui";
export { Progress } from "@nextlyhq/ui";
export { Skeleton } from "@nextlyhq/ui";
export { Spinner } from "@nextlyhq/ui";
export {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@nextlyhq/ui";
export { Avatar, AvatarFallback, AvatarImage } from "@nextlyhq/ui";
export { Badge } from "@nextlyhq/ui";
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@nextlyhq/ui";
export {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@nextlyhq/ui";
export { Separator } from "@nextlyhq/ui";
export { Tabs, TabsContent, TabsList, TabsTrigger } from "@nextlyhq/ui";
export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@nextlyhq/ui";

// ─── Local (staying in admin) ──────────────────────────────────
export * from "./form";
export * from "./form-label-with-tooltip";
export { Toaster, toast } from "./toaster";
