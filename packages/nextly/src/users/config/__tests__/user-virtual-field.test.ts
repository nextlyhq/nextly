/**
 * A custom user field is always a `user_ext` column, so a virtual one would be
 * stored rather than computed. User config validation refuses the flag in
 * either spelling; the same field without it is the control.
 */
import { expect, it } from "vitest";

import { validateUserConfig } from "../validate-user-config";

function codes(fields: unknown[]): string[] {
  return validateUserConfig({ fields } as never).errors.map(e => e.code);
}

it("refuses a virtual custom user field, in either spelling", () => {
  expect(codes([{ name: "nickname", type: "text" }])).not.toContain(
    "USER_FIELD_VIRTUAL_UNSUPPORTED"
  );
  expect(codes([{ name: "nickname", type: "text", virtual: true }])).toContain(
    "USER_FIELD_VIRTUAL_UNSUPPORTED"
  );
  expect(
    codes([
      { name: "prefs", type: "group", fields: [], options: { virtual: true } },
    ])
  ).toContain("USER_FIELD_VIRTUAL_UNSUPPORTED");
});
