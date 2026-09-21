import { exportDiagnosticsReport, InfraiStoragePort } from "./diagnostics_export.js";

const bucket = process.env.EXPORT_BUCKET ?? "developer-tools-exports";

const exampleRequest = {
  exportId: "cutover-2026-04-15",
  workspaceId: "agent-platform",
  requestedAt: "2026-04-15T10:30:00.000Z",
  requestedBy: "release-bot",
  buildEvents: [
    {
      buildId: "build-1842",
      status: "passed",
      durationMs: 182000,
      finishedAt: "2026-04-15T10:10:00.000Z",
      commitSha: "7ac41ef"
    }
  ],
  releaseOperations: [
    {
      releaseId: "rel-900",
      environment: "production",
      result: "succeeded",
      deployedAt: "2026-04-15T10:20:00.000Z",
      operator: "release-bot"
    }
  ],
  diagnostics: [
    {
      code: "TRACE_SAMPLING_REDUCED",
      severity: "warn",
      message: "Sampling was reduced for one canary shard.",
      releaseId: "rel-900"
    }
  ]
};

const result = await exportDiagnosticsReport(exampleRequest, new InfraiStoragePort(), bucket);

console.log(JSON.stringify({
  releaseStatus: result.summary.releaseStatus,
  rollbackSuggested: result.summary.rollbackSuggested,
  checklist: result.summary.checklist,
  downloadUrl: result.downloadUrl,
  objectKey: result.objectKey
}, null, 2));
