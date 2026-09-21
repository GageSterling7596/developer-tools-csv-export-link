import { infrai } from "./infrai.js";
import { type ExportRequest, exportRequestSchema } from "./export_types.js";

export type ExportDecision = {
  summary: {
    releaseStatus: "ready_to_cutover" | "hold_cutover";
    rollbackSuggested: boolean;
    checklist: string[];
  };
  objectKey: string;
  downloadUrl: string;
  csv: string;
};

export interface StoragePort {
  ensureBucket(name: string): Promise<void>;
  putCsv(bucket: string, key: string, csv: string, idempotencyKey: string): Promise<void>;
  createDownloadLink(bucket: string, key: string, fileName: string, idempotencyKey: string): Promise<string>;
}

export class InfraiStoragePort implements StoragePort {
  async ensureBucket(name: string): Promise<void> {
    await infrai.storage.bucket.create({ name });
  }

  async putCsv(bucket: string, key: string, csv: string, idempotencyKey: string): Promise<void> {
    await infrai.storage.object.put(bucket, key, {
      data_base64: Buffer.from(csv, "utf8").toString("base64"),
      content_type: "text/csv",
      idempotency_key: idempotencyKey
    });
  }

  async createDownloadLink(bucket: string, key: string, fileName: string, idempotencyKey: string): Promise<string> {
    const { data } = await infrai.storage.object.presign(bucket, key, {
      op: "get",
      expires_seconds: 900,
      response_disposition: `attachment; filename=\"${fileName}\"`,
      idempotency_key: idempotencyKey
    });
    return data.url;
  }
}

export function decideCutover(request: ExportRequest): ExportDecision["summary"] {
  const failedBuilds = request.buildEvents.filter((build) => build.status === "failed").length;
  const blockingRelease = request.releaseOperations.some((release) => release.result === "blocked");
  const errorDiagnostics = request.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warnDiagnostics = request.diagnostics.filter((diagnostic) => diagnostic.severity === "warn").length;

  const releaseStatus = failedBuilds === 0 && !blockingRelease && errorDiagnostics === 0 ? "ready_to_cutover" : "hold_cutover";
  const rollbackSuggested = blockingRelease || errorDiagnostics > 0;

  const checklist = [
    "Export the final release report and share the signed download link with the migration channel.",
    "Confirm the incumbent presign path is no longer referenced by the developer tools UI.",
    "Verify the latest production release has no blocked operation before cutover.",
    rollbackSuggested
      ? "Keep the rollback path active: switch downloads back to the incumbent signer if diagnostics stay red."
      : "Rollback path stays documented only: switch downloads back to the incumbent signer if a later release turns red.",
    warnDiagnostics > 0
      ? "Review warning diagnostics after the export; they do not block the CSV handoff."
      : "No warning diagnostics remain in this export window."
  ];

  return { releaseStatus, rollbackSuggested, checklist };
}

export function buildCsv(request: ExportRequest, summary: ExportDecision["summary"]): string {
  const lines: string[] = [];
  lines.push("section,id,status_or_result,timestamp,details");

  for (const build of request.buildEvents) {
    lines.push([
      "build",
      escapeCsv(build.buildId),
      escapeCsv(build.status),
      escapeCsv(build.finishedAt),
      escapeCsv(`durationMs=${build.durationMs};commitSha=${build.commitSha}`)
    ].join(","));
  }

  for (const release of request.releaseOperations) {
    lines.push([
      "release",
      escapeCsv(release.releaseId),
      escapeCsv(release.result),
      escapeCsv(release.deployedAt),
      escapeCsv(`environment=${release.environment};operator=${release.operator}`)
    ].join(","));
  }

  for (const diagnostic of request.diagnostics) {
    lines.push([
      "diagnostic",
      escapeCsv(diagnostic.code),
      escapeCsv(diagnostic.severity),
      escapeCsv(request.requestedAt),
      escapeCsv(diagnostic.message)
    ].join(","));
  }

  lines.push([
    "decision",
    escapeCsv(request.exportId),
    escapeCsv(summary.releaseStatus),
    escapeCsv(request.requestedAt),
    escapeCsv(`rollbackSuggested=${summary.rollbackSuggested}`)
  ].join(","));

  return lines.join("\n") + "\n";
}

function escapeCsv(value: string | number | boolean): string {
  const text = String(value);
  if (text.includes(",") || text.includes("\n") || text.includes("\"")) {
    return `\"${text.replaceAll("\"", "\"\"")}\"`;
  }
  return text;
}

export async function exportDiagnosticsReport(
  rawInput: unknown,
  storage: StoragePort,
  bucket: string
): Promise<ExportDecision> {
  const request = exportRequestSchema.parse(rawInput);
  const summary = decideCutover(request);
  const csv = buildCsv(request, summary);
  const objectKey = `exports/${request.workspaceId}/${request.exportId}.csv`;
  const fileName = `${request.workspaceId}-${request.exportId}.csv`;
  const idempotencyKey = `${request.workspaceId}:${request.exportId}`;

  await storage.ensureBucket(bucket);
  await storage.putCsv(bucket, objectKey, csv, idempotencyKey);
  const downloadUrl = await storage.createDownloadLink(bucket, objectKey, fileName, idempotencyKey);

  return {
    summary,
    objectKey,
    downloadUrl,
    csv
  };
}
