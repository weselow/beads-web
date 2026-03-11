/**
 * Zod schemas for validating critical API responses.
 * Only covers endpoints where malformed data causes silent runtime errors.
 */

import { z } from "zod/v4";

export const CommentSchema = z.object({
  id: z.number(),
  issue_id: z.string(),
  author: z.string(),
  text: z.string(),
  created_at: z.string(),
});

export const BeadSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.optional(z.string()),
  status: z.string(),
  priority: z.number(),
  issue_type: z.string(),
  owner: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  comments: z.array(CommentSchema).nullish(),
  parent_id: z.string().nullish(),
  children: z.array(z.string()).nullish(),
  design_doc: z.string().nullish(),
  deps: z.array(z.string()).nullish(),
  blockers: z.array(z.string()).nullish(),
  relates_to: z.array(z.string()).nullish(),
  _originalStatus: z.string().nullish(),
});

export const BeadsResponseSchema = z.object({
  beads: z.array(BeadSchema),
  source: z.string().optional(),
});

export const PRChecksSchema = z.object({
  total: z.number(),
  passed: z.number(),
  failed: z.number(),
  pending: z.number(),
  status: z.enum(["success", "failure", "pending"]),
});

export const PRInfoSchema = z.object({
  number: z.number(),
  url: z.string(),
  state: z.enum(["open", "merged", "closed"]),
  checks: PRChecksSchema,
  mergeable: z.boolean(),
});

export const PRStatusSchema = z.object({
  has_remote: z.boolean(),
  branch_pushed: z.boolean(),
  pr: z.nullable(PRInfoSchema),
  rate_limit: z.object({
    remaining: z.number(),
    limit: z.number(),
    reset_at: z.string(),
  }),
});

export const WorktreeStatusSchema = z.object({
  exists: z.boolean(),
  worktree_path: z.nullable(z.string()),
  branch: z.nullable(z.string()),
  ahead: z.number(),
  behind: z.number(),
  dirty: z.boolean(),
  last_modified: z.nullable(z.string()),
});
