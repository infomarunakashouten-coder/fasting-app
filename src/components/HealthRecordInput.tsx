"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { getNoSupportedHealthEntryFeedback } from "@/lib/health-input/feedback";
import { parseLocalHealthText } from "@/lib/health-input/local-parser";
import {
  AI_CONSENT_VERSION,
  healthParseResponseSchema,
  MAX_HEALTH_TEXT_LENGTH,
  transcriptionResponseSchema,
  type HealthEntry,
} from "@/lib/health-input/schema";
import {
  HEALTH_ISSUE_MESSAGES,
  validateEditableHealthEntry,
} from "@/lib/health-input/validation";
import { isIOSFamilyDevice } from "@/lib/ios-device";
import {
  getOnDeviceAvailability,
  getSpeechRecognitionSupport,
  installOnDeviceLanguage,
  readFinalTranscript,
  type SpeechAvailability,
  type SpeechProcessingPath,
  type SpeechRecognitionConstructorLike,
  type SpeechRecognitionLike,
  type SpeechRecognitionWindowLike,
} from "@/lib/speech-recognition";

const OPENAI_CONSENT_STORAGE_KEY = "health-ai-consent-version";
const BROWSER_SPEECH_CONSENT_STORAGE_KEY = "health-browser-speech-consent-version";
const BROWSER_SPEECH_CONSENT_VERSION = "2026-09-16";
const MAX_RECORDING_MS = 30_000;

type InputMode = "voice" | "text";
type Stage =
  | "input"
  | "browser_consent"
  | "openai_consent"
  | "preparing_speech"
  | "speech_setup"
  | "speech_listening"
  | "speech_failed"
  | "recording"
  | "transcribing"
  | "parsing"
  | "confirm";
type PendingOpenAIAction =
  | { kind: "parse"; text: string; paths: SpeechProcessingPath[] }
  | { kind: "stt" };

const ENTRY_LABELS = {
  weight: { icon: "⚖️", label: "体重" },
  body_fat: { icon: "◯", label: "体脂肪率" },
  period_start: { icon: "🌸", label: "生理開始" },
} as const;

const PATH_LABELS: Record<SpeechProcessingPath, string> = {
  keyboard_dictation: "キーボード音声入力",
  local_speech: "端末内音声認識",
  browser_speech: "ブラウザ音声認識",
  openai_stt: "OpenAI高精度音声認識",
  local_parse: "ローカル解析",
  openai_parse: "OpenAI解析",
};

