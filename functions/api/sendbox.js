// functions/api/sendbox.js
// Cloudflare Pages Function — proxies all Sendbox API calls from the frontend.
// Sits at: https://mistynote.pages.dev/api/sendbox
//
// The frontend POSTs: { path, method, body, token }
// This function forwards to: https://api.sendbox.co{path}
// and returns the Sendbox JSON response.

export async function onRequestPost(context) {

  try {

    const { path, method = 'POST', body, token } = await context.request.json();

    if (!path) {
      return new Response(JSON.stringify({ error: 'Missing path' }), {
        status: 400,
        headers: corsHeaders(),
      });
    }

    const sendboxRes = await fetch('https://api.sendbox.co' + path, {
      method,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await sendboxRes.json();

    // Always return full Sendbox response so frontend can read the real error
    console.log('[Sendbox Proxy]', sendboxRes.status, JSON.stringify(data));

    return new Response(JSON.stringify(data), {
      status: sendboxRes.status,
      headers: corsHeaders(),
    });

  } catch (err) {

    return new Response(JSON.stringify({ error: err.message || 'Proxy error' }), {
      status: 500,
      headers: corsHeaders(),
    });

  }

}

// Handle CORS preflight
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function corsHeaders() {
  return {
    'Content-Type':                'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
