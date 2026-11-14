/**
 * The root entry exports the types its own values are written in.
 *
 * The root keeps a few hooks and components for an application's own code
 * (`useMedia`, `useDashboardStats`, `ErrorBoundary`, …). A caller holding what
 * one returns, or passing it props, needs to name those types, and importing
 * them from anywhere but the root would send an application to the kit, which
 * is internal. Each type is checked against the value it describes, so a type
 * exported under the right name but drifted from its hook fails here too.
 * The importer audit for these names: `src/index.ts`.
 */
import type { ComponentProps } from "react";
import { expectTypeOf } from "vitest";

import type {
  Activity,
  ApiCollection,
  BrandingProviderProps,
  Collection,
  CollectionCount,
  ContentStats,
  ContentStatus,
  DashboardStats,
  ErrorBoundaryProps,
  ErrorBoundaryState,
  Media,
  MediaLibraryView,
  MediaListResponse,
  MediaParams,
  MediaType,
  PluginClientConfigMeta,
  PluginMetadata,
  RecentActivityResponse,
  ResolvedBrandingColors,
  ResolvedTheme,
  Role,
  UserApiResponse,
} from "@admin/index";
import type {
  BrandingProvider,
  ErrorBoundary,
  useBranding,
  useCollection,
  useCollections,
  useDashboardStats,
  useMedia,
  useMediaItem,
  useRecentActivity,
  useRoles,
  useTheme,
  useUsers,
} from "@admin/index";

type Data<Hook extends (...args: never[]) => { data?: unknown }> = NonNullable<
  ReturnType<Hook>["data"]
>;

expectTypeOf<Data<typeof useDashboardStats>>().toEqualTypeOf<DashboardStats>();
expectTypeOf<DashboardStats["content"]>().toEqualTypeOf<ContentStats>();
expectTypeOf<
  Data<typeof useRecentActivity>
>().toEqualTypeOf<RecentActivityResponse>();
expectTypeOf<
  RecentActivityResponse["activities"][number]
>().toEqualTypeOf<Activity>();
expectTypeOf<Data<typeof useMedia>>().toEqualTypeOf<MediaListResponse>();
expectTypeOf<Parameters<typeof useMedia>[0]>().toEqualTypeOf<
  MediaParams | undefined
>();
expectTypeOf<Data<typeof useMediaItem>>().toEqualTypeOf<Media>();
expectTypeOf<NonNullable<MediaParams["type"]>>().toEqualTypeOf<MediaType>();
expectTypeOf<ReturnType<typeof useTheme>["resolvedTheme"]>().toEqualTypeOf<
  ResolvedTheme | undefined
>();
expectTypeOf<
  ComponentProps<typeof ErrorBoundary>
>().toEqualTypeOf<ErrorBoundaryProps>();
expectTypeOf<
  ComponentProps<typeof BrandingProvider>
>().toEqualTypeOf<BrandingProviderProps>();

// Named so the import list is checked whole; the rest are read by the hooks
// above through their own fields.
export type RootTypes = [
  ApiCollection,
  Collection,
  CollectionCount,
  ContentStatus,
  ErrorBoundaryState,
  MediaLibraryView,
  PluginClientConfigMeta,
  PluginMetadata,
  ResolvedBrandingColors,
  Role,
  UserApiResponse,
  ReturnType<typeof useBranding>,
  ReturnType<typeof useCollection>,
  ReturnType<typeof useCollections>,
  ReturnType<typeof useRoles>,
  ReturnType<typeof useUsers>,
];
