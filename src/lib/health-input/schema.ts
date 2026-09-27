import { z } from "zod";

export const HEALTH_TIMEZONE = "Asia/Tokyo" as const;
export const AI_CONSENT_VERSION = "2026-09-12" as const;
export const MAX_HEALTH_TEXT_LENGTH = 1_000;
export const MAX_HEALTH_ENTRIES = 8;

export const healthEntryTypeSchema = z.enum([
  "weight",
  "body_fat",
  "period_start",
]);

export const healthUnitSchema = z.enum(["kg", "%"]);

export const healthIssueCodeSchema = z.enum([
  "missing_value",
  "invalid_unit",
  "out_of_range",
  "ambiguous_date",
  "invalid_date",
  "invalid_entry_shape",
]);

export const modelHealthEntrySchema = z
  .object({
    type: healthEntryTypeSchema,
    date_expression: z.string().trim().max(80).nullable(),
    value: z.number().finite().min(-10_000).max(10_000).nullable(),
    unit: healthUnitSchema.nullable(),
  })
  .strict();

export const modelHealthParseSchema = z
  .object({
    entries: z.array(modelHealthEntrySchema).max(MAX_HEALTH_ENTRIES),
    has_unsupported_content: z.boolean(),
  })
  .strict();

export const healthEntrySchema = z
  .object({
    type: healthEntryTypeSchema,
    occurredOn: z.string().date().nullable(),
    value: z.number().finite().min(-10_000).max(10_000).nullable(),
    unit: healthUnitSchema.nullable(),
    needsConfirmation: z.boolean(),
    issues: z.array(healthIssueCodeSchema),
  })
  .strict();

export const healthParseResponseSchema = z
  .object({
    entries: z.array(healthEntrySchema).max(MAX_HEALTH_ENTRIES),
    hasUnsupportedContent: z.boolean(),
    referenceDate: z.string().date(),
    timezone: z.literal(HEALTH_TIMEZONE),
  })
  .strict();

export const healthParseRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(MAX_HEALTH_TEXT_LENGTH),
    consentVersion: z.literal(AI_CONSENT_VERSION),
  })
  .strict();

export const transcriptionResponseSchema = z
  .object({
    text: z.string().trim().min(1).max(MAX_HEALTH_TEXT_LENGTH),
  })
  .strict();

export type ModelHealthParse = z.infer<typeof modelHealthParseSchema>;
export type HealthEntry = z.infer<typeof healthEntrySchema>;
export type HealthIssueCode = z.infer<typeof healthIssueCodeSchema>;
export type HealthParseResponse = z.infer<typeof healthParseResponseSchema>;
