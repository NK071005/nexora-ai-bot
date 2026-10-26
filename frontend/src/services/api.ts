import type {
  AdminOrganization,
  AdminOverview,
  AdminUser,
  Assignment,
  AuditLog,
  Capabilities,
  Chat,
  ChatDetail,
  ChatListResponse,
  ChatMessage,
  ConfigStatus,
  Evaluation,
  EvaluationList,
  FileRecord,
  HistorySearchHit,
  ImportBatch,
  Integration,
  Intern,
  InternChatReply,
  InternDetail,
  InternFlowOverview,
  InternFlowAuditEntry,
  InternList,
  InternSelf,
  LibraryChunk,
  LibraryFolder,
  LibraryHit,
  LibraryItem,
  LibraryItemList,
  LibraryTag,
  MediaCapabilities,
  Meeting,
  MeResponse,
  MetaResponse,
  NotificationList,
  Organization,
  ProgressSummary,
  RecentSearch,
  ScheduleMeta,
  ScheduledRun,
  ScheduledTask,
  ScheduledTaskDetail,
  SearchStatus,
  SessionInfo,
  SpreadsheetAnalysis,
  SubmissionResult,
  TaskTemplate,
  WebSearchResponse,
} from "@/types/api";

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";
const ORG_KEY = "nexora-active-org";

let activeOrganizationId: string | null = localStorage.getItem(ORG_KEY);

export function setActiveOrganization(id: string | null) {
  activeOrganizationId = id;
  if (id) localStorage.setItem(ORG_KEY, id);
  else localStorage.removeItem(ORG_KEY);
}

export function getActiveOrganization(): string | null {
  return activeOrganizationId;
}

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  requestId?: string | null;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
    requestId?: string | null,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  get fieldErrors(): Record<string, string> {
    const output: Record<string, string> = {};
    if (Array.isArray(this.details)) {
      for (const item of this.details as { field?: string; message?: string }[]) {
        if (item?.field) output[item.field] = item.message ?? "Invalid value";
      }
    }
    return output;
  }
}

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)nexora_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

export function qs(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

async function parseError(response: Response): Promise<ApiError> {
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    /* non-JSON response */
  }
  const error = body?.error ?? {};
  return new ApiError(
    response.status,
    error.code ?? `http_${response.status}`,
    error.message ?? `Request failed with status ${response.status}.`,
    error.details,
    error.request_id,
  );
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  rawBody?: BodyInit;
  skipOrg?: boolean;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...options.headers,
  };
  const isForm = options.rawBody instanceof FormData;
  if (options.body !== undefined && !isForm && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const token = csrfToken();
    if (token) headers["X-CSRF-Token"] = token;
  }
  if (activeOrganizationId && !options.skipOrg) {
    headers["X-Organization-Id"] = activeOrganizationId;
  }

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      credentials: "include",
      body: isForm
        ? (options.rawBody as FormData)
        : options.body !== undefined
          ? JSON.stringify(options.body)
          : options.rawBody,
      signal: options.signal,
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError(0, "network_error", "Cannot reach the NEXORA server. Check your connection and retry.");
  }

  if (!response.ok) {
    const apiError = await parseError(response);
    if (response.status === 401 && !path.startsWith("/auth/")) {
      window.dispatchEvent(new CustomEvent("nexora:unauthorized"));
    }
    throw apiError;
  }

  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return (await response.text()) as unknown as T;
  }
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string, params?: Record<string, unknown>) =>
    request<T>(path + (params ? qs(params) : "")),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body }),
  delete: <T>(path: string, body?: unknown) => request<T>(path, { method: "DELETE", body }),
  upload: <T>(path: string, file: File, extra?: Record<string, string>) => {
    const form = new FormData();
    form.append("file", file);
    for (const [key, value] of Object.entries(extra ?? {})) form.append(key, value);
    return request<T>(path, { method: "POST", rawBody: form });
  },
  uploadMany: <T>(path: string, form: FormData) =>
    request<T>(path, { method: "POST", rawBody: form }),
};

/* ------------------------------------------------------------------ */
/* Auth helpers                                                        */
/* ------------------------------------------------------------------ */

