Plan: Add Voice Creation & Dynamic Voices

Goals
- Enable authenticated users to request/create reference voices via the WebUI (upload or mic record, 30–60s).
- Enforce admin approval before a voice becomes available to everyone.
- Replace manual env/voice_map management with database-backed metadata and dynamic voice listing.
- Keep per-user creation capped at 20; track creator and approver.

Auth & Roles (Supabase)
- Use Supabase auth; store JWT in client; bridge validates Supabase JWT on every API.
- Roles: user (default, can TTS and request creation), voice_creator_pending (requested), voice_creator (approved), admin (can approve/deny requests, delete any voice if needed).
- Flow: user signs in → requests creator access → admin approves in UI → bridge calls RPC function to update role atomically.

Data Model (Supabase)
- voices table: id (slug, lowercase), display_name (Title Case), status (pending|approved|denied|deleted), owner_user_id, approved_by_user_id, source_object_url (original upload), ogg_object_url (normalized), filename (e.g., dorota.ogg), created_at, updated_at.
- voice_requests table: user_id, status, reviewed_by, created_at, reviewed_at, notes.
- users metadata/roles: store role in `user_roles` table keyed by user_id.
- Enforce UNIQUE(owner_user_id, id).
- **Quota Enforcement**: Database trigger `check_voice_quota` to prevent inserts > 20 per user.

Storage/S3
- Reuse existing bucket; add prefixes: reference-voices/uploads/ (raw), reference-voices/processed/ (final .ogg).
- Presigned PUT from bridge for uploads to uploads/; bridge fetches and converts to processed/.
- Keep S3 env in .env (.e.g., S3_BUCKET, S3_REGION, S3_ACCESS_KEY, S3_SECRET, S3_REFERENCE_PREFIX).

Audio Conversion
- Default: bridge downloads the uploaded file and normalizes to .ogg (Opus) via ffmpeg; writes to processed/ and to RunPod shared volume.
- **Filename Strategy**: Use the voice `id` (slug) + extension (e.g., `my-voice.ogg`) for storage on disk/S3 to avoid collisions. Display name is metadata only.

Frontend (this project) scope
- Auth: add Supabase client, login/logout, role display. Persist session.
- Dynamic voices: replace static VITE_OPEN_AI_TTS_VOICES with API-driven list (GET /voices). UI updates when new voices approved; remove env mapping dependency.
- Request flow: “Request voice creation” action for logged-in users; show status (pending/denied/approved). Disable create UI unless role is voice_creator.
- Voice creation UI: upload (.wav/.ogg/.m4a/.mp3) or record mic; show pangram prompt to read; enforce 30–60s (client-side duration check); display progress + errors.
- Submission: call API to get presigned URL, PUT file, then call register voice with id (lowercase slug), display_name (Title Case), source URL. Surface quota errors (limit 20).
- Admin UI: list pending requests; approve/deny with optional note; list voices with status/owner/created_at; delete voice (owner can delete their own; admin can delete any).
- Deletion: call DELETE /voices/:id; update UI state and list.
- UX: optimistic updates for lists; toasts for status; loading states for uploads/approvals.
- Env/config: add Supabase keys, bridge API base URL, S3 upload size guidance (if any) to .env.example and docs.

Bridge (OpenAI TTS bridge) changes to document
- Add Supabase JWT verification middleware; enforce roles per route.
- Endpoints:
  - GET /voices → list approved voices (and pending for admins/owners if needed).
  - POST /voices/presign → returns PUT URL for uploads/.
  - POST /voices → register voice (id, display_name, source URL); enforce quota (DB trigger handles fallback); status=pending; owner=caller.
  - POST /voice-requests/:userId/approve|deny → admin-only; calls DB RPC function `approve_creator_request` to atomically update request status and user role.
  - POST /voices/:id/approve → admin-only; performs download+convert to .ogg; writes to processed/ and RunPod volume; updates ogg_object_url/filename/status=approved/approved_by.
  - DELETE /voices/:id → owner/admin; marks deleted and removes processed file + shared-volume file.