export default function HealthRecordInput() {
  const [isOpen, setIsOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("input");
  const [mode, setMode] = useState<InputMode>("voice");
  const [usesIOSKeyboardDictation, setUsesIOSKeyboardDictation] = useState(false);
  const [text, setText] = useState("");
  const [entries, setEntries] = useState<HealthEntry[]>([]);
  const [hasUnsupportedContent, setHasUnsupportedContent] = useState(false);
  const [processingPaths, setProcessingPaths] = useState<SpeechProcessingPath[]>([]);
  const [consentChecked, setConsentChecked] = useState(false);
  const [error, setError] = useState("");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [speechPackStatus, setSpeechPackStatus] = useState<SpeechAvailability>("unavailable");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const speechRecognitionSettledRef = useRef(false);
  const speechRecognitionLocalRef = useRef(false);
  const onDeviceConstructorRef = useRef<SpeechRecognitionConstructorLike | null>(null);
  const pendingOpenAIActionRef = useRef<PendingOpenAIAction | null>(null);
  const startedAtRef = useRef(0);
  const discardRecordingRef = useRef(false);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => () => releaseTransientData(), []);

  const openModal = () => {
    const iosKeyboardDictation = isIOSFamilyDevice(
      navigator as Navigator & {
        standalone?: boolean;
        userAgentData?: { platform?: string };
      },
    );
    flushSync(() => {
      setStage("input");
      setMode("voice");
      setUsesIOSKeyboardDictation(iosKeyboardDictation);
      setConsentChecked(false);
      setProcessingPaths([]);
      setError("");
      setIsOpen(true);
    });
    if (iosKeyboardDictation) {
      textInputRef.current?.focus({ preventScroll: true });
    }
  };

  const selectMode = (nextMode: InputMode) => {
    flushSync(() => {
      setMode(nextMode);
      setError("");
      setStage("input");
    });
    if (nextMode === "text" || (nextMode === "voice" && usesIOSKeyboardDictation)) {
      textInputRef.current?.focus({ preventScroll: true });
    }
  };

  const closeModal = () => {
    releaseTransientData();
    pendingOpenAIActionRef.current = null;
    setText("");
    setEntries([]);
    setProcessingPaths([]);
    setError("");
    setIsOpen(false);
  };

  const hasOpenAIConsent = () =>
    window.localStorage.getItem(OPENAI_CONSENT_STORAGE_KEY) === AI_CONSENT_VERSION;

  const hasBrowserSpeechConsent = () =>
    window.localStorage.getItem(BROWSER_SPEECH_CONSENT_STORAGE_KEY) ===
    BROWSER_SPEECH_CONSENT_VERSION;

  const agreeToOpenAIProcessing = () => {
    if (!consentChecked) return;
    window.localStorage.setItem(OPENAI_CONSENT_STORAGE_KEY, AI_CONSENT_VERSION);
    setConsentChecked(false);
    const action = pendingOpenAIActionRef.current;
    pendingOpenAIActionRef.current = null;
    setStage("input");
    if (action?.kind === "parse") {
      void parseTextWithOpenAI(action.text, action.paths);
    } else if (action?.kind === "stt") {
      void startOpenAIRecording();
    }
  };

  const agreeToBrowserSpeech = () => {
    if (!consentChecked) return;
    window.localStorage.setItem(
      BROWSER_SPEECH_CONSENT_STORAGE_KEY,
      BROWSER_SPEECH_CONSENT_VERSION,
    );
    setConsentChecked(false);
    setStage("input");
    void startBrowserSpeechRecognition();
  };

  const cancelConsent = () => {
    pendingOpenAIActionRef.current = null;
    setConsentChecked(false);
    setStage("input");
  };

  const parseText = async (
    textToParse: string,
    initialPaths: SpeechProcessingPath[] = [],
  ) => {
    const trimmed = textToParse.trim();
    if (!trimmed || trimmed.length > MAX_HEALTH_TEXT_LENGTH) {
      setError(
        trimmed.length > MAX_HEALTH_TEXT_LENGTH
          ? `入力は${MAX_HEALTH_TEXT_LENGTH}文字以内にしてください。`
          : "記録する内容を入力してください。",
      );
      return;
    }

    setError("");
    setStage("parsing");
    const local = parseLocalHealthText(trimmed, new Date());
    const localPaths = uniquePaths([...initialPaths, "local_parse"]);
    setProcessingPaths(localPaths);

    if (local.decision === "needs_ai") {
      if (!hasOpenAIConsent()) {
        pendingOpenAIActionRef.current = {
          kind: "parse",
          text: trimmed,
          paths: localPaths,
        };
        setConsentChecked(false);
        setStage("openai_consent");
        return;
      }
      await parseTextWithOpenAI(trimmed, localPaths);
      return;
    }

    if (!local.result || local.result.entries.length === 0) {
      setHasUnsupportedContent(Boolean(local.result?.hasUnsupportedContent));
      setError(
        getNoSupportedHealthEntryFeedback(
          trimmed,
          local.result?.entries.length ?? 0,
        ) ?? "入力内容を解析できませんでした。もう一度お試しください。",
      );
      setStage("input");
      return;
    }

    showConfirmation(local.result.entries, local.result.hasUnsupportedContent, localPaths);
  };

  const parseTextWithOpenAI = async (
    textToParse: string,
    initialPaths: SpeechProcessingPath[],
  ) => {
    if (!hasOpenAIConsent()) {
      pendingOpenAIActionRef.current = {
        kind: "parse",
        text: textToParse,
        paths: initialPaths,
      };
      setConsentChecked(false);
      setStage("openai_consent");
      return;
    }

    setError("");
    setStage("parsing");
    const controller = new AbortController();
    requestControllerRef.current = controller;
    try {
      const response = await fetch("/api/health/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: textToParse, consentVersion: AI_CONSENT_VERSION }),
        signal: controller.signal,
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "parse"));
      const result = healthParseResponseSchema.safeParse(payload);
      if (!result.success) throw new Error("解析結果を確認できませんでした。もう一度お試しください。");
      showConfirmation(
        result.data.entries,
        result.data.hasUnsupportedContent,
        uniquePaths([...initialPaths, "openai_parse"]),
      );
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "AI解析に失敗しました。");
      setStage("input");
    } finally {
      requestControllerRef.current = null;
    }
  };

  const showConfirmation = (
    nextEntries: HealthEntry[],
    unsupported: boolean,
    paths: SpeechProcessingPath[],
  ) => {
    setEntries(nextEntries);
    setHasUnsupportedContent(unsupported);
    setProcessingPaths(paths);
    setText("");
    setStage("confirm");
  };

  const startPreferredSpeechRecognition = async () => {
    setError("");
    setProcessingPaths([]);
    setStage("preparing_speech");
    const support = getSpeechRecognitionSupport(
      window as unknown as SpeechRecognitionWindowLike,
    );
    if (!support.basic) {
      showSpeechFallback("このブラウザでは音声認識を利用できません。");
      return;
    }

    if (support.onDevice) {
      onDeviceConstructorRef.current = support.onDevice;
      const availability = await getOnDeviceAvailability(support.onDevice);
      if (availability === "available") {
        startSpeechRecognition(support.onDevice, true);
        return;
      }
      if (availability === "downloadable" || availability === "downloading") {
        setSpeechPackStatus(availability);
        setStage("speech_setup");
        return;
      }
    }

    requestBrowserSpeechRecognition();
  };

  const installLocalSpeechPack = async () => {
    const constructor = onDeviceConstructorRef.current;
    if (!constructor) {
      requestBrowserSpeechRecognition();
      return;
    }
    setSpeechPackStatus("downloading");
    const installed = await installOnDeviceLanguage(constructor);
    if (!installed) {
      setSpeechPackStatus("unavailable");
      setError("端末内音声認識の準備ができませんでした。ブラウザ音声認識も利用できます。");
      return;
    }
    await startPreferredSpeechRecognition();
  };

  const requestBrowserSpeechRecognition = () => {
    if (!hasBrowserSpeechConsent()) {
      setConsentChecked(false);
      setStage("browser_consent");
      return;
    }
    void startBrowserSpeechRecognition();
  };

  const startBrowserSpeechRecognition = async () => {
    const support = getSpeechRecognitionSupport(
      window as unknown as SpeechRecognitionWindowLike,
    );
    if (!support.basic) {
      showSpeechFallback("このブラウザでは音声認識を利用できません。");
      return;
    }
    startSpeechRecognition(support.basic, false);
  };

  const startSpeechRecognition = (
    constructor: SpeechRecognitionConstructorLike,
    local: boolean,
  ) => {
    clearRecordingTimers();
    speechRecognitionSettledRef.current = false;
    speechRecognitionLocalRef.current = local;
    let recognition: SpeechRecognitionLike;
    try {
      recognition = new constructor();
      if (local) {
        if (!("processLocally" in recognition)) {
          requestBrowserSpeechRecognition();
          return;
        }
        recognition.processLocally = true;
      }
      recognition.lang = "ja-JP";
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
    } catch {
      if (local) requestBrowserSpeechRecognition();
      else showSpeechFallback("ブラウザ音声認識を開始できませんでした。");
      return;
    }

    speechRecognitionRef.current = recognition;
    recognition.onresult = (event) => {
      if (speechRecognitionSettledRef.current) return;
      const transcript = readFinalTranscript(event);
      if (!transcript) return;
      speechRecognitionSettledRef.current = true;
      clearRecordingTimers();
      speechRecognitionRef.current = null;
      recognition.abort();
      void parseText(transcript, [local ? "local_speech" : "browser_speech"]);
    };
    recognition.onerror = (event) => {
      handleSpeechRecognitionFailure(event.error, local);
    };
    recognition.onend = () => {
      if (!speechRecognitionSettledRef.current) {
        handleSpeechRecognitionFailure("no-result", local);
      }
    };

    startedAtRef.current = Date.now();
    setRecordingSeconds(0);
    try {
      recognition.start();
      setStage("speech_listening");
      elapsedTimerRef.current = setInterval(() => {
        setRecordingSeconds(
          Math.min(30, Math.floor((Date.now() - startedAtRef.current) / 1000)),
        );
      }, 250);
      stopTimerRef.current = setTimeout(() => stopSpeechRecognition(), MAX_RECORDING_MS);
    } catch {
      speechRecognitionRef.current = null;
      speechRecognitionSettledRef.current = true;
      if (local) requestBrowserSpeechRecognition();
      else showSpeechFallback("ブラウザ音声認識を開始できませんでした。");
    }
  };

  const handleSpeechRecognitionFailure = (code: string, local: boolean) => {
    if (speechRecognitionSettledRef.current) return;
    speechRecognitionSettledRef.current = true;
    clearRecordingTimers();
    speechRecognitionRef.current = null;

    if (code === "not-allowed" || code === "audio-capture") {
      setMode("text");
      setError("マイクを利用できませんでした。マイク許可を確認するか、テキスト入力をご利用ください。");
      setStage("input");
      return;
    }
    if (local) {
      requestBrowserSpeechRecognition();
      return;
    }
    showSpeechFallback("ブラウザ音声認識で結果を取得できませんでした。");
  };

  const stopSpeechRecognition = () => {
    clearRecordingTimers();
    try {
      speechRecognitionRef.current?.stop();
    } catch {
      handleSpeechRecognitionFailure("stop-failed", speechRecognitionLocalRef.current);
    }
  };

  const cancelSpeechRecognition = () => {
    speechRecognitionSettledRef.current = true;
    clearRecordingTimers();
    try {
      speechRecognitionRef.current?.abort();
    } catch {
      // 破棄時はユーザーへ不要な内部エラーを表示しない。
    }
    speechRecognitionRef.current = null;
    setStage("input");
  };

  const showSpeechFallback = (message: string) => {
    setError(message);
    setStage("speech_failed");
  };

  const requestOpenAIRecording = () => {
    if (!hasOpenAIConsent()) {
      pendingOpenAIActionRef.current = { kind: "stt" };
      setConsentChecked(false);
      setStage("openai_consent");
      return;
    }
    void startOpenAIRecording();
  };

  const startOpenAIRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMode("text");
      setError("このブラウザでは音声録音を利用できません。テキスト入力をご利用ください。");
      setStage("input");
      return;
    }

    setError("");
    discardRecordingRef.current = false;
    chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = selectRecordingMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        discardRecordingRef.current = true;
        stopRecorderTracks();
        setError("録音中にエラーが発生しました。テキスト入力も利用できます。");
        setStage("input");
      };
      recorder.onstop = handleRecordingStopped;
      startedAtRef.current = Date.now();
      setRecordingSeconds(0);
      recorder.start(500);
      setStage("recording");
      elapsedTimerRef.current = setInterval(() => {
        setRecordingSeconds(Math.min(30, Math.floor((Date.now() - startedAtRef.current) / 1000)));
      }, 250);
      stopTimerRef.current = setTimeout(() => stopRecording(), MAX_RECORDING_MS);
    } catch {
      stopRecorderTracks();
      setMode("text");
      setError("マイクを利用できませんでした。ブラウザのマイク許可をご確認ください。テキスト入力も利用できます。");
      setStage("input");
    }
  };

  const stopRecording = () => {
    clearRecordingTimers();
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
  };

  const cancelRecording = () => {
    discardRecordingRef.current = true;
    stopRecording();
    stopRecorderTracks();
    chunksRef.current = [];
    setStage("input");
  };

  const handleRecordingStopped = async () => {
    clearRecordingTimers();
    stopRecorderTracks();
    const durationMs = Math.min(Date.now() - startedAtRef.current, MAX_RECORDING_MS);
    const mimeType = recorderRef.current?.mimeType || "audio/webm";
    recorderRef.current = null;
    const chunks = chunksRef.current;
    chunksRef.current = [];
    if (discardRecordingRef.current) return;

    let audioBlob: Blob | null = new Blob(chunks, { type: mimeType });
    chunks.length = 0;
    if (audioBlob.size === 0) {
      setError("音声を取得できませんでした。もう一度お試しください。");
      setStage("input");
      return;
    }

    setStage("transcribing");
    const controller = new AbortController();
    requestControllerRef.current = controller;
    let formData: FormData | null = new FormData();
    try {
      formData.append("audio", audioBlob, recordingFilename(mimeType));
      formData.append("duration_ms", String(Math.max(1, durationMs)));
      formData.append("consent_version", AI_CONSENT_VERSION);
      const response = await fetch("/api/health/transcribe", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
      const payload: unknown = await response.json();
      formData = null;
      audioBlob = null;
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "transcribe"));
      const transcription = transcriptionResponseSchema.safeParse(payload);
      if (!transcription.success) throw new Error("文字起こし結果を確認できませんでした。");
      await parseText(transcription.data.text, ["openai_stt"]);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "音声の解析に失敗しました。");
      setStage("input");
    } finally {
      formData = null;
      audioBlob = null;
      requestControllerRef.current = null;
    }
  };

  const updateEntry = (index: number, patch: Partial<HealthEntry>) => {
    setEntries((current) =>
      current.map((entry, entryIndex) =>
        entryIndex === index ? validateEditableHealthEntry({ ...entry, ...patch }) : entry,
      ),
    );
  };

  const removeEntry = (index: number) => {
    setEntries((current) => current.filter((_, entryIndex) => entryIndex !== index));
  };

  const releaseTransientData = () => {
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    pendingOpenAIActionRef.current = null;
    speechRecognitionSettledRef.current = true;
    try {
      speechRecognitionRef.current?.abort();
    } catch {
      // 破棄処理では何も記録しない。
    }
    speechRecognitionRef.current = null;
    discardRecordingRef.current = true;
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
    recorderRef.current = null;
    chunksRef.current = [];
    clearRecordingTimers();
    stopRecorderTracks();
  };

  const clearRecordingTimers = () => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    stopTimerRef.current = null;
    elapsedTimerRef.current = null;
  };

  const stopRecorderTracks = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const busy = [
    "preparing_speech",
    "speech_listening",
    "recording",
    "transcribing",
    "parsing",
  ].includes(stage);

  return (
    <>
      <div className="pointer-events-none fixed bottom-[72px] left-0 right-0 z-[60] mx-auto flex max-w-[430px] justify-center px-4">
        <button
          type="button"
          onClick={openModal}
          className="pointer-events-auto min-h-12 rounded-full bg-teal-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-teal-900/20 transition hover:bg-teal-700 focus:outline-none focus:ring-4 focus:ring-teal-200"
          aria-label="音声またはテキストで健康記録を入力"
        >
          🎙 記録
        </button>
      </div>

      {isOpen && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-stone-950/40 px-0 sm:items-center sm:px-4" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="health-record-title"
            className="safe-bottom max-h-[92dvh] w-full max-w-[430px] overflow-y-auto rounded-t-3xl bg-[#f8f5ef] p-5 shadow-2xl sm:rounded-3xl"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-teal-700">MVP-01.2 プレビュー</p>
                <h2 id="health-record-title" className="text-xl font-bold text-stone-800">
                  健康記録
                </h2>
              </div>
              <button
                type="button"
                onClick={closeModal}
                disabled={busy}
                className="min-h-11 min-w-11 rounded-full bg-white text-xl text-stone-500 disabled:opacity-40"
                aria-label="閉じる"
              >
                ×
              </button>
            </div>

            {stage === "browser_consent" ? (
              <BrowserSpeechConsentPanel
                checked={consentChecked}
                onCheckedChange={setConsentChecked}
                onAgree={agreeToBrowserSpeech}
                onCancel={cancelConsent}
              />
            ) : stage === "openai_consent" ? (
              <OpenAIConsentPanel
                checked={consentChecked}
                onCheckedChange={setConsentChecked}
                onAgree={agreeToOpenAIProcessing}
                onCancel={cancelConsent}
              />
            ) : stage === "confirm" ? (
              <ConfirmationPanel
                entries={entries}
                hasUnsupportedContent={hasUnsupportedContent}
                processingPaths={processingPaths}
                onUpdate={updateEntry}
                onRemove={removeEntry}
                onBack={() => {
                  setEntries([]);
                  setProcessingPaths([]);
                  setError("");
                  setStage("input");
                }}
                onCancel={closeModal}
              />
            ) : (
              <>
                <div className="mb-4 grid grid-cols-2 rounded-2xl bg-stone-200/70 p-1">
                  {(["voice", "text"] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      disabled={busy}
                      onClick={() => selectMode(item)}
                      className={`min-h-11 rounded-xl text-sm font-bold ${
                        mode === item ? "bg-white text-teal-700 shadow-sm" : "text-stone-500"
                      }`}
                    >
                      {item === "voice" ? "🎙 音声" : "⌨️ テキスト"}
                    </button>
                  ))}
                </div>

                {mode === "text" ? (
                  <div>
                    <label htmlFor="health-record-text" className="mb-2 block text-sm font-bold text-stone-700">
                      記録する内容
                    </label>
                    <textarea
                      ref={textInputRef}
                      id="health-record-text"
                      value={text}
                      disabled={busy}
                      maxLength={MAX_HEALTH_TEXT_LENGTH}
                      onChange={(event) => setText(event.target.value)}
                      rows={5}
                      placeholder="例：今日52.6キロ、体脂肪23.4パーセント。今日生理始まった"
                      className="w-full resize-none rounded-2xl border border-stone-200 bg-white p-4 text-base text-stone-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100 disabled:opacity-60"
                    />
                    <p className="mt-1 text-right text-xs text-stone-400">
                      {text.length} / {MAX_HEALTH_TEXT_LENGTH}
                    </p>
                    <button
                      type="button"
                      onClick={() => void parseText(text)}
                      disabled={busy || !text.trim()}
                      className="mt-3 min-h-12 w-full rounded-2xl bg-teal-600 px-4 font-bold text-white disabled:bg-stone-300"
                    >
                      {stage === "parsing" ? "解析しています…" : "内容を解析する"}
                    </button>
                    <p className="mt-2 text-xs text-stone-500">
                      まず端末内で解析し、複雑な入力だけ同意後にOpenAIを使用します。
                    </p>
                  </div>
                ) : usesIOSKeyboardDictation ? (
                  <IOSKeyboardDictationPanel
                    textareaRef={textInputRef}
                    text={text}
                    busy={busy}
                    parsing={stage === "parsing"}
                    error={error}
                    onTextChange={setText}
                    onParse={() => void parseText(text, ["keyboard_dictation"])}
                    onHighAccuracy={requestOpenAIRecording}
                  />
                ) : (
                  <VoicePanel
                    stage={stage}
                    recordingSeconds={recordingSeconds}
                    speechPackStatus={speechPackStatus}
                    onStart={() => void startPreferredSpeechRecognition()}
                    onStopSpeech={stopSpeechRecognition}
                    onCancelSpeech={cancelSpeechRecognition}
                    onInstallPack={() => void installLocalSpeechPack()}
                    onUseBrowser={requestBrowserSpeechRecognition}
                    onRetryPack={() => void startPreferredSpeechRecognition()}
                    onHighAccuracy={requestOpenAIRecording}
                    onStopRecording={stopRecording}
                    onCancelRecording={cancelRecording}
                    onUseText={() => {
                      selectMode("text");
                    }}
                  />
                )}
              </>
            )}

            {error &&
              !(mode === "voice" && usesIOSKeyboardDictation && stage === "input") && (
                <div role="alert" className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                  {error}
                </div>
              )}
          </section>
        </div>
      )}
    </>
  );
}

