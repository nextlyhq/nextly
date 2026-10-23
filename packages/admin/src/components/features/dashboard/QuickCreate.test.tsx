/**
 * What the quick-create card offers, and what it deliberately does not.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import { useCollections } from "@admin/hooks/queries/useCollections";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";

import { CardTierContext } from "../widgets/frame/tier";

import { QuickCreate } from "./QuickCreate";

// Mocked through the same specifiers the component imports: a mock registered
// against a module nobody loads leaves the real hook in place, which is a green
// that tested nothing.
vi.mock("@admin/hooks/queries/useCollections", () => ({
  useCollections: vi.fn(),
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: vi.fn(),
}));

const mockCollections = vi.mocked(useCollections);
const mockPermissions = vi.mocked(useCurrentUserPermissions);

/**
 * Only the fields this card reads; the API row is far wider.
 *
 * The return type is STATED rather than inferred. Inferred, it comes from the
 * literal before the spread, so `name` is absent from it and a caller reading
 * one back does not compile -- which `vitest` cannot see, because it does not
 * typecheck.
 */
interface TestCollection {
  id?: unknown;
  name: string;
  label?: string;
  labels?: { singular: string; plural: string };
  admin?: { hidden?: boolean; disableCreate?: boolean };
}

function collection(
  patch: Partial<TestCollection> & { name: string }
): TestCollection {
  return { id: patch.name, label: patch.name, ...patch };
}

function listing(
  items: TestCollection[],
  extra: { isLoading?: boolean; error?: Error; hasNext?: boolean } = {}
) {
  return {
    data: { items, meta: { hasNext: extra.hasNext ?? false } },
    isLoading: extra.isLoading ?? false,
    error: extra.error ?? null,
  } as unknown as ReturnType<typeof useCollections>;
}

