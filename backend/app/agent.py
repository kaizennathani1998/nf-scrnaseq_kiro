"""AI agent using Amazon Bedrock (Claude) with scRNASeq context."""
import json
import logging
from typing import List, Optional
from .aws_clients import bedrock_client, s3_client
from .config import settings
from .healthomics import list_output_files

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an expert single-cell RNA sequencing (scRNASeq) bioinformatics analyst.
You have access to the outputs of an nf-core/scrnaseq pipeline run on AWS HealthOmics.

Your capabilities:
- Interpret QC metrics (cell counts, UMI distributions, mitochondrial %, doublet scores)
- Explain alignment statistics from STARsolo, Simpleaf, Kallisto, or Cellranger
- Guide downstream analysis: clustering, UMAP, differential expression, cell type annotation
- Interpret MultiQC reports and AlevinQC reports
- Suggest appropriate Scanpy/Seurat workflows based on the data
- Describe what plots to generate and how to interpret them
- Identify potential issues (low quality cells, batch effects, contamination)

When discussing analysis steps, provide concrete code examples in Python (Scanpy) or R (Seurat).
Format responses with markdown for readability. Be concise but thorough.
"""


def _build_context(run_id: str, outputs_summary: Optional[str] = None) -> str:
    """Build context string about the run's outputs."""
    ctx = f"Pipeline Run ID: {run_id}\n"
    if outputs_summary:
        ctx += f"\nAvailable output files:\n{outputs_summary}\n"
    return ctx


def _extract_h5ad_summary(run_id: str, outdir_s3: str) -> str:
    """Try to read h5ad metadata from S3 for richer context."""
    try:
        files = list_output_files(run_id, outdir_s3)
        h5ad_files = [f for f in files if f["name"].endswith(".h5ad")]
        if not h5ad_files:
            return ""

        # Download the combined h5ad if available
        combined = next((f for f in h5ad_files if "combined" in f["name"]), h5ad_files[0])
        parts = combined["path"].replace("s3://", "").split("/", 1)
        bucket, key = parts[0], parts[1]

        import tempfile, anndata as ad
        with tempfile.NamedTemporaryFile(suffix=".h5ad") as tmp:
            s3_client().download_file(bucket, key, tmp.name)
            adata = ad.read_h5ad(tmp.name)
            summary = (
                f"AnnData shape: {adata.n_obs} cells × {adata.n_vars} genes\n"
                f"Observations (cell metadata): {list(adata.obs.columns)}\n"
                f"Variables (gene metadata): {list(adata.var.columns)}\n"
            )
            if "sample" in adata.obs.columns:
                counts = adata.obs["sample"].value_counts().to_dict()
                summary += f"Cells per sample: {counts}\n"
            return summary
    except Exception as e:
        logger.warning(f"Could not extract h5ad summary: {e}")
        return ""


def chat(
    run_id: str,
    message: str,
    history: List[dict],
    outdir_s3: Optional[str] = None,
) -> str:
    """Send a message to the Bedrock Claude model and return the response."""

    # Build context
    outputs_summary = ""
    h5ad_summary = ""
    if outdir_s3:
        try:
            files = list_output_files(run_id, outdir_s3)
            outputs_summary = "\n".join(
                f"- [{f['category']}] {f['name']} ({f['size']})" for f in files[:50]
            )
            h5ad_summary = _extract_h5ad_summary(run_id, outdir_s3)
        except Exception as e:
            logger.warning(f"Could not list outputs: {e}")

    context = _build_context(run_id, outputs_summary)
    if h5ad_summary:
        context += f"\nData summary:\n{h5ad_summary}"

    # Build messages for Bedrock Converse API
    messages = []

    # Inject context as first user message if no history
    if not history:
        messages.append({
            "role": "user",
            "content": [{"text": f"[Pipeline context]\n{context}"}],
        })
        messages.append({
            "role": "assistant",
            "content": [{"text": "I have the pipeline context. How can I help you analyze the results?"}],
        })

    # Add history
    for h in history:
        messages.append({
            "role": h["role"],
            "content": [{"text": h["content"]}],
        })

    # Add current message
    messages.append({
        "role": "user",
        "content": [{"text": message}],
    })

    resp = bedrock_client().converse(
        modelId=settings.bedrock_model_id,
        system=[{"text": SYSTEM_PROMPT}],
        messages=messages,
        inferenceConfig={
            "maxTokens": 2048,
            "temperature": 0.3,
        },
    )

    return resp["output"]["message"]["content"][0]["text"]
