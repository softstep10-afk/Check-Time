-- ============================================================================
-- CHECK-TIME: Row Level Security Policies
-- Every table is locked down by org_id extracted from the user's JWT.
-- ============================================================================

-- Helper: extract org_id from the authenticated user's profile
create or replace function public.get_user_org_id()
returns uuid as $$
  select org_id from public.profiles where id = auth.uid()
$$ language sql security definer stable;

-- Helper: extract role from the authenticated user's profile
create or replace function public.get_user_role()
returns public.user_role as $$
  select role from public.profiles where id = auth.uid()
$$ language sql security definer stable;

-- Helper: check if user is a manager or admin
create or replace function public.is_manager()
returns boolean as $$
  select role in ('manager', 'admin') from public.profiles where id = auth.uid()
$$ language sql security definer stable;

-- ============================================================================
-- ORGANIZATIONS
-- ============================================================================
alter table public.organizations enable row level security;

create policy "Users can view their own org"
  on public.organizations for select
  using (id = public.get_user_org_id());

create policy "Admins can update their org"
  on public.organizations for update
  using (id = public.get_user_org_id() and public.get_user_role() = 'admin');

-- ============================================================================
-- PROFILES
-- ============================================================================
alter table public.profiles enable row level security;

create policy "Users can view profiles in their org"
  on public.profiles for select
  using (org_id = public.get_user_org_id() and deleted_at is null);

create policy "Users can update their own profile"
  on public.profiles for update
  using (id = auth.uid());

create policy "Managers can insert profiles"
  on public.profiles for insert
  with check (org_id = public.get_user_org_id() and public.is_manager());

create policy "Managers can update profiles in their org"
  on public.profiles for update
  using (org_id = public.get_user_org_id() and public.is_manager());

-- ============================================================================
-- PROJECTS
-- ============================================================================
alter table public.projects enable row level security;

create policy "Users can view active projects in their org"
  on public.projects for select
  using (org_id = public.get_user_org_id() and deleted_at is null);

create policy "Managers can insert projects"
  on public.projects for insert
  with check (org_id = public.get_user_org_id() and public.is_manager());

create policy "Managers can update projects"
  on public.projects for update
  using (org_id = public.get_user_org_id() and public.is_manager());

-- ============================================================================
-- PROJECT ASSIGNMENTS
-- ============================================================================
alter table public.project_assignments enable row level security;

create policy "Users can view assignments in their org"
  on public.project_assignments for select
  using (org_id = public.get_user_org_id());

create policy "Managers can manage assignments"
  on public.project_assignments for all
  using (org_id = public.get_user_org_id() and public.is_manager());

-- ============================================================================
-- TIME EVENTS (append-only — no update or delete policies)
-- ============================================================================
alter table public.time_events enable row level security;

create policy "Users can view time events in their org"
  on public.time_events for select
  using (org_id = public.get_user_org_id());

create policy "Workers can insert their own clock events"
  on public.time_events for insert
  with check (
    org_id = public.get_user_org_id() 
    and profile_id = auth.uid()
    and event_type in ('clock_in', 'clock_out')
  );

create policy "Managers can insert any time events"
  on public.time_events for insert
  with check (org_id = public.get_user_org_id() and public.is_manager());

-- No update/delete policies — ledger is append-only.
-- Corrections go through 'adjust' events.

-- ============================================================================
-- TASKS
-- ============================================================================
alter table public.tasks enable row level security;

create policy "Users can view tasks in their org"
  on public.tasks for select
  using (org_id = public.get_user_org_id() and deleted_at is null);

create policy "Managers can insert tasks"
  on public.tasks for insert
  with check (org_id = public.get_user_org_id() and public.is_manager());

create policy "Managers can update any task"
  on public.tasks for update
  using (org_id = public.get_user_org_id() and public.is_manager());

create policy "Workers can update tasks assigned to them"
  on public.tasks for update
  using (org_id = public.get_user_org_id() and assigned_to = auth.uid());

-- ============================================================================
-- MEDIA
-- ============================================================================
alter table public.media enable row level security;

create policy "Users can view media in their org"
  on public.media for select
  using (org_id = public.get_user_org_id() and deleted_at is null);

create policy "Users can upload media"
  on public.media for insert
  with check (org_id = public.get_user_org_id() and uploaded_by = auth.uid());

create policy "Managers can upload media for anyone"
  on public.media for insert
  with check (org_id = public.get_user_org_id() and public.is_manager());

-- ============================================================================
-- PAYROLL
-- ============================================================================
alter table public.payroll_runs enable row level security;
alter table public.payroll_line_items enable row level security;
alter table public.payroll_closures enable row level security;

-- Only managers can see and manage payroll
create policy "Managers can view payroll runs"
  on public.payroll_runs for select
  using (org_id = public.get_user_org_id() and public.is_manager());

create policy "Managers can create payroll runs"
  on public.payroll_runs for insert
  with check (org_id = public.get_user_org_id() and public.is_manager());

create policy "Managers can update payroll runs"
  on public.payroll_runs for update
  using (org_id = public.get_user_org_id() and public.is_manager());

create policy "Managers can view line items"
  on public.payroll_line_items for select
  using (
    exists (
      select 1 from public.payroll_runs pr
      where pr.id = payroll_run_id and pr.org_id = public.get_user_org_id()
    )
    and public.is_manager()
  );

create policy "Managers can insert line items"
  on public.payroll_line_items for insert
  with check (public.is_manager());

create policy "Managers can view closures"
  on public.payroll_closures for select
  using (org_id = public.get_user_org_id() and public.is_manager());

create policy "Managers can insert closures"
  on public.payroll_closures for insert
  with check (org_id = public.get_user_org_id() and public.is_manager());

-- Workers can see their own payroll line items (for "My Hours" view)
create policy "Workers can view their own line items"
  on public.payroll_line_items for select
  using (profile_id = auth.uid());

-- ============================================================================
-- DAILY REPORTS
-- ============================================================================
alter table public.daily_reports enable row level security;

create policy "Users can view reports in their org"
  on public.daily_reports for select
  using (org_id = public.get_user_org_id());

create policy "System can insert reports"
  on public.daily_reports for insert
  with check (org_id = public.get_user_org_id());

-- ============================================================================
-- STORAGE BUCKETS (run via Supabase dashboard or API)
-- ============================================================================
-- These would be created via Supabase dashboard:
--   Bucket: "media" (private, 50MB max file size)
--   Policies:
--     - Users can upload to their org's folder: media/{org_id}/*
--     - Users can read from their org's folder
--     - Structure: media/{org_id}/{project_id}/{date}/{filename}
