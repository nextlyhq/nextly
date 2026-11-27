# @nextlyhq/mcp

> **Experimental, and not on npm yet.** Every export is `@experimental` and may
> change in any release.

Turns the Nextly operations marked for agents into
[Model Context Protocol](https://modelcontextprotocol.io) tools. Every MCP door
uses this one adapter, so they all serve the same tools, with the same names,
schemas, hints and answers: the chat-app door (`@nextlyhq/plugin-mcp`) and the
local one. Core holds no MCP code; this package holds the adapter and the
protocol library, pinned exactly.

## Using it in a door

```ts
import { buildToolSet } from "@nextlyhq/mcp";
import { Server } from "@modelcontextprotocol/server";

// Once, when the door starts: builds every tool's definition, or refuses to
// start naming each tool that can't be served.
const tools = buildToolSet(source, { door: "chat" });

// Per request: binds the caller and filters the list; builds nothing.
const server = new Server({ name: "nextly", version }, { capabilities: {} });
tools.serve(server, {
  caller,
  allows: operation => mayUse(caller, operation),
  adminOrigin: "https://example.com",
  logger,
});
```

`source` is the operation list as the adapter reads it: the operations, each
one's tool name, and the engine that runs one for a caller.

## What a tool is made of

| Part        | From                                                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Served      | operations marked for agents (`chatExposed`) that run on the door                                                            |
| Name        | the operation list's name, which must have a row in the adapter's table (`TOOL_TABLE`) naming the operation                  |
| Title       | the operation's summary                                                                                                      |
| Description | the operation's description                                                                                                  |
| Schemas     | the operation's input and output schemas as JSON Schema, plus `format` on every tool, and `page` on a list's output          |
| Hints       | all four, from the risk level and effects: read-only for a `read` that destroys nothing, destructive, idempotent, open-world |

A name is lower-case letters, digits and underscores, at most 64 characters,
verb first (`find_entries`, `get_entry`). A tool renamed in a release keeps its
old name working, unlisted, for at least one minor release, and its answers
name the new one.

## Answers

Every answer comes three ways: a short Markdown answer, the same data as JSON
in a fenced block under a "Data" label, and the data as structured content
checked against the tool's output schema.

- **Names beside IDs.** Anything with an `id` is shown by its `title`, `name`,
  `label`, `filename` or `slug`, then its ID.
- **Admin links.** An operation says where a thing lives in the admin with
  `adminPath`, a path on the site (`/admin/collections/posts/12`). The answer
  links it on the site's address, and makes no link from anything else.
- **Rich text.** Text that spans lines, such as rich text in Markdown, is
  quoted as a block of content.
- **Concise or detailed.** `format: "concise"` (the default) keeps the fields
  that identify each thing and every required field; `"detailed"` keeps all.
- **Pages.** A list tool is one whose input takes `limit` and `after`. It gets
  20 items unless told otherwise, at most 100, and answers with `page.next`,
  an opaque cursor tied to the tool and the call's other inputs.

## Limits and refusals

| Limit                 | Value             | When it's exceeded                                            |
| --------------------- | ----------------- | ------------------------------------------------------------- |
| Answer text           | 50,000 characters | `PAYLOAD_TOO_LARGE`, no partial data, and how to ask for less |
| Arguments in one call | 10,000 elements   | `PAYLOAD_TOO_LARGE`                                           |
| Page size             | 100 items         | `VALIDATION_ERROR`                                            |

A refusal is a tool error, never a protocol error. Its text names core's error
code, says what to do next and carries the request ID; its structured content
carries the same beside core's public JSON for the error. An operation that
refuses a name that doesn't exist can add, in its error's public data,
`unknown: { kind, name, choices }` with the names the caller may use, and the
answer suggests the closest ones. An unexpected failure is answered as core's
internal error and logged by its kind and call frames, never its message.

## The tool-list snapshot

Each door's tool list is checked in as a snapshot. A change to any name,
title, description, hint or schema fails the package's tests until the
snapshot is updated in the same change, and a changed snapshot needs a
changeset listing this package.
