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
} from "@revnixhq/ui";
export type {
  AccordionContentProps,
  AccordionItemProps,
  AccordionProps,
  AccordionTriggerProps,
} from "@revnixhq/ui";
export {
  Alert,
  AlertDescription,
  AlertTitle,
  alertVariants,
} from "@revnixhq/ui";
export type {
  AlertDescriptionProps,
  AlertProps,
  AlertTitleProps,
} from "@revnixhq/ui";
export {
  Avatar,
  AvatarFallback,
  AvatarImage,
  avatarVariants,
} from "@revnixhq/ui";
export type {
  AvatarFallbackProps,
  AvatarImageProps,
  AvatarProps,
} from "@revnixhq/ui";
export { Badge, badgeVariants } from "@revnixhq/ui";
export type { BadgeProps } from "@revnixhq/ui";
export { Button, buttonVariants } from "@revnixhq/ui";
export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  cardVariants,
} from "@revnixhq/ui";
export type {
  CardActionProps,
  CardContentProps,
  CardDescriptionProps,
  CardFooterProps,
  CardHeaderProps,
  CardProps,
  CardTitleProps,
} from "@revnixhq/ui";
export { Checkbox } from "@revnixhq/ui";
export { BulkSelectCheckbox } from "./components/shared/bulk-select-checkbox";
export { BulkActionBar } from "./components/shared/bulk-action-bar";
export {
  RoleAssignDialog,
  BulkDeleteDialog,
} from "./components/shared/bulk-action-dialogs";
export type {
  BulkSelectCheckboxProps,
  BulkActionBarProps,
  RoleAssignDialogProps,
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
} from "@revnixhq/ui";
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
} from "@revnixhq/ui";
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
} from "@revnixhq/ui";
export type {
  DialogContentProps,
  DialogDescriptionProps,
  DialogFooterProps,
  DialogHeaderProps,
  DialogOverlayProps,
  DialogTitleProps,
} from "@revnixhq/ui";
export { Input, inputVariants } from "@revnixhq/ui";
export type { InputProps } from "@revnixhq/ui";
export { FormLabelWithTooltip } from "./components/ui/form-label-with-tooltip";
export type { FormLabelWithTooltipProps } from "./components/ui/form-label-with-tooltip";
export { Textarea } from "@revnixhq/ui";
export { RadioGroup, RadioGroupItem } from "@revnixhq/ui";
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
} from "@revnixhq/ui";
export type { SelectTriggerProps } from "@revnixhq/ui";
export { Skeleton } from "@revnixhq/ui";
export type { SkeletonProps } from "@revnixhq/ui";
export { Spinner, spinnerVariants } from "@revnixhq/ui";
export type { SpinnerProps } from "@revnixhq/ui";
export { Progress, progressVariants } from "@revnixhq/ui";
export type { ProgressProps } from "@revnixhq/ui";
export { ResponsiveTable } from "@revnixhq/ui";
export type {
  Column,
  ResponsiveTableProps,
  ResponsiveTableRef,
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
} from "@revnixhq/ui";
export { Tabs, TabsContent, TabsList, TabsTrigger } from "@revnixhq/ui";
export { Switch } from "@revnixhq/ui";
export type {
  TabsContentProps,
  TabsListProps,
  TabsProps,
  TabsTriggerProps,
} from "@revnixhq/ui";
export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
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
} from "@revnixhq/ui";

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
