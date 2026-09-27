import { describe, expect, it } from "vitest";

import { isIOSFamilyDevice } from "../../ios-device";

describe("isIOSFamilyDevice", () => {
  it("detects iPhone Safari", () => {
    expect(
      isIOSFamilyDevice({
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
        platform: "iPhone",
        maxTouchPoints: 5,
      }),
    ).toBe(true);
  });

  it("detects an installed iOS web app", () => {
    expect(
      isIOSFamilyDevice({
        userAgent: "Mozilla/5.0 AppleWebKit/605.1.15 Mobile/15E148",
        platform: "iPhone",
        standalone: true,
      }),
    ).toBe(true);
  });

  it("detects iPadOS desktop mode", () => {
    expect(
      isIOSFamilyDevice({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Safari/605.1.15",
        platform: "MacIntel",
        maxTouchPoints: 5,
      }),
    ).toBe(true);
  });

  it("does not treat a desktop Mac as iOS", () => {
    expect(
      isIOSFamilyDevice({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Safari/605.1.15",
        platform: "MacIntel",
        maxTouchPoints: 0,
      }),
    ).toBe(false);
  });

  it("does not treat Android Chrome as iOS", () => {
    expect(
      isIOSFamilyDevice({
        userAgent: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36",
        platform: "Linux armv8l",
        maxTouchPoints: 5,
      }),
    ).toBe(false);
  });

  it("does not treat desktop Chrome as iOS", () => {
    expect(
      isIOSFamilyDevice({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
        platform: "Win32",
        maxTouchPoints: 0,
      }),
    ).toBe(false);
  });
});
