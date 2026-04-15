from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # AWS
    aws_region: str = "us-east-1"
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_session_token: str = ""   # required for temporary ASIA* credentials

    # S3 bucket for FASTQ uploads and pipeline outputs
    s3_bucket: str = "my-scrnaseq-bucket"
    s3_prefix: str = "scrnaseq"

    # AWS HealthOmics
    healthomics_workflow_id: str = ""          # pre-registered nf-core/scrnaseq workflow
    healthomics_role_arn: str = ""             # IAM role for HealthOmics to access S3
    healthomics_output_uri: str = ""           # s3://bucket/healthomics-outputs/

    # Amazon Bedrock
    bedrock_model_id: str = "anthropic.claude-3-5-sonnet-20241022-v2:0"
    bedrock_region: str = "us-east-1"

    # App
    data_dir: str = "./data"                   # local run metadata store


settings = Settings()
