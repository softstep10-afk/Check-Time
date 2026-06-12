import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildClientLinkedProjects,
  buildClientProjectOptions,
  buildProjectClientOptions,
  buildProjectClientSummary,
} from "@/lib/client-project-links";
import type {
  BusinessClient,
  ClientContact,
  Project,
  ProjectClient,
} from "@/types/database";

function readSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

const migrationSource = readSource("supabase/migrations/00033_alpha8_client_project_link.sql");
const projectDetailSource = readSource("src/components/manager/ProjectDetailPage.tsx");
const clientDetailSource = readSource("src/components/manager/ClientDetailPage.tsx");
const projectDetailRoutePageSource = readSource("src/app/(manager)/projects/[id]/page.tsx");
const projectClientRouteSource = readSource("src/app/api/manager/projects/[id]/client/route.ts");
const clientsDataSource = readSource("src/lib/clients-data.ts");
const managerLayoutSource = readSource("src/app/(manager)/layout.tsx");
const docsMapSource = readSource("docs/Карта проекта.md");
const projectClientCardSource = sourceBetween(
  projectDetailSource,
  'data-testid="project-client-card"',
  "{/* ── Stats",
);
const clientProjectsTabSource = sourceBetween(
  clientDetailSource,
  'activeTab === "projects"',
  'activeTab === "notes"',
);

const now = "2026-06-11T00:00:00.000Z";

