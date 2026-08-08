"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Navigation from "@/components/Navigation";
import { loadCommunityAuthorRows } from "@/lib/community-authors";
import { createClient } from "@/lib/supabase";
import { getUserFacingError } from "@/lib/user-facing-error";
import type { CommunityPost } from "@/types";

type ProfileRow = Record<string, any>;
type AuthorMap = Record<string, { nickname: string; avatarPath: string }>;
type Filter = "review" | "hidden" | "reported" | "all";
type Notice = { type: "success" | "error" | "info"; text: string } | null;

const noticeClass = {
  success: "border-teal-100 bg-teal-50 text-teal-700",
  error: "border-red-100 bg-red-50 text-red-700",
  info: "border-stone-100 bg-stone-50 text-stone-600",
};

const filters: Array<{ key: Filter; label: string }> = [
  { key: "review", label: "確認対象" },
  { key: "hidden", label: "非表示" },
  { key: "reported", label: "通報あり" },
  { key: "all", label: "すべて" },
];

const avatarPathFromSeed = (seed: unknown) => {
  if (seed == null) return null;
  const normalized = String(seed).replace("mio", "").padStart(2, "0");
  return /^\d{2}$/.test(normalized) ? `/avatar_${normalized}.png` : null;
};

const getAvatarPath = (row?: ProfileRow | null) =>
  row?.avatar_path ??
  row?.avatar_url ??
  row?.avatar ??
  avatarPathFromSeed(row?.avatar_seed) ??
  "/avatar_01.png";

const mergeProfileRows = (primary: ProfileRow | null, fallback: ProfileRow | null) => {
  if (!primary) return fallback;
  if (!fallback) return primary;

  const merged = { ...primary };
  Object.entries(fallback).forEach(([key, value]) => {
    if (merged[key] === null || merged[key] === undefined || merged[key] === "") {
      merged[key] = value;
    }
  });
  return merged;
};

