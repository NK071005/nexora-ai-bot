"""Library retrieval, file extraction and explicit media capability states."""

from __future__ import annotations

import io

from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import csrf_headers, register

LONG_NOTE = (
    "Market evidence for the research brief.\n\n"
    "The competitive landscape shows three clear segments. Each segment has distinct "
    "pricing, distribution and retention signals. Our recommendation is to prioritise "
    "the mid-market segment because the evidence suggests faster payback and lower "
    "acquisition cost. Risks include seasonality and channel conflict.\n\n"
    "Open questions: what is the retention curve after month six, and which acquisition "
    "channel produced the highest qualified pipeline last quarter?\n"
)


def _upload(client: TestClient, name: str, content: bytes, mime: str = "text/plain"):
    return client.post(
        "/api/files",
        files={"file": (name, content, mime)},
        headers=csrf_headers(client),
    )


def test_file_upload_extraction_download_and_idor():
    with TestClient(app) as client:
        assert register(client, email="files@example.com").status_code == 201
        upload = _upload(client, "brief.txt", LONG_NOTE.encode("utf-8"))
        assert upload.status_code == 201, upload.text
        record = upload.json()
        assert record["kind"] == "document"
        assert record["extraction_status"] == "extracted"
        assert record["size_bytes"] == len(LONG_NOTE.encode("utf-8"))
        assert len(record["sha256"]) == 64

        listed = client.get("/api/files")
        assert listed.status_code == 200
        assert [item["id"] for item in listed.json()] == [record["id"]]

        download = client.get(f"/api/files/{record['id']}/download")
        assert download.status_code == 200
        assert download.content.decode("utf-8") == LONG_NOTE

        with TestClient(__import__("app.main", fromlist=["app"]).app) as intruder:
            assert register(intruder, email="intruder-files@example.com").status_code == 201
            assert intruder.get(f"/api/files/{record['id']}").status_code == 403
            assert intruder.get(f"/api/files/{record['id']}/download").status_code == 403
            assert intruder.delete(
                f"/api/files/{record['id']}", headers=csrf_headers(intruder)
            ).status_code == 403

        deleted = client.delete(f"/api/files/{record['id']}", headers=csrf_headers(client))
        assert deleted.status_code == 200
        assert client.get(f"/api/files/{record['id']}").status_code == 404


def test_library_items_chunks_search_tags_and_folders():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        assert register(client, email="library@example.com").status_code == 201

        folder = client.post(
            "/api/library/folders",
            json={"name": "Research"},
            headers=csrf_headers(client),
        )
        assert folder.status_code == 201, folder.text
        folder_id = folder.json()["id"]

        upload = _upload(client, "market-note.md", LONG_NOTE.encode("utf-8"), "text/markdown")
        assert upload.status_code == 201, upload.text
        file_id = upload.json()["id"]

        created = client.post(
            "/api/library/items",
            json={
                "title": "Market evidence brief",
                "kind": "document",
                "folder_id": folder_id,
                "file_id": file_id,
                "tags": ["research", "market"],
            },
            headers=csrf_headers(client),
        )
        assert created.status_code == 201, created.text
        item = created.json()
        assert item["content_text"].startswith("Market evidence")
        assert item["metadata_json"]["original_filename"] == "market-note.md"
        assert item["chunk_count"] >= 1
        assert set(item["tags"]) == {"research", "market"}

        chunks = client.get(f"/api/library/items/{item['id']}/chunks")
        assert chunks.status_code == 200
        assert chunks.json()
        assert "market" in chunks.json()[0]["content"].lower()

        hits = client.get("/api/library/search", params={"q": "competitive landscape"})
        assert hits.status_code == 200
        assert hits.json()
        assert hits.json()[0]["id"] == item["id"]

        filtered = client.get("/api/library/items", params={"tag": "research", "favorite": True})
        assert filtered.status_code == 200
        assert filtered.json()["total"] == 0

        favorite = client.patch(
            f"/api/library/items/{item['id']}",
            json={"is_favorite": True, "tags": ["research"]},
            headers=csrf_headers(client),
        )
        assert favorite.status_code == 200
        assert favorite.json()["is_favorite"] is True
        assert favorite.json()["tags"] == ["research"]

        folders = client.get("/api/library/folders")
        assert folders.status_code == 200
        assert folders.json()[0]["item_count"] == 1

        with TestClient(app) as intruder:
            assert register(intruder, email="intruder-library@example.com").status_code == 201
            assert intruder.get(f"/api/library/items/{item['id']}").status_code == 403
            assert intruder.patch(
                f"/api/library/items/{item['id']}",
                json={"title": "Stolen"},
                headers=csrf_headers(intruder),
            ).status_code == 403
            assert intruder.get("/api/library/search", params={"q": "market"}).json() == []

        deleted = client.delete(f"/api/library/items/{item['id']}", headers=csrf_headers(client))
        assert deleted.status_code == 200
        assert client.get(f"/api/library/items/{item['id']}").status_code == 404


