"use client";

import { useEffect, useRef, useState } from "react";

type NetworkState = "online" | "offline" | "restored";

export default function NetworkStatus() {
  const [networkState, setNetworkState] = useState<NetworkState>("online");
  const wasOffline = useRef(false);

  useEffect(() => {
    let restoredTimer: ReturnType<typeof setTimeout> | null = null;

    const handleOffline = () => {
      if (restoredTimer) clearTimeout(restoredTimer);
      wasOffline.current = true;
      setNetworkState("offline");
    };

    const handleOnline = () => {
      if (!wasOffline.current) {
        setNetworkState("online");
        return;
      }

      setNetworkState("restored");
      restoredTimer = setTimeout(() => {
        setNetworkState("online");
        wasOffline.current = false;
      }, 3500);
    };

    if (!navigator.onLine) handleOffline();
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      if (restoredTimer) clearTimeout(restoredTimer);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  if (networkState === "online") return null;

  const offline = networkState === "offline";

  return (
    <div
      role={offline ? "alert" : "status"}
      aria-live={offline ? "assertive" : "polite"}
      className={`network-status fixed left-1/2 z-[100] w-[calc(100%-2rem)] max-w-[398px] -translate-x-1/2 rounded-xl px-4 py-3 text-center text-sm font-bold shadow-lg ${
        offline
          ? "border border-amber-200 bg-amber-50 text-amber-900"
          : "border border-teal-200 bg-teal-50 text-teal-800"
      }`}
    >
      {offline
        ? "オフラインです。入力内容を確認し、接続後に保存してください。"
        : "通信が復旧しました。保存操作を再開できます。"}
    </div>
  );
}
