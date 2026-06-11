import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildClientListItems,
  validateClientContactSaveBody,
  validateClientSaveBody,
} from "@/lib/client-directory";
import type { BusinessClient, ClientContact } from "@/types/database";

function readSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const migrationSource = readSource("supabase/migrations/00032_alpha8_clients_foundation.sql");
const layoutSource = readSource("src/app/(manager)/layout.tsx");
const listRouteSource = readSource("src/app/(manager)/clients/page.tsx");
const detailRouteSource = readSource("src/app/(manager)/clients/[id]/page.tsx");
const dataSource = readSource("src/lib/clients-data.ts");
const listPageSource = readSource("src/components/manager/ClientsPage.tsx");
const detailPageSource = readSource("src/components/manager/ClientDetailPage.tsx");
const clientApiSource = readSource("src/app/api/manager/clients/route.ts");
const clientDetailApiSource = readSource("src/app/api/manager/clients/[id]/route.ts");
const contactsApiSource = readSource("src/app/api/manager/clients/[id]/contacts/route.ts");
const docsMapSource = readSource("docs/Карта проекта.md");

describe("Alpha-8 clients database foundation", () => {
  it("adds clients and client_contacts tables without project linking", () => {
    expect(migrationSource).toContain("create table if not exists public.clients");
    expect(migrationSource).toContain("create table if not exists public.client_contacts");
    expect(migrationSource).toContain("primary_contact_name text");
    expect(migrationSource).toContain("internal_note text");
    expect(migrationSource).toContain("client_id uuid not null references public.clients(id)");
    expect(migrationSource).not.toContain("project_clients");
  });

  it("uses active/inactive status constraints and no hard-delete policy", () => {
    expect(migrationSource).toContain("clients_status_check check (status in ('active', 'inactive'))");
    expect(migrationSource).toContain("client_contacts_status_check check (status in ('active', 'inactive'))");
    expect(migrationSource).not.toMatch(/for\s+delete/i);
    expect(clientDetailApiSource).not.toContain("export async function DELETE");
  });

  it("adds org-scoped RLS for owner/admin/manager only", () => {
    expect(migrationSource).toContain("alter table public.clients enable row level security");
    expect(migrationSource).toContain("alter table public.client_contacts enable row level security");
    expect(migrationSource).toContain("clients_owner_admin_manager_select");
    expect(migrationSource).toContain("clients_owner_admin_manager_insert");
    expect(migrationSource).toContain("clients_owner_admin_manager_update");
    expect(migrationSource).toContain("client_contacts_owner_admin_manager_select");
    expect(migrationSource).toContain("client_contacts_owner_admin_manager_insert");
    expect(migrationSource).toContain("client_contacts_owner_admin_manager_update");
    expect(migrationSource).toContain("actor.role in ('owner', 'admin', 'manager')");
    expect(migrationSource).not.toContain("public.is_manager()");
    expect(migrationSource).not.toContain("'supervisor'");
  });

  it("does not change storage policies or expose public client access", () => {
    expect(migrationSource).not.toContain("storage.objects");
    expect(migrationSource).not.toMatch(/bucket/i);
    expect(migrationSource).not.toContain("'client'");
  });
});

