"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Calculator, ExternalLink, FileSpreadsheet, Lock, Plus, Save, Trash2 } from "lucide-react";
import { CollapsibleSection } from "@/components/shared/CollapsibleSection";
import { TextInputWithVoice } from "@/components/shared/TextInputWithVoice";
import { useTranslation } from "@/lib/i18n";
import {
  createProjectPlanningId,
  estimateMargin,
  parseMaterialSpecText,
  readProjectEstimations,
  readProjectMaterialSpec,
  type ProjectEstimate,
  type ProjectEstimateWorkItem,
  type ProjectMaterialSpecItem,
} from "@/lib/project-planning";

type ProjectPlanningSectionsProps = {
  projectId: string;
  projectSettings: Record<string, unknown> | null;
  hasFinanceAccess: boolean;
};

type EstimateDraft = {
  title: string;
  description: string;
  workTitle: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  materialCost: string;
  laborHours: string;
  internalCost: string;
};

const EMPTY_ESTIMATE_DRAFT: EstimateDraft = {
  title: "",
  description: "",
  workTitle: "",
  quantity: "1",
  unit: "item",
  unitPrice: "",
  materialCost: "",
  laborHours: "",
  internalCost: "",
};

function currency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function parseAmount(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function materialLinkHref(link: string): string | null {
  const trimmed = link.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("www.")) return `https://${trimmed}`;
  return null;
}

export function ProjectPlanningSections({
  projectId,
  projectSettings,
  hasFinanceAccess,
}: ProjectPlanningSectionsProps) {
  return (
    <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
      <ProjectMaterialSpecSection projectId={projectId} projectSettings={projectSettings} />
      <ProjectEstimatesSection
        projectId={projectId}
        projectSettings={projectSettings}
        hasFinanceAccess={hasFinanceAccess}
      />
    </div>
  );
}

