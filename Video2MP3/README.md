# 🎵 Video2MP3

Converta vídeos em MP3 diretamente pelo navegador. Cole o link do vídeo (incluindo YouTube), escolha a qualidade e baixe o MP3.

---

## 📋 Sobre

O **Video2MP3** é uma aplicação web com frontend estático (GitHub Pages) e backend Python/Flask (Render) que permite converter vídeos em MP3 a partir de URLs.

### Funcionalidades

- ✅ Aceita links do YouTube (youtube.com, youtu.be, m.youtube.com)
- ✅ Aceita URLs diretas de arquivos de vídeo/áudio
- ✅ Exibe informações do vídeo (título, canal, duração, thumbnail)
- ✅ Múltiplas qualidades: 128, 192, 256, 320 kbps
- ✅ Conversão real com FFmpeg (codec libmp3lame)
- ✅ Download direto do MP3
- ✅ Reprodução no navegador antes de baixar
- ✅ Interface dark, responsiva e acessível
- ✅ Rate limiting e controle de concorrência
- ✅ Proteção contra SSRF
- ✅ Limpeza automática de arquivos temporários

### ⚠️ Aviso de Uso

Use o Video2MP3 **somente** com conteúdos que você tenha autorização para baixar ou converter. O sistema **não** contorna DRM, autenticação, login, conteúdo privado ou quaisquer mecanismos de proteção.

---

## 🏗️ Arquitetura

```
             USUÁRIO
                │
                ▼
       ┌─────────────────┐
       │  GITHUB PAGES   │
       │                 │
       │  index.html     │
       │  style.css      │
       │  script.js      │
       └────────┬────────┘
                │
              HTTPS
                │
                ▼
       ┌─────────────────┐
       │     RENDER       │
       │                 │
       │  Docker         │
       │  Python/Flask   │
       │  Gunicorn       │
       │  yt-dlp         │
       │  FFmpeg         │
       └────────┬────────┘
                │
                ▼
           ARQUIVO MP3
                │
                ▼
             DOWNLOAD
```

---

## 📂 Estrutura

```
Video2MP3/
│
├── frontend/
│   ├── index.html          # Página principal
│   ├── style.css           # Estilos (dark theme, responsivo)
│   └── script.js           # Lógica do frontend
│
├── backend/
│   ├── app.py              # API Flask (info, convert, health)
│   ├── requirements.txt    # Dependências Python
│   ├── Dockerfile          # Container para Render
│   ├── .dockerignore       # Arquivos ignorados no build
│   └── .gitignore          # Arquivos ignorados no Git
│
└── README.md               # Este arquivo
```

---

## ⚙️ Requisitos

### Para desenvolvimento local

- **Python 3.10+**
- **FFmpeg** instalado e no PATH
- **Git**
- Navegador moderno (Chrome, Firefox, Edge, Safari)

### Para produção

- Conta no **GitHub** (frontend)
- Conta no **Render** (backend)

---

## 🔧 Instalação do FFmpeg

### Linux (Ubuntu/Debian)

```bash
sudo apt update
sudo apt install ffmpeg
ffmpeg -version
```

### macOS

```bash
brew install ffmpeg
ffmpeg -version
```

### Windows

1. Baixe de https://ffmpeg.org/download.html
2. Extraia o arquivo
3. Adicione a pasta `bin` ao PATH do sistema
4. Verifique: `ffmpeg -version`

---

## 🚀 Execução Local

### Backend

```bash
cd Video2MP3/backend

# Criar ambiente virtual
python3 -m venv venv
source venv/bin/activate   # Linux/macOS
# venv\Scripts\activate    # Windows

# Instalar dependências
pip install -r requirements.txt

# Configurar variáveis (opcional para desenvolvimento)
export FRONTEND_URL="*"
export MAX_DURATION_SECONDS=3600
export MAX_FILE_SIZE_MB=500
export MAX_CONCURRENT_JOBS=2
export RATE_LIMIT=10
export CONVERSION_TIMEOUT_SECONDS=300

# Iniciar servidor de desenvolvimento
python app.py
```

