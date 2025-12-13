-- Enable required extensions
create extension if not exists "uuid-ossp";

-- Roles table for app-level roles (admin, voice_creator, voice_creator_pending)
create table if not exists public.user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('admin','voice_creator','voice_creator_pending')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Requests for creator role
create table if not exists public.voice_requests (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','denied')),
  notes text,
  reviewed_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Voices metadata
create table if not exists public.voices (
  id text primary key, -- slug, lowercase
  display_name text not null,
  status text not null default 'pending' check (status in ('pending','approved','denied','deleted')),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  approved_by_user_id uuid references auth.users (id),
  source_object_url text, -- original upload (S3 presigned target)
  ogg_object_url text,    -- processed location
  filename text not null, -- e.g. 'dorota.ogg' (unique slug + ext) stored on volume
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Unique per-user voice id to support per-user logical names if desired
create unique index if not exists voices_owner_id_idx on public.voices(owner_user_id, id);

-- Trigger to keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_user_roles_updated
before update on public.user_roles
for each row execute function public.set_updated_at();

create trigger trg_voice_requests_updated
before update on public.voice_requests
for each row execute function public.set_updated_at();

create trigger trg_voices_updated
before update on public.voices
for each row execute function public.set_updated_at();

-- Enable RLS
alter table public.user_roles enable row level security;
alter table public.voice_requests enable row level security;
alter table public.voices enable row level security;

-- Policies: user_roles
-- Users can view their own role. Writes done by bridge or admin via RPC.
create policy user_roles_select_own on public.user_roles
  for select using (auth.uid() = user_id);

-- Policies: voice_requests
create policy voice_requests_insert_own on public.voice_requests
  for insert with check (auth.uid() = user_id);

create policy voice_requests_select_own on public.voice_requests
  for select using (auth.uid() = user_id);

-- Admin can read all voice requests; bridging with service_role bypasses RLS.
create policy voice_requests_select_admin on public.voice_requests
  for select using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

create policy voice_requests_update_admin on public.voice_requests
  for update using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

-- Policies: voices
-- Anyone can see approved voices (excluding soft-deleted).
create policy voices_select_approved on public.voices
  for select using (status = 'approved');

-- Owners can see their own voices (for pending/denied/deleted visibility).
create policy voices_select_owner on public.voices
  for select using (auth.uid() = owner_user_id);

-- Admins can see all voices.
create policy voices_select_admin on public.voices
  for select using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

-- Owners can "delete" their voices (actually update status to 'deleted').
-- If hard delete is desired, use DELETE policy. Here we support soft delete updates.
create policy voices_update_owner_soft_delete on public.voices
  for update using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id and status = 'deleted');

-- Admins can update/delete all voices.
create policy voices_update_admin on public.voices
  for update using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

create policy voices_delete_admin on public.voices
  for delete using (exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin'));

-- Note: inserts/updates for voices will typically be performed by bridge using service_role (bypasses RLS).

-- Quota Enforcement Trigger
create or replace function check_voice_quota()
returns trigger as $$
declare
  voice_count int;
begin
  select count(*) into voice_count
  from public.voices
  where owner_user_id = new.owner_user_id
    and status != 'deleted';
  
  if voice_count >= 20 then
    raise exception 'Voice quota exceeded. Maximum 20 voices per user.';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger enforce_voice_quota
  before insert on public.voices
  for each row
  execute procedure check_voice_quota();

-- RPC Function for Atomic Approval (Voice Request + Role)
create or replace function approve_creator_request(request_id uuid, admin_id uuid)
returns void as $$
declare
  req_user_id uuid;
begin
  -- Update request status
  update public.voice_requests
  set status = 'approved',
      reviewed_by = admin_id,
      reviewed_at = now()
  where id = request_id
  returning user_id into req_user_id;

  if not found then
    raise exception 'Request not found';
  end if;

  -- Upsert user role
  insert into public.user_roles (user_id, role)
  values (req_user_id, 'voice_creator')
  on conflict (user_id) do update
  set role = 'voice_creator',
      updated_at = now();
end;
$$ language plpgsql security definer;

-- Helpful view for admins
-- Security note: Views don't automatically enforce RLS of underlying tables if accessed by owner.
-- In Supabase/PostgREST, standard API access respects RLS of underlying tables.
create or replace view public.voices_with_users as
select v.*, u.email as owner_email, a.email as approver_email
from public.voices v
left join auth.users u on u.id = v.owner_user_id
left join auth.users a on a.id = v.approved_by_user_id;