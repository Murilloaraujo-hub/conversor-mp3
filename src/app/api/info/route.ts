import { NextRequest } from "next/server";
import { validateUrl } from "@/lib/validate-url";
import { getVideoInfo } from "@/lib/ytdlp";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

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

  try {
    const body = await request.json().catch(() => null);
    if (!body || !body.url) {
      return Response.json(
        { success: false, error: "URL não fornecida." },
        { status: 400 }
      );
    }

    const url = String(body.url).trim();

    // Validate URL
    const validation = await validateUrl(url);
    if (!validation.valid) {
      return Response.json(
        { success: false, error: validation.error },
        { status: 400 }
      );
    }

    const source = validation.source || "direct";

    // Usar URL normalizada (vídeo único, sem start_radio/list/rv)
    const processUrl = validation.normalizedUrl || url;
    if (processUrl !== url) {
      console.log(`[Video2MP3] YouTube URL normalizada: ${url.slice(0, 80)}... -> ${processUrl}`);
    }

    // Get video info via yt-dlp
    try {
      const info = await getVideoInfo(processUrl, source);

      const result: Record<string, unknown> = {
        success: true,
        source: info.source,
      };

      if (info.title) result.title = info.title;
      if (info.uploader) result.uploader = info.uploader;
      if (info.duration != null) result.duration = info.duration;
      if (info.thumbnail) result.thumbnail = info.thumbnail;

      return Response.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Não foi possível obter informações do vídeo.";
      console.error("[Video2MP3] Info error:", message);
      return Response.json(
        { success: false, error: message },
        { status: 400 }
      );
    }
  } catch (error: unknown) {
    console.error("[Video2MP3] Unexpected error in /api/info:", error);
    return Response.json(
      { success: false, error: "Erro interno ao processar a requisição." },
      { status: 500 }
    );
  }
}
