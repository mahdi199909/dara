// Shared between src/app/api/projects/**/route.ts (web) and src/local/repositories/projects.ts
// (on-device) so both validate identically — see the Android local-data-layer plan.
import { z } from "zod";
import { PROJECT_STATUSES } from "@/lib/types";

export const createProjectSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  color: z.string().max(20).optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  color: z.string().max(20).optional(),
});
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
