export type SpeechProcessingPath =
  | "local_speech"
  | "browser_speech"
  | "openai_stt"
  | "local_parse"
  | "openai_parse";

export type SpeechAvailability =
  | "available"
  | "downloadable"
  | "downloading"
  | "unavailable";

export type SpeechRecognitionResultEventLike = Event & {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string; confidence?: number };
    length: number;
  }>;
};

export type SpeechRecognitionErrorEventLike = Event & { error: string };

export interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  processLocally?: boolean;
  onend: ((event: Event) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export interface SpeechRecognitionConstructorLike {
  new (): SpeechRecognitionLike;
  available?: (options: {
    langs: string[];
    processLocally?: boolean;
  }) => Promise<SpeechAvailability>;
  install?: (options: {
    langs: string[];
    processLocally?: boolean;
  }) => Promise<boolean>;
}

export type SpeechRecognitionWindowLike = {
  SpeechRecognition?: SpeechRecognitionConstructorLike;
  webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
};

export type SpeechRecognitionSupport = {
  basic: SpeechRecognitionConstructorLike | null;
  onDevice: SpeechRecognitionConstructorLike | null;
};

export function getSpeechRecognitionSupport(
  target: SpeechRecognitionWindowLike,
): SpeechRecognitionSupport {
  const unprefixed = target.SpeechRecognition ?? null;
  const basic = unprefixed ?? target.webkitSpeechRecognition ?? null;
  let onDevice: SpeechRecognitionConstructorLike | null = null;

  if (
    unprefixed &&
    typeof unprefixed.available === "function" &&
    typeof unprefixed.install === "function"
  ) {
    try {
      const probe = new unprefixed();
      if ("processLocally" in probe) onDevice = unprefixed;
    } catch {
      onDevice = null;
    }
  }

  return { basic, onDevice };
}

export async function getOnDeviceAvailability(
  constructor: SpeechRecognitionConstructorLike,
  language = "ja-JP",
): Promise<SpeechAvailability> {
  if (typeof constructor.available !== "function") return "unavailable";
  try {
    const result = await constructor.available({
      langs: [language],
      processLocally: true,
    });
    return ["available", "downloadable", "downloading", "unavailable"].includes(result)
      ? result
      : "unavailable";
  } catch {
    return "unavailable";
  }
}

export async function installOnDeviceLanguage(
  constructor: SpeechRecognitionConstructorLike,
  language = "ja-JP",
): Promise<boolean> {
  if (typeof constructor.install !== "function") return false;
  try {
    return await constructor.install({
      langs: [language],
      processLocally: true,
    });
  } catch {
    return false;
  }
}

export function readFinalTranscript(event: SpeechRecognitionResultEventLike): string {
  let transcript = "";
  for (let index = event.resultIndex; index < event.results.length; index += 1) {
    const result = event.results[index];
    if (result?.isFinal && result[0]?.transcript) {
      transcript += `${result[0].transcript} `;
    }
  }
  return transcript.trim();
}
