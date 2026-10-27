/**
 * A declared widget's starting query is checked against the site's content
 * once boot has synced it: refused when what it names is fixed by the code,
 * warned about when it is the database's.
 *
 * The two registry reads are stubbed and the collections registered directly,
 * so what is under test is the rule, not how the registry is read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../collection-sources", async importOriginal => ({
  ...(await importOriginal<typeof import("../../collection-sources")>()),
  refreshCollectionSources: vi.fn(async () => true),
}));
vi.mock("../../single-sources", async importOriginal => ({
  ...(await importOriginal<typeof import("../../single-sources")>()),
  refreshSingleSources: vi.fn(async () => true),
}));

import { NextlyError } from "../../../../errors/nextly-error";
import * as loggerModule from "../../../../observability/logger";
import { registerBuiltInSources } from "../../built-in-sources";
import { refreshCollectionSources } from "../../collection-sources";
import { clearWidgets } from "../../registry";
import { clearSources } from "../../sources";
import {
  clearDeclaredWidgets,
  registerDashboardWidgets,
} from "../declared-widgets";
import { defineWidget } from "../define-widget";
import { checkDeclaredWidgetReferences } from "../references";
import { settings } from "../setting-builders";

/** A widget whose starting query lists one collection, sorted by one field. */
function listing(id: string, collection: string | undefined, sort: string) {
  return defineWidget({
    id,
    title: "Listing",
    description: "Entries of one collection",
    category: "Test",
    size: { default: { w: 12, h: 4 } },
    settings: {
      collection: {
        ...settings.collection(),
        ...(collection === undefined ? {} : { defaultValue: collection }),
      },
    },
    load: {
      query: ({ settings }) => ({
        collection: settings.collection,
        op: "list",
        // The field its rows show, which is the field it sorts by: a row
        // display's query selects at least one.
        select: [sort],
        sort,
      }),
    },
    view: "list",
  });
}

const CODE = {
  collections: new Set(["orders"]),
  singles: new Set<string>(),
  databaseNotSetUp: false,
};
const SHOP = 'plugin "@acme/shop"';

let warn: ReturnType<typeof vi.fn>;

