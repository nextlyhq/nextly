/**
 * Test Auth API Route
 *
 * Server-side route that proxies calls to Nextly direct API auth methods.
 * Used by the /test-auth playground page to test the full password flow:
 * forgotPassword → resetPassword and changePassword.
 */

import { getNextly } from "@revnixhq/nextly";
import { NextRequest, NextResponse } from "next/server";

import nextlyConfig from "../../../../nextly.config";

async function getNx() {
  return getNextly({ config: nextlyConfig });
}

// ---------------------------------------------------------------------------
// POST — changePassword, forgotPassword, resetPassword
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const nextly = await getNx();
    const p = request.nextUrl.searchParams;
    const action = p.get("action") ?? "changePassword";
    const body = await request.json();

    let data: unknown;

    switch (action) {
      case "changePassword": {
        const { userId, currentPassword, newPassword } = body;
        if (!userId || !currentPassword || !newPassword) {
          return NextResponse.json(
            {
              success: false,
              error: "userId, currentPassword, and newPassword are required",
            },
            { status: 400 }
          );
        }
        data = await nextly.changePassword({
          user: { id: userId },
          currentPassword,
          newPassword,
        });
        break;
      }

      case "forgotPassword": {
        const { email, disableEmail, expiration } = body;
        if (!email) {
          return NextResponse.json(
            { success: false, error: "email is required" },
            { status: 400 }
          );
        }
        data = await nextly.forgotPassword({
          email,
          ...(disableEmail !== undefined && {
            disableEmail: Boolean(disableEmail),
          }),
          ...(expiration !== undefined && { expiration: Number(expiration) }),
        });
        break;
      }

      case "resetPassword": {
        const { token, password } = body;
        if (!token || !password) {
          return NextResponse.json(
            { success: false, error: "token and password are required" },
            { status: 400 }
          );
        }
        data = await nextly.resetPassword({ token, password });
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
