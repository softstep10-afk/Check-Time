"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, FileSpreadsheet, Lock, Paperclip, Plus, Save, Trash2, Upload, X } from "lucide-react";
import { CollapsibleSection } from "@/components/shared/CollapsibleSection";
import { TextInputWithVoice } from "@/components/shared/TextInputWithVoice";
import { type TranslationKey, useTranslation } from "@/lib/i18n";
import { uploadProjectPlanningAttachment } from "@/lib/project-planning-attachments";
import { ACCEPT_ALL_UPLOADS } from "@/lib/upload-limits";
import {
  createProjectPlanningId,
  parseMaterialSpecText,
  readProjectEstimations,
  readProjectMaterialSpec,
  type ProjectEstimate,
  type ProjectEstimateDocumentType,
  type ProjectPlanningAttachment,
  type ProjectMaterialSpecItem,
} from "@/lib/project-planning";
import { createClient } from "@/lib/supabase/client";
import { normalizeStoragePath } from "@/lib/task-attachments";

type ProjectPlanningSectionsProps = {
  orgId: string;
  projectId: string;
  managerId: string;
  projectSettings: Record<string, unknown> | null;
  hasFinanceAccess: boolean;
  canDeleteMedia: boolean;
};

type EstimateDraft = {
  documentType: ProjectEstimateDocumentType;
  status: ProjectEstimate["status"];
  attachmentName: string;
  attachmentUrl: string;
  attachmentNote: string;
  attachments: ProjectPlanningAttachment[];
};

const EMPTY_ESTIMATE_DRAFT: EstimateDraft = {
  documentType: "estimate",
  status: "draft",
  attachmentName: "",
  attachmentUrl: "",
  attachmentNote: "",
  attachments: [],
};

const ESTIMATE_DOCUMENT_TYPES: ProjectEstimateDocumentType[] = [
  "estimate",
  "invoice",
  "change_order",
  "extra_work",
];

const ESTIMATE_STATUSES: ProjectEstimate["status"][] = [
  "draft",
  "sent",
  "approved",
  "rejected",
  "done",
  "paid",
];

function materialLinkHref(link: string): string | null {
  const trimmed = link.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("www.")) return `https://${trimmed}`;
  return null;
}

function normalizeAttachmentUrl(link: string): string {
  const trimmed = link.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("www.")) return `https://${trimmed}`;
  return trimmed;
}

function buildDraftAttachment(draft: EstimateDraft): ProjectPlanningAttachment[] {
  const url = normalizeAttachmentUrl(draft.attachmentUrl);
  const name = draft.attachmentName.trim() || url;
  if (!name && !url) return draft.attachments;
  return [
    ...draft.attachments,
    {
      id: createProjectPlanningId("att"),
      name,
      url,
      kind: "link",
      note: draft.attachmentNote.trim(),
      createdAt: new Date().toISOString(),
    },
  ];
}

function isMediaPlanningAttachment(attachment: ProjectPlanningAttachment): boolean {
  return Boolean(attachment.mediaId || attachment.storagePath);
}

function estimateHasMediaAttachments(estimate: ProjectEstimate): boolean {
  return estimate.attachments.some(isMediaPlanningAttachment);
}

function estimateTypeKey(type: ProjectEstimateDocumentType): TranslationKey {
  return `projectEstimates.type.${type}` as TranslationKey;
}

function estimateStatusKey(status: ProjectEstimate["status"]): TranslationKey {
  return `projectEstimates.status.${status}` as TranslationKey;
}

