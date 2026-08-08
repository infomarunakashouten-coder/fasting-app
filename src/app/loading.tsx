export default function Loading() {
  return (
    <div className="min-h-screen bg-[#f5f1eb] px-5 py-10">
      <main className="mx-auto flex min-h-[calc(100vh-80px)] max-w-[430px] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-pulse rounded-full bg-[#8db9b5]" />
          <p className="mt-4 text-sm font-bold text-stone-400">読み込み中...</p>
        </div>
      </main>
    </div>
  );
}
