import { createServer } from "node:http";
import { InfraiError } from "./infrai.js";
import { exportDiagnosticsReport, InfraiStoragePort } from "./diagnostics_export.js";

const PORT = Number(process.env.PORT ?? "3000");
const EXPORT_BUCKET = process.env.EXPORT_BUCKET ?? "developer-tools-exports";

const storage = new InfraiStoragePort();

function sendJson(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body, null, 2));
}

createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/exports/developer-diagnostics") {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  try {
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const result = await exportDiagnosticsReport(input, storage, EXPORT_BUCKET);
    sendJson(res, 201, {
      exportId: input.exportId,
      releaseStatus: result.summary.releaseStatus,
      rollbackSuggested: result.summary.rollbackSuggested,
      checklist: result.summary.checklist,
      downloadUrl: result.downloadUrl,
      objectKey: result.objectKey
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return;
    }

    if (error instanceof InfraiError) {
      sendJson(res, error.status >= 400 && error.status < 500 ? error.status : 502, {
        error: error.code,
        message: error.message
      });
      return;
    }

    if (error instanceof Error && error.name === "ZodError") {
      sendJson(res, 400, { error: "Invalid export request", message: error.message });
      return;
    }

    sendJson(res, 500, { error: "Internal server error" });
  }
}).listen(PORT, () => {
  console.log(`developer diagnostics export server listening on http://localhost:${PORT}`);
});
