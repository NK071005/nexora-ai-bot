import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowUpRight, Filter, GraduationCap, Plus, Search, Upload, Users } from "lucide-react";
import { useAuth } from "@/app/AuthContext";
import { useApiQuery, useDebounce, useDocumentTitle } from "@/hooks/useApi";
import { internflowApi } from "@/services/api";
import type { Intern } from "@/types/api";
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  ProgressBar,
  Select,
  Skeleton,
  StatusBadge,
} from "@/components/ui/primitives";
import { Pagination } from "@/components/ui/overlays";
import { AssignTaskModal } from "@/components/internflow/AssignTaskModal";
import { INTERN_STATUSES } from "@/lib/constants";
import { formatDate, relativeTime } from "@/lib/format";
import { useToast } from "@/app/ToastContext";

const PAGE_SIZE = 25;

export function InternsPage() {
  useDocumentTitle("Interns");
  const { me } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [query, setQuery] = useState("");
  const debounced = useDebounce(query, 300);
  const [status, setStatus] = useState("");
  const [department, setDepartment] = useState("");
  const [page, setPage] = useState(1);
  const [assignTarget, setAssignTarget] = useState<Intern | null>(null);

  const interns = useApiQuery(
    () =>
      internflowApi.interns({
        q: debounced.trim() || undefined,
        status: status || undefined,
        department: department || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      }),
    [debounced, status, department, page, me?.active_organization_id],
  );

  useEffect(() => {
    setPage(1);
  }, [debounced, status, department]);

  const departments = useMemo(() => {
    const values = new Set<string>();
    for (const row of interns.data?.summary.interns ?? []) {
      if (row.department) values.add(row.department);
    }
    return [...values].sort();
  }, [interns.data]);

  const summary = interns.data?.summary;
  const filtersActive = Boolean(debounced || status || department);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="InternFlow"
        title="Interns"
        description="Every row is a live intern profile in the active organization, with its assignment, deadline and onboarding state."
        actions={
          <>
            <Button variant="secondary" icon={Upload} onClick={() => navigate("/internflow/imports")}>
              Import spreadsheet
            </Button>
            <Button icon={GraduationCap} onClick={() => navigate("/internflow/templates")}>
              Task templates
            </Button>
          </>
        }
      />

      {summary ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Total interns", value: summary.interns_total, hint: `${summary.active} active` },
            { label: "Overdue", value: summary.overdue, hint: "Open task past due" },
            { label: "Tasks approved", value: summary.tasks_approved, hint: "Across the programme" },
            { label: "Pending tasks", value: summary.tasks_pending, hint: "Open or under review" },
          ].map((item) => (
            <div key={item.label} className="app-surface p-4">
              <p className="eyebrow">{item.label}</p>
              <p className="heading-display mt-1.5 text-2xl text-graphite-950 dark:text-white">{item.value}</p>
              <p className="mt-0.5 text-[10px] text-mist-400">{item.hint}</p>
            </div>
          ))}
        </div>
      ) : null}

      <section className="app-surface overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-mist-100 p-4 dark:border-white/[0.07] lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mist-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-9"
              placeholder="Search name, email or department…"
              aria-label="Search interns"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            <Select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status" className="min-w-[140px]">
              <option value="">All statuses</option>
              {INTERN_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value.charAt(0).toUpperCase() + value.slice(1)}
                </option>
              ))}
            </Select>
            <Select value={department} onChange={(event) => setDepartment(event.target.value)} aria-label="Filter by department" className="min-w-[150px]">
              <option value="">All departments</option>
              {departments.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
            {filtersActive ? (
              <Button
                variant="ghost"
                size="sm"
                icon={Filter}
                onClick={() => {
                  setQuery("");
                  setStatus("");
                  setDepartment("");
                }}
              >
                Clear
              </Button>
            ) : null}
          </div>
        </div>

        {interns.error && !interns.data ? (
          <div className="p-5">
            <ErrorState message={interns.error} onRetry={() => void interns.reload()} />
          </div>
        ) : interns.loading && !interns.data ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3, 4].map((key) => (
              <Skeleton key={key} className="h-14" />
            ))}
          </div>
        ) : interns.data?.items.length ? (
          <div className="overflow-x-auto">
            <table className="table-base min-w-[900px]">
              <thead>
                <tr>
                  <th>Intern</th>
                  <th>Department</th>
                  <th>Status</th>
                  <th>Current task</th>
                  <th>Due</th>
                  <th>Progress</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {interns.data.items.map((intern) => (
                  <tr key={intern.id}>
                    <td>
                      <Link to={`/internflow/interns/${intern.id}`} className="flex items-center gap-3">
                        <Avatar name={intern.full_name} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-graphite-900 dark:text-mist-100">{intern.full_name}</span>
                          <span className="block truncate text-[10px] text-mist-400">{intern.email}</span>
                        </span>
                      </Link>
                    </td>
                    <td>
                      <span className="text-xs text-graphite-700 dark:text-mist-300">{intern.department || "—"}</span>
                      <span className="block text-[10px] text-mist-400">{intern.role_title}</span>
                    </td>
                    <td>
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge status={intern.status} />
                        {intern.overdue ? <Badge tone="rose">Overdue</Badge> : null}
                      </div>
                    </td>
                    <td className="max-w-[220px]">
                      <span className="block truncate text-xs text-graphite-700 dark:text-mist-300">{intern.current_task ?? "No active task"}</span>
                      {intern.current_status ? <span className="text-[10px] capitalize text-mist-400">{intern.current_status.replace(/_/g, " ")}</span> : null}
                    </td>
                    <td>
                      <span className={intern.overdue ? "text-xs font-semibold text-rose-500" : "text-xs text-mist-500 dark:text-mist-400"}>
                        {intern.due_at ? formatDate(intern.due_at) : "—"}
                      </span>
                      {intern.due_at ? <span className="block text-[10px] text-mist-400">{relativeTime(intern.due_at)}</span> : null}
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="w-9 text-xs tabular-nums text-graphite-700 dark:text-mist-300">
                          {intern.tasks_approved}/{intern.tasks_total}
                        </span>
                        <ProgressBar
                          value={intern.tasks_total ? (intern.tasks_approved / intern.tasks_total) * 100 : 0}
                          tone={intern.overdue ? "rose" : "green"}
                        />
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-1.5">
                        <Button variant="secondary" size="sm" onClick={() => setAssignTarget(intern)}>
                          Assign
                        </Button>
                        <Link
                          to={`/internflow/interns/${intern.id}`}
                          className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-electric-600 transition hover:bg-electric-500/10 dark:text-electric-300"
                        >
                          Open <ArrowUpRight className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-6">
            <EmptyState
              icon={filtersActive ? Search : Users}
              title={filtersActive ? "No interns match these filters" : "No interns yet"}
              description={
                filtersActive
                  ? "Try a broader search or clear the status and department filters."
                  : "Import an Excel or CSV file to create accounts, the first assignment and a proposed kick-off meeting."
              }
              action={
                filtersActive ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setQuery("");
                      setStatus("");
                      setDepartment("");
                    }}
                  >
                    Clear filters
                  </Button>
                ) : (
                  <Button icon={Upload} onClick={() => navigate("/internflow/imports")}>
                    Import interns
                  </Button>
                )
              }
            />
          </div>
        )}

        {interns.data ? (
          <Pagination page={page} pageSize={PAGE_SIZE} total={interns.data.total} onChange={setPage} />
        ) : null}
      </section>

      <div className="rounded-2xl border border-navy-800 bg-navy-950 p-5 text-mist-300">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-electric-300" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white">Assignment rules</p>
          </div>
          <Link to="/internflow/templates" className="text-[11px] font-semibold text-electric-300 underline">
            Review templates
          </Link>
        </div>
        <p className="mt-2 text-[11px] leading-5 text-mist-400">
          An intern can hold one active assignment at a time. Approving a task automatically advances the intern to the
          next active template in sequence, or marks the internship complete when none remain.
        </p>
      </div>

      <AssignTaskModal
        open={Boolean(assignTarget)}
        internId={assignTarget?.id ?? null}
        internName={assignTarget?.full_name}
        onClose={() => setAssignTarget(null)}
        onAssigned={() => {
          toast.success("Assignment created", "The intern list was refreshed.");
          void interns.reload(true);
        }}
      />
    </div>
  );
}
