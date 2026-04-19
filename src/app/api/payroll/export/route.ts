import { NextRequest, NextResponse } from "next/server";
import { buildManagerSessions, computePayrollPreview } from "@/lib/manager-utils";
import { requireManagerContext } from "@/lib/manager-data";
import { createClient } from "@/lib/supabase/server";
import type {
  PayrollClosure,
  Profile,
  Project,
  TimeEvent,
} from "@/types/database";
import type { ManagerWorkspaceData } from "@/lib/manager-types";

function assertNoError(error: { message: string } | null, label: string) {
  if (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}

async function loadPreview(periodEnd?: string) {
  const supabase = await createClient();
  const { profile, org } = await requireManagerContext(supabase);

  const [profilesResult, projectsResult, timeEventsResult, closuresResult] =
    await Promise.all([
      supabase.from("profiles").select("*").returns<Profile[]>(),
      supabase.from("projects").select("*").returns<Project[]>(),
      supabase
        .from("time_events")
        .select("*")
        .order("event_time", { ascending: false })
        .range(0, 4999)
        .returns<TimeEvent[]>(),
      supabase
        .from("payroll_closures")
        .select("*")
        .order("closed_through", { ascending: false })
        .range(0, 999)
        .returns<PayrollClosure[]>(),
    ]);

  assertNoError(profilesResult.error, "Profiles query failed");
  assertNoError(projectsResult.error, "Projects query failed");
  assertNoError(timeEventsResult.error, "Time events query failed");
  assertNoError(closuresResult.error, "Payroll closures query failed");

  const workspace: ManagerWorkspaceData = {
    manager: profile,
    org,
    profiles: profilesResult.data ?? [],
    projects: projectsResult.data ?? [],
    assignments: [],
    tasks: [],
    timeEvents: timeEventsResult.data ?? [],
    media: [],
    payrollRuns: [],
    payrollClosures: closuresResult.data ?? [],
    storeVisits: [],
  };

  const sessions = buildManagerSessions(workspace);
  const preview = computePayrollPreview(workspace, sessions, periodEnd);
  return { preview, orgName: org.name };
}

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

type PayrollPreview = Awaited<ReturnType<typeof loadPreview>>["preview"];

function buildCsv(preview: PayrollPreview): string {
  const rows: string[] = [
    "Worker Name,Project,Hours,Rate,Amount,Period Start,Period End",
  ];
  const periodStart = formatDate(preview.periodStart);
  const periodEnd = formatDate(preview.periodEnd);

  for (const line of preview.lines) {
    rows.push(
      [
        `"${line.profileName}"`,
        `"${line.projectName}"`,
        line.hours.toFixed(2),
        line.rate.toFixed(2),
        line.amount.toFixed(2),
        periodStart,
        periodEnd,
      ].join(","),
    );
  }

  return rows.join("\n");
}

async function buildPdf(
  preview: PayrollPreview,
  orgName: string,
): Promise<Buffer> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const gold: [number, number, number] = [191, 162, 52]; // #BFA234
  const darkText: [number, number, number] = [30, 30, 30];
  const mutedText: [number, number, number] = [100, 100, 100];

  // --- Header bar ---
  doc.setFillColor(...gold);
  doc.rect(0, 0, pageWidth, 18, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(255, 255, 255);
  doc.text(`${orgName || "NW Build Pro"} \u2014 Payroll Report`, 14, 12);

  // --- Period line ---
  doc.setFontSize(10);
  doc.setTextColor(...mutedText);
  doc.text(
    `Period: ${formatDate(preview.periodStart)}  to  ${formatDate(preview.periodEnd)}`,
    14,
    26,
  );

  // --- Summary box ---
  const summaryY = 32;
  doc.setDrawColor(220, 220, 220);
  doc.setFillColor(248, 248, 248);
  doc.roundedRect(14, summaryY, pageWidth - 28, 18, 2, 2, "FD");

  doc.setFontSize(9);
  doc.setTextColor(...mutedText);
  const col1 = 20;
  const col2 = 75;
  const col3 = 140;

  doc.text("Total Amount", col1, summaryY + 6);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...darkText);
  doc.text(`$${preview.totalAmount.toFixed(2)}`, col1, summaryY + 13);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...mutedText);
  doc.text("Total Hours", col2, summaryY + 6);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...darkText);
  doc.text(preview.totalHours.toFixed(2), col2, summaryY + 13);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...mutedText);
  doc.text("Workers", col3, summaryY + 6);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...darkText);
  doc.text(String(preview.workersCount), col3, summaryY + 13);

  // --- Worker Totals table ---
  let currentY = summaryY + 26;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...gold);
  doc.text("Worker Totals", 14, currentY);
  currentY += 2;

  autoTable(doc, {
    startY: currentY,
    head: [["Name", "Role", "Hours", "Rate", "Amount"]],
    body: preview.workerTotals.map((w) => [
      w.profileName,
      w.profileRole,
      w.hours.toFixed(2),
      w.lines.length > 0
        ? `$${(w.amount / w.hours).toFixed(2)}`
        : "-",
      `$${w.amount.toFixed(2)}`,
    ]),
    styles: {
      fontSize: 9,
      cellPadding: 3,
      textColor: darkText,
      lineColor: [220, 220, 220],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: gold,
      textColor: [255, 255, 255],
      fontStyle: "bold",
    },
    alternateRowStyles: { fillColor: [248, 248, 248] },
    margin: { left: 14, right: 14 },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  currentY = (doc as any).lastAutoTable.finalY + 10;

  // --- Pay Lines table ---
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...gold);
  doc.text("Pay Lines", 14, currentY);
  currentY += 2;

  autoTable(doc, {
    startY: currentY,
    head: [["Worker", "Project", "Hours", "Rate", "Amount"]],
    body: preview.lines.map((l) => [
      l.profileName,
      l.projectName,
      l.hours.toFixed(2),
      `$${l.rate.toFixed(2)}`,
      `$${l.amount.toFixed(2)}`,
    ]),
    styles: {
      fontSize: 9,
      cellPadding: 3,
      textColor: darkText,
      lineColor: [220, 220, 220],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: gold,
      textColor: [255, 255, 255],
      fontStyle: "bold",
    },
    alternateRowStyles: { fillColor: [248, 248, 248] },
    margin: { left: 14, right: 14 },
  });

  // --- Footer ---
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const pageHeight = doc.internal.pageSize.getHeight();
    doc.setFontSize(8);
    doc.setTextColor(...mutedText);
    doc.text(
      `Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC via Check-Time`,
      14,
      pageHeight - 8,
    );
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - 14, pageHeight - 8, {
      align: "right",
    });
  }

  return Buffer.from(doc.output("arraybuffer"));
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const format = searchParams.get("format") ?? "pdf";
    const periodEnd = searchParams.get("periodEnd") || undefined;
    const { preview, orgName } = await loadPreview(periodEnd);
    const dateSuffix = formatDate(preview.periodEnd);

    if (format === "csv") {
      const csv = buildCsv(preview);
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="payroll-${dateSuffix}.csv"`,
        },
      });
    }

    const pdfBytes = await buildPdf(preview, orgName);
    return new Response(pdfBytes as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="payroll-${dateSuffix}.pdf"`,
      },
    });
  } catch (error: unknown) {
    // Re-throw Next.js redirect errors so they work properly
    if (error && typeof error === "object" && "digest" in error) {
      throw error;
    }
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