O backend estará em: `http://localhost:5000`

### Frontend

1. Abra `frontend/script.js`
2. Altere a variável `API_URL`:

```javascript
const API_URL = "http://localhost:5000";
```

3. Abra `frontend/index.html` diretamente no navegador

> **Nota:** Para desenvolvimento local, o frontend funciona abrindo o HTML diretamente. Não precisa de Node.js, Python ou qualquer servidor local para o frontend.

---

## 🌐 API

### `GET /api/health`

Health check do servidor.

**Resposta:**
```json
{
  "status": "ok"
}
```

### `POST /api/info`

Obtém informações do vídeo.

**Request:**
```json
{
  "url": "https://www.youtube.com/watch?v=XXXXXXXXXXX"
}
```

**Resposta (sucesso):**
```json
{
  "success": true,
  "title": "Título do Vídeo",
  "uploader": "Nome do Canal",
  "duration": 324,
  "thumbnail": "https://...",
  "source": "youtube"
}
```

**Resposta (erro):**
```json
{
  "success": false,
  "error": "Mensagem de erro"
}
```

### `POST /api/convert`

Converte o vídeo para MP3.

**Request:**
```json
{
  "url": "https://www.youtube.com/watch?v=XXXXXXXXXXX",
  "quality": 192
}
```

**Qualidades aceitas:** `128`, `192`, `256`, `320`

**Resposta (sucesso):** Arquivo MP3 binário com headers:
- `Content-Type: audio/mpeg`
- `Content-Disposition: attachment; filename="titulo.mp3"`

**Resposta (erro):**
```json
{
  "success": false,
  "error": "Mensagem de erro"
}
```

---

## 📦 Deploy no GitHub (Frontend)

### Passo 1: Criar repositório

1. Acesse https://github.com/new
2. Nome: `Video2MP3`
3. Público
4. Criar repositório

### Passo 2: Enviar projeto

```bash
cd Video2MP3
git init
git add .
git commit -m "Video2MP3 - Primeira versão"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/Video2MP3.git
git push -u origin main
```

### Passo 3: Configurar GitHub Pages

1. No repositório, vá em **Settings**
2. No menu lateral, clique em **Pages**
3. Em **Source**, selecione: **Deploy from a branch**
4. Em **Branch**, selecione: `main`
5. Em **Folder**, selecione: `/frontend`
6. Clique **Save**
7. Aguarde o deploy (1-2 minutos)
8. A URL será: `https://SEU-USUARIO.github.io/Video2MP3/`

---

## 🖥️ Deploy no Render (Backend)

### Passo 1: Criar serviço

1. Acesse https://render.com
2. Clique em **New** → **Web Service**
3. Conecte seu repositório GitHub `Video2MP3`
4. Configure:
   - **Name:** `video2mp3`
   - **Root Directory:** `backend`
   - **Runtime:** `Docker`
   - **Plan:** Free (ou o que preferir)

### Passo 2: Variáveis de ambiente

No Render, vá em **Environment** e adicione:

| Variável | Valor | Descrição |
|---|---|---|
| `FRONTEND_URL` | `https://SEU-USUARIO.github.io` | URL do frontend para CORS |
| `MAX_DURATION_SECONDS` | `3600` | Duração máxima do vídeo (1h) |
| `MAX_FILE_SIZE_MB` | `500` | Tamanho máximo do arquivo |
| `MAX_CONCURRENT_JOBS` | `2` | Conversões simultâneas |
| `RATE_LIMIT` | `10` | Requisições por minuto por IP |
| `CONVERSION_TIMEOUT_SECONDS` | `300` | Timeout da conversão |

