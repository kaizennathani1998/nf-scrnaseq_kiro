# scRNASeq Pipeline Frontend

A full-stack web application for running **nf-core/scrnaseq** on **AWS HealthOmics** with an integrated **AI analysis agent** powered by Amazon Bedrock (Claude).

## Architecture

```
frontend/          React + Vite + Tailwind
backend/           FastAPI + boto3
  ├── AWS HealthOmics  — workflow execution
  ├── Amazon S3        — FASTQ storage & outputs
  └── Amazon Bedrock   — Claude AI agent
```

## Features

- Upload FASTQ files (drag & drop) and auto-generate samplesheet CSV
- Configure aligner (simpleaf, star, kallisto, cellranger), protocol, genome
- Submit pipeline to AWS HealthOmics with real-time status polling
- Browse output files (h5ad, MultiQC, FastQC, BAMs) with presigned S3 links
- AI chat agent (Claude via Bedrock) that reads your h5ad outputs and answers scRNASeq questions
- Suggested prompts for common analyses (QC, clustering, cell type annotation)

## Quick Start

### 1. Backend

```bash
cd backend
cp .env.example .env
# Fill in AWS credentials, S3 bucket, HealthOmics workflow ID, Bedrock model

pip install -r requirements.txt
python run.py
# → http://localhost:8000
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
# → http://localhost:3000
```

## AWS Setup

### Register nf-core/scrnaseq on HealthOmics

```bash
# Option A: Use a Ready2Run workflow (if available in your region)
aws omics list-workflows --type READY2RUN | grep scrnaseq

# Option B: Register as a private workflow
aws omics create-workflow \
  --name nf-core-scrnaseq \
  --engine NEXTFLOW \
  --definition-zip file://scrnaseq-workflow.zip \
  --main main.nf
```

### IAM Role for HealthOmics

The role needs:
- `s3:GetObject`, `s3:PutObject` on your S3 bucket
- `omics:*` for HealthOmics itself
- Trust policy for `omics.amazonaws.com`

### Bedrock Model Access

Enable `anthropic.claude-3-5-sonnet-20241022-v2:0` in the Bedrock console for your region.

## Environment Variables

| Variable | Description |
|---|---|
| `AWS_REGION` | AWS region |
| `S3_BUCKET` | S3 bucket for uploads & outputs |
| `HEALTHOMICS_WORKFLOW_ID` | HealthOmics workflow ID |
| `HEALTHOMICS_ROLE_ARN` | IAM role ARN for HealthOmics |
| `BEDROCK_MODEL_ID` | Bedrock model (default: Claude 3.5 Sonnet) |
