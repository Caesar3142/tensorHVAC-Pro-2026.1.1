/* ------------ Preferred file names ------------- */
export const BLOCK_CANDIDATES   = ["system/blockMeshDict"];
export const SNAPPY_CANDIDATES  = ["system/snappyHexMeshDict"];
export const FEATURE_CANDIDATES = ["system/surfaceFeatureExtractDict"];

/* ---------- local resolution mapping ---------- */
export const LOCAL_TO_LEVEL = {
  coarse: [1, 2],
  medium: [2, 3],
  fine:   [3, 4],
};

/* ---------- geometry checklist keys ---------- */
export const GEO_KEYS = [ "ceiling", "floor", "inlet", "object", "outlet", "wall", "wind" ];

/* WSL / tools */
export const TCFDPRE_PATH = '"C:\\tensorCFD\\tools\\tCFD-Pre-2026.1.1\\tCFD-Pre-2026.1.1.exe';
