"""h5ad / 10x-h5 upload, QC report, AI plot agent."""
import io, os, uuid, base64, logging, re
from pathlib import Path
from typing import Optional, Tuple

import numpy as np
import pandas as pd
import anndata as ad
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns

from fastapi import APIRouter, UploadFile, File, HTTPException
from ..config import settings
from ..aws_clients import bedrock_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/analyze", tags=["analyze"])

_sessions: dict = {}
SESSIONS_DIR = Path(settings.data_dir) / "h5ad_sessions"
SESSIONS_DIR.mkdir(parents=True, exist_ok=True)


# ── Plot helpers ──────────────────────────────────────────────────────────────

def _fig_to_b64(fig) -> str:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=120, bbox_inches="tight", facecolor="#111827")
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode()


def _style(fig, axes=None):
    fig.patch.set_facecolor("#111827")
    axlist = axes if isinstance(axes, list) else ([axes] if axes else fig.get_axes())
    for ax in axlist:
        ax.set_facecolor("#1f2937")
        ax.tick_params(colors="#9ca3af")
        ax.xaxis.label.set_color("#d1d5db")
        ax.yaxis.label.set_color("#d1d5db")
        ax.title.set_color("#f9fafb")
        for sp in ax.spines.values():
            sp.set_edgecolor("#374151")


# ── QC computation ────────────────────────────────────────────────────────────

def _compute_qc(adata: ad.AnnData) -> dict:
    adata.obs["total_counts"] = np.asarray(adata.X.sum(axis=1)).flatten()
    adata.obs["n_genes_by_counts"] = np.asarray((adata.X > 0).sum(axis=1)).flatten()
    mito = adata.var_names.str.upper().str.startswith(("MT-", "MT."))
    adata.var["mt"] = mito
    mc = np.asarray(adata.X[:, mito].sum(axis=1)).flatten() if mito.sum() > 0 else np.zeros(adata.n_obs)
    adata.obs["pct_counts_mt"] = mc / adata.obs["total_counts"].clip(lower=1) * 100

    obs = adata.obs
    qc = {
        "n_cells":           int(adata.n_obs),
        "n_genes":           int(adata.n_vars),
        "median_counts":     float(obs["total_counts"].median()),
        "median_genes":      float(obs["n_genes_by_counts"].median()),
        "mean_pct_mt":       float(obs["pct_counts_mt"].mean()),
        "pct_cells_high_mt": float((obs["pct_counts_mt"] > 20).mean() * 100),
    }
    for col in ["sample", "batch", "condition"]:
        if col in obs.columns:
            qc["samples"] = obs[col].value_counts().to_dict()
            break
    return qc


def _data_summary(adata: ad.AnnData, qc: dict) -> str:
    lines = [
        f"Dataset: {qc['n_cells']} cells x {qc['n_genes']} genes",
        f"Median UMI/cell: {qc['median_counts']:.0f}",
        f"Median genes/cell: {qc['median_genes']:.0f}",
        f"Mean mito%: {qc['mean_pct_mt']:.1f}%",
        f"Cells >20% mito: {qc['pct_cells_high_mt']:.1f}%",
        f"obs columns: {list(adata.obs.columns)}",
        f"var columns: {list(adata.var.columns)}",
        f"obsm keys: {list(adata.obsm.keys())}",
    ]
    if "samples" in qc:
        lines.append(f"Cells per sample: {qc['samples']}")
    return "\n".join(lines)


# ── Initial QC plots (shown on upload) ───────────────────────────────────────

