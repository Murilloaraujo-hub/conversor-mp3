/**
 * URL validation and SSRF prevention for Video2MP3
 */

import { lookup } from "dns/promises";
import net from "net";

const BLOCKED_SCHEMES = new Set(["file:", "javascript:", "data:", "ftp:", "gopher:"]);

const YOUTUBE_DOMAINS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "music.youtube.com",
]);

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
]);

function isPrivateIP(ip: string): boolean {
  if (!net.isIP(ip)) return false;

  // IPv4 private ranges
  const parts = ip.split(".").map(Number);
  if (parts.length === 4) {
    // 10.0.0.0/8
    if (parts[0] === 10) return true;
    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 127.0.0.0/8 (loopback)
    if (parts[0] === 127) return true;
    // 169.254.0.0/16 (link-local)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 0.0.0.0
    if (parts.every((p) => p === 0)) return true;
  }

  return false;
}

export interface UrlValidationResult {
  valid: boolean;
  error?: string;
  source?: string;
  hostname?: string;
  normalizedUrl?: string;
}

/**
 * Extrai o ID do vídeo de uma URL do YouTube.
 * Suporta start_radio, list, rv e outros parâmetros extras sem rejeitar.
 * Prioriza o parâmetro v=VIDEO_ID. Retorna null se não identificar o ID.
 */
export function extractYouTubeVideoId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();

  // youtu.be/VIDEO_ID
  if (hostname === "youtu.be") {
    const path = parsed.pathname.replace(/^\/+/, "");
    if (path) {
      const id = path.split("/")[0];
      if (id) return id;
    }
    return null;
  }

  // Demais domínios YouTube
  const path = parsed.pathname.replace(/^\/+/, "");

  // 1) Prioridade máxima: parâmetro v=VIDEO_ID
  const vParam = parsed.searchParams.get("v");
  if (vParam) return vParam;

  // 2) Caminhos: /shorts/ID, /live/ID, /embed/ID
  for (const prefix of ["shorts/", "live/", "embed/"]) {
    if (path.startsWith(prefix)) {
      const id = path.slice(prefix.length).split("/")[0];
      if (id) return id;
    }
  }

  return null;
}

/**
 * Normaliza uma URL do YouTube para uma URL limpa contendo apenas o vídeo.
 * Ignora start_radio, list, rv, etc., garantindo que só o vídeo seja processado.
 */
export function normalizeYouTubeUrl(url: string): string {
  const id = extractYouTubeVideoId(url);
  if (id) {
    return `https://www.youtube.com/watch?v=${id}`;
  }
  return url;
}

export async function validateUrl(url: string): Promise<UrlValidationResult> {
  if (!url || typeof url !== "string") {
    return { valid: false, error: "URL não fornecida." };
  }

  url = url.trim();

  if (url.length === 0) {
    return { valid: false, error: "URL não fornecida." };
  }

  if (url.length > 2048) {
    return { valid: false, error: "URL muito longa." };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: "URL malformada." };
  }

  // Block dangerous schemes
  if (BLOCKED_SCHEMES.has(parsed.protocol)) {
    return { valid: false, error: `Esquema '${parsed.protocol}' não é permitido.` };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { valid: false, error: "Apenas URLs HTTP/HTTPS são aceitas." };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) {
    return { valid: false, error: "URL sem hostname válido." };
  }

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { valid: false, error: "Endereço não permitido." };
  }

  // Check if hostname is an IP
  if (net.isIP(hostname) && isPrivateIP(hostname)) {
    return { valid: false, error: "Endereço não permitido." };
  }

  // DNS resolution check for non-IP hostnames
  if (!net.isIP(hostname)) {
    try {
      const result = await lookup(hostname);
      if (isPrivateIP(result.address)) {
        return { valid: false, error: "Endereço não permitido." };
      }
    } catch {
      // DNS resolution failure - let yt-dlp handle it
    }
  }

  // Identify source
  const source = YOUTUBE_DOMAINS.has(hostname) ? "youtube" : "direct";

  // Normalizar URL do YouTube (extrai vídeo via v=, ignora start_radio/list/rv)
  let normalizedUrl = url;
  if (source === "youtube") {
    normalizedUrl = normalizeYouTubeUrl(url);
  }

  return { valid: true, source, hostname, normalizedUrl };
}