function BrowserSpeechConsentPanel({
  checked,
  onCheckedChange,
  onAgree,
  onCancel,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  onAgree: () => void;
  onCancel: () => void;
}) {
  return (
    <ConsentShell
      title="ブラウザ音声認識について"
      description="端末内認識を確認できない場合、音声がブラウザまたはOS提供元の音声認識サービスへ送信される場合があります。OpenAIへの送信ではありません。"
      details={[
        "認識されたテキストは、まずこのアプリ内のローカルparserで整理します。",
        "アプリのDB・Storageには音声と全文文字起こしを保存しません。",
        "複雑な内容をOpenAIへ送る場合は、別途OpenAIへの同意を確認します。",
      ]}
      checkboxLabel="上記を確認し、通常のブラウザ音声認識を利用することに同意します。"
      checked={checked}
      onCheckedChange={onCheckedChange}
      onAgree={onAgree}
      onCancel={onCancel}
    />
  );
}

function OpenAIConsentPanel({
  checked,
  onCheckedChange,
  onAgree,
  onCancel,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  onAgree: () => void;
  onCancel: () => void;
}) {
  return (
    <ConsentShell
      title="OpenAIへの送信について"
      description="高精度音声認識またはローカルでは確定できない文章の解析を選ぶと、必要な音声またはテキストがOpenAIのAPIへ送信されます。"
      details={[
        "音声は文字起こし、テキストは健康記録の整理に使用します。",
        "氏名、メールアドレス、ユーザーIDは送信しません。",
        "アプリ側では音声と全文文字起こしをDB・Storageへ保存しません。",
        "OpenAI側のデータ取扱いは同社のAPIに関する公式条件に従います。",
      ]}
      checkboxLabel="上記を確認し、必要なデータをOpenAI APIへ送信することに同意します。"
      checked={checked}
      onCheckedChange={onCheckedChange}
      onAgree={onAgree}
      onCancel={onCancel}
    />
  );
}

