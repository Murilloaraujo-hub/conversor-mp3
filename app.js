"use strict";

/* ============================================================================
 * CONFIGURAÇÃO
 * Troque esta URL entre o ambiente local e a URL de produção (Render/Railway).
 * ========================================================================== */
const API_BASE_URL = "http://localhost:8000";
// Produção, exemplo: const API_BASE_URL = "https://video2mp3-api.onrender.com";

/* ============================================================================
 * Referências de DOM
 * ========================================================================== */
const els = {
  apiStatusPill: document.getElementById("apiStatusPill"),

  verifyForm: document.getElementById("verifyForm"),
  urlInput: document.getElementById("videoUrl"),
  verifyBtn: document.getElementById("verifyBtn"),
  urlHint: document.getElementById("urlHint"),

  errorBox: document.getElementById("errorBox"),
  errorText: document.getElementById("errorText"),

  successBox: document.getElementById("successBox"),

  loadingBox: document.getElementById("loadingBox"),
  loadingLabel: document.getElementById("loadingLabel"),

  videoInfo: document.getElementById("videoInfo"),
  videoThumb: document.getElementById("videoThumb"),
  videoDuration: document.getElementById("videoDuration"),
  videoTitle: document.getElementById("videoTitle"),
  videoUploader: document.getElementById("videoUploader"),

  qualityOptions: document.getElementById("qualityOptions"),
  convertBtn: document.getElementById("convertBtn"),
};

/* Estado local da aplicação */
const state = {
  verifiedUrl: null,
  quality: "192",
};

/* ============================================================================
 * Utilitários de UI
 * ========================================================================== */

function showError(message) {
  els.errorText.textContent = message;
  els.errorBox.hidden = false;
}

function hideError() {
  els.errorBox.hidden = true;
  els.errorText.textContent = "";
}

function hideSuccess() {
  els.successBox.hidden = true;
}

function showLoading(label) {
  els.loadingLabel.textContent = label;
  els.loadingBox.hidden = false;
}

function hideLoading() {
  els.loadingBox.hidden = true;
}

function setBusy(button, busy, busyLabel, idleLabel) {
  button.disabled = busy;
  const labelEl = button.querySelector(".btn__label");
  if (labelEl) {
    labelEl.textContent = busy ? busyLabel : idleLabel;
  }
}

/* ============================================================================
 * Camada de rede — trata erros de rede, HTTP e Content-Type incorreto
 * ========================================================================== */

/**
 * Executa um fetch e devolve JSON já validado.
 * Lança um Error com mensagem amigável em caso de falha.
 */
async function fetchJSON(path, options) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, options);
  } catch (networkError) {
    throw new Error(
      "Não foi possível conectar ao servidor. Verifique sua internet ou tente novamente em instantes."
    );
  }

  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    throw new Error(
      `O servidor respondeu em um formato inesperado (status ${response.status}). Tente novamente mais tarde.`
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch (parseError) {
    throw new Error("Não foi possível interpretar a resposta do servidor.");
  }

  if (!response.ok || payload.success === false) {
    const serverMessage = payload && payload.error ? payload.error : null;
    throw new Error(serverMessage || `Erro inesperado (status ${response.status}).`);
  }

  return payload;
}

/**
 * Executa o download do MP3. Diferente de fetchJSON: em caso de sucesso a
 * resposta é um binário (audio/mpeg), não JSON. Em caso de erro, o backend
 * ainda retorna JSON — então validamos o Content-Type antes de decidir
 * como processar a resposta.
 */
