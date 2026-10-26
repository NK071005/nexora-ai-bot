export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value: string | null | undefined): string {
  const date = parseDate(value);
  if (!date) return "—";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(value: string | null | undefined): string {
  const date = parseDate(value);
  if (!date) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatTime(value: string | null | undefined): string {
  const date = parseDate(value);
  if (!date) return "—";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function relativeTime(value: string | null | undefined): string {
  const date = parseDate(value);
  if (!date) return "—";
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  const minute = 60_000;
  const hour = 3_600_000;
  const day = 86_400_000;
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (abs < minute) return "just now";
  if (abs < hour) return formatter.format(Math.round(diff / minute), "minute");
  if (abs < day) return formatter.format(Math.round(diff / hour), "hour");
  if (abs < day * 30) return formatter.format(Math.round(diff / day), "day");
  if (abs < day * 365) return formatter.format(Math.round(diff / (day * 30)), "month");
  return formatter.format(Math.round(diff / (day * 365)), "year");
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, index);
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

export function toLocalInput(value: string | null | undefined): string {
  const date = parseDate(value);
  if (!date) return "";
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

export function fromLocalInput(value: string): string {
  if (!value) return "";
  return new Date(value).toISOString();
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function truncate(value: string, length = 140): string {
  if (value.length <= length) return value;
  return value.slice(0, Math.max(0, length - 1)).trimEnd() + "…";
}

export function sentenceCase(value: string): string {
  if (!value) return "";
  const text = value.replace(/[_-]+/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function downloadIcs(path: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = path;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function formatScore(score: number): string {
  return Number.isFinite(score) ? score.toFixed(1) : "—";
}

export function nextRunLabel(value: string | null): string {
  if (!value) return "Not scheduled";
  return `${formatDateTime(value)} · ${relativeTime(value)}`;
}
