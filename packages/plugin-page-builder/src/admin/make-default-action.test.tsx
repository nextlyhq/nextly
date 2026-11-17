// @vitest-environment jsdom
/**
 * "Make site default" on the Header & footer list, as an author meets it:
 * which rows offer it and to whom, the question a set with unpublished parts
 * asks, and the writes each answer makes, in order.
 */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SiteSettingsRead } from "../library-contract";

/** The row actions registered, by list, as the admin's registry holds them. */
interface Registered {
  list: string;
  id: string;
  label: unknown;
  isVisible?: (row: Record<string, unknown>) => boolean;
  onSelect: (row: Record<string, unknown>) => void;
  removed: boolean;
}
const registered: Registered[] = [];
let siteRead: SiteSettingsRead | undefined;
const refetch = vi.fn();
/** Each write, in order: its path and body. */
const writes: Array<{ path: string; body?: unknown }> = [];
let readiness: unknown = { dependencies: [], missing: 0 };
let makeDefault: () => Promise<unknown> = async () => ({});
let published: unknown = { item: { published: [], refused: [] } };

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  registerRowAction: (list: string, action: Omit<Registered, "list">) => {
    const entry = { list, ...action, removed: false };
    registered.push(entry);
    return () => {
      entry.removed = true;
    };
  },
  usePluginRoute: () => ({
    data: siteRead,
    pending: false,
    error: null,
    fetching: false,
    refetch,
  }),
  writePluginRoute: async (write: { path: string; body?: unknown }) => {
    writes.push(write);
    if (write.path === "/publish-readiness") return readiness;
    if (write.path === "/publish-dependencies") return published;
    return makeDefault();
  },
}));

const toasts = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("@nextlyhq/ui", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/ui")>()),
  toast: toasts,
}));

const { MakeDefaultListTools } = await import("./make-default-action");

const MAY: SiteSettingsRead = {
  mayManageSite: true,
  mayChooseDefaultLayout: true,
  defaultLayout: "main",
  breakpoints: null,
  layouts: [{ id: "main", title: "Main" }],
};

const MAIN = { id: "main", title: "Main", status: "published" };
const LANDING = { id: "landing", title: "Landing", status: "published" };
const DRAFT = { id: "draft", title: "Campaign", status: "draft" };

/** The live action of `id` on the list, as the row's menu offers it. */
function action(id: string): Registered {
  const found = registered.find(entry => entry.id === id && !entry.removed);
  if (found === undefined) throw new Error(`No live action ${id}`);
  return found;
}

const MAKE = "page-builder-make-site-default";
const PUBLISH_THEN = "page-builder-publish-then-make-default";

/** Choose an action on a row and let the flow run as far as it goes. */
async function select(id: string, row: Record<string, unknown>) {
  await act(async () => {
    action(id).onSelect(row);
  });
}

beforeEach(() => {
  registered.length = 0;
  writes.length = 0;
  siteRead = MAY;
  readiness = { dependencies: [], missing: 0 };
  makeDefault = async () => ({});
  published = { item: { published: [], refused: [] } };
  refetch.mockClear();
  toasts.success.mockClear();
  toasts.error.mockClear();
  toasts.warning.mockClear();
});
afterEach(cleanup);

describe("which rows offer it", () => {
  it("offers Make site default on each published set but the default, and Publish it, then make default on one not published", () => {
    render(<MakeDefaultListTools collectionSlug="layouts" />);
    const make = action(MAKE);
    expect(make.list).toBe("layouts");
    expect(make.label).toBe("Make site default");
    expect(make.isVisible?.(LANDING)).toBe(true);
    expect(make.isVisible?.(MAIN)).toBe(false);
    expect(make.isVisible?.(DRAFT)).toBe(false);
    const publishThen = action(PUBLISH_THEN);
    expect(publishThen.label).toBe("Publish it, then make default");
    expect(publishThen.isVisible?.(DRAFT)).toBe(true);
    expect(publishThen.isVisible?.(LANDING)).toBe(false);
  });

  it("offers nothing to someone who may not make a set the default", () => {
    siteRead = { ...MAY, mayChooseDefaultLayout: false };
    render(<MakeDefaultListTools collectionSlug="layouts" />);
    expect(registered.filter(entry => !entry.removed)).toEqual([]);
  });

  it("registers on the list the site resolved, renamed or not", () => {
    render(<MakeDefaultListTools collectionSlug="site_layouts" />);
    expect(action(MAKE).list).toBe("site_layouts");
  });
});

