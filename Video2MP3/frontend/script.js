/**
 * Video2MP3 — Frontend Script
 *
 * CONFIGURAÇÃO: Altere API_URL para a URL do seu backend no Render.
 * Exemplo: const API_URL = "https://video2mp3-xxxx.onrender.com";
 */
const API_URL = "https://SEU-BACKEND.onrender.com";

// ──────────────────────────────────────────────────────────────
// Elementos DOM
// ──────────────────────────────────────────────────────────────

const urlInput = document.getElementById("url-input");
const btnVerify = document.getElementById("btn-verify");
const inputError = document.getElementById("input-error");

const statusArea = document.getElementById("status-area");
const statusSpinner = document.getElementById("status-spinner");
const statusText = document.getElementById("status-text");
const progressBar = document.getElementById("progress-bar");
const progressFill = document.getElementById("progress-fill");

const videoInfoSection = document.getElementById("video-info");
const infoTitle = document.getElementById("info-title");
const thumbnailWrap = document.getElementById("thumbnail-wrap");
const infoThumbnail = document.getElementById("info-thumbnail");
const infoUploader = document.getElementById("info-uploader");
const infoUploaderText = document.getElementById("info-uploader-text");
const infoDuration = document.getElementById("info-duration");
const infoDurationText = document.getElementById("info-duration-text");
const infoSource = document.getElementById("info-source");
const infoSourceText = document.getElementById("info-source-text");
const qualitySelect = document.getElementById("quality-select");
const btnConvert = document.getElementById("btn-convert");

const resultSection = document.getElementById("result-section");
const resultFilename = document.getElementById("result-filename");
const audioPlayerWrap = document.getElementById("audio-player-wrap");
const audioPlayer = document.getElementById("audio-player");
const btnDownload = document.getElementById("btn-download");
const btnNew = document.getElementById("btn-new");

const errorSection = document.getElementById("error-section");
const errorMessage = document.getElementById("error-message");
const btnRetry = document.getElementById("btn-retry");

// ──────────────────────────────────────────────────────────────
// Estado
// ──────────────────────────────────────────────────────────────

let currentBlobUrl = null;
let currentBlob = null;
let currentFilename = "video2mp3.mp3";

// ──────────────────────────────────────────────────────────────
// Utilidades
// ──────────────────────────────────────────────────────────────

function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return null;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
        return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    return `${m}:${String(s).padStart(2, "0")}`;
}

function formatSource(source) {
    const names = {
        youtube: "YouTube",
        direct: "Link direto",
        unknown: "Desconhecido",
    };
    return names[source] || source;
}

function validateUrlFrontend(url) {
    if (!url || typeof url !== "string") {
        return "Por favor, insira uma URL.";
    }

    url = url.trim();

    if (url.length === 0) {
        return "Por favor, insira uma URL.";
    }

    if (url.length > 2048) {
        return "URL muito longa.";
    }

    // Verificar protocolo
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return "A URL deve começar com http:// ou https://";
    }

    // Bloquear esquemas perigosos
    const lower = url.toLowerCase();
    if (lower.startsWith("javascript:") || lower.startsWith("data:") || lower.startsWith("file:")) {
        return "URL não permitida.";
    }

    // Verificar formato básico
    try {
        const parsed = new URL(url);
        if (!parsed.hostname || parsed.hostname.length === 0) {
            return "URL sem hostname válido.";
        }
        // Bloquear localhost / IPs privados (validação básica)
        const host = parsed.hostname.toLowerCase();
        if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1") {
            return "Endereço não permitido.";
        }
    } catch {
        return "URL malformada.";
    }

    return null; // URL válida
}

// ──────────────────────────────────────────────────────────────
// UI Helpers
// ──────────────────────────────────────────────────────────────

function showStatus(message) {
    statusArea.hidden = false;
    statusSpinner.hidden = false;
    statusText.textContent = message;
    progressBar.hidden = true;
}

function showStatusWithProgress(message) {
    statusArea.hidden = false;
    statusSpinner.hidden = false;
    statusText.textContent = message;
    progressBar.hidden = false;
    progressFill.style.width = "0%";
    progressFill.classList.add("indeterminate");
}

