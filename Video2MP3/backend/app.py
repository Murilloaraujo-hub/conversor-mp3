"""
Video2MP3 - Backend Flask
Converte vídeos em MP3 a partir de URLs (incluindo YouTube).
Usa yt-dlp para obter informações e áudio, FFmpeg para conversão.
"""

import os
import re
import uuid
import time
import logging
import tempfile
import shutil
import subprocess
import threading
import ipaddress
from urllib.parse import urlparse, parse_qs
from functools import wraps

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS

# ──────────────────────────────────────────────────────────────
# Configuração
# ──────────────────────────────────────────────────────────────

app = Flask(__name__)

FRONTEND_URL = os.environ.get("FRONTEND_URL", "*")
CORS(app, origins=[FRONTEND_URL] if FRONTEND_URL != "*" else "*")

MAX_DURATION_SECONDS = int(os.environ.get("MAX_DURATION_SECONDS", "3600"))
MAX_FILE_SIZE_MB = int(os.environ.get("MAX_FILE_SIZE_MB", "500"))
MAX_CONCURRENT_JOBS = int(os.environ.get("MAX_CONCURRENT_JOBS", "2"))
RATE_LIMIT = int(os.environ.get("RATE_LIMIT", "10"))
CONVERSION_TIMEOUT_SECONDS = int(os.environ.get("CONVERSION_TIMEOUT_SECONDS", "300"))

VALID_QUALITIES = {128, 192, 256, 320}
DEFAULT_QUALITY = 192

# ──────────────────────────────────────────────────────────────
# Logging
# ──────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("video2mp3")

# ──────────────────────────────────────────────────────────────
# Concorrência
# ──────────────────────────────────────────────────────────────

job_semaphore = threading.Semaphore(MAX_CONCURRENT_JOBS)

# ──────────────────────────────────────────────────────────────
# Rate Limiting (em memória)
# ──────────────────────────────────────────────────────────────

rate_limit_store: dict[str, list[float]] = {}
rate_limit_lock = threading.Lock()


def get_client_ip() -> str:
    """Obtém o IP do cliente considerando proxies."""
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("X-Real-Ip", "")
    if real_ip:
        return real_ip.strip()
    return request.remote_addr or "unknown"


def check_rate_limit() -> bool:
    """Retorna True se dentro do limite, False se excedeu."""
    ip = get_client_ip()
    now = time.time()
    window = 60.0  # 1 minuto

    with rate_limit_lock:
        if ip not in rate_limit_store:
            rate_limit_store[ip] = []

        # Remove entradas fora da janela
        rate_limit_store[ip] = [t for t in rate_limit_store[ip] if now - t < window]

        if len(rate_limit_store[ip]) >= RATE_LIMIT:
            return False

        rate_limit_store[ip].append(now)
        return True