describe("making a set the default", () => {
  it("makes a ready set the default at once, says so, and reads the default again", async () => {
    render(<MakeDefaultListTools collectionSlug="layouts" />);
    await select(MAKE, LANDING);
    expect(writes.map(write => write.path)).toEqual([
      "/publish-readiness",
      "/layouts/landing/make-default",
    ]);
    expect(writes[0]?.body).toEqual({ documents: [], layout: "landing" });
    expect(toasts.success).toHaveBeenCalledWith(
      "Landing is now the site default header & footer."
    );
    expect(refetch).toHaveBeenCalled();
  });

  it("says why when the route refuses", async () => {
    makeDefault = () =>
      Promise.reject(new Error("This header & footer set is being removed."));
    render(<MakeDefaultListTools collectionSlug="layouts" />);
    await select(MAKE, LANDING);
    expect(toasts.error).toHaveBeenCalledWith(
      "This header & footer set is being removed."
    );
    expect(toasts.success).not.toHaveBeenCalled();
  });

  describe("a set whose parts are not published", () => {
    beforeEach(() => {
      readiness = {
        dependencies: [
          {
            kind: "component",
            id: "hdr",
            title: "Site header",
            mayPublish: true,
          },
        ],
        missing: 0,
      };
    });

    it("asks first, writing nothing while it asks", async () => {
      render(<MakeDefaultListTools collectionSlug="layouts" />);
      await select(MAKE, LANDING);
      const question = await screen.findByRole("alertdialog");
      expect(question.textContent).toContain(
        "This header & footer set uses 1 component that isn't published"
      );
      expect(writes.map(write => write.path)).toEqual(["/publish-readiness"]);
    });

    it("makes it the default anyway", async () => {
      render(<MakeDefaultListTools collectionSlug="layouts" />);
      await select(MAKE, LANDING);
      await userEvent.click(
        await screen.findByRole("button", { name: "Make default anyway" })
      );
      await waitFor(() =>
        expect(writes.map(write => write.path)).toEqual([
          "/publish-readiness",
          "/layouts/landing/make-default",
        ])
      );
    });

    it("publishes them, then makes it the default", async () => {
      render(<MakeDefaultListTools collectionSlug="layouts" />);
      await select(MAKE, LANDING);
      await userEvent.click(
        await screen.findByRole("button", {
          name: "Publish it, then make default",
        })
      );
      await waitFor(() =>
        expect(writes.map(write => write.path)).toEqual([
          "/publish-readiness",
          "/publish-dependencies",
          "/layouts/landing/make-default",
        ])
      );
    });

    it("changes nothing when the author cancels", async () => {
      render(<MakeDefaultListTools collectionSlug="layouts" />);
      await select(MAKE, LANDING);
      await userEvent.click(
        await screen.findByRole("button", { name: "Cancel" })
      );
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
      expect(writes.map(write => write.path)).toEqual(["/publish-readiness"]);
      expect(toasts.success).not.toHaveBeenCalled();
    });
  });

  it("publishes a set that is not published, with its parts, then makes it the default", async () => {
    readiness = {
      dependencies: [
        {
          kind: "component",
          id: "hdr",
          title: "Site header",
          mayPublish: true,
        },
        { kind: "layout", id: "draft", title: "Campaign", mayPublish: true },
      ],
      missing: 0,
    };
    render(<MakeDefaultListTools collectionSlug="layouts" />);
    await select(PUBLISH_THEN, DRAFT);
    expect(writes.map(write => write.path)).toEqual([
      "/publish-readiness",
      "/publish-dependencies",
      "/layouts/draft/make-default",
    ]);
    expect(writes[1]?.body).toEqual({
      dependencies: [
        { kind: "component", id: "hdr" },
        { kind: "layout", id: "draft" },
      ],
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("leaves the default alone when the set itself could not be published", async () => {
    readiness = {
      dependencies: [
        { kind: "layout", id: "draft", title: "Campaign", mayPublish: true },
      ],
      missing: 0,
    };
    published = {
      item: {
        published: [],
        refused: [
          { kind: "layout", id: "draft", reason: "It has a required field." },
        ],
      },
    };
    render(<MakeDefaultListTools collectionSlug="layouts" />);
    await select(PUBLISH_THEN, DRAFT);
    expect(writes.map(write => write.path)).toEqual([
      "/publish-readiness",
      "/publish-dependencies",
    ]);
    expect(toasts.error).toHaveBeenCalledWith(
      "Campaign wasn't published: It has a required field."
    );
  });
});
