"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import type { ClientDetail } from "@/lib/client-directory";
import type { TranslationKey } from "@/lib/i18n";
import type { ClientStatus } from "@/types/database";

type ClientTab = "overview" | "contacts" | "projects" | "notes" | "activity";

const CLIENT_TABS: { id: ClientTab; labelKey: TranslationKey }[] = [
  { id: "overview", labelKey: "clients.overview" },
  { id: "contacts", labelKey: "clients.contacts" },
  { id: "projects", labelKey: "clients.projects" },
  { id: "notes", labelKey: "clients.notes" },
  { id: "activity", labelKey: "clients.activity" },
];

function formatDate(value: string): string {
  return value.slice(0, 10);
}

function formatDateTime(value: string): string {
  return value.replace("T", " ").slice(0, 16);
}

function empty(value: string | null): string {
  return value ?? "-";
}

function ClientEditForm({
  client,
  onCancel,
  onSaved,
}: {
  client: ClientDetail;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    if (!name) {
      setError(t("clients.nameRequired"));
      return;
    }
    setError("");
    startTransition(() => {
      void (async () => {
        const response = await fetch(`/api/manager/clients/${client.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            status: form.get("status"),
            primaryContactName: form.get("primaryContactName"),
            primaryContactPhone: form.get("primaryContactPhone"),
            primaryContactEmail: form.get("primaryContactEmail"),
            address: form.get("address"),
            internalNote: form.get("internalNote"),
          }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          setError(payload?.error ?? t("clients.saveFailed"));
          return;
        }
        onSaved();
      })();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-xs font-semibold text-[var(--text-secondary)]">
          {t("clients.clientName")}
          <input name="name" required defaultValue={client.name} className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)]" />
        </label>
        <label className="text-xs font-semibold text-[var(--text-secondary)]">
          {t("clients.status")}
          <select name="status" defaultValue={client.status} className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)]">
            <option value="active">{t("common.active")}</option>
            <option value="inactive">{t("common.inactive")}</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-[var(--text-secondary)]">
          {t("clients.primaryContactName")}
          <input name="primaryContactName" defaultValue={client.primary_contact_name ?? ""} className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)]" />
        </label>
        <label className="text-xs font-semibold text-[var(--text-secondary)]">
          {t("clients.primaryContactPhone")}
          <input name="primaryContactPhone" defaultValue={client.primary_contact_phone ?? ""} className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)]" />
        </label>
        <label className="text-xs font-semibold text-[var(--text-secondary)]">
          {t("clients.primaryContactEmail")}
          <input name="primaryContactEmail" type="email" defaultValue={client.primary_contact_email ?? ""} className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)]" />
        </label>
        <label className="text-xs font-semibold text-[var(--text-secondary)]">
          {t("common.address")}
          <input name="address" defaultValue={client.address ?? ""} className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)]" />
        </label>
      </div>
      <label className="mt-3 block text-xs font-semibold text-[var(--text-secondary)]">
        {t("clients.internalNote")}
        <textarea name="internalNote" rows={3} defaultValue={client.internal_note ?? ""} className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)]" />
      </label>
      {error ? <div className="mt-3 text-sm font-semibold text-[var(--red)]">{error}</div> : null}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className="button-base button-secondary px-3 py-2 text-sm">
          {t("common.cancel")}
        </button>
        <button type="submit" disabled={pending} className="button-base button-primary px-3 py-2 text-sm disabled:opacity-50">
          {pending ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </form>
  );
}

function ContactForm({
  clientId,
  onCancel,
  onSaved,
}: {
  clientId: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    if (!name) {
      setError(t("clients.contactNameRequired"));
      return;
    }
    setError("");
    startTransition(() => {
      void (async () => {
        const response = await fetch(`/api/manager/clients/${clientId}/contacts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            title: form.get("title"),
            phone: form.get("phone"),
            email: form.get("email"),
            isPrimary: form.get("isPrimary") === "on",
            status: "active",
          }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          setError(payload?.error ?? t("clients.contactSaveFailed"));
          return;
        }
        onSaved();
      })();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-xs font-semibold text-[var(--text-secondary)]">
          {t("clients.contactName")}
          <input name="name" required className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)]" />
        </label>
        <label className="text-xs font-semibold text-[var(--text-secondary)]">
          {t("clients.contactTitle")}
          <input name="title" className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)]" />
        </label>
        <label className="text-xs font-semibold text-[var(--text-secondary)]">
          {t("clients.phone")}
          <input name="phone" className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)]" />
        </label>
        <label className="text-xs font-semibold text-[var(--text-secondary)]">
          {t("clients.email")}
          <input name="email" type="email" className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)]" />
        </label>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-[var(--text-secondary)]">
        <input name="isPrimary" type="checkbox" className="h-4 w-4" />
        {t("clients.makePrimary")}
      </label>
      {error ? <div className="mt-3 text-sm font-semibold text-[var(--red)]">{error}</div> : null}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className="button-base button-secondary px-3 py-2 text-sm">
          {t("common.cancel")}
        </button>
        <button type="submit" disabled={pending} className="button-base button-primary px-3 py-2 text-sm disabled:opacity-50">
          {pending ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </form>
  );
}

