"""Media capabilities and processing contracts."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas.common import UTCDateTime
from app.schemas.chat import FileOut


class TranscriptSegment(BaseModel):
    start: float
    end: float
    text: str


class TranscriptionOut(BaseModel):
    text: str
    language: str | None = None
    segments: list[TranscriptSegment] = Field(default_factory=list)
    provider: str
    demo: bool = False


class TranscriptionStatus(BaseModel):
    configured: bool
    model: str
    message: str


class VisionRequest(BaseModel):
    prompt: str = Field(default="Describe this image in detail, including any visible text.", max_length=2000)


class VisionOut(BaseModel):
    description: str
    provider: str


class ImageGenerationRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=2000)
    size: str = Field(default="1024x1024", pattern="^(1024x1024|1024x1792|1792x1024|512x512|256x256)$")


class GeneratedImageOut(BaseModel):
    file: FileOut
    artifact_id: str
    provider: str
    prompt: str
    demo: bool = False


class MediaCapabilities(BaseModel):
    vision: dict
    transcription: dict
    image_generation: dict
    video: dict
    ffmpeg_available: bool


class SpreadsheetAnalysis(BaseModel):
    file_id: str
    filename: str
    status: str
    metadata: dict
    text: str


class ProcessingJobOut(BaseModel):
    id: str
    media_asset_id: str
    kind: str
    status: str
    progress: int
    result: dict | None = None
    error: str | None = None
    created_at: UTCDateTime