def _make_qc_plots(adata: ad.AnnData) -> list:
    plots = []
    obs = adata.obs
    C = "#6366f1"

    # 1. Violin trio
    fig, axes = plt.subplots(1, 3, figsize=(12, 4))
    fig.patch.set_facecolor("#111827")
    for ax, (col, lbl) in zip(axes, [
        ("total_counts", "Total UMI"), ("n_genes_by_counts", "Genes"), ("pct_counts_mt", "Mito %")
    ]):
        ax.set_facecolor("#1f2937")
        ax.tick_params(colors="#9ca3af")
        for sp in ax.spines.values(): sp.set_edgecolor("#374151")
        if col in obs.columns:
            p = ax.violinplot(obs[col].dropna(), showmedians=True)
            for pc in p["bodies"]: pc.set_facecolor(C); pc.set_alpha(0.7)
            p["cmedians"].set_color("#f9fafb")
        ax.set_title(lbl, color="#f9fafb", fontsize=10); ax.set_xticks([])
    fig.suptitle("QC Distributions", color="#f9fafb", fontsize=12)
    plots.append({"title": "QC Violin Plots", "image": _fig_to_b64(fig)})

    # 2. Scatter counts vs genes
    fig, ax = plt.subplots(figsize=(6, 5)); _style(fig, ax)
    sc = ax.scatter(obs["total_counts"], obs["n_genes_by_counts"],
                    c=obs["pct_counts_mt"], cmap="RdYlGn_r", s=2, alpha=0.5, rasterized=True)
    cb = fig.colorbar(sc, ax=ax); cb.set_label("Mito %", color="#9ca3af")
    plt.setp(cb.ax.yaxis.get_ticklabels(), color="#9ca3af")
    ax.set_xlabel("Total UMI"); ax.set_ylabel("Genes"); ax.set_title("Counts vs Genes")
    plots.append({"title": "Counts vs Genes", "image": _fig_to_b64(fig)})

    # 3. UMI histogram
    fig, ax = plt.subplots(figsize=(6, 4)); _style(fig, ax)
    ax.hist(obs["total_counts"], bins=60, color=C, alpha=0.8, edgecolor="none")
    ax.set_xlabel("UMI counts/cell"); ax.set_ylabel("Cells"); ax.set_title("UMI Distribution")
    plots.append({"title": "UMI Distribution", "image": _fig_to_b64(fig)})

    # 4. Mito histogram
    fig, ax = plt.subplots(figsize=(6, 4)); _style(fig, ax)
    ax.hist(obs["pct_counts_mt"], bins=50, color="#ef4444", alpha=0.8, edgecolor="none")
    ax.axvline(20, color="#fbbf24", linestyle="--", lw=1.5, label="20% threshold")
    ax.set_xlabel("Mito %"); ax.set_ylabel("Cells"); ax.set_title("Mitochondrial % Distribution")
    ax.legend(labelcolor="#d1d5db", facecolor="#1f2937", framealpha=0.3)
    plots.append({"title": "Mito % Distribution", "image": _fig_to_b64(fig)})

    # 5. Per-group bar
    gcol = next((c for c in ["sample", "batch", "condition"] if c in obs.columns), None)
    if gcol:
        cnts = obs[gcol].value_counts()
        fig, ax = plt.subplots(figsize=(max(5, len(cnts) * 0.8), 4)); _style(fig, ax)
        ax.bar(cnts.index, cnts.values, color=C, alpha=0.85)
        ax.set_xlabel(gcol.capitalize()); ax.set_ylabel("Cells"); ax.set_title(f"Cells per {gcol}")
        plt.xticks(rotation=45, ha="right", color="#9ca3af")
        plots.append({"title": f"Cells per {gcol}", "image": _fig_to_b64(fig)})

    # 6. Top 20 genes
    try:
        gm = np.asarray(adata.X.mean(axis=0)).flatten()
        ti = np.argsort(gm)[-20:][::-1]
        fig, ax = plt.subplots(figsize=(6, 5)); _style(fig, ax)
        ax.barh(range(20), gm[ti][::-1], color=C, alpha=0.85)
        ax.set_yticks(range(20)); ax.set_yticklabels(adata.var_names[ti][::-1], fontsize=8)
        ax.set_xlabel("Mean expression"); ax.set_title("Top 20 Expressed Genes")
        plots.append({"title": "Top Expressed Genes", "image": _fig_to_b64(fig)})
    except Exception:
        pass

    return plots


# ── 10x h5 loader ─────────────────────────────────────────────────────────────

