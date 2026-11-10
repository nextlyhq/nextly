/**
 * Every core admin place is wired: for each one, the component that draws it
 * draws one contribution of each kind the place accepts, and with nothing
 * contributed draws as it did before.
 *
 * The hosts are a map typed over the catalogue's place ids, so a place added
 * to the catalogue without a host here fails to compile, naming the place. A
 * host is the component that draws its place (the page, or the part of it
 * that holds the place), rendered with the page tests' own stand-ins for
 * data, not the page's whole data path.
 *
 * Which kinds each place accepts is read from the catalogue, so a kind added
 * to a place is asked of its host too.
 */
import { ShortcutProvider } from "@nextlyhq/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  CORE_ADMIN_PLACES,
  type AdminContributionsMeta,
  type CoreAdminPlaceId,
} from "nextly/config";
import type { ReactElement, ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFormContext } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestQueryClient } from "@admin/__tests__/utils";
import {
  HeaderTrail,
  HeaderTrailProvider,
} from "@admin/components/layout/header/HeaderTrail";
import { registerComponent } from "@admin/lib/plugins/component-registry";

const SIGNED_IN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

// What the admin metadata delivers, set per case.
const meta = vi.hoisted(() => ({
  contributions: undefined as AdminContributionsMeta | undefined,
}));
// Stable across renders, as a query cache returns them.
const data = vi.hoisted(() => ({
  settings: { timezone: "UTC", dateFormat: "MM/DD/YYYY", timeFormat: "12h" },
  roles: { items: [] },
  userFields: { fields: [] },
  shownUser: {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Grace",
    email: "grace@example.com",
    isActive: true,
    roles: [],
  },
  entries: {
    items: [{ id: "p1", title: "First", status: "draft" }],
    meta: {
      total: 1,
      page: 1,
      limit: 25,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    },
  },
}));

vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/context/providers/BrandingProvider")
  >()),
  useBranding: () => ({ contributions: meta.contributions }),
}));
vi.mock("@admin/hooks/useDashboardUser", () => ({
  useDashboardUser: () => ({ user: { id: SIGNED_IN }, isLoading: false }),
}));
vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));
vi.mock("@admin/hooks/useCanRequest", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/useCanRequest")>()),
  useCanRequest: () => true,
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({ hasPermission: () => true }),
}));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    enabled: false,
    locales: [],
    defaultLocale: "en",
    fallback: true,
    getLocale: () => undefined,
  }),
}));
vi.mock("@admin/hooks/useSearchParams", () => ({
  useSearchParams: () => ({}),
}));
vi.mock("@admin/components/ui", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/components/ui")>()),
  toast: { success: vi.fn(), error: vi.fn() },
}));

// The editors' document lock, autosave and banners, as the edit-place tests
// stand them in.
vi.mock("@admin/hooks/queries/useDocumentLock", () => ({
  useDocumentLock: () => ({
    state: { status: "held-by-me" },
    takeOver: vi.fn(),
    requestAccess: vi.fn(),
  }),
}));
vi.mock("@admin/hooks/useAutosaveRecovery", () => ({
  useAutosaveRecovery: () => ({
    offer: null,
    isResolved: true,
    dismiss: () => {},
    restore: () => {},
  }),
}));
vi.mock("@admin/hooks/useDocumentAutosave", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/useDocumentAutosave")
  >()),
  useDocumentAutosave: () => ({ status: "idle", lastSavedAt: null }),
}));
vi.mock(
  "@admin/components/features/versions/viewed-version-host",
  async importOriginal => ({
    ...(await importOriginal<
      typeof import("@admin/components/features/versions/viewed-version-host")
    >()),
    ViewedVersionBody: ({
      children,
      bannerSlot,
    }: {
      children?: ReactNode;
      bannerSlot?: HTMLElement | null;
    }) => {
      const banner = <p>version banner</p>;
      return (
        <>
          {bannerSlot ? createPortal(banner, bannerSlot) : banner}
          {children}
        </>
      );
    },
  })
);

// The dashboard's own two parts, as markers.
vi.mock("@admin/components/features/dashboard/WelcomeHeader", () => ({
  WelcomeHeader: () => <h1>Welcome, Ada</h1>,
}));
vi.mock("@admin/components/features/widgets/WidgetGrid", () => ({
  WidgetGrid: () => <section aria-label="Cards">the cards</section>,
}));

// The entry list's reads.
vi.mock("@admin/hooks/queries", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/queries")>()),
  useEntries: () => ({ data: data.entries, isLoading: false, error: null }),
  useBulkDeleteEntries: () => ({ mutate: vi.fn(), isPending: false }),
  useBulkUpdateEntries: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@admin/hooks/queries/useCollections", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/queries/useCollections")
  >()),
  useCollection: () => ({
    data: {
      name: "posts",
      slug: "posts",
      label: "Posts",
      fields: [{ name: "title", type: "text", label: "Title" }],
    },
    isLoading: false,
  }),
}));