function ConsentShell({
  title,
  description,
  details,
  checkboxLabel,
  checked,
  onCheckedChange,
  onAgree,
  onCancel,
}: {
  title: string;
  description: string;
  details: string[];
  checkboxLabel: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  onAgree: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-stone-700">
        <p className="font-bold text-stone-800">{title}</p>
        <p className="mt-2">{description}</p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs">
          {details.map((detail) => <li key={detail}>{detail}</li>)}
        </ul>
        <Link href="/privacy" className="mt-3 inline-block font-bold text-teal-700 underline underline-offset-2">
          プライバシーポリシーを確認する
        </Link>
      </div>
      <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-white p-4 text-sm text-stone-700">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onCheckedChange(event.target.checked)}
          className="mt-1 h-5 w-5 accent-teal-600"
        />
        <span>{checkboxLabel}</span>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={onCancel} className="min-h-12 rounded-2xl border border-stone-300 font-bold text-stone-600">戻る</button>
        <button type="button" onClick={onAgree} disabled={!checked} className="min-h-12 rounded-2xl bg-teal-600 font-bold text-white disabled:bg-stone-300">同意して続ける</button>
      </div>
    </div>
  );
}

function IOSKeyboardDictationPanel({
  textareaRef,
  text,
  busy,
  parsing,
  error,
  onTextChange,
  onParse,
  onHighAccuracy,
}: {
  textareaRef: { current: HTMLTextAreaElement | null };
  text: string;
  busy: boolean;
  parsing: boolean;
  error: string;
  onTextChange: (text: string) => void;
  onParse: () => void;
  onHighAccuracy: () => void;
}) {
  return (
    <div>
      <div className="mb-3 rounded-2xl border border-teal-200 bg-teal-50 p-4 text-sm text-stone-700">
        <p className="font-bold text-teal-800">
          iPhoneのキーボードにあるマイクをタップして話してください
        </p>
        <p className="mt-2 text-xs leading-5 text-stone-600">
          入力後、このアプリ内で内容を解析します。複雑な内容だけ、同意後にOpenAI解析をご案内します。
        </p>
      </div>
      <label htmlFor="health-record-ios-dictation" className="mb-2 block text-sm font-bold text-stone-700">
        音声入力する内容
      </label>
      <textarea
        ref={textareaRef}
        id="health-record-ios-dictation"
        value={text}
        disabled={busy}
        maxLength={MAX_HEALTH_TEXT_LENGTH}
        onChange={(event) => onTextChange(event.target.value)}
        rows={5}
        enterKeyHint="done"
        placeholder="例：今日52.6キロ、体脂肪23.4パーセント。今日生理始まった"
        className="w-full resize-none rounded-2xl border border-stone-200 bg-white p-4 text-base text-stone-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100 disabled:opacity-60"
      />
      <p className="mt-1 text-right text-xs text-stone-400">
        {text.length} / {MAX_HEALTH_TEXT_LENGTH}
      </p>
      <button
        type="button"
        onClick={onParse}
        disabled={busy || !text.trim()}
        className="mt-3 min-h-12 w-full rounded-2xl bg-teal-600 px-4 font-bold text-white disabled:bg-stone-300"
      >
        {parsing ? "解析しています…" : "内容を解析する"}
      </button>
      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm leading-6 text-rose-700"
        >
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={onHighAccuracy}
        disabled={busy}
        className="mt-3 min-h-11 w-full rounded-2xl border border-teal-300 bg-white px-4 text-sm font-bold text-teal-700 disabled:opacity-50"
      >
        高精度認識で録り直す
      </button>
      <p className="mt-2 text-xs leading-5 text-stone-500">
        高精度認識は、選択した場合だけ録音し、同意後にOpenAIへ送信します。
      </p>
    </div>
  );
}

