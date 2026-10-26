import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  BookOpen,
  Download,
  FileText,
  Folder,
  FolderPlus,
  Globe2,
  Image as ImageIcon,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Table2,
  Tag,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useAuth } from "@/app/AuthContext";
import { useToast } from "@/app/ToastContext";
import { useApiQuery, useDebounce, useDocumentTitle } from "@/hooks/useApi";
import {
  ApiError,
  downloadFile,
  filesApi,
  libraryApi,
} from "@/services/api";
import type { LibraryFolder, LibraryItem, LibraryKind } from "@/types/api";
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  Notice,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
  Textarea,
} from "@/components/ui/primitives";
import {
  ConfirmDialog,
  Drawer,
  Menu,
  MenuItem,
  MenuSeparator,
  Modal,
  Pagination,
} from "@/components/ui/overlays";
import { formatBytes, formatDateTime, relativeTime, truncate } from "@/lib/format";
import { FILE_ACCEPT, LIBRARY_KINDS } from "@/lib/constants";
import { cn } from "@/lib/cn";

const PAGE_SIZE = 24;

const kindIcons: Record<string, typeof BookOpen> = {
  note: BookOpen,
  document: FileText,
  web: Globe2,
  chat: MessageSquare,
  answer: Sparkles,
  spreadsheet: Table2,
  image: ImageIcon,
};

function kindIcon(kind: string) {
  return kindIcons[kind] ?? BookOpen;
}

interface ItemFormState {
  title: string;
  kind: string;
  description: string;
  content_text: string;
  folder_id: string;
  tags: string;
}

const emptyForm: ItemFormState = {
  title: "",
  kind: "note",
  description: "",
  content_text: "",
  folder_id: "",
  tags: "",
};

