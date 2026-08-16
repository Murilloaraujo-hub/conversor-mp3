# Video2MP3

Conversor de vídeos do YouTube para MP3. Projeto 100% desacoplado:

```
video2mp3/
├── backend/              # API em FastAPI (Python)
│   ├── main.py
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .dockerignore
├── frontend/              # HTML + CSS + JS puro (sem build step)
│   ├── index.html
│   ├── style.css
│   └── app.js
└── README.md
```

---

## 1. Rodando localmente

### 1.1 Pré-requisitos

- Python 3.11+
- [ffmpeg](https://ffmpeg.org/download.html) instalado e disponível no `PATH`
  - macOS: `brew install ffmpeg`
  - Ubuntu/Debian: `sudo apt-get install ffmpeg`
  - Windows: baixe o binário e adicione a pasta `bin` ao PATH

### 1.2 Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

A API sobe em `http://localhost:8000`. Teste rapidamente:

```bash
curl http://localhost:8000/api/health
# {"success":true,"status":"ok"}
```

### 1.3 Frontend

O frontend é HTML/CSS/JS puro — não precisa de build. Basta servir a pasta `frontend/`:

```bash
cd frontend
python3 -m http.server 5500
```

Acesse `http://localhost:5500`. Confirme que `frontend/app.js` está apontando para o
backend local:

```js
const API_BASE_URL = "http://localhost:8000";
```

Como o backend já libera CORS para `localhost` em qualquer porta, não é necessário
nenhum ajuste adicional para desenvolvimento local.

---

## 2. Publicando o Backend no Render

1. Suba o conteúdo da pasta `backend/` (ou o repositório inteiro) para o GitHub.
2. No [Render](https://render.com), clique em **New → Web Service**.
3. Conecte o repositório e, quando perguntado o tipo de ambiente, escolha **Docker**
   (o Render detecta o `Dockerfile` automaticamente). Se o repositório contém tanto
   `backend/` quanto `frontend/`, defina **Root Directory** como `backend`.
4. Configurações sugeridas:
   - **Instance type**: Free ou Starter (o plano gratuito hiberna após inatividade)
   - **Health Check Path**: `/api/health`
5. O Render injeta a variável de ambiente `PORT` automaticamente — o `Dockerfile` já
   está preparado para usá-la (`uvicorn ... --port ${PORT:-8000}`).
6. Após o deploy, copie a URL pública gerada (algo como
   `https://video2mp3-api.onrender.com`).

> Alternativa: o mesmo `Dockerfile` funciona sem alterações no **Railway**
> (New Project → Deploy from GitHub repo → ele detecta o Dockerfile automaticamente).

---

## 3. Publicando o Frontend no GitHub Pages

1. Garanta que a pasta `frontend/` esteja em um repositório do GitHub.
2. Antes de publicar, atualize `frontend/app.js` com a URL de produção do backend:

   ```js
   const API_BASE_URL = "https://video2mp3-api.onrender.com";
   ```

3. No GitHub, vá em **Settings → Pages**.
4. Em **Source**, selecione a branch (ex.: `main`) e a pasta `/frontend`
   (ou `/root`, caso você mova os arquivos do frontend para a raiz do repositório —
   o GitHub Pages só permite publicar a partir de `/` ou `/docs`, então a opção mais
   simples é ter um repositório dedicado apenas ao frontend, ou usar GitHub Actions
   para publicar a subpasta).
5. Salve. Sua aplicação ficará disponível em:
   `https://<seu-usuario>.github.io/<nome-do-repo>/`

6. Como o backend já libera CORS para `https://*.github.io` via regex, nenhuma
   configuração adicional de CORS é necessária.

### Publicando apenas a subpasta `frontend/` via GitHub Actions (opcional)

Se preferir manter `backend/` e `frontend/` no mesmo repositório sem movê-los, crie
`.github/workflows/pages.yml`:

```yaml
name: Deploy Frontend to GitHub Pages
on:
  push:
    branches: [main]
    paths: ["frontend/**"]

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: frontend
      - id: deployment
        uses: actions/deploy-pages@v4
```

Depois, em **Settings → Pages → Source**, escolha **GitHub Actions**.

---

## 4. Notas sobre o backend

- Todas as respostas — sucesso e erro — são estritamente `application/json`
  (exceto o binário `audio/mpeg` retornado por `/api/convert` em caso de sucesso).
- Handlers globais garantem que erros 400, 404, 422 e 500 nunca retornem HTML.
- `MAX_DURATION_SECONDS` em `main.py` limita a duração máxima de vídeos aceitos
  (padrão: 3 horas) — ajuste conforme a capacidade do seu servidor.
- Arquivos temporários de conversão são gerados em pastas isoladas por requisição
  e removidos automaticamente após o download (via `BackgroundTasks`).
- Respeite os direitos autorais do conteúdo convertido — este projeto é destinado
  a uso pessoal com conteúdo próprio ou livre de direitos.