function VoicePanel({
  stage,
  recordingSeconds,
  speechPackStatus,
  onStart,
  onStopSpeech,
  onCancelSpeech,
  onInstallPack,
  onUseBrowser,
  onRetryPack,
  onHighAccuracy,
  onStopRecording,
  onCancelRecording,
  onUseText,
}: {
  stage: Stage;
  recordingSeconds: number;
  speechPackStatus: SpeechAvailability;
  onStart: () => void;
  onStopSpeech: () => void;
  onCancelSpeech: () => void;
  onInstallPack: () => void;
  onUseBrowser: () => void;
  onRetryPack: () => void;
  onHighAccuracy: () => void;
  onStopRecording: () => void;
  onCancelRecording: () => void;
  onUseText: () => void;
}) {
  return (
    <div className="rounded-3xl bg-white p-6 text-center">
      {stage === "speech_listening" ? (
        <>
          <RecordingIndicator label="音声を認識しています" seconds={recordingSeconds} />
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button type="button" onClick={onCancelSpeech} className="min-h-12 rounded-2xl border border-stone-300 font-bold text-stone-600">キャンセル</button>
            <button type="button" onClick={onStopSpeech} className="min-h-12 rounded-2xl bg-teal-600 font-bold text-white">認識を終了</button>
          </div>
        </>
      ) : stage === "recording" ? (
        <>
          <RecordingIndicator label="高精度認識用に録音しています" seconds={recordingSeconds} />
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button type="button" onClick={onCancelRecording} className="min-h-12 rounded-2xl border border-stone-300 font-bold text-stone-600">キャンセル</button>
            <button type="button" onClick={onStopRecording} className="min-h-12 rounded-2xl bg-teal-600 font-bold text-white">録音を終了</button>
          </div>
        </>
      ) : stage === "transcribing" || stage === "parsing" || stage === "preparing_speech" ? (
        <ProcessingPanel
          label={
            stage === "transcribing"
              ? "音声を文字にしています…"
              : stage === "parsing"
                ? "内容を解析しています…"
                : "利用できる音声認識を確認しています…"
          }
        />
      ) : stage === "speech_setup" ? (
        <>
          <p className="font-bold text-stone-800">端末内音声認識を準備できます</p>
          <p className="mt-2 text-sm text-stone-600">
            日本語の音声認識データをブラウザへ追加すると、対応環境では音声を端末内で認識できます。
          </p>
          {speechPackStatus === "downloading" ? (
            <>
              <p className="mt-4 text-sm font-bold text-teal-700">準備中です…</p>
              <button type="button" onClick={onRetryPack} className="mt-4 min-h-12 w-full rounded-2xl border border-teal-500 font-bold text-teal-700">状態を再確認</button>
            </>
          ) : (
            <button type="button" onClick={onInstallPack} className="mt-4 min-h-12 w-full rounded-2xl bg-teal-600 font-bold text-white">端末内認識を準備する</button>
          )}
          <button type="button" onClick={onUseBrowser} className="mt-3 min-h-12 w-full rounded-2xl border border-stone-300 font-bold text-stone-600">今回はブラウザ音声認識を使う</button>
        </>
      ) : stage === "speech_failed" ? (
        <>
          <p className="font-bold text-stone-800">別の入力方法を選べます</p>
          <p className="mt-2 text-sm text-stone-600">
            OpenAIへ自動送信はしません。高精度認識を選ぶ場合は、同意後にもう一度録音します。
          </p>
          <button type="button" onClick={onHighAccuracy} className="mt-4 min-h-12 w-full rounded-2xl bg-teal-600 px-4 font-bold text-white">高精度認識で録り直す</button>
          <button type="button" onClick={onUseText} className="mt-3 min-h-12 w-full rounded-2xl border border-stone-300 font-bold text-stone-600">テキストで入力する</button>
        </>
      ) : (
        <>
          <p className="text-sm text-stone-600">マイクを押して自然に話してください</p>
          <button
            type="button"
            onClick={onStart}
            className="mx-auto mt-5 flex h-24 w-24 items-center justify-center rounded-full bg-teal-600 text-4xl text-white shadow-lg shadow-teal-900/20 focus:outline-none focus:ring-4 focus:ring-teal-200"
            aria-label="音声認識を開始"
          >
            🎙
          </button>
          <p className="mt-3 text-xs text-stone-500">最大30秒。利用可能なら端末内認識を優先します。</p>
          <p className="mt-1 text-xs text-stone-400">通常の音声認識はブラウザ提供元で処理される場合があります。</p>
        </>
      )}
    </div>
  );
}