function hideStatus() {
    statusArea.hidden = true;
    progressFill.classList.remove("indeterminate");
}

function showInputError(msg) {
    inputError.textContent = msg;
    urlInput.classList.add("error");
}

function clearInputError() {
    inputError.textContent = "";
    urlInput.classList.remove("error");
}

function showError(msg) {
    hideStatus();
    videoInfoSection.hidden = true;
    resultSection.hidden = true;
    errorSection.hidden = false;
    errorMessage.textContent = msg;
}

function hideError() {
    errorSection.hidden = true;
}

function showResult(filename) {
    hideStatus();
    hideError();
    videoInfoSection.hidden = true;
    resultSection.hidden = false;
    resultFilename.textContent = filename;
}

function resetUI() {
    hideStatus();
    hideError();
    videoInfoSection.hidden = true;
    resultSection.hidden = true;
    clearInputError();

    // Limpar blob anterior
    if (currentBlobUrl) {
        URL.revokeObjectURL(currentBlobUrl);
        currentBlobUrl = null;
    }
    currentBlob = null;
    currentFilename = "video2mp3.mp3";

    // Reset audio player
    audioPlayer.pause();
    audioPlayer.removeAttribute("src");
    audioPlayerWrap.hidden = true;
}

function setLoading(btn, isLoading, originalText) {
    if (isLoading) {
        btn.disabled = true;
        btn.querySelector(".btn-text").textContent = "Aguarde...";
    } else {
        btn.disabled = false;
        btn.querySelector(".btn-text").textContent = originalText;
    }
}

// ──────────────────────────────────────────────────────────────
// API Calls
// ──────────────────────────────────────────────────────────────

