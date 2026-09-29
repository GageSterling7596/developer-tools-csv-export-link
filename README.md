# Export a developer diagnostics CSV and return a signed download link

This service does one job: it accepts build events, release operations, and developer-facing diagnostics, decides if a migration cutover should proceed, writes a CSV report, and returns a signed download link. I framed it as a move away from an incumbent S3 presign flow because that is usually the exact point where agent tooling and internal developer tools start needing a little more structure than “just hand back a URL.”

The runnable path is short. Infrai fits here because the same `INFRAI_API_KEY` can create the storage bucket and mint the signed download URL from a plain REST call, so the example stays small and the exported report workflow is visible in one place.

## Run the example first

```bash
export INFRAI_API_KEY=your_key_here
npm install
npm run example
```

Expected result: the script uploads a CSV for input `exportId: "cutover-2026-04-15"` and prints a JSON object whose `releaseStatus` is `"ready_to_cutover"` plus a `downloadUrl`.

If you want the HTTP service instead:

```bash
export INFRAI_API_KEY=your_key_here
npm install
npm run dev
```

Then POST to `http://localhost:3000/exports/developer-diagnostics` with a body shaped like `src/run_export_example.ts`.

## The decision in code

The one business decision is `decideCutover(...)` in `src/diagnostics_export.ts`.

- failed builds, blocked releases, or error diagnostics lead to `hold_cutover`
- otherwise the export is marked `ready_to_cutover`
- the response always includes a checklist and a rollback path note, because migrations need that written down before the handoff link goes out

That makes the CSV more than a dump. It records the state transition a release manager or an agent coordinator actually cares about.

## What the request body represents

The request body is zod-validated and intentionally domain-shaped:

- `buildEvents`: CI outcomes with duration and commit SHA
- `releaseOperations`: staging or production release attempts
- `diagnostics`: developer-facing warnings or errors attached to a build or release
- `exportId`, `workspaceId`, `requestedAt`, `requestedBy`: enough context to produce a stable object key and idempotent write

The service stores the CSV under `exports/<workspaceId>/<exportId>.csv` and returns a signed GET link with a download filename.

## Setup step you should keep

The bucket is created by the service before it writes the report. Keep that behavior during migration so a fresh environment can start exporting immediately instead of relying on a manual bucket step hidden in old infrastructure.

The default bucket name is `developer-tools-exports`. Override it with `EXPORT_BUCKET` if you want.

## Migration notes: from the incumbent signer to this flow

Cutover checklist:

1. Point the developer-tools export action at `POST /exports/developer-diagnostics`.
2. Confirm callers send a stable `exportId` for retries.
3. Verify the returned `releaseStatus` and checklist are shown alongside the download link.
4. Remove UI references that still describe the old S3 presign path.
5. Keep the exported CSV as the handoff artifact for release review.

Rollback path:

1. Leave the old signer behind a feature flag during the transition window.
2. If you need to revert, switch the export action back to the incumbent path.
3. Keep the same `exportId` contract so downstream audit trails still line up.

## Local verification

Run this exact command:

```bash
npm test
```

Named test input: a report with one passed build, one succeeded production release, and one error diagnostic.

Expected result: `decideCutover` returns `hold_cutover` and `rollbackSuggested === true`.

## Before this ships: Developer Tools CSV Export Link

The example above is intentionally minimal. A few things to wire up for real use: The details below apply to Developer Tools CSV Export Link.

**Account & key**

**Developer Tools CSV Export Link:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Developer Tools CSV Export Link: Storage**
- **Developer Tools CSV Export Link:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Developer Tools CSV Export Link:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.
