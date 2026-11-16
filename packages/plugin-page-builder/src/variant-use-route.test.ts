/**
 * Counting the placements that chose a variant, for the delete dialog.
 *
 * The properties under test are the ones a plausible count gets wrong: one
 * placement held by both a draft and the live value counted twice, a placement
 * of another variant or another component counted, and an answer that reads
 * as whole when a host could not be read or was never walked.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DEFAULT_LIMITS,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import type { HostRef } from "./fields/blocks-composition";
import {
  countVariantUse,
  MOST_HOSTS_READ,
  type VariantUseSources,
} from "./variant-use-route";

function placement(id: string, componentId: string, variant?: string) {
  return {
    id,
    type: COMPONENT_INSTANCE_TYPE,
    version: 1,
    props: { componentId, ...(variant === undefined ? {} : { variant }) },
  };
}

function doc(...nodes: unknown[]) {
  return { formatVersion: 1, kind: "page", nodes };
}

function host(slug: string, id: string, localized = false): HostRef {
  return { slug, id, field: "content", localized };
}

/** Sources over a fixed set of hosts, each with its forms. */
function sources(
  forms: Map<string, { published?: unknown; draft?: unknown } | "unreadable">,
  hosts: readonly HostRef[],
  options: { whole?: boolean; mayRead?: boolean } = {}
): VariantUseSources {
  return {
    mayRead: async () => options.mayRead ?? true,
    hosts: {
      whole: async () => options.whole ?? true,
      placing: async () => ({ hosts, complete: true }),
    },
    readForm: async (at, form) => {
      const held = forms.get(`${at.slug}/${at.id}`);
      if (held === "unreadable") throw new Error("read failed");
      return held?.[form];
    },
    limits: DEFAULT_LIMITS,
  };
}

describe("counting a variant's placements", () => {
  it("counts across pages, drafts, components and patterns, once each", async () => {
    const forms = new Map<string, { published?: unknown; draft?: unknown }>([
      // Live and draft both hold p1; the draft adds p2.
      [
        "pages/home",
        {
          published: doc(placement("p1", "card", "featured")),
          draft: doc(
            placement("p1", "card", "featured"),
            placement("p2", "card", "featured")
          ),
        },
      ],
      // Only a draft places it.
      ["pages/about", { draft: doc(placement("p3", "card", "featured")) }],
      // Another component's definition places it with the variant.
      [
        "components/hero",
        { published: doc(placement("n1", "card", "featured")) },
      ],
      // A pattern placing it under another variant, and another component.
      [
        "patterns/promo",
        {
          published: doc(
            placement("x1", "card", "compact"),
            placement("x2", "banner", "featured")
          ),
        },
      ],
    ]);
    const hosts = [
      host("pages", "home"),
      host("pages", "about"),
      host("components", "hero"),
      host("patterns", "promo"),
    ];

    expect(
      await countVariantUse("card", "featured", sources(forms, hosts))
    ).toEqual({ placements: 4, documents: 3, complete: true });
  });

  it("is a floor when a host cannot be read, and still counts the rest", async () => {
    const forms = new Map<
      string,
      { published?: unknown; draft?: unknown } | "unreadable"
    >([
      ["pages/home", { published: doc(placement("p1", "card", "featured")) }],
      ["pages/broken", "unreadable"],
    ]);

    expect(
      await countVariantUse(
        "card",
        "featured",
        sources(forms, [host("pages", "home"), host("pages", "broken")])
      )
    ).toEqual({ placements: 1, documents: 1, complete: false });
  });

  it("is a floor for a localized field it does not walk", async () => {
    expect(
      await countVariantUse(
        "card",
        "featured",
        sources(new Map(), [host("pages", "intl", true)])
      )
    ).toEqual({ placements: 0, documents: 0, complete: false });
  });

  it("is a floor while the index is not whole", async () => {
    expect(
      await countVariantUse(
        "card",
        "featured",
        sources(new Map(), [], { whole: false })
      )
    ).toMatchObject({ complete: false });
  });

  it("is a floor past the hosts one count reads", async () => {
    const hosts = Array.from({ length: MOST_HOSTS_READ + 1 }, (_, i) =>
      host("pages", `p${String(i)}`)
    );

    expect(
      await countVariantUse("card", "featured", sources(new Map(), hosts))
    ).toMatchObject({ complete: false });
  });

  it("answers nothing about a component the caller may not read", async () => {
    const forms = new Map([
      ["pages/home", { published: doc(placement("p1", "card", "featured")) }],
    ]);

    expect(
      await countVariantUse(
        "card",
        "featured",
        sources(forms, [host("pages", "home")], { mayRead: false })
      )
    ).toEqual({ placements: 0, documents: 0, complete: true });
  });

  it("reads several hosts at once, within a bound, not one after another", async () => {
    const hosts = Array.from({ length: 40 }, (_, i) =>
      host("pages", `p${String(i)}`)
    );
    let inFlight = 0;
    let most = 0;
    const base = sources(new Map(), hosts);
    const counting: VariantUseSources = {
      ...base,
      readForm: async () => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise(resolve => setTimeout(resolve, 1));
        inFlight -= 1;
        return doc(placement("x", "card", "featured"));
      },
    };

    expect(await countVariantUse("card", "featured", counting)).toEqual({
      placements: 40,
      documents: 40,
      complete: true,
    });
    expect(most).toBeGreaterThan(2);
    expect(most).toBeLessThanOrEqual(16);
  });
});
