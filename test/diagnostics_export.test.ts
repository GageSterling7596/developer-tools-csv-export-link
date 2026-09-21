import test from "node:test";
import assert from "node:assert/strict";
import { decideCutover, exportDiagnosticsReport, type StoragePort } from "../src/diagnostics_export.js";

class MemoryStorage implements StoragePort {
  ensuredBuckets: string[] = [];
  writes: Array<{ bucket: string; key: string; csv: string; idempotencyKey: string }> = [];

  async ensureBucket(name: string): Promise<void> {
    this.ensuredBuckets.push(name);
  }

  async putCsv(bucket: string, key: string, csv: string, idempotencyKey: string): Promise<void> {
    this.writes.push({ bucket, key, csv, idempotencyKey });
  }

  async createDownloadLink(bucket: string, key: string): Promise<string> {
    return `https://downloads.example/${bucket}/${key}`;
  }
}

test("decideCutover holds cutover and suggests rollback when diagnostics include an error", () => {
  const summary = decideCutover({
    exportId: "exp-1",
    workspaceId: "agent-platform",
    requestedAt: "2026-04-15T10:30:00.000Z",
    requestedBy: "release-bot",
    buildEvents: [
      {
        buildId: "build-1",
        status: "passed",
        durationMs: 120000,
        finishedAt: "2026-04-15T10:00:00.000Z",
        commitSha: "7ac41ef"
      }
    ],
    releaseOperations: [
      {
        releaseId: "rel-1",
        environment: "production",
        result: "succeeded",
        deployedAt: "2026-04-15T10:10:00.000Z",
        operator: "release-bot"
      }
    ],
    diagnostics: [
      {
        code: "MIGRATION_CHECK_FAILED",
        severity: "error",
        message: "The incumbent signer still appears in one path.",
        releaseId: "rel-1"
      }
    ]
  });

  assert.equal(summary.releaseStatus, "hold_cutover");
  assert.equal(summary.rollbackSuggested, true);
});

test("exportDiagnosticsReport writes CSV and returns a download link for a clean cutover report", async () => {
  const storage = new MemoryStorage();
  const result = await exportDiagnosticsReport({
    exportId: "exp-2",
    workspaceId: "agent-platform",
    requestedAt: "2026-04-15T10:30:00.000Z",
    requestedBy: "release-bot",
    buildEvents: [
      {
        buildId: "build-2",
        status: "passed",
        durationMs: 110000,
        finishedAt: "2026-04-15T10:00:00.000Z",
        commitSha: "7ac41ef"
      }
    ],
    releaseOperations: [
      {
        releaseId: "rel-2",
        environment: "production",
        result: "succeeded",
        deployedAt: "2026-04-15T10:10:00.000Z",
        operator: "release-bot"
      }
    ],
    diagnostics: []
  }, storage, "developer-tools-exports");

  assert.equal(result.summary.releaseStatus, "ready_to_cutover");
  assert.equal(result.downloadUrl, "https://downloads.example/developer-tools-exports/exports/agent-platform/exp-2.csv");
  assert.equal(storage.ensuredBuckets[0], "developer-tools-exports");
  assert.equal(storage.writes[0]?.idempotencyKey, "agent-platform:exp-2");
  assert.match(storage.writes[0]?.csv ?? "", /decision,exp-2,ready_to_cutover/);
});
