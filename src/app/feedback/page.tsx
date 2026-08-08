"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Navigation from "@/components/Navigation";
import { createClient } from "@/lib/supabase";
import { getUserFacingError } from "@/lib/user-facing-error";

const CATEGORIES = [
  { value: "bug", label: "不具合" },
  { value: "usability", label: "使いにくさ" },
  { value: "request", label: "機能の要望" },
  { value: "other", label: "その他" },
] as const;

type FeedbackStatus = "new" | "reviewing" | "resolved";

type FeedbackHistoryRow = {
  id: string;
  category: string;
  message: string;
  page_path: string | null;
  status: FeedbackStatus;
  created_at: string;
  updated_at: string;
};

const STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: "受付済み",
  reviewing: "確認中",
  resolved: "対応完了",
};

const STATUS_CLASSES: Record<FeedbackStatus, string> = {
  new: "bg-stone-100 text-stone-600",
  reviewing: "bg-amber-100 text-amber-800",
  resolved: "bg-teal-100 text-teal-800",
};

export default function FeedbackPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [category, setCategory] = useState("bug");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [history, setHistory] = useState<FeedbackHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");

  useEffect(() => {
    const detail = new URLSearchParams(window.location.search).get("detail")?.trim();
    if (detail) setMessage(detail.slice(0, 1000));

    const loadHistory = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setHistoryLoading(false);
        return;
      }

      const result = await supabase
        .from("app_feedback")
        .select("id,category,message,page_path,status,created_at,updated_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(10);

      setHistoryLoading(false);
      if (result.error) {
        setHistoryError(
          getUserFacingError(result.error, "送信履歴を読み込めませんでした。", {
            setupMessage: "送信履歴の準備が完了していません。",
          })
        );
        return;
      }
      setHistory((result.data ?? []) as FeedbackHistoryRow[]);
    };

    loadHistory();
  }, [supabase]);

  const getSourcePath = () => {
    if (typeof window === "undefined") return null;
    const requestedSource = new URLSearchParams(window.location.search).get("from");
    if (requestedSource?.startsWith("/")) return requestedSource.slice(0, 200);
    if (!document.referrer) return null;
    try {
      const referrer = new URL(document.referrer);
      return referrer.origin === window.location.origin ? referrer.pathname : null;
    } catch {
      return null;
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedMessage = message.trim();
    if (normalizedMessage.length < 10) {
      setNotice({ type: "error", text: "内容を10文字以上で入力してください。" });
      return;
    }

    setSaving(true);
    setNotice(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/auth/login?next=/feedback");
      return;
    }

    const result = await supabase
      .from("app_feedback")
      .insert({
        user_id: user.id,
        category,
        message: normalizedMessage,
        page_path: getSourcePath(),
        status: "new",
      })
      .select("id,category,message,page_path,status,created_at,updated_at")
      .single();

    setSaving(false);
    if (result.error) {
      setNotice({
        type: "error",
        text: getUserFacingError(
          result.error,
          "送信できませんでした。時間をおいてもう一度お試しください。",
          { setupMessage: "ご意見受付の準備中です。管理者へお知らせください。" }
        ),
      });
      return;
    }

    setMessage("");
    setHistory((current) => [result.data as FeedbackHistoryRow, ...current].slice(0, 10));
    setHistoryError("");
    setNotice({ type: "success", text: "送信しました。ご協力ありがとうございます。" });
  };

  return (
    <div className="min-h-screen bg-[#f3f0ea] pb-24 text-slate-900">
      <div className="mx-auto min-h-screen max-w-[430px] bg-[#f7f4ee]">
        <header className="border-b border-stone-200 bg-white px-6 py-8">
          <p className="text-sm font-bold text-[#5d9997]">試用版</p>
          <h1 className="mt-1 text-3xl font-bold">ご意見・不具合報告</h1>
          <p className="mt-2 text-base text-stone-400">気づいたことを運営へ送れます</p>
        </header>

        <main className="space-y-5 px-5 py-6">
          <section className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
            <p className="text-sm leading-6 text-stone-500">
              個人情報やパスワードは入力しないでください。操作した画面や、起きたことを具体的に書くと確認しやすくなります。
            </p>
            <form onSubmit={submit} className="mt-5 space-y-4">
              <label className="block">
                <span className="mb-2 block text-sm font-bold text-slate-600">種類</span>
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  disabled={saving}
                  className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base outline-none focus:border-[#5d9997]"
                >
                  {CATEGORIES.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-bold text-slate-600">内容</span>
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  disabled={saving}
                  maxLength={1000}
                  rows={7}
                  placeholder="例：体重を保存したあと、ホームに戻ると前の数値が表示されました。"
                  className="w-full resize-none rounded-2xl border border-stone-200 bg-white px-4 py-3 text-base leading-7 outline-none focus:border-[#5d9997]"
                />
                <span className="mt-1 block text-right text-xs text-stone-400">{message.length}/1000</span>
              </label>
              {notice && (
                <p
                  role="status"
                  className={`rounded-xl px-4 py-3 text-sm ${
                    notice.type === "error" ? "bg-red-50 text-red-700" : "bg-teal-50 text-teal-700"
                  }`}
                >
                  {notice.text}
                </p>
              )}
              <button
                type="submit"
                disabled={saving || message.trim().length < 10}
                className="w-full rounded-xl bg-[#5d9997] py-3 text-base font-bold text-white disabled:opacity-50"
              >
                {saving ? "送信中..." : "運営へ送信"}
              </button>
            </form>
          </section>

          <section className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">送信履歴</h2>
                <p className="mt-1 text-sm text-stone-400">最近の10件を表示します</p>
              </div>
            </div>

            {historyError && (
              <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                {historyError}
              </p>
            )}

            {historyLoading ? (
              <p className="mt-4 text-center text-sm text-stone-400">読み込み中...</p>
            ) : history.length === 0 ? (
              <p className="mt-4 rounded-xl bg-stone-50 px-4 py-5 text-center text-sm text-stone-500">
                まだ送信履歴はありません。
              </p>
            ) : (
              <div className="mt-4 divide-y divide-stone-100">
                {history.map((row) => (
                  <article key={row.id} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-teal-700">
                          {CATEGORIES.find((item) => item.value === row.category)?.label ?? row.category}
                        </span>
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${STATUS_CLASSES[row.status]}`}>
                          {STATUS_LABELS[row.status]}
                        </span>
                      </div>
                      <time className="text-xs text-stone-400">
                        {new Date(row.created_at).toLocaleDateString("ja-JP")}
                      </time>
                    </div>
                    <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                      {row.message}
                    </p>
                    {row.page_path && (
                      <p className="mt-2 truncate text-xs text-stone-400">報告元：{row.page_path}</p>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>

          <Link href="/settings" className="block text-center text-sm font-bold text-[#5d9997]">
            設定へ戻る
          </Link>
        </main>
      </div>
      <Navigation active="settings" />
    </div>
  );
}
