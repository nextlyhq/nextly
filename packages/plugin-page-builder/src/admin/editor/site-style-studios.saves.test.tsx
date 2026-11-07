// @vitest-environment jsdom
/**
 * What each Design studio hands its section save, and what it does with the
 * answer: the base its value was built from, so the save is merged onto the
 * newest stored copy, and, after a merged save, the section as stored, so
 * someone else's change appears and the next save builds on it.
 *
 * The site style client is replaced with a recorder, and the builder's
 * panels with ones that keep their props: the panels' own drawing is asserted
 * where it lives.
 */
import { act, cleanup, render, renderHook } from "@testing-library/react";
import type { NamedClass } from "@nextlyhq/blocks-engine";
import type { FontsPanelProps } from "@nextlyhq/builder/shell";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Each section save, and what the next one answers. */
const saves = vi.hoisted(() => ({
  calls: [] as {
    section: string;
    value: unknown;
    options: { base?: unknown; hold?: boolean } | undefined;
  }[],
  answer: (): unknown => ({ saved: true, issues: {} }),
}));

/** The props the builder's panels were last drawn with. */
const panels = vi.hoisted(() => ({
  tokens: undefined as
    | undefined
    | {
        tokens: { tokens: { name: string }[] } | undefined;
        onChange: (next: unknown) => void;
      },
  fonts: undefined as
    | undefined
    | { onRemoveFamily: (family: unknown) => Promise<string | undefined> },
}));

vi.mock("@nextlyhq/plugin-sdk/client", () => ({ useCan: () => true }));

vi.mock("../site-style-client", () => {
  const save = async (section: string, value: unknown, options?: object) => {
    saves.calls.push({ section, value, options });
    return saves.answer();
  };
  return {
    useSaveSiteStyle: () => ({ save, reserve: () => ({}) }),
    useSaveSpacingMode: () => ({ save: async () => ({ saved: true }) }),
    useHeldSiteStyle: () => ({ extend: () => {}, release: async () => {} }),
    useFontCatalogueClient: () => ({
      load: async () => ({ families: [], previewBase: "", fetchedAt: "" }),
      add: async () => undefined,
    }),
  };
});

vi.mock("@nextlyhq/builder/shell", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/builder/shell")>()),
  TokensPanel: (props: NonNullable<typeof panels.tokens>) => {
    panels.tokens = props;
    return null;
  },
  FontsPanel: (props: NonNullable<typeof panels.fonts>) => {
    panels.fonts = props;
    return null;
  },
}));

vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk/admin")>()),
  useUploadMedia: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePluginClientConfig: () => undefined,
}));

const { FontsPanelWithUpload, TokensStudio, VariablesTab, useClassSurface } =
  await import("./site-style-studios");

const brand = {
  name: "color.brand",
  kind: "color",
  values: { light: "#123456" },
};
const accent = {
  name: "color.accent",
  kind: "color",
  values: { light: "#654321" },
};
const other = {
  name: "color.other",
  kind: "color",
  values: { light: "#abcdef" },
};

const names = (set: { tokens: { name: string }[] } | undefined) =>
  (set?.tokens ?? []).map(each => each.name);

beforeEach(() => {
  saves.calls.length = 0;
  saves.answer = () => ({ saved: true, issues: {} });
  panels.tokens = undefined;
  panels.fonts = undefined;
});

afterEach(cleanup);

describe("the Variables studio's saves", () => {
  it("hands the set it edited from as the base, and shows a token saved elsewhere once the merge is stored", async () => {
    render(
      <TokensStudio
        merged={{ tokens: [brand] } as never}
        supplied={undefined}
        pending={false}
      >
        <VariablesTab />
      </TokensStudio>
    );
    // The merge stored another person's token beside this edit.
    saves.answer = () => ({
      saved: true,
      issues: {},
      stored: { tokens: [brand, other, accent] },
    });
    await act(async () => {
      panels.tokens?.onChange({ tokens: [brand, accent] });
    });

    const first = saves.calls[0];
    expect(first?.section).toBe("tokens");
    expect(first?.options?.hold).toBe(true);
    // The base is the set as shown before the edit: brand, and no accent.
    expect(names(first?.options?.base as never)).toEqual(["color.brand"]);
    expect(names(first?.value as never)).toEqual([
      "color.brand",
      "color.accent",
    ]);
    // The studio now shows what was stored, the other token among it.
    expect(names(panels.tokens?.tokens)).toEqual(
      expect.arrayContaining(["color.brand", "color.other", "color.accent"])
    );

    // The next edit is made from that, so its base holds the other token.
    saves.answer = () => ({ saved: true, issues: {} });
    await act(async () => {
      panels.tokens?.onChange({ tokens: [brand, other] });
    });
    expect(names(saves.calls[1]?.options?.base as never)).toEqual(
      expect.arrayContaining(["color.brand", "color.other", "color.accent"])
    );
  });
});

describe("the class surface's saves", () => {
  const style = (id: string, slug: string, orderIndex: number): NamedClass =>
    ({ id, slug, orderIndex, styles: {} }) as NamedClass;
  const card = style("c1", "card", 0);
  const hero = style("c2", "hero", 1);
  const theirs = style("c3", "theirs", 2);
  const promo = style("c4", "promo", 3);

  it("merges from the list it composed against, and builds the next add on the stored merge", async () => {
    // One value across renders, as the read's cached answer is.
    const read = { classes: [card] };
    const { result } = renderHook(() =>
      useClassSurface(read, false, null, undefined)
    );
    saves.answer = () => ({
      saved: true,
      issues: {},
      stored: [card, theirs, hero],
    });
    await act(async () => {
      await result.current.add(hero);
    });
    expect(saves.calls[0]).toMatchObject({
      section: "classes",
      value: [card, hero],
      options: { base: [card] },
    });

    saves.answer = () => ({ saved: true, issues: {} });
    await act(async () => {
      await result.current.add(promo);
    });
    // Built on the merge as stored, someone else's style kept.
    expect(saves.calls[1]).toMatchObject({
      value: [card, theirs, hero, promo],
      options: { base: [card, theirs, hero] },
    });
  });
});

describe("the Fonts tab's saves", () => {
  const face = (family: string, id: string) => ({
    family,
    weight: "400",
    style: "normal",
    src: [{ url: `/api/media/${id}/raw`, format: "woff2" as const }],
  });
  const lora = face("Lora", "m1");
  const inter = face("Inter", "m2");
  const added = face("Merriweather", "m3");

  it("removes a family from the faces it read, and builds the next save on the stored merge", async () => {
    render(
      <FontsPanelWithUpload
        {...({} as FontsPanelProps)}
        storedFaces={[lora, inter]}
        storedPending={false}
        unreadableFonts={[]}
      />
    );
    saves.answer = () => ({ saved: true, issues: {}, stored: [inter, added] });
    await act(async () => {
      await panels.fonts?.onRemoveFamily({ key: "lora", family: "Lora" });
    });
    expect(saves.calls[0]).toMatchObject({
      section: "fonts",
      value: [inter],
      options: { base: [lora, inter] },
    });

    saves.answer = () => ({ saved: true, issues: {} });
    await act(async () => {
      await panels.fonts?.onRemoveFamily({ key: "inter", family: "Inter" });
    });
    // The face stored by someone else is in what the next save is made from.
    expect(saves.calls[1]?.options?.base).toEqual(
      expect.arrayContaining([added])
    );
  });
});