def _load_file(path: str, original_name: str) -> ad.AnnData:
    if original_name.lower().endswith(".h5ad"):
        return ad.read_h5ad(path)
    import h5py, scipy.sparse as sp
    with h5py.File(path, "r") as f:
        keys = list(f.keys())
        # CellRanger v3+
        if "matrix" in keys:
            g = f["matrix"]
            data, indices, indptr = g["data"][:], g["indices"][:], g["indptr"][:]
            shape = tuple(g["shape"][:])
            barcodes = [b.decode() if isinstance(b, bytes) else b for b in g["barcodes"][:]]
            feat = g["features"]
            gnames = [x.decode() if isinstance(x, bytes) else x for x in feat["name"][:]]
            gids   = [x.decode() if isinstance(x, bytes) else x for x in feat["id"][:]]
            X = sp.csc_matrix((data, indices, indptr), shape=shape).T.tocsr()
            return ad.AnnData(X=X, obs=pd.DataFrame(index=barcodes),
                              var=pd.DataFrame({"gene_ids": gids}, index=gnames))
        # CellRanger v2
        if "gene_names" in keys or "genes" in keys:
            data, indices, indptr = f["data"][:], f["indices"][:], f["indptr"][:]
            shape = tuple(f["shape"][:])
            barcodes = [b.decode() if isinstance(b, bytes) else b for b in f["barcodes"][:]]
            gk = "gene_names" if "gene_names" in keys else "genes"
            gnames = [x.decode() if isinstance(x, bytes) else x for x in f[gk][:]]
            gids   = [x.decode() if isinstance(x, bytes) else x for x in f["gene_ids"][:]] if "gene_ids" in keys else gnames
            X = sp.csc_matrix((data, indices, indptr), shape=shape).T.tocsr()
            return ad.AnnData(X=X, obs=pd.DataFrame(index=barcodes),
                              var=pd.DataFrame({"gene_ids": gids}, index=gnames))
    raise ValueError(f"Unknown 10x HDF5 layout. Keys: {keys}")


# ── Upload endpoint ───────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    name = (file.filename or "").lower()
    if not (name.endswith(".h5ad") or name.endswith(".h5")):
        raise HTTPException(400, "Only .h5ad or .h5 files supported")

    sid = str(uuid.uuid4())[:10]
    ext = ".h5" if name.endswith(".h5") else ".h5ad"
    raw_path = SESSIONS_DIR / f"{sid}{ext}"
    raw_path.write_bytes(await file.read())

    try:
        adata = _load_file(str(raw_path), file.filename)
    except Exception as e:
        raw_path.unlink(missing_ok=True)
        raise HTTPException(422, f"Could not read file: {e}")

    qc = _compute_qc(adata)
    plots = _make_qc_plots(adata)
    summary = _data_summary(adata, qc)

    saved = SESSIONS_DIR / f"{sid}.h5ad"
    adata.write_h5ad(str(saved))

    _sessions[sid] = {"path": str(saved), "qc": qc, "summary": summary, "filename": file.filename}
    return {"session_id": sid, "filename": file.filename, "qc": qc, "plots": plots, "summary": summary}


@router.get("/{session_id}/qc")
def get_qc(session_id: str):
    sess = _sessions.get(session_id)
    if not sess:
        raise HTTPException(404, "Session not found — re-upload the file")
    return {"qc": sess["qc"], "summary": sess["summary"]}


# ── Plot generators ───────────────────────────────────────────────────────────

def _plot_mito(adata: ad.AnnData) -> Tuple[str, str]:
    fig, ax = plt.subplots(figsize=(6, 4)); _style(fig, ax)
    ax.hist(adata.obs["pct_counts_mt"], bins=50, color="#ef4444", alpha=0.8, edgecolor="none")
    ax.axvline(20, color="#fbbf24", linestyle="--", lw=1.5, label="20% threshold")
    ax.set_xlabel("Mitochondrial %"); ax.set_ylabel("Cells")
    ax.set_title("Mitochondrial % Distribution")
    ax.legend(labelcolor="#d1d5db", facecolor="#1f2937", framealpha=0.3)
    return _fig_to_b64(fig), "Mitochondrial % Distribution"