- Replace voice_map.json with DB reads; cache list in memory with TTL to reduce DB hits.
- When serving TTS: map requested id to processed filename from DB instead of env/voice_map.

RunPod serverless changes to document
- Accepts filename from bridge as today; no change to inference path once .ogg is on shared volume.
- Optional: add a lightweight endpoint to pull & convert from uploads/ if conversion is moved serverless-side.
- Ensure read access to processed/ prefix if serverless needs to pull from S3; otherwise unchanged.

Migration Notes
- Add migration script to seed DB with existing voices (id/display_name/filename/owner=admin/status=approved) and upload current .ogg files to processed/ prefix if not already in S3.
- Deprecate VITE_OPEN_AI_TTS_VOICES and voice_map.json after API/DB path is live; keep fallback for one release if needed.

Validation & Guards
- Client: duration 30–60s; file type check; show pangram prompt; prevent submit without auth/role; handle 413/400 gracefully.
- Server: verify content-type/extension; run ffmpeg normalize; reject >20 voices per user (DB trigger); require unique id; status gating (only approved voices served).
- Audit: store created_at/approved_at + user ids; log actions (approve/deny/delete).

Config Touchpoints
- Frontend: Supabase URL/key, Bridge API base URL; remove static voice env; S3 bucket/prefix only if needed for display.
- Bridge: Supabase service key for role writes, S3 creds, RunPod volume path, ffmpeg binary, cache TTL.
- Serverless: (if pulling) S3 creds/prefix; otherwise no new config.

Open Questions to resolve in implementation
- Final decision on where conversion runs (bridge vs serverless) and installing ffmpeg in that component.
- Whether to expose pending voices in UI (e.g., “awaiting approval”) or hide until approved.
- Whether to hard-delete files on delete or retain tombstones; current plan: delete files + mark deleted in DB.

Additional Considerations
- Rate limiting: add limits on presign/register/approve endpoints; reject oversized payloads server-side.
- Storage hygiene: set S3 lifecycle on reference-voices/uploads/ to expire raw uploads after 7–14 days; keep processed long-lived.
- ffmpeg/codec: standardize on Opus (48kHz mono, ~64kbps) and document ffmpeg install flags in bridge/serverless Dockerfiles.
- Logging/alerts: log approvals/denials/deletes/conversion failures; alert when processed file missing on shared volume.
- Health checks: add bridge health endpoint that verifies DB connectivity and RunPod volume writability.
- Seed/migration helper: script to import existing voice_map.json + .ogg into Supabase + processed prefix to avoid drift.
- UX polish: upload progress, retry on failure, confirm dialogs for deletes/approvals, clear error toasts.
- Test matrix: role gating (user/pending/creator/admin), quota enforcement, type/duration rejects, approve → visible without rebuild, delete → removed from TTS list, TTS still works with approved voices.
- Security: keep service_role key server-side only; validate content-type/duration server-side before conversion; enforce HTTPS for uploads/calls.

Supabase Setup Tasks (admin console + SQL)
- Run supabase/sql/001_schema.sql in Supabase SQL Editor to create tables (user_roles, voice_requests, voices), triggers, and RLS policies. Verify: tables exist and RLS enabled.
- **New SQL Features**:
    - Trigger `check_voice_quota`: BEFORE INSERT on `voices`, count user's non-deleted voices; raise exception if >= 20.
    - Function `approve_creator_request`: Transactionally update `voice_requests` status and insert/update `user_roles`.
- In Supabase Table Editor, seed an admin row in user_roles for your admin user_id (role='admin'). Verify: row saved and selectable.
- Optional: seed existing voices as approved (owner=admin) and upload their .ogg to S3 processed prefix. Verify: voices appear via GET /voices once bridge is wired.
- Optional JWT claim: set app_metadata.role if you want roles in JWT; otherwise bridge will look up roles server-side. Verify: JWT contains claim after login if configured.
- Copy Supabase URL + anon key to frontend .env; copy service_role key to bridge env. Verify: frontend auth works with anon key; bridge can perform service actions.

