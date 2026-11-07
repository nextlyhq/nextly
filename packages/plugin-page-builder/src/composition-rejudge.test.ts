/**
 * The references a write's blocks values ADD, judged again inside its
 * transaction under the composition graph lock: against the site's
 * definitions read after the lock, against the forms stored before the write,
 * and refused, never let through, when the definitions cannot be read.
 *
 * The lock itself is the database's, which the integration suite
 * (`__tests__/site-style-removal-lock.integration.test.ts`) drives with two
 * writers; here it is recorded, so the order of the lock and the read shows.
 */
import {
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
} from "@nextlyhq/blocks-engine";
import type { InTransactionContext } from "@nextlyhq/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  registerCompositionRejudge,
  SITE_DEFINITIONS_READ_MS,
  SITE_STYLES_CHANGED,
} from "./composition-rejudge";
import type {
  CompositionSetup,
  SiteDefinitions,
} from "./fields/blocks-composition";

/** What happened, in order: the lock taken, the definitions read. */
const order = vi.hoisted(() => [] as string[]);

vi.mock("./composition-graph-lock", () => ({
  holdCompositionGraph: vi.fn(async () => {
    order.push("lock");
  }),
}));

afterEach(() => {
  order.length = 0;
  vi.useRealTimers();
});

/**
 * A page whose one heading reads `text`, applies `classes` and colours with
 * `token`.
 */
const page = (
  use: { classes?: string[]; token?: string; text?: string } = {}
) => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    {
      id: "a",
      type: "core/heading",
      version: 1,
      props: { text: use.text ?? "a", level: 2 },
      ...(use.classes === undefined ? {} : { classes: use.classes }),
      ...(use.token === undefined
        ? {}
        : { styles: { base: { base: { color: { $token: use.token } } } } }),
    },
  ],
});

/** A site defining exactly these. */
const defining = (
  classIds: string[] = [],
  tokenIds: string[] = []
): SiteDefinitions => ({
  classIds: new Set(classIds),
  tokenIds: new Set(tokenIds),
  breakpointIds: new Set(),
});

/** The write's transaction, as the in-transaction phase hands it. */
const TRANSACTION = { transaction: "the write's own" } as never;

/** The composition's setup, composing nothing, reading `definitions`. */
const setupReading = (
  definitions?: CompositionSetup["siteDefinitions"]
): CompositionSetup => ({
  store: { collection: "components", field: "content" },
  limits: DEFAULT_LIMITS,
  composesDocuments: false,
  ...(definitions === undefined ? {} : { siteDefinitions: definitions }),
});

/** The handler the rejudge registers, over `setup`, on a site in `locales`. */
function rejudge(
  setup: CompositionSetup,
  locales: readonly string[] = []
): (write: InTransactionContext) => Promise<void> {
  const onInTransaction = vi.fn();
  registerCompositionRejudge(
    { hooks: { onInTransaction } as never, dialect: "postgresql" },
    () => setup,
    () => locales
  );
  const handler = onInTransaction.mock.calls[0]?.[1] as
    | ((write: InTransactionContext) => Promise<void>)
    | undefined;
  if (handler === undefined) throw new Error("no handler was registered");
  return handler;
}

/**
 * An update of a page's `content`, as the in-transaction phase hands it. Its
 * stored read answers what the write itself stored, for every form, as a read
 * on the write's own transaction does, unless `live` names the live form.
 * `liveIn` names the live form a read in one language answers, by its code,
 * over `live`; a language it does not name answers `live` (or the write's).
 */
function pageWrite(args: {
  data: unknown;
  original?: unknown;
  draft?: boolean;
  live?: unknown;
  liveIn?: Readonly<Record<string, unknown>>;
  operation?: "create" | "update";
}): InTransactionContext & { readStored: ReturnType<typeof vi.fn> } {
  const readStored = vi.fn(
    async (_type: string, target: { form?: string; locale?: string }) => {
      const inLocale =
        target.locale !== undefined && args.liveIn !== undefined
          ? args.liveIn[target.locale]
          : undefined;
      const live = inLocale ?? args.live;
      return {
        kind: "value" as const,
        value:
          target.form === "published" && live !== undefined ? live : args.data,
      };
    }
  );
  return {
    collection: "pages",
    operation: args.operation ?? "update",
    id: "p1",
    data: {
      content: args.data,
      ...(args.draft === true ? { _isWorkingDraft: true } : {}),
    },
    ...(args.original === undefined
      ? {}
      : { originalData: { content: args.original } }),
    context: {},
    db: {} as never,
    transaction: TRANSACTION,
    readStored,
    fieldPaths: async () => ["content"],
  } as unknown as InTransactionContext & {
    readStored: ReturnType<typeof vi.fn>;
  };
}