def _plot_violin(adata: ad.AnnData, col: str) -> Tuple[str, str]:
    fig, ax = plt.subplots(figsize=(5, 4)); _style(fig, ax)
    data = adata.obs[col].dropna() if col in adata.obs.columns else pd.Series([0])
    p = ax.violinplot(data, showmedians=True)
    for pc in p["bodies"]: pc.set_facecolor("#6366f1"); pc.set_alpha(0.7)
    p["cmedians"].set_color("#f9fafb")
    ax.set_title(col, color="#f9fafb"); ax.set_xticks([])
    return _fig_to_b64(fig), f"Violin: {col}"


def _plot_scatter(adata: ad.AnnData) -> Tuple[str, str]:
    obs = adata.obs
    fig, ax = plt.subplots(figsize=(6, 5)); _style(fig, ax)
    sc = ax.scatter(obs["total_counts"], obs["n_genes_by_counts"],
                    c=obs["pct_counts_mt"], cmap="RdYlGn_r", s=2, alpha=0.5, rasterized=True)
    cb = fig.colorbar(sc, ax=ax); cb.set_label("Mito %", color="#9ca3af")
    plt.setp(cb.ax.yaxis.get_ticklabels(), color="#9ca3af")
    ax.set_xlabel("Total UMI"); ax.set_ylabel("Genes"); ax.set_title("Counts vs Genes")
    return _fig_to_b64(fig), "Counts vs Genes scatter"


def _plot_top_genes(adata: ad.AnnData) -> Tuple[str, str]:
    gm = np.asarray(adata.X.mean(axis=0)).flatten()
    ti = np.argsort(gm)[-20:][::-1]
    fig, ax = plt.subplots(figsize=(6, 5)); _style(fig, ax)
    ax.barh(range(20), gm[ti][::-1], color="#6366f1", alpha=0.85)
    ax.set_yticks(range(20)); ax.set_yticklabels(adata.var_names[ti][::-1], fontsize=8)
    ax.set_xlabel("Mean expression"); ax.set_title("Top 20 Expressed Genes")
    return _fig_to_b64(fig), "Top 20 Expressed Genes"


def _plot_heatmap(adata: ad.AnnData) -> Tuple[str, str]:
    gm = np.asarray(adata.X.mean(axis=0)).flatten()
    ti = np.argsort(gm)[-30:]
    sub = adata[:, ti]
    mat = np.asarray(sub.X.todense() if hasattr(sub.X, "todense") else sub.X)
    if mat.shape[0] > 200:
        mat = mat[np.random.choice(mat.shape[0], 200, replace=False)]
    fig, ax = plt.subplots(figsize=(10, 6)); _style(fig, ax)
    sns.heatmap(mat.T, ax=ax, cmap="magma", xticklabels=False,
                yticklabels=sub.var_names, cbar_kws={"shrink": 0.5})
    ax.set_title("Top 30 Gene Heatmap (200 cells)", color="#f9fafb")
    ax.tick_params(axis="y", labelsize=7, colors="#9ca3af")
    return _fig_to_b64(fig), "Gene Expression Heatmap"


def _plot_embedding(adata: ad.AnnData, key: str, name: str, color: str) -> Tuple[str, str]:
    coords = adata.obsm[key][:, :2]
    fig, ax = plt.subplots(figsize=(7, 6)); _style(fig, ax)
    obs_col = adata.obs.get(color)
    if obs_col is not None and obs_col.dtype.name in ("category", "object"):
        cats = obs_col.astype("category")
        pal = plt.cm.tab20.colors
        for i, cat in enumerate(cats.cat.categories):
            mask = (cats == cat).values
            ax.scatter(coords[mask, 0], coords[mask, 1], s=3, alpha=0.6,
                       label=str(cat), color=pal[i % len(pal)], rasterized=True)
        ax.legend(markerscale=4, fontsize=7, framealpha=0.2,
                  labelcolor="#d1d5db", facecolor="#1f2937")
    elif obs_col is not None:
        sc = ax.scatter(coords[:, 0], coords[:, 1], c=obs_col.values,
                        cmap="viridis", s=3, alpha=0.6, rasterized=True)
        cb = fig.colorbar(sc, ax=ax); cb.set_label(color, color="#9ca3af")
        plt.setp(cb.ax.yaxis.get_ticklabels(), color="#9ca3af")
    else:
        ax.scatter(coords[:, 0], coords[:, 1], s=3, alpha=0.5, color="#6366f1", rasterized=True)
    ax.set_xlabel(f"{name}1"); ax.set_ylabel(f"{name}2")
    ax.set_title(f"{name} — {color}")
    return _fig_to_b64(fig), f"{name} coloured by {color}"