describe("Alpha-8 clients route and UI foundation", () => {
  it("adds protected manager clients routes", () => {
    expect(listRouteSource).toContain("getClientsDirectoryData");
    expect(listRouteSource).toContain("<ClientsPage");
    expect(detailRouteSource).toContain("getClientDetailData");
    expect(detailRouteSource).toContain("<ClientDetailPage");
    expect(dataSource).toContain("requireManagerContext");
  });

  it("adds desktop and mobile manager nav entries plus realtime refresh tables", () => {
    expect(layoutSource).toContain('href: "/clients"');
    expect(layoutSource).toContain('labelKey: "manager.navClients"');
    expect(layoutSource).toContain('{ href: "/clients", icon: "profile", labelKey: "manager.navClients" }');
    expect(layoutSource.indexOf('{ href: "/projects", icon: "projects", labelKey: "manager.navProjects" }'))
      .toBeLessThan(layoutSource.indexOf('{ href: "/clients", icon: "profile", labelKey: "manager.navClients" }'));
    expect(layoutSource).toContain('clients: ["clients", "client_contacts", "project_clients", "audit_log"]');
    expect(layoutSource).toContain('pathname.startsWith("/clients")');
  });

  it("keeps the client list free of money, payroll, GPS, margin, portal, and AI columns", () => {
    const clientUi = `${listPageSource}\n${detailPageSource}`.toLowerCase();
    expect(clientUi).not.toContain("payroll");
    expect(clientUi).not.toContain("gps");
    expect(clientUi).not.toContain("margin");
    expect(clientUi).not.toContain("invoice");
    expect(clientUi).not.toContain("estimate");
    expect(clientUi).not.toContain("payment");
    expect(clientUi).not.toContain("client portal");
    expect(clientUi).not.toContain("jarvis");
    expect(clientUi).not.toContain('href="/ai"');
  });

  it("renders the required client detail tabs and distinct empty states", () => {
    expect(detailPageSource).toContain('"clients.overview"');
    expect(detailPageSource).toContain('"clients.contacts"');
    expect(detailPageSource).toContain('"clients.projects"');
    expect(detailPageSource).toContain('"clients.notes"');
    expect(detailPageSource).toContain('"clients.activity"');
    expect(detailPageSource).toContain('t("clients.noLinkedProjects")');
    expect(detailPageSource).toContain('t("clients.linkProject")');
    expect(detailPageSource).not.toContain('t("clients.projectPlaceholder")');
    expect(detailPageSource).toContain('t("clients.noNotes")');
    expect(detailPageSource).toContain('t("clients.noActivity")');
    expect(detailPageSource).not.toContain('client.internal_note ?? t("clients.noActivity")');
  });

  it("labels overview metadata as a record while keeping the real Activity tab", () => {
    expect(detailPageSource).toContain('t("clients.record")');
    expect(detailPageSource).toContain('t("clients.createdAt")');
    expect(detailPageSource).toContain('t("clients.updatedAt")');
    expect(detailPageSource).not.toContain('<h2 className="text-lg font-bold text-[var(--text-primary)]">{t("clients.activity")}</h2>');
    expect(detailPageSource).toContain('{ id: "activity", labelKey: "clients.activity" }');
  });

  it("writes client audit events through the existing audit helper", () => {
    expect(clientApiSource).toContain("logAuditServer");
    expect(clientApiSource).toContain('action: "client_created"');
    expect(clientDetailApiSource).toContain("const deactivated =");
    expect(clientDetailApiSource).toContain('validation.payload.status === "inactive"');
    expect(clientDetailApiSource).toContain('"client_deactivated"');
    expect(clientDetailApiSource).toContain('"client_updated"');
    expect(contactsApiSource).toContain('action: "client_contact_created"');
  });
});

describe("Alpha-8 clients validation helpers", () => {
  it("requires a client name and normalizes optional fields", () => {
    expect(validateClientSaveBody({ name: " " }).ok).toBe(false);
    const result = validateClientSaveBody({
      name: "  Acme Builders  ",
      status: "inactive",
      primaryContactName: "  Ana  ",
      primaryContactPhone: "",
      primaryContactEmail: "ana@example.com",
      address: "  10 Main  ",
      internalNote: "  Prefers SMS  ",
    });
    expect(result).toEqual({
      ok: true,
      payload: {
        name: "Acme Builders",
        status: "inactive",
        primary_contact_name: "Ana",
        primary_contact_phone: null,
        primary_contact_email: "ana@example.com",
        address: "10 Main",
        internal_note: "Prefers SMS",
      },
    });
  });

  it("requires a contact name and keeps invalid status safe", () => {
    expect(validateClientContactSaveBody({ name: "" }).ok).toBe(false);
    const result = validateClientContactSaveBody({
      name: "  Sam  ",
      title: "  PM  ",
      phone: "555",
      email: "",
      isPrimary: true,
      status: "deleted",
    });
    expect(result).toEqual({
      ok: true,
      payload: {
        name: "Sam",
        title: "PM",
        phone: "555",
        email: null,
        is_primary: true,
        status: "active",
      },
    });
  });

  it("builds list items with contact counts and active primary contact", () => {
    const now = "2026-05-31T00:00:00.000Z";
    const client: BusinessClient = {
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
    };
    const contacts: ClientContact[] = [
      {
        id: "contact-1",
        org_id: "org-1",
        client_id: "client-1",
        name: "First",
        title: null,
        phone: null,
        email: null,
        is_primary: false,
        status: "active",
        created_at: now,
        updated_at: now,
      },
      {
        id: "contact-2",
        org_id: "org-1",
        client_id: "client-1",
        name: "Primary",
        title: null,
        phone: null,
        email: null,
        is_primary: true,
        status: "active",
        created_at: now,
        updated_at: now,
      },
    ];

    expect(buildClientListItems([client], contacts)).toMatchObject([
      {
        id: "client-1",
        contactCount: 2,
        primaryContact: { id: "contact-2", name: "Primary" },
      },
    ]);
  });
});

describe("Alpha-8 project map update", () => {
  it("records Phase 1A scope, deployment, and exclusions", () => {
    expect(docsMapSource).toContain("Alpha-8 Phase 1A — Clients Foundation");
    expect(docsMapSource).toContain("project_clients UI");
    expect(docsMapSource).toContain("estimates");
    expect(docsMapSource).toContain("client portal");
    expect(docsMapSource).toContain("production deploy: dpl_4XBmujHLybrcCgXWqBLaHTM8fbYz");
    expect(docsMapSource).toContain("production commit: 5f605ddde9d33e77fd0349f09b6f01ca0170ab2d");
  });
});
