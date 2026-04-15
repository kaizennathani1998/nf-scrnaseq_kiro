"""Run management endpoints."""
import csv
import io
import os
import uuid
import tempfile
import logging
from datetime import datetime
from typing import List

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse

from ..models import PipelineRun, RunStatus, RunOutputs, OutputFile
from ..storage import list_runs, get_run, save_run, update_run
from ..config import settings
from .. import healthomics, agent

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/runs", tags=["runs"])


# ── List runs ─────────────────────────────────────────────────────────────────
@router.get("", response_model=List[PipelineRun])
def get_runs():
    return list_runs()


# ── Get single run ────────────────────────────────────────────────────────────
@router.get("/{run_id}", response_model=PipelineRun)
def get_run_detail(run_id: str):
    run = get_run(run_id)
    if not run:
        raise HTTPException(404, "Run not found")

    # Sync status from HealthOmics if running
    if run.healthomics_run_id and run.status in (RunStatus.RUNNING, RunStatus.PENDING):
        try:
            info = healthomics.get_run_status(run.healthomics_run_id)
            run = update_run(
                run_id,
                status=info["status"],
                progress=info["progress"],
                finished_at=datetime.utcnow() if info["status"] in ("COMPLETED", "FAILED") else None,
            )
        except Exception as e:
            logger.warning(f"Could not sync HealthOmics status: {e}")

    return run


# ── Create run ────────────────────────────────────────────────────────────────
@router.post("", response_model=PipelineRun)
async def create_run(
    background_tasks: BackgroundTasks,
    name: str = Form(...),
    aligner: str = Form("simpleaf"),
    protocol: str = Form("10XV3"),
    genome: str = Form("GRCh38"),
    outdir: str = Form(...),
    skip_fastqc: str = Form("false"),
    skip_cellbender: str = Form("false"),
    samples_meta: str = Form(...),
):
    import json
    run_id = str(uuid.uuid4())[:8]
    meta = json.loads(samples_meta)

    run = PipelineRun(
        id=run_id,
        name=name,
        aligner=aligner,
        protocol=protocol,
        genome=genome,
        outdir=outdir,
        sample_count=len(meta),
        status=RunStatus.PENDING,
        progress=0,
    )
    save_run(run)

    # Background: upload files + submit to HealthOmics
    background_tasks.add_task(
        _submit_pipeline,
        run_id=run_id,
        meta=meta,
        skip_fastqc=skip_fastqc.lower() == "true",
        skip_cellbender=skip_cellbender.lower() == "true",
    )

    return run


async def _submit_pipeline(run_id: str, meta: list, skip_fastqc: bool, skip_cellbender: bool):
    """Background task: build samplesheet, upload to S3, submit to HealthOmics."""
    run = get_run(run_id)
    if not run:
        return

    try:
        update_run(run_id, status=RunStatus.RUNNING, progress=5)

        # Build samplesheet CSV
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(["sample", "fastq_1", "fastq_2", "expected_cells"])
        for i, m in enumerate(meta):
            s3_prefix = f"{settings.s3_prefix}/{run_id}/fastq"
            r1_key = f"{s3_prefix}/{m['name']}_R1.fastq.gz"
            r2_key = f"{s3_prefix}/{m['name']}_R2.fastq.gz"
            writer.writerow([
                m["name"],
                f"s3://{settings.s3_bucket}/{r1_key}",
                f"s3://{settings.s3_bucket}/{r2_key}",
                m.get("expected_cells") or "",
            ])

        samplesheet_key = f"{settings.s3_prefix}/{run_id}/samplesheet.csv"
        samplesheet_s3 = healthomics.upload_bytes_to_s3(
            buf.getvalue().encode(),
            samplesheet_key,
            "text/csv",
        )
        update_run(run_id, samplesheet_s3=samplesheet_s3, progress=15)

        # Submit to HealthOmics
        if settings.healthomics_workflow_id:
            ho_run_id = healthomics.start_workflow(
                run_id=run_id,
                samplesheet_s3=samplesheet_s3,
                aligner=run.aligner,
                protocol=run.protocol,
                genome=run.genome,
                outdir=run.outdir,
                skip_fastqc=skip_fastqc,
                skip_cellbender=skip_cellbender,
            )
            update_run(run_id, healthomics_run_id=ho_run_id, progress=20)
        else:
            # Demo mode: simulate progress
            logger.warning("No HealthOmics workflow ID configured — running in demo mode")
            update_run(run_id, progress=20)

    except Exception as e:
        logger.error(f"Pipeline submission failed: {e}")
        update_run(run_id, status=RunStatus.FAILED, error_message=str(e))


