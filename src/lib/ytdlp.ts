/**
 * yt-dlp wrapper for Node.js using child_process
 * Calls yt-dlp CLI directly with safe argument passing (never shell=true)
 */

import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";

const CONVERSION_TIMEOUT = parseInt(process.env.CONVERSION_TIMEOUT_SECONDS || "300", 10) * 1000;
const MAX_DURATION = parseInt(process.env.MAX_DURATION_SECONDS || "3600", 10);

export interface VideoInfo {
  title?: string;
  uploader?: string;
  duration?: number;
  thumbnail?: string;
  source: string;
}

export interface ConvertResult {
  mp3Path: string;
  title: string;
  filename: string;
}

/**
 * Find ffmpeg location
 */
function findFfmpegDir(): string[] {
  // Try common locations
  const locations = ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"];
  for (const loc of locations) {
    // We pass the directory containing ffmpeg, not the binary itself
    return ["--ffmpeg-location", path.dirname(loc)];
  }
  return [];
}

/**
 * Parse yt-dlp error into user-friendly message
 */
function parseYtdlpError(stderr: string): string {
  const lower = stderr.toLowerCase();
  if (lower.includes("private")) {
    return "Este vídeo é privado e não pode ser acessado.";
  }
  if (lower.includes("unavailable") || lower.includes("not available")) {
    return "Este vídeo não está disponível.";
  }
  if (lower.includes("sign in") || lower.includes("login") || lower.includes("age")) {
    return "Este conteúdo requer autenticação e não pode ser acessado.";
  }
  if (lower.includes("copyright") || lower.includes("blocked")) {
    return "Este conteúdo está bloqueado por direitos autorais.";
  }
  if (lower.includes("geo") || lower.includes("country")) {
    return "Este conteúdo não está disponível na sua região.";
  }
  if (lower.includes("is not a valid url") || lower.includes("unsupported url")) {
    return "URL não suportada. Verifique se o link é válido.";
  }
  return "Não foi possível processar o vídeo. Verifique se o link é válido e o conteúdo é público.";
}

/**
 * Get video info using yt-dlp --dump-json
 */
export async function getVideoInfo(url: string, source: string): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    const args = [
      "--dump-json",
      "--no-download",
      "--no-playlist",
      "--socket-timeout", "30",
      "--no-warnings",
      ...findFfmpegDir(),
      "--", url,
    ];

    const proc = spawn("yt-dlp", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("Tempo limite excedido ao obter informações do vídeo."));
    }, 60000);

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Erro ao executar yt-dlp: ${err.message}`));
    });

    proc.on("close", (code) => {
      clearTimeout(timer);

      if (code !== 0) {
        reject(new Error(parseYtdlpError(stderr)));
        return;
      }

      try {
        const info = JSON.parse(stdout);
        const result: VideoInfo = { source };

        if (info.title) result.title = String(info.title);
        if (info.uploader || info.channel) result.uploader = String(info.uploader || info.channel);
        if (info.duration != null) result.duration = Math.round(Number(info.duration));
        if (info.thumbnail) result.thumbnail = String(info.thumbnail);

        // Check duration limit
        if (result.duration && result.duration > MAX_DURATION) {
          reject(new Error(`Vídeo muito longo (${result.duration}s). Limite: ${MAX_DURATION}s.`));
          return;
        }

        resolve(result);
      } catch {
        reject(new Error("Erro ao processar informações do vídeo."));
      }
    });
  });
}

/**
 * Download and convert to MP3 using yt-dlp + FFmpeg
 */
export async function convertToMp3(url: string, quality: number, _source: string): Promise<ConvertResult> {
  const tmpDir = path.join(process.cwd(), "tmp", "video2mp3");
  await fs.mkdir(tmpDir, { recursive: true });

  const jobId = uuidv4();
  const outputTemplate = path.join(tmpDir, `${jobId}.%(ext)s`);

  // First get the title
  let title = "video2mp3";
  try {
    const infoArgs = [
      "--dump-json", "--no-download", "--no-playlist",
      "--socket-timeout", "15", "--no-warnings",
      ...findFfmpegDir(),
      "--", url,
    ];
    const infoResult = await runCommand("yt-dlp", infoArgs, 30000);
    const info = JSON.parse(infoResult);
    if (info.title) title = String(info.title);
  } catch {
    // Use default title
  }

  return new Promise((resolve, reject) => {
    const args = [
      "--format", "bestaudio/best",
      "--extract-audio",
      "--audio-format", "mp3",
      "--audio-quality", `${quality}k`,
      "--output", outputTemplate,
      "--no-playlist",
      "--socket-timeout", "30",
      "--no-warnings",
      ...findFfmpegDir(),
      "--", url,
    ];

    const proc = spawn("yt-dlp", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      cleanupJobFiles(tmpDir, jobId).catch(() => {});
      reject(new Error("Tempo limite excedido durante a conversão."));
    }, CONVERSION_TIMEOUT);

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      cleanupJobFiles(tmpDir, jobId).catch(() => {});
      reject(new Error(`Erro ao executar yt-dlp: ${err.message}`));
    });

    proc.on("close", async (code) => {
      clearTimeout(timer);

      if (code !== 0) {
        cleanupJobFiles(tmpDir, jobId).catch(() => {});
        reject(new Error(parseYtdlpError(stderr)));
        return;
      }

      // Find the MP3 file
      const mp3Path = path.join(tmpDir, `${jobId}.mp3`);

      try {
        await fs.access(mp3Path);
        const stat = await fs.stat(mp3Path);
        if (stat.size === 0) {
          cleanupJobFiles(tmpDir, jobId).catch(() => {});
          reject(new Error("Arquivo MP3 gerado está vazio."));
          return;
        }

        resolve({
          mp3Path,
          title,
          filename: sanitizeFilename(title) + ".mp3",
        });
      } catch {
        // Try to find any MP3 in temp dir with our jobId prefix
        try {
          const files = await fs.readdir(tmpDir);
          const match = files.find((f) => f.startsWith(jobId) && f.endsWith(".mp3"));
          if (match) {
            resolve({
              mp3Path: path.join(tmpDir, match),
              title,
              filename: sanitizeFilename(title) + ".mp3",
            });
          } else {
            cleanupJobFiles(tmpDir, jobId).catch(() => {});
            reject(new Error("Arquivo MP3 não foi gerado."));
          }
        } catch {
          cleanupJobFiles(tmpDir, jobId).catch(() => {});
          reject(new Error("Erro ao localizar o arquivo MP3."));
        }
      }
    });
  });
}

function runCommand(cmd: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    const timer = setTimeout(() => { proc.kill("SIGKILL"); reject(new Error("Timeout")); }, timeout);
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.on("close", (code) => { clearTimeout(timer); if (code === 0) resolve(stdout); else reject(new Error(`Exit code ${code}`)); });
    proc.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

async function cleanupJobFiles(dir: string, jobId: string): Promise<void> {
  try {
    const files = await fs.readdir(dir);
    for (const f of files) {
      if (f.startsWith(jobId)) {
        await fs.unlink(path.join(dir, f)).catch(() => {});
      }
    }
  } catch {
    // Ignore errors
  }
}

function sanitizeFilename(name: string): string {
  if (!name) return "video2mp3";
  let safe = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "");
  safe = safe.replace(/\.\./g, "").replace(/[/\\]/g, "");
  safe = safe.trim().replace(/^\.+/, "");
  if (safe.length > 150) safe = safe.substring(0, 150);
  if (!safe) safe = "video2mp3";
  return safe;
}

export async function cleanupFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // Ignore
  }
}
