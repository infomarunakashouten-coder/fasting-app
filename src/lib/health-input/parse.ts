import { getTokyoReference } from "./date";
import {
  healthParseRequestSchema,
  modelHealthParseSchema,
  type ModelHealthParse,
} from "./schema";
import { validateAndNormalizeHealthParse } from "./validation";

export type HealthParseContext = ReturnType<typeof getTokyoReference>;

export interface HealthParseProvider {
  parse(text: string, context: HealthParseContext): Promise<unknown>;
}

export class HealthParseError extends Error {
  constructor(
    public readonly code:
      | "INVALID_INPUT"
      | "INVALID_AI_OUTPUT"
      | "NO_SUPPORTED_ENTRIES"
      | "AI_UNAVAILABLE",
  ) {
    super(code);
    this.name = "HealthParseError";
  }
}

export async function parseHealthText(
  input: unknown,
  provider: HealthParseProvider,
  now = new Date(),
) {
  const request = healthParseRequestSchema.safeParse(input);
  if (!request.success) {
    throw new HealthParseError("INVALID_INPUT");
  }

  const context = getTokyoReference(now);
  let rawOutput: unknown;
  try {
    rawOutput = await provider.parse(request.data.text, context);
  } catch (error) {
    if (error instanceof HealthParseError) throw error;
    throw new HealthParseError("AI_UNAVAILABLE");
  }

  const modelResult = modelHealthParseSchema.safeParse(rawOutput);
  if (!modelResult.success) {
    throw new HealthParseError("INVALID_AI_OUTPUT");
  }

  const normalized = validateAndNormalizeHealthParse(
    modelResult.data as ModelHealthParse,
    context.referenceDate,
    request.data.text,
  );
  if (normalized.entries.length === 0) {
    throw new HealthParseError("NO_SUPPORTED_ENTRIES");
  }
  return normalized;
}