export const authApi = {
  register: (payload: {
    email: string;
    password: string;
    full_name: string;
    organization_name?: string;
    timezone?: string;
  }) => api.post<MeResponse>("/auth/register", payload),
  login: (payload: { email: string; password: string }) =>
    api.post<MeResponse>("/auth/login", payload),
  logout: () => api.post<{ message: string }>("/auth/logout"),
  me: () => api.get<MeResponse>("/auth/me"),
  capabilities: () => api.get<Capabilities>("/auth/capabilities"),
  updateProfile: (payload: Record<string, unknown>) =>
    api.patch<MeResponse>("/auth/profile", payload),
  updateSettings: (payload: Record<string, unknown>) =>
    api.patch<MeResponse>("/auth/settings", payload),
  changePassword: (payload: { current_password: string; new_password: string }) =>
    api.post<{ message: string }>("/auth/change-password", payload),
  sessions: () => api.get<SessionInfo[]>("/auth/sessions"),
  revokeSession: (id: string) => api.delete<{ message: string }>(`/auth/sessions/${id}`),
  revokeOthers: () => api.post<{ message: string }>("/auth/sessions/revoke-others"),
  forgot: (email: string) =>
    api.post<{ message: string; demo_token: string | null }>("/auth/forgot-password", { email }),
  reset: (token: string, password: string) =>
    api.post<{ message: string }>("/auth/reset-password", { token, password }),
  activate: (token: string, password: string, full_name?: string) =>
    api.post<{ activated: boolean }>("/auth/activate", { token, password, full_name }),
  verifyEmail: (token: string) =>
    api.get<{ message: string }>(`/auth/verify-email${qs({ token })}`),
  resendVerification: (email: string) =>
    api.post<{ message: string; demo_token: string | null }>("/auth/resend-verification", { email }),
  deactivate: (password: string) =>
    api.post<{ message: string }>("/auth/deactivate", { password }),
};

/* ------------------------------------------------------------------ */
/* Domain helpers                                                      */
/* ------------------------------------------------------------------ */

export const chatsApi = {
  list: (params?: { q?: string; archived?: boolean; limit?: number; offset?: number }) =>
    api.get<ChatListResponse>("/chats", params),
  create: (payload?: { title?: string; model?: string }) => api.post<Chat>("/chats", payload ?? {}),
  get: (id: string) => api.get<ChatDetail>(`/chats/${id}`),
  update: (id: string, payload: Record<string, unknown>) => api.patch<Chat>(`/chats/${id}`, payload),
  remove: (id: string) => api.delete<{ ok: boolean; message: string }>(`/chats/${id}`),
  messages: (id: string) => api.get<ChatMessage[]>(`/chats/${id}/messages`),
  stop: (id: string) => api.post<{ stopped: boolean; message_id: string | null }>(`/chats/${id}/stop`),
};

export const filesApi = {
  list: (params?: { kind?: string; limit?: number; offset?: number }) =>
    api.get<FileRecord[]>("/files", params),
  get: (id: string) => api.get<FileRecord>(`/files/${id}`),
  upload: (file: File) => api.upload<FileRecord>("/files", file),
  analysis: (id: string) => api.get<SpreadsheetAnalysis>(`/files/${id}/analysis`),
  remove: (id: string) => api.delete<{ ok: boolean; message: string }>(`/files/${id}`),
  mediaCapabilities: () => api.get<MediaCapabilities>("/media/capabilities"),
  transcribe: (id: string) => api.post<{ text: string; language: string | null; provider: string }>(`/media/files/${id}/transcribe`),
  describe: (id: string, prompt: string) =>
    api.post<{ description: string; provider: string }>(`/media/files/${id}/describe`, { prompt }),
  generateImage: (prompt: string, size: string) =>
    api.post<{ file: FileRecord; prompt: string; provider: string }>("/media/images", { prompt, size }),
  extractFrame: (id: string, at = 1) =>
    api.post<{ ok: boolean; path: string; filename: string; note: string }>(
      `/media/files/${id}/video/frame${qs({ at })}`,
    ),
};

export const libraryApi = {
  folders: () => api.get<LibraryFolder[]>("/library/folders"),
  createFolder: (name: string, parent_id?: string | null) =>
    api.post<LibraryFolder>("/library/folders", { name, parent_id: parent_id ?? null }),
  updateFolder: (id: string, payload: Record<string, unknown>) =>
    api.patch<LibraryFolder>(`/library/folders/${id}`, payload),
  deleteFolder: (id: string) => api.delete<{ ok: boolean; message: string }>(`/library/folders/${id}`),
  items: (params?: {
    q?: string;
    kind?: string;
    folder_id?: string;
    favorite?: boolean;
    tag?: string;
    limit?: number;
    offset?: number;
  }) => api.get<LibraryItemList>("/library/items", params),
  item: (id: string) => api.get<LibraryItem>(`/library/items/${id}`),
  createItem: (payload: Record<string, unknown>) => api.post<LibraryItem>("/library/items", payload),
  updateItem: (id: string, payload: Record<string, unknown>) =>
    api.patch<LibraryItem>(`/library/items/${id}`, payload),
  deleteItem: (id: string) => api.delete<{ ok: boolean; message: string }>(`/library/items/${id}`),
  chunks: (id: string) => api.get<LibraryChunk[]>(`/library/items/${id}/chunks`),
  reindex: (id: string) =>
    api.post<{ chunks: number; status: string; message: string }>(`/library/items/${id}/reindex`),
  tags: () => api.get<LibraryTag[]>("/library/tags"),
  search: (q: string, limit = 20) => api.get<LibraryHit[]>("/library/search", { q, limit }),
};

