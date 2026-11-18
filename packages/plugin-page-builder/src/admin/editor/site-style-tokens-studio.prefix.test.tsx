// @vitest-environment jsdom
/**
 * The Variables studio and the site's CSS variable prefix: the prefix is
 * changed in Settings, never in Design, so once the site style is read again
 * the studio shows and saves the new one, even holding edits of its own made
 * under the old one. Otherwise every code name, and a shadow's colour picked
 * then, would stay on the old prefix until a reload.
 *
 * The site style client is replaced with a recorder, and the builder's
 * panel with one that keeps its props.
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Each section save. */
const saves = vi.hoisted(() => ({
  calls: [] as { section: string; value: unknown }[],
}));

/** The props the builder's Variables panel was last drawn with. */
const panels = vi.hoisted(() => ({
  tokens: undefined as
    | undefined
    | {
        tokens: { prefix?: string; tokens: { name: string }[] } | undefined;
        currentTokens: () => { prefix?: string } | undefined;
        onChange: (next: unknown) => void;
      },
}));

vi.mock("@nextlyhq/plugin-sdk/client", () => ({ useCan: () => true }));

vi.mock("../site-style-client", () => {
  const save = async (section: string, value: unknown) => {
    saves.calls.push({ section, value });
    return { saved: true, issues: {} };
  };
  return {
    useSaveSiteStyle: () => ({
      save,
      reserve: (section: string) => ({
        save: (value: unknown) => save(section, value),
        cancel: () => {},
      }),
      reread: () => {},
    }),
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
}));

vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk/admin")>()),
  useUploadMedia: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePluginClientConfig: () => undefined,
}));

const { TokensStudio, VariablesTab } = await import("./site-style-studios");

const brand = {
  name: "color.brand",
  kind: "color" as const,
  values: { light: "#123456" },
};
const accent = {
  name: "color.accent",
  kind: "color" as const,
  values: { light: "#654321" },
};

function studio(merged: { prefix?: string; tokens: (typeof brand)[] }) {
  return (
    <TokensStudio merged={merged} supplied={undefined} pending={false}>
      <VariablesTab />
    </TokensStudio>
  );
}

beforeEach(() => {
  saves.calls.length = 0;
  panels.tokens = undefined;
});

afterEach(cleanup);

describe("the Variables studio's prefix", () => {
  it("shows and saves the prefix read after Settings changes it, over its own edits", async () => {
    const view = render(studio({ tokens: [brand] }));
    // An edit made under the old prefix: the studio now holds its own copy.
    await act(async () => {
      panels.tokens?.onChange({ tokens: [brand, accent] });
    });
    expect(panels.tokens?.tokens?.prefix).toBeUndefined();

    // Settings changed the prefix, and the site style was read again.
    view.rerender(studio({ tokens: [brand, accent], prefix: "--brand-" }));
    expect(panels.tokens?.tokens?.prefix).toBe("--brand-");
    expect(panels.tokens?.currentTokens()?.prefix).toBe("--brand-");

    // The next edit is made from that set, so it carries the new prefix and
    // never puts the old one back.
    await act(async () => {
      panels.tokens?.onChange({
        ...panels.tokens?.tokens,
        tokens: [brand],
      });
    });
    const last = saves.calls.at(-1)?.value as { prefix?: string } | undefined;
    expect(last?.prefix).toBe("--brand-");
  });
});
