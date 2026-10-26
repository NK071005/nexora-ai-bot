export const TIMEZONES = [
  "UTC",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Australia/Sydney",
  "Asia/Tokyo",
];

export const DAYS_OF_WEEK = [
  { value: 0, label: "Monday" },
  { value: 1, label: "Tuesday" },
  { value: 2, label: "Wednesday" },
  { value: 3, label: "Thursday" },
  { value: 4, label: "Friday" },
  { value: 5, label: "Saturday" },
  { value: 6, label: "Sunday" },
];

export const INTERN_STATUSES = ["invited", "active", "completed", "paused", "withdrawn"] as const;

export const LIBRARY_KINDS = [
  { value: "note", label: "Note" },
  { value: "document", label: "Document" },
  { value: "web", label: "Web capture" },
  { value: "answer", label: "AI answer" },
  { value: "chat", label: "Conversation" },
  { value: "spreadsheet", label: "Spreadsheet" },
  { value: "image", label: "Image" },
];

export const EVALUATION_STATUSES = [
  "passed",
  "corrections_required",
  "failed",
  "human_review_required",
  "approved",
  "rejected",
];

export const CRITERION_TYPES = [
  { value: "keywords", label: "Required keywords", hint: "Every comma-separated term must appear." },
  { value: "min_words", label: "Minimum words", hint: "Submission must reach the word count." },
  { value: "table", label: "Data table", hint: "A Markdown table or spreadsheet attachment." },
  { value: "sections", label: "Required sections", hint: "Section titles that must be present." },
  { value: "min_count", label: "Minimum list items", hint: "Numbered or bulleted items required." },
  { value: "forbidden", label: "Forbidden placeholders", hint: "Terms that must not appear (e.g. TBD)." },
  { value: "file", label: "Required file", hint: "An attachment with one of the extensions." },
  { value: "manual", label: "Human judgment", hint: "Cannot be verified automatically; forces review." },
];

export const FILE_ACCEPT =
  ".pdf,.docx,.txt,.md,.csv,.xlsx,.xls,.png,.jpg,.jpeg,.webp,.gif,.mp3,.wav,.m4a,.mp4,.mov,.webm";

export const MAX_UPLOAD_MB = 25;
