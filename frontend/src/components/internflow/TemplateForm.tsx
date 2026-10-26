import { useEffect, useState } from "react";
import { AlertCircle, GripVertical, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/app/ToastContext";
import { ApiError, internflowApi } from "@/services/api";
import type { CriterionConfig, TaskTemplate } from "@/types/api";
import {
  Button,
  Checkbox,
  Field,
  IconButton,
  Input,
  Notice,
  Select,
  Textarea,
} from "@/components/ui/primitives";
import { Modal } from "@/components/ui/overlays";
import { CRITERION_TYPES } from "@/lib/constants";

interface CriterionDraft {
  key: string;
  label: string;
  type: CriterionConfig["type"];
  mandatory: boolean;
  weight: string;
  description: string;
  keywords: string;
  groups: string;
  min: string;
  sections: string;
  forbidden: string;
  extensions: string;
}

interface TemplateDraft {
  title: string;
  slug: string;
  description: string;
  objectives: string;
  expected_methodology: string;
  deliverables: string;
  permitted_tools: string;
  submission_formats: string;
  deadline_days: string;
  review_required: boolean;
  pass_threshold: string;
  max_attempts: string;
  escalation_policy: string;
  sequence_order: string;
  status: string;
  criteria: CriterionDraft[];
}

const emptyCriterion = (index: number): CriterionDraft => ({
  key: `criterion_${index + 1}`,
  label: "",
  type: "keywords",
  mandatory: true,
  weight: "1",
  description: "",
  keywords: "",
  groups: "",
  min: "100",
  sections: "",
  forbidden: "",
  extensions: "",
});

function toDrafts(criteria: CriterionConfig[]): CriterionDraft[] {
  return criteria.map((criterion, index) => ({
    key: criterion.key ?? `criterion_${index + 1}`,
    label: criterion.label ?? "",
    type: criterion.type ?? "keywords",
    mandatory: Boolean(criterion.mandatory),
    weight: String(criterion.weight ?? 1),
    description: criterion.description ?? "",
    keywords: (criterion.keywords ?? []).join(", "),
    groups: (criterion.keyword_groups ?? []).map((group) => group.join(" | ")).join("\n"),
    min: criterion.min !== undefined ? String(criterion.min) : criterion.type === "min_count" ? "3" : "100",
    sections: (criterion.sections ?? []).join(", "),
    forbidden: (criterion.forbidden ?? []).join(", "),
    extensions: (criterion.extensions ?? []).join(", "),
  }));
}

function splitList(value: string): string[] {
  return value
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toCriterion(draft: CriterionDraft): CriterionConfig {
  const base: CriterionConfig = {
    key: draft.key.trim(),
    type: draft.type,
    mandatory: draft.mandatory,
    weight: Number(draft.weight) || 1,
  };
  if (draft.label.trim()) base.label = draft.label.trim();
  if (draft.description.trim()) base.description = draft.description.trim();
  if (draft.type === "keywords") {
    const keywords = splitList(draft.keywords);
    const groups = draft.groups
      .split("\n")
      .map((line) => line.split("|").map((item) => item.trim()).filter(Boolean))
      .filter((group) => group.length > 0);
    if (keywords.length) base.keywords = keywords;
    if (groups.length) base.keyword_groups = groups;
  }
  if (draft.type === "min_words" || draft.type === "min_count") {
    base.min = Math.max(1, Number(draft.min) || 1);
  }
  if (draft.type === "sections") base.sections = splitList(draft.sections);
  if (draft.type === "forbidden") base.forbidden = splitList(draft.forbidden);
  if (draft.type === "file") {
    base.extensions = splitList(draft.extensions).map((ext) => (ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`));
  }
  return base;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function buildDraft(template: TaskTemplate | null): TemplateDraft {
  if (!template) {
    return {
      title: "",
      slug: "",
      description: "",
      objectives: "",
      expected_methodology: "",
      deliverables: "",
      permitted_tools: "NEXORA AI chat",
      submission_formats: "Markdown, PDF",
      deadline_days: "7",
      review_required: true,
      pass_threshold: "70",
      max_attempts: "3",
      escalation_policy: "human_review",
      sequence_order: "1",
      status: "active",
      criteria: [emptyCriterion(0)],
    };
  }
  return {
    title: template.title,
    slug: template.slug,
    description: template.description,
    objectives: template.objectives.join("\n"),
    expected_methodology: template.expected_methodology,
    deliverables: template.deliverables.join("\n"),
    permitted_tools: template.permitted_tools.join(", "),
    submission_formats: template.submission_formats.join(", "),
    deadline_days: String(template.deadline_days),
    review_required: template.review_required,
    pass_threshold: String(template.pass_threshold),
    max_attempts: String(template.max_attempts),
    escalation_policy: template.escalation_policy,
    sequence_order: String(template.sequence_order),
    status: template.status,
    criteria: toDrafts(template.acceptance_criteria),
  };
}

export function TemplateForm({
  open,
  template,
  onClose,
  onSaved,
}: {
  open: boolean;
  template: TaskTemplate | null;
  onClose: () => void;
  onSaved: (template: TaskTemplate) => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<TemplateDraft>(() => buildDraft(template));
  const [slugTouched, setSlugTouched] = useState(Boolean(template));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setDraft(buildDraft(template));
    setSlugTouched(Boolean(template));
    setError(null);
    setFieldErrors({});
  }, [open, template]);

  function update<K extends keyof TemplateDraft>(key: K, value: TemplateDraft[K]) {
    setDraft((state) => ({ ...state, [key]: value }));
  }

  function updateCriterion(index: number, patch: Partial<CriterionDraft>) {
    setDraft((state) => ({
      ...state,
      criteria: state.criteria.map((criterion, position) =>
        position === index ? { ...criterion, ...patch } : criterion,
      ),
    }));
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (draft.title.trim().length < 3) next.title = "Use at least 3 characters.";
    if (!/^[a-z0-9][a-z0-9-]*$/.test(draft.slug.trim())) {
      next.slug = "Use lowercase letters, numbers and hyphens, starting with a letter or number.";
    }
    if (draft.description.trim().length < 10) next.description = "Describe the task in at least 10 characters.";
    const seen = new Set<string>();
    draft.criteria.forEach((criterion, index) => {
      if (!criterion.key.trim()) {
        next[`criterion-${index}`] = "Every criterion needs a stable key.";
        return;
      }
      if (seen.has(criterion.key.trim())) {
        next[`criterion-${index}`] = "Criterion keys must be unique.";
      }
      seen.add(criterion.key.trim());
      if (criterion.type === "keywords" && !criterion.keywords.trim() && !criterion.groups.trim()) {
        next[`criterion-${index}`] = "Add at least one required keyword or alternative group.";
      }
      if (criterion.type === "sections" && !criterion.sections.trim()) {
        next[`criterion-${index}`] = "List at least one required section.";
      }
      if (criterion.type === "forbidden" && !criterion.forbidden.trim()) {
        next[`criterion-${index}`] = "List at least one forbidden term.";
      }
      if (criterion.type === "file" && !criterion.extensions.trim()) {
        next[`criterion-${index}`] = "List at least one accepted extension.";
      }
    });
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function save() {
    if (!validate()) {
      setError("Check the highlighted fields before saving.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        title: draft.title.trim(),
        description: draft.description.trim(),
        objectives: draft.objectives.split("\n").map((line) => line.trim()).filter(Boolean),
        expected_methodology: draft.expected_methodology,
        deliverables: draft.deliverables.split("\n").map((line) => line.trim()).filter(Boolean),
        acceptance_criteria: draft.criteria.map(toCriterion),
        permitted_tools: splitList(draft.permitted_tools),
        submission_formats: splitList(draft.submission_formats),
        deadline_days: Number(draft.deadline_days) || 7,
        review_required: draft.review_required,
        pass_threshold: Number(draft.pass_threshold) || 70,
        max_attempts: Number(draft.max_attempts) || 3,
        escalation_policy: draft.escalation_policy,
        sequence_order: Number(draft.sequence_order) || 1,
        status: draft.status,
      };
      let saved: TaskTemplate;
      if (template) {
        saved = await internflowApi.updateTemplate(template.id, payload);
        toast.success("Template updated", `Version ${saved.version} is now available for new assignments.`);
      } else {
        saved = await internflowApi.createTemplate({ ...payload, slug: draft.slug.trim() });
        toast.success("Template created", "You can assign it to an intern right away.");
      }
      onSaved(saved);
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFieldErrors(caught.fieldErrors);
      } else {
        setError("The template could not be saved.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={template ? "Edit task template" : "New task template"}
      description={
        template
          ? "Saving creates a new template version. Existing assignments keep the version they were assigned under."
          : "Templates drive deterministic evaluation. Every criterion is checked in code before a score is calculated."
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            {template ? "Save new version" : "Create template"}
          </Button>
        </>
      }
    >
      <div className="space-y-7">
        {error ? <Notice tone="danger" title="Could not save template">{error}</Notice> : null}

        <section className="space-y-4">
          <div>
            <h3 className="font-display text-sm font-semibold text-graphite-950 dark:text-white">Basics</h3>
            <p className="mt-0.5 text-xs text-mist-500 dark:text-mist-400">Identity, ordering and visibility in the assignment sequence.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title" required error={fieldErrors.title} htmlFor="template-title" className="sm:col-span-2">
              <Input
                id="template-title"
                value={draft.title}
                maxLength={200}
                onChange={(event) => {
                  const value = event.target.value;
                  setDraft((state) => ({
                    ...state,
                    title: value,
                    slug: slugTouched ? state.slug : slugify(value),
                  }));
                }}
                invalid={Boolean(fieldErrors.title)}
                placeholder="Market research brief"
              />
            </Field>
            <Field
              label="Slug"
              required
              error={fieldErrors.slug}
              hint={template ? "The slug is immutable so existing references stay stable." : "Lowercase, hyphenated. Used for imports and the API."}
              htmlFor="template-slug"
            >
              <Input
                id="template-slug"
                value={draft.slug}
                maxLength={120}
                disabled={Boolean(template)}
                onChange={(event) => {
                  setSlugTouched(true);
                  update("slug", slugify(event.target.value));
                }}
                invalid={Boolean(fieldErrors.slug)}
                placeholder="market-research-brief"
              />
            </Field>
            <Field label="Sequence order" hint="Lower numbers are assigned first." htmlFor="template-sequence">
              <Input
                id="template-sequence"
                type="number"
                min={1}
                max={100}
                value={draft.sequence_order}
                onChange={(event) => update("sequence_order", event.target.value)}
              />
            </Field>
            <Field label="Description" required error={fieldErrors.description} htmlFor="template-description" className="sm:col-span-2">
              <Textarea
                id="template-description"
                rows={3}
                value={draft.description}
                maxLength={8000}
                onChange={(event) => update("description", event.target.value)}
                invalid={Boolean(fieldErrors.description)}
                placeholder="What the intern must produce, for whom, and why it matters."
              />
            </Field>
            <Field label="Objectives" hint="One per line." htmlFor="template-objectives">
              <Textarea
                id="template-objectives"
                rows={3}
                value={draft.objectives}
                onChange={(event) => update("objectives", event.target.value)}
                placeholder={"Define the buyer and problem\nMap three competitors"}
              />
            </Field>
            <Field label="Deliverables" hint="One per line." htmlFor="template-deliverables">
              <Textarea
                id="template-deliverables"
                rows={3}
                value={draft.deliverables}
                onChange={(event) => update("deliverables", event.target.value)}
                placeholder={"Written brief\nEvidence table"}
              />
            </Field>
            <Field label="Expected methodology" htmlFor="template-methodology" className="sm:col-span-2">
              <Textarea
                id="template-methodology"
                rows={2}
                value={draft.expected_methodology}
                maxLength={6000}
                onChange={(event) => update("expected_methodology", event.target.value)}
                placeholder="How the work should be done, what evidence is acceptable, what to avoid."
              />
            </Field>
            <Field label="Permitted tools" hint="Comma separated." htmlFor="template-tools">
              <Input
                id="template-tools"
                value={draft.permitted_tools}
                onChange={(event) => update("permitted_tools", event.target.value)}
                placeholder="NEXORA AI chat, Library, Spreadsheet"
              />
            </Field>
            <Field label="Submission formats" hint="Comma separated." htmlFor="template-formats">
              <Input
                id="template-formats"
                value={draft.submission_formats}
                onChange={(event) => update("submission_formats", event.target.value)}
                placeholder="Markdown, PDF, DOCX"
              />
            </Field>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="font-display text-sm font-semibold text-graphite-950 dark:text-white">Acceptance criteria</h3>
              <p className="mt-0.5 text-xs text-mist-500 dark:text-mist-400">
                Mandatory failures can never be overridden by a high score. Unverified criteria force human review.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              icon={Plus}
              onClick={() => update("criteria", [...draft.criteria, emptyCriterion(draft.criteria.length)])}
            >
              Add criterion
            </Button>
          </div>

          {draft.criteria.length === 0 ? (
            <div className="rounded-xl border border-dashed border-amber-500/40 bg-amber-500/[0.04] p-4 text-xs text-amber-800 dark:text-amber-200">
              <AlertCircle className="mr-1.5 inline h-3.5 w-3.5" />
              Without criteria, every submission requires human review because there is nothing deterministic to check.
            </div>
          ) : null}

          <div className="space-y-3">
            {draft.criteria.map((criterion, index) => {
              const hint = CRITERION_TYPES.find((item) => item.value === criterion.type)?.hint;
              return (
                <div key={index} className="rounded-xl border border-mist-200 bg-mist-50/40 p-4 dark:border-white/10 dark:bg-white/[0.02]">
                  <div className="flex items-start gap-2">
                    <GripVertical className="mt-2.5 h-4 w-4 shrink-0 text-mist-300" aria-hidden />
                    <div className="min-w-0 flex-1 space-y-3">
                      <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_90px_84px]">
                        <Field label="Label" htmlFor={`criterion-label-${index}`}>
                          <Input
                            id={`criterion-label-${index}`}
                            value={criterion.label}
                            onChange={(event) => updateCriterion(index, { label: event.target.value })}
                            placeholder="Defines market and audience"
                          />
                        </Field>
                        <Field label="Key" htmlFor={`criterion-key-${index}`}>
                          <Input
                            id={`criterion-key-${index}`}
                            value={criterion.key}
                            onChange={(event) => updateCriterion(index, { key: slugify(event.target.value).replace(/-/g, "_") })}
                            placeholder="market_terms"
                          />
                        </Field>
                        <Field label="Weight" htmlFor={`criterion-weight-${index}`}>
                          <Input
                            id={`criterion-weight-${index}`}
                            type="number"
                            min={0.5}
                            step={0.5}
                            value={criterion.weight}
                            onChange={(event) => updateCriterion(index, { weight: event.target.value })}
                          />
                        </Field>
                        <div className="flex items-end pb-2.5">
                          <Checkbox
                            label="Required"
                            checked={criterion.mandatory}
                            onChange={(event) => updateCriterion(index, { mandatory: event.target.checked })}
                          />
                        </div>
                      </div>

                      <Field label="Check type" hint={hint} htmlFor={`criterion-type-${index}`}>
                        <Select
                          id={`criterion-type-${index}`}
                          value={criterion.type}
                          onChange={(event) => updateCriterion(index, { type: event.target.value as CriterionDraft["type"] })}
                        >
                          {CRITERION_TYPES.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </Select>
                      </Field>

                      {criterion.type === "keywords" ? (
                        <div className="space-y-3">
                          <Field label="Required keywords" hint="Comma separated. Every term must appear." htmlFor={`criterion-keywords-${index}`}>
                            <Input
                              id={`criterion-keywords-${index}`}
                              value={criterion.keywords}
                              onChange={(event) => updateCriterion(index, { keywords: event.target.value })}
                              placeholder="market, audience, competitor"
                            />
                          </Field>
                          <Field
                            label="Alternative groups"
                            hint="Optional. One group per line; use | between acceptable alternatives. At least one alternative per line must appear."
                            htmlFor={`criterion-groups-${index}`}
                          >
                            <Textarea
                              id={`criterion-groups-${index}`}
                              rows={2}
                              value={criterion.groups}
                              onChange={(event) => updateCriterion(index, { groups: event.target.value })}
                              placeholder={"otter | fireflies\npricing | price"}
                            />
                          </Field>
                        </div>
                      ) : null}

                      {criterion.type === "min_words" ? (
                        <Field label="Minimum words" htmlFor={`criterion-min-${index}`}>
                          <Input
                            id={`criterion-min-${index}`}
                            type="number"
                            min={1}
                            max={10000}
                            value={criterion.min}
                            onChange={(event) => updateCriterion(index, { min: event.target.value })}
                          />
                        </Field>
                      ) : null}

                      {criterion.type === "min_count" ? (
                        <Field label="Minimum list items" htmlFor={`criterion-min-${index}`}>
                          <Input
                            id={`criterion-min-${index}`}
                            type="number"
                            min={1}
                            max={100}
                            value={criterion.min}
                            onChange={(event) => updateCriterion(index, { min: event.target.value })}
                          />
                        </Field>
                      ) : null}

                      {criterion.type === "sections" ? (
                        <Field label="Required sections" hint="Comma separated section titles." htmlFor={`criterion-sections-${index}`}>
                          <Input
                            id={`criterion-sections-${index}`}
                            value={criterion.sections}
                            onChange={(event) => updateCriterion(index, { sections: event.target.value })}
                            placeholder="Summary, Findings, Recommendations"
                          />
                        </Field>
                      ) : null}

                      {criterion.type === "forbidden" ? (
                        <Field label="Forbidden terms" hint="Comma separated. Their presence fails this criterion." htmlFor={`criterion-forbidden-${index}`}>
                          <Input
                            id={`criterion-forbidden-${index}`}
                            value={criterion.forbidden}
                            onChange={(event) => updateCriterion(index, { forbidden: event.target.value })}
                            placeholder="lorem ipsum, todo, tbd"
                          />
                        </Field>
                      ) : null}

                      {criterion.type === "file" ? (
                        <Field label="Accepted extensions" hint="Comma separated. Dots are added automatically." htmlFor={`criterion-extensions-${index}`}>
                          <Input
                            id={`criterion-extensions-${index}`}
                            value={criterion.extensions}
                            onChange={(event) => updateCriterion(index, { extensions: event.target.value })}
                            placeholder="pdf, docx, xlsx"
                          />
                        </Field>
                      ) : null}

                      <Field label="Reviewer note" hint="Shown as context in the evaluation result." htmlFor={`criterion-description-${index}`}>
                        <Input
                          id={`criterion-description-${index}`}
                          value={criterion.description}
                          onChange={(event) => updateCriterion(index, { description: event.target.value })}
                          placeholder="Why this criterion matters"
                        />
                      </Field>

                      {fieldErrors[`criterion-${index}`] ? (
                        <p className="field-error">{fieldErrors[`criterion-${index}`]}</p>
                      ) : null}
                    </div>
                    <IconButton
                      label="Remove criterion"
                      onClick={() => update("criteria", draft.criteria.filter((_, position) => position !== index))}
                      className="mt-1 shrink-0 text-mist-400 hover:text-rose-500"
                    >
                      <Trash2 className="h-4 w-4" />
                    </IconButton>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="space-y-4">
          <div>
            <h3 className="font-display text-sm font-semibold text-graphite-950 dark:text-white">Evaluation policy</h3>
            <p className="mt-0.5 text-xs text-mist-500 dark:text-mist-400">Applies to future submissions against this version.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Deadline (days)" htmlFor="template-deadline">
              <Input
                id="template-deadline"
                type="number"
                min={1}
                max={90}
                value={draft.deadline_days}
                onChange={(event) => update("deadline_days", event.target.value)}
              />
            </Field>
            <Field label="Pass threshold" htmlFor="template-threshold">
              <Input
                id="template-threshold"
                type="number"
                min={0}
                max={100}
                value={draft.pass_threshold}
                onChange={(event) => update("pass_threshold", event.target.value)}
              />
            </Field>
            <Field label="Max attempts" htmlFor="template-attempts">
              <Input
                id="template-attempts"
                type="number"
                min={1}
                max={10}
                value={draft.max_attempts}
                onChange={(event) => update("max_attempts", event.target.value)}
              />
            </Field>
            <Field label="Status" htmlFor="template-status">
              <Select id="template-status" value={draft.status} onChange={(event) => update("status", event.target.value)}>
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="archived">Archived</option>
              </Select>
            </Field>
            <Field label="Escalation policy" hint="Used when attempts are exhausted or criteria need judgment." htmlFor="template-escalation" className="sm:col-span-2">
              <Select
                id="template-escalation"
                value={draft.escalation_policy}
                onChange={(event) => update("escalation_policy", event.target.value)}
              >
                <option value="human_review">Require human review</option>
                <option value="notify_admin">Notify an administrator</option>
                <option value="auto_fail">Mark as failed</option>
              </Select>
            </Field>
            <div className="flex items-end pb-1 sm:col-span-2">
              <Checkbox
                label="Human review required for qualitative criteria"
                description="Manual and unverifiable criteria always force a reviewer decision."
                checked={draft.review_required}
                onChange={(event) => update("review_required", event.target.checked)}
              />
            </div>
          </div>
        </section>
      </div>
    </Modal>
  );
}