def _run_dim_reduction(adata: ad.AnnData) -> ad.AnnData:
    """PCA + t-SNE using sklearn only (no numba)."""
    from sklearn.decomposition import PCA
    from sklearn.manifold import TSNE
    X = np.asarray(adata.X.todense() if hasattr(adata.X, "todense") else adata.X).astype(float)
    totals = X.sum(axis=1, keepdims=True)
    X = np.log1p(X / np.where(totals == 0, 1, totals) * 1e4)
    top = np.argsort(X.var(axis=0))[-2000:]
    pca = PCA(n_components=min(50, len(top) - 1))
    Xp = pca.fit_transform(X[:, top])
    adata.obsm["X_pca"] = Xp
    n = min(adata.n_obs, 3000)
    idx = np.random.choice(adata.n_obs, n, replace=False) if adata.n_obs > n else np.arange(adata.n_obs)
    coords = TSNE(n_components=2, random_state=42, perplexity=min(30, n - 1)).fit_transform(Xp[idx])
    out = adata[idx].copy()
    out.obsm["X_umap"] = coords
    return out


# ── Intent detection + dispatch ───────────────────────────────────────────────

def _detect_color(msg: str, adata: ad.AnnData) -> str:
    """Pick the best obs column to colour by based on message keywords."""
    msg_l = msg.lower()
    # Explicit column name in message
    for col in adata.obs.columns:
        if col.lower() in msg_l:
            return col
    # Common keywords
    for kw, col in [
        ("tissue", "tissue"), ("cell type", "cell_type"), ("celltype", "cell_type"),
        ("cluster", "leiden"), ("leiden", "leiden"), ("louvain", "louvain"),
        ("sample", "sample"), ("batch", "batch"), ("condition", "condition"),
        ("mito", "pct_counts_mt"), ("umi", "total_counts"), ("gene", "n_genes_by_counts"),
    ]:
        if kw in msg_l and col in adata.obs.columns:
            return col
    # Fallback priority
    for c in ["leiden", "louvain", "cell_type", "tissue", "sample", "batch", "condition"]:
        if c in adata.obs.columns:
            return c
    return adata.obs.columns[0] if len(adata.obs.columns) > 0 else "total_counts"


def _detect_metric(msg: str, adata: ad.AnnData) -> str:
    msg_l = msg.lower()
    if "mito" in msg_l: return "pct_counts_mt"
    if "gene" in msg_l: return "n_genes_by_counts"
    return "total_counts"


def _parse_gene_threshold(msg: str) -> Optional[int]:
    """Extract number from 'fewer than 200 genes' style phrases."""
    m = re.search(r"(\d+)\s*gene", msg.lower())
    return int(m.group(1)) if m else None


def _parse_count_threshold(msg: str) -> Optional[int]:
    m = re.search(r"(\d+)\s*(umi|count|read)", msg.lower())
    return int(m.group(1)) if m else None


def _parse_mito_threshold(msg: str) -> Optional[float]:
    m = re.search(r"(\d+(?:\.\d+)?)\s*%?\s*mito", msg.lower())
    return float(m.group(1)) if m else None