export const searchApi = {
  status: () => api.get<SearchStatus>("/search/status"),
  web: (q: string, limit = 8) => api.get<WebSearchResponse>("/search/web", { q, limit }),
  chats: (q: string, limit = 20) => api.get<HistorySearchHit[]>("/search/chats", { q, limit }),
  library: (q: string, limit = 20) => api.get<LibraryHit[]>("/search/library", { q, limit }),
  recent: (limit = 10) => api.get<RecentSearch[]>("/search/recent", { limit }),
};

export const scheduledApi = {
  meta: () => api.get<ScheduleMeta>("/scheduled/meta"),
  list: () => api.get<ScheduledTask[]>("/scheduled"),
  get: (id: string) => api.get<ScheduledTaskDetail>(`/scheduled/${id}`),
  create: (payload: Record<string, unknown>) => api.post<ScheduledTask>("/scheduled", payload),
  update: (id: string, payload: Record<string, unknown>) =>
    api.patch<ScheduledTask>(`/scheduled/${id}`, payload),
  remove: (id: string) => api.delete<{ ok: boolean; message: string }>(`/scheduled/${id}`),
  runNow: (id: string) => api.post<ScheduledRun>(`/scheduled/${id}/run`),
  pause: (id: string) => api.post<ScheduledTask>(`/scheduled/${id}/pause`),
  resume: (id: string) => api.post<ScheduledTask>(`/scheduled/${id}/resume`),
  runs: (id: string) => api.get<ScheduledRun[]>(`/scheduled/${id}/runs`),
};

export const notificationsApi = {
  list: (params?: { unread_only?: boolean; limit?: number; offset?: number }) =>
    api.get<NotificationList>("/notifications", params),
  unread: () => api.get<{ unread: number }>("/notifications/unread-count"),
  markRead: (id: string) => api.post(`/notifications/${id}/read`),
  markAll: () => api.post<{ ok: boolean; updated: number }>("/notifications/read-all"),
  remove: (id: string) => api.delete<{ ok: boolean }>(`/notifications/${id}`),
};

export const settingsApi = {
  status: () => api.get<ConfigStatus>("/settings/status"),
  integrations: () => api.get<Integration[]>("/settings/integrations"),
  organization: () => api.get<Organization>("/settings/organization"),
  updateOrganization: (payload: { name?: string; settings?: Record<string, unknown> }) =>
    api.patch<Organization>("/settings/organization", payload),
  audit: (limit = 50, offset = 0) => api.get<AuditLog[]>("/settings/audit", { limit, offset }),
};

export const adminApi = {
  overview: () => api.get<AdminOverview>("/admin/overview"),
  organizations: () => api.get<AdminOrganization[]>("/admin/organizations"),
  users: (q?: string) => api.get<AdminUser[]>("/admin/users", { q }),
  toggleUser: (id: string) =>
    api.post<{ ok: boolean; is_active: boolean; message: string }>(`/admin/users/${id}/toggle-active`),
};

