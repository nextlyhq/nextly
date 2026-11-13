/**
 * `@nextlyhq/admin/kit/core`: the admin's own state and data, the UI primitives
 * and the component registry.
 *
 * Most of it is code the admin's first load already holds: the providers, the
 * registry, the query hooks, the error parts and the `@nextlyhq/ui` primitives
 * a plugin draws with.
 *
 * One of the kit's areas, each its own entry, so a plugin page importing a
 * part through `@nextlyhq/plugin-sdk/admin` loads that part's area and not
 * the rest of the kit. INTERNAL, and unstable as a path: plugins import
 * through the SDK, never from here (see `../kit.ts`).
 *
 * @module kit/core
 */
export { RootLayout } from "../layout/RootLayout";

export type { RootLayoutProps } from "../layout/RootLayout";

export { QueryProvider } from "../context/providers/QueryProvider";

export {
  ThemePaintScript,
  ThemeProvider,
  useTheme,
} from "../context/providers/ThemeProvider";

export type {
  ThemeProviderProps,
  UseThemeProps,
} from "../context/providers/ThemeProvider";

export {
  BrandingProvider,
  useBranding,
} from "../context/providers/BrandingProvider";

export type { AdminBranding } from "../types/branding";

// The root's types that no other line here exports, so the kit stays the
// whole surface the root is part of.
export type { ResolvedTheme } from "../context/providers/ThemeProvider";

export type { BrandingProviderProps } from "../context/providers/BrandingProvider";

export type {
  PluginClientConfigMeta,
  PluginMetadata,
  ResolvedBrandingColors,
} from "../types/branding";

export type {
  ErrorBoundaryProps,
  ErrorBoundaryState,
} from "../components/shared/error-boundary";

export type { UserApiResponse } from "../types/user";

export type { ApiCollection, Role } from "../types/entities";

export type { Collection } from "../types/collection";

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
} from "../types/query";

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
  // Single-document hooks. A plugin that owns a Single needs the same read and
  // write the admin's own Single form uses; a second client for one document
  // would be a second answer to how it caches and when it invalidates.
  useSingleDocument,
  useUpdateSingleDocument,
} from "../hooks/queries";

export type { SingleDocument } from "../hooks/queries";

// What a failed request raises, and the two guards that read it. Exported
// together because the type alone does not let a caller reach the payload: a
// rejection arrives as `Error` from `onError` and `unknown` from `catch`, and
// `ApiError.data` is `Record<string, unknown>`, so the reasons stay behind a
// cast at both steps. `isApiError` narrows the first and `validationIssues`
// answers the second, each by CHECKING rather than asserting — which matters
// because a transport failure rejects with a native error that is neither.
export {
  apiErrorMessage,
  isApiError,
  validationIssues,
  type ApiError,
  type ValidationIssue,
} from "../lib/api/parseApiError";

// Reporting a write that committed while something after it did not. A
// post-commit hook cannot un-save the row, so the server answers success and
// carries the failure alongside — and the three shapes that answer needs
// (success, advisory, partial failure) are easy to collapse into one. Published
// so a plugin's own writes report them the way the admin's do rather than
// inventing a fourth phrasing.
export {
  toastMutationResult,
  type HookWarning,
  type MutationResult,
} from "../lib/mutation-warnings";

// Media hooks
export {
  useMedia,
  useMediaItem,
  useMediaResolver,
  // The library's images searched by name, for a picker outside a dialog.
  useMediaSearcher,
  useUploadMedia,
  useUpdateMedia,
  useDeleteMedia,
  // Bulk media hooks
  useBulkDeleteMedia,
  useBulkUpdateMedia,
} from "../hooks/queries/useMedia";

// Dashboard hooks
export { useDashboardStats } from "../hooks/queries/useDashboardStats";

export { useRecentActivity } from "../hooks/queries/useRecentActivity";

// Custom hooks
export { useDebouncedValue } from "../hooks/useDebouncedValue";

// The signed-in user's id, for a surface that keeps something per user.
export { useCurrentUserId } from "../hooks/useCurrentUserId";

// Permission gating (D36) — client-side UX checks for admin + plugin UI.
export { useCan } from "../hooks/useCan";

/**
 * What a plugin's sign-in challenge view receives, and what `resolve` answers.
 * Exported for the plugin surface, so a view is typed against the contract
 * the host renders it with.
 */
export type {
  ChallengeResolveResult,
  ChallengeViewProps,
} from "../components/features/auth-login/auth-ui-extras";

export { Can } from "../components/guards/Can";

export type { CanProps } from "../components/guards/Can";

export { useRowSelection } from "../hooks/useRowSelection";

export type {
  UseRowSelectionOptions,
  UseRowSelectionReturn,
} from "../types/hooks/row-selection";

export { useBulkMutation } from "../hooks/useBulkMutation";

