import { z } from "zod";

export const buildEventSchema = z.object({
  buildId: z.string().min(1),
  status: z.enum(["passed", "failed"]),
  durationMs: z.number().int().nonnegative(),
  finishedAt: z.string().datetime(),
  commitSha: z.string().min(7)
});

export const releaseOperationSchema = z.object({
  releaseId: z.string().min(1),
  environment: z.enum(["staging", "production"]),
  result: z.enum(["succeeded", "blocked", "rolled_back"]),
  deployedAt: z.string().datetime(),
  operator: z.string().min(1)
});

export const diagnosticSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(["info", "warn", "error"]),
  message: z.string().min(1),
  buildId: z.string().optional(),
  releaseId: z.string().optional()
});

export const exportRequestSchema = z.object({
  exportId: z.string().min(1),
  workspaceId: z.string().min(1),
  requestedAt: z.string().datetime(),
  buildEvents: z.array(buildEventSchema).min(1),
  releaseOperations: z.array(releaseOperationSchema).min(1),
  diagnostics: z.array(diagnosticSchema),
  requestedBy: z.string().min(1)
});

export type ExportRequest = z.infer<typeof exportRequestSchema>;
