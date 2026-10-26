import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type ThemeChoice = "light" | "dark" | "system";

interface ThemeContextValue {
  theme: ThemeChoice;
  resolved: "light" | "dark";
  setTheme: (theme: ThemeChoice) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = "nexora-theme";

function systemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as ThemeChoice | null;
    return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
  });
  const [resolved, setResolved] = useState<"light" | "dark">(() =>
    theme === "system" ? systemTheme() : theme,
  );

  const apply = useCallback((choice: ThemeChoice) => {
    const actual = choice === "system" ? systemTheme() : choice;
    document.documentElement.classList.toggle("dark", actual === "dark");
    document.documentElement.style.colorScheme = actual;
    setResolved(actual);
  }, []);

  useEffect(() => {
    apply(theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme, apply]);

  useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => apply("system");
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [theme, apply]);

  const setTheme = useCallback((choice: ThemeChoice) => setThemeState(choice), []);
  const toggle = useCallback(() => {
    setThemeState((current) => {
      const actual = current === "system" ? systemTheme() : current;
      return actual === "dark" ? "light" : "dark";
    });
  }, []);

  const value = useMemo(
    () => ({ theme, resolved, setTheme, toggle }),
    [theme, resolved, setTheme, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
