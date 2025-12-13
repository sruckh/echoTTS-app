Supabase Setup (Console Steps)

1) Create project + service role key
- In Supabase dashboard, create/open the project for this app.
- Copy Project URL and anon/public key for frontend; copy service_role key for the bridge (server-side only).

2) Create tables (use SQL editor)
- Open SQL Editor → Run the script in supabase/sql/001_schema.sql.
- This creates: user_roles, voice_requests, voices, status/type constraints, indexes, updated_at trigger, and RLS policies.

3) Verify RLS policies
- Tables user_roles, voice_requests, voices have RLS enabled.
- Check policies:
  - user_roles: select/update/delete by user_id = auth.uid(); admin access via bridge (service role).
  - voice_requests: insert/select own; admin select/update all.
  - voices: select approved for everyone; select own rows; admin select/update/delete all.

4) Seed admin
- In Table Editor → user_roles, insert row for your admin user_id with role='admin'.
- Optionally seed existing voices with owner=admin and status='approved'.

5) Enable JWT claim for roles (optional)
- If you want roles in JWT: Auth → Policies → JWT Custom Claims, add `app_metadata.role` and set via service key on signup/approval flows.
- Otherwise, the bridge will look up roles from user_roles per request using service key.

6) Copy keys to envs
- Frontend: SUPABASE_URL, SUPABASE_ANON_KEY in .env.
- Bridge: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, plus S3 and RunPod settings.

7) Test via SQL or Table Editor
- Insert a test voice_request; ensure it appears only for its owner unless using service role.
- Insert a voice with status='approved'; ensure it is selectable anonymously.

Notes
- Audio stays in S3 (not Supabase storage).
- Bridge enforces per-user quota and approval; DB holds metadata + audit.