# ── Cancel run ────────────────────────────────────────────────────────────────
@router.post("/{run_id}/cancel")
def cancel_run(run_id: str):
    run = get_run(run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    if run.healthomics_run_id:
        try:
            healthomics.cancel_run(run.healthomics_run_id)
        except Exception as e:
            logger.warning(f"HealthOmics cancel failed: {e}")
    update_run(run_id, status=RunStatus.CANCELLED)
    return {"ok": True}


# ── Logs ──────────────────────────────────────────────────────────────────────
@router.get("/{run_id}/logs")
def get_logs(run_id: str):
    run = get_run(run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    logs = ""
    if run.healthomics_run_id:
        logs = healthomics.get_run_logs(run.healthomics_run_id)
    else:
        logs = f"Run {run_id} — status: {run.status}\nNo HealthOmics run ID yet."
    return {"logs": logs}


# ── Outputs ───────────────────────────────────────────────────────────────────
@router.get("/{run_id}/outputs", response_model=RunOutputs)
def get_outputs(run_id: str):
    run = get_run(run_id)
    if not run:
        raise HTTPException(404, "Run not found")

    files = []
    qc_summary = {}

    if run.status == RunStatus.COMPLETED:
        try:
            raw = healthomics.list_output_files(run_id, run.outdir)
            files = [OutputFile(**f) for f in raw]
            qc_summary = _build_qc_summary(run_id, run.outdir)
        except Exception as e:
            logger.warning(f"Could not list outputs: {e}")

    return RunOutputs(run_id=run_id, files=files, qc_summary=qc_summary)


def _build_qc_summary(run_id: str, outdir_s3: str) -> dict:
    """Try to extract key QC numbers from h5ad."""
    try:
        from ..aws_clients import s3_client
        import anndata as ad
        files = healthomics.list_output_files(run_id, outdir_s3)
        combined = next((f for f in files if "combined_matrix.h5ad" in f["name"]), None)
        if not combined:
            return {}
        parts = combined["path"].replace("s3://", "").split("/", 1)
        bucket, key = parts[0], parts[1]
        with tempfile.NamedTemporaryFile(suffix=".h5ad") as tmp:
            s3_client().download_file(bucket, key, tmp.name)
            adata = ad.read_h5ad(tmp.name)
            return {
                "Total cells":  str(adata.n_obs),
                "Total genes":  str(adata.n_vars),
                "Samples":      str(adata.obs["sample"].nunique()) if "sample" in adata.obs else "—",
            }
    except Exception:
        return {}


# ── AI Chat ───────────────────────────────────────────────────────────────────
@router.post("/{run_id}/chat")
def chat_with_agent(run_id: str, body: dict):
    run = get_run(run_id)
    if not run:
        raise HTTPException(404, "Run not found")

    message = body.get("message", "")
    history = body.get("history", [])

    if not message:
        raise HTTPException(400, "message is required")

    try:
        response = agent.chat(
            run_id=run_id,
            message=message,
            history=history,
            outdir_s3=run.outdir if run.status == RunStatus.COMPLETED else None,
        )
        return {"response": response}
    except Exception as e:
        logger.error(f"Agent error: {e}")
        raise HTTPException(500, f"Agent error: {str(e)}")