function ProjectMaterialSpecSection({
  projectId,
  projectSettings,
}: {
  projectId: string;
  projectSettings: Record<string, unknown> | null;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<ProjectMaterialSpecItem[]>(() =>
    readProjectMaterialSpec(projectSettings),
  );
  const [importText, setImportText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setItems(readProjectMaterialSpec(projectSettings));
  }, [projectSettings]);

  async function saveItems(nextItems: ProjectMaterialSpecItem[]) {
    setBusy(true);
    setMessage("");
    const response = await fetch(`/api/manager/projects/${projectId}/planning`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ materialSpecItems: nextItems }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      materialSpecItems?: ProjectMaterialSpecItem[];
    };
    setBusy(false);
    if (!response.ok) {
      setMessage(payload.error ?? t("projectMaterials.saveFailed"));
      return;
    }
    setItems(payload.materialSpecItems ?? nextItems);
    setMessage(t("projectMaterials.saved"));
    router.refresh();
  }

  function updateItem(id: string, patch: Partial<ProjectMaterialSpecItem>) {
    const updatedAt = new Date().toISOString();
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch, updatedAt } : item)),
    );
  }

  function addEmptyItem() {
    const stamp = new Date().toISOString();
    setItems((current) => [
      ...current,
      {
        id: createProjectPlanningId("mat"),
        name: t("projectMaterials.newItem"),
        quantity: "",
        unit: "",
        supplier: "",
        link: "",
        note: "",
        category: "",
        createdAt: stamp,
        updatedAt: stamp,
      },
    ]);
  }

  function importRows(text: string) {
    const parsed = parseMaterialSpecText(text);
    if (parsed.length === 0) {
      setMessage(t("projectMaterials.nothingImported"));
      return;
    }
    setItems((current) => [...current, ...parsed]);
    setImportText("");
    setMessage(
      t("projectMaterials.imported").replace("{count}", String(parsed.length)),
    );
  }

  async function handleFileImport(file: File | null) {
    if (!file) return;
    if (!/\.(csv|tsv|txt)$/i.test(file.name)) {
      setMessage(t("projectMaterials.fileHint"));
      return;
    }
    importRows(await file.text());
  }

  return (
    <CollapsibleSection
      id="material-spec"
      projectId={projectId}
      defaultOpen={false}
      dataTestid="manager-project-material-spec"
      className="p-4"
      summary={
        <div>
          <h2 className="text-lg font-bold text-[var(--text-primary)]">
            {t("projectMaterials.title")}: {items.length}
          </h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {t("projectMaterials.subtitle")}
          </p>
        </div>
      }
      headerAction={({ setOpen }) => (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            addEmptyItem();
            setOpen(true);
          }}
          className="button-base button-secondary min-h-0 px-3 py-1.5 text-xs"
        >
          <Plus size={13} />
          {t("projectMaterials.add")}
        </button>
      )}
    >
      <div className="mt-4 grid gap-4">
        {message ? (
          <div className="surface-panel px-3 py-2 text-xs font-semibold text-[var(--text-secondary)]">
            {message}
          </div>
        ) : null}

        <div className="surface-panel grid gap-3 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                {t("projectMaterials.excelImport")}
              </div>
              <div className="mt-1 text-xs text-[var(--text-secondary)]">
                {t("projectMaterials.excelHint")}
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.tsv,.txt"
              className="hidden"
              onChange={(event) => {
                void handleFileImport(event.target.files?.[0] ?? null);
                event.currentTarget.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="button-base button-secondary min-h-0 px-3 py-2 text-xs"
            >
              <FileSpreadsheet size={14} />
              {t("projectMaterials.importFile")}
            </button>
          </div>
          <TextInputWithVoice
            multiline
            rows={4}
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            placeholder={t("projectMaterials.pastePlaceholder")}
            className="min-h-[110px] rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
          />
          <button
            type="button"
            onClick={() => importRows(importText)}
            disabled={!importText.trim()}
            className="button-base button-primary"
          >
            {t("projectMaterials.importRows")}
          </button>
        </div>

        {items.length === 0 ? (
          <div className="surface-panel p-3 text-sm text-[var(--text-secondary)]">
            {t("projectMaterials.empty")}
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => {
              const href = materialLinkHref(item.link);
              return (
                <div
                  key={item.id}
                  className="grid gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[rgba(15,17,23,0.36)] p-3"
                >
                  <div className="grid gap-2 md:grid-cols-[1.5fr_0.55fr_0.55fr_1fr]">
                    <TextInputWithVoice
                      value={item.name}
                      onChange={(event) => updateItem(item.id, { name: event.target.value })}
                      placeholder={t("projectMaterials.name")}
                      className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
                    />
                    <input
                      value={item.quantity}
                      onChange={(event) => updateItem(item.id, { quantity: event.target.value })}
                      placeholder={t("projectMaterials.qty")}
                      className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
                    />
                    <input
                      value={item.unit}
                      onChange={(event) => updateItem(item.id, { unit: event.target.value })}
                      placeholder={t("projectMaterials.unit")}
                      className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
                    />
                    <input
                      value={item.supplier}
                      onChange={(event) => updateItem(item.id, { supplier: event.target.value })}
                      placeholder={t("projectMaterials.supplier")}
                      className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
                    />
                  </div>
                  <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                    <input
                      value={item.link}
                      onChange={(event) => updateItem(item.id, { link: event.target.value })}
                      placeholder={t("projectMaterials.link")}
                      className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
                    />
                    <div className="flex gap-2">
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          className="button-base button-secondary min-h-0 px-3 py-2 text-xs"
                        >
                          <ExternalLink size={13} />
                          {t("common.open")}
                        </a>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setItems((current) => current.filter((row) => row.id !== item.id))}
                        className="button-base button-danger-ghost min-h-0 px-3 py-2 text-xs"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  <TextInputWithVoice
                    multiline
                    rows={2}
                    value={item.note}
                    onChange={(event) => updateItem(item.id, { note: event.target.value })}
                    placeholder={t("projectMaterials.note")}
                    className="min-h-[70px] rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
                  />
                </div>
              );
            })}
          </div>
        )}

        <button
          type="button"
          onClick={() => void saveItems(items)}
          disabled={busy}
          className="button-base button-primary"
        >
          <Save size={15} />
          {busy ? t("common.saving") : t("projectMaterials.save")}
        </button>
      </div>
    </CollapsibleSection>
  );
}

