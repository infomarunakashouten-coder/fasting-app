"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Navigation from "@/components/Navigation";
import { hasPremiumAccess } from "@/lib/billing";
import { loadCommunityAuthorRows } from "@/lib/community-authors";
import { createClient, isPaidPlan } from "@/lib/supabase";
import { getUserFacingError } from "@/lib/user-facing-error";
import type { CommunityPost } from "@/types";

type ProfileRow = Record<string, any>;
type AuthorMap = Record<string, { nickname: string; avatarPath: string }>;
type Tab = "posts" | "columns" | "qa" | "glossary";
type Notice = { type: "success" | "error" | "info"; text: string } | null;

const postCategories = ["準備期", "本番期", "回復期", "食事記録", "失敗談", "工夫", "つぶやき"];

const columns = [
  {
    title: "はじめてのファスティング",
    body: "最初は短い期間から始めるのがおすすめです。体調に不安がある日は無理をせず、記録を見ながら自分のペースを探しましょう。",
    locked: false,
  },
  {
    title: "準備食の考え方",
    body: "準備期は胃腸への負担を軽くする期間です。脂っこいもの、砂糖、過度なカフェインを控えめにして、翌日に備えます。",
    locked: false,
  },
  {
    title: "回復食ガイド",
    body: "回復期はファスティング後の大切な期間です。おかゆ、具なし味噌汁、野菜スープなど、消化にやさしい食事から再開します。",
    locked: true,
  },
  {
    title: "AIチェックの使い方",
    body: "食事写真から内容の傾向を確認し、準備食や回復食として負担が少ないかを見直すために使います。",
    locked: true,
  },
];

const qas = [
  {
    category: "開始前",
    question: "初めてなら何日から始めるのがよいですか？",
    answer: "まずは短めの期間から始めるのが現実的です。体調に不安がある場合は、無理な断食ではなく食事を軽く整えるところから始めてください。",
  },
  {
    category: "本番中",
    question: "空腹感が強いときはどうしたらよいですか？",
    answer: "水分をとり、体調を確認してください。強いつらさ、めまい、動悸などがある場合は中止も選択肢です。",
  },
  {
    category: "回復期",
    question: "終わったあとすぐ普通食に戻してよいですか？",
    answer: "急に戻すと胃腸に負担がかかります。消化にやさしいものから少しずつ戻すのがおすすめです。",
  },
  {
    category: "AI",
    question: "AIチェックはカロリーを正確に測れますか？",
    answer: "正確なカロリーや栄養値を保証する機能ではありません。食事内容を見直すための補助として使います。",
  },
];

const glossary = [
  ["準備期", "ファスティング本番に向けて、食事を軽く整える期間です。"],
  ["本番期", "固形食を控え、決めた飲み物や水分を中心に過ごす期間です。"],
  ["回復期", "胃腸にやさしい食事から通常食へ戻していく期間です。"],
  ["酵素ドリンク", "発酵素材を使った飲み物。ファスティング中の飲み物として使われることがあります。"],
  ["準備食", "ファスティング前に食べる、消化にやさしい食事です。"],
  ["回復食", "ファスティング後に食べる、胃腸に負担をかけにくい食事です。"],
];

const noticeClass = {
  success: "bg-teal-50 text-teal-700 border-teal-100",
  error: "bg-red-50 text-red-700 border-red-100",
  info: "bg-stone-50 text-stone-600 border-stone-100",
};

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
  });

