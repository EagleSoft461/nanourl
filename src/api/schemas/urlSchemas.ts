import { z } from 'zod';
import { CreateURLRequest } from '../../domain/url';

const urlSchema = z
  .string()
  .trim()
  .max(2048, 'Must be at most 2048 characters')
  .url('Must be a valid URL')
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Must use http or https');

const aliasSchema = z
  .string()
  .trim()
  .min(6, 'Must be at least 6 characters')
  .max(20, 'Must be at most 20 characters')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Must contain only letters, numbers, hyphens, or underscores');

const expiresInSchema = z
  .number()
  .int('Must be an integer')
  .min(60, 'Must be at least 60 seconds')
  .max(31_536_000, 'Must be at most 31536000 seconds');

export const createUrlSchema = z
  .object({
    url: urlSchema,
    customAlias: aliasSchema.optional(),
    custom_alias: aliasSchema.optional(),
    expiresIn: expiresInSchema.optional(),
    expires_in: expiresInSchema.optional(),
    password: z.string().min(8).max(72).optional(),
    utmSource: z.string().max(100).optional(),
    utm_source: z.string().max(100).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.customAlias && value.custom_alias && value.customAlias !== value.custom_alias) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['custom_alias'],
        message: 'Must match customAlias when both are provided',
      });
    }

    if (value.expiresIn && value.expires_in && value.expiresIn !== value.expires_in) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expires_in'],
        message: 'Must match expiresIn when both are provided',
      });
    }
  })
  .transform((value): CreateURLRequest => ({
    url: value.url,
    customAlias: value.customAlias ?? value.custom_alias,
    expiresIn: value.expiresIn ?? value.expires_in,
    password: value.password,
    utmSource: value.utmSource ?? value.utm_source,
  }));

export type CreateUrlInput = z.input<typeof createUrlSchema>;
