export type NavigatorLike = {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  standalone?: boolean;
  userAgentData?: { platform?: string };
};

/**
 * Detects Apple mobile browsers, including iPadOS desktop-mode user agents.
 * This intentionally combines several signals instead of relying on the UA alone.
 */
export function isIOSFamilyDevice(navigatorLike: NavigatorLike): boolean {
  const userAgent = navigatorLike.userAgent ?? "";
  const platform = navigatorLike.userAgentData?.platform ?? navigatorLike.platform ?? "";
  const maxTouchPoints = navigatorLike.maxTouchPoints ?? 0;

  const classicIOS = /iPad|iPhone|iPod/i.test(userAgent) || /iPad|iPhone|iPod/i.test(platform);
  const iPadOSDesktopMode = /Mac/i.test(platform) && maxTouchPoints > 1;
  const installedIOSWebApp =
    navigatorLike.standalone === true && /AppleWebKit/i.test(userAgent) && !/Android/i.test(userAgent);

  return classicIOS || iPadOSDesktopMode || installedIOSWebApp;
}
