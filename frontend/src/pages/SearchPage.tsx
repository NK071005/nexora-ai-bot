import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  BookOpen,
  Clock,
  Globe2,
  History,
  Library,
  MessageSquare,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useDocumentTitle } from "@/hooks/useApi";
import { searchApi } from "@/services/api";
import type { HistorySearchHit, LibraryHit, RecentSearch, SearchStatus, WebSearchItem } from "@/types/api";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Notice,
  PageHeader,
  Skeleton,
  StatusBadge,
} from "@/components/ui/primitives";
import { Tabs } from "@/components/ui/overlays";
import { formatDateTime, relativeTime, truncate } from "@/lib/format";
import { cn } from "@/lib/cn";

type Scope = "web" | "chats" | "library";

const scopeItems = [
  { id: "web", label: "Web", icon: Globe2 },
  { id: "chats", label: "Conversations", icon: MessageSquare },
  { id: "library", label: "Library", icon: Library },
];

interface SearchData {
  status: SearchStatus;
  recent: RecentSearch[];
  web: WebSearchItem[];
  webMessage: string | null;
  chats: HistorySearchHit[];
  library: LibraryHit[];
}

export function SearchPage() {
  useDocumentTitle("Research");
  const [scope, setScope] = useState<Scope>("web");
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [status, setStatus] = useState<SearchStatus | null>(null);
  const [recent, setRecent] = useState<RecentSearch[]>([]);
  const [results, setResults] = useState<{
    web: WebSearchItem[];
    webMessage: string | null;
    chats: HistorySearchHit[];
    library: LibraryHit[];
  }>({ web: [], webMessage: null, chats: [], library: [] });
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function bootstrap() {
    setLoading(true);
    setError(null);
    try {
      const [statusResponse, recentResponse] = await Promise.all([searchApi.status(), searchApi.recent(8)]);
      setStatus(statusResponse);
      setRecent(recentResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Search status could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void bootstrap();
  }, []);

  async function runSearch(raw = query) {
    const text = raw.trim();
    if (!text) return;
    setQuery(raw);
    setSubmitted(text);
    setSearching(true);
    setError(null);
    try {
      if (scope === "web") {
        const response = await searchApi.web(text, 10);
        setResults((prev) => ({ ...prev, web: response.results, webMessage: response.message }));
        const recentResponse = await searchApi.recent(8);
        setRecent(recentResponse);
      } else if (scope === "chats") {
        const hits = await searchApi.chats(text, 30);
        setResults((prev) => ({ ...prev, chats: hits }));
      } else {
        const hits = await searchApi.library(text, 30);
        setResults((prev) => ({ ...prev, library: hits }));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  }

  const currentCount = useMemo(() => {
    if (!submitted) return 0;
    if (scope === "web") return results.web.length;
    if (scope === "chats") return results.chats.length;
    return results.library.length;
  }, [scope, submitted, results]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Evidence"
        title="Research"
        description="Search the live web when a provider is configured, or search your own conversations and library locally. Results are never invented."
      />

      {loading ? (
        <div className="app-surface space-y-3 p-5">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : error && !status ? (
        <ErrorState message={error} onRetry={() => void bootstrap()} />
      ) : (
        <>
          <section className="app-surface p-4 sm:p-5">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void runSearch();
              }}
              className="flex flex-col gap-2 sm:flex-row"
            >
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-mist-400" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={
                    scope === "web"
                      ? "Search the live web…"
                      : scope === "chats"
                        ? "Search your conversation history…"
                        : "Search titles and indexed passages…"
                  }
                  className="h-11 pl-10"
                  maxLength={400}
                />
              </div>
              <Button type="submit" size="lg" icon={Search} loading={searching} disabled={!query.trim()}>
                Search
              </Button>
            </form>

            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Tabs
                items={scopeItems.map((item) => ({
                  ...item,
                  count:
                    item.id === "web"
                      ? results.web.length || undefined
                      : item.id === "chats"
                        ? results.chats.length || undefined
                        : results.library.length || undefined,
                }))}
                value={scope}
                onChange={(value) => setScope(value as Scope)}
                variant="pills"
              />
              {status ? (
                scope === "web" ? (
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-mist-500">
                    <Badge tone={status.configured ? "green" : "amber"} dot>
                      {status.configured ? `${status.provider} live` : "Web search not configured"}
                    </Badge>
                    <span>Local chat and library search stay available.</span>
                  </div>
                ) : (
                  <Badge tone="blue" dot>
                    Local lexical search
                  </Badge>
                )
              ) : null}
            </div>
          </section>

          {scope === "web" && status && !status.configured ? (
            <Notice
              tone="warning"
              title="Live web search is not configured"
              action={
                <Link to="/settings?tab=integrations" className="text-xs font-semibold underline">
                  View setup
                </Link>
              }
            >
              <p>{status.note}</p>
            </Notice>
          ) : null}

          {scope === "web" && status?.configured ? (
            <Notice tone="info" title={`Live ${status.provider} search`}>
              <p>Every result below includes its real URL. NEXORA does not generate citations for pages it did not retrieve.</p>
            </Notice>
          ) : null}

          {error ? <ErrorState message={error} onRetry={() => void runSearch(submitted || query)} /> : null}

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
            <section className="min-w-0 space-y-4">
              {searching ? (
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div key={index} className="app-surface space-y-2 p-4">
                      <Skeleton className="h-4 w-1/2" />
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-3 w-4/5" />
                    </div>
                  ))}
                </div>
              ) : !submitted ? (
                <EmptyState
                  icon={Sparkles}
                  title="Start with a question or a keyword"
                  description={
                    scope === "web"
                      ? "Live results require a search provider. Without one, NEXORA tells you clearly and points to your local material."
                      : "Conversation and library search use literal, lexical matching across your own material."
                  }
                />
              ) : currentCount === 0 ? (
                <EmptyState
                  icon={scope === "web" ? Globe2 : scope === "chats" ? MessageSquare : BookOpen}
                  title={
                    scope === "web" && !status?.configured
                      ? "No live results: search is unconfigured"
                      : "No matches found"
                  }
                  description={
                    scope === "web" && !status?.configured
                      ? "Add SEARCH_PROVIDER and SEARCH_PROVIDER_API_KEY to retrieve live sources. Nothing is fabricated in the meantime."
                      : "Try different wording. Local retrieval matches terms rather than meaning."
                  }
                />
              ) : scope === "web" ? (
                <div className="space-y-3">
                  {results.web.map((result) => (
                    <article key={`${result.rank}-${result.url}`} className="app-surface card-hover p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <a
                            href={result.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="group inline-flex items-start gap-1.5 text-sm font-semibold text-electric-700 hover:underline dark:text-electric-200"
                          >
                            {result.title}
                            <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-60" />
                          </a>
                          <p className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-mist-400">
                            <span>{result.domain}</span>
                            {result.published_at ? <span>· {formatDateTime(result.published_at)}</span> : null}
                            <span>· rank {result.rank}</span>
                          </p>
                        </div>
                        <Badge tone="neutral">#{result.rank}</Badge>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-mist-600 dark:text-mist-300">{result.snippet}</p>
                      <p className="mt-2 truncate text-[10px] text-mist-400">{result.url}</p>
                    </article>
                  ))}
                </div>
              ) : scope === "chats" ? (
                <div className="space-y-3">
                  {results.chats.map((hit) => (
                    <Link
                      key={hit.id}
                      to={`/chat/${hit.id}`}
                      className="app-surface card-hover block p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-sm font-semibold text-graphite-900 dark:text-mist-100">{hit.title}</h3>
                        <div className="flex shrink-0 gap-1.5">
                          {hit.is_pinned ? <Badge tone="blue">Pinned</Badge> : null}
                          {hit.is_archived ? <Badge tone="neutral">Archived</Badge> : null}
                        </div>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-mist-600 dark:text-mist-300">{hit.snippet}</p>
                      <p className="mt-2 text-[10px] text-mist-400">
                        Updated {relativeTime(hit.updated_at)} · match: {hit.match}
                      </p>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  {results.library.map((hit) => (
                    <Link key={hit.id} to={`/library?item=${hit.id}`} className="app-surface card-hover block p-4">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-sm font-semibold text-graphite-900 dark:text-mist-100">{hit.title}</h3>
                        <Badge tone="neutral" className="capitalize">{hit.kind}</Badge>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-mist-600 dark:text-mist-300">{hit.snippet}</p>
                      <p className="mt-2 text-[10px] text-mist-400">Updated {relativeTime(hit.updated_at)}</p>
                    </Link>
                  ))}
                </div>
              )}
            </section>

            <aside className="space-y-4">
              {scope === "web" ? (
                <section className="app-surface p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <History className="h-4 w-4 text-mist-400" />
                    <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-mist-500">Recent searches</h2>
                  </div>
                  {recent.length ? (
                    <div className="space-y-1">
                      {recent.map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={() => void runSearch(entry.query)}
                          className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition hover:bg-mist-50 dark:hover:bg-white/[0.04]"
                        >
                          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mist-400" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium text-graphite-800 dark:text-mist-200">
                              {entry.query}
                            </span>
                            <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-mist-400">
                              <StatusBadge status={entry.status} />
                              {entry.result_count} results · {relativeTime(entry.created_at)}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] leading-5 text-mist-400">
                      No searches yet. Live queries are recorded with their provider and result count.
                    </p>
                  )}
                </section>
              ) : null}

              <section className="rounded-2xl border border-navy-800 bg-navy-950 p-4 text-mist-300">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-300" />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white">No invented sources</p>
                </div>
                <p className="mt-2 text-[11px] leading-5 text-mist-400">
                  Citations only appear when a provider returned a real URL. Local retrieval is transparent about being
                  lexical, not semantic.
                </p>
                <div className="mt-3 space-y-1.5 text-[10px] text-mist-400">
                  {status?.local ? (
                    <>
                      <p className="flex items-center justify-between">
                        <span>Conversation history</span>
                        <Badge tone={status.local.chat_history ? "green" : "neutral"}>
                          {status.local.chat_history ? "available" : "off"}
                        </Badge>
                      </p>
                      <p className="flex items-center justify-between">
                        <span>Library lexical</span>
                        <Badge tone={status.local.library_lexical ? "green" : "neutral"}>
                          {status.local.library_lexical ? "available" : "off"}
                        </Badge>
                      </p>
                      <p className="flex items-center justify-between">
                        <span>Semantic / vector</span>
                        <Badge tone="neutral">{status.local.semantic ? "available" : "not implemented"}</Badge>
                      </p>
                    </>
                  ) : null}
                </div>
              </section>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