async function apiRequest(endpoint, options = {}) {
    const url = `${API_URL}${endpoint}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 min timeout

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
        return response;
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === "AbortError") {
            throw new Error("A requisição excedeu o tempo limite. Tente novamente.");
        }
        throw new Error("Erro de conexão com o servidor. Verifique se o backend está ativo.");
    }
}

// ──────────────────────────────────────────────────────────────
// Verificar Link
// ──────────────────────────────────────────────────────────────

async function handleVerify() {
    const url = urlInput.value.trim();

    // Validação frontend
    const validationError = validateUrlFrontend(url);
    if (validationError) {
        showInputError(validationError);
        return;
    }

    clearInputError();
    resetUI();
    showStatus("Verificando link...");
    setLoading(btnVerify, true, "Verificar link");

    try {
        const response = await apiRequest("/api/info", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url }),
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            showError(data.error || "Não foi possível verificar o link.");
            return;
        }

        // Mostrar informações
        hideStatus();
        hideError();

        // Título
        infoTitle.textContent = data.title || "Sem título";

        // Thumbnail
        if (data.thumbnail) {
            infoThumbnail.src = data.thumbnail;
            thumbnailWrap.hidden = false;
        } else {
            thumbnailWrap.hidden = true;
        }

        // Uploader
        if (data.uploader) {
            infoUploaderText.textContent = data.uploader;
            infoUploader.hidden = false;
        } else {
            infoUploader.hidden = true;
        }

        // Duração
        if (data.duration) {
            infoDurationText.textContent = formatDuration(data.duration);
            infoDuration.hidden = false;
        } else {
            infoDuration.hidden = true;
        }

        // Fonte
        if (data.source) {
            infoSourceText.textContent = formatSource(data.source);
            infoSource.hidden = false;
        } else {
            infoSource.hidden = true;
        }

        videoInfoSection.hidden = false;

    } catch (err) {
        showError(err.message);
    } finally {
        setLoading(btnVerify, false, "Verificar link");
    }
}

// ──────────────────────────────────────────────────────────────
// Converter para MP3
// ──────────────────────────────────────────────────────────────

async function handleConvert() {
    const url = urlInput.value.trim();
    const quality = parseInt(qualitySelect.value, 10);

    // Validação
    const validationError = validateUrlFrontend(url);
    if (validationError) {
        showInputError(validationError);
        return;
    }

    if (![128, 192, 256, 320].includes(quality)) {
        showError("Qualidade inválida.");
        return;
    }

    hideError();
    showStatusWithProgress("Preparando conversão...");
    setLoading(btnConvert, true, "Converter para MP3");

    try {
        // Atualizar status
        statusText.textContent = "Convertendo para MP3...";

        const response = await apiRequest("/api/convert", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url, quality }),
        });

        if (!response.ok) {
            // Tentar ler erro JSON
            let errorMsg = "Erro durante a conversão.";
            try {
                const errorData = await response.json();
                errorMsg = errorData.error || errorMsg;
            } catch {
                // response não é JSON
            }
            showError(errorMsg);
            return;
        }

        // Verificar content type
        const contentType = response.headers.get("Content-Type") || "";
        if (!contentType.includes("audio/mpeg") && !contentType.includes("audio/mp3")) {
            // Pode ser erro JSON
            try {
                const errorData = await response.json();
                showError(errorData.error || "Resposta inesperada do servidor.");
            } catch {
                showError("Resposta inesperada do servidor.");
            }
            return;
        }

        statusText.textContent = "Finalizando...";

        // Obter filename do header
        const disposition = response.headers.get("Content-Disposition") || "";
        const filenameMatch = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';\n]+)/i);
        if (filenameMatch) {
            try {
                currentFilename = decodeURIComponent(filenameMatch[1]);
            } catch {
                currentFilename = filenameMatch[1];
            }
        } else {
            currentFilename = "video2mp3.mp3";
        }

        // Garantir extensão .mp3
        if (!currentFilename.toLowerCase().endsWith(".mp3")) {
            currentFilename += ".mp3";
        }

        // Ler blob
        const blob = await response.blob();

        if (blob.size === 0) {
            showError("O arquivo MP3 gerado está vazio.");
            return;
        }

        // Limpar blob anterior
        if (currentBlobUrl) {
            URL.revokeObjectURL(currentBlobUrl);
        }

        currentBlob = blob;
        currentBlobUrl = URL.createObjectURL(blob);

        // Configurar audio player
        audioPlayer.src = currentBlobUrl;
        audioPlayerWrap.hidden = false;

        // Mostrar resultado
        showResult(currentFilename);

    } catch (err) {
        showError(err.message);
    } finally {
        setLoading(btnConvert, false, "Converter para MP3");
    }
}

// ──────────────────────────────────────────────────────────────
// Download MP3
// ──────────────────────────────────────────────────────────────

function handleDownload() {
    if (!currentBlobUrl || !currentBlob) {
        showError("Nenhum arquivo disponível para download.");
        return;
    }

    const a = document.createElement("a");
    const downloadUrl = URL.createObjectURL(currentBlob);
    a.href = downloadUrl;
    a.download = currentFilename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);
}

// ──────────────────────────────────────────────────────────────
// Event Listeners
// ──────────────────────────────────────────────────────────────

btnVerify.addEventListener("click", handleVerify);

urlInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
        e.preventDefault();
        handleVerify();
    }
});

urlInput.addEventListener("input", function () {
    clearInputError();
});

btnConvert.addEventListener("click", handleConvert);
btnDownload.addEventListener("click", handleDownload);

btnNew.addEventListener("click", function () {
    resetUI();
    urlInput.value = "";
    urlInput.focus();
});

btnRetry.addEventListener("click", function () {
    hideError();
    urlInput.focus();
});

// Limpar blob ao sair da página
window.addEventListener("beforeunload", function () {
    if (currentBlobUrl) {
        URL.revokeObjectURL(currentBlobUrl);
    }
});

// ──────────────────────────────────────────────────────────────
// Health check na inicialização (sem bloquear UI)
// ──────────────────────────────────────────────────────────────

(async function healthCheck() {
    try {
        const response = await fetch(`${API_URL}/api/health`, {
            method: "GET",
            signal: AbortSignal.timeout(10000),
        });
        if (response.ok) {
            console.log("[Video2MP3] Backend conectado.");
        } else {
            console.warn("[Video2MP3] Backend retornou status:", response.status);
        }
    } catch {
        console.warn(
            "[Video2MP3] Não foi possível conectar ao backend.",
            "Verifique se o backend está ativo e a URL está configurada corretamente.",
            "API_URL:", API_URL
        );
    }
})();
