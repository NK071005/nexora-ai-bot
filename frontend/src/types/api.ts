export type Role = "owner" | "admin" | "member" | "intern";

export interface User {
  id: string;
  email: string;
  full_name: string;
  is_super_admin: boolean;
  email_verified_at: string | null;
  timezone: string;
  theme: string;
  created_at: string;
}

export interface Membership {
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  role: Role;
  status: string;
}

export interface AiCapabilities {
  provider: string;
  label: string;
  model: string;
  demo: boolean;
  configured: boolean;
  capabilities: Record<string, boolean | { configured: boolean; mode: string }>;
  notes: Record<string, string>;
}

export interface IntegrationCapability {
  configured: boolean;
  mode: string;
  note?: string;
  provider?: string;
  model?: string;
}

export interface Capabilities {
  ai: AiCapabilities;
  search: IntegrationCapability & { provider: string; local?: Record<string, unknown> };
  email: IntegrationCapability;
  calendar: IntegrationCapability & { provider?: string };
  google_oauth: boolean;
  storage: IntegrationCapability & { path?: string; max_upload_mb?: number };
}

export interface MeResponse {
  user: User;
  profile: {
    headline: string;
    bio: string;
    preferences: Record<string, unknown>;
    notification_prefs: Record<string, unknown>;
  };
  organizations: Membership[];
  active_organization_id: string | null;
  is_internflow_admin: boolean;
  is_intern: boolean;
  capabilities: Capabilities;
}

export interface SessionInfo {
  id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  user_agent: string;
  ip_address: string;
  current: boolean;
}

export interface FileRecord {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  kind: string;
  extraction_status: string;
  page_count: number | null;
  metadata_json: Record<string, unknown>;
  created_at: string;
}

export interface Citation {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  published_at: string | null;
  index: number;
}

export interface ToolActivity {
  tool: string;
  status: string;
  summary: string;
  details?: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  chat_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  status: string;
  provider: string | null;
  model: string | null;
  citations: Citation[];
  tool_activity: ToolActivity[];
  error: string | null;
  created_at: string;
  attachments: FileRecord[];
}

export interface Chat {
  id: string;
  title: string;
  model: string | null;
  is_pinned: boolean;
  is_archived: boolean;
  message_count: number;
  last_message_at: string;
  created_at: string;
  updated_at: string;
  tags: string[];
  preview: string | null;
}

