"use client";

import { useState, useCallback, useRef, useEffect } from "react";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface VideoInfoData {
  title?: string;
  uploader?: string;
  duration?: number;
  thumbnail?: string;
  source?: string;
}

type AppState =
  | "idle"
  | "verifying"
  | "info"
  | "converting"
  | "done"
  | "error";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatSource(source: string): string {
  const names: Record<string, string> = {
    youtube: "YouTube",
    direct: "Link direto",
  };
  return names[source] || source;
}

function validateUrlFrontend(url: string): string | null {
  if (!url || url.trim().length === 0) {
    return "Por favor, insira uma URL.";
  }
  url = url.trim();
  if (url.length > 2048) return "URL muito longa.";
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return "A URL deve começar com http:// ou https://";
  }
  const lower = url.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("data:") || lower.startsWith("file:")) {
    return "URL não permitida.";
  }
  try {
    const parsed = new URL(url);
    if (!parsed.hostname) return "URL sem hostname válido.";
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1") {
      return "Endereço não permitido.";
    }
  } catch {
    return "URL malformada.";
  }
  return null;
}

// ──────────────────────────────────────────────
// Main Component
// ──────────────────────────────────────────────

export function Video2MP3App() {
  const [state, setState] = useState<AppState>("idle");
  const [url, setUrl] = useState("");
  const [inputError, setInputError] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [videoInfo, setVideoInfo] = useState<VideoInfoData | null>(null);
  const [quality, setQuality] = useState(192);
  const [mp3BlobUrl, setMp3BlobUrl] = useState<string | null>(null);
  const [mp3Blob, setMp3Blob] = useState<Blob | null>(null);
  const [mp3Filename, setMp3Filename] = useState("video2mp3.mp3");
  const audioRef = useRef<HTMLAudioElement>(null);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (mp3BlobUrl) URL.revokeObjectURL(mp3BlobUrl);
    };
  }, [mp3BlobUrl]);

  const resetAll = useCallback(() => {
    setState("idle");
    setInputError("");
    setStatusMsg("");
    setErrorMsg("");
    setVideoInfo(null);
    if (mp3BlobUrl) URL.revokeObjectURL(mp3BlobUrl);
    setMp3BlobUrl(null);
    setMp3Blob(null);
    setMp3Filename("video2mp3.mp3");
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
    }
  }, [mp3BlobUrl]);

  // ── Verify Link ──
  const handleVerify = useCallback(async () => {
    const trimmed = url.trim();
    const validationErr = validateUrlFrontend(trimmed);
    if (validationErr) {
      setInputError(validationErr);
      return;
    }
    setInputError("");
    setErrorMsg("");
    setVideoInfo(null);
    if (mp3BlobUrl) URL.revokeObjectURL(mp3BlobUrl);
    setMp3BlobUrl(null);
    setMp3Blob(null);
    setState("verifying");
    setStatusMsg("Verificando link...");

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      const res = await fetch("/api/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();

      if (!res.ok || !data.success) {
        setState("error");
        setErrorMsg(data.error || "Não foi possível verificar o link.");
        return;
      }

      setVideoInfo(data);
      setState("info");
    } catch (err: unknown) {
      setState("error");
      if (err instanceof Error && err.name === "AbortError") {
        setErrorMsg("Tempo limite excedido. Tente novamente.");
      } else {
        setErrorMsg("Erro de conexão com o servidor.");
      }
    }
  }, [url, mp3BlobUrl]);

  // ── Convert ──
  const handleConvert = useCallback(async () => {
    const trimmed = url.trim();
    const validationErr = validateUrlFrontend(trimmed);
    if (validationErr) {
      setInputError(validationErr);
      return;
    }
    if (![128, 192, 256, 320].includes(quality)) {
      setErrorMsg("Qualidade inválida.");
      setState("error");
      return;
    }

    setState("converting");
    setStatusMsg("Preparando conversão...");
    setErrorMsg("");

    try {
      setStatusMsg("Convertendo para MP3...");

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 360000); // 6 min
      const res = await fetch("/api/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed, quality }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const contentType = res.headers.get("Content-Type") || "";

      if (!res.ok || (!contentType.includes("audio/mpeg") && !contentType.includes("audio/mp3"))) {
        let errText = "Erro durante a conversão.";
        try {
          const errData = await res.json();
          errText = errData.error || errText;
        } catch {
          // not JSON
        }
        setState("error");
        setErrorMsg(errText);
        return;
      }

      setStatusMsg("Finalizando...");

      // Parse filename
      const disposition = res.headers.get("Content-Disposition") || "";
      const filenameMatch = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';\n]+)/i);
      let filename = "video2mp3.mp3";
      if (filenameMatch) {
        try {
          filename = decodeURIComponent(filenameMatch[1]);
        } catch {
          filename = filenameMatch[1];
        }
      }
      if (!filename.toLowerCase().endsWith(".mp3")) filename += ".mp3";

      const blob = await res.blob();
      if (blob.size === 0) {
        setState("error");
        setErrorMsg("O arquivo MP3 gerado está vazio.");
        return;
      }

      if (mp3BlobUrl) URL.revokeObjectURL(mp3BlobUrl);
      const blobUrl = URL.createObjectURL(blob);

      setMp3Blob(blob);
      setMp3BlobUrl(blobUrl);
      setMp3Filename(filename);
      setState("done");
    } catch (err: unknown) {
      setState("error");
      if (err instanceof Error && err.name === "AbortError") {
        setErrorMsg("Tempo limite excedido durante a conversão.");
      } else {
        setErrorMsg(err instanceof Error ? err.message : "Erro durante a conversão.");
      }
    }
  }, [url, quality, mp3BlobUrl]);

  // ── Download ──
  const handleDownload = useCallback(() => {
    if (!mp3Blob) return;
    const a = document.createElement("a");
    const downloadUrl = URL.createObjectURL(mp3Blob);
    a.href = downloadUrl;
    a.download = mp3Filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);
  }, [mp3Blob, mp3Filename]);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-bg-secondary border-b border-border sticky top-0 z-50" style={{ backdropFilter: "blur(12px)" }}>
        <div className="max-w-[720px] mx-auto px-5 py-4 flex items-center gap-3">
          <span className="text-[28px] leading-none">🎵</span>
          <span
            className="text-[22px] font-bold"
            style={{
              background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Video2MP3
          </span>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 max-w-[720px] mx-auto w-full px-5 py-8">
        {/* Hero */}
        <section className="text-center mb-8">
          <h1
            className="text-[2rem] font-extrabold mb-2"
            style={{
              background: "linear-gradient(135deg, #f1f5f9, #3b82f6)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Converta vídeos em MP3
          </h1>
          <p className="text-text-secondary text-[1.05rem]">
            Cole o link do vídeo e transforme o áudio em MP3.
          </p>
        </section>

        {/* URL Input */}
        <section className="mb-6">
          <label htmlFor="url-input" className="block text-sm font-semibold text-text-secondary mb-2">
            Cole o link do vídeo
          </label>
          <div className="flex gap-2 flex-col sm:flex-row">
            <input
              type="url"
              id="url-input"
              className={`flex-1 px-4 py-3.5 text-base bg-bg-input text-text-primary rounded-xl border-2 transition-colors min-w-0 ${
                inputError ? "border-accent-red" : "border-border focus:border-accent-blue"
              }`}
              style={{ outline: "none" }}
              placeholder="https://www.youtube.com/watch?v=..."
              autoComplete="off"
              spellCheck={false}
              aria-label="URL do vídeo"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (inputError) setInputError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleVerify();
                }
              }}
              disabled={state === "verifying" || state === "converting"}
            />
            <button
              className="inline-flex items-center justify-center gap-2 px-5 py-3 text-[0.95rem] font-semibold bg-accent-blue hover:bg-accent-blue-hover text-white rounded-xl transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              onClick={handleVerify}
              disabled={state === "verifying" || state === "converting"}
              aria-label="Verificar link"
            >
              <span>🔍</span>
              <span>{state === "verifying" ? "Aguarde..." : "Verificar link"}</span>
            </button>
          </div>
          {inputError && (
            <p className="text-sm text-accent-red mt-2" role="alert">{inputError}</p>
          )}
        </section>

        {/* Status */}
        {(state === "verifying" || state === "converting") && (
          <div className="mb-6" aria-live="polite">
            <div className="flex items-center gap-3 p-4 bg-bg-card border border-border rounded-xl">
              <div
                className="w-5 h-5 border-[3px] border-border rounded-full flex-shrink-0 animate-spin-slow"
                style={{ borderTopColor: "#3b82f6" }}
              />
              <p className="text-[0.95rem] text-text-secondary">{statusMsg}</p>
            </div>
            {state === "converting" && (
              <div className="mt-2 h-1 bg-bg-hover rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full w-[30%] progress-indeterminate"
                  style={{ background: "linear-gradient(90deg, #3b82f6, #8b5cf6)" }}
                />
              </div>
            )}
          </div>
        )}

        {/* Video Info */}
        {state === "info" && videoInfo && (
          <section className="mb-6">
            <div className="bg-bg-card border border-border rounded-2xl p-6 shadow-lg">
              <div className="flex gap-5 flex-col sm:flex-row items-start">
                {videoInfo.thumbnail && (
                  <div className="sm:w-[180px] w-full flex-shrink-0 rounded-lg overflow-hidden">
                    <img
                      src={videoInfo.thumbnail}
                      alt="Thumbnail do vídeo"
                      className="w-full aspect-video object-cover bg-bg-primary"
                      loading="lazy"
                    />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h2 className="text-[1.2rem] font-bold mb-3 leading-snug break-words">
                    {videoInfo.title || "Sem título"}
                  </h2>
                  <div className="flex flex-col gap-1.5">
                    {videoInfo.uploader && (
                      <p className="flex items-center gap-2 text-[0.9rem] text-text-secondary">
                        <span>👤</span>
                        <span>{videoInfo.uploader}</span>
                      </p>
                    )}
                    {videoInfo.duration != null && videoInfo.duration > 0 && (
                      <p className="flex items-center gap-2 text-[0.9rem] text-text-secondary">
                        <span>⏱️</span>
                        <span>{formatDuration(videoInfo.duration)}</span>
                      </p>
                    )}
                    {videoInfo.source && (
                      <p className="flex items-center gap-2 text-[0.9rem] text-text-secondary">
                        <span>🌐</span>
                        <span>{formatSource(videoInfo.source)}</span>
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Quality */}
              <div className="mt-5 pt-5 border-t border-border flex items-center gap-3 flex-wrap">
                <label htmlFor="quality-select" className="text-[0.9rem] font-semibold text-text-secondary">
                  Qualidade do MP3:
                </label>
                <select
                  id="quality-select"
                  className="px-4 py-2.5 text-[0.95rem] bg-bg-input text-text-primary border-2 border-border rounded-lg cursor-pointer min-w-[140px]"
                  style={{
                    outline: "none",
                    appearance: "none",
                    backgroundImage:
                      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2394a3b8' d='M6 8L1 3h10z'/%3E%3C/svg%3E\")",
                    backgroundRepeat: "no-repeat",
                    backgroundPosition: "right 12px center",
                    paddingRight: "36px",
                  }}
                  value={quality}
                  onChange={(e) => setQuality(parseInt(e.target.value, 10))}
                  aria-label="Qualidade do MP3"
                >
                  <option value={128}>128 kbps</option>
                  <option value={192}>192 kbps</option>
                  <option value={256}>256 kbps</option>
                  <option value={320}>320 kbps</option>
                </select>
              </div>

              {/* Convert button */}
              <button
                className="w-full mt-4 px-6 py-4 text-[1.05rem] font-semibold text-white rounded-xl transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{ background: "linear-gradient(135deg, #3b82f6, #8b5cf6)" }}
                onClick={handleConvert}
                aria-label="Converter para MP3"
              >
                <span>🎵</span>
                <span>Converter para MP3</span>
              </button>
            </div>
          </section>
        )}

        {/* Result */}
        {state === "done" && mp3BlobUrl && (
          <section className="mb-6">
            <div className="bg-bg-card border border-accent-green rounded-2xl p-8 text-center shadow-lg">
              <div className="text-5xl mb-3">✅</div>
              <h3 className="text-[1.4rem] font-bold text-accent-green mb-2">MP3 pronto!</h3>
              <p className="text-sm text-text-muted mb-5 break-all">{mp3Filename}</p>

              {/* Audio Player */}
              <div className="mb-5">
                <audio
                  ref={audioRef}
                  controls
                  src={mp3BlobUrl}
                  className="w-full rounded-lg"
                  preload="metadata"
                >
                  Seu navegador não suporta o elemento de áudio.
                </audio>
              </div>

              {/* Download button */}
              <button
                className="w-full px-6 py-4 text-[1.05rem] font-semibold bg-accent-green hover:bg-accent-green-hover text-white rounded-xl transition-colors flex items-center justify-center gap-2"
                onClick={handleDownload}
                aria-label="Baixar MP3"
              >
                <span>⬇️</span>
                <span>Baixar MP3</span>
              </button>

              {/* New conversion */}
              <button
                className="w-full mt-3 px-6 py-3 text-[0.95rem] font-semibold bg-bg-hover hover:bg-border text-text-secondary hover:text-text-primary rounded-xl transition-colors"
                onClick={() => {
                  resetAll();
                  setUrl("");
                }}
                aria-label="Converter outro vídeo"
              >
                Nova conversão
              </button>
            </div>
          </section>
        )}

        {/* Error */}
        {state === "error" && errorMsg && (
          <section className="mb-6">
            <div className="bg-bg-card border border-accent-red rounded-2xl p-8 text-center shadow-lg">
              <div className="text-5xl mb-3">❌</div>
              <p className="text-base text-accent-red mb-5 leading-relaxed">{errorMsg}</p>
              <button
                className="w-full px-6 py-3 text-[0.95rem] font-semibold bg-bg-hover hover:bg-border text-text-secondary hover:text-text-primary rounded-xl transition-colors"
                onClick={() => {
                  setState("idle");
                  setErrorMsg("");
                }}
                aria-label="Tentar novamente"
              >
                Tentar novamente
              </button>
            </div>
          </section>
        )}

        {/* Idle state */}
        {state === "idle" && (
          <div className="mt-12 text-center text-text-muted">
            <p className="text-4xl mb-3">🎶</p>
            <p>Cole o link de um vídeo acima para começar!</p>
          </div>
        )}

        {/* Legal Notice */}
        <div className="mt-12 text-center text-xs text-text-muted max-w-lg mx-auto space-y-1">
          <p>
            ⚠️ Use o Video2MP3 somente com conteúdos que você tenha autorização para baixar ou converter.
          </p>
          <p>
            🔒 Os arquivos utilizados durante o processamento são temporários e removidos após a conversão.
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-4 text-center text-xs text-text-muted bg-bg-secondary">
        Video2MP3 · Conversão de vídeo para MP3 · Powered by FFmpeg
      </footer>
    </div>
  );
}
