/**
 * The History panel's story list, rendered: the pinned rows for each state,
 * who did each thing, which fields changed, folds, events between versions,
 * filters, the language being edited and the retention line.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";
import userEvent from "@testing-library/user-event";
import type {
  DocumentEvent,
  VersionMeta,
  VersionScope,
} from "@admin/services/versionApi";

import { SHARED_PART } from "../history-story";
import { HistoryStoryList } from "../HistoryStoryList";

const LANGUAGES: Record<string, string> = { en: "English", es: "Spanish" };
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    enabled: true,
    getLocale: (code: string) => ({ label: LANGUAGES[code] ?? code }),
  }),
}));

/** The fields a comparison reports, keyed by "from-to". */
const diffs = vi.hoisted(
  () =>
    new Map<
      string,
      (string | { name: string; kind: string; reason: string })[]
    >()
);
vi.mock("@admin/hooks/queries/useVersions", () => ({
  useVersionDiff: ({ from, to }: { from: number | null; to: number }) => {
    const labels = from === null ? undefined : diffs.get(`${from}-${to}`);
    return {
      data: labels
        ? {
            fields: labels.map(label =>
              typeof label === "string" ? { name: label, label } : label
            ),
          }
        : undefined,
      isLoading: false,
      isError: false,
    };
  },
}));

const scope: VersionScope = {
  kind: "collection",
  slug: "posts",
  entryId: "e1",
};

function at(minutes: number): string {
  return new Date(Date.UTC(2026, 9, 14, 9, minutes)).toISOString();
}

function version(
  versionNo: number,
  minutes: number,
  overrides: Partial<VersionMeta> = {}
): VersionMeta {
  return {
    id: `v${versionNo}`,
    versionNo,
    status: "draft",
    isAutosave: false,
    label: null,
    locale: "en",
    sourceVersionNo: null,
    createdBy: "u1",
    author: { kind: "person", id: "u1", name: "Ana" },
    createdAt: at(minutes),
    updatedAt: at(minutes),
    ...overrides,
  };
}

let eventSeq = 0;
function event(
  kind: string,
  minutes: number,
  overrides: Partial<DocumentEvent> = {}
): DocumentEvent {
  eventSeq += 1;
  return {
    id: `e${eventSeq}`,
    kind,
    actorKind: "person",
    actorId: "u1",
    actorName: "Ana",
    occurredAt: at(minutes),
    fromState: null,
    toState: null,
    note: null,
    versionNo: null,
    payload: null,
    parts: [],
    ...overrides,
  };
}

function newest<T>(items: T[]): T[] {
  return [...items].reverse();
}

function renderList(
  versions: VersionMeta[],
  events: DocumentEvent[] = [],
  props: Partial<Parameters<typeof HistoryStoryList>[0]> = {}
) {
  return render(
    <HistoryStoryList
      scope={scope}
      versions={newest(versions)}
      events={newest(events)}
      lifecycle
      localized={false}
      editingLocale={null}
      hasMore={false}
      selected={null}
      onSelect={vi.fn()}
      {...props}
    />
  );
}

beforeEach(() => {
  diffs.clear();
});

describe("the pinned rows", () => {
  it("pins a draft over a published version, with what it changes and who published", () => {
    diffs.set("1-2", ["Title", "Body"]);
    renderList(
      [version(1, 1, { status: "published" }), version(2, 2)],
      [event("published", 1, { versionNo: 1, parts: ["en"] })]
    );
    const draft = screen.getByRole("button", { name: /Current draft/ });
    expect(draft).toHaveTextContent("Title and Body");
    const published = screen.getByRole("button", {
      name: /Currently published/,
    });
    expect(published).toHaveTextContent("By Ana");
  });

  it("says a draft of a document never published is not published yet", () => {
    renderList([version(1, 1)]);
    expect(
      screen.getByRole("button", { name: /Current draft/ })
    ).toHaveTextContent("Not published yet");
    expect(
      screen.queryByRole("button", { name: /Currently published/ })
    ).toBeNull();
  });

  it("pins only what is published when there is no draft", () => {
    renderList(
      [version(1, 1, { status: "published" })],
      [event("published", 1, { versionNo: 1, parts: ["en"] })]
    );
    expect(screen.queryByRole("button", { name: /Current draft/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: /Currently published/ })
    ).toBeInTheDocument();
  });

  it("pins nothing for history-only content with no drafts", () => {
    renderList([version(1, 1, { status: "published" }), version(2, 2)], [], {
      lifecycle: false,
    });
    expect(screen.queryByRole("button", { name: /Current draft/ })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Currently published/ })
    ).toBeNull();
  });

  it("says the publisher was not recorded for a publish made before events were", () => {
    renderList([version(1, 1, { status: "published" })]);
    expect(
      screen.getByRole("button", { name: /Currently published/ })
    ).toHaveTextContent("Publisher not recorded");
  });

  it("names no part on a document without languages, though it records one", () => {
    renderList(
      [version(1, 1, { status: "published" })],
      [event("published", 1, { versionNo: 1, parts: ["en"] })]
    );
    const published = screen.getByRole("button", {
      name: /Currently published/,
    });
    expect(published).not.toHaveTextContent("English");
    expect(screen.getByRole("button", { name: /Version 1/ })).toHaveTextContent(
      /Published(?! English)/
    );
  });

  it("pins a Spanish draft beside a shared-fields draft", () => {
    renderList(
      [version(1, 1, { locale: "es" }), version(2, 2, { locale: null })],
      [],
      { localized: true, editingLocale: "es" }
    );
    const draft = screen.getByRole("button", { name: /Current draft/ });
    expect(draft).toHaveTextContent("Spanish");
    expect(draft).toHaveTextContent("Shared fields");
  });
});

