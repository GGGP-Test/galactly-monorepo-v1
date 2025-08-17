# Galactly — Full Stack (Copy/Paste)

## Deploy backend (Render)
1) Create a Render **Web Service** from `/backend`.
2) Set env vars:
   - SAM_API_KEY=…
   - SITE_ORIGIN=https://<your-domain>
   - (Temporarily leave VAPID_* empty)
3) Shell → run: `npm run gen:vapid` locally (or use Render shell) and copy the two keys into env.
4) Redeploy.

## Deploy frontend (GitHub Pages)
1) In this repo, keep `/frontend` committed.
2) GitHub → Settings → Pages → Build from `main`, folder `/frontend`.
3) Edit `/frontend/api-base.js` → set `window.API_BASE` to your Render URL.

## Try it
- Open `https://<youruser>.github.io/<repo>/free-panel.html`.
- You should see leads (SAM/Reddit/RSS). Humans Online will show a live count.
- Press & hold **Claim** → you get a 60s reserve window (alert pop).
- Click **Enable Alerts** → allow notifications → you’ll receive push when you claim.

## “Why are we showing you this lead?”
- The **Why?** button calls `/api/v1/lead-explain` and lists the specific reasons (category, keyword, platform match, freshness, heat).
- This is powered by the weights your actions update via `/arrange-more` etc.

## Free-only tech & cost
- SQLite, Express, Render free tier, GitHub Pages: **$0**.
- SAM.gov, Reddit JSON, public RSS: **$0**.
- Web Push: **$0** (no APNs/FCM account needed for browser notifications).

## Optional next (when ready)
- Swap SQLite → Neon Postgres (free) for multi-instance.
- Add email via AWS SES (paid) or Resend (free trial → paid) once you want email alerts.
- Add Slack webhooks (free) and Telegram bot (free) as additional alert channels.