beforeEach(() => {
  clearWidgets();
  clearSources();
  clearDeclaredWidgets();
  // `orders` is defined in code; `notes` was made in the Schema Builder.
  registerBuiltInSources([
    { slug: "orders", fields: [{ name: "state", type: "text" }] },
    { slug: "notes", fields: [{ name: "title", type: "text" }] },
  ]);
  warn = vi.fn();
  vi.spyOn(loggerModule, "getNextlyLogger").mockReturnValue({
    warn,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as ReturnType<typeof loggerModule.getNextlyLogger>);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function check(...widgets: ReturnType<typeof listing>[]) {
  registerDashboardWidgets({
    groups: [{ owner: SHOP, declarations: widgets }],
  });
  await checkDeclaredWidgetReferences(CODE);
}

describe("a declared widget's starting query, once content is synced", () => {
  it("passes when everything it names exists", async () => {
    await expect(check(listing("acme/a", "orders", "state"))).resolves.toBe(
      undefined
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("refuses startup over a field missing from a collection the code defines", async () => {
    let refused: unknown;
    try {
      await check(listing("acme/a", "orders", "missing"));
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(NextlyError);
    expect((refused as NextlyError).logMessage).toContain(
      `${SHOP}, widget "acme/a": its query, built from its starting settings, cannot run`
    );
    expect((refused as NextlyError).logMessage).toContain("missing");
  });

  it("warns, and starts, over a field missing from a collection the database holds", async () => {
    await expect(check(listing("acme/a", "notes", "missing"))).resolves.toBe(
      undefined
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatchObject({
      kind: "widget-query-names-missing-content",
      widget: "acme/a",
      source: "collection:notes",
    });
  });

  it("starts, with no warning, over an existing collection the database alone holds", async () => {
    // The database's content is warned about only when the query cannot run
    // against it, not because the code does not define it.
    await expect(check(listing("acme/a", "notes", "title"))).resolves.toBe(
      undefined
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns, and starts, over a collection that is in neither", async () => {
    // Not defined in code, so its absence is a fact about the database: it may
    // have been made in the Schema Builder and since deleted.
    await expect(check(listing("acme/a", "gone", "title"))).resolves.toBe(
      undefined
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("skips a query whose collection is chosen only when a card is placed", async () => {
    await expect(check(listing("acme/a", undefined, "missing"))).resolves.toBe(
      undefined
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("refuses a query function that throws or answers no query, with every fault at once", async () => {
    // As a plain JavaScript plugin could write them: no types stop either.
    const throwing = {
      ...listing("acme/throws", "orders", "state"),
      load: {
        query: () => {
          throw new Error("settings.colection is undefined");
        },
      },
    };
    const answersNothing = {
      ...listing("acme/null", "orders", "state"),
      load: { query: () => null },
    };
    registerDashboardWidgets({
      groups: [{ owner: SHOP, declarations: [throwing, answersNothing] }],
    });
    let refused: unknown;
    try {
      await checkDeclaredWidgetReferences(CODE);
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(NextlyError);
    const message = (refused as NextlyError).logMessage ?? "";
    expect(message).toContain("2 widget declarations cannot work");
    expect(message).toContain(
      `${SHOP}, widget "acme/throws": its query function, run with its starting settings, failed: settings.colection is undefined`
    );
    expect(message).toContain(
      `${SHOP}, widget "acme/null": its query function, run with its starting settings, failed: it answered null, not a query`
    );
  });

  it("refuses a starting query whose operation its core display cannot draw", async () => {
    // Plain JavaScript: the types refuse a metric over a list at compile time.
    const metricOfList = {
      ...listing("acme/a", "orders", "state"),
      view: "figure",
    };
    registerDashboardWidgets({
      groups: [{ owner: SHOP, declarations: [metricOfList] }],
    });
    let refused: unknown;
    try {
      await checkDeclaredWidgetReferences(CODE);
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(NextlyError);
    expect((refused as NextlyError).logMessage).toContain(
      `${SHOP}, widget "acme/a": its query's operation "list" is not one the "metric" display draws (count)`
    );
    // The control: the same query under the display that draws it passes.
    clearDeclaredWidgets();
    await expect(check(listing("acme/a", "orders", "state"))).resolves.toBe(
      undefined
    );
  });

  it("reads no content registry when nothing is declared", async () => {
    // Boot reads them for nothing else: on a database not set up yet the read
    // fails, and is logged as an error, for a check that has nothing to check.
    vi.mocked(refreshCollectionSources).mockClear();
    await checkDeclaredWidgetReferences(CODE);
    expect(refreshCollectionSources).not.toHaveBeenCalled();
    // The control: with one widget declared, the registries are read.
    await check(listing("acme/a", "orders", "state"));
    expect(refreshCollectionSources).toHaveBeenCalledTimes(1);
  });

  it("waits, neither refusing nor warning, while a collection the code defines has not reached the database", async () => {
    // A fresh install: the code defines `orders`, but no table or registry row
    // exists until setup runs, so there are no sources to check against.
    // Refusing here would stop the start that setup needs.
    clearSources();
    await expect(check(listing("acme/a", "orders", "missing"))).resolves.toBe(
      undefined
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("stops startup when a set-up database's registry cannot be read", async () => {
    // Read failed, so the sources stand as they were and `orders` has none:
    // passing would admit a widget nothing checked.
    vi.mocked(refreshCollectionSources).mockResolvedValueOnce(false);
    clearSources();
    let refused: unknown;
    try {
      await check(listing("acme/a", "orders", "missing"));
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(NextlyError);
    expect((refused as NextlyError).code).toBe("SERVICE_UNAVAILABLE");
    expect((refused as NextlyError).logMessage).toContain(
      "registry could not be read"
    );
  });

  it("starts a site that defines no collections or Singles in code, whatever the registry", async () => {
    // With nothing code-defined, boot's syncs have no table to find missing,
    // so they cannot say the database is fresh; and there is nothing the
    // refusal protects: every content query is the database's, warned about.
    vi.mocked(refreshCollectionSources).mockResolvedValueOnce(false);
    clearSources();
    registerDashboardWidgets({
      groups: [
        { owner: SHOP, declarations: [listing("acme/a", "notes", "title")] },
      ],
    });
    await expect(
      checkDeclaredWidgetReferences({
        collections: new Set(),
        singles: new Set(),
        databaseNotSetUp: false,
      })
    ).resolves.toBe(undefined);
  });

  it("waits when the registry cannot be read because the database is not set up", async () => {
    vi.mocked(refreshCollectionSources).mockResolvedValueOnce(false);
    clearSources();
    registerDashboardWidgets({
      groups: [
        { owner: SHOP, declarations: [listing("acme/a", "orders", "missing")] },
      ],
    });
    await expect(
      checkDeclaredWidgetReferences({ ...CODE, databaseNotSetUp: true })
    ).resolves.toBe(undefined);
    expect(warn).not.toHaveBeenCalled();
  });

  it("refuses a starting query for a row display that selects no fields", async () => {
    // Plain JavaScript: the types require a list's query to select a field.
    const selectsNothing = {
      ...listing("acme/a", "orders", "state"),
      load: { query: () => ({ collection: "orders", op: "list" }) },
    };
    registerDashboardWidgets({
      groups: [{ owner: SHOP, declarations: [selectsNothing] }],
    });
    let refused: unknown;
    try {
      await checkDeclaredWidgetReferences(CODE);
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(NextlyError);
    expect((refused as NextlyError).logMessage).toContain(
      `${SHOP}, widget "acme/a": its query selects no fields, so the "list" display has nothing to show in each row`
    );
    // An empty selection selects nothing as well.
    clearDeclaredWidgets();
    const selectsEmpty = {
      ...listing("acme/a", "orders", "state"),
      load: { query: () => ({ collection: "orders", op: "list", select: [] }) },
    };
    registerDashboardWidgets({
      groups: [{ owner: SHOP, declarations: [selectsEmpty] }],
    });
    await expect(checkDeclaredWidgetReferences(CODE)).rejects.toThrow(
      NextlyError
    );
  });

  it("still refuses an operation a code-defined source cannot answer as unreadable", async () => {
    // A plain JavaScript query whose operation JSON cannot write: the fault
    // is reported with the others, not thrown while it is being described.
    const badOp = {
      ...listing("acme/a", "orders", "state"),
      load: { query: () => ({ collection: "orders", op: 1n }) },
    };
    registerDashboardWidgets({
      groups: [{ owner: SHOP, declarations: [badOp] }],
    });
    let refused: unknown;
    try {
      await checkDeclaredWidgetReferences(CODE);
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(NextlyError);
    expect((refused as NextlyError).logMessage).toContain(
      `its query's operation 1n is not one the "list" display draws`
    );
  });

  it("checks a plugin's renamed collection under the slug the site uses", async () => {
    // The plugin declared `orders`; the site renamed it `sales`, so only
    // `sales` exists, and the code defines it.
    clearSources();
    registerBuiltInSources([
      { slug: "sales", fields: [{ name: "state", type: "text" }] },
    ]);
    registerDashboardWidgets({
      groups: [
        {
          owner: SHOP,
          declarations: [listing("acme/a", "orders", "missing")],
          collections: { orders: "sales" },
        },
      ],
    });
    let refused: unknown;
    try {
      await checkDeclaredWidgetReferences({
        collections: new Set(["sales"]),
        singles: new Set(),
        databaseNotSetUp: false,
      });
    } catch (error) {
      refused = error;
    }
    // Refused, not warned about: the renamed collection is the code's, and its
    // field is missing.
    expect((refused as NextlyError).logMessage).toContain(
      'widget "acme/a": its query, built from its starting settings, cannot run'
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("reports every refused widget at once", async () => {
    let refused: unknown;
    try {
      await check(
        listing("acme/a", "orders", "missing"),
        listing("acme/b", "orders", "nope")
      );
    } catch (error) {
      refused = error;
    }
    const message = (refused as NextlyError).logMessage ?? "";
    expect(message).toContain('widget "acme/a"');
    expect(message).toContain('widget "acme/b"');
  });
});