describe("who made each entry", () => {
  it.each([
    [{ kind: "person" as const, id: "u1", name: "Ana" }, "Ana"],
    [
      { kind: "apiKey" as const, id: "k1", name: "Homepage key" },
      "Homepage key",
    ],
    [
      { kind: "release" as const, id: "r1", name: "Autumn launch" },
      "Release “Autumn launch”",
    ],
    [{ kind: "system" as const, id: null, name: "System" }, "System"],
    [{ kind: "agent" as const, id: "a1", name: "Writer" }, "Writer"],
  ])("names a %o author", (author, shown) => {
    renderList([version(1, 1, { author })], [], { lifecycle: false });
    expect(screen.getByRole("button", { name: /Version 1/ })).toHaveTextContent(
      shown
    );
  });

  it("says an author was not recorded rather than leaving it blank", () => {
    renderList([version(1, 1, { author: null, createdBy: null })], [], {
      lifecycle: false,
    });
    expect(screen.getByRole("button", { name: /Version 1/ })).toHaveTextContent(
      "Author not recorded"
    );
  });
});

describe("each entry's changed fields", () => {
  it("names two fields and counts the rest of an entry that changed many", () => {
    diffs.set("1-2", ["Title", "Body", "Slug", "Hero image"]);
    renderList([version(1, 1), version(2, 2)], [], { lifecycle: false });
    expect(screen.getByRole("button", { name: /Version 2/ })).toHaveTextContent(
      "Title, Body and 2 more"
    );
  });
});

describe("system columns in a change", () => {
  const system = {
    name: "firstPublishedAt",
    kind: "unknown",
    reason: "system",
  };

  it("leaves them out of an entry's changed fields", () => {
    diffs.set("1-2", ["Summary", system]);
    renderList([version(1, 1), version(2, 2)], [], { lifecycle: false });
    const row = screen.getByRole("button", { name: /Version 2/ });
    expect(row).toHaveTextContent("Summary");
    expect(row).not.toHaveTextContent("firstPublishedAt");
  });

  it("shows no summary for an entry that changed only them", () => {
    diffs.set("1-2", [system]);
    renderList([version(1, 1), version(2, 2)], [], { lifecycle: false });
    const row = screen.getByRole("button", { name: /Version 2/ });
    expect(row).not.toHaveTextContent("firstPublishedAt");
    expect(row).not.toHaveTextContent("No fields changed");
  });
});

describe("saves folded under a publish", () => {
  it("folds the saves a publish shipped, and opens them on request", async () => {
    renderList(
      [version(1, 1), version(2, 2), version(3, 3, { status: "published" })],
      [event("published", 3, { versionNo: 3, parts: ["en"] })]
    );
    expect(screen.queryByRole("button", { name: /Version 1/ })).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "2 saves in this publish" })
    );
    expect(
      screen.getByRole("button", { name: /Version 1/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Version 2/ })
    ).toBeInTheDocument();
  });
});