export interface ChatListResponse {
  items: Chat[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface ChatDetail {
  chat: Chat;
  messages: ChatMessage[];
}

export interface LibraryFolder {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
  item_count: number;
}

export interface LibraryTag {
  id: string;
  name: string;
  created_at: string;
}

export type LibraryKind = "note" | "document" | "web" | "chat" | "answer" | "spreadsheet" | "image";

export interface LibraryItem {
  id: string;
  title: string;
  kind: LibraryKind;
  description: string;
  content_text: string | null;
  folder_id: string | null;
  file_id: string | null;
  source_type: string | null;
  source_id: string | null;
  is_favorite: boolean;
  metadata_json: Record<string, unknown>;
  tags: string[];
  chunk_count: number;
  created_at: string;
  updated_at: string;
}

export interface LibraryItemList {
  items: LibraryItem[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface LibraryHit {
  id: string;
  title: string;
  kind: string;
  snippet: string;
  updated_at: string;
}

export interface LibraryChunk {
  id: string;
  chunk_index: number;
  content: string;
  page_number: number | null;
  token_estimate: number;
}

export interface SearchStatus {
  configured: boolean;
  provider: string;
  mode: string;
  note: string;
  local: {
    chat_history: boolean;
    library_lexical: boolean;
    semantic: boolean;
    note: string;
  };
}

export interface WebSearchItem {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  published_at: string | null;
  rank: number;
}

export interface WebSearchResponse {
  configured: boolean;
  provider: string;
  results: WebSearchItem[];
  message: string | null;
}

export interface HistorySearchHit {
  id: string;
  title: string;
  snippet: string;
  updated_at: string;
  is_archived: boolean;
  is_pinned: boolean;
  match: string;
}

export interface RecentSearch {
  id: string;
  query: string;
  provider: string;
  status: string;
  result_count: number;
  created_at: string;
  results: WebSearchItem[];
}

export interface TaskType {
  key: string;
  label: string;
  description: string;
  config_fields: string[];
  requires_organization: boolean;
  requires_search: boolean;
}

export interface ScheduleMeta {
  task_types: TaskType[];
  scheduler_enabled: boolean;
  timezones: string[];
}

export interface ScheduledTask {
  id: string;
  title: string;
  description: string;
  task_type: string;
  schedule_kind: "once" | "daily" | "weekly" | "monthly";
  timezone: string;
  run_at: string | null;
  time_of_day: string | null;
  day_of_week: number | null;
  day_of_month: number | null;
  next_run_at: string | null;
  last_run_at: string | null;
  status: "active" | "paused" | "cancelled" | "completed";
  run_count: number;
  failure_count: number;
  last_error: string | null;
  notify: boolean;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ScheduledRun {
  id: string;
  task_id: string;
  scheduled_for: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  attempt: number;
  output: string | null;
  error: string | null;
  created_at: string;
}

export interface ScheduledTaskDetail {
  task: ScheduledTask;
  runs: ScheduledRun[];
  handlers: TaskType[];
}

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  kind: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface NotificationList {
  items: NotificationItem[];
  total: number;
  unread: number;
  limit: number;
  offset: number;
}

export interface Integration {
  provider: string;
  label: string;
  category: string;
  configured: boolean;
  mode: string;
  status: string;
  note: string;
  required_env: string[];
  connected_at: string | null;
}

export interface ConfigStatus {
  app: Record<string, unknown>;
  ai: Record<string, unknown> & { provider?: string; label?: string; demo?: boolean; model?: string };
  search: Record<string, unknown>;
  email: Record<string, unknown>;
  calendar: Record<string, unknown>;
  google_oauth: Record<string, unknown>;
  storage: Record<string, unknown>;
  scheduler: Record<string, unknown>;
  video: Record<string, unknown>;
  integrations: Integration[];
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  kind: string;
  settings: Record<string, unknown>;
  created_at: string;
}

export interface AuditLog {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_id: string | null;
  metadata_json: Record<string, unknown>;
  created_at: string;
}

export interface AdminOverview {
  organizations: number;
  users: number;
  active_users: number;
  interns: number;
  chats: number;
  scheduled_tasks: number;
  you: { id: string; email: string };
}

export interface AdminOrganization {
  id: string;
  name: string;
  slug: string;
  kind: string;
  members: number;
  interns: number;
  created_at: string;
}

export interface AdminUser {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  is_super_admin: boolean;
  email_verified: boolean;
  last_login_at: string | null;
  organizations: { id: string; name: string; role: string; status: string }[];
}

/* InternFlow */
export interface Intern {
  id: string;
  user_id: string | null;
  full_name: string;
  email: string;
  department: string;
  role_title: string;
  company_name: string;
  start_date: string | null;
  end_date: string | null;
  duration_weeks: number | null;
  timezone: string;
  status: string;
  onboarding_email_status: string | null;
  current_assignment_id: string | null;
  current_task: string | null;
  current_status: string | null;
  due_at: string | null;
  overdue: boolean;
  tasks_total: number;
  tasks_approved: number;
  notes: string;
  created_at: string;
}

export interface CriterionResult {
  id: string;
  criterion_key: string;
  label: string;
  mandatory: boolean;
  weight: number;
  status: "passed" | "failed" | "unverified" | string;
  score: number;
  evidence: string;
  comment: string;
}

export interface Evaluation {
  id: string;
  submission_id: string;
  assignment_id: string;
  status: string;
  score: number;
  confidence: number;
  summary: string;
  strengths: string[];
  errors: string[];
  missing_requirements: string[];
  corrective_actions: string[];
  human_review_required: boolean;
  human_review_reason: string | null;
  evaluator: string;
  rubric_version: string;
  decision: string | null;
  decision_note: string | null;
  decided_at: string | null;
  created_at: string;
  criteria_results: CriterionResult[];
}

export interface SubmissionFile {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  created_at: string;
}

export interface Submission {
  id: string;
  assignment_id: string;
  intern_id: string;
  version: number;
  text_content: string;
  status: string;
  submitted_at: string;
  files: SubmissionFile[];
}

export interface TaskTemplate {
  id: string;
  title: string;
  slug: string;
  description: string;
  objectives: string[];
  expected_methodology: string;
  deliverables: string[];
  acceptance_criteria: CriterionConfig[];
  rubric: Record<string, unknown>;
  permitted_tools: string[];
  submission_formats: string[];
  deadline_days: number;
  review_required: boolean;
  pass_threshold: number;
  max_attempts: number;
  escalation_policy: string;
  sequence_order: number;
  version: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface CriterionConfig {
  key: string;
  label?: string;
  type: "keywords" | "min_words" | "table" | "sections" | "min_count" | "forbidden" | "file" | "manual";
  mandatory?: boolean;
  weight?: number;
  description?: string;
  keywords?: string[];
  keyword_groups?: string[][];
  min?: number;
  sections?: string[];
  forbidden?: string[];
  extensions?: string[];
}

export interface Assignment {
  id: string;
  intern_id: string;
  template_id: string;
  template_version: number;
  title: string;
  sequence_order: number;
  status: string;
  attempt_count: number;
  assigned_at: string;
  due_at: string | null;
  approved_at: string | null;
  completed_at: string | null;
  escalation_state: string | null;
  next_assignment_id: string | null;
  template?: TaskTemplate | null;
}

export interface Meeting {
  id: string;
  intern_id: string;
  assignment_id: string | null;
  evaluation_id: string | null;
  title: string;
  status: "proposed" | "scheduled" | "completed" | "cancelled" | string;
  start_at: string | null;
  end_at: string | null;
  timezone: string;
  meet_url: string | null;
  provider: string;
  notes: string;
  created_at: string;
}

export interface EmailLog {
  id: string;
  to_email: string;
  subject: string;
  kind: string;
  status: string;
  provider: string;
  error: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface ImportRow {
  row_number: number;
  values: Record<string, string>;
  errors: string[];
}

export interface ImportBatch {
  id: string;
  filename: string;
  status: string;
  row_count: number;
  valid_count: number;
  error_count: number;
  rows: ImportRow[];
  errors: { row?: number; message?: string; [key: string]: unknown }[];
  column_mapping?: Record<string, string>;
  created_at: string;
  confirmed_at: string | null;
}

export interface InternDetail {
  intern: Intern;
  assignments: Assignment[];
  submissions: Submission[];
  evaluations: Evaluation[];
  meetings: Meeting[];
  emails: EmailLog[];
}

export interface InternList {
  items: Intern[];
  total: number;
  limit: number;
  offset: number;
  summary: ProgressSummary;
}

export interface ProgressRow {
  intern_id: string;
  name: string;
  email: string;
  status: string;
  department: string;
  tasks_total: number;
  tasks_approved: number;
  tasks_pending: number;
  current_task: string | null;
  current_status: string | null;
  due_at: string | null;
  overdue: boolean;
  onboarding_email_status: string | null;
}

export interface ProgressSummary {
  organization_id: string;
  interns_total: number;
  active: number;
  completed: number;
  overdue: number;
  tasks_approved: number;
  tasks_pending: number;
  interns: ProgressRow[];
}

export interface InternFlowOverview {
  summary: ProgressSummary;
  recent_evaluations: Evaluation[];
  upcoming_meetings: Meeting[];
  templates: number;
}

export interface EvaluationList {
  items: Evaluation[];
  total: number;
  limit: number;
  offset: number;
}

export interface InternSelf {
  intern: Intern;
  current_assignment: Assignment | null;
  assignments: Assignment[];
  submissions: Submission[];
  evaluations: Evaluation[];
  meetings: Meeting[];
  next_meeting: Meeting | null;
}

export interface SubmissionResult {
  submission: Submission;
  evaluation: Evaluation;
  assignment: Assignment;
  message: string;
}

export interface InternChatReply {
  chat_id: string;
  reply: string;
  intent: string;
}

export interface InternFlowAuditEntry {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface SpreadsheetAnalysis {
  file_id: string;
  filename: string;
  status: string;
  metadata: Record<string, unknown>;
  text: string;
}

export interface MediaCapabilities {
  vision: { configured: boolean; model: string; mode: string; note: string };
  transcription: { configured: boolean; model: string; mode: string; note: string };
  image_generation: { configured: boolean; model: string | null; mode: string; note: string };
  video: { configured: boolean; ffmpeg: string | null; mode: string; note: string };
  ffmpeg_available: boolean;
}

export interface MetaResponse {
  app: { name: string; environment: string; version: string };
  version: string;
  demo_mode: boolean;
  capabilities: Record<string, unknown>;
  demo_login: boolean;
  docs: string;
}
