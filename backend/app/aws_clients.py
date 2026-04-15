"""Lazy AWS client factory."""
import boto3
from functools import lru_cache
from .config import settings


def _session():
    # Prefer default AWS profile (aws configure) over hardcoded keys
    if settings.aws_access_key_id:
        kwargs = {
            "region_name": settings.aws_region,
            "aws_access_key_id": settings.aws_access_key_id,
            "aws_secret_access_key": settings.aws_secret_access_key,
        }
        if settings.aws_session_token:
            kwargs["aws_session_token"] = settings.aws_session_token
        return boto3.Session(**kwargs)
    # Fall back to default profile / instance role
    return boto3.Session(region_name=settings.aws_region)


@lru_cache(maxsize=1)
def s3_client():
    return _session().client("s3")


@lru_cache(maxsize=1)
def omics_client():
    return _session().client("omics", region_name=settings.aws_region)


@lru_cache(maxsize=1)
def bedrock_client():
    return _session().client("bedrock-runtime", region_name=settings.bedrock_region)