export type {
  BulkMutationResult,
  BulkMutationOptions,
  BulkMutationItemResult,
  UseBulkMutationReturn,
  UseBulkMutationConfig,
} from "../types/hooks/bulk-mutation";

// Entity types
export type { UpdateUserPayload } from "../types/user";

// Toast notifications
export { Toaster } from "../components/ui/toaster";

export { toast } from "../components/ui/toaster";

export type { ExternalToast, ToastT } from "sonner";

// Error Handling Components
export { ErrorBoundary } from "../components/shared/error-boundary";

export { QueryErrorBoundary } from "../components/shared/query-error-boundary";

export type { QueryErrorBoundaryProps } from "../components/shared/query-error-boundary";

export { PluginComponentBoundary } from "../components/shared/plugin-component-boundary";

export { PluginSlot } from "../components/shared/plugin-slot";

// Plugin admin component registration (D19) — author surface re-exported by
// `@nextlyhq/plugin-sdk/admin`.
export {
  registerComponent,
  registerComponents,
  registerKnownPlugin,
  type ComponentPath,
  type CustomEditViewProps,
  type DocumentActionReplacementProps,
  type DocumentChangeResult,
  type DocumentPanelSectionProps,
  type DocumentTabProps,
  type SidebarSectionProps,
  type DocumentViewProps,
} from "../lib/plugins/component-registry";

// The app's generated component map registers through this, not a plugin:
// it is not part of the plugin SDK's surface.
export { registerComponentMap } from "../lib/plugins/component-registry";

// Navigation a plugin may perform: a page of this admin, judged before it moves.
export { navigateWithinAdmin } from "../lib/navigation";

// The translator a plugin's component reads its own strings with, from the
// catalogs it declared in `contributes.translations`. Re-exported by
// `@nextlyhq/plugin-sdk/admin`.
export { usePluginTranslate } from "../lib/i18n/I18nProvider";

// Error Fallback Components
export {
  PageErrorFallback,
  SectionErrorFallback,
  InlineErrorFallback,
} from "../components/shared/error-fallbacks";

export type {
  PageErrorFallbackProps,
  SectionErrorFallbackProps,
  InlineErrorFallbackProps,
} from "../components/shared/error-fallbacks";

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

export { Stack, Grid, Stat } from "@nextlyhq/ui";

export type { StackProps, GridProps, StatProps } from "@nextlyhq/ui";

/**
 * Form scaffolding, forwarded so `plugin-sdk/admin` can reach it.
 *
 * These are the pieces a settings form cannot be assembled without: a label, a
 * field's row and description, a titled group, and the single action bar. They
 * were reachable from `@nextlyhq/ui` but not from here, so a plugin author
 * composing a form ran out of parts and fell through to a stylesheet of their
 * own — which is the one place the design linter does not run.
 *
 * `FieldShell`, `FormSection` and `FormActions` carry `@experimental` in `ui`
 * and keep it here: forwarding a component does not settle its API.
 */
export { Label } from "@nextlyhq/ui";

/** @experimental */
export { FieldShell, FormSection, FormActions } from "@nextlyhq/ui";

/** @experimental */
export type {
  FieldLayout,
  FieldShellProps,
  FieldShellRenderProps,
  FieldWidth,
  FormSectionProps,
  FormActionsProps,
} from "@nextlyhq/ui";

/**
 * A store for one of the person's interface preferences that follows the
 * device memory's rules: nothing written while the site turns remembering
 * off, forgotten with the person on sign-out. Exported for
 * `plugin-sdk/admin`, so an editor a plugin mounts keeps its choices by them.
 */
export { devicePreferenceStore } from "../lib/device-memory/preference-store";

export type {
  DevicePreferenceOptions,
  DevicePreferenceStore,
} from "../lib/device-memory/preference-store";

export { TopBarPlace } from "../components/layout/header/TopBarPlaces";

export type {
  TopBarPlaceName,
  TopBarPlaceProps,
} from "../components/layout/header/TopBarPlaces";

/**
 * A page's frame by its type and its header, forwarded so `plugin-sdk/admin`
 * can reach them: a plugin's page is drawn from the pieces core's pages are.
 * Both carry `@experimental` in `ui` and keep it here.
 */
/** @experimental */
export { PageFrame, PageHeader, PageTab, PageTabs } from "@nextlyhq/ui";

/** @experimental */
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

export { CommandPalette } from "../components/shared/command-palette";

export { ActionCommands } from "../components/shared/command-palette/ActionCommands";

export { UserSearchResults } from "../components/shared/command-palette/UserSearchResults";

export type {
  CommandConfig,
  NavigationCommand,
  ActionCommand,
  CommandPaletteProps,
  UserSearchResultsProps,
} from "../types/ui/command-palette";

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

// A field's key as the admin's screens word it ("membersOnly" is "Members
// Only"), for a plugin naming a field it holds only by its key, so the plugin
// and the admin name it alike.
export { humanizeFieldName } from "../lib/field-label";

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
} from "../constants/sidebar";