function RecordingIndicator({ label, seconds }: { label: string; seconds: number }) {
  return (
    <>
      <div className="mx-auto mb-4 flex h-20 w-20 animate-pulse items-center justify-center rounded-full bg-rose-100 text-4xl">🎙</div>
      <p className="font-bold text-stone-800">{label}</p>
      <p className="mt-1 tabular-nums text-sm text-stone-500">{seconds} / 30秒</p>
    </>
  );
}

function ConfirmationPanel({
  entries,
  hasUnsupportedContent,
  processingPaths,
  onUpdate,
  onRemove,
  onBack,
  onCancel,
}: {
  entries: HealthEntry[];
  hasUnsupportedContent: boolean;
  processingPaths: SpeechProcessingPath[];
  onUpdate: (index: number, patch: Partial<HealthEntry>) => void;
  onRemove: (index: number) => void;
  onBack: () => void;
  onCancel: () => void;
}) {
  const hasIssues = entries.some((entry) => entry.needsConfirmation);
  return (
    <div>
      <h3 className="font-bold text-stone-800">この内容を確認してください</h3>
      <p className="mt-1 text-xs text-stone-500">解析結果はまだ保存されていません。数値と日付を修正できます。</p>
      {processingPaths.length > 0 && (
        <p className="mt-3 rounded-xl bg-teal-50 p-3 text-xs text-teal-800">
          処理経路：{processingPaths.map((path) => PATH_LABELS[path]).join(" → ")}
        </p>
      )}
      {hasUnsupportedContent && (
        <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">MVP-01.2の対象外の内容は記録候補に含めていません。</p>
      )}
      <div className="mt-4 space-y-3">
        {entries.map((entry, index) => {
          const meta = ENTRY_LABELS[entry.type];
          return (
            <div key={`${entry.type}-${index}`} className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="font-bold text-stone-800"><span aria-hidden="true">{meta.icon}</span> {meta.label}</p>
                <button type="button" onClick={() => onRemove(index)} className="min-h-9 rounded-lg px-2 text-xs font-bold text-stone-400 hover:bg-stone-100">候補から外す</button>
              </div>
              {entry.type !== "period_start" && (
                <label className="mt-3 block text-xs font-bold text-stone-600">
                  数値
                  <span className="mt-1 flex items-center gap-2">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      value={entry.value ?? ""}
                      onChange={(event) => onUpdate(index, { value: event.target.value === "" ? null : Number(event.target.value) })}
                      className="min-h-11 w-full rounded-xl border border-stone-200 px-3 text-base font-normal text-stone-800 outline-none focus:border-teal-500"
                    />
                    <span className="min-w-8 text-sm">{entry.unit}</span>
                  </span>
                </label>
              )}
              <label className="mt-3 block text-xs font-bold text-stone-600">
                日付
                <input
                  type="date"
                  value={entry.occurredOn ?? ""}
                  onChange={(event) => onUpdate(index, { occurredOn: event.target.value || null })}
                  className="mt-1 min-h-11 w-full rounded-xl border border-stone-200 px-3 text-base font-normal text-stone-800 outline-none focus:border-teal-500"
                />
              </label>
              {entry.issues.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-rose-700">
                  {entry.issues.map((issue) => <li key={issue}>・{HEALTH_ISSUE_MESSAGES[issue]}</li>)}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-4 rounded-2xl border border-stone-200 bg-stone-100 p-3 text-center text-xs text-stone-600">
        MVP-01.2では確認までです。Supabaseへの保存は行いません。
      </div>
      <button type="button" disabled className="mt-3 min-h-12 w-full rounded-2xl bg-stone-300 font-bold text-stone-500">保存する（MVP-01.2では未実装）</button>
      {hasIssues && <p className="mt-2 text-center text-xs text-rose-700">赤字の項目を修正して内容を確認してください。</p>}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <button type="button" onClick={onCancel} className="min-h-12 rounded-2xl border border-stone-300 font-bold text-stone-600">キャンセル</button>
        <button type="button" onClick={onBack} className="min-h-12 rounded-2xl border border-teal-500 font-bold text-teal-700">入力を修正</button>
      </div>
    </div>
  );
}

function ProcessingPanel({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite">
      <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-teal-100 border-t-teal-600" />
      <p className="mt-4 font-bold text-stone-700">{label}</p>
      <p className="mt-1 text-xs text-stone-400">この画面を閉じずにお待ちください。</p>
    </div>
  );
}

function uniquePaths(paths: SpeechProcessingPath[]) {
  return paths.filter((path, index) => paths.indexOf(path) === index);
}

function selectRecordingMimeType() {
  return ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function recordingFilename(mimeType: string) {
  return mimeType.startsWith("audio/mp4") ? "health-input.m4a" : "health-input.webm";
}

function getApiErrorMessage(payload: unknown, kind: "parse" | "transcribe") {
  const code =
    payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
      ? payload.error
      : "";
  const messages: Record<string, string> = {
    UNAUTHORIZED: "ログイン状態を確認して、もう一度お試しください。",
    INVALID_INPUT: `入力は1〜${MAX_HEALTH_TEXT_LENGTH}文字で指定してください。`,
    NO_SUPPORTED_ENTRIES: "体重・体脂肪率・生理開始の記録を見つけられませんでした。",
    INVALID_AI_OUTPUT: "解析結果を安全に確認できませんでした。もう一度お試しください。",
    AI_UNAVAILABLE: "AI解析を現在利用できません。しばらくしてからお試しください。",
    INVALID_AUDIO: "音声データを確認できませんでした。30秒以内で録音してください。",
    INVALID_TRANSCRIPTION: "文字起こし結果を確認できませんでした。",
    TRANSCRIPTION_UNAVAILABLE: "音声の文字起こしを現在利用できません。",
  };
  return messages[code] ?? (kind === "parse" ? "AI解析に失敗しました。" : "音声の解析に失敗しました。");
}
