"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { loadCommunityAuthorRows } from "@/lib/community-authors";
import { createClient } from "@/lib/supabase";
import { getUserFacingError } from "@/lib/user-facing-error";

type FeedbackRow = {
  id: string;
  user_id: string;
  category: string;
  message: string;
  page_path: string | null;
  status: "new" | "reviewing" | "resolved";
  created_at: string;
};

type StatusFilter = "all" | FeedbackRow["status"];
type CategoryFilter = "all" | "bug" | "usability" | "request" | "other";

type Reporter = {
  nickname: string;
};

const CATEGORY_LABELS: Record<string, string> = {
  bug: "不具合",
  usability: "使いにくさ",
  request: "機能の要望",
  other: "その他",
};

export default function AdminFeedbackPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [reporters, setReporters] = useState<Record<string, Reporter>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("new");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError("");
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.replace("/auth/login");
      return;
    }

    const [{ data: byId }, { data: byUserId }] = await Promise.all([
      supabase.from("profiles").select("is_admin").eq("id", user.id).maybeSingle(),
      supabase.from("profiles").select("is_admin").eq("user_id", user.id).maybeSingle(),
    ]);
    if (!byId?.is_admin && !byUserId?.is_admin) {
      router.replace("/dashboard");
      return;
    }

    const result = await supabase
      .from("app_feedback")
      .select("id,user_id,category,message,page_path,status,created_at")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (result.error) {
      setError(
        getUserFacingError(result.error, "ご意見を読み込めませんでした。", {
          setupMessage: "app_feedback.sql をSupabaseで実行してください。",
        })
      );
      return;
    }
    const feedbackRows = (result.data ?? []) as FeedbackRow[];
    setRows(feedbackRows);

    const userIds = [...new Set(feedbackRows.map((row) => row.user_id))];
    const authorRows = await loadCommunityAuthorRows(supabase, userIds);
    const reporterMap = Object.fromEntries(
      authorRows.map((author: { user_id?: string; id?: string; nickname?: string | null }) => [
        author.user_id ?? author.id,
        { nickname: author.nickname?.trim() || "ユーザー" },
      ])
    );
    setReporters(reporterMap);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateStatus = async (id: string, status: FeedbackRow["status"]) => {
    setError("");
    setUpdatingId(id);
    const result = await supabase
      .from("app_feedback")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (result.error || !result.data) {
      setUpdatingId(null);
      setError(getUserFacingError(result.error, "状態を更新できませんでした。再読み込みしてください。"));
      return;
    }
    setRows((current) => current.map((row) => row.id === id ? { ...row, status } : row));
    setUpdatingId(null);
  };

  const counts = {
    all: rows.length,
    new: rows.filter((row) => row.status === "new").length,
    reviewing: rows.filter((row) => row.status === "reviewing").length,
    resolved: rows.filter((row) => row.status === "resolved").length,
  };
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase("ja-JP");
  const filteredRows = rows.filter((row) => {
    if (filter !== "all" && row.status !== filter) return false;
    if (categoryFilter !== "all" && row.category !== categoryFilter) return false;
    if (!normalizedSearchQuery) return true;

    const reporter = reporters[row.user_id]?.nickname ?? "ユーザー";
    return [
      row.message,
      row.page_path ?? "",
      reporter,
      row.user_id,
      CATEGORY_LABELS[row.category] ?? row.category,
    ].some((value) => value.toLocaleLowerCase("ja-JP").includes(normalizedSearchQuery));
  });
  const filters: { value: StatusFilter; label: string }[] = [
    { value: "new", label: `未確認 ${counts.new}` },
    { value: "reviewing", label: `対応中 ${counts.reviewing}` },
    { value: "resolved", label: `完了 ${counts.resolved}` },
    { value: "all", label: `すべて ${counts.all}` },
  ];

  return (
    <div className="min-h-screen bg-[#f3f0ea] text-slate-900">
      <div className="mx-auto min-h-screen max-w-[430px] bg-[#f7f4ee]">
        <header className="border-b border-stone-200 bg-white px-6 py-8">
          <p className="text-sm font-bold text-[#5d9997]">管理者</p>
          <h1 className="mt-1 text-3xl font-bold">ご意見確認</h1>
          <Link href="/settings" className="mt-3 inline-block text-sm font-bold text-[#5d9997]">設定へ戻る</Link>
        </header>
        <main className="space-y-4 px-5 py-6">
          {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          <section className="rounded-2xl bg-white p-2">
            <div className="grid grid-cols-4 gap-1">
              {filters.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setFilter(item.value)}
                  aria-pressed={filter === item.value}
                  className={`rounded-xl px-1 py-2 text-[11px] font-bold ${
                    filter === item.value ? "bg-[#5d9997] text-white" : "text-stone-500"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </section>
          <section className="space-y-3 rounded-2xl bg-white p-4">
            <label className="block">
              <span className="mb-2 block text-xs font-bold text-stone-500">報告を検索</span>
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="内容、ニックネーム、画面名"
                className="w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#5d9997]"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-bold text-stone-500">種類</span>
              <select
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value as CategoryFilter)}
                className="w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm font-bold outline-none focus:border-[#5d9997]"
              >
                <option value="all">すべての種類</option>
                <option value="bug">不具合</option>
                <option value="usability">使いにくさ</option>
                <option value="request">機能の要望</option>
                <option value="other">その他</option>
              </select>
            </label>
            {(searchQuery || categoryFilter !== "all") && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setCategoryFilter("all");
                }}
                className="w-full rounded-xl bg-stone-100 py-2 text-xs font-bold text-stone-500"
              >
                検索条件をクリア
              </button>
            )}
          </section>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="w-full rounded-xl border border-stone-200 bg-white py-2 text-sm font-bold text-stone-500 disabled:opacity-50"
          >
            再読み込み
          </button>
          {loading ? (
            <p className="rounded-2xl bg-white p-5 text-center text-sm text-stone-400">読み込み中...</p>
          ) : filteredRows.length === 0 ? (
            <p className="rounded-2xl bg-white p-5 text-center text-sm text-stone-500">
              {rows.length === 0 ? "まだ届いていません。" : "この条件に合うご意見はありません。"}
            </p>
          ) : (
            filteredRows.map((row) => (
              <article key={row.id} className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-teal-700">
                    {CATEGORY_LABELS[row.category] ?? row.category}
                  </span>
                  <time className="text-xs text-stone-400">
                    {new Date(row.created_at).toLocaleString("ja-JP")}
                  </time>
                </div>
                {row.page_path && (
                  row.page_path.startsWith("/") ? (
                    <Link
                      href={row.page_path}
                      className="mt-3 inline-block text-xs font-bold text-[#5d9997] underline decoration-teal-200 underline-offset-4"
                    >
                      報告元を開く：{row.page_path}
                    </Link>
                  ) : (
                    <p className="mt-3 text-xs font-bold text-stone-400">報告元：{row.page_path}</p>
                  )
                )}
                <p className="mt-2 text-xs text-stone-400">
                  報告者：
                  <span className="font-bold text-stone-600">
                    {reporters[row.user_id]?.nickname ?? "ユーザー"}
                  </span>
                  <span className="ml-2">ID {row.user_id.slice(0, 8)}</span>
                </p>
                <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-700">{row.message}</p>
                <select
                  value={row.status}
                  onChange={(event) => updateStatus(row.id, event.target.value as FeedbackRow["status"])}
                  disabled={updatingId === row.id}
                  aria-label="対応状況"
                  className="mt-4 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-bold disabled:cursor-wait disabled:opacity-60"
                >
                  <option value="new">{updatingId === row.id ? "更新中..." : "未確認"}</option>
                  <option value="reviewing">対応中</option>
                  <option value="resolved">完了</option>
                </select>
              </article>
            ))
          )}
        </main>
      </div>
    </div>
  );
}