function granting(
  slugs: string[],
  extra: { isLoading?: boolean; error?: Error } = {}
) {
  return {
    hasPermission: (slug: string) => slugs.includes(slug),
    isLoading: extra.isLoading ?? false,
    error: extra.error ?? null,
  } as unknown as ReturnType<typeof useCurrentUserPermissions>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the quick-create card", () => {
  it("offers a shortcut only where the reader may CREATE", () => {
    // 🔴 Two gates compose here and each removes a different set. The server's
    // list has already dropped collections this reader cannot see at all; this
    // one drops the ones they may read but not create in. Drawing every
    // collection the list returns would advertise a capability that answers
    // with a refusal screen.
    mockCollections.mockReturnValue(
      listing([collection({ name: "posts" }), collection({ name: "pages" })])
    );
    mockPermissions.mockReturnValue(granting(["create-posts"]));

    render(<QuickCreate />);

    expect(screen.getByTestId("quick-create-posts")).toBeInTheDocument();
    // The control: `pages` IS in the list the server returned, so its absence
    // is this filter acting rather than the fixture never offering it.
    expect(screen.queryByTestId("quick-create-pages")).toBeNull();
  });

  it("offers no shortcut for a collection kept off the dashboard, even one the reader may create in", () => {
    // `internal: true` is stored as `admin.hidden`, so the page builder's usage index stands for
    // both. The reader holds the create grant, so only the dashboard rule removes it.
    mockCollections.mockReturnValue(
      listing([
        collection({ name: "posts" }),
        collection({ name: "nx_pb_class_usage", admin: { hidden: true } }),
      ])
    );
    mockPermissions.mockReturnValue(
      granting(["create-posts", "create-nx_pb_class_usage"])
    );

    render(<QuickCreate />);

    expect(screen.getByTestId("quick-create-posts")).toBeInTheDocument();
    expect(screen.queryByTestId("quick-create-nx_pb_class_usage")).toBeNull();
  });

  it("offers no shortcut for a collection only a machine creates in, even one the reader may", () => {
    // Form submissions declare `admin.disableCreate`: their list offers no "New", so neither
    // does this card. The reader holds the create grant, so only that flag removes it.
    mockCollections.mockReturnValue(
      listing([
        collection({ name: "posts" }),
        collection({
          name: "form-submissions",
          admin: { disableCreate: true },
        }),
      ])
    );
    mockPermissions.mockReturnValue(
      granting(["create-posts", "create-form-submissions"])
    );

    render(<QuickCreate />);

    expect(screen.getByTestId("quick-create-posts")).toBeInTheDocument();
    expect(screen.queryByTestId("quick-create-form-submissions")).toBeNull();
  });

  it("names the entity the way its form does", () => {
    // The author's declared singular wins over the display label, which is the
    // order `useEntryForm` resolves — so the button and the page it opens call
    // the entity the same thing. A label-only reading says "New Blog Posts".
    mockCollections.mockReturnValue(
      listing([
        collection({
          name: "posts",
          label: "Blog Posts",
          labels: { singular: "Article", plural: "Articles" },
        }),
      ])
    );
    mockPermissions.mockReturnValue(granting(["create-posts"]));

    render(<QuickCreate />);

    expect(screen.getByText("New Article")).toBeInTheDocument();
  });

  it("falls back to the display label, then to the slug", () => {
    // The control for the case above: a resolution that only read `labels`
    // would render nothing at all for the collections that declare none, which
    // is most of them.
    mockCollections.mockReturnValue(
      listing([
        collection({ name: "pages", label: "Page" }),
        collection({ name: "notes", label: undefined }),
      ])
    );
    mockPermissions.mockReturnValue(granting(["create-pages", "create-notes"]));

    render(<QuickCreate />);

    expect(screen.getByText("New Page")).toBeInTheDocument();
    expect(screen.getByText("New notes")).toBeInTheDocument();
  });

  it("says nothing at all while the list is still loading", () => {
    // 🔴 A card that drew its empty state first and filled in afterwards tells
    // the reader they may create nothing, which is a claim rather than a
    // delay — and it is wrong for most readers for the whole of every page
    // load. Absence is the honest answer until the list has arrived.
    mockCollections.mockReturnValue(listing([], { isLoading: true }));
    mockPermissions.mockReturnValue(granting([]));

    render(<QuickCreate />);

    expect(screen.queryByTestId("quick-create-empty")).toBeNull();
    expect(screen.queryByTestId("quick-create")).toBeNull();
  });

  it("says so when the reader may create nothing", () => {
    // The control for the case above. Returning nothing whenever the list is
    // empty would satisfy the loading test and leave a reader who genuinely
    // has no create grant looking at a titled card with no body.
    mockCollections.mockReturnValue(listing([collection({ name: "posts" })]));
    mockPermissions.mockReturnValue(granting([]));

    render(<QuickCreate />);

    expect(screen.getByTestId("quick-create-empty")).toBeInTheDocument();
  });

  it("says nothing while the PERMISSIONS are still in flight", () => {
    // 🔴 The two requests resolve independently. `hasPermission` answers from
    // an empty set until `/me/permissions` lands, so a collection list that
    // arrives first filters every row out — and the card tells the reader they
    // may create nothing, for the whole of that interval, on every page load.
    mockCollections.mockReturnValue(listing([collection({ name: "posts" })]));
    mockPermissions.mockReturnValue(granting([], { isLoading: true }));

    render(<QuickCreate />);

    expect(screen.queryByTestId("quick-create-empty")).toBeNull();
    expect(screen.queryByTestId("quick-create")).toBeNull();
  });

  it("says nothing when either request FAILED", () => {
    // A failure is not an answer. Drawing the empty state from one turns a
    // transport error into a claim about this reader's permissions, and it
    // never clears.
    mockCollections.mockReturnValue(
      listing([collection({ name: "posts" })], { error: new Error("boom") })
    );
    mockPermissions.mockReturnValue(granting(["create-posts"]));

    render(<QuickCreate />);

    expect(screen.queryByTestId("quick-create-empty")).toBeNull();
    expect(screen.queryByTestId("quick-create")).toBeNull();
  });

  it("does not claim an empty set when the page was TRUNCATED", () => {
    // 🔴 The card reads one page. On an install with more collections than
    // that, every creatable one can sit beyond the boundary — so "nothing to
    // create" is false rather than merely incomplete. Saying nothing is
    // recoverable; saying the wrong thing is not.
    mockCollections.mockReturnValue(
      listing([collection({ name: "posts" })], { hasNext: true })
    );
    mockPermissions.mockReturnValue(granting([]));

    render(<QuickCreate />);

    expect(screen.queryByTestId("quick-create-empty")).toBeNull();
  });

  it("STILL says so on a complete page with nothing creatable", () => {
    // The control for the case above. Withholding the empty state whenever it
    // is empty would satisfy it and leave every reader without a create grant
    // looking at a titled card with no body.
    mockCollections.mockReturnValue(
      listing([collection({ name: "posts" })], { hasNext: false })
    );
    mockPermissions.mockReturnValue(granting([]));

    render(<QuickCreate />);

    expect(screen.getByTestId("quick-create-empty")).toBeInTheDocument();
  });

  it("counts the surplus rather than drawing it", () => {
    // Past a handful this stops being a shortcut and becomes a second
    // navigation menu, which the sidebar already is.
    const many = Array.from({ length: 9 }, (_unused, i) =>
      collection({ name: `c${i}` })
    );
    mockCollections.mockReturnValue(listing(many));
    mockPermissions.mockReturnValue(
      granting(many.map(c => `create-${c.name}`))
    );

    render(
      <CardTierContext.Provider value="large">
        <QuickCreate />
      </CardTierContext.Provider>
    );

    expect(screen.getAllByRole("link")).toHaveLength(6);
    // The rest are a menu away, not dropped: its trigger says how many it holds.
    expect(
      screen.getByRole("button", { name: "3 more collections to create" })
    ).toBeInTheDocument();
  });

  it.each<[SizeTier, number]>([
    ["small", 2],
    ["medium", 3],
    ["large", 6],
  ])(
    "offers the %s tier's %i shortcuts and the rest in a More menu",
    (tier, drawn) => {
      const many = Array.from({ length: 9 }, (_unused, i) =>
        collection({ name: `c${i}` })
      );
      mockCollections.mockReturnValue(listing(many));
      mockPermissions.mockReturnValue(
        granting(many.map(c => `create-${c.name}`))
      );

      render(
        <CardTierContext.Provider value={tier}>
          <QuickCreate />
        </CardTierContext.Provider>
      );

      // 🔴 The first ones in the list's order, so a card that grows adds to what it showed.
      expect(
        screen
          .getAllByRole("link")
          .map(link => link.getAttribute("data-testid"))
      ).toEqual(many.slice(0, drawn).map(c => `quick-create-${c.name}`));
      expect(
        screen.getByRole("button", {
          name: `${9 - drawn} more collections to create`,
        })
      ).toBeInTheDocument();
    }
  );

  it("offers no More menu when every shortcut fits", () => {
    const two = [collection({ name: "posts" }), collection({ name: "pages" })];
    mockCollections.mockReturnValue(listing(two));
    mockPermissions.mockReturnValue(granting(two.map(c => `create-${c.name}`)));

    render(
      <CardTierContext.Provider value="small">
        <QuickCreate />
      </CardTierContext.Provider>
    );

    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: /more collections/ })
    ).not.toBeInTheDocument();
  });
});