export default function CommunityPage() {
  const router = useRouter();
  const supabase = createClient();
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [authors, setAuthors] = useState<AuthorMap>({});
  const [tab, setTab] = useState<Tab>("posts");
  const [category, setCategory] = useState(postCategories[0]);
  const [body, setBody] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [likedPostIds, setLikedPostIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [posting, setPosting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [likingId, setLikingId] = useState<string | null>(null);
  const [reportingId, setReportingId] = useState<string | null>(null);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadData = async () => {
    setLoading(true);
    setLoadError("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/auth/login");
      return;
    }
    setCurrentUserId(user.id);

    const [
      { data: newProfile, error: newProfileError },
      { data: oldProfile, error: oldProfileError },
      { data: postData, error: postError },
    ] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle(),
      supabase.from("community_posts").select("*").order("created_at", { ascending: false }).limit(30),
    ]);

    if (newProfileError && oldProfileError) {
      setLoadError(
        getUserFacingError(
          newProfileError,
          "プロフィール情報を読み込めませんでした。時間をおいて再読み込みしてください。"
        )
      );
      setPosts([]);
      setAuthors({});
      setLikedPostIds(new Set());
      setLoading(false);
      return;
    }

    const profileRow = mergeProfileRows(newProfile, oldProfile);
    if (!profileRow) {
      router.push("/profile/setup");
      return;
    }

    if (postError) {
      const missingTable = postError.message.includes("community_posts") || postError.code === "PGRST205";
      setLoadError(
        missingTable
          ? "投稿用テーブルがまだ作成されていません。Supabaseで community_posts のSQLを実行してください。"
          : getUserFacingError(
              postError,
              "投稿を読み込めませんでした。時間をおいて再読み込みしてください。"
            )
      );
      setPosts([]);
      setAuthors({});
      setLikedPostIds(new Set());
      setLoading(false);
      return;
    }

    const loadedPosts = (postData ?? []).filter((post: CommunityPost) => !post.is_hidden);
    setProfile(profileRow);
    setPosts(loadedPosts);
    await Promise.all([loadAuthors(loadedPosts), loadLikes(loadedPosts, user.id)]);
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

  const loadLikes = async (loadedPosts: CommunityPost[], userId: string) => {
    const postIds = loadedPosts.map((post) => post.id).filter(Boolean);
    if (postIds.length === 0) {
      setLikedPostIds(new Set());
      return;
    }

    const { data, error } = await supabase
      .from("community_post_likes")
      .select("post_id")
      .eq("user_id", userId)
      .in("post_id", postIds);

    if (error) {
      setLikedPostIds(new Set());
      return;
    }

    setLikedPostIds(new Set((data ?? []).map((like: { post_id: string }) => like.post_id)));
  };

  const paid = hasPremiumAccess(profile?.plan_type, profile?.plan);

  const createPost = async () => {
    if (!paid) {
      setNotice({ type: "info", text: "投稿作成は有料プラン機能です。閲覧は無料で使えます。" });
      return;
    }
    if (!body.trim()) {
      setNotice({ type: "info", text: "投稿内容を入力してください。" });
      return;
    }

    setPosting(true);
    setNotice(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setPosting(false);
      router.push("/auth/login");
      return;
    }

    const { error } = await supabase.from("community_posts").insert({
      user_id: user.id,
      category,
      body: body.trim(),
    });

    setPosting(false);

    if (error) {
      const missingTable = error.message.includes("community_posts") || error.code === "PGRST205";
      setNotice({
        type: "error",
        text: missingTable
          ? "投稿用テーブルがまだ作成されていません。Supabaseで community_posts のSQLを実行してください。"
          : getUserFacingError(
              error,
              "投稿できませんでした。時間をおいてもう一度お試しください。"
            ),
      });
      return;
    }

    setNotice({ type: "success", text: "投稿しました。" });
    setBody("");
    loadData();
  };

  const deletePost = async (postId: string) => {
    if (!window.confirm("この投稿を削除しますか？")) return;

    setDeletingId(postId);
    setNotice(null);

    const { error } = await supabase.from("community_posts").delete().eq("id", postId);

    setDeletingId(null);

    if (error) {
      setNotice({
        type: "error",
        text: error.message.includes("row-level security")
          ? "削除権限がまだ設定されていません。Supabaseで community_posts_delete_own ポリシーを追加してください。"
          : getUserFacingError(
              error,
              "投稿を削除できませんでした。時間をおいてもう一度お試しください。"
            ),
      });
      return;
    }

    setPosts((current) => current.filter((post) => post.id !== postId));
    setNotice({ type: "success", text: "投稿を削除しました。" });
  };

  const toggleLike = async (post: CommunityPost) => {
    if (!currentUserId || likingId) return;

    setLikingId(post.id);
    setNotice(null);

    const wasLiked = likedPostIds.has(post.id);
    setLikedPostIds((current) => {
      const next = new Set(current);
      if (wasLiked) next.delete(post.id);
      else next.add(post.id);
      return next;
    });
    setPosts((current) =>
      current.map((item) =>
        item.id === post.id
          ? { ...item, likes_count: Math.max((item.likes_count ?? 0) + (wasLiked ? -1 : 1), 0) }
          : item
      )
    );

    const { data, error } = await supabase.rpc("toggle_community_post_like", { target_post_id: post.id });

    setLikingId(null);

    if (error) {
      setLikedPostIds((current) => {
        const next = new Set(current);
        if (wasLiked) next.add(post.id);
        else next.delete(post.id);
        return next;
      });
      setPosts((current) =>
        current.map((item) =>
          item.id === post.id
            ? { ...item, likes_count: Math.max((item.likes_count ?? 0) + (wasLiked ? 1 : -1), 0) }
            : item
        )
      );
      setNotice({
        type: "error",
        text:
          error.code === "PGRST202" || error.message.includes("toggle_community_post_like")
            ? "いいね機能のSQLがまだ追加されていません。Supabaseで community_post_likes のSQLを実行してください。"
            : getUserFacingError(
                error,
                "いいねを更新できませんでした。時間をおいてもう一度お試しください。"
              ),
      });
      return;
    }

    const result = Array.isArray(data) ? data[0] : data;
    if (result) {
      setLikedPostIds((current) => {
        const next = new Set(current);
        if (result.liked) next.add(post.id);
        else next.delete(post.id);
        return next;
      });
      setPosts((current) =>
        current.map((item) =>
          item.id === post.id ? { ...item, likes_count: result.likes_count ?? item.likes_count } : item
        )
      );
    }
  };

  const reportPost = async (post: CommunityPost) => {
    if (!currentUserId || reportingId) return;
    if (!window.confirm("この投稿を通報しますか？")) return;

    setReportingId(post.id);
    setNotice(null);

    const { data, error } = await supabase.rpc("report_community_post", { target_post_id: post.id });

    setReportingId(null);

    if (error) {
      setNotice({
        type: "error",
        text:
          error.code === "PGRST202" || error.message.includes("report_community_post")
            ? "通報機能のSQLがまだ追加されていません。Supabaseで community_post_reports のSQLを実行してください。"
            : getUserFacingError(
                error,
                "通報できませんでした。時間をおいてもう一度お試しください。"
              ),
      });
      return;
    }

    const result = Array.isArray(data) ? data[0] : data;
    if (result?.already_reported) {
      setNotice({ type: "info", text: "この投稿はすでに通報済みです。" });
      return;
    }

    if (result?.is_hidden) {
      setPosts((current) => current.filter((item) => item.id !== post.id));
      setNotice({ type: "success", text: "通報を受け付けました。この投稿は確認のため一時的に非表示になりました。" });
      return;
    }

    setPosts((current) =>
      current.map((item) =>
        item.id === post.id ? { ...item, reports_count: result?.reports_count ?? item.reports_count } : item
      )
    );
    setNotice({ type: "success", text: "通報を受け付けました。" });
  };

  return (
    <div className="min-h-screen bg-[#f3f0ea] pb-24 text-slate-900">
      <div className="mx-auto min-h-screen max-w-[430px] bg-[#f7f4ee] shadow-[0_0_0_1px_rgba(0,0,0,0.03)]">
        <header className="border-b border-stone-200 bg-white px-6 py-8">
          <h1 className="text-3xl font-bold tracking-normal">ひろば</h1>
          <p className="mt-2 text-base text-stone-400">投稿・コラム・Q&A・用語集</p>
        </header>

        <main className="space-y-5 px-5 py-6">
          <section className="rounded-2xl bg-white p-2 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
            <div className="grid grid-cols-4 gap-1">
              {[
                ["posts", "投稿"],
                ["columns", "コラム"],
                ["qa", "Q&A"],
                ["glossary", "用語"],
              ].map(([key, label]) => (
                <button key={key} onClick={() => setTab(key as Tab)} className={`rounded-xl py-2 text-xs font-bold transition ${tab === key ? "bg-[#5d9997] text-white" : "text-stone-500"}`}>
                  {label}
                </button>
              ))}
            </div>
          </section>

          {notice && <p className={`rounded-xl border px-3 py-2 text-sm ${noticeClass[notice.type]}`}>{notice.text}</p>}

          {tab === "posts" && (
            <>
              <section className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold">みんなの投稿</h2>
                    <p className="mt-1 text-sm text-stone-400">ニックネームとアイコンで表示されます</p>
                  </div>
                  {!paid && <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-bold text-stone-500">閲覧のみ</span>}
                </div>

                {paid ? (
                  <div className="mt-4 space-y-3">
                    <select value={category} onChange={(event) => setCategory(event.target.value)} className="w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-base outline-none focus:border-[#5d9997] focus:ring-2 focus:ring-teal-100">
                      {postCategories.map((item) => <option key={item}>{item}</option>)}
                    </select>
                    <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={4} className="w-full resize-none rounded-xl border border-stone-200 bg-white px-4 py-3 text-base outline-none focus:border-[#5d9997] focus:ring-2 focus:ring-teal-100" placeholder="今日の気づき、うまくいった工夫、つまずいたことなど..." maxLength={300} />
                    <div className="flex items-center justify-between text-xs text-stone-400">
                      <span>{profile?.nickname ?? "あなた"} さんとして投稿されます</span>
                      <span>{body.length}/300</span>
                    </div>
                    <button onClick={createPost} disabled={posting} className="w-full rounded-xl bg-[#5d9997] py-3 text-base font-bold text-white disabled:opacity-60">
                      {posting ? "投稿中..." : "投稿する"}
                    </button>
                  </div>
                ) : (
                  <LockedInline text="投稿作成は有料プラン機能です。投稿の閲覧はこのまま使えます。" />
                )}
              </section>

              <section className="space-y-3">
                {loading ? (
                  <EmptyState title="読み込み中..." description="投稿を確認しています。" />
                ) : loadError ? (
                  <EmptyState title="投稿を読み込めませんでした" description={loadError}>
                    <button
                      type="button"
                      onClick={loadData}
                      className="mt-4 w-full rounded-xl bg-[#5d9997] py-3 text-sm font-bold text-white"
                    >
                      再読み込み
                    </button>
                  </EmptyState>
                ) : posts.length === 0 ? (
                  <EmptyState title="まだ投稿がありません" description="最初の投稿が作成されると、ここに表示されます。" />
                ) : (
                  posts.map((post) => {
                    const author = authors[post.user_id] ?? { nickname: "ユーザー", avatarPath: "/avatar_01.png" };
                    const liked = likedPostIds.has(post.id);

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
                              <p className="text-xs text-stone-400">{formatDate(post.created_at)}</p>
                            </div>
                          </div>
                          <span className="shrink-0 rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-[#4d8b8a]">{post.category}</span>
                        </div>
                        <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-700">{post.body}</p>
                        <div className="mt-3 flex items-center justify-between gap-3 text-xs font-bold text-stone-400">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => toggleLike(post)}
                              disabled={likingId === post.id}
                              className={`rounded-full px-3 py-1 transition disabled:opacity-60 ${
                                liked ? "bg-rose-50 text-rose-500" : "bg-stone-50 text-stone-400"
                              }`}
                            >
                              {liked ? "♥ いいね" : "♡ いいね"} {post.likes_count ?? 0}
                            </button>
                            {post.user_id !== currentUserId && (
                              <button onClick={() => reportPost(post)} disabled={reportingId === post.id} className="rounded-full bg-stone-50 px-3 py-1 text-stone-400 disabled:opacity-50">
                                {reportingId === post.id ? "通報中..." : "通報"}
                              </button>
                            )}
                          </div>
                          {post.user_id === currentUserId && (
                            <button onClick={() => deletePost(post.id)} disabled={deletingId === post.id} className="rounded-full bg-stone-50 px-3 py-1 text-stone-400 disabled:opacity-50">
                              {deletingId === post.id ? "削除中..." : "削除"}
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })
                )}
              </section>
            </>
          )}

          {tab === "columns" && (
            <section className="space-y-3">
              {columns.map((column) => {
                const locked = column.locked && !paid;
                return (
                  <article key={column.title} className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-lg font-bold">{column.title}</h2>
                      {locked && <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">有料</span>}
                    </div>
                    <p className="mt-3 text-sm leading-6 text-stone-500">{locked ? "有料プランで全文を読めます。" : column.body}</p>
                    {locked && <Link href="/settings" className="mt-3 inline-block text-sm font-bold text-[#5d9997]">プランを確認する</Link>}
                  </article>
                );
              })}
            </section>
          )}

          {tab === "qa" && (
            <section className="space-y-3">
              {qas.map((qa) => (
                <article key={qa.question} className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
                  <p className="text-xs font-bold text-[#4d8b8a]">{qa.category}</p>
                  <h2 className="mt-2 text-base font-bold">{qa.question}</h2>
                  <p className="mt-2 text-sm leading-6 text-stone-500">{qa.answer}</p>
                </article>
              ))}
            </section>
          )}

          {tab === "glossary" && (
            <section className="rounded-2xl bg-white p-5 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
              <div className="divide-y divide-stone-100">
                {glossary.map(([term, description]) => (
                  <div key={term} className="py-4 first:pt-0 last:pb-0">
                    <h2 className="text-base font-bold">{term}</h2>
                    <p className="mt-1 text-sm leading-6 text-stone-500">{description}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </main>
      </div>

      <Navigation active="community" />
    </div>
  );
}

function EmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-white p-5 text-center text-sm text-stone-400 shadow-[0_12px_28px_rgba(120,104,80,0.08)]">
      <p className="text-base font-bold text-stone-500">{title}</p>
      <p className="mt-2 leading-6">{description}</p>
      {children}
    </div>
  );
}

function LockedInline({ text }: { text: string }) {
  return (
    <div className="mt-4 rounded-xl bg-stone-50 p-4 text-sm leading-6 text-stone-500">
      <p>{text}</p>
      <p className="mt-2 font-bold text-slate-700">本格ファスティングAIプラン・月額1,980円</p>
      <Link href="/premium" className="mt-3 inline-block font-bold text-[#5d9997]">
        機能と料金を見る
      </Link>
    </div>
  );
}
