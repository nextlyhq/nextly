/**
 * A card core answers on the server: one whose widget declares its own data, so
 * the admin holds no query for it. What the admin carries from the declaration,
 * how it reads the answer, and the empty state drawn in the widget's words.
 */
import { describe, expect, it } from "vitest";

import { ROUTES } from "@admin/constants/routes";
import type { RegisteredWidgetMeta } from "@admin/types/branding";
import type {
  DashboardWidget,
  WidgetSlot,
} from "@admin/types/dashboard/widgets";

import { declaredAnswerFields } from "../archetypes/cell-text";
import { EMPTY_DEFAULT } from "../frame/states";
import { resolveWidgetOutcome } from "../outcome";
import { resolveDashboardWidgets } from "../resolve-widgets";
import { questionOf } from "../widget-as-asked";

const allow = () => true;

function registered(fields: Record<string, unknown>): DashboardWidget {
  const [widget] = resolveDashboardWidgets(
    undefined,
    [
      {
        id: "acme/orders",
        title: "Open orders",
        archetype: "list",
        defaultSize: "full",
        ...fields,
      } as unknown as RegisteredWidgetMeta,
    ],
    allow
  );
  return widget;
}

const createOrder = {
  label: "Create an order",
  href: "/admin/collections/orders",
};

const declared: DashboardWidget = {
  id: "acme/orders",
  title: "Open orders",
  archetype: "list",
  size: "full",
  serverData: true,
  declaredEmpty: { title: "No open orders", action: createOrder },
};

const list = (items: Record<string, unknown>[]): WidgetSlot => ({
  ok: true,
  result: { op: "list", items },
});

// The server's verdict that the widget's own empty test held.
const markedEmpty = (items: Record<string, unknown>[]): WidgetSlot => ({
  ok: true,
  empty: true,
  result: { op: "list", items },
});

describe("what the admin carries from a declaration core answers", () => {
  it("marks it as answered on the server and draws its empty state's link under the admin", () => {
    const widget = registered({
      serverData: true,
      empty: {
        message: "No open orders",
        action: { label: "Create an order", link: "collections/orders" },
      },
    });
    expect(widget.serverData).toBe(true);
    expect(widget.declaredEmpty).toEqual({
      title: "No open orders",
      action: {
        label: "Create an order",
        href: `${ROUTES.DASHBOARD}/collections/orders`,
      },
    });
  });

  it("keeps the declared words and drops an action whose link leaves the admin", () => {
    const widget = registered({
      serverData: true,
      empty: {
        message: "No open orders",
        action: { label: "Elsewhere", link: "//example.com" },
      },
    });
    expect(widget.declaredEmpty).toEqual({ title: "No open orders" });
  });

  it("carries neither for a widget that declares neither", () => {
    // The control: a resolver that set both on every widget would satisfy the
    // two cases above.
    const widget = registered({
      query: { source: "collection:orders", op: "list" },
    });
    expect(widget.serverData).toBeUndefined();
    expect(widget.declaredEmpty).toBeUndefined();
  });
});

describe("a card core answers, as the frame draws it", () => {
  it("is loading, not refused, while its answer is on its way", () => {
    // It has no query by design, which for any other card means "this widget
    // declares none" and fails.
    expect(resolveWidgetOutcome(declared, undefined).state).toBe("loading");
    const { serverData: _, ...asked } = declared;
    expect(resolveWidgetOutcome(asked, undefined).state).toBe("failed");
  });

  it("draws the widget's empty state when the server says its empty test held, rows or none", () => {
    // The widget's own test is the verdict: an answer with rows the widget
    // calls empty draws empty, and an answer that is just as drawable without
    // the mark draws its rows.
    expect(
      resolveWidgetOutcome(
        declared,
        markedEmpty([{ id: "1", title: "Order 1" }])
      )
    ).toEqual({
      state: "empty",
      empty: { title: "No open orders", action: createOrder },
    });
    expect(
      resolveWidgetOutcome(declared, list([{ id: "1", title: "Order 1" }]))
        .state
    ).toBe("ready");
  });

  it("draws the empty state over a widget's own component", () => {
    const custom: DashboardWidget = { ...declared, archetype: "custom" };
    expect(resolveWidgetOutcome(custom, markedEmpty([])).state).toBe("empty");
    // Otherwise its own data reaches its component, which the frame draws
    // inside itself (`answered`).
    expect(
      resolveWidgetOutcome(custom, {
        ok: true,
        result: { op: "data", data: [] },
      }).state
    ).toBe("answered");
  });

  it("puts the declared words in place of a display's own when the answer has nothing", () => {
    expect(resolveWidgetOutcome(declared, list([]))).toMatchObject({
      state: "empty",
      empty: { title: "No open orders" },
    });
    // Without a declared empty state the display's own stands, detail and all.
    const { declaredEmpty: _, ...plain } = declared;
    expect(resolveWidgetOutcome(plain, list([]))).toMatchObject({
      state: "empty",
      empty: { title: "Nothing here yet", detail: expect.any(String) },
    });
  });

  it("keeps the frame's own words when the widget declares only an action", () => {
    const actionOnly: DashboardWidget = {
      ...declared,
      declaredEmpty: { action: createOrder },
    };
    expect(resolveWidgetOutcome(actionOnly, markedEmpty([]))).toEqual({
      state: "empty",
      empty: { ...EMPTY_DEFAULT, action: createOrder },
    });
  });

  it("says why when its rows carry no field to draw", () => {
    expect(resolveWidgetOutcome(declared, list([{}]))).toEqual({
      state: "failed",
      message: '"Open orders" answered rows with no fields to draw.',
    });
  });
});

describe("what a card core answers asks with", () => {
  it("asks again for a change of its settings, which core builds its data from", () => {
    const before = questionOf(declared, { items: 5 });
    expect(questionOf(declared, { items: 5 })).toBe(before);
    expect(questionOf(declared, { items: 7 })).not.toBe(before);
    expect(questionOf(declared, undefined)).toBe(questionOf(declared, {}));
  });
});

describe("what a card that asks through its cells asks with", () => {
  it("asks again when its Collection setting changes, though it has no query of its own", () => {
    // A Count card's numbers come from its cells, each with no source until
    // its Collection setting supplies one: a change of collection is a new
    // question even though the card declares no top-level query.
    const count = {
      id: "core/count",
      title: "Count",
      archetype: "custom",
      component: "core#Count",
      settings: [{ name: "collection", type: "collection" }],
      cells: [{ key: "total", query: { op: "count", status: "all" } }],
    } as unknown as DashboardWidget;
    const posts = questionOf(count, { collection: "posts" });
    expect(questionOf(count, { collection: "posts" })).toBe(posts);
    expect(questionOf(count, { collection: "pages" })).not.toBe(posts);
  });
});

describe("the fields a card core answers is drawn by", () => {
  it("are the answer's own when it describes them", () => {
    expect(
      declaredAnswerFields({
        items: [{ title: "a", id: "1" }],
        fields: [{ name: "id" }, { name: "title" }],
      })
    ).toEqual([{ name: "id" }, { name: "title" }]);
  });

  it("are the first row's keys, in their order, when it does not", () => {
    expect(
      declaredAnswerFields({
        items: [
          { title: "a", total: 3 },
          { title: "b", total: 4, extra: true },
        ],
      })
    ).toEqual([{ name: "title" }, { name: "total" }]);
    expect(declaredAnswerFields({ items: [], fields: [] })).toEqual([]);
  });
});