export function LibraryPage() {
  useDocumentTitle("Library");
  const { me } = useAuth();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [query, setQuery] = useState("");
  const debounced = useDebounce(query, 300);
  const [kind, setKind] = useState("");
  const [folderId, setFolderId] = useState("");
  const [tag, setTag] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<LibraryItem | null>(null);
  const [form, setForm] = useState<ItemFormState>(emptyForm);
  const [upload, setUpload] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const [folderOpen, setFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderParent, setFolderParent] = useState("");
  const [folderSaving, setFolderSaving] = useState(false);
  const [editingFolder, setEditingFolder] = useState<LibraryFolder | null>(null);
  const [folderToDelete, setFolderToDelete] = useState<LibraryFolder | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<LibraryItem | null>(null);
  const [reindexing, setReindexing] = useState(false);

  const folders = useApiQuery(() => libraryApi.folders(), [me?.active_organization_id]);
  const tags = useApiQuery(() => libraryApi.tags(), [me?.active_organization_id]);
  const items = useApiQuery(
    () =>
      libraryApi.items({
        q: debounced.trim() || undefined,
        kind: kind || undefined,
        folder_id: folderId || undefined,
        tag: tag || undefined,
        favorite: favoritesOnly ? true : undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      }),
    [debounced, kind, folderId, tag, favoritesOnly, page, me?.active_organization_id],
  );

  const selected = useMemo(
    () => items.data?.items.find((item) => item.id === selectedId) ?? null,
    [items.data, selectedId],
  );

  const chunks = useApiQuery(
    () => (selectedId ? libraryApi.chunks(selectedId) : Promise.resolve([])),
    [selectedId],
  );

  useEffect(() => {
    const itemParam = searchParams.get("item");
    if (itemParam) setSelectedId(itemParam);
    if (searchParams.get("new") === "1") {
      openCreate();
      const next = new URLSearchParams(searchParams);
      next.delete("new");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    setPage(1);
  }, [debounced, kind, folderId, tag, favoritesOnly]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setUpload(null);
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(item: LibraryItem) {
    setEditing(item);
    setForm({
      title: item.title,
      kind: item.kind,
      description: item.description,
      content_text: item.content_text ?? "",
      folder_id: item.folder_id ?? "",
      tags: item.tags.join(", "),
    });
    setUpload(null);
    setFormError(null);
    setFormOpen(true);
  }

  async function submitItem() {
    if (!form.title.trim()) {
      setFormError("A title is required.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const tagsList = form.tags
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      if (editing) {
        await libraryApi.updateItem(editing.id, {
          title: form.title.trim(),
          description: form.description,
          content_text: form.content_text,
          folder_id: form.folder_id || null,
          tags: tagsList,
        });
        toast.success("Library item updated", "Its retrieval index was refreshed.");
      } else {
        let fileId: string | null = null;
        let resolvedKind = form.kind;
        if (upload) {
          const record = await filesApi.upload(upload);
          fileId = record.id;
          if (form.kind === "note") {
            resolvedKind =
              record.kind === "spreadsheet"
                ? "spreadsheet"
                : record.kind === "image"
                  ? "image"
                  : "document";
          }
        }
        await libraryApi.createItem({
          title: form.title.trim(),
          kind: resolvedKind,
          description: form.description,
          content_text: form.content_text || undefined,
          folder_id: form.folder_id || null,
          file_id: fileId,
          tags: tagsList,
        });
        toast.success("Added to library", "Text was chunked for lexical retrieval.");
      }
      setFormOpen(false);
      setUpload(null);
      await Promise.all([items.reload(true), folders.reload(true), tags.reload(true)]);
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : "Could not save this item.");
    } finally {
      setSaving(false);
    }
  }

  async function saveFolder() {
    if (!folderName.trim()) return;
    setFolderSaving(true);
    try {
      if (editingFolder) {
        await libraryApi.updateFolder(editingFolder.id, { name: folderName.trim() });
        toast.success("Folder renamed");
      } else {
        await libraryApi.createFolder(folderName.trim(), folderParent || null);
        toast.success("Folder created");
      }
      setFolderOpen(false);
      setEditingFolder(null);
      setFolderName("");
      setFolderParent("");
      await folders.reload(true);
    } catch (caught) {
      toast.error("Could not save folder", caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setFolderSaving(false);
    }
  }

  async function removeFolder() {
    if (!folderToDelete) return;
    try {
      await libraryApi.deleteFolder(folderToDelete.id);
      toast.success("Folder deleted", "Items were moved to the library root.");
      if (folderId === folderToDelete.id) setFolderId("");
      setFolderToDelete(null);
      await Promise.all([folders.reload(true), items.reload(true)]);
    } catch (caught) {
      toast.error("Could not delete folder", caught instanceof ApiError ? caught.message : undefined);
    }
  }

  async function toggleFavorite(item: LibraryItem) {
    try {
      await libraryApi.updateItem(item.id, { is_favorite: !item.is_favorite });
      await items.reload(true);
    } catch (caught) {
      toast.error("Could not update favourite", caught instanceof ApiError ? caught.message : undefined);
    }
  }

  async function reindex() {
    if (!selected) return;
    setReindexing(true);
    try {
      const result = await libraryApi.reindex(selected.id);
      toast.success(result.status === "indexed" ? "Re-indexed" : "Nothing to index", result.message);
      await Promise.all([items.reload(true), chunks.reload(true)]);
    } catch (caught) {
      toast.error("Reindex failed", caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setReindexing(false);
    }
  }

  async function removeItem() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await libraryApi.deleteItem(pendingDelete.id);
      toast.success("Moved to trash", "The item is hidden from search and retrieval.");
      if (selectedId === pendingDelete.id) setSelectedId(null);
      setPendingDelete(null);
      await Promise.all([items.reload(true), folders.reload(true)]);
    } catch (caught) {
      toast.error("Could not delete item", caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setDeleting(false);
    }
  }

  const activeFolder = folders.data?.find((folder) => folder.id === folderId) ?? null;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Knowledge"
        title="Library"
        description="Your private notes, documents and captures. Retrieval is lexical (term frequency), not vector search — and every chunk is inspectable."
        actions={
          <>
            <Button
              variant="secondary"
              icon={FolderPlus}
              onClick={() => {
                setEditingFolder(null);
                setFolderName("");
                setFolderParent("");
                setFolderOpen(true);
              }}
            >
              New folder
            </Button>
            <Button icon={Plus} onClick={openCreate}>
              Add item
            </Button>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[232px_minmax(0,1fr)]">
        <aside className="space-y-3">
          <div className="app-surface p-3">
            <p className="mb-2 px-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-mist-400">Views</p>
            <button
              type="button"
              onClick={() => {
                setFolderId("");
                setFavoritesOnly(false);
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition",
                !folderId && !favoritesOnly
                  ? "bg-electric-500/10 text-electric-700 dark:text-electric-200"
                  : "text-mist-600 hover:bg-mist-50 dark:text-mist-300 dark:hover:bg-white/[0.04]",
              )}
            >
              <BookOpen className="h-3.5 w-3.5" /> All items
              <span className="ml-auto text-[10px] text-mist-400">{items.data?.total ?? ""}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setFolderId("");
                setFavoritesOnly(true);
              }}
              className={cn(
                "mt-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition",
                favoritesOnly
                  ? "bg-electric-500/10 text-electric-700 dark:text-electric-200"
                  : "text-mist-600 hover:bg-mist-50 dark:text-mist-300 dark:hover:bg-white/[0.04]",
              )}
            >
              <Star className="h-3.5 w-3.5" /> Favourites
            </button>

            <div className="mt-3 border-t border-mist-100 pt-3 dark:border-white/[0.06]">
              <p className="mb-2 flex items-center justify-between px-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-mist-400">
                Folders
                <button
                  type="button"
                  onClick={() => {
                    setEditingFolder(null);
                    setFolderName("");
                    setFolderParent("");
                    setFolderOpen(true);
                  }}
                  className="text-mist-400 transition hover:text-electric-600"
                  aria-label="New folder"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </p>
              {folders.loading && !folders.data ? (
                <div className="space-y-1.5 px-1">
                  <Skeleton className="h-6" />
                  <Skeleton className="h-6" />
                </div>
              ) : folders.data?.length ? (
                <div className="space-y-0.5">
                  {folders.data.map((folder) => (
                    <div
                      key={folder.id}
                      className={cn(
                        "group flex items-center gap-1 rounded-lg transition",
                        folderId === folder.id ? "bg-electric-500/10" : "hover:bg-mist-50 dark:hover:bg-white/[0.04]",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setFolderId(folder.id);
                          setFavoritesOnly(false);
                        }}
                        className={cn(
                          "flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left text-xs font-medium",
                          folderId === folder.id
                            ? "text-electric-700 dark:text-electric-200"
                            : "text-mist-600 dark:text-mist-300",
                        )}
                      >
                        <Folder className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{folder.name}</span>
                        <span className="ml-auto shrink-0 text-[10px] text-mist-400">{folder.item_count}</span>
                      </button>
                      <Menu
                        trigger={
                          <button
                            type="button"
                            className="mr-1 rounded p-1 text-mist-400 opacity-0 transition group-hover:opacity-100"
                            aria-label={`Folder actions for ${folder.name}`}
                          >
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </button>
                        }
                      >
                        <MenuItem
                          icon={Pencil}
                          onClick={() => {
                            setEditingFolder(folder);
                            setFolderName(folder.name);
                            setFolderParent(folder.parent_id ?? "");
                            setFolderOpen(true);
                          }}
                        >
                          Rename
                        </MenuItem>
                        <MenuItem icon={Trash2} danger onClick={() => setFolderToDelete(folder)}>
                          Delete
                        </MenuItem>
                      </Menu>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="px-1.5 text-[11px] leading-5 text-mist-400">No folders yet. Group related material together.</p>
              )}
            </div>
          </div>

          {tags.data?.length ? (
            <div className="app-surface p-3">
              <p className="mb-2 px-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-mist-400">Tags</p>
              <div className="flex flex-wrap gap-1.5 px-1">
                {tags.data.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setTag(tag === entry.name ? "" : entry.name)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold transition",
                      tag === entry.name
                        ? "bg-electric-600 text-white"
                        : "bg-mist-100 text-mist-600 hover:bg-mist-200 dark:bg-white/[0.06] dark:text-mist-300",
                    )}
                  >
                    <Tag className="h-2.5 w-2.5" />
                    {entry.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </aside>

        <section className="min-w-0 space-y-4">
          <div className="app-surface flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-mist-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search titles, descriptions and content…"
                className="h-9 w-full rounded-lg border border-mist-200 bg-white pl-8 pr-8 text-xs outline-none transition focus:border-electric-500 focus:ring-2 focus:ring-electric-500/20 dark:border-white/10 dark:bg-white/[0.04] dark:text-mist-100"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-mist-400 hover:text-graphite-700"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Select value={kind} onChange={(event) => setKind(event.target.value)} className="h-9 w-[150px] text-xs">
                <option value="">All kinds</option>
                {LIBRARY_KINDS.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </Select>
              {activeFolder || tag || favoritesOnly ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={X}
                  onClick={() => {
                    setFolderId("");
                    setTag("");
                    setFavoritesOnly(false);
                  }}
                >
                  Clear
                </Button>
              ) : null}
            </div>
          </div>

          {(activeFolder || tag) && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-mist-500">
              <span>Filtered by</span>
              {activeFolder ? <Badge tone="blue">Folder: {activeFolder.name}</Badge> : null}
              {tag ? <Badge tone="violet">Tag: {tag}</Badge> : null}
            </div>
          )}

          {items.error && !items.data ? (
            <ErrorState message={items.error} onRetry={() => void items.reload()} />
          ) : items.loading && !items.data ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="app-surface space-y-3 p-4">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ))}
            </div>
          ) : items.data && items.data.items.length ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {items.data.items.map((item) => {
                  const Icon = kindIcon(item.kind);
                  return (
                    <article
                      key={item.id}
                      className="app-surface card-hover group flex cursor-pointer flex-col p-4"
                      onClick={() => setSelectedId(item.id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-electric-500/10 text-electric-600 dark:text-electric-300">
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="flex items-center gap-0.5" onClick={(event) => event.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => void toggleFavorite(item)}
                            className={cn(
                              "rounded-md p-1.5 transition",
                              item.is_favorite
                                ? "text-amber-500"
                                : "text-mist-300 opacity-0 hover:text-amber-500 group-hover:opacity-100 dark:text-mist-500",
                            )}
                            aria-label={item.is_favorite ? "Remove favourite" : "Mark favourite"}
                          >
                            <Star className={cn("h-3.5 w-3.5", item.is_favorite && "fill-current")} />
                          </button>
                          <Menu
                            trigger={
                              <button
                                type="button"
                                className="rounded-md p-1.5 text-mist-400 opacity-0 transition hover:bg-mist-100 group-hover:opacity-100 dark:hover:bg-white/10"
                                aria-label={`Actions for ${item.title}`}
                              >
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </button>
                            }
                          >
                            <MenuItem icon={Pencil} onClick={() => openEdit(item)}>
                              Edit item
                            </MenuItem>
                            <MenuItem
                              icon={Download}
                              disabled={!item.file_id}
                              onClick={() => {
                                if (item.file_id)
                                  void downloadFile(`/files/${item.file_id}/download`, item.title).catch(() =>
                                    toast.error("Download failed"),
                                  );
                              }}
                            >
                              Download file
                            </MenuItem>
                            <MenuSeparator />
                            <MenuItem icon={Trash2} danger onClick={() => setPendingDelete(item)}>
                              Delete
                            </MenuItem>
                          </Menu>
                        </div>
                      </div>
                      <h3 className="mt-3 line-clamp-2 text-sm font-semibold text-graphite-900 dark:text-mist-100">
                        {item.title}
                      </h3>
                      <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-xs leading-5 text-mist-500 dark:text-mist-400">
                        {item.description || truncate(item.content_text ?? "", 140) || "No description"}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <Badge tone="neutral" className="capitalize">{item.kind}</Badge>
                        <Badge tone={item.chunk_count ? "green" : "amber"}>
                          {item.chunk_count ? `${item.chunk_count} chunks` : "not indexed"}
                        </Badge>
                        {item.folder_id ? (
                          <Badge tone="blue">{folders.data?.find((folder) => folder.id === item.folder_id)?.name ?? "Folder"}</Badge>
                        ) : null}
                      </div>
                      <div className="mt-3 flex items-center justify-between border-t border-mist-100 pt-2.5 text-[10px] text-mist-400 dark:border-white/[0.06]">
                        <span>{relativeTime(item.updated_at)}</span>
                        <span className="truncate">{item.tags.join(" · ")}</span>
                      </div>
                    </article>
                  );
                })}
              </div>
              <div className="app-surface overflow-hidden">
                <Pagination
                  page={page}
                  pageSize={PAGE_SIZE}
                  total={items.data.total}
                  onChange={setPage}
                />
              </div>
            </>
          ) : (
            <EmptyState
              icon={BookOpen}
              title={query || kind || folderId || tag ? "No matching items" : "Your library is empty"}
              description={
                query || kind || folderId || tag
                  ? "Adjust the filters or search for different wording. Retrieval matches literal terms."
                  : "Add a note, upload a document or capture a web source. Text is chunked locally for retrieval."
              }
              action={
                <Button icon={Plus} onClick={openCreate}>
                  Add the first item
                </Button>
              }
            />
          )}
        </section>
      </div>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Edit library item" : "Add to library"}
        description={
          editing
            ? "Changes re-index the item so chat retrieval sees the new text."
            : "Upload a file or write directly. Extracted text is chunked and indexed locally."
        }
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void submitItem()} loading={saving}>
              {editing ? "Save changes" : "Add item"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError ? <Notice tone="danger" title="Could not save">{formError}</Notice> : null}
          <Field label="Title" required htmlFor="lib-title">
            <Input
              id="lib-title"
              value={form.title}
              onChange={(event) => setForm((state) => ({ ...state, title: event.target.value }))}
              placeholder="e.g. Weekly market brief"
              maxLength={240}
            />
          </Field>
          {!editing ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Kind" htmlFor="lib-kind">
                <Select
                  id="lib-kind"
                  value={form.kind}
                  onChange={(event) => setForm((state) => ({ ...state, kind: event.target.value }))}
                >
                  {LIBRARY_KINDS.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {entry.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Folder" htmlFor="lib-folder">
                <Select
                  id="lib-folder"
                  value={form.folder_id}
                  onChange={(event) => setForm((state) => ({ ...state, folder_id: event.target.value }))}
                >
                  <option value="">No folder</option>
                  {folders.data?.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          ) : null}
          <Field label="Description" hint="Optional summary shown in the library and search." htmlFor="lib-desc">
            <Input
              id="lib-desc"
              value={form.description}
              onChange={(event) => setForm((state) => ({ ...state, description: event.target.value }))}
              placeholder="One line about what this material covers"
            />
          </Field>
          <Field
            label="Content"
            hint={
              editing
                ? "Saving new content re-chunks the item."
                : "Paste text or Markdown. A file upload extracts text automatically."
            }
            htmlFor="lib-content"
          >
            <Textarea
              id="lib-content"
              rows={9}
              value={form.content_text}
              onChange={(event) => setForm((state) => ({ ...state, content_text: event.target.value }))}
              placeholder="Write or paste the material you want NEXORA to retrieve…"
              className="font-mono text-xs"
            />
          </Field>
          {!editing ? (
            <div>
              <p className="field-label">Optional file</p>
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="mt-1 flex w-full flex-col items-center justify-center rounded-xl border border-dashed border-mist-300 px-4 py-5 text-center transition hover:border-electric-400 hover:bg-electric-500/[0.03] dark:border-white/15"
              >
                <Upload className="h-5 w-5 text-mist-400" />
                <span className="mt-2 text-xs font-semibold text-graphite-800 dark:text-mist-200">
                  {upload ? upload.name : "Choose a file to extract text from"}
                </span>
                <span className="mt-0.5 text-[10px] text-mist-400">
                  {upload ? formatBytes(upload.size) : "PDF, DOCX, TXT, Markdown, CSV, Excel or image (max 25 MB)"}
                </span>
              </button>
              <input
                ref={fileInput}
                type="file"
                accept={FILE_ACCEPT}
                className="hidden"
                onChange={(event) => setUpload(event.target.files?.[0] ?? null)}
              />
              {upload ? (
                <button
                  type="button"
                  className="mt-1.5 text-[10px] font-semibold text-rose-500"
                  onClick={() => {
                    setUpload(null);
                    if (fileInput.current) fileInput.current.value = "";
                  }}
                >
                  Remove file
                </button>
              ) : null}
            </div>
          ) : null}
          <Field label="Tags" hint="Comma-separated. Tags are personal to your account." htmlFor="lib-tags">
            <Input
              id="lib-tags"
              value={form.tags}
              onChange={(event) => setForm((state) => ({ ...state, tags: event.target.value }))}
              placeholder="research, pricing, q3"
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={folderOpen}
        onClose={() => setFolderOpen(false)}
        title={editingFolder ? "Rename folder" : "New folder"}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setFolderOpen(false)} disabled={folderSaving}>
              Cancel
            </Button>
            <Button onClick={() => void saveFolder()} loading={folderSaving} disabled={!folderName.trim()}>
              {editingFolder ? "Save" : "Create folder"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Folder name" required htmlFor="folder-name">
            <Input
              id="folder-name"
              value={folderName}
              onChange={(event) => setFolderName(event.target.value)}
              placeholder="e.g. Market research"
              maxLength={120}
              autoFocus
            />
          </Field>
          {!editingFolder ? (
            <Field label="Parent folder" htmlFor="folder-parent">
              <Select id="folder-parent" value={folderParent} onChange={(event) => setFolderParent(event.target.value)}>
                <option value="">Root</option>
                {folders.data?.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>
      </Modal>

      <Drawer open={Boolean(selected)} onClose={() => setSelectedId(null)} side="right" label="Library item" className="w-[520px] max-w-[94vw]">
        {selected ? (
          <div className="flex min-h-full flex-col">
            <div className="sticky top-0 z-10 border-b border-mist-100 bg-white/95 px-5 py-4 backdrop-blur dark:border-white/[0.07] dark:bg-navy-900/95">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="neutral" className="capitalize">{selected.kind}</Badge>
                    {selected.folder_id ? (
                      <Badge tone="blue">
                        {folders.data?.find((folder) => folder.id === selected.folder_id)?.name ?? "Folder"}
                      </Badge>
                    ) : null}
                    {selected.is_favorite ? <Badge tone="amber">Favourite</Badge> : null}
                  </div>
                  <h2 className="mt-2 font-display text-lg font-semibold text-graphite-950 dark:text-white">{selected.title}</h2>
                  <p className="mt-1 text-[10px] text-mist-400">
                    Updated {formatDateTime(selected.updated_at)} · {selected.chunk_count} chunks
                  </p>
                </div>
                <IconButton label="Close item" onClick={() => setSelectedId(null)}>
                  <X className="h-4 w-4" />
                </IconButton>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Button size="sm" variant="secondary" icon={Pencil} onClick={() => openEdit(selected)}>
                  Edit
                </Button>
                <Button size="sm" variant="secondary" icon={RefreshCw} loading={reindexing} onClick={() => void reindex()}>
                  Re-index
                </Button>
                {selected.file_id ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={Download}
                    onClick={() =>
                      void downloadFile(`/files/${selected.file_id}/download`, selected.title).catch(() =>
                        toast.error("Download failed", "The file may have been removed."),
                      )
                    }
                  >
                    Download
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" icon={Star} onClick={() => void toggleFavorite(selected)}>
                  {selected.is_favorite ? "Unfavourite" : "Favourite"}
                </Button>
                <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setPendingDelete(selected)}>
                  Delete
                </Button>
              </div>
            </div>

            <div className="flex-1 space-y-5 px-5 py-5">
              {selected.description ? (
                <p className="text-sm leading-6 text-mist-600 dark:text-mist-300">{selected.description}</p>
              ) : null}

              {selected.tags.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {selected.tags.map((entry) => (
                    <Badge key={entry} tone="violet">
                      <Tag className="h-2.5 w-2.5" /> {entry}
                    </Badge>
                  ))}
                </div>
              ) : null}

              <div>
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-mist-400">Content</h3>
                {selected.content_text ? (
                  <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-xl border border-mist-200 bg-mist-50 p-3.5 font-mono text-[11px] leading-5 text-graphite-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-mist-300">
                    {selected.content_text}
                  </pre>
                ) : (
                  <p className="rounded-lg border border-dashed border-mist-200 px-3 py-4 text-center text-xs text-mist-400 dark:border-white/10">
                    No text content. Upload a document or add text so retrieval can use this item.
                  </p>
                )}
              </div>

              <div>
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-mist-400">
                  Retrieval chunks ({chunks.data?.length ?? selected.chunk_count})
                </h3>
                {chunks.loading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-16" />
                    <Skeleton className="h-16" />
                  </div>
                ) : chunks.data?.length ? (
                  <div className="space-y-2">
                    {chunks.data.slice(0, 20).map((chunk) => (
                      <div key={chunk.id} className="rounded-lg border border-mist-200 p-2.5 dark:border-white/10">
                        <div className="mb-1 flex items-center justify-between text-[9px] uppercase tracking-[0.1em] text-mist-400">
                          <span>Passage {chunk.chunk_index + 1}</span>
                          <span>~{chunk.token_estimate} tokens</span>
                        </div>
                        <p className="whitespace-pre-wrap text-[11px] leading-5 text-mist-600 dark:text-mist-300">
                          {truncate(chunk.content, 480)}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-lg border border-dashed border-amber-500/30 bg-amber-500/[0.04] px-3 py-3 text-xs leading-5 text-amber-800 dark:text-amber-200">
                    No passages indexed. Add text or a text-bearing file, then re-index. Chat cannot cite this item yet.
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </Drawer>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void removeItem()}
        title="Delete this library item?"
        description={
          pendingDelete
            ? `“${pendingDelete.title}” will be removed from the library and excluded from retrieval. The original file is not deleted.`
            : ""
        }
        confirmLabel="Delete item"
        tone="danger"
        loading={deleting}
      />

      <ConfirmDialog
        open={Boolean(folderToDelete)}
        onClose={() => setFolderToDelete(null)}
        onConfirm={() => void removeFolder()}
        title="Delete this folder?"
        description={
          folderToDelete
            ? `“${folderToDelete.name}” will be deleted. Items inside are moved to the library root; they are not deleted.`
            : ""
        }
        confirmLabel="Delete folder"
        tone="danger"
      />
    </div>
  );
}
