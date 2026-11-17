// @vitest-environment jsdom

/**
 * The editor sends the builder's start-up read once as it opens, naming each
 * read by the path its own hook asks, and sends it again only for another
 * person; signing out drops what was read.
 *
 * @module admin/editor/builder-startup.test
 */
import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import { useForm, type FieldValues } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";

const who = vi.hoisted(() => ({
  userId: "ada" as string | null,
  locale: null as { code: string } | null,
}));

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  useCurrentUserId: () => who.userId,
  useDocumentLocale: () => who.locale,
  useDocumentIdentity: () => ({
    kind: "collection",
    slug: "pages",
    documentId: "p1",
  }),
}));

const sent = vi.hoisted(() => [] as Array<[string | null, string[]]>);
vi.mock("../startup-reads", () => ({
  startBuilderReads: (userId: string | null, reads: string[]) => {
    sent.push([userId, reads]);
  },
}));

import { BuilderStartup } from "./builder-startup";

afterEach(() => {
  cleanup();
  sent.length = 0;
  who.userId = "ada";
  who.locale = null;
});

function Host({ layout }: { layout: string | null }): React.JSX.Element {
  const { control, setValue } = useForm<FieldValues>({
    defaultValues: { layout: "lay-1" },
  });
  React.useEffect(() => {
    setValue("layout", layout);
  }, [layout, setValue]);
  return <BuilderStartup control={control} />;
}

describe("the builder's start-up read, sent as the editor opens", () => {
  it("names each read by the path its own hook asks", () => {
    who.locale = { code: "fr" };
    render(<Host layout="lay-1" />);
    expect(sent).toEqual([
      [
        "ada",
        [
          "/loop-collections?locale=fr",
          "/named-queries?locale=fr",
          "/library/components?locale=fr",
          "/capability",
          "/site/style",
          "/layouts/page-collection",
          "/layouts/choices?selected=lay-1&locale=fr",
        ],
      ],
    ]);
  });

  it("sends once however often the editor renders or the Layout changes", () => {
    const view = render(<Host layout="lay-1" />);
    view.rerender(<Host layout="lay-2" />);
    view.rerender(<Host layout={null} />);
    expect(sent).toHaveLength(1);
  });

  it("sends again for another person, and drops it all on signing out", () => {
    const view = render(<Host layout="lay-1" />);
    who.userId = "grace";
    view.rerender(<Host layout="lay-1" />);
    who.userId = null;
    view.rerender(<Host layout="lay-1" />);
    expect(sent.map(([userId]) => userId)).toEqual(["ada", "grace", null]);
  });
});
