import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/services/api";

interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function useApiQuery<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<QueryState<T>>({ data: null, loading: true, error: null });
  const loadRef = useRef(load);
  loadRef.current = load;
  const sequence = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(async (silent = false) => {
    const id = ++sequence.current;
    if (!silent) setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await loadRef.current();
      if (mounted.current && id === sequence.current) {
        setState({ data, loading: false, error: null });
      }
      return data;
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Something went wrong.";
      if (mounted.current && id === sequence.current) {
        setState((prev) => ({ ...prev, loading: false, error: message }));
      }
      return null;
    }
  }, []);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ...state, reload, setData: (data: T | null) => setState((prev) => ({ ...prev, data })) };
}

export function useAsyncAction() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | null> => {
    setLoading(true);
    setError(null);
    try {
      return await action();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Something went wrong.");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);
  return { run, loading, error, setError };
}

export function useDebounce<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const listener = () => setMatches(media.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [query]);
  return matches;
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    const previous = document.title;
    document.title = title ? `${title} · NEXORA AI` : "NEXORA AI";
    return () => {
      document.title = previous;
    };
  }, [title]);
}
