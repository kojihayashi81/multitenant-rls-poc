import { z } from 'zod';

export const postIdParamSchema = z.object({
  id: z.uuidv7('Invalid UUIDv7'),
});

export const createPostBodySchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().nullish(),
  userId: z.uuidv7('Invalid UUIDv7'),
});

export const updatePostBodySchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    body: z.string().nullish(),
  })
  .refine(
    (data) => data.title !== undefined || data.body !== undefined,
    { message: 'At least one of "title" or "body" must be provided' },
  );

export type CreatePostBody = z.infer<typeof createPostBodySchema>;
export type UpdatePostBody = z.infer<typeof updatePostBodySchema>;
