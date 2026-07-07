import { NextResponse } from "next/server";
import { hasFinanceAccess } from "@/lib/finance-access";
import { isManagerRole } from "@/lib/manager-utils";
import { parseMoneyAmount } from "@/lib/money-amount";
import { safeClientErrorMessage } from "@/lib/safe-log";
import { readRequiredUuid } from "@/lib/server/id-guards";
import { createClient } from "@/lib/supabase/server";
import { normalizeStoragePath } from "@/lib/task-attachments";
import type { Media, Profile } from "@/types/database";

const RECEIPT_ROW_LIMIT = 200;
const RECEIPT_SELECT =
  "id, storage_path, filename, mime_type, caption, metadata, created_at";

type Actor = Pick<Profile, "id" | "role" | "org_id">;
type ReceiptRow = Pick<
  Media,
  "id" | "storage_path" | "filename" | "mime_type" | "caption" | "metadata" | "created_at"
>;

function readMoney(value: unknown): number {
  return parseMoneyAmount(value, { mode: "parseFloat", missing: 0, invalid: 0 }) ?? 0;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await params;
    const projectId = readRequiredUuid(rawId, "project id");
    if (!projectId.ok) {
      return NextResponse.json({ error: projectId.error }, { status: projectId.status });
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: actor, error: actorError } = await supabase
      .from("profiles")
      .select("id, role, org_id")
      .eq("id", user.id)
      .maybeSingle<Actor>();

    if (actorError || !actor || !isManagerRole(actor.role)) {
      return NextResponse.json({ error: "Receipt access denied." }, { status: 403 });
    }

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id")
      .eq("id", projectId.value)
      .eq("org_id", actor.org_id)
      .maybeSingle<{ id: string }>();

    if (projectError) {
      return NextResponse.json(
        { error: safeClientErrorMessage(projectError) },
        { status: 500 },
      );
    }

    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const canReadAllReceipts = await hasFinanceAccess(supabase, actor);
    let receiptQuery = supabase
      .from("media")
      .select(RECEIPT_SELECT)
      .eq("org_id", actor.org_id)
      .eq("project_id", projectId.value)
      .eq("metadata->>category", "receipt")
      .is("deleted_at", null);

    if (!canReadAllReceipts) {
      receiptQuery = receiptQuery.eq("uploaded_by", actor.id);
    }

    const { data: rows, error: receiptsError } = await receiptQuery
      .order("created_at", { ascending: false })
      .range(0, RECEIPT_ROW_LIMIT - 1)
      .returns<ReceiptRow[]>();

    if (receiptsError) {
      return NextResponse.json(
        { error: safeClientErrorMessage(receiptsError) },
        { status: 500 },
      );
    }

    const paths = (rows ?? []).map((row) => normalizeStoragePath(row.storage_path));
    const signedByPath = new Map<string, string>();
    if (paths.length > 0) {
      const { data: signed } = await supabase.storage
        .from("media")
        .createSignedUrls(paths, 3600);
      for (const item of signed ?? []) {
        if (item.path && item.signedUrl) {
          signedByPath.set(item.path, item.signedUrl);
        }
      }
    }

    return NextResponse.json({
      receipts: (rows ?? []).map((row) => {
        const metadata = row.metadata ?? {};
        const normalizedPath = normalizeStoragePath(row.storage_path);
        return {
          id: row.id,
          storagePath: row.storage_path,
          url: signedByPath.get(normalizedPath) ?? "",
          filename: row.filename ?? "receipt",
          storeName: readString(metadata.store_name),
          amount: readMoney(metadata.amount),
          purchaseDate: readString(metadata.purchase_date),
          note: row.caption ?? "",
          uploaderName: readString(metadata.uploader_name),
          isImage: row.mime_type?.startsWith("image/") ?? false,
        };
      }),
    });
  } catch (error) {
    return NextResponse.json(
      { error: safeClientErrorMessage(error) },
      { status: 500 },
    );
  }
}