def _try_generate_plot(h5ad_path: str, message: str) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """
    Returns (plot_b64, plot_title, action_message).
    action_message is set when a filter/save was performed.
    """
    msg = message.lower()
    adata = ad.read_h5ad(h5ad_path)
    _compute_qc(adata)

    # ── Filter operations ─────────────────────────────────────────────────────
    if any(k in msg for k in ["filter", "remove", "keep only", "fewer than", "less than", "more than", "greater than"]):
        before = adata.n_obs
        mask = np.ones(adata.n_obs, dtype=bool)

        gene_thresh = _parse_gene_threshold(msg)
        if gene_thresh:
            if any(k in msg for k in ["fewer", "less", "below", "<"]):
                mask &= adata.obs["n_genes_by_counts"].values >= gene_thresh
            else:
                mask &= adata.obs["n_genes_by_counts"].values <= gene_thresh

        count_thresh = _parse_count_threshold(msg)
        if count_thresh:
            if any(k in msg for k in ["fewer", "less", "below", "<"]):
                mask &= adata.obs["total_counts"].values >= count_thresh
            else:
                mask &= adata.obs["total_counts"].values <= count_thresh

        mito_thresh = _parse_mito_threshold(msg)
        if mito_thresh:
            mask &= adata.obs["pct_counts_mt"].values <= mito_thresh

        filtered = adata[mask].copy()
        removed = before - filtered.n_obs

        # Save filtered back to session path
        filtered.write_h5ad(h5ad_path)

        # Plot the result
        fig, axes = plt.subplots(1, 2, figsize=(10, 4))
        fig.patch.set_facecolor("#111827")
        for ax, (col, lbl) in zip(axes, [("total_counts", "UMI"), ("n_genes_by_counts", "Genes")]):
            ax.set_facecolor("#1f2937")
            ax.tick_params(colors="#9ca3af")
            for sp in ax.spines.values(): sp.set_edgecolor("#374151")
            ax.hist(filtered.obs[col], bins=50, color="#6366f1", alpha=0.8, edgecolor="none")
            ax.set_title(f"{lbl} after filter", color="#f9fafb")
            ax.set_xlabel(lbl, color="#d1d5db"); ax.set_ylabel("Cells", color="#d1d5db")
        fig.suptitle(f"After filtering: {filtered.n_obs} cells (removed {removed})", color="#f9fafb")
        b64 = _fig_to_b64(fig)
        action = f"Filtered dataset: {before} → {filtered.n_obs} cells ({removed} removed). File saved."
        return b64, f"Post-filter QC ({filtered.n_obs} cells)", action

    # ── UMAP / t-SNE ─────────────────────────────────────────────────────────
    if any(k in msg for k in ["umap", "tsne", "t-sne", "embedding", "dimensionality"]):
        if "X_umap" in adata.obsm:
            color = _detect_color(msg, adata)
            b64, title = _plot_embedding(adata, "X_umap", "UMAP", color)
        else:
            reduced = _run_dim_reduction(adata)
            color = _detect_color(msg, reduced)
            b64, title = _plot_embedding(reduced, "X_umap", "t-SNE", color)
        return b64, title, None

    # ── PCA ───────────────────────────────────────────────────────────────────
    if "pca" in msg:
        if "X_pca" not in adata.obsm:
            from sklearn.decomposition import PCA
            X = np.asarray(adata.X.todense() if hasattr(adata.X, "todense") else adata.X).astype(float)
            totals = X.sum(axis=1, keepdims=True)
            X = np.log1p(X / np.where(totals == 0, 1, totals) * 1e4)
            adata.obsm["X_pca"] = PCA(n_components=min(50, X.shape[1] - 1)).fit_transform(X)
        color = _detect_color(msg, adata)
        b64, title = _plot_embedding(adata, "X_pca", "PCA", color)
        return b64, title, None

    # ── Mito ──────────────────────────────────────────────────────────────────
    if "mito" in msg:
        b64, title = _plot_mito(adata)
        return b64, title, None

    # ── Violin ────────────────────────────────────────────────────────────────
    if "violin" in msg:
        col = _detect_metric(msg, adata)
        b64, title = _plot_violin(adata, col)
        return b64, title, None

    # ── Scatter ───────────────────────────────────────────────────────────────
    if "scatter" in msg or ("count" in msg and "gene" in msg):
        b64, title = _plot_scatter(adata)
        return b64, title, None

    # ── Top / highly expressed genes ──────────────────────────────────────────
    if any(k in msg for k in ["top gene", "highly expressed", "variable gene", "hvg"]):
        b64, title = _plot_top_genes(adata)
        return b64, title, None

    # ── Heatmap ───────────────────────────────────────────────────────────────
    if "heatmap" in msg:
        b64, title = _plot_heatmap(adata)
        return b64, title, None

    # ── Distribution / histogram ──────────────────────────────────────────────
    if any(k in msg for k in ["distribution", "histogram", "hist"]):
        col = _detect_metric(msg, adata)
        b64, title = _plot_violin(adata, col)
        return b64, title, None

    return None, None, None


