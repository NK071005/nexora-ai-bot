"""Safe text extraction and Excel analysis for untrusted uploads.

Nothing here executes uploaded content. Parsers are defensive: malformed files
produce a failed extraction state rather than a 500.
"""

from __future__ import annotations

import csv
import io
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

MAX_TEXT_CHARS = 120_000
MAX_EXCEL_ROWS = 5_000


@dataclass
class ExtractionResult:
    text: str = ""
    page_count: int | None = None
    status: str = "extracted"
    metadata: dict = field(default_factory=dict)
    error: str | None = None


def _read_text_file(path: Path) -> str:
    raw = path.read_bytes()[: 4 * 1024 * 1024]
    for encoding in ("utf-8", "utf-16", "latin-1"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def extract_pdf(path: Path) -> ExtractionResult:
    import fitz  # PyMuPDF

    parts: list[str] = []
    pages = 0
    with fitz.open(path) as doc:
        pages = doc.page_count
        for index, page in enumerate(doc):
            text = page.get_text("text").strip()
            if text:
                parts.append(f"\n--- Page {index + 1} ---\n{text}")
            if sum(len(p) for p in parts) > MAX_TEXT_CHARS:
                break
    text = "".join(parts)[:MAX_TEXT_CHARS]
    return ExtractionResult(
        text=text,
        page_count=pages,
        status="extracted" if text.strip() else "no_text",
        metadata={"pages": pages, "characters": len(text)},
    )


def extract_docx(path: Path) -> ExtractionResult:
    from docx import Document

    document = Document(str(path))
    parts = [p.text.strip() for p in document.paragraphs if p.text.strip()]
    for table in document.tables[:20]:
        rows = []
        for row in table.rows[:100]:
            rows.append(" | ".join(cell.text.strip() for cell in row.cells))
        if rows:
            parts.append("\n[Table]\n" + "\n".join(rows))
    text = "\n".join(parts)[:MAX_TEXT_CHARS]
    return ExtractionResult(
        text=text,
        status="extracted" if text.strip() else "no_text",
        metadata={"paragraphs": len(document.paragraphs), "tables": len(document.tables)},
    )


def _dataframe_profile(df: pd.DataFrame, sheet: str) -> dict:
    df = df.head(MAX_EXCEL_ROWS)
    preview = df.head(12).fillna("").astype(str).to_dict(orient="records")
    columns = [str(c) for c in df.columns]
    missing = {str(col): int(df[col].isna().sum()) for col in df.columns}
    duplicates = int(df.duplicated().sum())
    numeric_summary: dict[str, dict] = {}
    for col in df.columns:
        series = pd.to_numeric(df[col], errors="coerce")
        if series.notna().sum() >= max(1, len(df) // 2):
            numeric_summary[str(col)] = {
                "count": int(series.notna().sum()),
                "mean": round(float(series.mean()), 4) if series.notna().any() else None,
                "min": float(series.min()) if series.notna().any() else None,
                "max": float(series.max()) if series.notna().any() else None,
                "sum": round(float(series.sum()), 4) if series.notna().any() else None,
            }
    return {
        "sheet": sheet,
        "rows": int(len(df)),
        "columns": columns,
        "preview": preview,
        "missing_values": {k: v for k, v in missing.items() if v},
        "duplicate_rows": duplicates,
        "numeric_summary": numeric_summary,
        "dtypes": {str(c): str(t) for c, t in df.dtypes.items()},
    }


def extract_excel(path: Path) -> ExtractionResult:
    excel = pd.ExcelFile(path)
    profiles = []
    text_parts = []
    for sheet in excel.sheet_names[:12]:
        try:
            df = excel.parse(sheet)
        except Exception:
            continue
        profile = _dataframe_profile(df, sheet)
        profiles.append(profile)
        text_parts.append(
            f"Sheet: {sheet}\nRows: {profile['rows']}\nColumns: {', '.join(profile['columns'])}\n"
            + "\n".join(
                " | ".join(f"{k}={v}" for k, v in row.items())
                for row in profile["preview"][:8]
            )
        )
    text = "\n\n".join(text_parts)[:MAX_TEXT_CHARS]
    return ExtractionResult(
        text=text,
        status="extracted" if profiles else "no_text",
        metadata={"sheets": profiles, "sheet_count": len(excel.sheet_names)},
    )


def extract_csv(path: Path) -> ExtractionResult:
    raw = _read_text_file(path)
    try:
        df = pd.read_csv(io.StringIO(raw))
        profile = _dataframe_profile(df, "csv")
        text = (
            f"CSV columns: {', '.join(profile['columns'])}\n"
            f"Rows: {profile['rows']}\n\n"
            + "\n".join(
                " | ".join(f"{k}={v}" for k, v in row.items())
                for row in profile["preview"][:15]
            )
        )
        return ExtractionResult(text=text[:MAX_TEXT_CHARS], metadata={"table": profile})
    except Exception:
        return ExtractionResult(text=raw[:MAX_TEXT_CHARS], metadata={"format": "text"})


def extract_image(path: Path) -> ExtractionResult:
    from PIL import Image

    try:
        with Image.open(path) as img:
            width, height = img.size
            return ExtractionResult(
                text="",
                status="metadata_only",
                metadata={
                    "width": width,
                    "height": height,
                    "format": img.format,
                    "mode": img.mode,
                    "note": "OCR is not configured. Visual analysis uses the configured vision model or demo metadata.",
                },
            )
    except Exception as exc:
        return ExtractionResult(status="failed", error=f"Image could not be decoded: {exc}")


def extract_text(path: Path, extension: str) -> ExtractionResult:
    ext = extension.lower()
    try:
        if ext == ".pdf":
            return extract_pdf(path)
        if ext == ".docx":
            return extract_docx(path)
        if ext in {".xlsx", ".xls"}:
            return extract_excel(path)
        if ext == ".csv":
            return extract_csv(path)
        if ext in {".txt", ".md", ".json", ".py", ".js", ".ts", ".tsx", ".jsx", ".html", ".css", ".sql", ".yaml", ".yml", ".xml"}:
            text = _read_text_file(path)
            if ext == ".json":
                try:
                    parsed = json.loads(text)
                    text = json.dumps(parsed, indent=2)[:MAX_TEXT_CHARS]
                except Exception:
                    pass
            return ExtractionResult(text=text[:MAX_TEXT_CHARS], metadata={"characters": len(text)})
        if ext in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}:
            return extract_image(path)
        return ExtractionResult(status="unsupported", metadata={"note": "Binary media is not text-extracted."})
    except Exception as exc:
        return ExtractionResult(status="failed", error=f"Extraction failed: {exc}")


def analyze_spreadsheet(path: Path, extension: str) -> dict:
    if extension in {".xlsx", ".xls"}:
        result = extract_excel(path)
    elif extension == ".csv":
        result = extract_csv(path)
    else:
        raise ValueError("Not a spreadsheet")
    return {"text": result.text, "metadata": result.metadata, "status": result.status}


def chunk_text(text: str, size: int = 1200, overlap: int = 150) -> list[str]:
    clean = re.sub(r"\n{3,}", "\n\n", text or "").strip()
    if not clean:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(clean) and len(chunks) < 200:
        end = min(start + size, len(clean))
        if end < len(clean):
            boundary = clean.rfind("\n", start + size // 2, end)
            if boundary > start:
                end = boundary
        chunks.append(clean[start:end].strip())
        if end >= len(clean):
            break
        start = max(end - overlap, start + 1)
    return [c for c in chunks if c]


def spreadsheet_rows(path: Path, extension: str, limit: int = 50) -> list[dict]:
    if extension == ".csv":
        with path.open("r", encoding="utf-8", errors="replace", newline="") as handle:
            reader = csv.DictReader(handle)
            return [dict(row) for _, row in zip(range(limit), reader)]
    if extension in {".xlsx", ".xls"}:
        df = pd.read_excel(path).head(limit)
        return df.fillna("").astype(str).to_dict(orient="records")
    return []
