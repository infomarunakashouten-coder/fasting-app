"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem =
  | "dashboard"
  | "record"
  | "fasting"
  | "community"
  | "settings"
  | "graph"
  | "premium";

const NAV_ITEMS: {
  key: NavItem;
  href: string;
  icon: string;
  label: string;
}[] = [
  { key: "dashboard", href: "/dashboard", icon: "🏠", label: "ホーム" },
  { key: "record", href: "/record", icon: "⚖️", label: "体重" },
  { key: "fasting", href: "/fasting", icon: "🌿", label: "ファスティング" },
  { key: "community", href: "/community", icon: "👥", label: "ひろば" },
  { key: "settings", href: "/settings", icon: "⚙️", label: "設定" },
];

export default function Navigation({ active }: { active: NavItem }) {
  const pathname = usePathname();

  return (
    <>
      {pathname !== "/feedback" && (
        <div className="pointer-events-none fixed bottom-[76px] left-0 right-0 z-40 mx-auto flex max-w-[430px] justify-end px-4">
          <Link
            href={`/feedback?from=${encodeURIComponent(pathname)}`}
            className="pointer-events-auto rounded-full border border-teal-200 bg-white/95 px-3 py-2 text-xs font-bold text-teal-700 shadow-sm backdrop-blur"
          >
            不具合報告
          </Link>
        </div>
      )}
      <nav className="safe-bottom fixed bottom-0 left-0 right-0 z-50 border-t border-stone-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[430px] items-stretch">
          {NAV_ITEMS.map((item) => {
            const isActive = active === item.key;

            return (
              <Link
                key={item.key}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={`flex min-h-[58px] min-w-0 flex-1 flex-col items-center justify-center gap-1 px-0.5 py-2 transition-all ${
                  isActive ? "text-teal-600" : "text-stone-400 hover:text-stone-600"
                }`}
              >
                <span className="text-2xl leading-none" aria-hidden="true">
                  {item.icon}
                </span>
                <span
                  className={`whitespace-nowrap font-bold leading-none ${
                    item.key === "fasting" ? "text-[9px]" : "text-[10px]"
                  }`}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
