"""FastAPI application entry point."""
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routes.runs import router as runs_router
from .routes.healthomics_routes import router as ho_router
from .routes.analyze import router as analyze_router

logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="scRNASeq Pipeline API",
    description="Backend for nf-core/scrnaseq on AWS HealthOmics with AI analysis",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(runs_router, prefix="/api")
app.include_router(ho_router, prefix="/api")
app.include_router(analyze_router, prefix="/api")


@app.get("/api/health")
def health():
    return {"status": "ok"}