describe("events between versions", () => {
  it("says what each event did, who did it and what it applied to", () => {
    renderList(
      [version(1, 1)],
      [
        event("unpublished", 2, { parts: ["en"], note: "Legal hold" }),
        event("draft-discarded", 3),
        event("published", 4, {
          versionNo: 9,
          parts: ["en", "es"],
          actorKind: "release",
          actorName: "Autumn launch",
        }),
        event("versions-removed", 5, {
          actorKind: "system",
          actorName: null,
          payload: { count: 3 },
        }),
      ],
      { lifecycle: false, localized: true }
    );
    const list = screen.getByRole("list", { name: "History, newest first" });
    expect(list).toHaveTextContent("Unpublished English · “Legal hold”");
    expect(list).toHaveTextContent("Discarded the draft");
    expect(list).toHaveTextContent("Release “Autumn launch”");
    expect(list).toHaveTextContent("Published English and Spanish");
    expect(list).toHaveTextContent("3 older versions removed by retention");
  });
});

describe("filters", () => {
  it("shows only named versions under Named, without the pinned rows", async () => {
    renderList([
      version(1, 1),
      version(2, 2, { label: "Approved copy" }),
      version(3, 3),
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Named" }));
    const list = screen.getByRole("list", { name: "History, newest first" });
    expect(
      within(list).getAllByRole("button", { name: /Version/ })
    ).toHaveLength(1);
    expect(list).toHaveTextContent("Named “Approved copy”");
    expect(screen.queryByRole("button", { name: /Current draft/ })).toBeNull();
  });

  it("says when nothing matches a filter", async () => {
    renderList([version(1, 1)]);
    await userEvent.click(screen.getByRole("button", { name: "Published" }));
    expect(
      screen.getByText("Nothing to show for this filter.")
    ).toBeInTheDocument();
  });
});

describe("the language being edited", () => {
  const versions = [
    version(1, 1, { locale: "en" }),
    version(2, 2, { locale: "es" }),
    version(3, 3, { locale: null }),
  ];

  it("opens on Spanish and the shared fields, with All languages one choice away", async () => {
    renderList(versions, [], {
      lifecycle: false,
      localized: true,
      editingLocale: "es",
    });
    expect(
      screen.getByRole("button", { name: /Version 2/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Version 3/ })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Version 1/ })).toBeNull();
    expect(
      screen.getByRole("combobox", { name: "Languages shown" })
    ).toHaveTextContent("Spanish and shared fields");
  });

  it("ends the preview of a version the language view stops showing", async () => {
    const onClearSelection = vi.fn();
    renderList(versions, [], {
      lifecycle: false,
      localized: true,
      editingLocale: "es",
      // An English version, chosen while every language was shown.
      selected: 1,
      onClearSelection,
    });
    const languages = () =>
      screen.getByRole("combobox", { name: "Languages shown" });

    await userEvent.click(languages());
    await userEvent.click(
      screen.getByRole("option", { name: "All languages" })
    );
    expect(onClearSelection).not.toHaveBeenCalled();

    await userEvent.click(languages());
    await userEvent.click(
      screen.getByRole("option", { name: "Spanish and shared fields" })
    );
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });

  it("offers nothing in English that previews or restores another language's publish", async () => {
    // A Spanish save that published English too: version 3 holds Spanish
    // alone. What the English view selects is what a restore would write.
    const onSelect = vi.fn();
    renderList(
      [
        version(1, 1, { locale: "en" }),
        version(2, 2, { locale: "es" }),
        version(3, 3, { locale: "es", status: "published" }),
      ],
      [event("published", 3, { versionNo: 3, parts: ["en", "es"] })],
      { localized: true, editingLocale: "en", onSelect }
    );
    const choices = screen.getAllByRole("button", {
      name: /Version \d+|Currently published|Current draft/,
    });
    for (const choice of choices) await userEvent.click(choice);

    expect(onSelect).toHaveBeenCalled();
    expect(onSelect.mock.calls.map(([n]) => n)).not.toContain(3);
    // English is published, by the Spanish publish, with no version to open.
    expect(screen.getByText("Currently published")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Currently published/ })
    ).toBeNull();
  });

  it("shows every part under All languages", () => {
    renderList(versions, [], { lifecycle: false });
    expect(
      screen.getByRole("button", { name: /Version 1/ })
    ).toBeInTheDocument();
    expect(SHARED_PART).toBe("~shared");
  });
});

describe("retention", () => {
  it("states in one line what retention keeps", () => {
    renderList([version(1, 1)], [], { retention: 50 });
    expect(
      screen.getByText(/The newest 50 versions are kept/)
    ).toBeInTheDocument();
  });

  it("says nothing about retention when the editor does not know it", () => {
    renderList([version(1, 1)]);
    expect(
      screen.queryByText(/versions are kept|Every version is kept/)
    ).toBeNull();
  });
});
