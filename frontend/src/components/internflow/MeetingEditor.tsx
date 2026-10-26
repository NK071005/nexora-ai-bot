import { useEffect, useState } from "react";
import { CalendarClock, Download, ExternalLink, Video } from "lucide-react";
import { useToast } from "@/app/ToastContext";
import { ApiError, downloadFile, internflowApi } from "@/services/api";
import type { Meeting } from "@/types/api";
import { Button, Field, Input, Notice, Select, Textarea } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/overlays";
import { fromLocalInput, toLocalInput } from "@/lib/format";

export function MeetingEditor({
  meeting,
  internName,
  onClose,
  onUpdated,
}: {
  meeting: Meeting | null;
  internName?: string;
  onClose: () => void;
  onUpdated: (meeting: Meeting) => void;
}) {
  const toast = useToast();
  const [status, setStatus] = useState("proposed");
  const [startAt, setStartAt] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!meeting) return;
    setStatus(meeting.status);
    setStartAt(toLocalInput(meeting.start_at));
    setNotes(meeting.notes);
    setError(null);
  }, [meeting]);

  if (!meeting) return null;

  async function save() {
    if (!meeting) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await internflowApi.updateMeeting(meeting.id, {
        status,
        start_at: startAt ? fromLocalInput(startAt) : undefined,
        notes,
      });
      toast.success("Meeting updated", "The change is recorded in the audit trail.");
      onUpdated(updated);
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The meeting could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  async function download() {
    if (!meeting) return;
    try {
      await downloadFile(`/internflow/meetings/${meeting.id}/ics`, `nexora-meeting-${meeting.id.slice(0, 8)}.ics`);
    } catch {
      toast.error("Calendar file unavailable");
    }
  }

  return (
    <Modal
      open={Boolean(meeting)}
      onClose={onClose}
      title="Review meeting"
      description={internName ? `${internName} · ${meeting.title}` : meeting.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Close
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            Save meeting
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Notice tone="danger" title="Could not update meeting">{error}</Notice> : null}

        <div className="rounded-xl border border-mist-200 bg-mist-50/50 p-4 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="flex flex-wrap items-center gap-2">
            <CalendarClock className="h-4 w-4 text-electric-500" />
            <p className="text-sm font-semibold text-graphite-900 dark:text-mist-100">{meeting.title}</p>
            {meeting.provider ? <span className="text-[10px] uppercase tracking-[0.1em] text-mist-400">{meeting.provider}</span> : null}
          </div>
          <p className="mt-1 text-xs text-mist-500 dark:text-mist-400">
            {meeting.start_at ? new Date(meeting.start_at).toLocaleString() : "No date proposed"} · {meeting.timezone}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {meeting.meet_url ? (
              <a
                href={meeting.meet_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-electric-500/10 px-2.5 py-1.5 text-xs font-semibold text-electric-700 dark:text-electric-200"
              >
                <Video className="h-3.5 w-3.5" /> Join real Meet link <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <span className="rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                No meeting URL exists. Calendar provider is not configured.
              </span>
            )}
            <Button variant="secondary" size="sm" icon={Download} onClick={() => void download()}>
              Download .ics
            </Button>
          </div>
        </div>

        <Field label="Status" htmlFor="meeting-status">
          <Select id="meeting-status" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="proposed">Proposed</option>
            <option value="scheduled">Scheduled</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </Field>
        <Field
          label="Start date and time"
          hint="Saved in UTC. Leave blank to keep the proposed slot. The original 45-minute duration is preserved."
          htmlFor="meeting-start"
        >
          <Input id="meeting-start" type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} />
        </Field>
        <Field label="Notes" htmlFor="meeting-notes">
          <Textarea id="meeting-notes" rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={4000} />
        </Field>
        {status === "scheduled" && !meeting.meet_url ? (
          <Notice tone="warning" title="Scheduling without a meeting URL">
            The API will add a note making clear that no Google Meet link exists. Share a joining method with the intern
            before marking this scheduled.
          </Notice>
        ) : null}
      </div>
    </Modal>
  );
}