const formatDate = (date: string) =>
  new Date(date).toLocaleDateString("ja-JP", {
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

const moderationStage = (post: CommunityPost) => {
  const reports = post.reports_count ?? 0;
  if (post.needs_review || reports >= 5) {
    return {
      label: "管理者確認",
      text: "5件以上の通報があります。内容を確認して、表示に戻す・非表示・削除を判断してください。",
      className: "border-amber-100 bg-amber-50 text-amber-800",
    };
  }
  if (post.is_hidden || reports >= 3) {
    return {
      label: "一時非表示",
      text: "3件以上の通報で自動非表示になっています。問題なければ表示に戻せます。",
      className: "border-stone-100 bg-stone-50 text-stone-700",
    };
  }
  return {
    label: "記録のみ",
    text: "通報は記録されていますが、まだ自動非表示にはなっていません。",
    className: "border-teal-100 bg-teal-50 text-teal-800",
  };
};

export default function AdminCommunityPage() {
  const router = useRouter();
  const supabase = createClient();
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [authors, setAuthors] = useState<AuthorMap>({});
  const [filter, setFilter] = useState<Filter>("review");
  const [notice, setNotice] = useState<Notice>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [workingId, setWorkingId] = useState<string | null>(null);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadData = async () => {
    setLoading(true);
    setLoadError("");
    setNotice(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/auth/login");
      return;
    }

    const [{ data: newProfile, error: newProfileError }, { data: oldProfile, error: oldProfileError }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle(),
    ]);

    if (newProfileError && oldProfileError) {
      setLoadError(
        getUserFacingError(
          newProfileError,
          "管理者情報を読み込めませんでした。時間をおいて再読み込みしてください。"
        )
      );
      setLoading(false);
      return;
    }

    const row = mergeProfileRows(newProfile, oldProfile);
    setProfile(row);

    if (!row?.is_admin) {
      setPosts([]);
      setLoading(false);
      setNotice({ type: "error", text: "管理者権限がありません。" });
      return;
    }

    const { data, error } = await supabase
      .from("community_posts")
      .select("*")
      .or("needs_review.eq.true,is_hidden.eq.true,reports_count.gte.1")
      .order("reports_count", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      setLoadError(
        getUserFacingError(
          error,
          "確認対象の投稿を読み込めませんでした。時間をおいて再読み込みしてください。"
        )
      );
      setPosts([]);
      setAuthors({});
      setLoading(false);
      return;
    }

    const loadedPosts = data ?? [];
    setPosts(loadedPosts);
    await loadAuthors(loadedPosts);
    setLoading(false);
  };

  const loadAuthors = async (loadedPosts: CommunityPost[]) => {
    const userIds = Array.from(new Set(loadedPosts.map((post) => post.user_id).filter(Boolean)));
    if (userIds.length === 0) {
      setAuthors({});
      return;
    }

    const map: AuthorMap = {};
    const authorRows = await loadCommunityAuthorRows(supabase, userIds);
    authorRows.forEach((row: Record<string, any>) => {
      const id = row.id ?? row.user_id;
      const userId = row.user_id ?? row.id;
      const author = {
        nickname: row.nickname ?? "ユーザー",
        avatarPath: getAvatarPath(row),
      };
      if (id) map[id] = author;
      if (userId) map[userId] = author;
    });

    setAuthors(map);
  };

  const moderatePost = async (postId: string, action: "restore" | "hide" | "delete") => {
    const label = action === "restore" ? "表示に戻す" : action === "hide" ? "非表示にする" : "削除する";
    if (!window.confirm(`この投稿を${label}で進めますか？`)) return;

    setWorkingId(postId);
    setNotice(null);

    const { error } = await supabase.rpc("admin_moderate_community_post", {
      target_post_id: postId,
      action,
    });

    setWorkingId(null);

    if (error) {
      setNotice({
        type: "error",
        text:
          error.code === "PGRST202" || error.message.includes("admin_moderate_community_post")
            ? "管理者操作用SQLがまだ追加されていません。Supabaseで community_admin_moderation のSQLを実行してください。"
            : getUserFacingError(
                error,
                "投稿を処理できませんでした。時間をおいてもう一度お試しください。"
              ),
      });
      return;
    }

    if (action === "delete" || action === "restore") {
      setPosts((current) => current.filter((post) => post.id !== postId));
    } else {
      setPosts((current) =>
        current.map((post) =>
          post.id === postId ? { ...post, is_hidden: true, needs_review: true } : post
        )
      );
    }
    setNotice({ type: "success", text: `投稿を${label}処理しました。` });
  };

  const isAdmin = Boolean(profile?.is_admin);
  const counts = {
    review: posts.filter((post) => Boolean(post.needs_review)).length,
    hidden: posts.filter((post) => Boolean(post.is_hidden)).length,
    reported: posts.filter((post) => (post.reports_count ?? 0) > 0).length,
    all: posts.length,
  };
  const visiblePosts = posts.filter((post) => {
    if (filter === "review") return Boolean(post.needs_review);
    if (filter === "hidden") return Boolean(post.is_hidden);
    if (filter === "reported") return (post.reports_count ?? 0) > 0;
    return true;
  });

  return (
    <div className="min-h-screen bg-[#f3f0ea] pb-24 text-slate-900">
      <div className="mx-auto min-h-screen max-w-[430px] bg-[#f7f4ee]">
        <header className="border-b border-stone-200 bg-white px-6 py-8">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-[#5d9997]">管理者</p>
              <h1 className="mt-1 text-3xl font-bold tracking-normal">投稿確認</h1>
            </div>
            <Link href="/community" className="rounded-full bg-stone-100 px-4 py-2 text-sm font-bold text-stone-500">
              ひろば
            </Link>
          </div>
          <p className="mt-2 text-base text-stone-400">通報・非表示・確認対象の投稿を確認します</p>
        </header>

        <main className="space-y-4 px-5 py-6">
          {notice && <p className={`rounded-xl border px-3 py-2 text-sm ${noticeClass[notice.type]}`}>{notice.text}</p>}

          {isAdmin && (
            <>
              <section className="rounded-2xl bg-white p-4 text-sm leading-6 text-stone-500 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p><span className="font-bold text-slate-700">1件</span>：記録のみ</p>
                    <p><span className="font-bold text-slate-700">3件</span>：自動で一時非表示</p>
                    <p><span className="font-bold text-slate-700">5件</span>：管理者確認対象</p>
                  </div>
                  <button
                    type="button"
                    onClick={loadData}
                    disabled={loading}
                    className="shrink-0 rounded-full bg-stone-100 px-3 py-2 text-xs font-bold text-stone-500 disabled:opacity-50"
                  >
                    再読み込み
                  </button>
                </div>
              </section>

              <section className="grid grid-cols-4 gap-2">
                {[
                  ["確認", counts.review],
                  ["非表示", counts.hidden],
                  ["通報", counts.reported],
                  ["全件", counts.all],
                ].map(([label, count]) => (
                  <div key={label} className="rounded-2xl bg-white px-3 py-3 text-center shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
                    <p className="text-[11px] font-bold text-stone-400">{label}</p>
                    <p className="mt-1 text-xl font-light text-[#4d8b8a]">{count}</p>
                  </div>
                ))}
              </section>

              <section className="rounded-2xl bg-white p-2 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
                <div className="grid grid-cols-4 gap-1">
                  {filters.map((item) => (
                    <button
                      key={item.key}
                      onClick={() => setFilter(item.key)}
                      className={`rounded-xl py-2 text-xs font-bold transition ${
                        filter === item.key ? "bg-[#5d9997] text-white" : "text-stone-500"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}

          {loading ? (
            <StateCard title="読み込み中..." text="確認対象の投稿を取得しています。" />
          ) : loadError ? (
            <StateCard title="読み込みに失敗しました" text={loadError} onRetry={loadData} />
          ) : !isAdmin ? (
            <StateCard title="表示できません" text="この画面は管理者だけが利用できます。" />
          ) : visiblePosts.length === 0 ? (
            <StateCard title="確認対象はありません" text="この条件に当てはまる投稿はありません。" />
          ) : (
            visiblePosts.map((post) => {
              const author = authors[post.user_id] ?? { nickname: "ユーザー", avatarPath: "/avatar_01.png" };
              const stage = moderationStage(post);

              return (
                <article key={post.id} className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full bg-[#f2eadf]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={author.avatarPath} alt="" className="h-full w-full object-cover" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-700">{author.nickname} さん</p>
                        <p className="mt-1 text-xs text-stone-400">{formatDate(post.created_at)}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 text-xs font-bold">
                      <span className="rounded-full bg-red-50 px-3 py-1 text-red-500">通報 {post.reports_count ?? 0}</span>
                      {post.is_hidden && <span className="rounded-full bg-stone-100 px-3 py-1 text-stone-500">非表示</span>}
                      {post.needs_review && <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">確認対象</span>}
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-[#4d8b8a]">{post.category}</span>
                    <span className="text-xs font-bold text-stone-400">いいね {post.likes_count ?? 0}</span>
                  </div>

                  <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-700">{post.body}</p>
                  <p className="mt-3 break-all text-xs text-stone-400">user_id: {post.user_id}</p>

                  <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm leading-6 ${stage.className}`}>
                    <p className="font-bold">{stage.label}</p>
                    <p className="mt-1">{stage.text}</p>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <button
                      onClick={() => moderatePost(post.id, "restore")}
                      disabled={workingId === post.id}
                      className="rounded-xl bg-[#5d9997] py-3 text-xs font-bold text-white disabled:opacity-50"
                    >
                      表示に戻す
                    </button>
                    <button
                      onClick={() => moderatePost(post.id, "hide")}
                      disabled={workingId === post.id}
                      className="rounded-xl bg-stone-100 py-3 text-xs font-bold text-stone-600 disabled:opacity-50"
                    >
                      非表示
                    </button>
                    <button
                      onClick={() => moderatePost(post.id, "delete")}
                      disabled={workingId === post.id}
                      className="rounded-xl bg-red-50 py-3 text-xs font-bold text-red-600 disabled:opacity-50"
                    >
                      削除
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </main>
      </div>
      <Navigation active="community" />
    </div>
  );
}

function StateCard({
  title,
  text,
  onRetry,
}: {
  title: string;
  text: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-2xl bg-white p-5 text-center shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
      <p className="text-base font-bold text-stone-600">{title}</p>
      <p className="mt-2 text-sm leading-6 text-stone-400">{text}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 w-full rounded-xl bg-[#5d9997] py-3 text-sm font-bold text-white"
        >
          再読み込み
        </button>
      )}
      <Link
        href="/community"
        className="mt-4 inline-flex rounded-full bg-stone-100 px-4 py-2 text-sm font-bold text-stone-500"
      >
        ひろばへ戻る
      </Link>
    </div>
  );
}