// Settings' reads.
vi.mock("@admin/hooks/queries/useGeneralSettings", () => ({
  useGeneralSettings: () => ({ data: data.settings, isLoading: false }),
  useUpdateGeneralSettings: () => ({ mutate: vi.fn(), isPending: false }),
}));

// A user's edit page's reads, and its heavier parts as stand-ins.
vi.mock("@admin/hooks/useRouter", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/useRouter")>()),
  useRouter: () => ({ route: { params: { id: OTHER } } }),
}));
vi.mock("@admin/hooks/queries/useUsers", () => ({
  useUser: () => ({
    data: data.shownUser,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useUpdateUser: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@admin/hooks/queries/useRoles", () => ({
  useRoles: () => ({
    data: data.roles,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("@admin/hooks/queries/useUserFields", () => ({
  useUserFields: () => ({ data: data.userFields }),
}));
vi.mock("@admin/hooks/useLogout", () => ({ useLogout: () => vi.fn() }));
vi.mock("@admin/components/features/user-management/form-fields", () => ({
  UserFormFields: () => {
    const { register } = useFormContext();
    return <input aria-label="name" {...register("name")} />;
  },
}));
vi.mock("@admin/components/features/user-management/avatar-uploader", () => ({
  AvatarUploader: () => null,
}));
vi.mock("@admin/components/features/user-management/breadcrumbs", () => ({
  UserBreadcrumbs: () => null,
}));
vi.mock("@admin/components/features/users/UserCustomFields", () => ({
  UserCustomFields: () => null,
}));

// The sign-in form itself is not under test here, only where it stands.
vi.mock("@admin/components/features/auth-login", () => ({
  Login: () => <form aria-label="Sign in" />,
}));

import LoginPage from "@admin/pages/(auth)/login";
import DashboardPage from "@admin/pages/dashboard";
import SettingsGeneralPage from "@admin/pages/dashboard/settings";
import EditUserPage from "@admin/pages/dashboard/users/edit";
import { EntryForm } from "@admin/components/features/entries/EntryForm/EntryForm";
import { EntryFormPlace } from "@admin/components/features/entries/EntryForm/EntryFormPlace";
import { EntryList } from "@admin/components/features/entries/EntryList/EntryList";
import {
  SingleForm,
  type SingleDocumentData,
  type SingleSchema,
} from "@admin/components/features/singles/SingleForm";

/** A contribution kind, as the catalogue lists what each place accepts. */
type Kind = (typeof CORE_ADMIN_PLACES)[CoreAdminPlaceId]["accepts"][number];

/** The fixture component each contribution draws, one per kind. */
const FIXTURE = "@acme/hosts/admin#Fixture";
registerComponent(FIXTURE, ((props: { rows?: unknown }) => (
  <aside data-testid="fixture">
    {props.rows ? "fixture dialog" : "fixture part"}
  </aside>
)) as never);

/** One contribution of `kind` at `place`, as the server delivers it. */
function contribution(kind: Kind): Record<string, unknown> {
  const base = {
    plugin: "@acme/hosts",
    id: `acme-hosts.${kind}`,
    kind,
    label: `Fixture ${kind}`,
  };
  if (kind === "rowAction" || kind === "bulkAction") {
    return { ...base, action: { open: FIXTURE } };
  }
  return { ...base, component: FIXTURE };
}

function contributeEveryKind(place: CoreAdminPlaceId): void {
  const accepts: readonly Kind[] = CORE_ADMIN_PLACES[place].accepts;
  meta.contributions = {
    [place]: Object.fromEntries(
      accepts.map(kind => [kind, [contribution(kind)]])
    ),
  } as AdminContributionsMeta;
}

function Providers({ children }: { children: ReactNode }): ReactElement {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <ShortcutProvider isApple={false}>
        <HeaderTrailProvider>
          <HeaderTrail />
          {children}
        </HeaderTrailProvider>
      </ShortcutProvider>
    </QueryClientProvider>
  );
}

/** How each kind shows itself once its host has drawn it. */
const SHOWN: Record<Kind, () => Promise<void>> = {
  block: async () => {
    expect((await screen.findAllByTestId("fixture")).length).toBeGreaterThan(0);
  },
  tab: async () => {
    expect(
      await screen.findByRole("tab", { name: "Fixture tab" })
    ).toBeTruthy();
  },
  sidebarSection: async () => {
    expect(await screen.findByText("Fixture sidebarSection")).toBeTruthy();
  },
  column: async () => {
    expect(
      await screen.findByRole("columnheader", { name: "Fixture column" })
    ).toBeTruthy();
  },
  rowAction: async () => {
    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: "Row actions" })[0]!);
    const menu = await screen.findByRole("menu");
    expect(
      within(menu).getByRole("menuitem", { name: "Fixture rowAction" })
    ).toBeTruthy();
    await user.keyboard("{Escape}");
  },
  bulkAction: async () => {
    const user = userEvent.setup();
    const table = within(screen.getByRole("table", { name: "Entries table" }));
    await user.click(table.getAllByRole("checkbox").slice(1)[0]!);
    const bar = within(screen.getByRole("region", { name: "Bulk actions" }));
    expect(bar.getByRole("button", { name: "Fixture bulkAction" })).toBeTruthy();
  },
};

/** A place's host: what draws it, and the page's own part seen without one. */
interface PlaceHost {
  render: () => void;
  /** The page's own part, there with or without a contribution. */
  own: () => Promise<HTMLElement>;
}

const posts = {
  name: "posts",
  slug: "posts",
  label: "Posts",
  labels: { singular: "Post", plural: "Posts" },
  status: true,
  fields: [
    { name: "title", type: "text", label: "Title" },
    { name: "body", type: "text", label: "Body" },
  ],
} as never;
const post = { id: "p1", title: "Hello", body: "", status: "draft" } as never;
const homepage = {
  slug: "homepage",
  label: "Homepage",
  status: true,
  fields: [
    { type: "text", name: "title", label: "Title" },
    { type: "text", name: "heroTitle", label: "Hero Title" },
  ],
} as unknown as SingleSchema;
const homepageDocument = {
  id: "s1",
  updatedAt: "2026-01-01T00:00:00.000Z",
  title: "Homepage",
  heroTitle: "",
  status: "draft",
} as unknown as SingleDocumentData;

/**
 * The host of every core place. The account page joins this map, and the
 * `Exclude` goes, when the change that adds it is on main.
 */
const PLACE_HOSTS: {
  [P in Exclude<CoreAdminPlaceId, "account">]: PlaceHost;
} = {
  dashboard: {
    render: () => render(<DashboardPage />, { wrapper: Providers }),
    own: () => screen.findByRole("heading", { name: "Welcome, Ada" }),
  },
  "collection.list": {
    render: () =>
      render(<EntryList collectionSlug="posts" />, { wrapper: Providers }),
    own: () => screen.findByRole("table", { name: "Entries table" }),
  },
  "collection.edit": {
    render: () =>
      render(<EntryForm collection={posts} entry={post} mode="edit" />, {
        wrapper: Providers,
      }),
    own: () => screen.findByLabelText("Body"),
  },
  "single.edit": {
    render: () =>
      render(
        <SingleForm
          schema={homepage}
          document={homepageDocument}
          onSubmit={vi.fn()}
        />,
        { wrapper: Providers }
      ),
    own: () => screen.findByLabelText("Hero Title"),
  },
  "entry.form": {
    render: () =>
      render(
        <EntryFormPlace kind="collection" slug="posts" entryId="p1">
          <input aria-label="Fields" />
        </EntryFormPlace>,
        { wrapper: Providers }
      ),
    own: () => screen.findByLabelText("Fields"),
  },
  settings: {
    render: () => render(<SettingsGeneralPage />, { wrapper: Providers }),
    own: () => screen.findByRole("heading", { name: "General Settings" }),
  },
  "user.detail": {
    render: () => render(<EditUserPage />, { wrapper: Providers }),
    own: () => screen.findByRole("heading", { name: "Edit User" }),
  },
  login: {
    render: () => render(<LoginPage />, { wrapper: Providers }),
    own: () => screen.findByRole("form", { name: "Sign in" }),
  },
};

beforeEach(() => {
  meta.contributions = undefined;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("every core place's host", () => {
  for (const [place, host] of Object.entries(PLACE_HOSTS) as [
    Exclude<CoreAdminPlaceId, "account">,
    PlaceHost,
  ][]) {
    const accepts: readonly Kind[] = CORE_ADMIN_PLACES[place].accepts;

    it(`${place}: draws one contribution of each kind it accepts (${accepts.join(", ")})`, async () => {
      contributeEveryKind(place);
      host.render();

      expect(await host.own()).toBeTruthy();
      for (const kind of accepts) await SHOWN[kind]();
    });

    it(`${place}: with nothing contributed, draws its own part and nothing more`, async () => {
      host.render();

      expect(await host.own()).toBeTruthy();
      expect(screen.queryByTestId("fixture")).toBeNull();
      expect(screen.queryByRole("tab", { name: "Fixture tab" })).toBeNull();
    });
  }
});