def rate_limited(f):
    """Decorator de rate limiting."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not check_rate_limit():
            return jsonify({
                "success": False,
                "error": "Muitas requisições. Tente novamente em alguns instantes."
            }), 429
        return f(*args, **kwargs)
    return decorated

# ──────────────────────────────────────────────────────────────
# Validação de URL / SSRF
# ──────────────────────────────────────────────────────────────

BLOCKED_SCHEMES = {"file", "javascript", "data", "ftp", "gopher"}

YOUTUBE_DOMAINS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "youtu.be",
    "music.youtube.com",
}

# Padrões de URL de vídeo direto
DIRECT_VIDEO_EXTENSIONS = {
    ".mp4", ".webm", ".mkv", ".avi", ".mov", ".flv",
    ".wav", ".flac", ".ogg", ".aac", ".m4a", ".wma",
    ".mp3", ".opus",
}


def is_private_ip(hostname: str) -> bool:
    """Verifica se o hostname resolve para IP privado."""
    try:
        addr = ipaddress.ip_address(hostname)
        return (
            addr.is_private
            or addr.is_loopback
            or addr.is_link_local
            or addr.is_reserved
            or addr.is_multicast
        )
    except ValueError:
        # Não é IP, é hostname - precisa resolver
        pass

    # Tentar resolver DNS
    import socket
    try:
        results = socket.getaddrinfo(hostname, None)
        for result in results:
            addr_str = result[4][0]
            try:
                addr = ipaddress.ip_address(addr_str)
                if (
                    addr.is_private
                    or addr.is_loopback
                    or addr.is_link_local
                    or addr.is_reserved
                    or addr.is_multicast
                ):
                    return True
            except ValueError:
                continue
    except socket.gaierror:
        pass

    return False


def validate_url(url: str) -> tuple[bool, str]:
    """
    Valida URL contra SSRF e formatos inválidos.
    Retorna (is_valid, error_message).
    """
    if not url or not isinstance(url, str):
        return False, "URL não fornecida."

    url = url.strip()

    if len(url) > 2048:
        return False, "URL muito longa."

    # Bloquear esquemas perigosos
    try:
        parsed = urlparse(url)
    except Exception:
        return False, "URL malformada."

    scheme = (parsed.scheme or "").lower()
    if not scheme:
        return False, "URL deve começar com http:// ou https://"

    if scheme in BLOCKED_SCHEMES:
        return False, f"Esquema '{scheme}' não é permitido."

    if scheme not in ("http", "https"):
        return False, "Apenas URLs HTTP/HTTPS são aceitas."

    hostname = (parsed.hostname or "").lower()
    if not hostname:
        return False, "URL sem hostname válido."

    # Bloquear IPs privados e localhost
    blocked_hostnames = {"localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"}
    if hostname in blocked_hostnames:
        return False, "Endereço não permitido."

    if is_private_ip(hostname):
        return False, "Endereço não permitido."

    return True, ""


def identify_source(url: str) -> str:
    """Identifica a origem da URL."""
    try:
        parsed = urlparse(url)
        hostname = (parsed.hostname or "").lower()
    except Exception:
        return "unknown"

    if hostname in YOUTUBE_DOMAINS:
        return "youtube"

    return "direct"


def is_youtube_url(url: str) -> bool:
    """Verifica se é uma URL do YouTube."""
    return identify_source(url) == "youtube"


def extract_youtube_video_id(url: str) -> str | None:
    """
    Extrai o ID do vídeo de uma URL do YouTube.

    Suporta múltiplos formatos e parâmetros adicionais:
      - https://www.youtube.com/watch?v=VIDEO_ID
      - https://www.youtube.com/watch?v=VIDEO_ID&start_radio=1
      - https://www.youtube.com/watch?v=VIDEO_ID&list=RDXYZ&start_radio=1
      - https://youtu.be/VIDEO_ID
      - https://www.youtube.com/shorts/VIDEO_ID
      - https://www.youtube.com/live/VIDEO_ID
      - https://www.youtube.com/embed/VIDEO_ID
      - https://m.youtube.com/watch?v=VIDEO_ID

    Parâmetros extras (start_radio, list, index, si, feature, pp, t,
    start, end, rv) NÃO impedem a extração do ID via `v=`.
    Retorna None se não conseguir identificar o ID.
    """
    try:
        parsed = urlparse(url)
        hostname = (parsed.hostname or "").lower()
    except Exception:
        return None

    # youtu.be/VIDEO_ID ou youtu.be/VIDEO_ID?t=...
    if hostname == "youtu.be":
        path = (parsed.path or "").strip("/")
        if path:
            video_id = path.split("/")[0].split("?")[0]
            if video_id:
                return video_id
        return None

    # Demais domínios YouTube: youtube.com, www.youtube.com,
    # m.youtube.com, music.youtube.com
    path = (parsed.path or "").strip("/")
    query = parse_qs(parsed.query)

    # 1) Prioridade máxima: parâmetro v=VIDEO_ID
    if "v" in query:
        video_id = query["v"][0]
        if video_id:
            return video_id

    # 2) Formatos de caminho: /shorts/ID, /live/ID, /embed/ID
    for prefix in ("shorts/", "live/", "embed/"):
        if path.startswith(prefix):
            video_id = path[len(prefix):].split("/")[0]
            if video_id:
                return video_id

    return None


def normalize_youtube_url(url: str) -> str:
    """
    Normaliza uma URL do YouTube para uma URL limpa contendo APENAS o vídeo.

    Isto garante que parâmetros como start_radio, list, rv, etc. sejam
    ignorados e que a playlist/rádio NÃO seja processada. Apenas o vídeo
    indicado por v=VIDEO_ID (ou pelo caminho /shorts/ /live/) é processado.

    Se não for possível extrair o ID, retorna a URL original.
    """
    video_id = extract_youtube_video_id(url)
    if video_id:
        return f"https://www.youtube.com/watch?v={video_id}"
    return url

# ──────────────────────────────────────────────────────────────
# Sanitização de nomes de arquivo
# ──────────────────────────────────────────────────────────────

def sanitize_filename(name: str) -> str:
    """Remove caracteres perigosos do nome do arquivo."""
    if not name:
        return "video2mp3"

    # Remover caracteres perigosos
    safe = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", name)
    # Remover path traversal
    safe = safe.replace("..", "").replace("/", "").replace("\\", "")
    # Remover espaços extras
    safe = safe.strip().strip(".")
    # Limitar tamanho
    if len(safe) > 150:
        safe = safe[:150]
    # Fallback
    if not safe:
        safe = "video2mp3"

    return safe

# ──────────────────────────────────────────────────────────────
# yt-dlp helpers
# ──────────────────────────────────────────────────────────────

def get_video_info(url: str) -> dict:
    """Obtém informações do vídeo usando yt-dlp."""
    import yt_dlp

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "skip_download": True,
        "socket_timeout": 30,
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)

    if not info:
        raise ValueError("Não foi possível obter informações do vídeo.")

    return info


def download_and_convert(url: str, quality: int, output_dir: str) -> tuple[str, str]:
    """
    Baixa o áudio e converte para MP3 usando yt-dlp + FFmpeg.
    Retorna (caminho_mp3, titulo).
    """
    import yt_dlp

    job_id = str(uuid.uuid4())
    output_template = os.path.join(output_dir, f"{job_id}.%(ext)s")

    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": output_template,
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "socket_timeout": 30,
        "max_filesize": MAX_FILE_SIZE_MB * 1024 * 1024,
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": str(quality),
        }],
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)

    if not info:
        raise ValueError("Falha ao processar o vídeo.")

    title = info.get("title", "video2mp3")

    # Encontrar o arquivo MP3 gerado
    mp3_path = os.path.join(output_dir, f"{job_id}.mp3")
    if not os.path.exists(mp3_path):
        # Procurar qualquer arquivo MP3 no diretório
        for f in os.listdir(output_dir):
            if f.endswith(".mp3"):
                mp3_path = os.path.join(output_dir, f)
                break

    if not os.path.exists(mp3_path):
        raise ValueError("Arquivo MP3 não foi gerado.")

    return mp3_path, title

# ──────────────────────────────────────────────────────────────
# Endpoints
# ──────────────────────────────────────────────────────────────

@app.route("/api/health", methods=["GET"])
def health():
    """Health check."""
    return jsonify({"status": "ok"})


@app.route("/api/info", methods=["POST"])
@rate_limited
def info():
    """Obtém informações do vídeo a partir da URL."""
    try:
        data = request.get_json(silent=True)
        if not data or "url" not in data:
            return jsonify({
                "success": False,
                "error": "URL não fornecida."
            }), 400

        url = data["url"].strip()

        # Validar URL (SSRF, esquema, hostname)
        is_valid, error_msg = validate_url(url)
        if not is_valid:
            return jsonify({
                "success": False,
                "error": error_msg
            }), 400

        source = identify_source(url)

        # Normalizar URL do YouTube: extrai o vídeo pelo parâmetro v=
        # (ignora start_radio, list, rv, etc. e processa só o vídeo)
        if source == "youtube":
            normalized = normalize_youtube_url(url)
            if normalized != url:
                logger.info(f"URL do YouTube normalizada: {url[:80]}... -> {normalized}")
                url = normalized

        logger.info(f"Obtendo informações: {url[:80]}... (source={source})")

        # Obter informações via yt-dlp
        try:
            video_info = get_video_info(url)
        except Exception as e:
            error_str = str(e)
            logger.warning(f"Erro ao obter informações: {error_str[:200]}")

            if "private" in error_str.lower():
                return jsonify({
                    "success": False,
                    "error": "Este vídeo é privado e não pode ser acessado."
                }), 400
            if "unavailable" in error_str.lower() or "not available" in error_str.lower():
                return jsonify({
                    "success": False,
                    "error": "Este vídeo não está disponível."
                }), 400
            if "sign in" in error_str.lower() or "login" in error_str.lower():
                return jsonify({
                    "success": False,
                    "error": "Este conteúdo requer autenticação e não pode ser acessado."
                }), 400

            return jsonify({
                "success": False,
                "error": "Não foi possível obter informações do vídeo. Verifique se o link é válido e o conteúdo é público."
            }), 400

        # Verificar duração
        duration = video_info.get("duration")
        if duration and duration > MAX_DURATION_SECONDS:
            return jsonify({
                "success": False,
                "error": f"Vídeo muito longo ({duration}s). Limite: {MAX_DURATION_SECONDS}s."
            }), 400

        # Construir resposta
        result = {
            "success": True,
            "source": source,
        }

        title = video_info.get("title")
        if title:
            result["title"] = title

        uploader = video_info.get("uploader") or video_info.get("channel")
        if uploader:
            result["uploader"] = uploader

        if duration is not None:
            result["duration"] = int(duration)

        thumbnail = video_info.get("thumbnail")
        if thumbnail:
            result["thumbnail"] = thumbnail

        return jsonify(result)

    except Exception as e:
        logger.error(f"Erro inesperado em /api/info: {e}")
        return jsonify({
            "success": False,
            "error": "Erro interno ao processar a requisição."
        }), 500


@app.route("/api/convert", methods=["POST"])
@rate_limited
def convert():
    """Converte vídeo para MP3."""
    temp_dir = None

    try:
        data = request.get_json(silent=True)
        if not data or "url" not in data:
            return jsonify({
                "success": False,
                "error": "URL não fornecida."
            }), 400

        url = data["url"].strip()
        quality = data.get("quality", DEFAULT_QUALITY)

        # Validar URL (SSRF, esquema, hostname)
        is_valid, error_msg = validate_url(url)
        if not is_valid:
            return jsonify({
                "success": False,
                "error": error_msg
            }), 400

        # Normalizar URL do YouTube: extrai o vídeo pelo parâmetro v=
        # (ignora start_radio, list, rv, etc. e processa só o vídeo)
        source = identify_source(url)
        if source == "youtube":
            normalized = normalize_youtube_url(url)
            if normalized != url:
                logger.info(f"URL do YouTube normalizada: {url[:80]}... -> {normalized}")
                url = normalized

        # Validar qualidade
        try:
            quality = int(quality)
        except (ValueError, TypeError):
            return jsonify({
                "success": False,
                "error": "Qualidade inválida. Use: 128, 192, 256 ou 320."
            }), 400

        if quality not in VALID_QUALITIES:
            return jsonify({
                "success": False,
                "error": "Qualidade inválida. Use: 128, 192, 256 ou 320."
            }), 400

        # Verificar concorrência
        acquired = job_semaphore.acquire(blocking=False)
        if not acquired:
            return jsonify({
                "success": False,
                "error": "Servidor ocupado. Tente novamente em alguns instantes."
            }), 429

        try:
            logger.info(f"Iniciando conversão: {url[:80]}... (quality={quality})")

            # Criar diretório temporário
            temp_dir = tempfile.mkdtemp(prefix="video2mp3_")

            # Primeiro, obter informações para validar duração
            try:
                video_info = get_video_info(url)
            except Exception as e:
                error_str = str(e)
                logger.warning(f"Erro ao obter info para conversão: {error_str[:200]}")

                if "private" in error_str.lower():
                    return jsonify({
                        "success": False,
                        "error": "Este vídeo é privado e não pode ser acessado."
                    }), 400
                if "unavailable" in error_str.lower() or "not available" in error_str.lower():
                    return jsonify({
                        "success": False,
                        "error": "Este vídeo não está disponível."
                    }), 400
                if "sign in" in error_str.lower() or "login" in error_str.lower():
                    return jsonify({
                        "success": False,
                        "error": "Este conteúdo requer autenticação e não pode ser acessado."
                    }), 400

                return jsonify({
                    "success": False,
                    "error": "Não foi possível processar o vídeo. Verifique se o link é válido e público."
                }), 400

            duration = video_info.get("duration")
            if duration and duration > MAX_DURATION_SECONDS:
                return jsonify({
                    "success": False,
                    "error": f"Vídeo muito longo ({duration}s). Limite: {MAX_DURATION_SECONDS}s."
                }), 400

            title = video_info.get("title", "video2mp3")

            # Baixar e converter
            mp3_path, _ = download_and_convert(url, quality, temp_dir)

            # Verificar tamanho do arquivo
            file_size = os.path.getsize(mp3_path)
            if file_size > MAX_FILE_SIZE_MB * 1024 * 1024:
                return jsonify({
                    "success": False,
                    "error": f"Arquivo resultante muito grande ({file_size // (1024*1024)} MB). Limite: {MAX_FILE_SIZE_MB} MB."
                }), 400

            if file_size == 0:
                return jsonify({
                    "success": False,
                    "error": "Erro na conversão: arquivo MP3 vazio."
                }), 500

            # Preparar nome seguro
            safe_name = sanitize_filename(title) + ".mp3"

            logger.info(f"Conversão concluída: {safe_name} ({file_size} bytes)")

            # Enviar arquivo
            response = send_file(
                mp3_path,
                mimetype="audio/mpeg",
                as_attachment=True,
                download_name=safe_name,
            )

            # Agendar limpeza após envio
            @response.call_on_close
            def cleanup():
                try:
                    if temp_dir and os.path.exists(temp_dir):
                        shutil.rmtree(temp_dir, ignore_errors=True)
                        logger.info(f"Temp dir removido: {temp_dir}")
                except Exception as e:
                    logger.warning(f"Erro ao limpar temp dir: {e}")

            return response

        finally:
            job_semaphore.release()

    except Exception as e:
        logger.error(f"Erro inesperado em /api/convert: {e}")

        # Limpar em caso de erro
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir, ignore_errors=True)
            except Exception:
                pass

        return jsonify({
            "success": False,
            "error": "Erro interno durante a conversão."
        }), 500


# ──────────────────────────────────────────────────────────────
# Tratamento de erros global
# ──────────────────────────────────────────────────────────────

@app.errorhandler(404)
def not_found(e):
    return jsonify({"success": False, "error": "Endpoint não encontrado."}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"success": False, "error": "Método HTTP não permitido."}), 405


@app.errorhandler(500)
def internal_error(e):
    return jsonify({"success": False, "error": "Erro interno do servidor."}), 500


# ──────────────────────────────────────────────────────────────
# Execução local (desenvolvimento)
# ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    logger.info(f"Iniciando servidor de desenvolvimento na porta {port}")
    app.run(host="0.0.0.0", port=port, debug=True)
