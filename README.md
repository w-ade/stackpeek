# stackpeek

Paste a URL, read its design/dev stack — framework, hosting, styling, type,
motion, build tooling — each one explained so you actually learn it.

A dead-simple page over one serverless function:
- `index.html` — centered input; renders the report in a B&W index style.
- `api/analyze.js` — fetches the target URL server-side (browsers can't, CORS),
  pulls a few linked stylesheets for richer signal, runs the detector.
- `api/_detect.js` — the pure detection engine (no deps). Testable standalone.

Live: https://trystackpeek.vercel.app  ·  share a read: `?url=vercel.com`

No build step. Locally: `node brainstorming/dev-server.js` → http://localhost:5210
