# Live Streaming (LiveKit + Valkey)

## Overview

Vestreams live broadcasting uses:

- **LiveKit Cloud** for WebRTC transport (one publisher, many viewers)
- **Aiven Valkey** (`ioredis`) for atomic broadcast locks and quota cache
- **MongoDB** as the durable source of truth for streams, sessions, and daily usage

Daily broadcaster quota: **900 seconds per UTC day** (configurable via `LIVE_DAILY_QUOTA_SEC`).

Authenticated viewing is required for both **public** (listed) and **unlisted** (link-only) streams.

## Environment variables

Add to backend `.env` (see `.env_sample`):

| Variable | Required | Notes |
|---|---|---|
| `LIVEKIT_URL` | yes (to enable) | LiveKit Cloud WebSocket URL |
| `LIVEKIT_API_KEY` | yes | From LiveKit project |
| `LIVEKIT_API_SECRET` | yes | Server-only; never expose to frontend |
| `VALKEY_SERVICE_URI` | yes | Aiven Valkey URI (`rediss://...`) |
| `LIVE_STREAMING_ENABLED` | no | `true` fails startup if LiveKit/Valkey missing |
| `LIVE_DAILY_QUOTA_SEC` | no | Default `900` |
| `LIVE_MAX_CONCURRENT_VIEWERS` | no | Default `50` |
| `LIVE_HOST_GRACE_SEC` | no | Default `45` — delay before ending after host disconnect |
| `LIVE_RECORDING_MAX_BYTES` | no | Default `80MB` — max host recording upload |

Frontend needs no LiveKit secrets. It only talks to your API.

## Dashboard setup (you must do this)

### LiveKit Cloud

1. Create a project at [https://cloud.livekit.io](https://cloud.livekit.io).
2. Copy **URL**, **API Key**, **API Secret** into backend `.env`.
3. Configure a webhook pointing to:
   `https://<your-api-host>/api/v1/live/webhook`
4. Subscribe at least to `participant_left` and `room_finished`.
5. Review current free-tier participant-minute and bandwidth limits before launch.

### Aiven Valkey

1. Create a Valkey service on Aiven.
2. Copy the TLS connection URI into `VALKEY_SERVICE_URI`.
3. Ensure the backend host can reach Aiven (IP allowlist / VPC as needed).

## API surface (`/api/v1/live`, JWT required)

| Method | Path | Purpose |
|---|---|---|
| GET | `/quota` | Remaining daily broadcast seconds |
| GET | `/streams` | Active public streams |
| POST | `/streams` | Create broadcast (quota + lock) |
| GET | `/streams/:id` | Stream metadata |
| POST | `/streams/:id/token` | Publisher or viewer LiveKit token |
| POST | `/streams/:id/end` | End broadcast (owner only) |
| POST | `/streams/:id/checkpoint` | Heartbeat / hard quota stop |
| POST | `/streams/:id/recording` | Upload host recording after end (owner only) |
| PATCH | `/streams/:id` | Edit title/description/thumbnail (owner) |
| DELETE | `/streams/:id` | Delete stream + Cloudinary assets + sessions (owner) |
| GET | `/streams/mine` | Owner’s livestreams (live + ended) |
| GET | `/streams/by/:username` | Channel livestreams |
| POST | `/webhook` | LiveKit webhook (signature verified; no JWT) |

## Frontend routes

| Path | Page |
|---|---|
| `/live` | Public live listing + remaining quota |
| `/go-live` | Preview, title, visibility, Start Live |
| `/live/:streamId` | Host or viewer room + share |

## Quota / recovery behavior

- Preview time is **not** charged; charging starts when the stream is created/`live`.
- Active broadcaster lock in Valkey prevents concurrent broadcasts per user.
- `BroadcastSession` + `DailyLiveUsage.finalizedSessionIds` make finalization idempotent.
- UTC midnight splits are applied so usage lands in the correct day bucket.
- Publisher token TTL is capped to remaining quota; checkpoints + webhooks also stop publishing.
- Stale active sessions are recovered on startup and on stream create.

## Recordings (ended stream VOD)

Live WebRTC itself is ephemeral. After **End Stream**, the host browser uploads a `MediaRecorder` capture to Cloudinary:

1. Host records local camera/mic (or screen when sharing) while live.
2. On end → `POST /streams/:id/recording` with the WebM/MP4 blob.
3. Backend uploads with Cloudinary eager transform (`w_640`, `q_auto:eco`, mp4).
4. `LiveStream.recording` becomes `{ status: "ready", url, public_id, ... }`.
5. My Content → Live, Collections, and `/live/:streamId` play the compressed VOD.

**Limitations**

- Recording requires the host tab to stay open until end + upload finishes.
- Closing the tab early yields metadata with `recording.status = none` (listed, not playable).
- Not LiveKit Cloud egress (that needs S3/R2); this path uses only existing Cloudinary.
- Max upload size: `LIVE_RECORDING_MAX_BYTES` (default 80MB).

## 360p note

Client capture/encoding is capped at **640×360**. Cloudinary eager transform also limits replay width to 640. This is not a cryptographic security boundary against a modified client.

## Deployment checklist

1. Set env vars on the backend host.
2. Configure LiveKit webhook to a publicly reachable API URL.
3. Redeploy backend + frontend.
4. Verify `GET /api/v1/live/quota` as a logged-in user.
5. Smoke-test: go live → share URL → second account watches → end stream → quota decreases.

## Known limitations

- Code changes alone are **not** a completed deployment.
- Free-tier LiveKit minutes/bandwidth can be exhausted; `LIVE_MAX_CONCURRENT_VIEWERS` is a soft cost control.
- Old comments unrelated to live are unchanged.
- Requires modern browsers with WebRTC + camera/mic permissions.
- If Valkey is down and `LIVE_STREAMING_ENABLED=true`, the API will not start; if false, live endpoints return 503 when config is incomplete.
