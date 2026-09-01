/**
 * What `previewDraft` puts ON THE WIRE, checked against the schema the server
 * validates with.
 *
 * The type-level guard beside this asserts that the derived types line up, but
 * a type test cannot see inside the function: if `previewDraft` stopped
 * annotating its body and went back to a hand-authored literal, every type
 * assertion would still pass while the request drifted. So this asserts the
 * OUTCOME — it calls the real function, captures the JSON it serialised, and
 * parses that with `draftPreviewSchema` itself.
 *
 * The schema is the real one, not a copy. A field added to it that the client
 * does not send fails here even if the compile-time annotation has been lost,
 * which is the regression the annotation alone cannot defend against.
 */
import { draftPreviewSchema } from "nextly/api/email-template-preview-types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetcherSpy } = vi.hoisted(() => ({ fetcherSpy: vi.fn() }));
vi.mock("../../lib/api/fetcher", () => ({ fetcher: fetcherSpy }));

const { previewDraft } = await import("../emailTemplateApi");

beforeEach(() => {
  fetcherSpy.mockReset();
  fetcherSpy.mockResolvedValue({ subject: "", html: "", text: "" });
});

/** The body `previewDraft` handed the transport, as the server would receive it. */
async function sentBody(): Promise<unknown> {
  await previewDraft(
    {
      subject: "Hi {{userName}}",
      htmlContent: "<p>Hello {{userName}}</p>",
      plainTextContent: null,
      preheader: "the line under the subject",
      useLayout: true,
      kind: "template",
      layoutId: "layout-1",
    },
    { userName: "Priya" }
  );
  const [, init] = fetcherSpy.mock.calls[0] as [string, { body: string }];
  return JSON.parse(init.body);
}

describe("previewDraft sends a body the server's own schema accepts", () => {
  it("serialises a payload that parses against draftPreviewSchema", async () => {
    const body = await sentBody();
    // Throws on any missing or mistyped field — the same refusal the endpoint
    // would answer with a 400.
    expect(() => draftPreviewSchema.parse(body)).not.toThrow();
  });

  it("carries the authored fields through unchanged", async () => {
    const parsed = draftPreviewSchema.parse(await sentBody());
    expect(parsed.template.preheader).toBe("the line under the subject");
    expect(parsed.template.layoutId).toBe("layout-1");
    expect(parsed.data).toEqual({ userName: "Priya" });
  });

  it("posts to the draft route, not the id-addressed one", async () => {
    await sentBody();
    const [path, init] = fetcherSpy.mock.calls[0] as [
      string,
      { method: string },
    ];
    expect(path).toBe("/email-templates/preview");
    expect(init.method).toBe("POST");
  });
});
