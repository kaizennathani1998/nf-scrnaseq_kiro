"""HealthOmics status endpoint."""
from fastapi import APIRouter
from ..aws_clients import omics_client
from ..config import settings

router = APIRouter(prefix="/healthomics", tags=["healthomics"])


@router.get("/status")
def get_status():
    """Check HealthOmics connectivity and workflow registration."""
    result = {
        "configured": bool(settings.healthomics_workflow_id),
        "workflow_id": settings.healthomics_workflow_id or None,
        "region": settings.aws_region,
        "s3_bucket": settings.s3_bucket,
    }
    if settings.healthomics_workflow_id:
        try:
            wf = omics_client().get_workflow(id=settings.healthomics_workflow_id)
            result["workflow_name"] = wf.get("name")
            result["workflow_status"] = wf.get("status")
        except Exception as e:
            result["error"] = str(e)
    return result
