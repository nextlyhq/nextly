import { test as base, expect } from "@playwright/test";

import { clearInbox } from "./mailpit";

export const test = base.extend<{ cleanInbox: void }>({
  cleanInbox: [
    async ({}, use) => {
      await clearInbox();
      await use();
    },
    { auto: true },
  ],
});

export { expect };
