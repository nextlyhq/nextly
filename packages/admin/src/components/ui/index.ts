/**
 * UI Components Barrel Export
 *
 * Moved components are re-exported from @revnixhq/ui.
 * Staying components (form, link, table/DataTable) are local.
 */

// ─── Re-exported from @revnixhq/ui ────────────────────────────
// Core Primitives
export { Button, buttonVariants } from "@revnixhq/ui";
export { Input, inputVariants } from "@revnixhq/ui";
export { Checkbox } from "@revnixhq/ui";
export { Label } from "@revnixhq/ui";
export { RadioGroup, RadioGroupItem } from "@revnixhq/ui";
export { Switch } from "@revnixhq/ui";
export { Textarea } from "@revnixhq/ui";
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
} from "@revnixhq/ui";

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
} from "@revnixhq/ui";
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
} from "@revnixhq/ui";
export {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@revnixhq/ui";
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
} from "@revnixhq/ui";
export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@revnixhq/ui";
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
} from "@revnixhq/ui";
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
} from "@revnixhq/ui";

// Feedback & Display
export { Alert, AlertDescription, AlertTitle } from "@revnixhq/ui";
export { Progress } from "@revnixhq/ui";
export { Skeleton } from "@revnixhq/ui";
export { Spinner } from "@revnixhq/ui";
export {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@revnixhq/ui";
export { Avatar, AvatarFallback, AvatarImage } from "@revnixhq/ui";
export { Badge } from "@revnixhq/ui";
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@revnixhq/ui";
export {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@revnixhq/ui";
export { Separator } from "@revnixhq/ui";
export { Tabs, TabsContent, TabsList, TabsTrigger } from "@revnixhq/ui";
export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@revnixhq/ui";
export { ResponsiveTable } from "@revnixhq/ui";

// ─── Local (staying in admin) ──────────────────────────────────
export * from "./form";
export * from "./form-label-with-tooltip";
export { Toaster, toast } from "./toaster";
