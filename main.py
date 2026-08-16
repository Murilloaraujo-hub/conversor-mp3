"""
Video2MP3 - Backend API
------------------------
API em FastAPI responsável por:
  1. Validar links de vídeo (YouTube e afins) e retornar metadados (POST /api/verify)
  2. Converter o áudio do vídeo para MP3 em diferentes qualidades (POST /api/convert)

Todas as respostas — inclusive erros 400/404/422/500 — são estritamente JSON.
Nunca retornamos páginas HTML de erro.
"""

import logging
import os
import re
import shutil
import tempfile
import uuid
from typing import Literal, Optional

from fastapi import BackgroundTasks, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field, field_validator
from starlette.exceptions import HTTPException as StarletteHTTPException

import yt_dlp

# --------------------------------------------------------------------------
# Configuração / Logging
# --------------------------------------------------------------------------

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("video2mp3")

APP_TITLE = "Video2MP3 API"
APP_VERSION = "1.0.0"

# Limite de duração do vídeo (segundos) para evitar abuso do serviço.
# 3h = 10800s. Ajuste conforme a capacidade do seu servidor.
MAX_DURATION_SECONDS = 3 * 60 * 60

# Pasta temporária base onde os downloads/conversões acontecem.
TMP_ROOT = os.path.join(tempfile.gettempdir(), "video2mp3")
os.makedirs(TMP_ROOT, exist_ok=True)

# Padrões de URL aceitos (YouTube). yt-dlp suporta outros sites, mas o
# escopo deste produto é focado em YouTube conforme especificado.
YOUTUBE_URL_REGEX = re.compile(
    r"^(https?://)?(www\.)?(youtube\.com/(watch\?v=|shorts/|live/)|youtu\.be/)[\w\-]+",
    re.IGNORECASE,
)

QUALITY_CHOICES = ("128", "192", "256", "320")

# --------------------------------------------------------------------------
# App
# --------------------------------------------------------------------------

app = FastAPI(title=APP_TITLE, version=APP_VERSION)

# --------------------------------------------------------------------------
# CORS
# Libera localhost (qualquer porta) e qualquer subdomínio *.github.io
# (ex.: https://seu-usuario.github.io)
# --------------------------------------------------------------------------

ALLOW_ORIGIN_REGEX = (
    r"^(https?://localhost(:\d+)?"
    r"|https?://127\.0\.0\.1(:\d+)?"
    r"|https://([a-zA-Z0-9\-]+\.)?github\.io)$"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_origin_regex=ALLOW_ORIGIN_REGEX,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------
# Exceção customizada de domínio
# --------------------------------------------------------------------------

class APIError(Exception):
    """Erro de negócio conhecido (ex.: URL inválida, vídeo indisponível)."""

    def __init__(self, message: str, status_code: int = 400):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


# --------------------------------------------------------------------------
# Handlers globais de exceção — garantem retorno 100% JSON
# --------------------------------------------------------------------------

@app.exception_handler(APIError)
async def api_error_handler(request: Request, exc: APIError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"success": False, "error": exc.message},
    )


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    # Cobre 404 (rota inexistente), 405, etc.
    detail = exc.detail if isinstance(exc.detail, str) else "Erro na requisição."
    return JSONResponse(
        status_code=exc.status_code,
        content={"success": False, "error": detail},
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "success": False,
            "error": "Dados inválidos na requisição.",
            "details": exc.errors(),
        },
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Erro não tratado: %s", exc)
    return JSONResponse(
        status_code=500,
        content={"success": False, "error": "Erro interno no servidor. Tente novamente."},
    )


# --------------------------------------------------------------------------
# Schemas (Pydantic)
# --------------------------------------------------------------------------