def test_spreadsheet_analysis_reports_real_rows():
    from fastapi.testclient import TestClient

    from app.main import app

    csv = b"name,score,team\nAda,91,Research\nBola,78,Product\nChen,88,Analytics\n"
    with TestClient(app) as client:
        assert register(client, email="spreadsheet@example.com").status_code == 201
        upload = _upload(client, "scores.csv", csv, "text/csv")
        assert upload.status_code == 201, upload.text
        record = upload.json()
        assert record["kind"] == "spreadsheet"
        assert record["extraction_status"] == "extracted"

        analysis = client.get(f"/api/files/{record['id']}/analysis")
        assert analysis.status_code == 200, analysis.text
        body = analysis.json()
        assert body["metadata"]["table"]["rows"] == 3
        assert body["metadata"]["table"]["columns"] == ["name", "score", "team"]
        assert body["metadata"]["table"]["numeric_summary"]["score"]["max"] == 91
        assert "Ada" in body["text"]

        text_upload = _upload(client, "not-a-table.txt", b"plain text", "text/plain")
        assert text_upload.status_code == 201
        unsupported = client.get(f"/api/files/{text_upload.json()['id']}/analysis")
        assert unsupported.status_code == 422
        assert unsupported.json()["error"]["code"] == "unsupported_analysis"


def test_media_capabilities_and_unconfigured_actions_are_explicit():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        assert register(client, email="media@example.com").status_code == 201

        capabilities = client.get("/api/media/capabilities")
        assert capabilities.status_code == 200
        body = capabilities.json()
        assert body["vision"]["configured"] is False
        assert body["vision"]["mode"] == "unconfigured"
        assert body["transcription"]["configured"] is False
        assert body["image_generation"]["configured"] is False
        assert body["ffmpeg_available"] == body["video"]["configured"]

        audio = _upload(client, "clip.mp3", b"not-really-audio", "audio/mpeg")
        assert audio.status_code == 201
        assert audio.json()["kind"] == "audio"
        transcribe = client.post(
            f"/api/media/files/{audio.json()['id']}/transcribe",
            headers=csrf_headers(client),
        )
        assert transcribe.status_code == 409
        assert transcribe.json()["error"]["code"] == "transcription_not_configured"

        from PIL import Image

        buffer = io.BytesIO()
        Image.new("RGB", (12, 12), (22, 45, 90)).save(buffer, format="PNG")
        image = _upload(client, "chart.png", buffer.getvalue(), "image/png")
        assert image.status_code == 201
        assert image.json()["kind"] == "image"
        describe = client.post(
            f"/api/media/files/{image.json()['id']}/describe",
            json={},
            headers=csrf_headers(client),
        )
        assert describe.status_code == 409
        assert describe.json()["error"]["code"] == "vision_not_configured"

        generated = client.post(
            "/api/media/images",
            json={"prompt": "A navy abstract workspace", "size": "1024x1024"},
            headers=csrf_headers(client),
        )
        assert generated.status_code == 409
        assert generated.json()["error"]["code"] == "image_generation_not_configured"

        video = _upload(client, "demo.mp4", b"\x00\x00\x00\x18ftypmp42", "video/mp4")
        assert video.status_code == 201
        assert video.json()["kind"] == "video"
        frame = client.post(
            f"/api/media/files/{video.json()['id']}/video/frame",
            headers=csrf_headers(client),
        )
        assert frame.status_code in {409, 422}
        assert frame.json()["error"]["code"] in {"ffmpeg_unavailable", "frame_extraction_failed"}
