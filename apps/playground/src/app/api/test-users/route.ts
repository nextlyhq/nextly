/**
 * Test Users API Route
 *
 * Server-side route that proxies calls to Nextly direct API user methods.
 * Used by the /test-users playground page to demonstrate and verify
 * that custom fields from user_ext are included in responses.
 */

import { getNextly, container } from "@revnixhq/nextly";
import { NextRequest, NextResponse } from "next/server";

import nextlyConfig from "../../../../nextly.config";

async function getNx() {
  return getNextly({ config: nextlyConfig });
}

// ---------------------------------------------------------------------------
// GET  — find, findOne, findByID
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const nextly = await getNx();
    const p = request.nextUrl.searchParams;
    const action = p.get("action") ?? "find";

    let data: unknown;

    switch (action) {
      case "find": {
        data = await nextly.users.find({
          limit: p.get("limit") ? Number(p.get("limit")) : 10,
          ...(p.get("page") && { page: Number(p.get("page")) }),
          ...(p.get("search") && { search: p.get("search")! }),
          ...(p.get("sortBy") && {
            sortBy: p.get("sortBy") as "createdAt" | "name" | "email",
          }),
        });
        break;
      }

      case "findOne": {
        // findOne exists on the runtime implementation but is not yet declared
        // in the init.ts Nextly interface — double-cast to access it safely.
        const usersAny = nextly.users as unknown as {
          findOne: (args?: { search?: string }) => Promise<unknown>;
        };
        data = await usersAny.findOne({
          ...(p.get("search") && { search: p.get("search")! }),
        });
        break;
      }

      case "findByID": {
        const id = p.get("id");
        if (!id)
          return NextResponse.json(
            { success: false, error: "id is required for findByID" },
            { status: 400 }
          );
        data = await nextly.users.findByID({ id });
        break;
      }

      case "findGlobals": {
        data = await nextly.findGlobals({
          ...(p.get("source") && {
            source: p.get("source") as "code" | "ui" | "built-in",
          }),
          ...(p.get("search") && { search: p.get("search")! }),
          ...(p.get("limit") && { limit: Number(p.get("limit")) }),
          ...(p.get("offset") && { offset: Number(p.get("offset")) }),
        });
        break;
      }

      case "debug": {
        // Inspect the live state of UserExtSchemaService to diagnose custom field issues
        const debugInfo: Record<string, unknown> = {};

        // 1. Schema service state
        try {
          const svc = container.get<any>("userExtSchemaService");
          debugInfo.hasMergedFields = svc.hasMergedFields();
          debugInfo.mergedFieldConfigs = svc.getMergedFieldConfigs();
        } catch (e) {
          debugInfo.schemaService_error =
            e instanceof Error ? e.message : String(e);
        }

        // 2. Direct DB query to verify user_ext table contents
        try {
          const adapter = container.get<any>("adapter");
          const db = adapter.getDrizzle();
          const userId = p.get("id") ?? "5c830286-3d2f-4d21-b9b0-947ea93ad39d";
          const rows = await db.execute(
            `SELECT * FROM user_ext WHERE user_id = '${userId}'`
          );
          debugInfo.user_ext_rows = rows?.rows ?? rows;
        } catch (e) {
          debugInfo.user_ext_query_error =
            e instanceof Error ? e.message : String(e);
        }

        // 3. Check queryService internal state
        try {
          const userSvc = container.get<any>("userService");
          const qSvc = (userSvc as any).queryService;
          if (qSvc) {
            debugInfo.queryService_lastMergedFieldCount_before = (
              qSvc as any
            ).lastMergedFieldCount;
            debugInfo.queryService_userExtDisabled_before = (
              qSvc as any
            ).userExtDisabled;

            // Force-reset stale flags so the next call starts fresh.
            // This simulates a server restart without actually restarting.
            (qSvc as any).userExtDisabled = false;
            (qSvc as any).userExtTable = null;
            (qSvc as any).customFieldNames = null;
            (qSvc as any).lastMergedFieldCount = -1; // trigger ensureCachesFresh

            // Run listUsers to capture actual keys in response
            try {
              const result = await qSvc.listUsers({ page: 1, pageSize: 1 });
              debugInfo.listUsers_result = {
                success: result.success,
                firstUserKeys: result.data?.[0]
                  ? Object.keys(result.data[0])
                  : [],
                firstUser: result.data?.[0],
              };
              debugInfo.queryService_userExtDisabled_after = (
                qSvc as any
              ).userExtDisabled;
            } catch (qErr) {
              debugInfo.listUsers_error =
                qErr instanceof Error ? qErr.message : String(qErr);
            }
          }
        } catch (e) {
          debugInfo.queryService_error =
            e instanceof Error ? e.message : String(e);
        }

        data = debugInfo;
        break;
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }

    return NextResponse.json({ success: true, action, data });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST  — create, update
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const nextly = await getNx();
    const p = request.nextUrl.searchParams;
    const action = p.get("action") ?? "create";
    const body = await request.json();

    let data: unknown;

    switch (action) {
      case "create": {
        data = await nextly.users.create({
          email: body.email,
          password: body.password,
          data: body.data ?? {},
        });
        break;
      }

      case "update": {
        const id = p.get("id") ?? body.id;
        if (!id)
          return NextResponse.json(
            { success: false, error: "id is required for update" },
            { status: 400 }
          );
        data = await nextly.users.update({ id, data: body.data ?? {} });
        break;
      }

      case "login": {
        data = await nextly.login({
          email: body.email,
          password: body.password,
        });
        break;
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }

    return NextResponse.json({ success: true, action, data });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE  — delete
// ---------------------------------------------------------------------------

export async function DELETE(request: NextRequest) {
  try {
    const nextly = await getNx();
    const id = request.nextUrl.searchParams.get("id");
    if (!id)
      return NextResponse.json(
        { success: false, error: "id is required for delete" },
        { status: 400 }
      );

    const data = await nextly.users.delete({ id });
    return NextResponse.json({ success: true, action: "delete", data });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
