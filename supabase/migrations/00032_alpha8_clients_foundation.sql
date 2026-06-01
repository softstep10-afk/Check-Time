-- ============================================================================
-- 00032 - Alpha-8 Clients Foundation
--
-- Adds the internal client directory for owner/admin/manager users.
-- No project linking, estimates, invoices, payments, payroll, GPS, storage, or
-- client portal behavior is introduced in this phase.
-- ============================================================================

begin;

create table if not exists public.clients (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  status text not null default 'active',
  primary_contact_name text,
  primary_contact_phone text,
  primary_contact_email text,
  address text,
  internal_note text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clients_name_not_blank check (length(btrim(name)) > 0),
  constraint clients_status_check check (status in ('active', 'inactive'))
);

create table if not exists public.client_contacts (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  title text,
  phone text,
  email text,
  is_primary boolean not null default false,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_contacts_name_not_blank check (length(btrim(name)) > 0),
  constraint client_contacts_status_check check (status in ('active', 'inactive'))
);

create index if not exists idx_clients_org_status_name
  on public.clients(org_id, status, name);

create index if not exists idx_client_contacts_client_status
  on public.client_contacts(client_id, status, is_primary desc, name);

create unique index if not exists idx_client_contacts_one_primary
  on public.client_contacts(client_id)
  where is_primary is true and status = 'active';

alter table public.clients enable row level security;
alter table public.client_contacts enable row level security;

drop policy if exists clients_owner_admin_manager_all on public.clients;
drop policy if exists clients_owner_admin_manager_select on public.clients;
drop policy if exists clients_owner_admin_manager_insert on public.clients;
drop policy if exists clients_owner_admin_manager_update on public.clients;

create policy clients_owner_admin_manager_select
  on public.clients
  for select
  using (
    org_id = public.get_user_org_id()
    and exists (
      select 1
      from public.profiles actor
      where actor.id = auth.uid()
        and actor.org_id = clients.org_id
        and actor.role in ('owner', 'admin', 'manager')
    )
  );

create policy clients_owner_admin_manager_insert
  on public.clients
  for insert
  with check (
    org_id = public.get_user_org_id()
    and exists (
      select 1
      from public.profiles actor
      where actor.id = auth.uid()
        and actor.org_id = clients.org_id
        and actor.role in ('owner', 'admin', 'manager')
    )
  );

create policy clients_owner_admin_manager_update
  on public.clients
  for update
  using (
    org_id = public.get_user_org_id()
    and exists (
      select 1
      from public.profiles actor
      where actor.id = auth.uid()
        and actor.org_id = clients.org_id
        and actor.role in ('owner', 'admin', 'manager')
    )
  )
  with check (
    org_id = public.get_user_org_id()
    and exists (
      select 1
      from public.profiles actor
      where actor.id = auth.uid()
        and actor.org_id = clients.org_id
        and actor.role in ('owner', 'admin', 'manager')
    )
  );

drop policy if exists client_contacts_owner_admin_manager_all on public.client_contacts;
drop policy if exists client_contacts_owner_admin_manager_select on public.client_contacts;
drop policy if exists client_contacts_owner_admin_manager_insert on public.client_contacts;
drop policy if exists client_contacts_owner_admin_manager_update on public.client_contacts;

create policy client_contacts_owner_admin_manager_select
  on public.client_contacts
  for select
  using (
    org_id = public.get_user_org_id()
    and exists (
      select 1
      from public.profiles actor
      where actor.id = auth.uid()
        and actor.org_id = client_contacts.org_id
        and actor.role in ('owner', 'admin', 'manager')
    )
  );

create policy client_contacts_owner_admin_manager_insert
  on public.client_contacts
  for insert
  with check (
    org_id = public.get_user_org_id()
    and exists (
      select 1
      from public.profiles actor
      where actor.id = auth.uid()
        and actor.org_id = client_contacts.org_id
        and actor.role in ('owner', 'admin', 'manager')
    )
    and exists (
      select 1
      from public.clients c
      where c.id = client_contacts.client_id
        and c.org_id = client_contacts.org_id
    )
  );

create policy client_contacts_owner_admin_manager_update
  on public.client_contacts
  for update
  using (
    org_id = public.get_user_org_id()
    and exists (
      select 1
      from public.profiles actor
      where actor.id = auth.uid()
        and actor.org_id = client_contacts.org_id
        and actor.role in ('owner', 'admin', 'manager')
    )
  )
  with check (
    org_id = public.get_user_org_id()
    and exists (
      select 1
      from public.profiles actor
      where actor.id = auth.uid()
        and actor.org_id = client_contacts.org_id
        and actor.role in ('owner', 'admin', 'manager')
    )
    and exists (
      select 1
      from public.clients c
      where c.id = client_contacts.client_id
        and c.org_id = client_contacts.org_id
    )
  );

grant select, insert, update on public.clients to authenticated;
grant select, insert, update on public.client_contacts to authenticated;

comment on table public.clients is
  'Alpha-8 internal client directory. No public/client portal access.';
comment on table public.client_contacts is
  'Alpha-8 contacts belonging to internal clients.';

commit;
