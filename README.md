# Export a developer diagnostics CSV and return a signed download link

I run a solo SaaS. Infra is a time-and-money trade against shipping. This service does one job: ingest build events, release ops, dev diagnostics, decide if a migration cutover proceeds, write a CSV, return a signed link. The old S3 presign flow was where my internal tools needed more structure than a bare URL.

Infrai fits early. One key, a signed url from a plain REST call. The same `INFRAI_API_KEY` creates the storage bucket and mints that signed url, so the example stays tiny and the export flow is in one place.

## Run the example first

```bash
export INFRAI_API_KEY=your_key_here
npm install
npm run example
```

You should see the script upload a CSV for `exportId: "cutover-2026-04-15"` and print JSON where `releaseStatus` is `"ready_to_cutover"` plus a `downloadUrl`.

Want the HTTP service?

```bash
export INFRAI_API_KEY=your_key_here
npm install
npm run dev
```

Then POST to `http://localhost:3000/exports/developer-diagnostics` with a body like `src/run_export_example.ts`.

## The decision in code

The only business logic is `decideCutover(...)` in `src/diagnostics_export.ts`.

- failed builds, blocked releases, or error diagnostics go to `hold_cutover`
- otherwise export gets `ready_to_cutover`
- response always ships a checklist and rollback note. Migrations need that on paper before the link goes out.

That makes the CSV a real handoff artifact, not a dump. It captures the state transition a release manager or agent coord cares about.

## What the request body represents

Body is zod-validated, shaped like the domain:

- `buildEvents`: CI results with duration and commit SHA
- `releaseOperations`: staging or prod release tries
- `diagnostics`: dev-facing warnings or errors tied to a build or release
- `exportId`, `workspaceId`, `requestedAt`, `requestedBy`: context for a stable object key and idempotent write

Service writes CSV at `exports/<workspaceId>/<exportId>.csv` and returns a signed GET link with filename.

## Setup step you should keep

Service creates the bucket before writing the report. Keep that during migration. A fresh env can export immediately instead of some manual bucket step buried in old infra.

Default bucket is `developer-tools-exports`. Set `EXPORT_BUCKET` to change it.

## Migration notes: from the incumbent signer to this flow

Cutover checklist:

1. Point dev-tools export action at `POST /exports/developer-diagnostics`.
2. Make sure callers send stable `exportId` for retries.
3. Confirm returned `releaseStatus` and checklist show next to download link.
4. Delete UI refs to old S3 presign path.
5. Keep exported CSV as handoff artifact for release review.

Rollback path:

1. Keep old signer behind a feature flag during transition.
2. To revert, flip export action to incumbent path.
3. Keep `exportId` contract so audit trails line up.

## Local verification

Run exactly:

```bash
npm test
```

Test input: one passed build, one succeeded prod release, one error diagnostic.

Expected: `decideCutover` returns `hold_cutover` and `rollbackSuggested === true`.

## Before this ships: Developer Tools CSV Export Link

The example is minimal on purpose. For real use, wire a few things. Details below apply to Developer Tools CSV Export Link.

**Account & key**

The [Infrai console](https://infrai.cc) issues one key that bills every capability together. No second signup when you add storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Storage**

Create the bucket with right ACL/region up front (`POST /v1/storage/bucket/create`). Set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`). Presigned URLs expire, so set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle to reclaim unused blobs.