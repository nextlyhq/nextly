export { RootLayout } from "./layout/RootLayout";
export { QueryProvider } from "./context/providers/QueryProvider";
export { ThemeProvider, useTheme } from "./context/providers/ThemeProvider";
export {
  BrandingProvider,
  useBranding,
} from "./context/providers/BrandingProvider";

export type { AdminBranding } from "./types/branding";

// TanStack Query types
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

// TanStack Query hooks (queries and mutations)
export {
  // User hooks
  useCreateUser,
  useDeleteUser,
  useUpdateUser,
  useUser,
  useUsers,
  // Bulk user hooks
  useBulkUpdateUsers,
  useBulkDeleteUsers,
  useBulkAssignRole,
  // Role hooks
  useCreateRole,
  useDeleteRole,
  useRole,
  useRoles,
  useUpdateRole,
  // Bulk role hooks
  useBulkDeleteRoles,
  useBulkUpdateRoles,
  // Permission hooks
  useDeletePermission,
  usePermission,
  usePermissions,
  useUpdatePermission,
  // Collection hooks
  useCollection,
  useCollections,
  useCreateCollection,
  useDeleteCollection,
  useUpdateCollection,
  // Bulk collection hooks
  useBulkDeleteCollections,
  useBulkUpdateCollections,
} from "./hooks/queries";

// Media hooks
export {
  useMedia,
  useMediaItem,
  useUploadMedia,
  useUpdateMedia,
  useDeleteMedia,
  // Bulk media hooks
  useBulkDeleteMedia,
  useBulkUpdateMedia,
} from "./hooks/queries/useMedia";

// Dashboard hooks
export { useDashboardStats } from "./hooks/queries/useDashboardStats";
export { useRecentActivity } from "./hooks/queries/useRecentActivity";

// Custom hooks
export { useDebouncedValue } from "./hooks/useDebouncedValue";
// Permission gating (D36) — client-side UX checks for admin + plugin UI.
export { useCan } from "./hooks/useCan";
export { Can } from "./components/guards/Can";
export type { CanProps } from "./components/guards/Can";
export { useRowSelection } from "./hooks/useRowSelection";
export type {
  UseRowSelectionOptions,
  UseRowSelectionReturn,
} from "./types/hooks/row-selection";
export { useBulkMutation } from "./hooks/useBulkMutation";
export type {
  BulkMutationResult,
  BulkMutationOptions,
  BulkMutationItemResult,
  UseBulkMutationReturn,
  UseBulkMutationConfig,
} from "./types/hooks/bulk-mutation";

// Entity types
export type { UpdateUserPayload } from "./types/user";

// Toast notifications
export { Toaster } from "./components/ui/toaster";
export { toast } from "./components/ui/toaster";
export type { ExternalToast, ToastT } from "sonner";

// Error Handling Components
export { ErrorBoundary } from "./components/shared/error-boundary";
export { QueryErrorBoundary } from "./components/shared/query-error-boundary";
export type { QueryErrorBoundaryProps } from "./components/shared/query-error-boundary";
export { PluginComponentBoundary } from "./components/shared/plugin-component-boundary";
export { PluginSlot } from "./components/shared/plugin-slot";

// Plugin admin component registration (D19) — author surface re-exported by
// `@nextlyhq/plugin-sdk/admin`.
export {
  registerComponent,
  registerComponents,
  registerKnownPlugin,
  type ComponentPath,
} from "./lib/plugins/component-registry";

// Unified DataTable + plugin registries — author surface re-exported by
// `@nextlyhq/plugin-sdk/admin`. Plugins can render the shared table and add cell
// renderers, columns, column transforms, and row/bulk actions to any admin list.
export {
  DataTable,
  DataTableView,
  registerCellRenderer,
  registerColumns,
  transformColumns,
  registerRowAction,
  registerBulkAction,
} from "./components/ui/table/data-table";
export type {
  DataTableProps,
  DataTableViewProps,
  DataTableSelection,
  DataTableTarget,
  DataTableContext,
  ColumnProvider,
  ColumnTransform,
  NextlyColumn,
  NextlyFieldType,
  NextlyFieldSchema,
  CellContext,
  CellRenderer,
  CellRendererDefinition,
  RowAction,
  BulkAction,
} from "./components/ui/table/data-table";

// Error Fallback Components
export {
  PageErrorFallback,
  SectionErrorFallback,
  InlineErrorFallback,
} from "./components/shared/error-fallbacks";
export type {
  PageErrorFallbackProps,
  SectionErrorFallbackProps,
  InlineErrorFallbackProps,
} from "./components/shared/error-fallbacks";

