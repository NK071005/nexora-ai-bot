import { useEffect, useState } from "react";
import { CalendarClock, Send } from "lucide-react";
import { useToast } from "@/app/ToastContext";
import { useApiQuery } from "@/hooks/useApi";
import { ApiError, internflowApi } from "@/services/api";
import type { Assignment } from "@/types/api";
import { Checkbox, Field, Input, Notice, Select } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/overlays";
import { Button } from "@/components/ui/primitives";

export function AssignTaskModal({
  open,
  internId,
  internName,
  onClose,
  onAssigned,
}: {
  open: boolean;
  internId: string | null;
  internName?: string;
  onClose: () => void;
  onAssigned: (assignment: Assignment) => void;
}) {
  const toast = useToast();
  const templates = useApiQuery(
    () => (open ? internflowApi.templates() : Promise.resolve([])),
    [open, internId],
  );
  const [templateId, setTemplateId] = useState("");
  const [dueDays, setDueDays] = useState("");
  const [notify, setNotify] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeTemplates = (templates.data ?? []).filter((template) => template.status === "active");
  const selected = activeTemplates.find((template) => template.id === templateId) ?? null;

  useEffect(() => {
    if (!open) return;
    setTemplateId("");
    setDueDays("");
    setNotify(true);
    setError(null);
  }, [open, internId]);

  async function assign() {
    if (!internId) return;
    if (!templateId) {
      setError("Choose an active template first.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const assignment = await internflowApi.assign(internId, {
        template_id: templateId,
        due_days: dueDays ? Number(dueDays) : undefined,
        send_notification: notify,
      });
      toast.success("Task assigned", `${assignment.title} is now the active task.`);
      onAssigned(assignment);
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The task could not be assigned.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Assign a task"
      description={internName ? `A new active assignment for ${internName}.` : "Choose a template and deadline."}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button icon={Send} onClick={() => void assign()} loading={saving} disabled={!activeTemplates.length}>
            Assign task
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Notice tone="danger" title="Could not assign task">{error}</Notice> : null}
        {templates.loading ? (
          <p className="text-sm text-mist-500">Loading templates…</p>
        ) : activeTemplates.length ? (
          <>
            <Field label="Template" required htmlFor="assign-template">
              <Select id="assign-template" value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
                <option value="">Select an active template…</option>
                {activeTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.sequence_order}. {template.title} (v{template.version})
                  </option>
                ))}
              </Select>
            </Field>
            {selected ? (
              <div className="rounded-xl border border-mist-200 bg-mist-50/50 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                <p className="text-sm font-semibold text-graphite-900 dark:text-mist-100">{selected.title}</p>
                <p className="mt-1 text-xs leading-5 text-mist-500 dark:text-mist-400">{selected.description}</p>
                <div className="mt-3 grid gap-2 text-[11px] text-mist-500 dark:text-mist-400 sm:grid-cols-3">
                  <span>Default deadline: {selected.deadline_days} days</span>
                  <span>Pass threshold: {selected.pass_threshold}</span>
                  <span>Max attempts: {selected.max_attempts}</span>
                </div>
                <p className="mt-2 text-[11px] text-mist-500 dark:text-mist-400">
                  {selected.acceptance_criteria.length} deterministic criteria ·{" "}
                  {selected.acceptance_criteria.filter((criterion) => criterion.mandatory).length} mandatory
                </p>
              </div>
            ) : null}
            <Field
              label="Deadline override (days)"
              hint="Leave blank to use the template deadline. Due time is 18:00 in the intern's timezone."
              htmlFor="assign-due-days"
            >
              <Input
                id="assign-due-days"
                type="number"
                min={1}
                max={90}
                value={dueDays}
                onChange={(event) => setDueDays(event.target.value)}
                placeholder={selected ? String(selected.deadline_days) : "Template default"}
              />
            </Field>
            <Checkbox
              label="Send the assignment notification"
              description="Creates an in-app notification and records an email (sent over SMTP, or demo-logged when not configured)."
              checked={notify}
              onChange={(event) => setNotify(event.target.checked)}
            />
            <div className="flex items-start gap-2 rounded-xl border border-mist-200 p-3 text-[11px] leading-5 text-mist-500 dark:border-white/10 dark:text-mist-400">
              <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-electric-500" />
              The intern must have no open assignment. Reminder jobs are scheduled 24 hours before and after the deadline.
            </div>
          </>
        ) : (
          <Notice tone="warning" title="No active templates">
            Create or activate a template before assigning work. Draft and archived templates cannot be assigned.
          </Notice>
        )}
      </div>
    </Modal>
  );
}