/** The issue codes a refusal carries; empty when the write passed. */
async function codesOf(run: Promise<void>): Promise<string[]> {
  try {
    await run;
    return [];
  } catch (error) {
    const issues =
      (error as { publicData?: { errors?: { code: string }[] } }).publicData
        ?.errors ?? [];
    return issues.map(issue => issue.code);
  }
}

describe("the references a write adds, judged under the lock", () => {
  it("refuses a class and a variable the site no longer defines, read after the lock", async () => {
    const definitions = vi.fn(async () => {
      order.push("definitions");
      return defining();
    });
    const handler = rejudge(setupReading(definitions));
    const codes = await codesOf(
      handler(
        pageWrite({
          data: page({ classes: ["c-gone"], token: "t-gone" }),
          original: page(),
        })
      )
    );
    expect(codes).toEqual(["unknown-class", "unknown-token"]);
    // The lock is held before the site style is read, and it is read once
    // for both checks.
    expect(order).toEqual(["lock", "definitions"]);
    expect(definitions).toHaveBeenCalledTimes(1);
  });

  it("reads the definitions on the write's own transaction, which holds the connection", async () => {
    // Asked with no transaction, the setup reads through the Direct API,
    // which on a pool of one waits for the connection this write holds.
    const definitions = vi.fn(async (_transaction?: unknown) => defining());
    const handler = rejudge(setupReading(definitions));
    await codesOf(
      handler(pageWrite({ data: page({ token: "t-gone" }), original: page() }))
    );
    expect(definitions).toHaveBeenCalledTimes(1);
    expect(definitions).toHaveBeenCalledWith(TRANSACTION);
  });

  it("refuses a class and a variable added to a blocks field inside a named group", async () => {
    // `hero.body`: the class check is reached there as the variable check is.
    const handler = rejudge(setupReading(async () => defining()));
    const added = page({ classes: ["c-gone"], token: "t-gone" });
    const write = {
      ...pageWrite({ data: added, original: page() }),
      data: { hero: { body: added } },
      originalData: { hero: { body: page() } },
      fieldPaths: async () => ["hero.body"],
    } as unknown as InTransactionContext;
    expect(await codesOf(handler(write))).toEqual([
      "unknown-class",
      "unknown-token",
    ]);
  });

  it("keeps a reference the stored page already held to something the site has since dropped", async () => {
    const definitions = vi.fn(async () => defining());
    const handler = rejudge(setupReading(definitions));
    const held = { classes: ["c-gone"], token: "t-gone" };
    expect(
      await codesOf(
        handler(
          pageWrite({
            // The heading's text edited, so the value changed and is judged.
            data: page({ ...held, text: "edited" }),
            original: page(held),
          })
        )
      )
    ).toEqual([]);
    // CONTROL: judged, and found undefined, so it is the stored form that
    // kept it.
    expect(definitions).toHaveBeenCalledTimes(1);
  });

  it("judges against the document the write replaced, not the value the transaction now reads back", async () => {
    // The stored read answers this write's own value, which holds the
    // references: judged against that, every reference would read as held.
    const handler = rejudge(setupReading(async () => defining()));
    const write = pageWrite({
      data: page({ token: "t-gone" }),
      original: page(),
    });
    expect(await codesOf(handler(write))).toEqual(["unknown-token"]);
    expect(write.readStored).not.toHaveBeenCalled();
  });

  it("keeps a reference only the live form holds when the write is a held working draft", async () => {
    // A held draft writes the draft alone: the live form is still as stored,
    // and read on the transaction.
    const handler = rejudge(setupReading(async () => defining()));
    const write = pageWrite({
      data: page({ token: "t-gone" }),
      original: page(),
      draft: true,
      live: page({ token: "t-gone" }),
    });
    expect(await codesOf(handler(write))).toEqual([]);
    expect(write.readStored).toHaveBeenCalledWith(
      "blocks",
      expect.objectContaining({ field: "content", form: "published" })
    );
  });

  it("keeps a reference only a non-default language's live form holds, for a held working draft", async () => {
    // The default language's live form holds no use of the variable; the
    // French one does. This phase is not told the draft's language, so the
    // French live form is read too, and the draft keeps the reference.
    const handler = rejudge(
      setupReading(async () => defining()),
      ["en", "fr"]
    );
    const write = pageWrite({
      data: page({ token: "t-gone" }),
      original: page(),
      draft: true,
      live: page(),
      liveIn: { fr: page({ token: "t-gone" }) },
    });
    expect(await codesOf(handler(write))).toEqual([]);
    expect(write.readStored).toHaveBeenCalledWith(
      "blocks",
      expect.objectContaining({
        field: "content",
        form: "published",
        locale: "fr",
      })
    );
  });

  it("still refuses a reference no language's live form holds, for a held working draft", async () => {
    // The control: the same draft on the same site, with no language's live
    // form holding the variable, brings a first use and is refused.
    const handler = rejudge(
      setupReading(async () => defining()),
      ["en", "fr"]
    );
    const write = pageWrite({
      data: page({ token: "t-gone" }),
      original: page(),
      draft: true,
      live: page(),
    });
    expect(await codesOf(handler(write))).toEqual(["unknown-token"]);
  });

  it("refuses every undefined reference a create brings, reading nothing stored", async () => {
    const handler = rejudge(setupReading(async () => defining()));
    const write = pageWrite({
      data: page({ classes: ["c-gone"] }),
      operation: "create",
    });
    expect(await codesOf(handler(write))).toEqual(["unknown-class"]);
    expect(write.readStored).not.toHaveBeenCalled();
  });

  it("passes references the site defines, and asks nothing of a value naming none", async () => {
    const definitions = vi.fn(async () => defining(["c-card"], ["t-brand"]));
    const handler = rejudge(setupReading(definitions));
    expect(
      await codesOf(
        handler(
          pageWrite({
            data: page({ classes: ["c-card"], token: "t-brand" }),
            original: page(),
          })
        )
      )
    ).toEqual([]);
    expect(definitions).toHaveBeenCalledTimes(1);

    definitions.mockClear();
    expect(
      await codesOf(handler(pageWrite({ data: page(), original: page() })))
    ).toEqual([]);
    expect(definitions).not.toHaveBeenCalled();
  });

  it("refuses the write as a conflict to save again when the definitions cannot be read", async () => {
    const lost = new Error("the connection was lost");
    const handler = rejudge(setupReading(() => Promise.reject(lost)));
    await expect(
      handler(pageWrite({ data: page({ token: "t-brand" }), original: page() }))
    ).rejects.toMatchObject({
      code: "CONFLICT",
      publicMessage: SITE_STYLES_CHANGED,
      cause: lost,
      logContext: { cause: "site-definitions-read-failed" },
    });
  });

  it("refuses the write, rather than waiting, when the definitions do not answer in time", async () => {
    vi.useFakeTimers();
    const handler = rejudge(setupReading(() => new Promise(() => undefined)));
    const judged = handler(
      pageWrite({ data: page({ classes: ["c-card"] }), original: page() })
    );
    const settled = expect(judged).rejects.toMatchObject({
      code: "CONFLICT",
      publicMessage: SITE_STYLES_CHANGED,
      logContext: { cause: "site-definitions-read-timed-out" },
    });
    await vi.advanceTimersByTimeAsync(SITE_DEFINITIONS_READ_MS);
    await settled;
  });

  it("judges no reference where the site's definitions cannot be read at all, as the validation does", async () => {
    const handler = rejudge(setupReading());
    expect(
      await codesOf(
        handler(
          pageWrite({ data: page({ token: "t-gone" }), original: page() })
        )
      )
    ).toEqual([]);
  });
});
