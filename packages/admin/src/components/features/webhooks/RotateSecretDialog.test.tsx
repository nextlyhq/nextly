import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import { WEBHOOK_ROTATION_DEFAULT_OVERLAP_SECONDS } from "@admin/types/webhooks";

import { RotateSecretDialog } from "./RotateSecretDialog";

describe("RotateSecretDialog", () => {
  it("confirms with the default (48h) overlap when nothing is changed", async () => {
    const onConfirm = vi.fn();
    render(
      <RotateSecretDialog
        open
        onOpenChange={vi.fn()}
        webhookName="Orders"
        onConfirm={onConfirm}
        isPending={false}
      />
    );

    await userEvent.click(
      screen.getByRole("button", { name: /rotate secret/i })
    );
    expect(onConfirm).toHaveBeenCalledWith(
      WEBHOOK_ROTATION_DEFAULT_OVERLAP_SECONDS
    );
  });

  it("disables the actions while a rotation is pending", () => {
    render(
      <RotateSecretDialog
        open
        onOpenChange={vi.fn()}
        webhookName="Orders"
        onConfirm={vi.fn()}
        isPending
      />
    );

    expect(screen.getByRole("button", { name: /rotating/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();
  });
});
