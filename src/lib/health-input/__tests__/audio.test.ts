import { describe, expect, it } from "vitest";

import { isAllowedAudioUpload, MAX_AUDIO_BYTES, MAX_RECORDING_MS } from "../audio";
import { AI_CONSENT_VERSION } from "../schema";

const validUpload = {
  size: 10_000,
  type: "audio/webm;codecs=opus",
  durationMs: 5_000,
  consentVersion: AI_CONSENT_VERSION,
};

describe("audio upload validation", () => {
  it("許可形式・上限内・同意済みの音声を受け付ける", () => {
    expect(isAllowedAudioUpload(validUpload)).toBe(true);
  });

  it("同意なしの音声を拒否する", () => {
    expect(isAllowedAudioUpload({ ...validUpload, consentVersion: null })).toBe(false);
  });

  it("30秒を超える音声を拒否する", () => {
    expect(isAllowedAudioUpload({ ...validUpload, durationMs: MAX_RECORDING_MS + 1 })).toBe(false);
  });

  it("6MBを超える音声を拒否する", () => {
    expect(isAllowedAudioUpload({ ...validUpload, size: MAX_AUDIO_BYTES + 1 })).toBe(false);
  });

  it("許可していないファイル形式を拒否する", () => {
    expect(isAllowedAudioUpload({ ...validUpload, type: "application/octet-stream" })).toBe(false);
  });
});