export function ClientDetailPage({ client }: { client: ClientDetail }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<ClientTab>("overview");
  const [editing, setEditing] = useState(false);
  const [showContactForm, setShowContactForm] = useState(false);
  const [deactivationPending, startDeactivation] = useTransition();
  const [error, setError] = useState("");

  function refreshAfterSave() {
    setEditing(false);
    setShowContactForm(false);
    router.refresh();
  }

  function deactivateClient() {
    if (!window.confirm(t("clients.deactivateConfirm"))) return;
    setError("");
    startDeactivation(() => {
      void (async () => {
        const response = await fetch(`/api/manager/clients/${client.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: client.name,
            status: "inactive" satisfies ClientStatus,
            primaryContactName: client.primary_contact_name,
            primaryContactPhone: client.primary_contact_phone,
            primaryContactEmail: client.primary_contact_email,
            address: client.address,
            internalNote: client.internal_note,
          }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          setError(payload?.error ?? t("clients.saveFailed"));
          return;
        }
        router.refresh();
      })();
    });
  }

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--brand-yellow)]">
            {t("clients.subtitle")}
          </div>
          <h1 className="mt-1 text-3xl font-bold text-[var(--text-primary)]">{client.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[var(--text-secondary)]">
            <span
              className="rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]"
              style={{
                background: client.status === "active" ? "rgba(15, 168, 120, 0.14)" : "rgba(107, 114, 128, 0.18)",
                color: client.status === "active" ? "var(--green)" : "var(--text-muted)",
              }}
            >
              {client.status === "active" ? t("common.active") : t("common.inactive")}
            </span>
            <span>{empty(client.address)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setEditing((value) => !value)} className="button-base button-secondary px-3 py-2 text-sm">
            {t("clients.editClient")}
          </button>
          {client.status === "active" ? (
            <button type="button" onClick={deactivateClient} disabled={deactivationPending} className="button-base button-danger px-3 py-2 text-sm disabled:opacity-50">
              {t("clients.deactivate")}
            </button>
          ) : null}
        </div>
      </header>

      {error ? <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--red)] bg-[rgba(220,38,38,0.08)] p-3 text-sm font-semibold text-[var(--red)]">{error}</div> : null}
      {editing ? (
        <div className="mt-4">
          <ClientEditForm client={client} onCancel={() => setEditing(false)} onSaved={refreshAfterSave} />
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2 border-b border-[var(--border-default)] pb-2">
        {CLIENT_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className="rounded-[var(--radius-pill)] border px-3 py-1.5 text-xs font-semibold"
            style={{
              borderColor: activeTab === tab.id ? "var(--brand-yellow)" : "var(--border-default)",
              color: activeTab === tab.id ? "var(--brand-yellow)" : "var(--text-secondary)",
            }}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      {activeTab === "overview" ? (
        <section className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
            <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("clients.primaryContact")}</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div><dt className="text-xs font-semibold uppercase text-[var(--text-muted)]">{t("clients.primaryContactName")}</dt><dd className="text-[var(--text-primary)]">{empty(client.primary_contact_name)}</dd></div>
              <div><dt className="text-xs font-semibold uppercase text-[var(--text-muted)]">{t("clients.primaryContactPhone")}</dt><dd className="text-[var(--text-primary)]">{empty(client.primary_contact_phone)}</dd></div>
              <div><dt className="text-xs font-semibold uppercase text-[var(--text-muted)]">{t("clients.primaryContactEmail")}</dt><dd className="text-[var(--text-primary)]">{empty(client.primary_contact_email)}</dd></div>
            </dl>
          </div>
          <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
            <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("clients.activity")}</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div><dt className="text-xs font-semibold uppercase text-[var(--text-muted)]">{t("clients.status")}</dt><dd className="text-[var(--text-primary)]">{client.status}</dd></div>
              <div><dt className="text-xs font-semibold uppercase text-[var(--text-muted)]">Created</dt><dd className="text-[var(--text-primary)]">{formatDate(client.created_at)}</dd></div>
              <div><dt className="text-xs font-semibold uppercase text-[var(--text-muted)]">Updated</dt><dd className="text-[var(--text-primary)]">{formatDate(client.updated_at)}</dd></div>
            </dl>
          </div>
        </section>
      ) : null}

      {activeTab === "contacts" ? (
        <section className="mt-4 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("clients.contacts")}</h2>
            <button type="button" onClick={() => setShowContactForm((value) => !value)} className="button-base button-secondary px-3 py-2 text-sm">
              <Plus size={16} />
              {t("clients.addContact")}
            </button>
          </div>
          {showContactForm ? <ContactForm clientId={client.id} onCancel={() => setShowContactForm(false)} onSaved={refreshAfterSave} /> : null}
          <div className="mt-4 grid gap-3">
            {client.contacts.length === 0 ? (
              <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4 text-sm text-[var(--text-secondary)]">
                {t("clients.noContacts")}
              </div>
            ) : (
              client.contacts.map((contact) => (
                <div key={contact.id} className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-[var(--text-primary)]">{contact.name}</div>
                      <div className="text-sm text-[var(--text-secondary)]">{empty(contact.title)}</div>
                    </div>
                    {contact.is_primary ? (
                      <span className="rounded-[var(--radius-pill)] bg-[rgba(245,158,11,0.16)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--brand-yellow)]">
                        {t("clients.primaryContact")}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--text-secondary)]">
                    <span>{empty(contact.phone)}</span>
                    <span>{empty(contact.email)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      ) : null}

      {activeTab === "projects" ? (
        <section className="mt-4 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4 text-sm text-[var(--text-secondary)]">
          {t("clients.projectPlaceholder")}
        </section>
      ) : null}

      {activeTab === "notes" ? (
        <section className="mt-4 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4 text-sm leading-6 text-[var(--text-secondary)]">
          {client.internal_note ?? t("clients.noActivity")}
        </section>
      ) : null}

      {activeTab === "activity" ? (
        <section className="mt-4 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
          {client.activity.length === 0 ? (
            <div className="text-sm text-[var(--text-secondary)]">{t("clients.noActivity")}</div>
          ) : (
            <div className="space-y-3">
              {client.activity.map((item) => (
                <div key={item.id} className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3 text-sm">
                  <div className="font-semibold text-[var(--text-primary)]">{item.action}</div>
                  <div className="text-xs text-[var(--text-muted)]">
                    {item.actorName ?? t("common.user")} · {formatDateTime(item.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