function ProjectEstimatesSection({
  projectId,
  projectSettings,
  hasFinanceAccess,
}: {
  projectId: string;
  projectSettings: Record<string, unknown> | null;
  hasFinanceAccess: boolean;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const [estimations, setEstimations] = useState<ProjectEstimate[]>(() =>
    readProjectEstimations(projectSettings),
  );
  const [draft, setDraft] = useState<EstimateDraft>(EMPTY_ESTIMATE_DRAFT);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setEstimations(readProjectEstimations(projectSettings));
  }, [projectSettings]);

  async function saveEstimations(nextEstimations: ProjectEstimate[]) {
    setBusy(true);
    setMessage("");
    const response = await fetch(`/api/manager/projects/${projectId}/planning`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estimations: nextEstimations }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      estimations?: ProjectEstimate[];
    };
    setBusy(false);
    if (!response.ok) {
      setMessage(payload.error ?? t("projectEstimates.saveFailed"));
      return;
    }
    setEstimations(payload.estimations ?? nextEstimations);
    setMessage(t("projectEstimates.saved"));
    router.refresh();
  }

  function addEstimate() {
    const title = draft.title.trim() || draft.workTitle.trim();
    if (!title) {
      setMessage(t("projectEstimates.titleRequired"));
      return;
    }
    const stamp = new Date().toISOString();
    const quantity = parseAmount(draft.quantity) || 1;
    const unitPrice = parseAmount(draft.unitPrice);
    const materialCost = parseAmount(draft.materialCost);
    const internalCost = parseAmount(draft.internalCost);
    const laborHours = parseAmount(draft.laborHours);
    const totalPrice = quantity * unitPrice;
    const workItem: ProjectEstimateWorkItem = {
      id: createProjectPlanningId("work"),
      title: draft.workTitle.trim() || title,
      description: draft.description.trim(),
      quantity,
      unit: draft.unit.trim() || "item",
      unitPrice,
      materialCost,
      laborHours,
      internalCost,
      totalPrice,
    };
    const estimate: ProjectEstimate = {
      id: createProjectPlanningId("est"),
      title,
      status: "draft",
      description: draft.description.trim(),
      clientPrice: totalPrice,
      materialCost,
      laborHours,
      internalCost,
      createdAt: stamp,
      updatedAt: stamp,
      items: [workItem],
    };
    setEstimations((current) => [estimate, ...current]);
    setDraft(EMPTY_ESTIMATE_DRAFT);
    setMessage(t("projectEstimates.draftAdded"));
  }

  if (!hasFinanceAccess) {
    return (
      <CollapsibleSection
        id="project-estimates"
        projectId={projectId}
        defaultOpen={false}
        dataTestid="manager-project-estimates-locked"
        className="p-4"
        summary={
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-[var(--text-primary)]">
              <Lock size={17} />
              {t("projectEstimates.title")}
            </h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {t("projectEstimates.locked")}
            </p>
          </div>
        }
      >
        <div className="mt-3 surface-panel p-3 text-sm text-[var(--text-secondary)]">
          {t("projectEstimates.financeOnly")}
        </div>
      </CollapsibleSection>
    );
  }

  return (
    <CollapsibleSection
      id="project-estimates"
      projectId={projectId}
      defaultOpen={false}
      dataTestid="manager-project-estimates"
      className="p-4"
      summary={
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-[var(--text-primary)]">
            <Calculator size={17} />
            {t("projectEstimates.title")}: {estimations.length}
          </h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {t("projectEstimates.subtitle")}
          </p>
        </div>
      }
    >
      <div className="mt-4 grid gap-4">
        {message ? (
          <div className="surface-panel px-3 py-2 text-xs font-semibold text-[var(--text-secondary)]">
            {message}
          </div>
        ) : null}
        <div className="surface-panel grid gap-3 p-3">
          <TextInputWithVoice
            value={draft.title}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
            placeholder={t("projectEstimates.estimateTitle")}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
          />
          <TextInputWithVoice
            multiline
            rows={3}
            value={draft.description}
            onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
            placeholder={t("projectEstimates.scope")}
            className="min-h-[90px] rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={draft.workTitle}
              onChange={(event) => setDraft((current) => ({ ...current, workTitle: event.target.value }))}
              placeholder={t("projectEstimates.workTitle")}
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            />
            <input
              value={draft.unit}
              onChange={(event) => setDraft((current) => ({ ...current, unit: event.target.value }))}
              placeholder={t("projectEstimates.unit")}
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            />
            <input
              value={draft.quantity}
              onChange={(event) => setDraft((current) => ({ ...current, quantity: event.target.value }))}
              inputMode="decimal"
              placeholder={t("projectEstimates.quantity")}
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            />
            <input
              value={draft.unitPrice}
              onChange={(event) => setDraft((current) => ({ ...current, unitPrice: event.target.value }))}
              inputMode="decimal"
              placeholder={t("projectEstimates.price")}
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            />
            <input
              value={draft.materialCost}
              onChange={(event) => setDraft((current) => ({ ...current, materialCost: event.target.value }))}
              inputMode="decimal"
              placeholder={t("projectEstimates.materialCost")}
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            />
            <input
              value={draft.internalCost}
              onChange={(event) => setDraft((current) => ({ ...current, internalCost: event.target.value }))}
              inputMode="decimal"
              placeholder={t("projectEstimates.internalCost")}
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            />
          </div>
          <button type="button" onClick={addEstimate} className="button-base button-secondary">
            <Plus size={15} />
            {t("projectEstimates.addDraft")}
          </button>
        </div>

        {estimations.length === 0 ? (
          <div className="surface-panel p-3 text-sm text-[var(--text-secondary)]">
            {t("projectEstimates.empty")}
          </div>
        ) : (
          <div className="space-y-2">
            {estimations.map((estimate) => (
              <div
                key={estimate.id}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[rgba(15,17,23,0.36)] p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold text-[var(--text-primary)]">
                      {estimate.title}
                    </div>
                    {estimate.description ? (
                      <p className="mt-1 whitespace-pre-wrap text-xs text-[var(--text-secondary)]">
                        {estimate.description}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setEstimations((current) => current.filter((item) => item.id !== estimate.id))
                    }
                    className="button-base button-danger-ghost min-h-0 px-3 py-2 text-xs"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div className="metric-panel rounded-[var(--radius-sm)] p-2">
                    <div className="text-[9px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                      {t("projectEstimates.clientPrice")}
                    </div>
                    <div className="mt-1 font-mono font-bold text-[var(--text-primary)]">
                      {currency(estimate.clientPrice)}
                    </div>
                  </div>
                  <div className="metric-panel rounded-[var(--radius-sm)] p-2">
                    <div className="text-[9px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                      {t("projectEstimates.internalCostShort")}
                    </div>
                    <div className="mt-1 font-mono font-bold text-[var(--text-primary)]">
                      {currency(estimate.internalCost + estimate.materialCost)}
                    </div>
                  </div>
                  <div className="metric-panel rounded-[var(--radius-sm)] p-2">
                    <div className="text-[9px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                      {t("projectEstimates.margin")}
                    </div>
                    <div className="mt-1 font-mono font-bold text-[var(--ai-cyan)]">
                      {currency(estimateMargin(estimate))}
                    </div>
                  </div>
                </div>
                {estimate.items.length > 0 ? (
                  <div className="mt-2 space-y-1">
                    {estimate.items.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-[var(--radius-sm)] bg-[rgba(0,0,0,0.18)] px-2 py-1.5 text-xs text-[var(--text-secondary)]"
                      >
                        {item.title} · {item.quantity} {item.unit} · {currency(item.totalPrice)}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => void saveEstimations(estimations)}
          disabled={busy}
          className="button-base button-primary"
        >
          <Save size={15} />
          {busy ? t("common.saving") : t("projectEstimates.save")}
        </button>
      </div>
    </CollapsibleSection>
  );
}
