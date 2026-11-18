// @vitest-environment jsdom
/**
 * The header and footer a set's own screen draws: the set form's WORKING
 * areas, each from its component's published definition, named as the set's,
 * redrawn as soon as the form's choice changes, and nothing at all for a
 * document that is not a set's screen.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface RouteRead {
  path: string;
  enabled?: boolean;
}
const routeReads: RouteRead[] = [];
let starter: string | undefined;

/** Each path's answer, kept as the admin's query cache keeps it. */
const answers = new Map<string, unknown>();

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  usePluginRoute: (read: RouteRead) => {
    routeReads.push(read);
    const key = `${String(read.enabled)} ${read.path}`;
    const known = answers.get(key);
    if (known !== undefined) return known;
    const answer = answerFor(read);
    answers.set(key, answer);
    return answer;
  },
  useDocumentLocale: () => null,
}));

function answerFor(read: RouteRead) {
  {
    if (read.enabled === false) {
      return { data: undefined, error: null, refetch: vi.fn() };
    }
    if (read.path.startsWith("/layouts/area-choices")) {
      const query = new URLSearchParams(read.path.split("?")[1]);
      const selected = query.get("selected");
      return {
        data: {
          items: [],
          meta: {
            area: query.get("area"),
            more: false,
            definitions:
              selected === null
                ? {}
                : {
                    [selected]: {
                      formatVersion: 1,
                      kind: "component",
                      nodes: [],
                    },
                  },
          },
        },
        error: null,
        refetch: vi.fn(),
      };
    }
    if (read.path.startsWith("/layouts/counts")) {
      return { data: {}, error: null, refetch: vi.fn() };
    }
    return {
      data: {
        items: [],
        meta: {
          defaultLayout: null,
          regionComponents:
            starter === undefined
              ? {}
              : {
                  [starter]: {
                    draftChangesNotLive: false,
                    untouchedStarter: "header",
                  },
                },
        },
      },
      error: null,
      refetch: vi.fn(),
    };
  }
}

const { useSetRegions } = await import("./set-regions");

afterEach(cleanup);
beforeEach(() => {
  routeReads.length = 0;
  answers.clear();
  starter = undefined;
});

function useHarness(set: { id: string } | undefined) {
  const form = useForm({
    defaultValues: {
      title: "Main",
      areas: [
        { area: "header", component: "ridgeline" },
        { area: "footer", component: { id: "base", title: "Base" } },
      ],
    },
  });
  return { form, regions: useSetRegions(form.control, set, null) };
}

describe("the regions of a set's own screen", () => {
  it("draws the form's header and footer, named as the set's", () => {
    const { result } = renderHook(() => useHarness({ id: "main" }));
    const regions = result.current.regions;
    expect(regions?.canvas.map(region => region.area)).toEqual([
      "header",
      "footer",
    ]);
    expect(regions?.canvas[0]?.label).toBe(
      "Site header, from the Main header & footer"
    );
    expect(
      regions?.cards.map(card => [card.area, card.componentId, card.setId])
    ).toEqual([
      ["header", "ridgeline", "main"],
      ["footer", "base", "main"],
    ]);
    expect(regions?.layers.map(row => row.origin)).toEqual([
      "Main header & footer",
      "Main header & footer",
    ]);
  });

  it("reads the chosen component's definitions, not every component's", () => {
    renderHook(() => useHarness({ id: "main" }));
    const asked = routeReads
      .filter(read => read.path.startsWith("/layouts/area-choices"))
      .map(read => read.path);
    expect(asked).toContain(
      "/layouts/area-choices?area=header&selected=ridgeline"
    );
    expect(asked.some(path => path.includes("pictures"))).toBe(false);
  });

  it("redraws at once when the form's choice changes, before anything is saved", () => {
    const { result } = renderHook(() => useHarness({ id: "main" }));
    act(() => {
      result.current.form.setValue("areas", [
        { area: "footer", component: { id: "base", title: "Base" } },
      ]);
    });
    expect(result.current.regions?.canvas.map(region => region.area)).toEqual([
      "footer",
    ]);
  });

  it("names the starter as the starter while it is untouched", () => {
    starter = "ridgeline";
    const { result } = renderHook(() => useHarness({ id: "main" }));
    expect(result.current.regions?.canvas[0]?.name).toBe("Starter header");
    expect(result.current.regions?.cards[0]?.starter).toBe(true);
  });

  it("draws nothing for a document that is not a set's screen, reading nothing", () => {
    const { result } = renderHook(() => useHarness(undefined));
    expect(result.current.regions).toBeUndefined();
    expect(routeReads.every(read => read.enabled === false)).toBe(true);
  });
});