> **Nota sobre CORS:** A variável `FRONTEND_URL` deve conter a URL exata do GitHub Pages **sem** barra final. Exemplo: `https://meuusuario.github.io`

### Passo 3: Deploy

1. Clique **Create Web Service**
2. Aguarde o build (pode demorar 5-10 minutos na primeira vez)
3. Anote a URL gerada (ex: `https://video2mp3-xxxx.onrender.com`)

### Passo 4: Testar

```bash
curl https://video2mp3-xxxx.onrender.com/api/health
```

Deve retornar: `{"status": "ok"}`

---

## 🔗 Conectar Frontend ao Backend

Após o backend estar publicado no Render:

1. Abra `frontend/script.js`
2. Altere a primeira linha:

```javascript
const API_URL = "https://video2mp3-xxxx.onrender.com";
```

3. Substitua pela URL real do seu serviço no Render
4. Faça commit e push:

```bash
git add frontend/script.js
git commit -m "Configurar URL do backend"
git push
```

5. Aguarde o GitHub Pages atualizar (1-2 minutos)

---

## 🔒 Segurança

### CORS

- Em produção, configure `FRONTEND_URL` com a URL exata do GitHub Pages
- Nunca use `*` em produção
- O backend aceita requisições apenas da origem configurada

### SSRF

O backend valida todas as URLs recebidas:

- ❌ Bloqueia `localhost`, `127.0.0.1`, `0.0.0.0`
- ❌ Bloqueia IPs privados (10.x, 172.16-31.x, 192.168.x)
- ❌ Bloqueia IPs de loopback e link-local
- ❌ Bloqueia esquemas `file://`, `javascript:`, `data:`
- ❌ Bloqueia URLs malformadas
- ✅ Aceita apenas `http://` e `https://`
- ✅ Valida hostname e resolução DNS

### Subprocess

- Nunca usa `shell=True` com entrada do usuário
- Argumentos são passados como lista separada
- URLs não são interpoladas em comandos

### Arquivos Temporários

- Cada conversão usa diretório temporário único (UUID)
- Arquivos são removidos após a conversão
- Limpeza acontece mesmo em caso de erro (`try/finally`)

---

## 📊 Limites

| Limite | Padrão | Variável |
|---|---|---|
| Duração máxima | 1 hora (3600s) | `MAX_DURATION_SECONDS` |
| Tamanho máximo | 500 MB | `MAX_FILE_SIZE_MB` |
| Conversões simultâneas | 2 | `MAX_CONCURRENT_JOBS` |
| Requisições por minuto | 10 por IP | `RATE_LIMIT` |
| Timeout da conversão | 5 minutos | `CONVERSION_TIMEOUT_SECONDS` |

### Rate Limiting

O rate limiting é implementado **em memória**. Isso significa que:

- O contador é resetado quando a instância reinicia
- No Render Free, a instância pode reiniciar após inatividade
- Para produção robusta, considere usar Redis (não incluído neste projeto)

---

## 🔊 FFmpeg

O MP3 é gerado com:

- **Codec:** libmp3lame
- **Bitrates:** 128k, 192k, 256k, 320k (selecionável)
- **Content-Type:** `audio/mpeg`
- **Extensão:** `.mp3`

O FFmpeg é instalado automaticamente no Docker via `apt-get install ffmpeg`.

---

## 🎬 YouTube

O sistema aceita os seguintes formatos de URL do YouTube:

- `https://www.youtube.com/watch?v=XXXXXXXXXXX`
- `https://youtu.be/XXXXXXXXXXX`
- `https://www.youtube.com/shorts/XXXXXXXXXXX`
- `https://www.youtube.com/live/XXXXXXXXXXX`
- `https://m.youtube.com/watch?v=XXXXXXXXXXX`
- `https://music.youtube.com/watch?v=XXXXXXXXXXX`

### Parâmetros adicionais (start_radio, list, rv, etc.)

O sistema é **tolerante a parâmetros extras** do YouTube. URLs como estas são
aceitas e processadas corretamente:

