import { describe, expect, it } from "vitest";

import {
  isHealthInputDiagnosticsEnabled,
  isHealthInputEnabled,
  type HealthInputFeatureContext,
} from "../feature-flags";

describe("health input feature flags", () => {
  it("ProductionをDevelopmentのNODE_ENVより優先して拒否する", () => {
    expect(isHealthInputEnabled({
      flag: "true",
      deploymentEnvironment: "production",
      nodeEnvironment: "development",
    })).toBe(false);
  });
  it.each<{
    name: string;
    context: HealthInputFeatureContext;
    expected: boolean;
  }>([
    {
      name: "Production + false",
      context: {
        flag: "false",
        deploymentEnvironment: "production",
        nodeEnvironment: "production",
      },
      expected: false,
    },
    {
      name: "Production + true",
      context: {
        flag: "true",
        deploymentEnvironment: "production",
        nodeEnvironment: "production",
      },
      expected: false,
    },
    {
      name: "Preview + true",
      context: {
        flag: "true",
        deploymentEnvironment: "preview",
        nodeEnvironment: "production",
      },
      expected: true,
    },
    {
      name: "Preview + false",
      context: {
        flag: "false",
        deploymentEnvironment: "preview",
        nodeEnvironment: "production",
      },
      expected: false,
    },
    {
      name: "Preview + unset",
      context: {
        flag: undefined,
        deploymentEnvironment: "preview",
        nodeEnvironment: "production",
      },
      expected: false,
    },
    {
      name: "Development + true",
      context: {
        flag: "true",
        deploymentEnvironment: "development",
        nodeEnvironment: "development",
      },
      expected: true,
    },
  ])("$name のUI/API可否を $expected にする", ({ context, expected }) => {
    expect(isHealthInputEnabled(context)).toBe(expected);
  });

  it("診断表示は有効なPreview/Developmentかつ診断flagがtrueの場合だけ許可する", () => {
    expect(
      isHealthInputDiagnosticsEnabled({
        flag: "true",
        diagnosticsFlag: "true",
        deploymentEnvironment: "preview",
        nodeEnvironment: "production",
      }),
    ).toBe(true);
    expect(
      isHealthInputDiagnosticsEnabled({
        flag: "true",
        diagnosticsFlag: "true",
        deploymentEnvironment: "production",
        nodeEnvironment: "production",
      }),
    ).toBe(false);
    expect(
      isHealthInputDiagnosticsEnabled({
        flag: "true",
        diagnosticsFlag: "false",
        deploymentEnvironment: "preview",
        nodeEnvironment: "production",
      }),
    ).toBe(false);
  });
});
