export type HealthInputFeatureContext = {
  flag: string | undefined;
  deploymentEnvironment: string | undefined;
  nodeEnvironment: string | undefined;
};

export function isHealthInputEnabled({
  flag,
  deploymentEnvironment,
  nodeEnvironment,
}: HealthInputFeatureContext): boolean {
  if (deploymentEnvironment === "production" || flag !== "true") return false;
  return deploymentEnvironment === "preview" || nodeEnvironment === "development";
}

export function isHealthInputDiagnosticsEnabled(
  context: HealthInputFeatureContext & { diagnosticsFlag: string | undefined },
): boolean {
  return isHealthInputEnabled(context) && context.diagnosticsFlag === "true";
}
