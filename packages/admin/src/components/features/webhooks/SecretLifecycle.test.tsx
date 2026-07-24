import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type { WebhookSecretInfo } from "@admin/types/webhooks";

import { SecretLifecycle } from "./SecretLifecycle";

const primary: WebhookSecretInfo = {
  prefix: "whsec_ab",
  isPrimary: true,
  createdAt: "2026-07-24T00:00:00.000Z",
  expiresAt: null,
};

describe("SecretLifecycle", () => {
  it("renders the active secrets and marks the primary", () => {
    render(
      <SecretLifecycle
        secrets={[primary]}
        canManage
        onExpireOld={vi.fn()}
        isExpiring={false}
      />
    );
    expect(screen.getByText("Primary")).toBeInTheDocument();
    expect(screen.getByText(/whsec_ab/)).toBeInTheDocument();
  });

  it("degrades to an empty state instead of crashing when secrets is missing", () => {
    // A summary from a backend older than the admin bundle can omit `secrets`;
    // the panel must not throw on `.some`/`.map`.
    render(
      <SecretLifecycle
        secrets={undefined as unknown as WebhookSecretInfo[]}
        canManage
        onExpireOld={vi.fn()}
        isExpiring={false}
      />
    );
    expect(screen.getByText(/no active signing secrets/i)).toBeInTheDocument();
  });

  it("hides the Expire control when there is no overlapping secret", () => {
    render(
      <SecretLifecycle
        secrets={[primary]}
        canManage
        onExpireOld={vi.fn()}
        isExpiring={false}
      />
    );
    expect(
      screen.queryByRole("button", { name: /expire old secret/i })
    ).not.toBeInTheDocument();
  });
});
