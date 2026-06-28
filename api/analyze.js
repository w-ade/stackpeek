// Serverless function: fetch a target URL server-side (browsers can't, CORS),
// pull a few linked stylesheets for richer signal, run the detection engine.
const { analyze } = require('./_detect');

function isBlockedHost(host) {
  host = host.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local')) return true;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (host === '::1' || host === '[::1]') return true;
  return false;
}

async function grab(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) stackpeek/1.0', 'accept': 'text/html,*/*' },
      redirect: 'follow', signal: ctrl.signal,
    });
  } finally { clearTimeout(t); }
}

module.exports = async (req, res) => {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  let target;
  try {
    const sp = new URL(req.url, 'http://x').searchParams;
    target = (sp.get('url') || '').trim();
  } catch (e) {}
  if (!target) return res.end(JSON.stringify({ error: 'no url given' }));

  if (!/^https?:\/\//i.test(target)) target = 'https://' + target;
  let parsed;
  try { parsed = new URL(target); } catch (e) { return res.end(JSON.stringify({ error: 'that does not look like a url' })); }
  if (!/^https?:$/.test(parsed.protocol)) return res.end(JSON.stringify({ error: 'only http/https' }));
  if (isBlockedHost(parsed.hostname)) return res.end(JSON.stringify({ error: 'private/local hosts are blocked' }));

  try {
    const r = await grab(parsed.href, 12000);
    const html = (await r.text()).slice(0, 2_500_000);
    const headers = {}; r.headers.forEach((v, k) => headers[k] = v);

    // pull up to 4 linked stylesheets (fonts/colors/tailwind live there)
    const links = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi)]
      .map(m => (m[0].match(/href=["']([^"']+)["']/) || [])[1]).filter(Boolean).slice(0, 4);
    let css = '';
    for (const href of links) {
      try { const u = new URL(href, r.url).href; const cr = await grab(u, 6000); if (cr.ok) css += (await cr.text()).slice(0, 400_000) + '\n'; } catch (e) {}
    }

    const out = analyze({ html, css, headers, finalUrl: r.url });
    out.fetchedCss = links.length;
    return res.end(JSON.stringify(out));
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'the site took too long to respond' : 'could not reach that site';
    return res.end(JSON.stringify({ error: msg }));
  }
};