# ── Chat endpoint ─────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are an expert scRNASeq bioinformatics analyst. You have access to an AnnData dataset.

Your capabilities:
- QC filtering (UMI thresholds, mito %, doublet detection)
- Dimensionality reduction: PCA, UMAP/t-SNE
- Clustering: Leiden, Louvain
- Differential expression: Wilcoxon, DESeq2
- Cell type annotation: marker genes, SingleR, CellTypist
- Trajectory analysis, batch correction

When a plot was generated, describe what it shows and how to interpret it.
When suggesting code, use Scanpy (Python). Be concise and use markdown formatting.
Proactively flag QC issues you notice in the dataset context."""


@router.post("/{session_id}/chat")
def chat(session_id: str, body: dict):
    sess = _sessions.get(session_id)
    if not sess:
        raise HTTPException(404, "Session not found — please re-upload the file")

    message = body.get("message", "").strip()
    history = body.get("history", [])
    if not message:
        raise HTTPException(400, "message required")

    # Generate plot / perform action
    plot_b64, plot_title, action_msg = None, None, None
    try:
        plot_b64, plot_title, action_msg = _try_generate_plot(sess["path"], message)
        # Refresh QC summary if dataset was filtered
        if action_msg:
            adata = ad.read_h5ad(sess["path"])
            qc = _compute_qc(adata)
            sess["qc"] = qc
            sess["summary"] = _data_summary(adata, qc)
    except Exception as e:
        logger.error(f"Plot/action error: {e}", exc_info=True)

    # Build Bedrock message list — must alternate user/assistant strictly
    context = f"[Dataset]\n{sess['summary']}\nFile: {sess['filename']}"
    bedrock_msgs = [
        {"role": "user",      "content": [{"text": context}]},
        {"role": "assistant", "content": [{"text": "Dataset loaded. Ready to help!"}]},
    ]

    # Replay history (skip the synthetic greeting pair)
    for h in history:
        role = h.get("role", "user")
        content = h.get("content", "")
        if not content:
            continue
        # Ensure alternating roles — skip if same as last
        if bedrock_msgs and bedrock_msgs[-1]["role"] == role:
            continue
        bedrock_msgs.append({"role": role, "content": [{"text": content}]})

    # Ensure last message before ours is assistant
    if bedrock_msgs[-1]["role"] == "user":
        bedrock_msgs.append({"role": "assistant", "content": [{"text": "Understood."}]})

    # Build user message with plot/action context
    user_text = message
    if action_msg:
        user_text += f"\n\n[Action performed: {action_msg}]"
    if plot_b64:
        user_text += f"\n[Plot generated: '{plot_title}' — describe it to the user.]"

    bedrock_msgs.append({"role": "user", "content": [{"text": user_text}]})

    try:
        resp = bedrock_client().converse(
            modelId=settings.bedrock_model_id,
            system=[{"text": SYSTEM_PROMPT}],
            messages=bedrock_msgs,
            inferenceConfig={"maxTokens": 1024, "temperature": 0.3},
        )
        text = resp["output"]["message"]["content"][0]["text"]
    except Exception as e:
        logger.error(f"Bedrock error: {e}", exc_info=True)
        # Return a useful response even if Bedrock fails
        if plot_b64:
            text = f"Plot generated: **{plot_title}**."
            if action_msg:
                text += f"\n\n{action_msg}"
        elif action_msg:
            text = action_msg
        else:
            text = f"I encountered an error calling the AI model: {str(e)[:200]}"

    return {"response": text, "plot": plot_b64, "plot_title": plot_title}
