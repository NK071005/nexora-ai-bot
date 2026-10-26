import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  History,
  Info,
  Mail,
  RefreshCw,
  Upload,
  Users,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/app/AuthContext";
import { useToast } from "@/app/ToastContext";
import { useApiQuery, useDocumentTitle } from "@/hooks/useApi";
import { ApiError, internflowApi } from "@/services/api";
import type { ImportBatch } from "@/types/api";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Notice,
  PageHeader,
  SectionHeading,
  StatusBadge,
  Skeleton,
} from "@/components/ui/primitives";
import { ConfirmDialog, Pagination } from "@/components/ui/overlays";
import { formatDateTime } from "@/lib/format";

interface ConfirmResult {
  batch_id: string;
  status: string;
  created: number;
  skipped: number;
  email_mode: string;
  interns?: unknown[];
}

const ROW_FIELDS = [
  { key: "full_name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "department", label: "Department" },
  { key: "role_title", label: "Role" },
  { key: "start_date", label: "Start" },
  { key: "end_date", label: "End" },
  { key: "timezone", label: "Timezone" },
  { key: "initial_task", label: "First task" },
] as const;

const PAGE_SIZE = 20;

function asText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

export function ImportsPage() {
  useDocumentTitle("Intern imports");
  const { me } = useAuth();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportBatch | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loadingBatch, setLoadingBatch] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ConfirmResult | null>(null);
  const [rowPage, setRowPage] = useState(1);

  const history = useApiQuery<ImportBatch[]>(
    () => internflowApi.imports(50),
    [me?.active_organization_id],
  );

  useEffect(() => {
    setRowPage(1);
    setResult(null);
  }, [preview?.id]);

  const rows = preview?.rows ?? [];
  const visibleRows = useMemo(
    () => rows.slice((rowPage - 1) * PAGE_SIZE, rowPage * PAGE_SIZE),
    [rows, rowPage],
  );
  const mapping = preview?.column_mapping ?? {};
  const errorRows = new Set(rows.filter((row) => row.errors.length).map((row) => row.row_number));

  async function upload() {
    if (!file) {
      setUploadError("Choose an Excel or CSV file to preview.");
      return;
    }
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!extension || !["xlsx", "xls", "csv"].includes(extension)) {
      setUploadError("Upload an .xlsx, .xls or .csv file.");
      return;
    }
    setUploading(true);
    setUploadError(null);
    setPreview(null);
    try {
      const batch = await internflowApi.importPreview(file);
      setPreview(batch);
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      toast.success("Preview ready", `${batch.valid_count} valid row${batch.valid_count === 1 ? "" : "s"} of ${batch.row_count}.`);
      await history.reload(true);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setUploadError(caught.message);
      } else {
        setUploadError("The spreadsheet could not be processed.");
      }
    } finally {
      setUploading(false);
    }
  }

  async function openBatch(batch: ImportBatch) {
    setLoadingBatch(true);
    setUploadError(null);
    try {
      const detail = await internflowApi.importBatch(batch.id);
      setPreview(detail);
    } catch (caught) {
      toast.error("Could not open import", caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setLoadingBatch(false);
    }
  }

  async function confirmImport() {
    if (!preview) return;
    setConfirming(true);
    try {
      const response = await internflowApi.confirmImport(preview.id);
      const typed = response as ConfirmResult;
      setResult(typed);
      setConfirmOpen(false);
      const refreshed = await internflowApi.importBatch(preview.id).catch(() => null);
      if (refreshed) setPreview(refreshed);
      await history.reload(true);
      toast.success(
        "Import confirmed",
        `${typed.created} intern${typed.created === 1 ? "" : "s"} created, ${typed.skipped} skipped.`,
      );
    } catch (caught) {
      toast.error("Import could not be confirmed", caught instanceof ApiError ? caught.message : undefined);
      setConfirmOpen(false);
    } finally {
      setConfirming(false);
    }
  }

  function chooseFile(selected: File | null) {
    setFile(selected);
    setUploadError(null);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="InternFlow"
        title="Import interns"
        description="Preview a spreadsheet, inspect every row, then confirm the import. Invalid rows are reported before anything is created."
        actions={
          <>
            <Link
              to="/internflow/templates"
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-mist-200 px-4 text-sm font-semibold text-graphite-800 transition hover:bg-mist-50 dark:border-white/10 dark:text-mist-100 dark:hover:bg-white/[0.06]"
            >
              <FileSpreadsheet className="h-4 w-4" /> Templates
            </Link>
            <Link
              to="/internflow/interns"
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-electric-600 px-4 text-sm font-semibold text-white transition hover:bg-electric-500"
            >
              <Users className="h-4 w-4" /> View interns
            </Link>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <section className="app-surface p-5">
          <SectionHeading
            title="Upload a spreadsheet"
            description="Required columns: full name and email. Optional: role, department, dates, duration, timezone and initial task."
          />

          <div
            className="rounded-2xl border border-dashed border-mist-300 bg-mist-50/40 p-6 text-center dark:border-white/15 dark:bg-white/[0.02]"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              chooseFile(event.dataTransfer.files?.[0] ?? null);
            }}
          >
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-electric-500/10 text-electric-600 dark:text-electric-300">
              <Upload className="h-5 w-5" />
            </span>
            <h3 className="mt-3 font-display text-sm font-semibold text-graphite-950 dark:text-white">
              Drop an Excel or CSV file here
            </h3>
            <p className="mt-1 text-xs leading-5 text-mist-500 dark:text-mist-400">
              .xlsx, .xls or .csv · up to 2,000 rows. Nothing is created until you confirm the preview.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="sr-only"
              onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
            />
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
                Choose file
              </Button>
              <Button size="sm" icon={Upload} onClick={() => void upload()} loading={uploading} disabled={!file}>
                Preview import
              </Button>
            </div>
            {file ? (
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-medium text-graphite-700 shadow-sm dark:bg-white/[0.06] dark:text-mist-200">
                <FileSpreadsheet className="h-3.5 w-3.5" /> {file.name}
              </p>
            ) : null}
          </div>

          {uploadError ? (
            <Notice tone="danger" title="Import preview failed">
              {uploadError}
            </Notice>
          ) : null}

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              { label: "Required", value: "Full name, email", tone: "text-electric-600 dark:text-electric-300" },
              { label: "Optional", value: "Role, department, dates", tone: "text-graphite-700 dark:text-mist-300" },
              { label: "Auto-created", value: "Account + first task", tone: "text-emerald-600 dark:text-emerald-300" },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-mist-200 p-3 dark:border-white/10">
                <p className="eyebrow">{item.label}</p>
                <p className={`mt-1 text-xs font-medium ${item.tone}`}>{item.value}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 flex items-start gap-2 rounded-xl bg-mist-50 p-3.5 text-[11px] leading-5 text-mist-500 dark:bg-white/[0.03] dark:text-mist-400">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-electric-500" />
            The sample workbook at <code className="mx-1 rounded bg-white px-1 py-0.5 font-mono text-[10px] dark:bg-white/10">samples/internflow_interns.xlsx</code>
            shows the expected columns. The alternate sample includes deliberate errors for testing the validation view.
          </div>
        </section>

        <section className="app-surface overflow-hidden">
          <div className="border-b border-mist-100 px-5 py-4 dark:border-white/[0.07]">
            <SectionHeading
              title="Import history"
              description="Every preview and confirmation is retained for this organization."
              action={
                <Button variant="ghost" size="sm" icon={RefreshCw} onClick={() => void history.reload()} aria-label="Refresh history">
                  Refresh
                </Button>
              }
            />
          </div>
          {history.loading && !history.data ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2].map((key) => <Skeleton key={key} className="h-14" />)}
            </div>
          ) : history.error && !history.data ? (
            <div className="p-4">
              <ErrorState message={history.error} onRetry={() => void history.reload()} />
            </div>
          ) : history.data?.length ? (
            <div className="max-h-[460px] divide-y divide-mist-100 overflow-y-auto dark:divide-white/[0.06]">
              {history.data.map((batch) => (
                <button
                  key={batch.id}
                  type="button"
                  onClick={() => void openBatch(batch)}
                  className={`flex w-full items-start gap-3 p-4 text-left transition hover:bg-mist-50 dark:hover:bg-white/[0.03] ${
                    preview?.id === batch.id ? "bg-electric-500/[0.04]" : ""
                  }`}
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-mist-100 text-mist-500 dark:bg-white/[0.06] dark:text-mist-300">
                    <History className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-graphite-900 dark:text-mist-100">{batch.filename}</span>
                    <span className="mt-0.5 block text-[10px] text-mist-400">
                      {batch.row_count} rows · {batch.valid_count} valid · {batch.error_count} flagged · {formatDateTime(batch.created_at)}
                    </span>
                  </span>
                  <span className="shrink-0">
                    <StatusBadge status={batch.status} />
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="p-5">
              <EmptyState
                icon={History}
                title="No imports yet"
                description="Your first preview will appear here with its validation results and confirmation state."
                className="py-8"
              />
            </div>
          )}
        </section>
      </div>

      {loadingBatch ? (
        <div className="app-surface p-5">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="mt-3 h-24" />
        </div>
      ) : null}

      {preview ? (
        <section className="app-surface overflow-hidden">
          <div className="border-b border-mist-100 p-5 dark:border-white/[0.07]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-electric-500" />
                  <h2 className="truncate font-display text-base font-semibold text-graphite-950 dark:text-white">{preview.filename}</h2>
                  <StatusBadge status={preview.status} />
                </div>
                <p className="mt-1 text-[11px] text-mist-400">
                  Created {formatDateTime(preview.created_at)}
                  {preview.confirmed_at ? ` · confirmed ${formatDateTime(preview.confirmed_at)}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {preview.status === "preview" ? (
                  <Button
                    icon={CheckCircle2}
                    onClick={() => setConfirmOpen(true)}
                    disabled={preview.valid_count === 0}
                  >
                    Confirm {preview.valid_count} valid row{preview.valid_count === 1 ? "" : "s"}
                  </Button>
                ) : (
                  <Badge tone="green" dot>Import completed</Badge>
                )}
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              {[
                { label: "Rows", value: preview.row_count, icon: FileSpreadsheet },
                { label: "Valid", value: preview.valid_count, icon: CheckCircle2, tone: "text-emerald-600 dark:text-emerald-300" },
                { label: "Flagged", value: preview.error_count, icon: AlertTriangle, tone: "text-rose-600 dark:text-rose-300" },
                { label: "Invalid rows", value: errorRows.size, icon: XCircle, tone: "text-amber-600 dark:text-amber-300" },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-mist-200 p-3 dark:border-white/10">
                  <div className="flex items-center justify-between gap-2">
                    <p className="eyebrow">{item.label}</p>
                    <item.icon className={`h-3.5 w-3.5 ${item.tone ?? "text-mist-400"}`} />
                  </div>
                  <p className="heading-display mt-1 text-xl text-graphite-950 dark:text-white">{item.value}</p>
                </div>
              ))}
            </div>

            {result ? (
              <div className="mt-4">
                <Notice tone="success" title={`Import confirmed · ${result.created} created, ${result.skipped} skipped`}>
                  Email mode: {result.email_mode === "smtp" ? "SMTP (messages sent)" : "demo (logged, not sent)"}. Valid rows
                  created intern accounts, the first task assignment, and a proposed kick-off meeting.
                </Notice>
              </div>
            ) : null}

            {preview.valid_count === 0 && preview.status === "preview" ? (
              <div className="mt-4">
                <Notice tone="danger" title="Nothing can be imported from this preview">
                  Every row has at least one validation error. Correct the spreadsheet and upload it again.
                </Notice>
              </div>
            ) : null}
          </div>

          {Object.keys(mapping).length ? (
            <div className="border-b border-mist-100 px-5 py-4 dark:border-white/[0.07]">
              <p className="text-xs font-semibold text-graphite-900 dark:text-mist-100">Detected column mapping</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.entries(mapping).map(([target, source]) => (
                  <span key={target} className="rounded-lg bg-mist-100 px-2 py-1 font-mono text-[10px] text-mist-600 dark:bg-white/[0.06] dark:text-mist-300">
                    {source} → {target}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {rows.length ? (
            <div className="overflow-x-auto">
              <table className="table-base min-w-[980px]">
                <thead>
                  <tr>
                    <th>Row</th>
                    {ROW_FIELDS.map((field) => <th key={field.key}>{field.label}</th>)}
                    <th>Validation</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => {
                    const invalid = row.errors.length > 0;
                    return (
                      <tr key={row.row_number} className={invalid ? "bg-rose-500/[0.03]" : undefined}>
                        <td className="text-xs font-semibold tabular-nums text-mist-500">{row.row_number}</td>
                        {ROW_FIELDS.map((field) => (
                          <td key={field.key} className="max-w-[180px]">
                            <span className="block truncate text-xs text-graphite-700 dark:text-mist-300">
                              {asText(row.values[field.key])}
                            </span>
                          </td>
                        ))}
                        <td>
                          {invalid ? (
                            <div className="space-y-1">
                              {row.errors.map((error, index) => (
                                <p key={index} className="flex items-start gap-1 text-[10px] leading-4 text-rose-600 dark:text-rose-300">
                                  <XCircle className="mt-0.5 h-3 w-3 shrink-0" /> {error}
                                </p>
                              ))}
                            </div>
                          ) : (
                            <Badge tone="green" dot>Ready</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-5">
              <EmptyState icon={FileSpreadsheet} title="No rows to display" description="The spreadsheet did not contain any data rows." className="py-8" />
            </div>
          )}

          {rows.length ? (
            <Pagination page={rowPage} pageSize={PAGE_SIZE} total={rows.length} onChange={setRowPage} />
          ) : null}

          {preview.errors.length ? (
            <div className="border-t border-mist-100 bg-rose-500/[0.03] p-5 dark:border-white/[0.07]">
              <p className="flex items-center gap-2 text-xs font-semibold text-rose-700 dark:text-rose-300">
                <AlertTriangle className="h-4 w-4" /> Validation summary
              </p>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {preview.errors.map((error, index) => (
                  <p key={index} className="text-[11px] leading-5 text-rose-600 dark:text-rose-300">
                    Row {String(error.row ?? "—")}:{" "}
                    {Array.isArray((error as { messages?: unknown }).messages)
                      ? ((error as { messages: string[] }).messages.join(" "))
                      : String(error.message ?? JSON.stringify(error))}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void confirmImport()}
        title="Confirm intern import"
        description={
          preview
            ? `This will create ${preview.valid_count} intern account${preview.valid_count === 1 ? "" : "s"} and skip ${errorRows.size} invalid row${errorRows.size === 1 ? "" : "s"}. Accounts receive activation emails and the first matching task where available. ${me?.capabilities.email.configured ? "SMTP is configured, so real email will be sent." : "SMTP is not configured; emails will be demo-logged only."}`
            : ""
        }
        confirmLabel="Confirm import"
        loading={confirming}
      />

      <div className="rounded-2xl border border-navy-800 bg-navy-950 p-5 text-mist-300">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-electric-300" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white">What confirmation creates</p>
          </div>
          <span className="inline-flex items-center gap-1 text-[10px] text-mist-400">
            <Clock className="h-3 w-3" /> Activation links expire automatically
          </span>
        </div>
        <p className="mt-2 text-[11px] leading-5 text-mist-400">
          Each valid row creates or links an intern account, sends an activation email through the configured provider,
          creates the first assignment when a matching active template exists, and proposes a kick-off review with a
          downloadable calendar file. No email or meeting URL is fabricated when providers are not configured.
        </p>
      </div>

      <p className="text-center text-[10px] text-mist-400">
        All imports, confirmations and onboarding deliveries are scoped to {me?.organizations.find((org) => org.organization_id === me.active_organization_id)?.organization_name ?? "your active organization"}.
      </p>
    </div>
  );
}
