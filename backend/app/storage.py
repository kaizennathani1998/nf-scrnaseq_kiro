"""Simple JSON-file based run store (swap for DynamoDB in production)."""
import json
import os
from pathlib import Path
from typing import List, Optional
from .models import PipelineRun
from .config import settings

_store_path = Path(settings.data_dir) / "runs.json"


def _load() -> dict:
    if _store_path.exists():
        return json.loads(_store_path.read_text())
    return {}


def _save(data: dict):
    _store_path.parent.mkdir(parents=True, exist_ok=True)
    _store_path.write_text(json.dumps(data, default=str, indent=2))


def list_runs() -> List[PipelineRun]:
    data = _load()
    return [PipelineRun(**v) for v in data.values()]


def get_run(run_id: str) -> Optional[PipelineRun]:
    data = _load()
    if run_id in data:
        return PipelineRun(**data[run_id])
    return None


def save_run(run: PipelineRun):
    data = _load()
    data[run.id] = json.loads(run.model_dump_json())
    _save(data)


def update_run(run_id: str, **kwargs) -> Optional[PipelineRun]:
    run = get_run(run_id)
    if not run:
        return None
    updated = run.model_copy(update=kwargs)
    save_run(updated)
    return updated
