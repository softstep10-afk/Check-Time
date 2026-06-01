"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import type { ClientListItem } from "@/lib/client-directory";
import type { ClientStatus } from "@/types/database";

type Filter = "all" | ClientStatus;

function formatDate(value: string): string {
  return value.slice(0, 10);
}

function ClientForm({
  onCancel,
  onSaved,
}: {
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
        const response = await fetch("/api/manager/clients", {
          method: "POST",
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
    <form onSubmit={handleSubmit} className="mt-4 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-xs font-semibold text-[var(--text-secondary)]">
          {t("clients.clientName")}
          <input name="name" required className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)]" />
        </label>
        <label className="text-xs font-semibold text-[var(--text-secondary)]">
          {t("clients.status")}
          <select name="status" defaultValue="active" className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)]">
            <option value="active">{t("common.active")}</option>
            <option value="inactive">{t("common.inactive")}</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-[var(--text-secondary)]">
          {t("clients.primaryContactName")}
          <input name="primaryContactName" className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)]" />
        </label>
        <label className="text-xs font-semibold text-[var(--text-secondary)]">
          {t("clients.primaryContactPhone")}
          <input name="primaryContactPhone" className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)]" />
        </label>
        <label className="text-xs font-semibold text-[var(--text-secondary)]">
          {t("clients.primaryContactEmail")}
          <input name="primaryContactEmail" type="email" className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)]" />
        </label>
        <label className="text-xs font-semibold text-[var(--text-secondary)]">
          {t("common.address")}
          <input name="address" className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)]" />
        </label>
      </div>
      <label className="mt-3 block text-xs font-semibold text-[var(--text-secondary)]">
        {t("clients.internalNote")}
        <textarea name="internalNote" rows={3} className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)]" />
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

export function ClientsPage({ clients }: { clients: ClientListItem[] }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [showCreate, setShowCreate] = useState(false);

  const visibleClients = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return clients.filter((client) => {
      if (filter !== "all" && client.status !== filter) return false;
      if (!needle) return true;
      return [
        client.name,
        client.primary_contact_name,
        client.primary_contact_phone,
        client.primary_contact_email,
        client.address,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [clients, filter, query]);

  function handleSaved() {
    setShowCreate(false);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--brand-yellow)]">
            Alpha-8
          </div>
          <h1 className="mt-1 text-3xl font-bold text-[var(--text-primary)]">{t("clients.title")}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
            {t("clients.description")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((value) => !value)}
          className="button-base button-primary px-3 py-2 text-sm"
        >
          <Plus size={16} />
          {t("clients.newClient")}
        </button>
      </header>

      {showCreate ? <ClientForm onCancel={() => setShowCreate(false)} onSaved={handleSaved} /> : null}

      <section className="mt-5 rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 text-[var(--text-muted)]" size={16} />
            <span className="sr-only">{t("clients.search")}</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("clients.search")}
              className="w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-primary)] py-2 pl-9 pr-3 text-sm text-[var(--text-primary)]"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {([
              ["all", t("clients.filterAll")],
              ["active", t("clients.filterActive")],
              ["inactive", t("clients.filterInactive")],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className="rounded-[var(--radius-pill)] border px-3 py-1.5 text-xs font-semibold"
                style={{
                  borderColor: filter === value ? "var(--brand-yellow)" : "var(--border-default)",
                  color: filter === value ? "var(--brand-yellow)" : "var(--text-secondary)",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          {visibleClients.length === 0 ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4 text-sm text-[var(--text-secondary)]">
              {t("clients.noClients")}
            </div>
          ) : (
            visibleClients.map((client) => (
              <Link
                key={client.id}
                href={`/clients/${client.id}`}
                className="block rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4 transition hover:border-[var(--brand-yellow)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-lg font-bold text-[var(--text-primary)]">{client.name}</h2>
                      <span
                        className="rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]"
                        style={{
                          background: client.status === "active" ? "rgba(15, 168, 120, 0.14)" : "rgba(107, 114, 128, 0.18)",
                          color: client.status === "active" ? "var(--green)" : "var(--text-muted)",
                        }}
                      >
                        {client.status === "active" ? t("common.active") : t("common.inactive")}
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-[var(--text-secondary)]">
                      {client.primaryContact?.name ?? client.primary_contact_name ?? t("clients.noContacts")}
                    </div>
                    <div className="mt-1 text-xs text-[var(--text-muted)]">
                      {client.address ?? t("common.noAddressSet")}
                    </div>
                  </div>
                  <div className="text-right text-xs text-[var(--text-muted)]">
                    <div>{t("clients.contactCount")}: {client.contactCount}</div>
                    <div>{formatDate(client.updated_at)}</div>
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
