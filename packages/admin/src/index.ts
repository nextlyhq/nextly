/**
 * `@nextlyhq/admin`: what an application mounts, and the few hooks and
 * primitives its own components read the admin with.
 *
 * This module is the admin's ENTRY: everything it exports, and everything that
 * reaches, is downloaded before an admin screen can draw. A library entry
 * cannot drop its own unused exports, so a component exported here sits in the
 * first load of every screen whether any screen uses it or not. That is why
 * the list is short and held to an allowlist (`__tests__/root-entry.test.ts`).
 *
 * Everything else the admin offers to code outside it lives in
 * `@nextlyhq/admin/kit` (`./kit.ts`): the surface `@nextlyhq/plugin-sdk/admin`
 * re-exports to plugins, loaded with the plugin pages that use it. A new export
 * for plugins belongs there, and reaches authors through the SDK.
 *
 * @module index
 */

// Mounting the admin: the root layout and the providers around it.
export { RootLayout } from "./layout/RootLayout";
export type { RootLayoutProps } from "./layout/RootLayout";
export { QueryProvider } from "./context/providers/QueryProvider";
export {
  ThemePaintScript,
  ThemeProvider,
  useTheme,
} from "./context/providers/ThemeProvider";
export type {
  ThemeProviderProps,
  UseThemeProps,
} from "./context/providers/ThemeProvider";
export {
  BrandingProvider,
  useBranding,
} from "./context/providers/BrandingProvider";
export type { AdminBranding } from "./types/branding";

// Error containment around the admin, and around one screen's query.
export { ErrorBoundary } from "./components/shared/error-boundary";
export { QueryErrorBoundary } from "./components/shared/query-error-boundary";
export type { QueryErrorBoundaryProps } from "./components/shared/query-error-boundary";

// The command palette an application mounts beside the admin.
export { CommandPalette } from "./components/shared/command-palette";

// The app's generated component map registers through these.
export {
  registerComponent,
  registerComponentMap,
  registerComponents,
  type ComponentPath,
} from "./lib/plugins/component-registry";

// Permission gating, read by `@nextlyhq/plugin-sdk/client`.
export { useCan } from "./hooks/useCan";
export { Can } from "./components/guards/Can";
export type { CanProps } from "./components/guards/Can";

// TanStack Query types the hooks below are typed with.
export type {
  QueryClient,
  QueryClientConfig,
  DefaultOptions,
  UseQueryOptions,
  UseMutationOptions,
  UseQueryResult,
  UseMutationResult,
  QueryKey,
  QueryFunction,
  MutationFunction,
  QueryClientConfigType,
} from "./types/query";

// The hooks the package README lists for reading live admin data from an
// application's own components. Each from its own module, not the queries
// barrel, so the entry reaches only these.
export { useUsers } from "./hooks/queries/useUsers";
export { useRoles } from "./hooks/queries/useRoles";
export { useCollection, useCollections } from "./hooks/queries/useCollections";
export { useMedia, useMediaItem } from "./hooks/queries/useMedia";
export { useDashboardStats } from "./hooks/queries/useDashboardStats";
export { useRecentActivity } from "./hooks/queries/useRecentActivity";
export { useBulkMutation } from "./hooks/useBulkMutation";
export type {
  BulkMutationResult,
  BulkMutationOptions,
  BulkMutationItemResult,
  UseBulkMutationReturn,
  UseBulkMutationConfig,
} from "./types/hooks/bulk-mutation";
export { useRowSelection } from "./hooks/useRowSelection";
export type {
  UseRowSelectionOptions,
  UseRowSelectionReturn,
} from "./types/hooks/row-selection";
export { useDebouncedValue } from "./hooks/useDebouncedValue";

// Toast notifications.
export { Toaster, toast } from "./components/ui/toaster";
export type { ExternalToast, ToastT } from "sonner";

