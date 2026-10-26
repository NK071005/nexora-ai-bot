import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowUp,
  Bot,
  Check,
  Copy,
  FileText,
  Globe2,
  Library,
  Menu as MenuIcon,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Search,
  Square,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { useAuth } from "@/app/AuthContext";
import { useToast } from "@/app/ToastContext";
import { useApiQuery, useDebounce, useDocumentTitle } from "@/hooks/useApi";
import {
  ApiError,
  chatsApi,
  downloadFile,
  filesApi,
  streamChat,
} from "@/services/api";
import type { Chat, ChatMessage, Citation, FileRecord, ToolActivity } from "@/types/api";
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  Notice,
  Skeleton,
  StatusBadge,
} from "@/components/ui/primitives";
import { ConfirmDialog, Drawer, Menu, MenuItem, MenuSeparator } from "@/components/ui/overlays";
import { Markdown } from "@/components/common/Markdown";
import { formatBytes, formatDateTime, relativeTime, truncate } from "@/lib/format";
import { FILE_ACCEPT, MAX_UPLOAD_MB } from "@/lib/constants";
import { cn } from "@/lib/cn";

const suggestions = [
  "Summarise the key risks in the attached document and list open questions.",
  "Compare the two approaches in my library and recommend one with reasons.",
  "Draft a concise weekly update from today's work, using only the facts I provide.",
  "Explain what evidence would change my conclusion in this thread.",
];

interface ChatListPanelProps {
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onCreateFromQuery?: () => void;
  compact?: boolean;
}