- `https://www.youtube.com/watch?v=ABC123&start_radio=1`
- `https://www.youtube.com/watch?v=ABC123&list=RDABC123&start_radio=1`
- `https://www.youtube.com/watch?v=ABC123&start_radio=1&rv=OTHERID`
- `https://www.youtube.com/watch?v=ABC123&list=RDABC123&index=2&si=xyz&feature=shared&pp=abc&t=30`

**Como funciona:** o backend identifica o vídeo pelo parâmetro `v=VIDEO_ID`.
Parâmetros como `start_radio`, `list`, `rv`, `index`, `si`, `feature`, `pp`,
`t`, `start` e `end` são **ignorados** — o sistema extrai apenas o `VIDEO_ID`
e processa somente aquele vídeo.

### Playlists e Rádio

Quando a URL contém `v=VIDEO_ID` junto com `list=...` e `start_radio=1`:

- ✅ O sistema processa **somente** o vídeo indicado por `v=VIDEO_ID`
- ❌ A playlist/rádio inteira **não** é baixada
- ❌ Não há sistema de download em lote

Isso é garantido por dois mecanismos:
1. Normalização da URL no backend (extrai apenas o ID do vídeo)
2. Flag `noplaylist=True` na configuração do yt-dlp

### Limitações

- ❌ Não acessa vídeos privados
- ❌ Não acessa conteúdo que requer login
- ❌ Não contorna restrições de idade sem autenticação
- ❌ Não contorna DRM ou bloqueios geográficos
- ❌ Não contorna qualquer mecanismo de proteção
- ✅ Funciona apenas com conteúdo público e acessível

O sistema usa **yt-dlp**, uma ferramenta de código aberto mantida pela comunidade. O yt-dlp pode parar de funcionar se o YouTube alterar sua API. Nesse caso, atualize o yt-dlp:

```bash
pip install --upgrade yt-dlp
```

Ou, no Docker, faça um novo build/deploy no Render.

---

## ❓ Erros Comuns

| Erro | Causa | Solução |
|---|---|---|
| "Erro de conexão com o servidor" | Backend offline | Verifique se o Render está ativo |
| "URL não fornecida" | Campo vazio | Insira uma URL |
| "Endereço não permitido" | localhost/IP privado | Use URLs públicas |
| "Este vídeo é privado" | Vídeo privado no YouTube | Use vídeos públicos |
| "Vídeo muito longo" | Excede MAX_DURATION_SECONDS | Reduza ou aumente o limite |
| "Servidor ocupado" | Muitas conversões simultâneas | Aguarde e tente novamente |
| "Muitas requisições" | Rate limit excedido | Aguarde 1 minuto |
| "Qualidade inválida" | Valor diferente de 128/192/256/320 | Use uma qualidade válida |

---

## 🔄 Atualização

### Atualizar yt-dlp

Se o YouTube mudar algo e o yt-dlp parar de funcionar:

1. Edite `backend/requirements.txt`
2. Altere a versão do yt-dlp para a mais recente
3. Faça commit e push
4. O Render fará o redeploy automaticamente

Ou force um novo deploy no Render clicando em **Manual Deploy** → **Deploy latest commit**.

### Atualizar o frontend

1. Edite os arquivos em `frontend/`
2. Faça commit e push
3. O GitHub Pages atualizará automaticamente

---

## 🔒 Privacidade

- **Sem contas:** O sistema não cria contas ou requer login
- **Sem banco de dados:** Nenhum dado é armazenado permanentemente
- **Sem histórico:** Conversões anteriores não são salvas
- **Arquivos temporários:** Todo material é removido após a conversão
- **Sem cookies:** O sistema não usa cookies de rastreamento

---

## 📄 Licença

Este projeto é fornecido como está, sem garantias. Use responsavelmente e apenas com conteúdo que você tenha autorização para converter.
