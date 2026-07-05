"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { TextInputWithVoice } from "@/components/shared/TextInputWithVoice";
import { STORE_CHAINS } from "@/lib/store-types";
import type { SupplyStore } from "@/lib/store-types";
import { CHAIN_COLORS, CHAIN_INITIALS } from "@/lib/store-types";

export default function StoresPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { t } = useTranslation();
  const [stores, setStores] = useState<SupplyStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("supply_stores")
        .select("*")
        .order("chain")
        .order("name");
      setStores((data as SupplyStore[]) ?? []);
      setLoading(false);
    }
    void load();
  }, [supabase]);

  async function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fd = new FormData(form);
    const chain = fd.get("chain")?.toString() ?? "";
    const name = fd.get("name")?.toString().trim() ?? "";
    const address = fd.get("address")?.toString().trim() ?? "";
    const lat = Number.parseFloat(fd.get("lat")?.toString() ?? "");
    const lng = Number.parseFloat(fd.get("lng")?.toString() ?? "");
    const phone = fd.get("phone")?.toString().trim() ?? "";

    if (!name || !chain || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      setMessage("Name, chain, and coordinates are required.");
      return;
    }

    setBusyKey("add");
    const { data, error } = await supabase
      .from("supply_stores")
      .insert({
        chain,
        name,
        address: address || null,
        lat,
        lng,
        phone: phone || null,
        place_id: null,
        is_active: true,
      })
      .select("*")
      .single();

    if (error || !data) {
      setMessage(error?.message ?? "Failed to add store.");
      setBusyKey(null);
      return;
    }

    setStores((prev) => [...prev, data as SupplyStore]);
    form.reset();
    setBusyKey(null);
    setMessage("");
    router.refresh();
  }

  async function handleToggle(storeId: string, isActive: boolean) {
    setBusyKey(`toggle-${storeId}`);
    setMessage("");
    const { error } = await supabase
      .from("supply_stores")
      .update({ is_active: !isActive })
      .eq("id", storeId);
    if (error) {
      setMessage(error.message || t("stores.toggleFailed"));
      setBusyKey(null);
      return;
    }
    setStores((prev) =>
      prev.map((s) => (s.id === storeId ? { ...s, is_active: !isActive } : s)),
    );
    setBusyKey(null);
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5">
      <section className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          {t("stores.title")}
        </p>
        <h1 className="text-[28px] font-bold text-[var(--text-primary)]">
          {t("stores.title")}
        </h1>
        <p className="max-w-[60ch] text-sm leading-6 text-[var(--text-secondary)]">
          {t("stores.description")}
        </p>
      </section>

      {message ? (
        <div
          className="rounded-[var(--radius-md)] px-3 py-3 text-sm"
          style={{ background: "rgba(191, 162, 52, 0.12)", color: "var(--brand-yellow)" }}
        >
          {message}
        </div>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        {/* Store list */}
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("stores.title")}</h2>
            <div className="text-xs text-[var(--text-muted)]">{stores.length} stores</div>
          </div>
          <div className="mt-4 space-y-2">
            {loading ? (
              <div className="text-sm text-[var(--text-secondary)]">{t("common.loading")}</div>
            ) : stores.length === 0 ? (
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
                {t("stores.empty")}
              </div>
            ) : (
              stores.map((store) => {
                const color = CHAIN_COLORS[store.chain] ?? "#6B7280";
                const initials = CHAIN_INITIALS[store.chain] ?? "?";
                return (
                  <div
                    key={store.id}
                    className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
                    style={{ opacity: store.is_active ? 1 : 0.5 }}
                  >
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                      style={{ background: color }}
                    >
                      {initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-[var(--text-primary)]">{store.name}</div>
                      <div className="text-xs text-[var(--text-muted)]">
                        {store.address}
                        {store.phone ? ` • ${store.phone}` : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleToggle(store.id, store.is_active)}
                      disabled={busyKey === `toggle-${store.id}`}
                      className="shrink-0 rounded-[var(--radius-sm)] border px-2 py-1 text-[10px] font-semibold"
                      style={{
                        borderColor: store.is_active ? "rgba(212, 81, 94, 0.3)" : "rgba(15, 168, 120, 0.3)",
                        color: store.is_active ? "var(--red)" : "var(--green)",
                      }}
                    >
                      {store.is_active ? t("stores.deactivate") : t("stores.activate")}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Add store form */}
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("stores.addStore")}</h2>
          <form className="mt-4 grid gap-3" onSubmit={handleAdd}>
            <select
              name="chain"
              required
              defaultValue=""
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            >
              <option value="" disabled>{t("stores.chain")}</option>
              {STORE_CHAINS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <TextInputWithVoice
              name="name"
              required
              placeholder={t("stores.storeName")}
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            />
            <TextInputWithVoice
              name="address"
              placeholder={t("common.address")}
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                name="lat"
                type="text"
                inputMode="decimal"
                required
                placeholder={t("projects.latitude")}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              />
              <input
                name="lng"
                type="text"
                inputMode="decimal"
                required
                placeholder={t("projects.longitude")}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              />
            </div>
            <TextInputWithVoice
              name="phone"
              placeholder={t("stores.phone")}
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            />
            <button
              type="submit"
              disabled={busyKey === "add"}
              className="rounded-[var(--radius-sm)] px-4 py-3 text-sm font-semibold"
              style={{
                background: busyKey === "add" ? "var(--border-default)" : "var(--brand-yellow)",
                color: busyKey === "add" ? "var(--text-muted)" : "var(--text-inverse)",
              }}
            >
              {busyKey === "add" ? t("common.creating") : t("stores.addStore")}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
