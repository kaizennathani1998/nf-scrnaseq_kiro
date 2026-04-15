from __future__ import annotations
from enum import Enum
from typing import Optional, List
from pydantic import BaseModel
from datetime import datetime


class RunStatus(str, Enum):
    PENDING   = "PENDING"
    RUNNING   = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED    = "FAILED"
    CANCELLED = "CANCELLED"


class SampleMeta(BaseModel):
    name: str
    expected_cells: Optional[int] = None


class PipelineRun(BaseModel):
    id: str
    name: str
    status: RunStatus = RunStatus.PENDING
    aligner: str = "simpleaf"
    protocol: str = "10XV3"
    genome: str = "GRCh38"
    outdir: str
    sample_count: int = 0
    progress: int = 0
    healthomics_run_id: Optional[str] = None
    samplesheet_s3: Optional[str] = None
    created_at: datetime = datetime.utcnow()
    finished_at: Optional[datetime] = None
    error_message: Optional[str] = None


class OutputFile(BaseModel):
    name: str
    path: str
    url: str
    size: str
    category: str


class RunOutputs(BaseModel):
    run_id: str
    files: List[OutputFile] = []
    qc_summary: dict = {}


class ChatRequest(BaseModel):
    message: str
    history: List[dict] = []


class ChatResponse(BaseModel):
    response: str
