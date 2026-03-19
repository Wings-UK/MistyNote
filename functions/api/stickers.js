// Cloudflare Pages Function — /api/stickers
// Fetches Telegram sticker pack server-side keeping bot token secret
// Usage: GET /api/stickers?pack=Milk_Mocha_by_cocopry

export async function onRequest(context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const { searchParams } = new URL(context.request.url);
  const pack = searchParams.get('pack') || 'Milk_Mocha_by_cocopry';

  // Bot token from environment variable — never exposed to browser
  const token = context.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return new Response(JSON.stringify({ error: 'Bot token not configured' }), {
      status: 500, headers: corsHeaders,
    });
  }

  try {
    // Fetch sticker set metadata
    const res = await fetch(
      `https://api.telegram.org/bot${token}/getStickerSet?name=${pack}`
    );
    const data = await res.json();

    if (!data.ok) {
      return new Response(JSON.stringify({ error: data.description }), {
        status: 400, headers: corsHeaders,
      });
    }

    // For each sticker, get the file path so browser can display it
    const stickers = await Promise.all(
      data.result.stickers.slice(0, 30).map(async sticker => {
        try {
          const fileRes = await fetch(
            `https://api.telegram.org/bot${token}/getFile?file_id=${sticker.file_id}`
          );
          const fileData = await fileRes.json();
          const filePath = fileData.result?.file_path;
          return {
            file_id:      sticker.file_id,
            is_animated:  sticker.is_animated,
            is_video:     sticker.is_video,
            file_url:     filePath
              ? `https://api.telegram.org/file/bot${token}/${filePath}`
              : null,
            thumb_url:    sticker.thumbnail?.file_id
              ? null  // resolve separately if needed
              : null,
          };
        } catch {
          return null;
        }
      })
    );

    return new Response(JSON.stringify({
      pack: data.result.name,
      title: data.result.title,
      stickers: stickers.filter(Boolean),
    }), {
      headers: {
        ...corsHeaders,
        'Cache-Control': 'public, max-age=3600', // cache 1 hour
      },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: corsHeaders,
    });
  }
}