Frontend Detailed To-Do (this repo)
- Supabase client & env wiring: add Supabase URL/key and bridge API base URL to .env.example; create src/supabaseClient.ts for initialized client; update src/config.ts to surface new envs. Verify: yarn build succeeds and supabase client initializes without undefined envs.
- Auth/session handling: add auth context/provider (src/contexts) to hold session, roles, loading state; wrap App in provider in src/main.tsx; add login/logout UI controls in App.tsx. Verify: login persists across refresh and logout clears session.
- Role gating & requests: add UI in App.tsx for “request voice creator” when logged-in user lacks role; call bridge POST /voice-requests; show pending/denied/approved states; block creation UI unless role is voice_creator. Verify: pending state shows and creation controls are disabled until approved.
- Admin approvals UI: add admin-only panel in App.tsx to list pending creator requests (GET /voice-requests) with approve/deny actions (POST). Verify: approving updates user state after reload and removes request from pending list.
- Dynamic voices list: replace VITE_OPEN_AI_TTS_VOICES usage in App.tsx with GET /voices; store voices in state; refresh after approvals/deletes; remove dependency on env mapping except fallback if API fails. Verify: newly approved voice appears without rebuild and is selectable for TTS.
- Voice creation flow: add upload widget supporting .wav/.ogg/.m4a/.mp3; add mic record control with pangram prompt; enforce 30–60s duration client-side; show waveform/duration info; on submit: call POST /voices/presign, PUT file to S3 URL, then POST /voices with id (slug), display_name (Title Case), source URL. Verify: submission succeeds and shows pending/approved status transitions; reject files outside duration or wrong type.
- Quota and errors: surface bridge errors for quota (≥20 voices) and validation; show toasts/snackbars; disable submit while uploading. Verify: creating 21st voice returns readable error and UI blocks further submissions.
- Deletion: add delete action per voice (owner/admin) calling DELETE /voices/:id; update list and selection. Verify: deleted voice disappears and TTS list excludes it after refresh.
- Pangram prompt display: render provided pangram text in recording UI; ensure copy/paste and readability. Verify: prompt visible whenever recording is available.
- Docs/config: update README and .env.example to describe new auth/API vars and voice creation steps; document that static env voice list is deprecated. Verify: README/.env.example mention Supabase and bridge endpoints and remove instructions to edit VITE_OPEN_AI_TTS_VOICES.

Bridge To-Do (OpenAI TTS bridge)
- Add Supabase JWT validation middleware and role checks; include service key for role writes. Verify: protected endpoints reject unauthenticated/unauthorized calls.
- Implement /voice-requests (list/create/approve/deny) and role toggling for voice_creator; persist audit info. Verify: approve sets role and pending list updates.
- Implement /voices/presign for uploads/ prefix; return PUT URL and final key. Verify: PUT via returned URL succeeds.
- Implement /voices (create register) enforcing unique id, per-user cap, pending status, owner tracking. Verify: requests beyond cap fail with 403/400.
- Implement /voices/:id/approve to download from uploads, convert to .ogg (ffmpeg), store processed file + shared volume copy, update metadata/status/approver. Verify: approved voice appears in GET /voices and file exists on volume.
- Implement GET /voices to return approved voices (and optionally pending for admins/owners); cache with TTL. Verify: cache invalidates on create/approve/delete.
- Implement DELETE /voices/:id to remove processed/shared files and mark deleted. Verify: subsequent GET excludes deleted voice and files removed.
- Replace voice_map.json with DB lookups in TTS path; handle backward-compat fallback if needed. Verify: TTS requests succeed using DB-sourced filename.

RunPod Serverless To-Do
- If conversion moved here: add endpoint to pull from uploads/ prefix, convert to .ogg (ffmpeg/pytorch), write to processed/ and shared volume. Verify: endpoint produces .ogg readable by inference.
- If not converting here: no change to inference; ensure access to processed/ files placed by bridge. Verify: inference still works with new filenames.
- Optional: add health/logging around volume file presence for approved voices. Verify: logs show when files are missing and alerts are raised.