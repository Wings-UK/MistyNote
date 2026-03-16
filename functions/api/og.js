// Cloudflare Pages Function — /api/og
// Fetches Open Graph metadata from any URL server-side (no CORS issues)
// Usage: GET /api/og?url=https://example.com

export async function onRequest(context) {
  const { request } = context;

  // CORS headers — allow requests from your own domain
  const corsHeaders = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) {
    return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
      status: 400, headers: corsHeaders,
    });
  }

  // Validate URL
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('Invalid');
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid URL' }), {
      status: 400, headers: corsHeaders,
    });
  }

  try {
    // Fetch the page with a browser-like user agent
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MistyNote/1.0; +https://mistynote.pages.dev)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ error: 'Failed to fetch URL' }), {
        status: 502, headers: corsHeaders,
      });
    }

    const html = await res.text();

    // Parse OG tags with simple regex — no DOM parser in Workers
    const getTag = (property) => {
      const patterns = [
        new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, 'i'),
      ];
      for (const re of patterns) {
        const m = html.match(re);
        if (m) return decodeHtmlEntities(m[1].trim());
      }
      return '';
    };

    const getMetaName = (name) => {
      const re = new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i');
      const m  = html.match(re);
      return m ? decodeHtmlEntities(m[1].trim()) : '';
    };

    const getTitleTag = () => {
      const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      return m ? decodeHtmlEntities(m[1].trim()) : '';
    };

    const og = {
      title:       getTag('og:title')       || getMetaName('title') || getTitleTag(),
      description: getTag('og:description') || getMetaName('description'),
      image:       getTag('og:image')       || getTag('og:image:url'),
      siteName:    getTag('og:site_name'),
      domain:      parsedUrl.hostname.replace('www.', ''),
      url,
    };

    // Cache for 1 hour
    return new Response(JSON.stringify(og), {
      headers: {
        ...corsHeaders,
        'Cache-Control': 'public, max-age=3600',
      },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: corsHeaders,
    });
  }
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'");
}
