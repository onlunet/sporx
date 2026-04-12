import { z } from "zod";

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.any()).nullable().optional()
});

export const apiMetaSchema = z.record(z.any()).nullable();

export function envelopeSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    success: z.boolean(),
    data: dataSchema,
    meta: apiMetaSchema,
    error: apiErrorSchema.nullable()
  });
}
