FROM python:3.12-slim

# Instalar FFmpeg
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Diretório de trabalho
WORKDIR /app

# Copiar dependências e instalar
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar código
COPY app.py .

# Criar diretório temporário
RUN mkdir -p /tmp/video2mp3

# Expor porta (Render define PORT via env)
EXPOSE 10000

# Iniciar Gunicorn usando a variável PORT do Render
CMD gunicorn app:app \
    --bind 0.0.0.0:${PORT:-10000} \
    --workers 2 \
    --threads 4 \
    --timeout 360 \
    --graceful-timeout 120 \
    --max-requests 100 \
    --max-requests-jitter 20 \
    --access-logfile - \
    --error-logfile -
