#!/usr/bin/env python3
"""Replace Git LFS pointers for photos and videos with the real bytes.

Reads GITHUB_TOKEN from the environment. Does not print the token or download URLs.
"""

from __future__ import annotations

import json
import os
import pathlib
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

MARKER = b"version https://git-lfs.github.com/spec/v1"
EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov", ".m4v"}
BATCH = 100
WORKERS = 6


def library_dir() -> pathlib.Path:
    return pathlib.Path(os.environ.get("LIBRARY_DIR", "media/hernandez_sari_"))


def parse_pointer(path: pathlib.Path) -> tuple[str, int] | None:
    data = path.read_bytes()
    if not data.startswith(MARKER):
        return None
    oid = ""
    size = -1
    for line in data.decode("utf-8", "replace").splitlines():
        if line.startswith("oid sha256:"):
            oid = line.split(":", 1)[1].strip()
        elif line.startswith("size "):
            size = int(line.split()[1])
    if not oid or size < 0:
        raise SystemExit(f"bad pointer: {path.name}")
    return oid, size


def pointers(folder: pathlib.Path) -> list[tuple[pathlib.Path, str, int]]:
    found: list[tuple[pathlib.Path, str, int]] = []
    for path in sorted(folder.iterdir()):
        if not path.is_file() or path.suffix.lower() not in EXTENSIONS:
            continue
        parsed = parse_pointer(path)
        if parsed:
            found.append((path, parsed[0], parsed[1]))
    return found


def batch_download(token: str, objects: list[dict[str, int | str]]) -> dict[str, dict[str, object]]:
    repo = os.environ.get(
        "LFS_REPO",
        "https://github.com/Nelse0189/manychat-instagram-ai.git",
    )
    ref = os.environ.get("LFS_REF", "refs/heads/cursor/instant-try-page-e78f")
    body = json.dumps(
        {
            "operation": "download",
            "transfers": ["basic"],
            "ref": {"name": ref},
            "objects": objects,
        }
    ).encode()
    request = urllib.request.Request(
        f"{repo}/info/lfs/objects/batch",
        data=body,
        headers={
            "Accept": "application/vnd.git-lfs+json",
            "Content-Type": "application/vnd.git-lfs+json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "git-lfs/3.7.1",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.load(response)
    by_oid: dict[str, dict[str, object]] = {}
    for item in payload.get("objects", []):
        oid = item.get("oid")
        if isinstance(oid, str):
            by_oid[oid] = item
    return by_oid


def write_object(path: pathlib.Path, item: dict[str, object], size: int) -> None:
    error = item.get("error")
    if error:
        raise RuntimeError(f"{path.name}: {error}")
    actions = item.get("actions")
    if not isinstance(actions, dict) or not isinstance(actions.get("download"), dict):
        raise RuntimeError(f"{path.name}: no download")
    download = actions["download"]
    href = download.get("href")
    if not isinstance(href, str) or not href:
        raise RuntimeError(f"{path.name}: no download")
    headers = download.get("header") if isinstance(download.get("header"), dict) else {}
    request = urllib.request.Request(href, headers={str(key): str(value) for key, value in headers.items()})
    temporary = path.with_suffix(path.suffix + ".partial")
    try:
        with urllib.request.urlopen(request, timeout=180) as response, temporary.open("wb") as handle:
            written = 0
            while True:
                chunk = response.read(1024 * 256)
                if not chunk:
                    break
                handle.write(chunk)
                written += len(chunk)
        if written != size:
            raise RuntimeError(f"size mismatch for {path.name}")
        with temporary.open("rb") as handle:
            head = handle.read(len(MARKER))
        if head.startswith(MARKER):
            raise RuntimeError(f"pointer remained for {path.name}")
        temporary.replace(path)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def pull(token: str, pending: list[tuple[pathlib.Path, str, int]]) -> None:
    failures: list[str] = []
    done = 0

    def job(path: pathlib.Path, item: dict[str, object], size: int) -> None:
        last: Exception | None = None
        for attempt in range(3):
            try:
                write_object(path, item, size)
                return
            except Exception as error:
                last = error
                time.sleep(1 + attempt)
        raise RuntimeError(last.__class__.__name__ if last else "download failed")

    for start in range(0, len(pending), BATCH):
        chunk = pending[start : start + BATCH]
        actions = batch_download(token, [{"oid": oid, "size": size} for _path, oid, size in chunk])
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futures = []
            for path, oid, size in chunk:
                item = actions.get(oid)
                if not item:
                    failures.append("missing")
                    continue
                futures.append(pool.submit(job, path, item, size))
            for future in as_completed(futures):
                done += 1
                try:
                    future.result()
                except Exception as error:
                    failures.append(error.__class__.__name__)
        print(f"wrote {done}/{len(pending)}", flush=True)
    if failures:
        print(f"failed {len(failures)} files", flush=True)
        raise SystemExit(1)


def main() -> None:
    folder = library_dir()
    pending = pointers(folder)
    print(f"pointers={len(pending)}", flush=True)
    if "--check" in sys.argv:
        if not pending:
            raise SystemExit("no pointers found")
        return
    token = os.environ.get("GITHUB_TOKEN", "")
    if not token:
        raise SystemExit("GITHUB_TOKEN is not set")
    if not pending:
        print("nothing to pull", flush=True)
        return
    pull(token, pending)
    largest = max(path.stat().st_size for path, _oid, _size in pending)
    print(f"largest={largest}", flush=True)
    if largest < 1000:
        raise SystemExit("media files are not the real library")


if __name__ == "__main__":
    main()
