# PulseCore REST API

The REST service is included in the optional Python backend and uses JSON request/response bodies. No authentication is included because this is a **local/demo service**, so do not expose it directly to untrusted clients for production usage.

**Base URL:** `http://127.0.0.1:8000`

## `GET /api/health`

Returns `{"status":"ok","storage":"sqlite","demo_mode":true}`.

## `GET /api/overview`

Returns `stats`, `assets` (with current readings and model outputs), `trend` (24 modeled fleet health points), `alerts` (six most recent), and `generated_at`.

## `GET /api/assets`

Returns `{ "items": [...] }` containing each machine's current readings, risk score, health condition and explanatory drivers.

## `GET /api/assets/{id}`

Returns a single `asset`, `history` (last 96 readings, chronological), and linked `alerts` and `work_orders`.

## `GET /api/alerts?status={all|active|acknowledged}`

Returns `{ "items": [...] }`. Unknown filters return 400.

## `POST /api/alerts/{id}/acknowledge`

No body required (empty `{}` is also fine). Returns `{ "ok": true }`. Unknown ID returns 404.

## `GET /api/work-orders`

Returns `{ "items": [...] }`.

## `POST /api/work-orders`

Example JSON:

```json
{
  "asset_id": "MTR-001",
  "title": "Inspect shaft bearings",
  "priority": "high",
  "notes": "Look for elevated vibration"
}
```

The `asset_id` must exist, title must be 3–120 characters, notes no longer than 1000 characters, and priority must be `low`, `medium` or `high`. Returns 201 with the new ID and initial status `open`.

## `PATCH /api/work-orders/{id}`

```json
{ "status": "in_progress" }
```

Statuses: `open`, `in_progress`, `completed`. Returns 200 and the updated status. Unknown ID returns 404.

## `POST /api/simulate`

Adds one synthetically generated telemetry row for every machine and may generate new risk alerts (with a four-hour per-asset cooldown). Returns 201 with `readings_added`, `alerts_created`, and `timestamp`.

## Errors

Errors use an HTTP 400, 404 or 500 status and JSON `{"error":"..."}`. Requests larger than 64 KiB are not accepted.

## Browser-only mode

When hosted statically, `web/demo-api.js` simulates these endpoints inside the browser using bundled JSON and per-visitor localStorage. It cannot be called via network REST endpoints; requests are intercepted inside the UI.