export const internflowApi = {
  overview: () => api.get<InternFlowOverview>("/internflow/overview"),
  interns: (params?: { q?: string; status?: string; department?: string; limit?: number; offset?: number }) =>
    api.get<InternList>("/internflow/interns", params),
  intern: (id: string) => api.get<InternDetail>(`/internflow/interns/${id}`),
  updateIntern: (id: string, payload: Record<string, unknown>) =>
    api.patch<Intern>(`/internflow/interns/${id}`, payload),
  assign: (id: string, payload: { template_id: string; due_days?: number; send_notification?: boolean }) =>
    api.post<Assignment>(`/internflow/interns/${id}/assign`, payload),
  resendInvite: (id: string) =>
    api.post<{ ok: boolean; email_status: string; email_mode: string; message: string }>(
      `/internflow/interns/${id}/resend-invite`,
    ),
  templates: (includeArchived = false) =>
    api.get<TaskTemplate[]>("/internflow/templates", { include_archived: includeArchived || undefined }),
  template: (id: string) => api.get<TaskTemplate>(`/internflow/templates/${id}`),
  createTemplate: (payload: Record<string, unknown>) =>
    api.post<TaskTemplate>("/internflow/templates", payload),
  updateTemplate: (id: string, payload: Record<string, unknown>) =>
    api.patch<TaskTemplate>(`/internflow/templates/${id}`, payload),
  archiveTemplate: (id: string) =>
    api.delete<{ ok: boolean; message: string }>(`/internflow/templates/${id}`),
  importPreview: (file: File) => api.upload<ImportBatch>("/internflow/imports", file),
  imports: (limit = 30) => api.get<ImportBatch[]>("/internflow/imports", { limit }),
  importBatch: (id: string) => api.get<ImportBatch>(`/internflow/imports/${id}`),
  confirmImport: (id: string) =>
    api.post<{ batch_id: string; status: string; created: number; skipped: number; email_mode: string; interns?: unknown[] }>(
      `/internflow/imports/${id}/confirm`,
    ),
  evaluations: (params?: { status?: string; intern_id?: string; limit?: number; offset?: number }) =>
    api.get<EvaluationList>("/internflow/evaluations", params),
  evaluation: (id: string) => api.get<Evaluation>(`/internflow/evaluations/${id}`),
  decide: (id: string, decision: "approve" | "request_corrections" | "escalate", note: string) =>
    api.post<Evaluation>(`/internflow/evaluations/${id}/decision`, { decision, note }),
  meetings: (params?: { status?: string; intern_id?: string }) =>
    api.get<Meeting[]>("/internflow/meetings", params),
  updateMeeting: (id: string, payload: { status: string; start_at?: string; notes?: string }) =>
    api.patch<Meeting>(`/internflow/meetings/${id}`, payload),
  emails: (status?: string) =>
    api.get<import("@/types/api").EmailLog[]>("/internflow/emails", { status }),
  progress: () => api.get<ProgressSummary>("/internflow/progress"),
  me: () => api.get<InternSelf>("/internflow/me"),
  assignment: (id: string) => api.get<import("@/types/api").Assignment>(`/internflow/assignments/${id}`),
  updateAssignment: (id: string, payload: Record<string, unknown>) =>
    api.patch<import("@/types/api").Assignment>(`/internflow/assignments/${id}`, payload),
  submit: (id: string, form: FormData) =>
    api.uploadMany<SubmissionResult>(`/internflow/assignments/${id}/submit`, form),
  chat: (message: string) => api.post<InternChatReply>("/internflow/chat", { message }),
  audit: (limit = 50) => api.get<InternFlowAuditEntry[]>("/internflow/audit", { limit }),
};

/* ------------------------------------------------------------------ */
/* Downloads                                                           */
/* ------------------------------------------------------------------ */

export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const response = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: activeOrganizationId ? { "X-Organization-Id": activeOrganizationId } : {},
  });
  if (!response.ok) throw await parseError(response);
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  const name = match ? decodeURIComponent(match[1]) : fallbackName;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/* SSE streaming                                                       */
/* ------------------------------------------------------------------ */

export interface StreamHandlers {
  onMeta?: (data: {
    message_id: string;
    chat_id: string;
    provider: string | null;
    citations: import("@/types/api").Citation[];
    tools: import("@/types/api").ToolActivity[];
  }) => void;
  onToken?: (text: string) => void;
  onDone?: (data: { message: ChatMessage; stopped: boolean }) => void;
  onError?: (message: string, messageId?: string) => void;
}

export async function streamChat(
  path: string,
  body: unknown,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const headers: Record<string, string> = {
    Accept: "text/event-stream",
    "Content-Type": "application/json",
  };
  const token = csrfToken();
  if (token) headers["X-CSRF-Token"] = token;
  if (activeOrganizationId) headers["X-Organization-Id"] = activeOrganizationId;

  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const error = await parseError(response);
    if (response.status === 401) window.dispatchEvent(new CustomEvent("nexora:unauthorized"));
    throw error;
  }
  if (!response.body) throw new ApiError(0, "stream_unavailable", "Streaming is not supported by this browser.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const dispatch = (event: string, raw: string) => {
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    if (event === "meta") handlers.onMeta?.(data);
    else if (event === "token") handlers.onToken?.(data.text ?? "");
    else if (event === "done") handlers.onDone?.(data);
    else if (event === "error") handlers.onError?.(data.message ?? "Generation failed.", data.message_id);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let split: number;
      while ((split = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        let event = "message";
        const dataLines: string[] = [];
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
        }
        if (dataLines.length) dispatch(event, dataLines.join("\n"));
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export { BASE as API_BASE };