// The UI primitives, re-exported from `@nextlyhq/ui`, an external peer: they
// add no code to this entry.
export {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@nextlyhq/ui";
export type {
  AccordionContentProps,
  AccordionItemProps,
  AccordionProps,
  AccordionTriggerProps,
} from "@nextlyhq/ui";
export {
  Alert,
  AlertDescription,
  AlertTitle,
  alertVariants,
} from "@nextlyhq/ui";
export type {
  AlertDescriptionProps,
  AlertProps,
  AlertTitleProps,
} from "@nextlyhq/ui";
export {
  Avatar,
  AvatarFallback,
  AvatarImage,
  avatarVariants,
} from "@nextlyhq/ui";
export type {
  AvatarFallbackProps,
  AvatarImageProps,
  AvatarProps,
} from "@nextlyhq/ui";
export { Badge, badgeVariants } from "@nextlyhq/ui";
export type { BadgeProps } from "@nextlyhq/ui";
export { Button, buttonVariants } from "@nextlyhq/ui";
export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  cardVariants,
} from "@nextlyhq/ui";
export { Stack, Grid, Stat } from "@nextlyhq/ui";
export type { StackProps, GridProps, StatProps } from "@nextlyhq/ui";
export { Label } from "@nextlyhq/ui";
export { FieldShell, FormSection, FormActions } from "@nextlyhq/ui";
export type {
  FieldLayout,
  FieldShellProps,
  FieldShellRenderProps,
  FieldWidth,
  FormSectionProps,
  FormActionsProps,
} from "@nextlyhq/ui";
export { PageFrame, PageHeader, PageTab, PageTabs } from "@nextlyhq/ui";
export type {
  PageFrameProps,
  PageHeaderProps,
  PageTabProps,
  PageTabsProps,
  PageType,
} from "@nextlyhq/ui";
export type {
  CardActionProps,
  CardContentProps,
  CardDescriptionProps,
  CardFooterProps,
  CardHeaderProps,
  CardProps,
  CardTitleProps,
} from "@nextlyhq/ui";
export { Checkbox } from "@nextlyhq/ui";
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
export type {
  CommandDialogProps,
  CommandEmptyProps,
  CommandGroupProps,
  CommandInputProps,
  CommandItemProps,
  CommandListProps,
  CommandProps,
  CommandSeparatorProps,
  CommandShortcutProps,
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
  dialogContentVariants,
} from "@nextlyhq/ui";
export type {
  DialogContentProps,
  DialogDescriptionProps,
  DialogFooterProps,
  DialogHeaderProps,
  DialogOverlayProps,
  DialogTitleProps,
} from "@nextlyhq/ui";
export { Input, inputVariants } from "@nextlyhq/ui";
export type { InputProps } from "@nextlyhq/ui";
export { Textarea } from "@nextlyhq/ui";
export { RadioGroup, RadioGroupItem } from "@nextlyhq/ui";
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
  SelectValue,
  selectTriggerVariants,
} from "@nextlyhq/ui";
export type { SelectTriggerProps } from "@nextlyhq/ui";
export { Skeleton } from "@nextlyhq/ui";
export type { SkeletonProps } from "@nextlyhq/ui";
export { Spinner, spinnerVariants } from "@nextlyhq/ui";
export type { SpinnerProps } from "@nextlyhq/ui";
export { Progress, progressVariants } from "@nextlyhq/ui";
export type { ProgressProps } from "@nextlyhq/ui";
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
export type {
  DropdownMenuCheckboxItemProps,
  DropdownMenuContentProps,
  DropdownMenuItemProps,
  DropdownMenuLabelProps,
  DropdownMenuRadioItemProps,
  DropdownMenuSeparatorProps,
  DropdownMenuShortcutProps,
  DropdownMenuSubContentProps,
  DropdownMenuSubTriggerProps,
} from "@nextlyhq/ui";
export { Tabs, TabsContent, TabsList, TabsTrigger } from "@nextlyhq/ui";
export { Switch } from "@nextlyhq/ui";
export type {
  TabsContentProps,
  TabsListProps,
  TabsProps,
  TabsTriggerProps,
} from "@nextlyhq/ui";
export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
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
export type {
  SheetCloseProps,
  SheetContentProps,
  SheetDescriptionProps,
  SheetFooterProps,
  SheetHeaderProps,
  SheetOverlayProps,
  SheetProps,
  SheetTitleProps,
  SheetTriggerProps,
} from "@nextlyhq/ui";
