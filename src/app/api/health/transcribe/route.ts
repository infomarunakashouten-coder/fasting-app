import { NextResponse } from "next/server";

import {
  MAX_HEALTH_TEXT_LENGTH,
  transcriptionResponseSchema,
} from "@/lib/health-input/schema";
import {
  isAllowedAudioUpload,
  MAX_AUDIO_BYTES,
} from "@/lib/health-input/audio";
import { getOpenAIClient } from "@/lib/health-input/openai-provider";
import { createServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return safeError("UNAUTHORIZED", 401);
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_AUDIO_BYTES + 100_000) {
    return safeError("INVALID_AUDIO", 400);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return safeError("INVALID_AUDIO", 400);
  }

  const audio = formData.get("audio");
  const durationMs = Number(formData.get("duration_ms"));
  const consentVersion = formData.get("consent_version");
  if (!(audio instanceof File) || !Number.isFinite(durationMs)) {
    return safeError("INVALID_AUDIO", 400);
  }
  if (!isAllowedAudioUpload({
    size: audio.size,
    type: audio.type,
    durationMs,
    consentVersion,
  })) {
    return safeError("INVALID_AUDIO", 400);
  }

  try {
    const transcription = await getOpenAIClient().audio.transcriptions.create({
      file: audio,
      model: process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe",
      language: "ja",
      response_format: "json",
    });
    const result = transcriptionResponseSchema.safeParse({ text: transcription.text });
    if (!result.success || result.data.text.length > MAX_HEALTH_TEXT_LENGTH) {
      return safeError("INVALID_TRANSCRIPTION", 502);
    }
    return NextResponse.json(result.data, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return safeError("TRANSCRIPTION_UNAVAILABLE", 503);
  }
}

function safeError(code: string, status: number) {
  return NextResponse.json(
    { error: code },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}
