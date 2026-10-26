import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Archive,
  ArrowRight,
  ClipboardCheck,
  FileSpreadsheet,
  Gauge,
  Layers,
  Pencil,
  Plus,
  ShieldAlert,
} from "lucide-react";
import { useAuth } from "@/app/AuthContext";
import { useToast } from "@/app/ToastContext";
import { useApiQuery, useDocumentTitle } from "@/hooks/useApi";
import { ApiError, internflowApi } from "@/services/api";
import type { TaskTemplate } from "@/types/api";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  StatCard,
  StatusBadge,
} from "@/components/ui/primitives";
import { ConfirmDialog, Tabs } from "@/components/ui/overlays";
import { TemplateForm } from "@/components/internflow/TemplateForm";
import { formatDateTime } from "@/lib/format";

type Filter = "all" | "active" | "draft" | "archived";

export function TemplatesPage() {
  useDocumentTitle("Task templates");
  const { me } = useAuth();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<TaskTemplate | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<TaskTemplate | null>(null);
  const [archiving, setArchiving] = useState(false);

  const templates = useApiQuery<TaskTemplate[]>(
    () => internflowApi.templates(true),
    [me?.active_organization_id],
  );

  const all = templates.data ?? [];
  const counts = useMemo(
    () => ({
      all: all.length,
      active: all.filter((template) => template.status === "active").length,
      draft: all.filter((template) => template.status === "draft").length,
      archived: all.filter((template) => template.status === "archived").length,
    }),
    [all],
  );

  const visible = filter === "all" ? all : all.filter((template) => template.status === filter);
  const criteriaTotal = all.reduce((sum, template) => sum + template.acceptance_criteria.length, 0);
  const mandatoryTotal = all.reduce(
    (sum, template) => sum + template.acceptance_criteria.filter((criterion) => criterion.mandatory).length,
    0,
  );

  function openCreate() {
    setEditing(null);
    setEditorOpen(true);
  }

  function openEdit(template: TaskTemplate) {
    setEditing(template);
    setEditorOpen(true);
  }

  async function archive() {
    if (!archiveTarget) return;
    setArchiving(true);
    try {
      const result = await internflowApi.archiveTemplate(archiveTarget.id);
      toast.success("Template archived", result.message);
      setArchiveTarget(null);
      await templates.reload(true);
    } catch (caught) {
      toast.error("Could not archive template", caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setArchiving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="InternFlow"
        title="Task templates"
        description="Versioned assignments with deterministic acceptance criteria. Existing assignments keep the template version they started with."
        actions={
          <>
            <Link
              to="/internflow/imports"
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-mist-200 px-4 text-sm font-semibold text-graphite-800 transition hover:bg-mist-50 dark:border-white/10 dark:text-mist-100 dark:hover:bg-white/[0.06]"
            >
              <FileSpreadsheet className="h-4 w-4" /> Import interns
            </Link>
            <Button icon={Plus} onClick={openCreate}>
              New template
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Templates" value={counts.all} hint={`${counts.active} active · ${counts.draft} draft`} icon={Layers} />
        <StatCard label="Active sequence" value={counts.active} hint="Available for assignment" icon={ClipboardCheck} tone="green" />
        <StatCard label="Criteria" value={criteriaTotal} hint={`${mandatoryTotal} mandatory checks`} icon={Gauge} tone="violet" />
        <StatCard label="Archived" value={counts.archived} hint="Preserved for existing assignments" icon={Archive} tone="amber" />
      </div>

      {templates.error && !templates.data ? (
        <ErrorState message={templates.error} onRetry={() => void templates.reload()} />
      ) : null}

      <section className="app-surface overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-mist-100 p-4 dark:border-white/[0.07]">
          <Tabs
            variant="pills"
            value={filter}
            onChange={(value) => setFilter(value as Filter)}
            items={[
              { id: "all", label: "All", count: counts.all },
              { id: "active", label: "Active", count: counts.active },
              { id: "draft", label: "Draft", count: counts.draft },
              { id: "archived", label: "Archived", count: counts.archived },
            ]}
          />
          <p className="text-[11px] text-mist-400">Editing creates a new version automatically.</p>
        </div>

        {templates.loading && !templates.data ? (
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            {[0, 1, 2, 3].map((key) => (
              <Skeleton key={key} className="h-52 rounded-2xl" />
            ))}
          </div>
        ) : visible.length ? (
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            {visible.map((template) => (
              <article key={template.id} className="flex flex-col rounded-2xl border border-mist-200 p-5 dark:border-white/10">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-electric-500/10 text-[11px] font-bold text-electric-600 dark:text-electric-300">
                        {template.sequence_order}
                      </span>
                      <h2 className="font-display text-sm font-semibold text-graphite-950 dark:text-white">{template.title}</h2>
                    </div>
                    <p className="mt-1 font-mono text-[10px] text-mist-400">{template.slug}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusBadge status={template.status} />
                    <Badge tone="neutral">v{template.version}</Badge>
                  </div>
                </div>

                <p className="mt-3 line-clamp-3 text-xs leading-5 text-mist-500 dark:text-mist-400">
                  {template.description}
                </p>

                <div className="mt-4 grid grid-cols-2 gap-2 text-[11px] text-mist-500 dark:text-mist-400">
                  <span className="rounded-lg bg-mist-50 px-2.5 py-1.5 dark:bg-white/[0.03]">
                    {template.acceptance_criteria.length} criteria
                  </span>
                  <span className="rounded-lg bg-mist-50 px-2.5 py-1.5 dark:bg-white/[0.03]">
                    Pass ≥ {template.pass_threshold}
                  </span>
                  <span className="rounded-lg bg-mist-50 px-2.5 py-1.5 dark:bg-white/[0.03]">
                    {template.deadline_days} day deadline
                  </span>
                  <span className="rounded-lg bg-mist-50 px-2.5 py-1.5 dark:bg-white/[0.03]">
                    {template.max_attempts} attempt{template.max_attempts === 1 ? "" : "s"}
                  </span>
                </div>

                {template.deliverables.length ? (
                  <p className="mt-3 text-[11px] leading-5 text-mist-500 dark:text-mist-400">
                    <span className="font-semibold text-graphite-700 dark:text-mist-300">Deliverables:</span>{" "}
                    {template.deliverables.slice(0, 3).join(" · ")}
                    {template.deliverables.length > 3 ? ` +${template.deliverables.length - 3}` : ""}
                  </p>
                ) : null}

                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
                  <p className="text-[10px] text-mist-400">Updated {formatDateTime(template.updated_at)}</p>
                  <div className="flex items-center gap-1.5">
                    <Button variant="secondary" size="sm" icon={Pencil} onClick={() => openEdit(template)}>
                      Edit
                    </Button>
                    {template.status !== "archived" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Archive}
                        onClick={() => setArchiveTarget(template)}
                        className="text-mist-500 hover:text-rose-600"
                      >
                        Archive
                      </Button>
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="p-6">
            <EmptyState
              icon={FileSpreadsheet}
              title={all.length ? "No templates match this filter" : "No task templates yet"}
              description={
                all.length
                  ? "Choose another status filter to see the remaining templates."
                  : "Create a versioned template with objectives, deliverables and machine-verifiable acceptance criteria."
              }
              action={
                all.length ? (
                  <Button variant="secondary" onClick={() => setFilter("all")}>
                    Show all templates
                  </Button>
                ) : (
                  <Button icon={Plus} onClick={openCreate}>
                    Create the first template
                  </Button>
                )
              }
            />
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-navy-800 bg-navy-950 p-5 text-mist-300">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-300" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white">Evaluation guardrails</p>
          </div>
          <Link to="/internflow/evaluations" className="inline-flex items-center gap-1 text-[11px] font-semibold text-electric-300 underline">
            Review evaluations <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <p className="mt-2 text-[11px] leading-5 text-mist-400">
          Deterministic checks run in code. A failed mandatory criterion cannot be overridden by a high score, an
          unverified criterion forces human review, and every criterion result keeps the evidence that produced it.
        </p>
      </section>

      <TemplateForm
        open={editorOpen}
        template={editing}
        onClose={() => setEditorOpen(false)}
        onSaved={() => void templates.reload(true)}
      />

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        onClose={() => setArchiveTarget(null)}
        onConfirm={() => void archive()}
        title="Archive task template"
        description={
          archiveTarget
            ? `"${archiveTarget.title}" will no longer be available for new assignments. Existing assignments and evaluation history are preserved.`
            : ""
        }
        confirmLabel="Archive template"
        tone="danger"
        loading={archiving}
      />

      <p className="text-center text-[10px] text-mist-400">
        {counts.active} active template{counts.active === 1 ? "" : "s"} · {criteriaTotal} total criteria · scoped to your active organization
      </p>
    </div>
  );
}
