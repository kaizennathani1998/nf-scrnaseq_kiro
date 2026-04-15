"""AWS HealthOmics workflow management for nf-core/scrnaseq."""
import json
import logging
from typing import Optional
from .aws_clients import omics_client, s3_client
from .config import settings

logger = logging.getLogger(__name__)

# Map HealthOmics run status → our RunStatus
STATUS_MAP = {
    "PENDING":    "PENDING",
    "STARTING":   "RUNNING",
    "RUNNING":    "RUNNING",
    "STOPPING":   "RUNNING",
    "COMPLETED":  "COMPLETED",
    "FAILED":     "FAILED",
    "CANCELLED":  "CANCELLED",
    "DELETED":    "CANCELLED",
}

# Rough progress % per HealthOmics status
PROGRESS_MAP = {
    "PENDING":   5,
    "STARTING":  10,
    "RUNNING":   50,
    "STOPPING":  90,
    "COMPLETED": 100,
    "FAILED":    0,
    "CANCELLED": 0,
}


def start_workflow(
    run_id: str,
    samplesheet_s3: str,
    aligner: str,
    protocol: str,
    genome: str,
    outdir: str,
    skip_fastqc: bool = False,
    skip_cellbender: bool = False,
) -> str:
    """Submit nf-core/scrnaseq to AWS HealthOmics and return the HealthOmics run ID."""
    params = {
        "input":            samplesheet_s3,
        "outdir":           outdir,
        "aligner":          aligner,
        "protocol":         protocol,
        "genome":           genome,
        "skip_fastqc":      str(skip_fastqc).lower(),
        "skip_cellbender":  str(skip_cellbender).lower(),
    }

    resp = omics_client().start_run(
        workflowId=settings.healthomics_workflow_id,
        workflowType="READY2RUN",
        name=f"scrnaseq-{run_id}",
        roleArn=settings.healthomics_role_arn,
        parameters=params,
        outputUri=outdir,
        tags={"app": "scrnaseq-frontend", "run_id": run_id},
    )
    return resp["id"]


def get_run_status(healthomics_run_id: str) -> dict:
    """Return status and progress for a HealthOmics run."""
    resp = omics_client().get_run(id=healthomics_run_id)
    ho_status = resp.get("status", "PENDING")
    return {
        "status":   STATUS_MAP.get(ho_status, "PENDING"),
        "progress": PROGRESS_MAP.get(ho_status, 0),
        "raw":      ho_status,
    }


def cancel_run(healthomics_run_id: str):
    omics_client().cancel_run(id=healthomics_run_id)


def get_run_logs(healthomics_run_id: str) -> str:
    """Fetch task logs from HealthOmics (returns combined log text)."""
    try:
        tasks = omics_client().list_run_tasks(id=healthomics_run_id).get("items", [])
        lines = []
        for task in tasks[:20]:  # limit to first 20 tasks
            lines.append(f"=== Task: {task.get('name', task['taskId'])} [{task.get('status')}] ===")
            try:
                log_resp = omics_client().get_run_task(
                    id=healthomics_run_id, taskId=task["taskId"]
                )
                lines.append(log_resp.get("logStream", "No log stream"))
            except Exception:
                lines.append("(log unavailable)")
        return "\n".join(lines) if lines else "No tasks found yet."
    except Exception as e:
        return f"Could not retrieve logs: {e}"


def upload_file_to_s3(local_path: str, s3_key: str) -> str:
    """Upload a local file to S3 and return the s3:// URI."""
    s3_client().upload_file(local_path, settings.s3_bucket, s3_key)
    return f"s3://{settings.s3_bucket}/{s3_key}"


def upload_bytes_to_s3(data: bytes, s3_key: str, content_type: str = "application/octet-stream") -> str:
    s3_client().put_object(
        Bucket=settings.s3_bucket,
        Key=s3_key,
        Body=data,
        ContentType=content_type,
    )
    return f"s3://{settings.s3_bucket}/{s3_key}"


def list_output_files(run_id: str, outdir_s3: str) -> list:
    """List output files in S3 for a completed run."""
    # Parse bucket and prefix from s3://bucket/prefix
    parts = outdir_s3.replace("s3://", "").split("/", 1)
    bucket = parts[0]
    prefix = parts[1] if len(parts) > 1 else ""

    files = []
    paginator = s3_client().get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            name = key.split("/")[-1]
            size_bytes = obj["Size"]
            size_str = _human_size(size_bytes)
            category = _categorize(key)
            url = s3_client().generate_presigned_url(
                "get_object",
                Params={"Bucket": bucket, "Key": key},
                ExpiresIn=3600,
            )
            files.append({
                "name": name,
                "path": f"s3://{bucket}/{key}",
                "url": url,
                "size": size_str,
                "category": category,
            })
    return files


def _human_size(n: int) -> str:
    for unit in ["B", "KB", "MB", "GB"]:
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def _categorize(key: str) -> str:
    k = key.lower()
    if "multiqc" in k:       return "MultiQC"
    if "fastqc" in k:        return "FastQC"
    if ".h5ad" in k:         return "AnnData (h5ad)"
    if ".rds" in k:          return "Seurat (RDS)"
    if "cellbender" in k:    return "Cellbender"
    if "alevinqc" in k or "simpleaf" in k: return "Simpleaf/AlevinQC"
    if "star" in k:          return "STARsolo"
    if "kallisto" in k:      return "Kallisto"
    if "cellranger" in k:    return "Cellranger"
    if "pipeline_info" in k: return "Pipeline Info"
    return "Other"
