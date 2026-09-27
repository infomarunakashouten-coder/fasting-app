import { NextResponse } from "next/server";

import { parseHealthText, HealthParseError } from "@/lib/health-input/parse";
import { openAIHealthParseProvider } from "@/lib/health-input/openai-provider";
import { isHealthInputEnabled } from "@/lib/health-input/feature-flags";
import { createServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!healthInputApiEnabled()) {
    return safeError("NOT_FOUND", 404);
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return safeError("UNAUTHORIZED", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return safeError("INVALID_INPUT", 400);
  }

  try {
    const result = await parseHealthText(body, openAIHealthParseProvider);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof HealthParseError) {
      const status =
        error.code === "INVALID_INPUT"
          ? 400
          : error.code === "NO_SUPPORTED_ENTRIES"
            ? 422
            : error.code === "INVALID_AI_OUTPUT"
              ? 502
              : 503;
      return safeError(error.code, status);
    }
    return safeError("AI_UNAVAILABLE", 503);
  }
}

function healthInputApiEnabled() {
  return isHealthInputEnabled({
    flag: process.env.NEXT_PUBLIC_HEALTH_INPUT_ENABLED,
    deploymentEnvironment: process.env.VERCEL_ENV,
    nodeEnvironment: process.env.NODE_ENV,
  });
}

function safeError(code: string, status: number) {
  return NextResponse.json(
    { error: code },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}
