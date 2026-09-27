import { AI_CONSENT_VERSION } from "./schema";

export const MAX_AUDIO_BYTES = 6 * 1024 * 1024;
export const MAX_RECORDING_MS = 30_000;

const ALLOWED_AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
  "audio/mpeg",
  "audio/x-m4a",
]);

export function isAllowedAudioUpload(input: {
  size: number;
  type: string;
  durationMs: number;
  consentVersion: unknown;
}) {
  const baseAudioType = input.type.toLowerCase().split(";")[0];
  return (
    Number.isFinite(input.durationMs) &&
    input.size > 0 &&
    input.size <= MAX_AUDIO_BYTES &&
    input.durationMs > 0 &&
    input.durationMs <= MAX_RECORDING_MS &&
    input.consentVersion === AI_CONSENT_VERSION &&
    ALLOWED_AUDIO_TYPES.has(baseAudioType)
  );
}
