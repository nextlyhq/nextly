import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { expect } from "vitest";

// jest-dom's matchers, on the `expect` these tests import. Not through
// `@testing-library/jest-dom/vitest`, which extends the `expect` of whichever
// vitest resolves from jest-dom's own folder: a second copy here, and on Vitest 5
// extending it breaks `rejects.toThrow` in the file that imports it
// (`packages/admin/src/__tests__/setup.ts` has the measurement).
expect.extend(jestDomMatchers);
