// Pure detection engine: feed it the raw HTML + response headers, get back a
// categorized, teach-as-you-go read of the site's design/dev stack.
// No deps. Used by api/analyze.js and testable standalone with node.

function textBetween(html, re) { const m = html.match(re); return m ? m[1].trim() : null; }

function metaContent(html, name) {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i');
  const m = html.match(re);
  if (m) return m[1];
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, 'i');
  const m2 = html.match(re2);
  return m2 ? m2[1] : null;
}

function uniq(arr) { return [...new Set(arr)]; }

// each rule: {name, teach, test(ctx)->evidence|false}
const RULES = {
  framework: [
    { name: 'Next.js', teach: 'React framework by Vercel — file-based routing, server components, SSR/SSG.',
      test: c => (/\/_next\//.test(c.html) && '/_next/ asset paths') || (/__NEXT_DATA__/.test(c.html) && '__NEXT_DATA__ payload') || (/id=["']__next["']/.test(c.html) && '#__next root') || (/next\.js/i.test(c.h['x-powered-by']||'') && 'x-powered-by header') },
    { name: 'Nuxt', teach: 'The Vue meta-framework — Next.js for the Vue ecosystem.',
      test: c => (/__NUXT__/.test(c.html) && '__NUXT__ payload') || (/\/_nuxt\//.test(c.html) && '/_nuxt/ assets') },
    { name: 'Astro', teach: 'Content-first framework that ships zero JS by default; "islands" hydrate only what needs it.',
      test: c => (/astro-island|data-astro-/.test(c.html) && 'astro-island markers') || (/<meta[^>]+generator[^>]+Astro/i.test(c.html) && 'generator meta') },
    { name: 'SvelteKit', teach: 'The Svelte app framework — compiles components to tiny vanilla JS.',
      test: c => (/__sveltekit/i.test(c.html) && '__sveltekit data') || (/\/_app\/immutable\//.test(c.html) && '/_app/immutable assets') },
    { name: 'Remix', teach: 'React framework built on web fundamentals (forms, fetch, nested routes).',
      test: c => (/__remixContext|__remixManifest/.test(c.html) && 'remix context') },
    { name: 'Gatsby', teach: 'Older React static-site generator with a GraphQL data layer.',
      test: c => (/___gatsby/.test(c.html) && '#___gatsby root') || (/\/page-data\//.test(c.html) && 'page-data') },
    { name: 'Angular', teach: "Google's batteries-included TS framework.",
      test: c => (/ng-version=/.test(c.html) && 'ng-version attr') || (/_nghost|_ngcontent/.test(c.html) && 'ng host/content attrs') },
    { name: 'Vue (standalone)', teach: 'Progressive JS framework — likely without a meta-framework here.',
      test: c => (/data-v-[0-9a-f]{6,}/.test(c.html) && 'scoped data-v- attrs') },
    { name: 'React (standalone)', teach: 'React rendered without an obvious meta-framework (CRA/Vite/custom).',
      test: c => (/data-reactroot|_reactListening|react-dom/.test(c.html) && 'react-dom markers') },
  ],
  hosting: [
    { name: 'Vercel', teach: 'Hosting/CDN built around frontend frameworks; edge network + serverless functions.',
      test: c => (c.h['x-vercel-id'] && 'x-vercel-id header') || (/vercel/i.test(c.h['server']||'') && 'server: Vercel') || (/_vercel\//.test(c.html) && '/_vercel asset') },
    { name: 'Netlify', teach: 'Frontend hosting/CDN with build + serverless functions.',
      test: c => (c.h['x-nf-request-id'] && 'x-nf-request-id') || (/netlify/i.test(c.h['server']||'') && 'server: Netlify') },
    { name: 'Cloudflare', teach: 'CDN / edge platform sitting in front of the origin (caching, DDoS, Workers).',
      test: c => (c.h['cf-ray'] && 'cf-ray header') || (/cloudflare/i.test(c.h['server']||'') && 'server: cloudflare') },
    { name: 'GitHub Pages', teach: 'Free static hosting straight from a GitHub repo.',
      test: c => (/github\.com|GitHub Pages/i.test(c.h['server']||'') && 'server: GitHub.com') },
    { name: 'AWS', teach: 'Amazon infrastructure (S3/CloudFront or similar) under the hood.',
      test: c => (Object.keys(c.h).some(k=>k.startsWith('x-amz-')) && 'x-amz-* headers') || (/AmazonS3|CloudFront/i.test(c.h['server']||c.h['via']||'') && 'AWS server/via') },
  ],
  styling: [
    { name: 'Tailwind CSS', teach: 'Utility-first CSS — you compose designs from atomic classes (flex, px-4, text-sm) instead of writing CSS.',
      test: c => (/--tw-[a-z-]+/.test(c.all) && '--tw-* custom properties') || (/cdn\.tailwindcss\.com/.test(c.html) && 'Play CDN') || (countTailwind(c.html) >= 6 && `${countTailwind(c.html)} utility classes in markup`) },
    { name: 'styled-components', teach: 'CSS-in-JS — styles live in your JS components, scoped automatically.',
      test: c => (/<style[^>]+data-styled/.test(c.html) && 'data-styled style tag') || (/\bsc-[a-zA-Z0-9]{6}\b/.test(c.html) && 'sc- hashed classes') },
    { name: 'Emotion', teach: 'CSS-in-JS library (often under MUI / other systems).',
      test: c => (/data-emotion/.test(c.html) && 'data-emotion style tag') || (/\bcss-[a-z0-9]{6,8}\b/.test(c.html) && 'css- hashed classes') },
    { name: 'CSS Modules', teach: 'Locally-scoped CSS files — class names get hashed at build to avoid collisions.',
      test: c => (/class=["'][^"']*[A-Za-z]+_[A-Za-z0-9]+__[A-Za-z0-9]{5}/.test(c.html) && 'module__hash class names') },
  ],
  ui: [
    { name: 'Radix UI', teach: 'Unstyled, accessible React primitives (the a11y engine behind shadcn/ui).',
      test: c => (/data-radix-|data-\[state/.test(c.html) && 'data-radix attributes') },
    { name: 'shadcn/ui', teach: 'Copy-in component recipes built on Radix + Tailwind — not a dependency, you own the code.',
      test: c => (/data-radix-/.test(c.html) && /--tw-/.test(c.html) && 'Radix + Tailwind together') },
    { name: 'Material UI', teach: "Google's Material Design components for React.",
      test: c => (/\bMui[A-Z][a-zA-Z]+\b/.test(c.html) && 'Mui* class names') },
    { name: 'Chakra UI', teach: 'Themeable React component library.',
      test: c => (/chakra-/.test(c.html) && 'chakra- classes') },
    { name: 'Bootstrap', teach: 'The classic responsive CSS framework (grid, components).',
      test: c => (/\b(col-(sm|md|lg)-\d|navbar-|btn btn-)\b/.test(c.html) && 'bootstrap grid/components') },
  ],
  motion: [
    { name: 'Framer Motion / Motion', teach: 'The go-to React animation library — declarative springs, gestures, layout animation.',
      test: c => (/framer-motion|\bmotion-/.test(c.html) && 'framer-motion markers') || (/__framer/i.test(c.html) && 'framer runtime') },
    { name: 'GSAP', teach: 'Powerful imperative animation engine — timelines, ScrollTrigger.',
      test: c => (/gsap|TweenMax|ScrollTrigger/.test(c.html) && 'gsap reference') },
    { name: 'Lottie', teach: 'Renders After-Effects animations as JSON on the web.',
      test: c => (/lottie/i.test(c.html) && 'lottie reference') },
  ],
  icons: [
    { name: 'Lucide', teach: 'Open-source icon set (the Feather fork most React apps reach for).',
      test: c => (/lucide/i.test(c.html) && 'lucide reference') },
    { name: 'Tabler Icons', teach: 'Large, consistent open-source stroke icon set.',
      test: c => (/icon-tabler|tabler-icon/.test(c.html) && 'tabler icon classes') },
    { name: 'Font Awesome', teach: 'The ubiquitous icon font/library.',
      test: c => (/\bfa-[a-z]/.test(c.html) && 'fa- classes') || (/fontawesome/i.test(c.html) && 'fontawesome ref') },
    { name: 'Phosphor', teach: 'Flexible icon family with multiple weights.',
      test: c => (/phosphor/i.test(c.html) && 'phosphor ref') },
  ],
  analytics: [
    { name: 'Google Analytics', teach: 'Google’s traffic/behaviour analytics (gtag).',
      test: c => (/googletagmanager\.com|google-analytics\.com|gtag\(/.test(c.html) && 'gtag / GA script') },
    { name: 'Vercel Analytics', teach: 'Vercel’s privacy-friendly traffic + Web Vitals.',
      test: c => (/_vercel\/insights|_vercel\/speed-insights/.test(c.html) && '/_vercel/insights') },
    { name: 'Plausible', teach: 'Lightweight, cookie-free analytics.',
      test: c => (/plausible\.io/.test(c.html) && 'plausible script') },
    { name: 'PostHog', teach: 'Product analytics + session replay.',
      test: c => (/posthog/i.test(c.html) && 'posthog ref') },
  ],
  build: [
    { name: 'Turbopack', teach: 'Vercel’s Rust bundler — the fast Webpack successor in Next.js.',
      test: c => (/turbopack/i.test(c.html) && 'turbopack marker') },
    { name: 'Webpack', teach: 'The long-standing JS module bundler.',
      test: c => (/webpackJsonp|__webpack_require__|webpackChunk/.test(c.html) && 'webpack runtime') },
    { name: 'Vite', teach: 'Fast modern dev server + build tool (esbuild/Rollup).',
      test: c => (/\/@vite\/|\/assets\/index-[a-z0-9]{8}\.js/.test(c.html) && 'vite asset signature') },
  ],
};

// only look inside class="" attributes, not prose or CSS text
function countTailwind(html) {
  const classes = [...html.matchAll(/class=["']([^"']+)["']/g)].flatMap(m => m[1].split(/\s+/));
  const re = /^(flex|grid|hidden|block|inline-flex|absolute|relative|sticky|items-(center|start|end)|justify-(center|between|start|end|around)|gap-\d|px-\d|py-\d|pt-\d|pb-\d|mt-\d|mb-\d|mx-auto|text-(xs|sm|base|lg|xl|2xl|3xl)|font-(medium|semibold|bold)|bg-\w+-\d{2,3}|text-\w+-\d{2,3}|rounded(-\w+)?|shadow(-\w+)?|w-\d|h-\d|max-w-\w+|min-h-\w+|space-[xy]-\d|tracking-\w+|leading-\w+)$/;
  return uniq(classes.filter(c => re.test(c))).length;
}

function detectFonts(html) {
  const families = [];
  // Google Fonts
  const gf = /fonts\.googleapis\.com\/css2?\?([^"']+)/g; let g;
  while ((g = gf.exec(html))) {
    const fams = [...g[1].matchAll(/family=([^&:]+)/g)].map(x => decodeURIComponent(x[1]).replace(/\+/g, ' '));
    families.push(...fams);
  }
  const hasGoogle = /fonts\.g(oogleapis|static)\.com/.test(html);
  const hasAdobe = /use\.typekit\.net|p\.typekit\.net/.test(html);
  // @font-face families + font-family declarations
  const ff = [...html.matchAll(/font-family\s*:\s*([^;}]+)/gi)].map(m => m[1].split(',')[0].replace(/["']/g, '').trim());
  families.push(...ff.filter(f => f && !/^(inherit|sans-serif|serif|monospace|var\()/i.test(f) && f.length < 30));
  const selfHosted = (html.match(/@font-face/gi) || []).length;
  return {
    families: uniq(families).slice(0, 8),
    google: hasGoogle, adobe: hasAdobe, selfHostedFaces: selfHosted,
  };
}

function detectColors(html, headers) {
  const theme = metaContent(html, 'theme-color');
  const vars = uniq([...html.matchAll(/--[\w-]*colou?r[\w-]*\s*:\s*(#[0-9a-fA-F]{3,8}|rg...?\([^)]+\))/g)].map(m => m[1])).slice(0, 6);
  const hexes = uniq((html.match(/#[0-9a-fA-F]{6}\b/g) || [])).slice(0, 8);
  return { theme, vars, hexes };
}

function analyze({ html, css = '', headers, finalUrl }) {
  const h = {}; for (const k in (headers || {})) h[k.toLowerCase()] = headers[k];
  const all = html + '\n' + css;
  const ctx = { html, css, all, h };

  const groups = [];
  for (const [key, rules] of Object.entries(RULES)) {
    let items = [];
    for (const r of rules) {
      let ev; try { ev = r.test(ctx); } catch (e) { ev = false; }
      if (ev) items.push({ name: r.name, teach: r.teach, evidence: ev });
    }
    // a meta-framework already implies React/Vue — drop the redundant standalone hit
    if (key === 'framework' && items.length > 1) {
      const meta = items.some(i => /Next\.js|Nuxt|Astro|SvelteKit|Remix|Gatsby/.test(i.name));
      if (meta) items = items.filter(i => !/standalone/.test(i.name));
    }
    if (items.length) groups.push({ key, label: LABELS[key], items });
  }

  const fonts = detectFonts(all);
  const colors = detectColors(all, h);

  const title = textBetween(html, /<title[^>]*>([^<]*)<\/title>/i);
  const description = metaContent(html, 'description');
  const viewport = metaContent(html, 'viewport');
  const generator = metaContent(html, 'generator');
  const lang = textBetween(html, /<html[^>]+lang=["']([^"']+)["']/i);

  const meta = {
    title, description, viewport, generator, lang,
    og: !!metaContent(html, 'og:title'),
    twitter: !!metaContent(html, 'twitter:card'),
    manifest: /<link[^>]+rel=["']manifest["']/i.test(html),
    colorScheme: metaContent(html, 'color-scheme'),
    charset: /<meta[^>]+charset/i.test(html),
    server: h['server'] || null,
    poweredBy: h['x-powered-by'] || null,
  };

  // a few design-engineering observations
  const notes = [];
  if (fonts.google) notes.push('Loads Google Fonts over the network — a render-path cost; self-hosting is the perf-minded alternative.');
  if (fonts.selfHostedFaces > 0) notes.push(`Self-hosts ${fonts.selfHostedFaces} @font-face declaration(s) — fonts served from origin, no third-party request.`);
  if (groups.find(g => g.key === 'styling' && g.items.some(i => i.name === 'Tailwind CSS'))) notes.push('Tailwind: design decisions live in the markup as utility classes — read the class lists to reverse-engineer spacing/type scales.');
  if (!meta.viewport) notes.push('No viewport meta — likely not mobile-responsive by design.');
  if (meta.og) notes.push('Has Open Graph tags — link previews are handled.');
  if (meta.colorScheme) notes.push(`Declares color-scheme: ${meta.colorScheme} — supports light/dark at the UA level.`);

  return { url: finalUrl, meta, groups, fonts, colors, notes };
}

const LABELS = {
  framework: 'Framework', hosting: 'Hosting / CDN', styling: 'Styling',
  ui: 'UI / Components', motion: 'Motion', icons: 'Icons',
  analytics: 'Analytics', build: 'Build / Bundler',
};

module.exports = { analyze };