class VerifyRequest(BaseModel):
    url: str = Field(..., min_length=5, description="URL do vídeo do YouTube")

    @field_validator("url")
    @classmethod
    def validate_url_format(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("A URL não pode estar vazia.")
        return v


class ConvertRequest(BaseModel):
    url: str = Field(..., min_length=5)
    quality: Literal["128", "192", "256", "320"] = "192"

    @field_validator("url")
    @classmethod
    def validate_url_format(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("A URL não pode estar vazia.")
        return v


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def _ensure_youtube_url(url: str) -> None:
    if not YOUTUBE_URL_REGEX.match(url):
        raise APIError(
            "Informe um link válido do YouTube (youtube.com/watch?v=... ou youtu.be/...).",
            status_code=400,
        )


def _format_duration(seconds: Optional[int]) -> str:
    if not seconds:
        return "00:00"
    seconds = int(seconds)
    hours, remainder = divmod(seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def _sanitize_filename(name: str) -> str:
    name = re.sub(r"[^\w\s\-\.]", "", name, flags=re.UNICODE).strip()
    name = re.sub(r"\s+", "_", name)
    return name[:120] or "audio"


def _base_ydl_opts() -> dict:
    return {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "nocheckcertificate": True,
        "geo_bypass": True,
        "socket_timeout": 20,
    }


# --------------------------------------------------------------------------
# Endpoints
# --------------------------------------------------------------------------

@app.get("/")
async def root():
    return {"success": True, "service": APP_TITLE, "version": APP_VERSION, "status": "online"}


@app.get("/api/health")
async def health():
    return {"success": True, "status": "ok"}


@app.post("/api/verify")
async def verify_video(payload: VerifyRequest):
    url = payload.url
    _ensure_youtube_url(url)

    ydl_opts = _base_ydl_opts()
    ydl_opts["skip_download"] = True

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except yt_dlp.utils.DownloadError as exc:
        logger.warning("Falha ao verificar URL %s: %s", url, exc)
        raise APIError(
            "Não foi possível encontrar ou acessar esse vídeo. Verifique o link e tente novamente.",
            status_code=404,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Erro inesperado ao verificar URL %s: %s", url, exc)
        raise APIError("Não foi possível processar esse link.", status_code=400)

    if not info:
        raise APIError("Vídeo não encontrado.", status_code=404)

    duration_seconds = info.get("duration") or 0
    if duration_seconds and duration_seconds > MAX_DURATION_SECONDS:
        raise APIError(
            f"Este vídeo excede o limite de duração permitido "
            f"({MAX_DURATION_SECONDS // 3600}h).",
            status_code=400,
        )

    data = {
        "title": info.get("title") or "Título indisponível",
        "duration": duration_seconds,
        "duration_formatted": _format_duration(duration_seconds),
        "thumbnail": info.get("thumbnail"),
        "uploader": info.get("uploader") or info.get("channel") or "Desconhecido",
        "view_count": info.get("view_count"),
        "webpage_url": info.get("webpage_url") or url,
    }
    return {"success": True, "data": data}


@app.post("/api/convert")
async def convert_video(payload: ConvertRequest, background_tasks: BackgroundTasks):
    url = payload.url
    quality = payload.quality
    _ensure_youtube_url(url)

    job_id = uuid.uuid4().hex
    job_dir = os.path.join(TMP_ROOT, job_id)
    os.makedirs(job_dir, exist_ok=True)

    output_template = os.path.join(job_dir, "%(title).150s.%(ext)s")

    ydl_opts = _base_ydl_opts()
    ydl_opts.update(
        {
            "format": "bestaudio/best",
            "outtmpl": output_template,
            "postprocessors": [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "mp3",
                    "preferredquality": quality,
                }
            ],
        }
    )

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
    except yt_dlp.utils.DownloadError as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        logger.warning("Falha ao converter URL %s: %s", url, exc)
        raise APIError(
            "Não foi possível baixar/converter esse vídeo. Verifique o link e tente novamente.",
            status_code=400,
        )
    except Exception as exc:  # noqa: BLE001
        shutil.rmtree(job_dir, ignore_errors=True)
        logger.exception("Erro inesperado ao converter URL %s: %s", url, exc)
        raise APIError("Falha interna ao converter o áudio.", status_code=500)

    # Localiza o arquivo .mp3 gerado pelo pós-processador FFmpeg
    mp3_path = None
    for filename in os.listdir(job_dir):
        if filename.lower().endswith(".mp3"):
            mp3_path = os.path.join(job_dir, filename)
            break

    if not mp3_path or not os.path.isfile(mp3_path):
        shutil.rmtree(job_dir, ignore_errors=True)
        raise APIError("A conversão falhou: arquivo MP3 não foi gerado.", status_code=500)

    title = info.get("title") if isinstance(info, dict) else "audio"
    download_name = f"{_sanitize_filename(title or 'audio')}.mp3"

    # Remove a pasta temporária somente depois que a resposta for enviada.
    background_tasks.add_task(shutil.rmtree, job_dir, ignore_errors=True)

    return FileResponse(
        path=mp3_path,
        media_type="audio/mpeg",
        filename=download_name,
        background=background_tasks,
    )