function ChatListPanel({ activeId, onSelect, onNew, compact }: ChatListPanelProps) {
  const [query, setQuery] = useState("");
  const debounced = useDebounce(query, 300);
  const [archived, setArchived] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Chat | null>(null);
  const [deleting, setDeleting] = useState(false);
  const toast = useToast();
  const { me } = useAuth();
  const { data, loading, error, reload } = useApiQuery(
    () => chatsApi.list({ q: debounced.trim() || undefined, archived, limit: 60 }),
    [debounced, archived, me?.active_organization_id],
  );

  async function remove() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await chatsApi.remove(pendingDelete.id);
      toast.success("Conversation deleted", "Its messages were soft-deleted for your account.");
      setPendingDelete(null);
      await reload(true);
    } catch (caught) {
      toast.error("Could not delete", caught instanceof ApiError ? caught.message : "Retry in a moment.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-1 rounded-lg bg-mist-100 p-0.5 dark:bg-white/[0.06]">
          <button
            type="button"
            onClick={() => setArchived(false)}
            className={cn("rounded-md px-2 py-1 text-[10px] font-semibold transition", !archived ? "bg-white text-graphite-900 shadow-sm dark:bg-white/10 dark:text-white" : "text-mist-500")}
          >
            Active
          </button>
          <button
            type="button"
            onClick={() => setArchived(true)}
            className={cn("rounded-md px-2 py-1 text-[10px] font-semibold transition", archived ? "bg-white text-graphite-900 shadow-sm dark:bg-white/10 dark:text-white" : "text-mist-500")}
          >
            Archived
          </button>
        </div>
        <Button size="sm" icon={Plus} onClick={onNew}>
          New
        </Button>
      </div>

      <div className="relative mt-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-mist-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search conversations…"
          className="h-9 w-full rounded-lg border border-mist-200 bg-white pl-8 pr-8 text-xs outline-none transition focus:border-electric-500 focus:ring-2 focus:ring-electric-500/20 dark:border-white/10 dark:bg-white/[0.04] dark:text-mist-100"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-mist-400 hover:text-graphite-700 dark:hover:text-white"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      <div className="no-scrollbar mt-3 flex-1 space-y-0.5 overflow-y-auto pb-3">
        {loading && !data ? (
          <div className="space-y-2 px-1">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : error ? (
          <div className="px-2 py-4 text-xs text-rose-500">
            {error}
            <button type="button" className="ml-2 underline" onClick={() => void reload()}>
              retry
            </button>
          </div>
        ) : data && data.items.length ? (
          data.items.map((chat) => (
            <div key={chat.id} className="group relative">
              <button
                type="button"
                onClick={() => onSelect(chat.id)}
                className={cn(
                  "flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition",
                  activeId === chat.id
                    ? "bg-electric-500/[0.1] shadow-[inset_0_0_0_1px_rgba(47,123,255,.18)]"
                    : "hover:bg-mist-50 dark:hover:bg-white/[0.04]",
                )}
              >
                <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md", activeId === chat.id ? "bg-electric-500/15 text-electric-600 dark:text-electric-300" : "bg-mist-100 text-mist-500 dark:bg-white/[0.06]")}>
                  <MessageSquare className="h-3 w-3" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1">
                    {chat.is_pinned ? <Pin className="h-2.5 w-2.5 shrink-0 text-electric-500" /> : null}
                    <span className="truncate text-[12px] font-semibold text-graphite-800 dark:text-mist-200">{chat.title}</span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-1 text-[10px] text-mist-400">
                    <span>{chat.message_count} messages</span>
                    <span>·</span>
                    <span>{relativeTime(chat.last_message_at)}</span>
                  </span>
                </span>
              </button>
              <div className="absolute right-1 top-1.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                <Menu
                  align="right"
                  trigger={
                    <button type="button" aria-label="Conversation actions" className="rounded-md p-1 text-mist-400 hover:bg-white hover:text-graphite-700 dark:hover:bg-white/10 dark:hover:text-white">
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  }
                >
                  <MenuItem icon={chat.is_pinned ? PinOff : Pin} onClick={async () => { await chatsApi.update(chat.id, { is_pinned: !chat.is_pinned }); await reload(true); }}>
                    {chat.is_pinned ? "Unpin" : "Pin to top"}
                  </MenuItem>
                  <MenuItem icon={Library} onClick={async () => { await chatsApi.update(chat.id, { is_archived: !chat.is_archived }); await reload(true); }}>
                    {chat.is_archived ? "Restore" : "Archive"}
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem icon={Trash2} danger onClick={() => setPendingDelete(chat)}>
                    Delete conversation
                  </MenuItem>
                </Menu>
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-xl border border-dashed border-mist-200 px-3 py-8 text-center dark:border-white/10">
            <MessageSquare className="mx-auto h-5 w-5 text-mist-400" />
            <p className="mt-2 text-xs font-medium text-mist-600 dark:text-mist-300">
              {debounced ? "No matching conversation" : archived ? "No archived conversations" : "No conversations yet"}
            </p>
            <p className="mt-1 text-[10px] leading-4 text-mist-400">
              {debounced ? "Try a different phrase." : "Start a thread and it is stored in your account."}
            </p>
          </div>
        )}
      </div>

      {data && data.total > data.items.length ? (
        <p className="border-t border-mist-100 px-2 py-2 text-[10px] text-mist-400 dark:border-white/[0.06]">
          Showing {data.items.length} of {data.total}. Use search to narrow the list.
        </p>
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void remove()}
        title="Delete this conversation?"
        description={`“${pendingDelete?.title ?? ""}” and its messages will be soft-deleted for your account. This cannot be undone from the interface.`}
        confirmLabel="Delete"
        tone="danger"
        loading={deleting}
      />
    </div>
  );
}

function CitationList({ citations }: { citations: Citation[] }) {
  if (!citations.length) return null;
  return (
    <div className="mt-3 border-t border-mist-200/70 pt-3 dark:border-white/[0.07]">
      <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-mist-400">
        <Globe2 className="h-3 w-3" /> Sources ({citations.length})
      </p>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {citations.map((citation) => (
          <a
            key={`${citation.index}-${citation.url}`}
            href={citation.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-start gap-2 rounded-lg border border-mist-200/80 bg-white/60 p-2 text-left transition hover:border-electric-400/50 dark:border-white/[0.07] dark:bg-white/[0.02]"
          >
            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded bg-electric-500/10 text-[9px] font-bold text-electric-600 dark:text-electric-300">
              {citation.index}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] font-semibold text-graphite-800 dark:text-mist-200">{citation.title || citation.domain}</span>
              <span className="block truncate text-[9px] text-mist-400">{citation.domain}</span>
              {citation.snippet ? <span className="mt-0.5 line-clamp-2 block text-[9px] leading-4 text-mist-500">{citation.snippet}</span> : null}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

function ToolActivityRow({ activities }: { activities: ToolActivity[] }) {
  if (!activities.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {activities.map((activity, index) => (
        <span
          key={`${activity.tool}-${index}`}
          title={activity.summary}
          className="inline-flex items-center gap-1 rounded-md border border-mist-200 bg-mist-50 px-1.5 py-0.5 text-[9px] text-mist-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-mist-400"
        >
          <Wrench className="h-2.5 w-2.5" />
          {activity.tool.replace(/_/g, " ")} · {activity.status}
        </span>
      ))}
    </div>
  );
}

function MessageBubble({
  message,
  isStreaming,
  onRegenerate,
  onCopy,
}: {
  message: ChatMessage;
  isStreaming?: boolean;
  onRegenerate?: () => void;
  onCopy: (text: string) => void;
}) {
  const isUser = message.role === "user";
  return (
    <div className={cn("group flex gap-3", isUser && "flex-row-reverse")}>
      {isUser ? (
        <Avatar name="You" size="sm" className="mt-0.5" />
      ) : (
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-electric-500 to-electric-700 text-white shadow-glow">
          <Bot className="h-4 w-4" />
        </span>
      )}
      <div className={cn("min-w-0 max-w-[min(760px,88%)]", isUser && "flex flex-col items-end")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-3",
            isUser
              ? "bg-navy-900 text-mist-100 dark:bg-white/[0.09]"
              : "border border-mist-200/80 bg-white shadow-panel dark:border-white/[0.07] dark:bg-navy-900",
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>
          ) : (
            <>
              {message.content ? (
                <Markdown content={message.content} className={cn(isStreaming && "stream-caret")} />
              ) : isStreaming ? (
                <div className="flex items-center gap-2 text-xs text-mist-400">
                  <span className="flex gap-0.5">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-electric-500 [animation-delay:-0.2s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-electric-500 [animation-delay:-0.1s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-electric-500" />
                  </span>
                  Preparing a grounded answer…
                </div>
              ) : (
                <p className="text-xs italic text-mist-400">No content was returned.</p>
              )}
              {message.error ? (
                <div className="mt-2 flex items-start gap-2 rounded-lg border border-rose-500/20 bg-rose-500/[0.06] p-2 text-[11px] text-rose-700 dark:text-rose-300">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{message.error}</span>
                </div>
              ) : null}
              <ToolActivityRow activities={message.tool_activity} />
              <CitationList citations={message.citations} />
            </>
          )}

          {message.attachments.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {message.attachments.map((file) => (
                <button
                  key={file.id}
                  type="button"
                  onClick={() => void downloadFile(`/files/${file.id}/download`, file.original_name)}
                  className="inline-flex items-center gap-1 rounded-md border border-mist-200 bg-mist-50 px-1.5 py-1 text-[9px] font-medium text-mist-600 hover:border-electric-400 dark:border-white/10 dark:bg-white/[0.05] dark:text-mist-300"
                >
                  <FileText className="h-2.5 w-2.5" /> {truncate(file.original_name, 28)}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className={cn("mt-1 flex flex-wrap items-center gap-2 text-[9px] text-mist-400", isUser && "justify-end")}>
          <span>{formatDateTime(message.created_at)}</span>
          {message.provider ? <Badge tone={message.provider === "demo" ? "amber" : "blue"}>{message.provider}</Badge> : null}
          {!isUser && message.status !== "streaming" ? (
            <>
              <button type="button" onClick={() => onCopy(message.content)} className="inline-flex items-center gap-0.5 hover:text-graphite-700 dark:hover:text-white">
                <Copy className="h-2.5 w-2.5" /> copy
              </button>
              {onRegenerate ? (
                <button type="button" onClick={onRegenerate} className="inline-flex items-center gap-0.5 hover:text-graphite-700 dark:hover:text-white">
                  <RefreshCw className="h-2.5 w-2.5" /> regenerate
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ChatPage() {
  const { chatId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { me, isIntern } = useAuth();
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const [chat, setChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [content, setContent] = useState("");
  const [attachments, setAttachments] = useState<FileRecord[]>([]);
  const [uploading, setUploading] = useState(false);
  const [useSearch, setUseSearch] = useState(false);
  const [useLibrary, setUseLibrary] = useState(true);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const createdRef = useRef(false);
  const streamAccumulator = useRef("");

  useDocumentTitle(chat?.title ?? "Conversations");

  const detail = useApiQuery(
    () => (chatId ? chatsApi.get(chatId) : Promise.resolve(null)),
    [chatId, me?.active_organization_id],
  );

  useEffect(() => {
    if (detail.data) {
      setChat(detail.data.chat);
      setMessages(detail.data.messages);
      setStreamingId(null);
      setSending(false);
      setNotice(null);
    } else if (!chatId) {
      setChat(null);
      setMessages([]);
    }
  }, [detail.data, chatId]);

  useEffect(() => {
    if (detail.error) setCreateError(detail.error);
  }, [detail.error]);

  const searchReady = me?.capabilities.search.configured ?? false;
  const aiDemo = me?.capabilities.ai.demo ?? true;

  const createChat = useCallback(async () => {
    try {
      const created = await chatsApi.create({ title: "New conversation" });
      setChat(created);
      setMessages([]);
      setSearchParams({}, { replace: true });
      navigate(`/chat/${created.id}`, { replace: true });
      return created;
    } catch (caught) {
      toast.error("Could not start a conversation", caught instanceof ApiError ? caught.message : "Retry in a moment.");
      return null;
    }
  }, [navigate, setSearchParams, toast]);

  useEffect(() => {
    if (searchParams.get("new") === "1" && !chatId && !createdRef.current) {
      createdRef.current = true;
      void createChat();
    }
  }, [searchParams, chatId, createChat]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, streamingId]);

  useEffect(() => {
    setContent("");
    setAttachments([]);
    setNotice(null);
    abortRef.current?.abort();
    abortRef.current = null;
  }, [chatId]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const uploaded: FileRecord[] = [];
      for (const file of Array.from(files).slice(0, 8 - attachments.length)) {
        if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
          toast.error("File too large", `${file.name} exceeds ${MAX_UPLOAD_MB} MB.`);
          continue;
        }
        uploaded.push(await filesApi.upload(file));
      }
      setAttachments((current) => [...current, ...uploaded].slice(0, 8));
      if (uploaded.length) toast.success(`${uploaded.length} attachment${uploaded.length === 1 ? "" : "s"} uploaded`, "Text extraction runs on the server.");
    } catch (caught) {
      toast.error("Upload failed", caught instanceof ApiError ? caught.message : "Retry with a smaller file.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function resetStreamingState() {
    setSending(false);
    setStreamingId(null);
    abortRef.current = null;
  }

  function streamAnswer(path: string, body: unknown, assistantId: string) {
    const controller = new AbortController();
    abortRef.current = controller;
    streamAccumulator.current = "";
    void streamChat(
      path,
      body,
      {
        onMeta: (meta) => {
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantId
                ? {
                    ...message,
                    citations: meta.citations,
                    tool_activity: meta.tools,
                    provider: meta.provider,
                  }
                : message,
            ),
          );
        },
        onToken: (text) => {
          streamAccumulator.current += text;
          const accumulated = streamAccumulator.current;
          setMessages((current) =>
            current.map((message) => (message.id === assistantId ? { ...message, content: accumulated } : message)),
          );
        },
        onDone: (payload) => {
          setMessages((current) => current.map((message) => (message.id === assistantId ? payload.message : message)));
          resetStreamingState();
          if (payload.stopped) toast.info("Generation stopped", "The partial answer was saved.");
          void chatsApi
            .get(chatId ?? payload.message.chat_id)
            .then((value) => setChat(value.chat))
            .catch(() => undefined);
        },
        onError: (message) => {
          setMessages((current) =>
            current.map((item) =>
              item.id === assistantId ? { ...item, status: "failed", error: message } : item,
            ),
          );
          resetStreamingState();
          toast.error("Generation failed", message);
        },
      },
      controller.signal,
    ).catch((caught) => {
      if ((caught as Error).name === "AbortError") return;
      const message = caught instanceof ApiError ? caught.message : "The stream ended unexpectedly.";
      setMessages((current) =>
        current.map((item) => (item.id === assistantId ? { ...item, status: "failed", error: message } : item)),
      );
      resetStreamingState();
      toast.error("Generation failed", message);
    });
  }

  async function send() {
    const text = content.trim();
    if (!text && attachments.length === 0) return;
    if (sending) return;

    let active = chat;
    if (!active) {
      active = await createChat();
      if (!active) return;
    }

    if (useSearch && !searchReady) {
      setNotice("Web search is not configured on this server. Add SEARCH_PROVIDER_API_KEY or turn the toggle off.");
      return;
    }

    const attachmentIds = attachments.map((file) => file.id);
    const now = new Date().toISOString();
    const tempUser: ChatMessage = {
      id: `temp-user-${Date.now()}`,
      chat_id: active.id,
      role: "user",
      content: text,
      status: "complete",
      provider: null,
      model: null,
      citations: [],
      tool_activity: [],
      error: null,
      created_at: now,
      attachments,
    };
    const assistantId = `temp-assistant-${Date.now()}`;
    const tempAssistant: ChatMessage = {
      id: assistantId,
      chat_id: active.id,
      role: "assistant",
      content: "",
      status: "streaming",
      provider: null,
      model: null,
      citations: [],
      tool_activity: [],
      error: null,
      created_at: now,
      attachments: [],
    };
    setMessages((current) => [...current, tempUser, tempAssistant]);
    setStreamingId(assistantId);
    setSending(true);
    setNotice(null);
    setContent("");
    setAttachments([]);

    try {
      streamAnswer(
        `/chats/${active.id}/messages`,
        {
          content: text,
          attachment_ids: attachmentIds,
          use_search: useSearch,
          use_library: useLibrary,
        },
        assistantId,
      );
    } catch (caught) {
      setMessages((current) => current.filter((item) => item.id !== assistantId && item.id !== tempUser.id));
      setContent(text);
      setAttachments(tempUser.attachments);
      setSending(false);
      setStreamingId(null);
      if (caught instanceof ApiError && caught.code === "search_not_configured") {
        setNotice(caught.message);
      } else {
        toast.error("Message not sent", caught instanceof ApiError ? caught.message : "Retry in a moment.");
      }
    }
  }

  async function stop() {
    if (!chatId) return;
    setStopping(true);
    try {
      const result = await chatsApi.stop(chatId);
      if (!result.stopped) toast.info("Nothing to stop", "The answer already finished.");
      else toast.info("Stop requested", "Saving the partial answer…");
    } catch (caught) {
      toast.error("Could not stop", caught instanceof ApiError ? caught.message : "The stream may have ended.");
    } finally {
      setStopping(false);
    }
  }

  async function regenerate() {
    if (!chatId || sending) return;
    const lastUserIndex = [...messages].map((m) => m.role).lastIndexOf("user");
    if (lastUserIndex < 0) {
      toast.info("Nothing to regenerate", "Send a message first.");
      return;
    }
    const assistantId = `temp-assistant-${Date.now()}`;
    const trimmed = messages.filter((message, index) => !(index > lastUserIndex && message.role === "assistant"));
    const placeholder: ChatMessage = {
      id: assistantId,
      chat_id: chatId,
      role: "assistant",
      content: "",
      status: "streaming",
      provider: null,
      model: null,
      citations: [],
      tool_activity: [],
      error: null,
      created_at: new Date().toISOString(),
      attachments: [],
    };
    setMessages([...trimmed, placeholder]);
    setStreamingId(assistantId);
    setSending(true);
    streamAnswer(
      `/chats/${chatId}/regenerate`,
      { use_search: useSearch, use_library: useLibrary },
      assistantId,
    );
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied", "The answer is on your clipboard.");
    } catch {
      toast.error("Clipboard blocked", "Select the text manually.");
    }
  }

  async function rename() {
    if (!chatId || !renameValue.trim()) return;
    try {
      const updated = await chatsApi.update(chatId, { title: renameValue.trim() });
      setChat(updated);
      setRenameOpen(false);
      toast.success("Conversation renamed");
    } catch (caught) {
      toast.error("Could not rename", caught instanceof ApiError ? caught.message : "Retry.");
    }
  }

  async function removeChat() {
    if (!chatId) return;
    setDeleting(true);
    try {
      await chatsApi.remove(chatId);
      toast.success("Conversation deleted");
      navigate("/chat");
    } catch (caught) {
      toast.error("Could not delete", caught instanceof ApiError ? caught.message : "Retry.");
    } finally {
      setDeleting(false);
    }
  }

  const statusNotice = useMemo(() => {
    if (notice) return notice;
    if (useSearch && !searchReady)
      return "Web search is not configured. The toggle will produce an explicit configuration error.";
    return null;
  }, [notice, searchReady, useSearch]);

  const list = (
    <ChatListPanel
      activeId={chatId ?? null}
      onSelect={(id) => {
        setMobileListOpen(false);
        navigate(`/chat/${id}`);
      }}
      onNew={() => {
        setMobileListOpen(false);
        void createChat();
      }}
    />
  );

  return (
    <div className="flex h-[calc(100vh-9.5rem)] min-h-[560px] gap-5">
      <aside className="hidden w-[286px] shrink-0 flex-col rounded-2xl border border-mist-200/80 bg-white p-3 shadow-panel dark:border-white/[0.07] dark:bg-navy-900 lg:flex">
        {list}
      </aside>

      <Drawer open={mobileListOpen} onClose={() => setMobileListOpen(false)} label="Conversations" className="p-3">
        {list}
      </Drawer>

      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-mist-200/80 bg-white shadow-panel dark:border-white/[0.07] dark:bg-navy-900">
        <header className="flex shrink-0 items-center gap-2 border-b border-mist-200/80 px-3 py-2.5 dark:border-white/[0.07] sm:px-4">
          <IconButton label="Open conversations" className="lg:hidden" onClick={() => setMobileListOpen(true)}>
            <MenuIcon className="h-4 w-4" />
          </IconButton>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate font-display text-sm font-semibold text-graphite-950 dark:text-white">
                {chat?.title ?? "New conversation"}
              </h1>
              {chat?.is_pinned ? <Badge tone="blue">Pinned</Badge> : null}
              {aiDemo ? <Badge tone="amber">Demo AI</Badge> : null}
            </div>
            <p className="mt-0.5 truncate text-[10px] text-mist-400">
              {chat
                ? `${chat.message_count} messages · updated ${relativeTime(chat.updated_at)}${chat.tags.length ? ` · ${chat.tags.join(", ")}` : ""}`
                : "Ask a question, attach evidence, or research the live web."}
            </p>
          </div>
          {chat ? (
            <div className="flex items-center gap-0.5">
              <IconButton
                label="Rename conversation"
                onClick={() => {
                  setRenameValue(chat.title);
                  setRenameOpen(true);
                }}
              >
                <Pencil className="h-4 w-4" />
              </IconButton>
              <Menu
                align="right"
                trigger={
                  <button type="button" aria-label="Conversation options" className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-mist-600 hover:bg-mist-100 dark:text-mist-300 dark:hover:bg-white/[0.06]">
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                }
              >
                <MenuItem
                  icon={chat.is_pinned ? PinOff : Pin}
                  onClick={async () => {
                    const updated = await chatsApi.update(chat.id, { is_pinned: !chat.is_pinned });
                    setChat(updated);
                  }}
                >
                  {chat.is_pinned ? "Unpin" : "Pin"}
                </MenuItem>
                <MenuItem
                  icon={Library}
                  onClick={async () => {
                    const updated = await chatsApi.update(chat.id, { is_archived: !chat.is_archived });
                    setChat(updated);
                    toast.success(updated.is_archived ? "Conversation archived" : "Conversation restored");
                  }}
                >
                  {chat.is_archived ? "Restore" : "Archive"}
                </MenuItem>
                <MenuSeparator />
                <MenuItem icon={Trash2} danger onClick={() => setDeleteOpen(true)}>
                  Delete
                </MenuItem>
              </Menu>
            </div>
          ) : null}
        </header>

        {chat?.is_archived ? (
          <div className="border-b border-amber-500/20 bg-amber-500/[0.06] px-4 py-2 text-[11px] text-amber-800 dark:text-amber-200">
            This conversation is archived. It stays readable and can be restored from the options menu.
          </div>
        ) : null}

        {statusNotice ? (
          <div className="flex items-start gap-2 border-b border-amber-500/20 bg-amber-500/[0.06] px-4 py-2.5 text-[11px] text-amber-800 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">{statusNotice}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notice" className="opacity-70 hover:opacity-100">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto px-3 py-5 sm:px-6">
          {createError ? (
            <div className="mb-4">
              <ErrorState message={createError} onRetry={() => { setCreateError(null); void detail.reload(); }} />
            </div>
          ) : null}

          {!chatId && !messages.length ? (
            <div className="mx-auto flex h-full max-w-2xl flex-col justify-center py-8">
              <div className="text-center">
                <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-electric-500 to-electric-700 text-white shadow-glow">
                  <Sparkles className="h-6 w-6" />
                </span>
                <h2 className="heading-display mt-4 text-xl text-graphite-950 dark:text-white">
                  What should we work through?
                </h2>
                <p className="mx-auto mt-1.5 max-w-lg text-sm leading-6 text-mist-500 dark:text-mist-400">
                  Attach a document, enable library grounding, or turn on live web research when it is configured.
                  Nothing is fabricated when a source is missing.
                </p>
              </div>
              <div className="mt-6 grid gap-2 sm:grid-cols-2">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => {
                      setContent(suggestion);
                      textareaRef.current?.focus();
                    }}
                    className="rounded-xl border border-mist-200/80 bg-white p-3 text-left text-xs leading-5 text-mist-600 transition hover:border-electric-400/50 hover:shadow-panel dark:border-white/[0.07] dark:bg-white/[0.03] dark:text-mist-300"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
              {isIntern ? (
                <Notice tone="info" title="InternFlow help" className="mt-5">
                  <p>
                    Use the <Link to="/internflow/me" className="underline">My work</Link> assistant for questions about
                    your assignments, deadlines and feedback. It answers only from your records.
                  </p>
                </Notice>
              ) : null}
            </div>
          ) : detail.loading && !messages.length ? (
            <div className="space-y-5">
              <Skeleton className="h-20 w-2/3" />
              <Skeleton className="ml-auto h-16 w-1/2" />
              <Skeleton className="h-28 w-3/4" />
            </div>
          ) : messages.length ? (
            <div className="mx-auto max-w-3xl space-y-5">
              {messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  isStreaming={message.id === streamingId}
                  onCopy={(text) => void copy(text)}
                  onRegenerate={message.role === "assistant" && message.id === streamingId ? undefined : () => void regenerate()}
                />
              ))}
              <div ref={bottomRef} />
            </div>
          ) : (
            <EmptyState
              icon={Bot}
              title="This thread is empty"
              description="Write the first message below. History, attachments and citations persist with the conversation."
              className="mx-auto max-w-xl"
            />
          )}
        </div>

        <div className="shrink-0 border-t border-mist-200/80 bg-white/90 p-3 backdrop-blur dark:border-white/[0.07] dark:bg-navy-900/95 sm:p-4">
          {attachments.length ? (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attachments.map((file) => (
                <span key={file.id} className="inline-flex items-center gap-1.5 rounded-lg border border-mist-200 bg-mist-50 px-2 py-1 text-[10px] text-mist-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-mist-300">
                  <FileText className="h-3 w-3" />
                  <span className="max-w-[160px] truncate">{file.original_name}</span>
                  <span className="text-mist-400">{formatBytes(file.size_bytes)}</span>
                  <button type="button" aria-label={`Remove ${file.original_name}`} onClick={() => setAttachments((current) => current.filter((item) => item.id !== file.id))}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <div className="rounded-2xl border border-mist-200 bg-white shadow-sm transition focus-within:border-electric-500 focus-within:ring-2 focus-within:ring-electric-500/15 dark:border-white/10 dark:bg-white/[0.03]">
            <textarea
              ref={textareaRef}
              rows={2}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (!sending) void send();
                }
              }}
              placeholder="Ask anything, or describe the work you need…"
              className="max-h-48 min-h-[52px] w-full resize-none bg-transparent px-3.5 pt-3 text-sm leading-6 text-graphite-900 outline-none placeholder:text-mist-400 dark:text-mist-100"
              disabled={sending}
            />
            <div className="flex flex-wrap items-center gap-1.5 px-2.5 pb-2.5">
              <input
                ref={fileInputRef}
                type="file"
                accept={FILE_ACCEPT}
                multiple
                className="hidden"
                onChange={(event) => void upload(event.target.files)}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || sending}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium text-mist-500 transition hover:bg-mist-100 hover:text-graphite-800 disabled:opacity-40 dark:hover:bg-white/[0.06] dark:hover:text-white"
              >
                <Paperclip className="h-3.5 w-3.5" />
                {uploading ? "Uploading…" : "Attach"}
              </button>
              <button
                type="button"
                onClick={() => setUseLibrary((value) => !value)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium transition",
                  useLibrary
                    ? "bg-electric-500/10 text-electric-700 dark:text-electric-200"
                    : "text-mist-500 hover:bg-mist-100 dark:hover:bg-white/[0.06]",
                )}
                title="Ground the answer in your library (lexical retrieval)"
              >
                <Library className="h-3.5 w-3.5" /> Library {useLibrary ? "on" : "off"}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!searchReady) {
                    setNotice("Web search is not configured. Add SEARCH_PROVIDER_API_KEY to enable live citations.");
                    return;
                  }
                  setUseSearch((value) => !value);
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium transition",
                  useSearch
                    ? "bg-cyan-500/10 text-cyan-700 dark:text-cyan-200"
                    : searchReady
                      ? "text-mist-500 hover:bg-mist-100 dark:hover:bg-white/[0.06]"
                      : "text-mist-400",
                )}
                title={searchReady ? "Search the live web and cite real URLs" : "Web search is not configured"}
              >
                <Globe2 className="h-3.5 w-3.5" /> Web {useSearch ? "on" : searchReady ? "off" : "not configured"}
              </button>
              <span className="ml-auto hidden items-center gap-1 text-[9px] text-mist-400 sm:flex">
                {attachments.length ? `${attachments.length}/8 files` : `Shift+Enter for a new line`}
              </span>
              {sending ? (
                <Button size="sm" variant="secondary" icon={Square} loading={stopping} onClick={() => void stop()}>
                  Stop
                </Button>
              ) : (
                <Button size="sm" icon={ArrowUp} onClick={() => void send()} disabled={!content.trim() && !attachments.length}>
                  Send
                </Button>
              )}
            </div>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1 px-1 text-[9px] text-mist-400">
            <span>
              {aiDemo ? "Demo answers are extractive and labeled. " : "Live provider responses. "}
              {useLibrary ? "Library retrieval is lexical, not semantic. " : ""}
              {useSearch ? "Citations come from the configured search provider." : ""}
            </span>
            {chat?.message_count ? <span>{chat.message_count} stored messages</span> : null}
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => void removeChat()}
        title="Delete this conversation?"
        description="Messages are soft-deleted for your account. This cannot be undone from the interface."
        confirmLabel="Delete"
        tone="danger"
        loading={deleting}
      />

      {renameOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-navy-950/60 backdrop-blur-sm" onClick={() => setRenameOpen(false)} aria-hidden />
          <div className="relative w-full max-w-md rounded-2xl border border-mist-200 bg-white p-5 shadow-float dark:border-white/10 dark:bg-navy-900">
            <h2 className="font-display text-base font-semibold text-graphite-950 dark:text-white">Rename conversation</h2>
            <input
              autoFocus
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void rename();
              }}
              className="mt-4 h-10 w-full rounded-xl border border-mist-200 bg-white px-3 text-sm outline-none focus:border-electric-500 focus:ring-2 focus:ring-electric-500/20 dark:border-white/10 dark:bg-white/[0.04] dark:text-mist-100"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRenameOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void rename()} disabled={!renameValue.trim()}>
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
