/**
 * Presses the publish dialog's confirm as a person does: once it is offered, which it is when the
 * server has described the parts as chosen.
 *
 * @module components/features/entries/publish-parts/__tests__/press-confirm
 */
import userEvent from "@testing-library/user-event";
import { expect } from "vitest";

import { waitFor } from "@admin/__tests__/utils";

export async function pressConfirm(confirm: HTMLElement): Promise<void> {
  await waitFor(() => expect(confirm).toBeEnabled());
  await userEvent.click(confirm);
}
