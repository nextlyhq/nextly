/**
 * A person's inbox pages in index order, read or unread.
 *
 * Both lists filter by the person (and the unread one by `readAt IS NULL`)
 * and then order by {@link NOTICE_PAGE_ORDER}. An index that stops short of
 * the order's last column leaves the database to sort every matching row
 * before it can apply a page's limit.
 */
import { describe, expect, it } from "vitest";

import { NOTICES_INDEXES } from "../../../schemas/_internal/core-indexes";
import { NOTICE_PAGE_ORDER } from "../notices-service";

const order = NOTICE_PAGE_ORDER.map(entry => entry.column);
const indexColumns = NOTICES_INDEXES.map(index => [...index.columns]);

describe("the notices inbox indexes", () => {
  it("cover a person's whole list in the order it pages", () => {
    expect(indexColumns).toContainEqual(["userId", ...order]);
  });

  it("cover a person's unread list in the order it pages", () => {
    expect(indexColumns).toContainEqual(["userId", "readAt", ...order]);
  });
});