// UI Components
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
export { BulkActionBar } from "./components/shared/bulk-action-bar";
export { BulkDeleteDialog } from "./components/shared/bulk-action-dialogs";
export type {
  BulkActionBarProps,
  BulkDeleteDialogProps,
} from "./types/ui/bulk-operations";
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
export { CommandPalette } from "./components/shared/command-palette";
export { ActionCommands } from "./components/shared/command-palette/ActionCommands";
export { UserSearchResults } from "./components/shared/command-palette/UserSearchResults";
export type {
  CommandConfig,
  NavigationCommand,
  ActionCommand,
  CommandPaletteProps,
  UserSearchResultsProps,
} from "./types/ui/command-palette";
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
export { FormLabelWithTooltip } from "./components/ui/form-label-with-tooltip";
export type { FormLabelWithTooltipProps } from "./components/ui/form-label-with-tooltip";
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

// Layout Components
export { PageContainer } from "./components/layout/page-container";
export type {
  PageContainerProps,
  PageContainerRef,
} from "./types/layout/page-container";

// Table Components
export { SearchBar } from "./components/shared/search-bar";
export type { SearchBarProps } from "./components/shared/search-bar/types";
export { Pagination } from "./components/shared/pagination";
export type { PaginationProps } from "./components/shared/pagination/types";

// Media Library Components
export { MediaLibrary } from "./components/features/media-library";
export { MediaLibrarySkeleton } from "./components/features/media-library/MediaLibrarySkeleton";
export { MediaUploadDropzone } from "./components/features/media-library/MediaUploadDropzone";
export { MediaGrid } from "./components/features/media-library/MediaGrid";
export { MediaCard } from "./components/features/media-library/MediaCard";
export { MediaPickerDialog } from "./components/features/media-library/MediaPickerDialog";
export { MediaEditDialog } from "./components/features/media-library/MediaEditDialog";

// Media Library Component Types
export type { MediaLibraryProps } from "./components/features/media-library";
export type { MediaLibrarySkeletonProps } from "./components/features/media-library/MediaLibrarySkeleton";
export type { MediaUploadDropzoneProps } from "./types/ui/media-upload-dropzone";
export type { MediaGridProps } from "./types/ui/media-grid";
export type { MediaCardProps } from "./types/ui/media-card";
export type { MediaPickerDialogProps } from "./types/ui/media-picker-dialog";
export type { MediaEditDialogProps } from "./components/features/media-library/MediaEditDialog";

// Media Library Data Types
export type {
  Media,
  MediaFolder,
  MediaParams,
  MediaListResponse,
  UploadProgress,
  FileWithPreview,
  MediaUpdateInput,
  MediaType,
  MediaTypeFilter,
} from "./types/media";

// Media Library Helper Functions
export {
  getMediaType,
  formatFileSize,
  getMediaTypeBadgeVariant,
} from "./lib/media-utils";

// Media Library Constants
export {
  MEDIA_GRID_CLASSES,
  DEFAULT_MEDIA_SKELETON_COUNT,
} from "./constants/media";

// Dashboard Components
export { StatsCard } from "./components/features/dashboard/StatsCard";
export {
  RecentActivity,
  type RecentActivityProps,
} from "./components/features/dashboard/RecentActivity";
export { WelcomeHeader } from "./components/features/dashboard/WelcomeHeader";
export { ContentStatsGrid } from "./components/features/dashboard/ContentStatsGrid";
export { RecentEntriesWidget } from "./components/features/dashboard/RecentEntriesWidget";
export { ContentStatusWidget } from "./components/features/dashboard/ContentStatusWidget";
export { CollectionQuickLinks } from "./components/features/dashboard/CollectionQuickLinks";
export { ProjectStatsGrid } from "./components/features/dashboard/ProjectStatsGrid";
export { OnboardingChecklist } from "./components/features/dashboard/OnboardingChecklist";
export {
  StatsGridSkeleton,
  ActivitySkeleton,
  RecentEntriesSkeleton,
  ContentStatusSkeleton,
  CollectionQuickLinksSkeleton,
  ProjectStatsSkeleton,
  OnboardingChecklistSkeleton,
  DashboardPageSkeleton,
} from "./components/features/dashboard/DashboardSkeleton";

// Dashboard Types
export type {
  ContentStats,
  ContentStatus,
  CollectionCount,
  DashboardStats,
  StatsCardProps,
} from "./types/dashboard/stats";
export type {
  Activity,
  ActivityType,
  ActivityCategory,
  ActivityUser,
  RecentActivityResponse,
} from "./types/dashboard/activity";
export type {
  RecentEntry,
  RecentEntriesResponse,
} from "./types/dashboard/recent-entries";
export type { ProjectStatItem } from "./types/dashboard/project-stats";
export type {
  OnboardingStepId,
  OnboardingStep,
  OnboardingProgress,
} from "./types/dashboard/onboarding";

// Constants
export {
  MOBILE_DRAWER_WIDTH,
  MOBILE_DRAWER_WIDTH_REM,
  SIDEBAR_BREAKPOINT,
  SIDEBAR_WIDTH_COLLAPSED,
  SIDEBAR_WIDTH_COLLAPSED_REM,
  SIDEBAR_WIDTH_EXPANDED,
  SIDEBAR_WIDTH_EXPANDED_REM,
  USER_PANEL_WIDTH,
} from "./constants/sidebar";
