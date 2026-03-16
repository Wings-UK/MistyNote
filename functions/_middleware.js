const SUPABASE_URL     = 'https://rhmknjlxddxkfybcfgjj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJobWtuamx4ZGR4a2Z5YmNmZ2pqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk0MzM4OTgsImV4cCI6MjA4NTAwOTg5OH0.dNBxXmIdYAxJT-bt1WWcO62Nobt8aDLTRdnrs5g1CCI';

const DEFAULT = {
  title:       'MistyNote — Share your world. Connect your vibe.',
  description: 'Join MistyNote — the social platform where creators share moments, connect with fans, and build community.',
  image:       'https://mistynote.pages.dev/og-default.png',
};

async function fetchPost(postId) {
  const url = `${SUPABASE_URL}/rest/v1/posts?id=eq.${postId}&select=content,image,user:users(username,avatar)&limit=1`;
  const res = await fetch(url, {
    headers: {
      'apikey':        SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    }
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.[0] || null;
}

async function fetchProfile(username) {
  const url = `${SUPABASE_URL}/rest/v1/users?username=ilike.${encodeURIComponent(username)}&select=username,avatar,bio&limit=1`;
  const res = await fetch(url, {
    headers: {
      'apikey':        SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    }
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.[0] || null;
}

function buildTags(meta) {
  const { title, description, image, url } = meta;
  return `
    <meta property="og:type"        content="website" />
    <meta property="og:site_name"   content="MistyNote" />
    <meta property="og:title"       content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:image"       content="${esc(image)}" />
    <meta property="og:url"         content="${esc(url)}" />
    <meta name="twitter:card"        content="summary_large_image" />
    <meta name="twitter:title"       content="${esc(title)}" />
    <meta name="twitter:description" content="${esc(description)}" />
    <meta name="twitter:image"       content="${esc(image)}" />
    <meta name="description"         content="${esc(description)}" />
  `;
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

class HeadInjector {
  constructor(tags) { this.tags = tags; }
  element(element) { element.prepend(this.tags, { html: true }); }
}

export async function onRequest(context) {
  const { request, next } = context;
  const { pathname } = new URL(request.url);

  // Only intercept post and profile routes — pass everything else through
  const postMatch    = pathname.match(/^\/post\/([^/]+)$/);
  const profileMatch = pathname.match(/^\/profile\/([^/]+)$/);

  if (!postMatch && !profileMatch) {
    return next();
  }

  // Fetch the base HTML response first
  const response = await next();

  let meta = { ...DEFAULT, url: request.url };

  try {
    if (postMatch) {
      const post = await fetchPost(postMatch[1]);
      if (post) {
        const author   = post.user?.username || 'MistyNote';
        const content  = post.content ? post.content.slice(0, 160) : 'View this post on MistyNote';
        const image    = post.image || DEFAULT.image;
        meta = {
          title:       `${author} on MistyNote`,
          description: content,
          image,
          url:         request.url,
        };
      }
    } else if (profileMatch) {
      const profile = await fetchProfile(profileMatch[1]);
      if (profile) {
        const image = profile.avatar || DEFAULT.image;
        meta = {
          title:       `${profile.username} on MistyNote`,
          description: profile.bio || `Check out ${profile.username}'s profile on MistyNote`,
          image,
          url:         request.url,
        };
      }
    }
  } catch (e) {
    // Silently fall back to defaults on any error
  }

  const tags = buildTags(meta);

  const transformed = new HTMLRewriter()
    .on('head', new HeadInjector(tags))
    .transform(response);

  // ── Security headers ──
  const headers = new Headers(transformed.headers);

  // Content Security Policy — blocks XSS, only allows scripts from self
  headers.set('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +   // unsafe-inline needed for inline scripts in index.html
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data: blob: https:; " +   // https: allows all image CDNs
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://nominatim.openstreetmap.org; " +
    "media-src 'self' blob: https:; " +
    "frame-ancestors 'none';"                  // prevents clickjacking
  );

  // Prevent MIME sniffing
  headers.set('X-Content-Type-Options', 'nosniff');

  // Prevent clickjacking
  headers.set('X-Frame-Options', 'DENY');

  // Force HTTPS
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  // Don't send referrer to external sites
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Limit browser features
  headers.set('Permissions-Policy', 'geolocation=(self), microphone=(self), camera=()');

  return new Response(transformed.body, {
    status:  transformed.status,
    headers,
  });
}
