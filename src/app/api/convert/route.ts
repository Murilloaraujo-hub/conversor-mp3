import { NextRequest } from "next/server";
import fs from "fs/promises";
import { validateUrl } from "@/lib/validate-url";
import { convertToMp3, cleanupFile } from "@/lib/ytdlp";
import { checkRateLimit } from "@/lib/rate-limit";
import { acquireSlot, releaseSlot } from "@/lib/concurrency";

export const dynamic = "force-dynamic";

const VALID_QUALITIES = new Set([128, 192, 256, 320]);

export async function POST(request: NextRequest) {
  // Rate limiting
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return Response.json(
      { success: false, error: "Muitas requisições. Tente novamente em alguns instantes." },
      { status: 429 }
    );
  }

  let mp3Path: string | null = null;

  try {
    const body = await request.json().catch(() => null);
    if (!body || !body.url) {
      return Response.json(
        { success: false, error: "URL não fornecida." },
        { status: 400 }
      );
    }

    const url = String(body.url).trim();
    let quality = body.quality ?? 192;

    // Validate URL
    const validation = await validateUrl(url);
    if (!validation.valid) {
      return Response.json(
        { success: false, error: validation.error },
        { status: 400 }
      );
    }

    // Validate quality
    try {
      quality = parseInt(String(quality), 10);
    } catch {
      return Response.json(
        { success: false, error: "Qualidade inválida. Use: 128, 192, 256 ou 320." },
        { status: 400 }
      );
    }

    if (!VALID_QUALITIES.has(quality)) {
      return Response.json(
        { success: false, error: "Qualidade inválida. Use: 128, 192, 256 ou 320." },
        { status: 400 }
      );
    }

    const source = validation.source || "direct";

    // Usar URL normalizada (vídeo único, sem start_radio/list/rv)
    const processUrl = validation.normalizedUrl || url;
    if (processUrl !== url) {
      console.log(`[Video2MP3] YouTube URL normalizada: ${url.slice(0, 80)}... -> ${processUrl}`);
    }

    // Check concurrency
    await acquireSlot();

    try {
      console.log(`[Video2MP3] Starting conversion: ${processUrl.substring(0, 80)}... (quality=${quality})`);

      const result = await convertToMp3(processUrl, quality, source);
      mp3Path = result.mp3Path;

      // Read the MP3 file
      const mp3Buffer = await fs.readFile(mp3Path);

      if (mp3Buffer.length === 0) {
        return Response.json(
          { success: false, error: "Erro na conversão: arquivo MP3 vazio." },
          { status: 500 }
        );
      }

      // Clean up the temp file
      await cleanupFile(mp3Path);
      mp3Path = null;

      const safeFilename = encodeURIComponent(result.filename);

      console.log(`[Video2MP3] Conversion complete: ${result.filename} (${mp3Buffer.length} bytes)`);

      return new Response(mp3Buffer, {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Disposition": `attachment; filename="${safeFilename}"`,
          "Content-Length": String(mp3Buffer.length),
        },
      });
    } finally {
      releaseSlot();
    }
  } catch (error: unknown) {
    // Clean up on error
    if (mp3Path) await cleanupFile(mp3Path);

    const message = error instanceof Error ? error.message : "Erro interno durante a conversão.";
    console.error("[Video2MP3] Convert error:", message);

    return Response.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
