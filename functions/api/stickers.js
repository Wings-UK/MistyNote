// Cloudflare Pages Function — /api/stickers
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
  const token = context.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    return new Response(JSON.stringify({ error: 'Bot token not configured' }), {
      status: 500, headers: corsHeaders,
    });
  }

  try {
    const res  = await fetch(`https://api.telegram.org/bot${token}/getStickerSet?name=${pack}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.description);

    // Resolve both sticker URL and thumbnail URL for each sticker
    const stickers = await Promise.all(
      data.result.stickers.slice(0, 30).map(async sticker => {
        try {
          // Get main file URL
          const fileRes  = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${sticker.file_id}`);
          const fileData = await fileRes.json();
          const filePath = fileData.result?.file_path;

          // Get thumbnail URL (static WebP — works in all browsers)
          let thumbUrl = null;
          if (sticker.thumbnail?.file_id) {
            const thumbRes  = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${sticker.thumbnail.file_id}`);
            const thumbData = await thumbRes.json();
            if (thumbData.result?.file_path) {
              thumbUrl = `https://api.telegram.org/file/bot${token}/${thumbData.result.file_path}`;
            }
          }

          return {
            file_id:     sticker.file_id,
            is_animated: sticker.is_animated,
            file_url:    filePath ? `https://api.telegram.org/file/bot${token}/${filePath}` : null,
            thumb_url:   thumbUrl,
          };
        } catch { return null; }
      })
    );

    return new Response(JSON.stringify({
      pack:     data.result.name,
      title:    data.result.title,
      stickers: stickers.filter(Boolean),
    }), {
      headers: { ...corsHeaders, 'Cache-Control': 'public, max-age=3600' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: corsHeaders,
    });
  }
}