export function ProjectPlanningSections({
  orgId,
  projectId,
  managerId,
  projectSettings,
  hasFinanceAccess,
  canDeleteMedia,
}: ProjectPlanningSectionsProps) {
  return (
    <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
      <ProjectMaterialSpecSection projectId={projectId} projectSettings={projectSettings} />
      <ProjectEstimatesSection
        orgId={orgId}
        projectId={projectId}
        managerId={managerId}
        projectSettings={projectSettings}
        hasFinanceAccess={hasFinanceAccess}
        canDeleteMedia={canDeleteMedia}
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
                  <div className="grid gap-2 md:grid-cols-[1fr_1.5fr_0.55fr_0.55fr_1fr]">
                    <input
                      value={item.category}
                      onChange={(event) => updateItem(item.id, { category: event.target.value })}
                      placeholder={t("projectMaterials.category")}
                      className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
                    />
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
  orgId,
  projectId,
  managerId,
  projectSettings,
  hasFinanceAccess,
  canDeleteMedia,
}: {
  orgId: string;
  projectId: string;
  managerId: string;
  projectSettings: Record<string, unknown> | null;
  hasFinanceAccess: boolean;
  canDeleteMedia: boolean;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const [supabase] = useState(() => createClient());
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const [estimations, setEstimations] = useState<ProjectEstimate[]>(() =>
    readProjectEstimations(projectSettings),
  );
  const [draft, setDraft] = useState<EstimateDraft>(EMPTY_ESTIMATE_DRAFT);
  const [busy, setBusy] = useState(false);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
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

  function addDraftLinkAttachment() {
    const url = normalizeAttachmentUrl(draft.attachmentUrl);
    const name = draft.attachmentName.trim() || url;
    if (!name && !url) {
      setMessage(t("projectEstimates.attachmentRequired"));
      return;
    }
    const attachment: ProjectPlanningAttachment = {
      id: createProjectPlanningId("att"),
      name,
      url,
      kind: "link",
      note: draft.attachmentNote.trim(),
      createdAt: new Date().toISOString(),
    };
    setDraft((current) => ({
      ...current,
      attachmentName: "",
      attachmentUrl: "",
      attachmentNote: "",
      attachments: [...current.attachments, attachment],
    }));
    setMessage(t("projectEstimates.attachmentAdded"));
  }

  async function addDraftFileAttachment(file: File | null) {
    if (!file) return;
    setAttachmentBusy(true);
    setMessage("");
    const result = await uploadProjectPlanningAttachment(supabase, {
      orgId,
      projectId,
      uploadedBy: managerId,
      file,
    });
    setAttachmentBusy(false);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setDraft((current) => ({
      ...current,
      attachments: [...current.attachments, result.attachment],
    }));
    setMessage(t("projectEstimates.attachmentAdded"));
  }

  function removeDraftAttachment(id: string) {
    setDraft((current) => ({
      ...current,
      attachments: current.attachments.filter((attachment) => attachment.id !== id),
    }));
  }

  async function openPlanningAttachment(attachment: ProjectPlanningAttachment) {
    const href = materialLinkHref(attachment.url);
    if (href) {
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    if (!attachment.storagePath) {
      setMessage(t("projectEstimates.attachmentOpenFailed"));
      return;
    }
    const { data, error } = await supabase.storage
      .from("media")
      .createSignedUrl(normalizeStoragePath(attachment.storagePath), 60 * 60);
    if (error || !data?.signedUrl) {
      setMessage(t("projectEstimates.attachmentOpenFailed"));
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  function addDocument() {
    const attachments = buildDraftAttachment(draft);
    if (attachments.length === 0) {
      setMessage(t("projectEstimates.attachmentRequired"));
      return;
    }
    const stamp = new Date().toISOString();
    const title = draft.attachmentName.trim() || attachments[0]?.name || t("projectEstimates.untitledDocument");
    const estimate: ProjectEstimate = {
      id: createProjectPlanningId("doc"),
      title,
      documentType: draft.documentType,
      status: draft.status,
      description: draft.attachmentNote.trim(),
      clientPrice: 0,
      materialCost: 0,
      laborHours: 0,
      internalCost: 0,
      createdAt: stamp,
      updatedAt: stamp,
      items: [],
      attachments,
    };
    setEstimations((current) => [estimate, ...current]);
    setDraft(EMPTY_ESTIMATE_DRAFT);
    setMessage(t("projectEstimates.draftAdded"));
  }

  function updateEstimate(id: string, patch: Partial<ProjectEstimate>) {
    setEstimations((current) =>
      current.map((estimate) =>
        estimate.id === id
          ? { ...estimate, ...patch, updatedAt: new Date().toISOString() }
          : estimate,
      ),
    );
  }

  function convertToInvoice(source: ProjectEstimate) {
    const stamp = new Date().toISOString();
    const invoice: ProjectEstimate = {
      ...source,
      id: createProjectPlanningId("inv"),
      title: `${t("projectEstimates.invoicePrefix")} ${source.title}`.trim(),
      documentType: "invoice",
      status: "draft",
      createdAt: stamp,
      updatedAt: stamp,
      attachments: source.attachments.map((attachment) => ({
        ...attachment,
        id: createProjectPlanningId("att"),
        createdAt: stamp,
      })),
      items: source.items.map((item) => ({
        ...item,
        id: createProjectPlanningId("work"),
      })),
    };
    setEstimations((current) => [invoice, ...current]);
    setMessage(t("projectEstimates.invoiceCreated"));
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
            <Paperclip size={17} />
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
          <div className="grid gap-2 sm:grid-cols-2">
            <select
              value={draft.documentType}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  documentType: event.target.value as ProjectEstimateDocumentType,
                }))
              }
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            >
              {ESTIMATE_DOCUMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(estimateTypeKey(type))}
                </option>
              ))}
            </select>
            <select
              value={draft.status}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  status: event.target.value as ProjectEstimate["status"],
                }))
              }
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            >
              {ESTIMATE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(estimateStatusKey(status))}
                </option>
              ))}
            </select>
          </div>
          <div className="rounded-[var(--radius-md)] border border-[rgba(105,231,255,0.16)] bg-[rgba(4,10,18,0.5)] p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">
              <Paperclip size={14} />
              {t("projectEstimates.attachments")}
            </div>
            <input
              ref={attachmentInputRef}
              type="file"
              accept={ACCEPT_ALL_UPLOADS}
              className="hidden"
              onChange={(event) => {
                void addDraftFileAttachment(event.target.files?.[0] ?? null);
                event.currentTarget.value = "";
              }}
            />
            <div className="mb-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => attachmentInputRef.current?.click()}
                disabled={attachmentBusy}
                className="button-base button-secondary min-h-0 px-3 py-2 text-xs"
              >
                <Upload size={13} />
                {attachmentBusy ? t("common.saving") : t("projectEstimates.uploadFile")}
              </button>
              <button
                type="button"
                onClick={addDraftLinkAttachment}
                className="button-base button-secondary min-h-0 px-3 py-2 text-xs"
              >
                <Paperclip size={13} />
                {t("projectEstimates.addLinkAttachment")}
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                value={draft.attachmentName}
                onChange={(event) => setDraft((current) => ({ ...current, attachmentName: event.target.value }))}
                placeholder={t("projectEstimates.attachmentName")}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              />
              <input
                value={draft.attachmentUrl}
                onChange={(event) => setDraft((current) => ({ ...current, attachmentUrl: event.target.value }))}
                placeholder={t("projectEstimates.attachmentUrl")}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              />
            </div>
            <input
              value={draft.attachmentNote}
              onChange={(event) => setDraft((current) => ({ ...current, attachmentNote: event.target.value }))}
              placeholder={t("projectEstimates.attachmentNote")}
              className="mt-2 w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            />
            {draft.attachments.length > 0 ? (
              <div className="mt-3 grid gap-1">
                {draft.attachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-sm)] bg-[rgba(0,0,0,0.22)] px-2 py-1.5 text-xs text-[var(--text-secondary)]"
                  >
                    <span className="min-w-0 truncate">
                      {attachment.name}
                      {attachment.note ? ` · ${attachment.note}` : ""}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void openPlanningAttachment(attachment)}
                        className="text-[var(--ai-cyan-bright)] hover:underline"
                      >
                        {t("projectEstimates.openAttachment")}
                      </button>
                      {!isMediaPlanningAttachment(attachment) || canDeleteMedia ? (
                        <button
                          type="button"
                          onClick={() => removeDraftAttachment(attachment.id)}
                          className="text-[var(--red)]"
                          aria-label={t("projectEstimates.removeAttachment")}
                        >
                          <X size={13} />
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <button type="button" onClick={addDocument} className="button-base button-secondary">
            <Plus size={15} />
            {t("projectEstimates.addDraft")}
          </button>
        </div>

        {estimations.length === 0 ? (
          <div className="surface-panel p-3 text-sm text-[var(--text-secondary)]">
            {t("projectEstimates.empty")}
          </div>
        ) : (
          <div className="space-y-4">
            {ESTIMATE_DOCUMENT_TYPES.map((type) => {
              const documents = estimations.filter((estimate) => estimate.documentType === type);
              if (documents.length === 0) return null;

              return (
                <div key={type} className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[rgba(15,17,23,0.28)] p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    <Paperclip size={13} />
                    {t(estimateTypeKey(type))}: {documents.length}
                  </div>
                  <div className="grid gap-2">
                    {documents.map((estimate) => (
                      <div
                        key={estimate.id}
                        className="rounded-[var(--radius-sm)] border border-[rgba(105,231,255,0.12)] bg-[rgba(0,0,0,0.2)] px-3 py-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-bold text-[var(--text-primary)]">
                              {estimate.title || t("projectEstimates.untitledDocument")}
                            </div>
                            <div className="mt-1 text-xs text-[var(--text-muted)]">
                              {t("projectEstimates.filesInDocument").replace(
                                "{count}",
                                String(estimate.attachments.length),
                              )}
                              {estimate.description ? ` · ${estimate.description}` : ""}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              value={estimate.status}
                              onChange={(event) =>
                                updateEstimate(estimate.id, {
                                  status: event.target.value as ProjectEstimate["status"],
                                })
                              }
                              className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-2 text-xs text-[var(--text-primary)] outline-none"
                            >
                              {ESTIMATE_STATUSES.map((status) => (
                                <option key={status} value={status}>
                                  {t(estimateStatusKey(status))}
                                </option>
                              ))}
                            </select>
                            {estimate.documentType === "estimate" ? (
                              <button
                                type="button"
                                onClick={() => convertToInvoice(estimate)}
                                className="button-base button-secondary min-h-0 px-3 py-2 text-xs"
                              >
                                {t("projectEstimates.convertToInvoice")}
                              </button>
                            ) : null}
                            {!estimateHasMediaAttachments(estimate) || canDeleteMedia ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setEstimations((current) => current.filter((item) => item.id !== estimate.id))
                                }
                                className="button-base button-danger-ghost min-h-0 px-3 py-2 text-xs"
                              >
                                <Trash2 size={13} />
                              </button>
                            ) : null}
                          </div>
                        </div>
                        {estimate.attachments.length > 0 ? (
                          <div className="mt-2 grid gap-1">
                            {estimate.attachments.map((attachment) => (
                              <div
                                key={attachment.id}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-sm)] bg-[rgba(0,0,0,0.18)] px-2 py-1.5 text-xs text-[var(--text-secondary)]"
                              >
                                <span className="min-w-0 truncate">
                                  {attachment.name}
                                  {attachment.note ? ` · ${attachment.note}` : ""}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => void openPlanningAttachment(attachment)}
                                  className="text-[var(--ai-cyan-bright)] hover:underline"
                                >
                                  {t("projectEstimates.openAttachment")}
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
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