function client(overrides: Partial<BusinessClient>): BusinessClient {
  return {
    id: "client-1",
    org_id: "org-1",
    name: "Acme",
    status: "active",
    primary_contact_name: null,
    primary_contact_phone: null,
    primary_contact_email: null,
    address: null,
    internal_note: null,
    created_by: null,
    updated_by: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function contact(overrides: Partial<ClientContact>): ClientContact {
  return {
    id: "contact-1",
    org_id: "org-1",
    client_id: "client-1",
    name: "Ana",
    title: null,
    phone: "555-0100",
    email: "ana@example.com",
    is_primary: true,
    status: "active",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function project(overrides: Partial<Project>): Project {
  return {
    id: "project-1",
    org_id: "org-1",
    name: "Kitchen Remodel",
    address: "10 Main",
    notes: null,
    status: "active",
    rate: 0,
    site_point: null,
    radius_m: 150,
    start_date: null,
    end_date: null,
    settings: {},
    timeline_status: null,
    budget_status: null,
    deleted_at: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function link(overrides: Partial<ProjectClient>): ProjectClient {
  return {
    id: "link-1",
    org_id: "org-1",
    project_id: "project-1",
    client_id: "client-1",
    status: "active",
    linked_by: "manager-1",
    linked_at: now,
    unlinked_by: null,
    unlinked_at: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("Alpha-8 Phase 1B project_clients migration", () => {
  it("creates the additive project_clients table without altering projects", () => {
    expect(migrationSource).toContain("create table if not exists public.project_clients");
    expect(migrationSource).toContain("project_id uuid not null references public.projects(id)");
    expect(migrationSource).toContain("client_id uuid not null references public.clients(id)");
    expect(migrationSource).not.toContain("alter table public.projects add column");
  });

  it("enforces one active client per project and uses no hard-delete policy", () => {
    expect(migrationSource).toContain("idx_project_clients_one_active_per_project");
    expect(migrationSource).toContain("on public.project_clients(project_id)");
    expect(migrationSource).toContain("where status = 'active'");
    expect(migrationSource).not.toMatch(/for\s+delete/i);
    expect(projectClientRouteSource).not.toContain("export async function DELETE");
  });

  it("limits RLS to owner/admin/manager and keeps public/worker/supervisor denied", () => {
    expect(migrationSource).toContain("alter table public.project_clients enable row level security");
    expect(migrationSource).toContain("project_clients_owner_admin_manager_select");
    expect(migrationSource).toContain("project_clients_owner_admin_manager_insert");
    expect(migrationSource).toContain("project_clients_owner_admin_manager_update");
    expect(migrationSource).toContain("actor.role in ('owner', 'admin', 'manager')");
    expect(migrationSource).toContain("grant select, insert, update on public.project_clients to authenticated");
    expect(migrationSource).not.toContain("'worker'");
    expect(migrationSource).not.toContain("'supervisor'");
    expect(migrationSource).not.toContain(" to anon");
    expect(migrationSource).not.toMatch(/to\s+public/i);
    expect(projectClientRouteSource).toContain("requireManagerContext");
  });
});

describe("Alpha-8 Phase 1B link helpers", () => {
  it("shows linked inactive clients but excludes inactive clients from new-link picker options", () => {
    const inactiveClient = client({
      id: "client-2",
      name: "Dormant Client",
      status: "inactive",
    });
    const summary = buildProjectClientSummary({
      link: link({ client_id: "client-2" }),
      clients: [inactiveClient],
      contacts: [],
    });

    expect(summary).toMatchObject({ id: "client-2", status: "inactive" });
    expect(buildProjectClientOptions([client({}), inactiveClient], [])).toEqual([
      expect.objectContaining({ id: "client-1", name: "Acme" }),
    ]);
  });

  it("builds client detail projects and replacement-aware project options", () => {
    const currentClient = client({ id: "client-1", name: "Acme" });
    const otherClient = client({ id: "client-2", name: "Other Builder" });
    const linkedProject = project({ id: "project-1", name: "Kitchen Remodel" });
    const replaceProject = project({ id: "project-2", name: "Bath Remodel" });
    const openProject = project({ id: "project-3", name: "Deck" });
    const currentLink = link({ id: "link-1", project_id: "project-1", client_id: "client-1" });
    const otherLink = link({ id: "link-2", project_id: "project-2", client_id: "client-2" });

    expect(buildClientLinkedProjects({
      clientId: "client-1",
      links: [currentLink, otherLink],
      projects: [linkedProject, replaceProject, openProject],
    })).toEqual([
      expect.objectContaining({ id: "project-1", name: "Kitchen Remodel" }),
    ]);

    expect(buildClientProjectOptions({
      currentClientId: "client-1",
      projects: [linkedProject, replaceProject, openProject, project({ id: "archived", status: "archived" })],
      activeLinks: [currentLink, otherLink],
      clients: [currentClient, otherClient],
    })).toEqual([
      expect.objectContaining({
        id: "project-2",
        activeClientId: "client-2",
        activeClientName: "Other Builder",
      }),
      expect.objectContaining({
        id: "project-3",
        activeClientId: null,
        activeClientName: null,
      }),
    ]);
  });

  it("uses primary contact data in project client options", () => {
    expect(buildProjectClientOptions(
      [client({ address: "10 Main" })],
      [contact({ name: "Primary Contact" })],
    )[0]).toMatchObject({
      primaryContactName: "Primary Contact",
      primaryContactPhone: "555-0100",
      primaryContactEmail: "ana@example.com",
    });
  });
});

describe("Alpha-8 Phase 1B UI and API surfaces", () => {
  it("adds project detail empty and linked client states", () => {
    expect(projectDetailRoutePageSource).toContain("buildProjectClientSummary");
    expect(projectDetailRoutePageSource).toContain("buildProjectClientOptions");
    expect(projectDetailRoutePageSource).toContain("projectClient={projectClient}");
    expect(projectDetailRoutePageSource).toContain("clientOptions={clientOptions}");
    expect(projectClientCardSource).toContain('t("projectClient.none")');
    expect(projectClientCardSource).toContain("projectClient.name");
    expect(projectClientCardSource).toContain('href={`/clients/${projectClient.id}`}');
    expect(projectClientCardSource).toContain('t("clients.openClient")');
    expect(projectClientCardSource).toContain('t("projectClient.change")');
    expect(projectClientCardSource).toContain('t("projectClient.unlink")');
  });

  it("replaces the client detail Projects placeholder with real projects and picker", () => {
    expect(clientProjectsTabSource).toContain("client.projects.length");
    expect(clientProjectsTabSource).toContain('t("clients.noLinkedProjects")');
    expect(clientProjectsTabSource).toContain('t("clients.linkProject")');
    expect(clientProjectsTabSource).toContain("visibleProjectOptions.map");
    expect(clientDetailSource).not.toContain('t("clients.projectPlaceholder")');
    expect(clientsDataSource).toContain("buildClientLinkedProjects");
    expect(clientsDataSource).toContain("buildClientProjectOptions");
  });

  it("requires confirm for client changes and soft-unlinks without deleting clients or projects", () => {
    expect(projectDetailSource).toContain('window.confirm(t("projectClient.changeConfirm")');
    expect(clientDetailSource).toContain('window.confirm(t("clients.linkProjectConfirm")');
    expect(projectDetailSource).toContain('window.confirm(t("projectClient.unlinkConfirm")');
    expect(projectClientRouteSource).toContain('status: "inactive"');
    expect(projectClientRouteSource).toContain('action: "client_project_unlinked"');
    expect(projectClientRouteSource).toContain('"client_project_changed"');
    expect(projectClientRouteSource).toContain('"client_project_linked"');
    expect(projectClientRouteSource).not.toContain(".delete()");
    expect(projectClientRouteSource).not.toContain(".from(\"clients\").delete");
    expect(projectClientRouteSource).not.toContain(".from(\"projects\").delete");
  });

  it("keeps project/client link UI free of excluded product areas", () => {
    const linkSurface = `${projectClientCardSource}\n${clientProjectsTabSource}\n${projectClientRouteSource}`.toLowerCase();
    for (const forbidden of [
      "payroll",
      "gps",
      "margin",
      "worker rate",
      "hourly_rate",
      "invoice",
      "estimate",
      "payment",
      "client portal",
      "jarvis",
      "href=\"/ai\"",
      "ai_analysis",
    ]) {
      expect(linkSurface).not.toContain(forbidden);
    }
  });

  it("keeps Clients Foundation and project detail routes wired", () => {
    expect(clientsDataSource).toContain("getClientsDirectoryData");
    expect(clientsDataSource).toContain("getClientDetailData");
    expect(projectDetailRoutePageSource).toContain("<ProjectDetailPage");
    expect(managerLayoutSource).toContain('"project_clients"');
  });
});

describe("Alpha-8 Phase 1B docs map", () => {
  it("records manual migration verification, integration status, and explicit exclusions", () => {
    expect(docsMapSource).toContain("Alpha-8 Phase 1B — Client Project Link");
    expect(docsMapSource).toContain("Storage model selected: additive `project_clients` table");
    expect(docsMapSource).toContain("DB migration 00033 manually applied in production Supabase by owner");
    expect(docsMapSource).toContain("`project_clients` table verified: exists, row count = 0, RLS enabled");
    expect(docsMapSource).toContain("Phase 1B code integrated into `fix/postdeploy-qa-audit-patches`");
    expect(docsMapSource).toContain("Production deploy pending after preview QA and owner approval");
    expect(docsMapSource).toContain("Migration history not repaired; do not run `supabase db push`");
    expect(docsMapSource).toContain("No Project Finance Folder yet");
    for (const exclusion of [
      "estimates",
      "invoices",
      "client portal",
      "AI/Jarvis",
      "margin",
      "payroll",
      "GPS exposure",
      "worker rates",
    ]) {
      expect(docsMapSource).toContain(exclusion);
    }
  });
});
