/**
 * A real record fills the test send as well as the preview: what the picker
 * loads is the test data the form hands its Send test dialog. (That the dialog
 * sends what it is handed is send-test's own test.)
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { EmailTemplateRecord } from "@admin/services/emailTemplateApi";

import { EmailTemplateForm } from "../EmailTemplateForm";

const api = vi.hoisted(() => ({
  listTemplates: vi.fn(),
  previewDraft: vi.fn(),
}));

vi.mock("@admin/services/emailTemplateApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/emailTemplateApi")>();
  return { ...actual, ...api };
});
vi.mock("@admin/hooks/queries/useEmailProviders", () => ({
  useEmailProviders: () => ({ data: { data: [] } }),
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({ hasPermission: () => true }),
}));
vi.mock("@admin/lib/navigation", () => ({ navigateTo: vi.fn() }));
vi.mock("../liquid/LazyLiquidEditor", () => ({
  LazyLiquidEditor: (props: { label: string }) => (
    <input aria-label={props.label} />
  ),
}));
// The picker's own choosing is real-record-picker's test; here it loads one.
vi.mock("../RealRecordPicker", () => ({
  RealRecordPicker: (props: {
    onLoaded: (values: Record<string, unknown>) => void;
  }) => (
    <button
      type="button"
      onClick={() => props.onLoaded({ userName: "Ada", extra: "undeclared" })}
    >
      Load Ada
    </button>
  ),
}));
vi.mock("../SendTestDialog", () => ({
  SendTestDialog: (props: { sampleData: Record<string, unknown> }) => (
    <output data-testid="sends">{JSON.stringify(props.sampleData)}</output>
  ),
}));

const TEMPLATE = {
  id: "t1",
  name: "Welcome",
  slug: "welcome",
  kind: "template",
  subject: "Welcome {{ userName }}",
  htmlContent: "<p>Hi</p>",
  plainTextContent: null,
  preheader: null,
  layoutId: null,
  fromOverride: null,
  replyTo: null,
  variables: [
    { name: "userName", description: "", required: true, example: "Sample" },
  ],
  useLayout: true,
  isActive: true,
  providerId: null,
  attachments: null,
  createdAt: "2026-10-21T00:00:00.000Z",
  updatedAt: "2026-10-21T00:00:00.000Z",
  owner: { kind: "core" },
  description: null,
  overridden: false,
  ownerChanged: false,
  setInCode: false,
} as unknown as EmailTemplateRecord;

beforeEach(() => {
  api.listTemplates.mockResolvedValue([]);
  api.previewDraft.mockResolvedValue({ subject: "", html: "", text: "" });
});
afterEach(cleanup);

it("sends the loaded record's values, of the variables declared", () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EmailTemplateForm
        mode="edit"
        template={TEMPLATE}
        isPending={false}
        onSubmit={() => {}}
      />
    </QueryClientProvider>
  );
  const sends = () =>
    JSON.parse(screen.getByTestId("sends").textContent ?? "{}") as Record<
      string,
      unknown
    >;
  expect(sends().userName).toBe("Sample");
  fireEvent.click(screen.getAllByRole("button", { name: "Data" })[0]);
  fireEvent.click(screen.getAllByRole("button", { name: "Load Ada" })[0]);
  expect(sends().userName).toBe("Ada");
  expect(sends()).not.toHaveProperty("extra");
});
