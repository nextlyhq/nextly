# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: acceptance.spec.ts >> a canvas any Nextly editor could ship >> puts the indicator in the gap the pointer is over
- Location: acceptance.spec.ts:335:3

# Error details

```
TypeError: apiRequestContext.post: Invalid URL
```

# Test source

```ts
  87  |     version: DOCUMENT_VERSION,
  88  |     kind: "page",
  89  |     root: {
  90  |       id: "nx-spike-root",
  91  |       type: "core/container",
  92  |       props: { as: "div" },
  93  |       slots: {
  94  |         [DEFAULT_SLOT]: [
  95  |           spacer("nx-outer-0", "80px"),
  96  |           {
  97  |             id: "nx-inner",
  98  |             type: "core/container",
  99  |             props: { as: "div" },
  100 |             slots: {
  101 |               [DEFAULT_SLOT]: [
  102 |                 spacer("nx-inner-0", "120px"),
  103 |                 spacer("nx-inner-1", "120px"),
  104 |               ],
  105 |             },
  106 |           },
  107 |           spacer("nx-outer-1", "80px"),
  108 |         ],
  109 |       },
  110 |     },
  111 |   },
  112 |   blockIds: [
  113 |     "nx-spike-root",
  114 |     "nx-outer-0",
  115 |     "nx-inner",
  116 |     "nx-inner-0",
  117 |     "nx-inner-1",
  118 |     "nx-outer-1",
  119 |   ],
  120 | };
  121 |
  122 | /** 500 siblings: the tree size the perf budget is stated against. */
  123 | const LARGE_COUNT = 500;
  124 | export const LARGE_FIXTURE: SeedOptions = {
  125 |   title: "spike large tree",
  126 |   slug: "spike-large-tree",
  127 |   content: document(
  128 |     Array.from({ length: LARGE_COUNT }, (_, i) => spacer(`nx-big-${i}`, "12px"))
  129 |   ),
  130 |   blockIds: [
  131 |     "nx-spike-root",
  132 |     ...Array.from({ length: LARGE_COUNT }, (_, i) => `nx-big-${i}`),
  133 |   ],
  134 | };
  135 |
  136 | /**
  137 |  * Block ids in the entry's STORED document, in document order, root first.
  138 |  *
  139 |  * Read through the API rather than the canvas so tree integrity can still be
  140 |  * checked after the editor has unmounted: a gesture that navigates away AND
  141 |  * persists a mutation is invisible to any assertion that needs a live canvas.
  142 |  *
  143 |  * `?status=all` is required: entries are seeded as drafts, and the plain read
  144 |  * is published-only.
  145 |  */
  146 | export async function readStoredBlockIds(
  147 |   request: APIRequestContext,
  148 |   entryId: string
  149 | ): Promise<string[]> {
  150 |   const response = await request.get(
  151 |     `/admin/api/collections/pages/entries/${entryId}?status=all`
  152 |   );
  153 |   if (!response.ok()) {
  154 |     throw new Error(
  155 |       `readStoredBlockIds failed: ${response.status()} ${await response.text()}`
  156 |     );
  157 |   }
  158 |   const body = (await response.json()) as {
  159 |     content?: { root?: unknown };
  160 |   };
  161 |
  162 |   const ids: string[] = [];
  163 |   const walk = (node: unknown): void => {
  164 |     if (typeof node !== "object" || node === null) return;
  165 |     const record = node as { id?: unknown; slots?: Record<string, unknown> };
  166 |     if (typeof record.id === "string") ids.push(record.id);
  167 |     for (const children of Object.values(record.slots ?? {})) {
  168 |       if (Array.isArray(children)) children.forEach(walk);
  169 |     }
  170 |   };
  171 |   walk(body.content?.root);
  172 |   return ids;
  173 | }
  174 |
  175 | /** Create a page whose builder document is exactly `content`, and return its id. */
  176 | export async function seedPage(
  177 |   request: APIRequestContext,
  178 |   opts: SeedOptions
  179 | ): Promise<CanvasFixture> {
  180 |   // Slugs are unique on this collection, so a re-run would collide with the row
  181 |   // the previous run left behind. Millisecond resolution alone is not enough:
  182 |   // two workers seeding the same fixture in the same millisecond collide, and
  183 |   // the POST then fails on the constraint, reporting a seed error rather than a
  184 |   // canvas result.
  185 |   const slug = `${opts.slug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  186 |
> 187 |   const response = await request.post("/admin/api/collections/pages/entries", {
      |                                  ^ TypeError: apiRequestContext.post: Invalid URL
  188 |     data: {
  189 |       title: opts.title,
  190 |       slug,
  191 |       editorMode: "builder",
  192 |       content: opts.content,
  193 |     },
  194 |   });
  195 |   if (!response.ok()) {
  196 |     throw new Error(
  197 |       `seedPage failed: ${response.status()} ${await response.text()}`
  198 |     );
  199 |   }
  200 |
  201 |   // The admin's mutation envelope is `{ message, item }`, but this asserts
  202 |   // nothing about it: an unexpected shape throws with the body attached rather
  203 |   // than feeding `undefined` into a URL and failing somewhere less obvious.
  204 |   const body: unknown = await response.json();
  205 |   const entryId = readEntryId(body);
  206 |   if (!entryId) {
  207 |     throw new Error(`seedPage returned no id: ${JSON.stringify(body)}`);
  208 |   }
  209 |   return { entryId, blockIds: opts.blockIds };
  210 | }
  211 |
  212 | function readEntryId(body: unknown): string | undefined {
  213 |   if (typeof body !== "object" || body === null) return undefined;
  214 |   const record = body as Record<string, unknown>;
  215 |
  216 |   const direct = record.id;
  217 |   if (typeof direct === "string") return direct;
  218 |
  219 |   for (const key of ["item", "data", "entry"]) {
  220 |     const nested = record[key];
  221 |     if (typeof nested === "object" && nested !== null) {
  222 |       const id = (nested as Record<string, unknown>).id;
  223 |       if (typeof id === "string") return id;
  224 |       if (typeof id === "number") return String(id);
  225 |     }
  226 |   }
  227 |   if (typeof direct === "number") return String(direct);
  228 |   return undefined;
  229 | }
  230 |
```
