import { z } from 'zod';

// Zod's JIT would probe `new Function`, which a strict Content Security Policy reports as a violation.
// Validation here is not a hot path, so run without it and never touch eval (SEC-2).
z.config({ jitless: true });

/** Identifiers become folder and file names, so they are restricted to a safe alphabet. */
export const idSchema = z.string().regex(/^[A-Za-z0-9-]{1,64}$/, 'invalid id');

/** Paths inside a project package: relative, no traversal, no odd characters. */
export const relativePathSchema = z
  .string()
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, 'invalid path')
  .refine(
    (p) => !p.split('/').some((part) => part === '' || part === '.' || part === '..'),
    'invalid path',
  );

/** An ordered collection (see ordered.ts) whose map keys must equal the item ids. */
export function orderedSchema<T extends z.ZodType<{ id: string; key: string }>>(item: T) {
  return z
    .strictObject({ byId: z.record(idSchema, item) })
    .refine(
      (collection) => Object.entries(collection.byId).every(([id, value]) => id === value.id),
      'id mismatch',
    );
}