async function fetchAudioBlob(path, options) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, options);
  } catch (networkError) {
    throw new Error(
      "Não foi possível conectar ao servidor. Verifique sua internet ou tente novamente em instantes."
    );
  }

  const contentType = response.headers.get("content-type") || "";

  if (!response.ok) {
    if (contentType.includes("application/json")) {
      const payload = await response.json();
      throw new Error(payload.error || `Erro ao converter (status ${response.status}).`);
    }
    throw new Error(`Erro ao converter o vídeo (status ${response.status}).`);
  }

  if (!contentType.includes("audio/")) {
    throw new Error("O servidor não retornou um arquivo de áudio válido.");
  }

  const blob = await response.blob();

  // Tenta extrair o nome do arquivo enviado pelo backend (Content-Disposition)
  let filename = "audio.mp3";
  const disposition = response.headers.get("content-disposition");
  if (disposition) {
    const match = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
    if (match && match[1]) {
      filename = decodeURIComponent(match[1].replace(/"/g, ""));
    }
  }

  return { blob, filename };
}

function triggerBlobDownload(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

/* ============================================================================
 * Health check do backend (feedback visual do status do servidor)
 * ========================================================================== */

async function checkApiHealth() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/health`, { method: "GET" });
    const contentType = res.headers.get("content-type") || "";
    if (res.ok && contentType.includes("application/json")) {
      els.apiStatusPill.className = "pill pill--online";
      els.apiStatusPill.innerHTML = '<span class="pill__dot"></span> servidor online';
      return;
    }
    throw new Error("unhealthy");
  } catch {
    els.apiStatusPill.className = "pill pill--offline";
    els.apiStatusPill.innerHTML = '<span class="pill__dot"></span> servidor indisponível';
  }
}

/* ============================================================================
 * Fluxo: verificar vídeo
 * ========================================================================== */

async function handleVerifySubmit(event) {
  event.preventDefault();
  hideError();
  hideSuccess();
  els.videoInfo.hidden = true;

  const url = els.urlInput.value.trim();
  if (!url) {
    showError("Cole o link de um vídeo do YouTube antes de continuar.");
    return;
  }

  setBusy(els.verifyBtn, true, "Verificando…", "Verificar");
  showLoading("Verificando vídeo…");

  try {
    const { data } = await fetchJSON("/api/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });

    state.verifiedUrl = url;
    renderVideoInfo(data);
  } catch (err) {
    state.verifiedUrl = null;
    showError(err.message);
  } finally {
    hideLoading();
    setBusy(els.verifyBtn, false, "Verificando…", "Verificar");
  }
}

function renderVideoInfo(data) {
  els.videoThumb.src = data.thumbnail || "";
  els.videoThumb.alt = data.title || "Miniatura do vídeo";
  els.videoDuration.textContent = data.duration_formatted || "00:00";
  els.videoTitle.textContent = data.title || "Título indisponível";
  els.videoUploader.textContent = data.uploader ? `Canal: ${data.uploader}` : "";
  els.videoInfo.hidden = false;
}

/* ============================================================================
 * Fluxo: seleção de qualidade
 * ========================================================================== */

function handleQualityClick(event) {
  const target = event.target.closest(".quality__opt");
  if (!target) return;

  state.quality = target.dataset.quality;

  els.qualityOptions
    .querySelectorAll(".quality__opt")
    .forEach((btn) => btn.classList.toggle("is-selected", btn === target));
}

/* ============================================================================
 * Fluxo: converter e baixar
 * ========================================================================== */

async function handleConvertClick() {
  if (!state.verifiedUrl) {
    showError("Verifique um vídeo antes de converter.");
    return;
  }

  hideError();
  hideSuccess();
  setBusy(els.convertBtn, true, "Convertendo…", "Converter para MP3");
  showLoading(`Convertendo em ${state.quality}kbps — isso pode levar alguns instantes…`);

  try {
    const { blob, filename } = await fetchAudioBlob("/api/convert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: state.verifiedUrl, quality: state.quality }),
    });

    triggerBlobDownload(blob, filename);
    els.successBox.hidden = false;
  } catch (err) {
    showError(err.message);
  } finally {
    hideLoading();
    setBusy(els.convertBtn, false, "Convertendo…", "Converter para MP3");
  }
}

/* ============================================================================
 * Inicialização
 * ========================================================================== */

function init() {
  els.verifyForm.addEventListener("submit", handleVerifySubmit);
  els.qualityOptions.addEventListener("click", handleQualityClick);
  els.convertBtn.addEventListener("click", handleConvertClick);

  checkApiHealth();
}

document.addEventListener("DOMContentLoaded", init);
