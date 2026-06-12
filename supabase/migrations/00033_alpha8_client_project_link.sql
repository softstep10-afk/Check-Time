-- ============================================================================
-- 00033 - Alpha-8 Phase 1B Client Project Link
--
-- Links one primary client to one project through an additive join table.
-- No estimates, invoices, payments, payroll, GPS, storage, margin, AI, or
-- client portal behavior is introduced in this phase.
-- ============================================================================

begin;

create table if not exists public.project_clients (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  status text not null default 'active',
  linked_by uuid references public.profiles(id) on delete set null,
  linked_at timestamptz not null default now(),
  unlinked_by uuid references public.profiles(id) on delete set null,
  unlinked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_clients_status_check check (status in ('active', 'inactive'))
);

create unique index if not exists idx_project_clients_one_active_per_project
  on public.project_clients(project_id)
  where status = 'active';

create index if not exists idx_project_clients_client_active
  on public.project_clients(client_id, status, linked_at desc);

create index if not exists idx_project_clients_org_project
  on public.project_clients(org_id, project_id, status);

alter table public.project_clients enable row level security;

drop policy if exists project_clients_owner_admin_manager_all on public.project_clients;
drop policy if exists project_clients_owner_admin_manager_select on public.project_clients;
drop policy if exists project_clients_owner_admin_manager_insert on public.project_clients;
drop policy if exists project_clients_owner_admin_manager_update on public.project_clients;

create policy project_clients_owner_admin_manager_select
  on public.project_clients
  for select
  using (
    org_id = public.get_user_org_id()
    and exists (
      select 1
      from public.profiles actor
      where actor.id = auth.uid()
        and actor.org_id = project_clients.org_id
        and actor.role in ('owner', 'admin', 'manager')
    )
  );

create policy project_clients_owner_admin_manager_insert
  on public.project_clients
  for insert
  with check (
    org_id = public.get_user_org_id()
    and exists (
      select 1
      from public.profiles actor
      where actor.id = auth.uid()
        and actor.org_id = project_clients.org_id
        and actor.role in ('owner', 'admin', 'manager')
    )
    and exists (
      select 1
      from public.projects p
      where p.id = project_clients.project_id
        and p.org_id = project_clients.org_id
    )
    and exists (
      select 1
      from public.clients c
      where c.id = project_clients.client_id
        and c.org_id = project_clients.org_id
    )
  );

create policy project_clients_owner_admin_manager_update
  on public.project_clients
  for update
  using (
    org_id = public.get_user_org_id()
    and exists (
      select 1
      from public.profiles actor
      where actor.id = auth.uid()
        and actor.org_id = project_clients.org_id
        and actor.role in ('owner', 'admin', 'manager')
    )
  )
  with check (
    org_id = public.get_user_org_id()
    and exists (
      select 1
      from public.profiles actor
      where actor.id = auth.uid()
        and actor.org_id = project_clients.org_id
        and actor.role in ('owner', 'admin', 'manager')
    )
    and exists (
      select 1
      from public.projects p
      where p.id = project_clients.project_id
        and p.org_id = project_clients.org_id
    )
    and exists (
      select 1
      from public.clients c
      where c.id = project_clients.client_id
        and c.org_id = project_clients.org_id
    )
  );

grant select, insert, update on public.project_clients to authenticated;

comment on table public.project_clients is
  'Alpha-8 Phase 1B internal project-client links. One active client per project; no public/client portal access.';

commit;
