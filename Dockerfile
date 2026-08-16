# ---------------------------------------------------------------------------
# Video2MP3 - Backend Dockerfile
# Imagem pronta para deploy em Render, Railway ou qualquer host com Docker.
# ---------------------------------------------------------------------------

FROM python:3.11-slim

# Evita arquivos .pyc e força stdout/stderr sem buffer (melhor para logs)
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Dependências de sistema: ffmpeg é obrigatório para o yt-dlp extrair/converter áudio
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Instala dependências Python primeiro (cache de build mais eficiente)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copia o código da aplicação
COPY . .

# Render/Railway injetam a variável de ambiente PORT automaticamente.
# Usamos 8000 como fallback para execução local.
ENV PORT=8000
EXPOSE 8000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
