import { describe, expect, it, vi } from "vitest";

import {
  getOnDeviceAvailability,
  getSpeechRecognitionSupport,
  installOnDeviceLanguage,
  readFinalTranscript,
  type SpeechRecognitionConstructorLike,
  type SpeechRecognitionLike,
} from "../../speech-recognition";

function constructor(options?: {
  processLocally?: boolean;
  available?: SpeechRecognitionConstructorLike["available"];
  install?: SpeechRecognitionConstructorLike["install"];
}) {
  class FakeRecognition extends EventTarget implements SpeechRecognitionLike {
    continuous = false;
    interimResults = false;
    lang = "";
    maxAlternatives = 1;
    onend = null;
    onerror = null;
    onresult = null;
    start() {}
    stop() {}
    abort() {}
  }
  if (options?.processLocally) {
    Object.defineProperty(FakeRecognition.prototype, "processLocally", {
      configurable: true,
      value: false,
      writable: true,
    });
  }
  const result = FakeRecognition as unknown as SpeechRecognitionConstructorLike;
  result.available = options?.available;
  result.install = options?.install;
  return result;
}

describe("speech recognition feature detection", () => {
  it("prefixed constructorを通常認識だけに使用する", () => {
    const prefixed = constructor();
    expect(getSpeechRecognitionSupport({ webkitSpeechRecognition: prefixed })).toEqual({
      basic: prefixed,
      onDevice: null,
    });
  });

  it("必要な全機能が存在する場合だけ端末内認識を有効にする", () => {
    const local = constructor({
      processLocally: true,
      available: vi.fn().mockResolvedValue("available"),
      install: vi.fn().mockResolvedValue(true),
    });
    expect(getSpeechRecognitionSupport({ SpeechRecognition: local })).toEqual({
      basic: local,
      onDevice: local,
    });
  });

  it("未対応のavailableを呼ばない", async () => {
    expect(await getOnDeviceAvailability(constructor())).toBe("unavailable");
  });

  it("未知のavailabilityをunavailableとして扱う", async () => {
    const available = vi.fn().mockResolvedValue("unknown");
    const local = constructor({ processLocally: true, available, install: vi.fn() });
    expect(await getOnDeviceAvailability(local)).toBe("unavailable");
  });

  it("installがない場合はダウンロードを開始しない", async () => {
    expect(await installOnDeviceLanguage(constructor())).toBe(false);
  });

  it("final resultだけを文字列化する", () => {
    const result = readFinalTranscript({
      type: "result",
      resultIndex: 0,
      results: [
        { isFinal: false, 0: { transcript: "途中" }, length: 1 },
        { isFinal: true, 0: { transcript: "今日52キロ" }, length: 1 },
      ],
    } as unknown as Parameters<typeof readFinalTranscript>[0]);
    expect(result).toBe("今日52キロ");
  });
});
