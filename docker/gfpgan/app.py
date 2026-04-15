"""
FastAPI wrapper around GFPGAN for face restoration.
Falls back to returning the original image if the model is unavailable.
"""
import io
import os
import logging

import cv2
import numpy as np
from fastapi import FastAPI, File, UploadFile
from fastapi.responses import Response

logger = logging.getLogger("gfpgan-api")
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="GFPGAN Face Restoration API")

_restorer = None


def get_restorer():
    global _restorer
    if _restorer is not None:
        return _restorer
    try:
        from gfpgan import GFPGANer

        model_path = os.environ.get("MODEL_PATH", "GFPGANv1.4.pth")
        if not os.path.exists(model_path):
            logger.warning(
                "GFPGAN model not found at %s. Running in passthrough mode.", model_path
            )
            return None
        _restorer = GFPGANer(
            model_path=model_path,
            upscale=2,
            arch="clean",
            channel_multiplier=2,
        )
        logger.info("GFPGAN model loaded from %s", model_path)
        return _restorer
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to load GFPGAN: %s. Running in passthrough mode.", exc)
        return None


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": get_restorer() is not None}


@app.post("/restore")
async def restore(image: UploadFile = File(...)):
    data = await image.read()

    restorer = get_restorer()
    if restorer is None:
        # Passthrough — return original image unchanged
        return Response(content=data, media_type=image.content_type or "image/jpeg")

    try:
        arr = np.frombuffer(data, np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            return Response(content=data, media_type=image.content_type or "image/jpeg")

        _, _, restored = restorer.enhance(
            img, has_aligned=False, only_center_face=False, paste_back=True
        )

        _, buffer = cv2.imencode(".jpg", restored, [cv2.IMWRITE_JPEG_QUALITY, 95])
        return Response(content=buffer.tobytes(), media_type="image/jpeg")

    except Exception as exc:  # noqa: BLE001
        logger.error("Restoration failed: %s", exc)
        return Response(content=data, media_type=image.content_type or "image/jpeg")
