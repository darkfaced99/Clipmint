# ClipMint

A Flask-backed Progressive Web App for retrieving media links and editing images or video previews in the browser. The Vercel deployment uses the Python runtime; expiring signed media tokens keep extraction state portable between serverless instances, and the media endpoint streams from the source instead of loading the whole file into memory.

## Deploy with GitHub and Vercel

1. Create a **private** GitHub repository and upload the project files from this folder. Keep `.env`, `.venv`, and credentials out of Git.
2. In Vercel, choose **Add New → Project**, import that GitHub repository, and deploy it. Vercel detects the Flask app from `app.py`; `vercel.json` configures its function duration.
3. In the Vercel project’s **Settings → Environment Variables**, add `CLIPMINT_SECRET` with a long random value (at least 32 random bytes). Generate one locally with `python -c "import secrets; print(secrets.token_hex(32))"`; do not commit it. Add it for Production and Preview, then redeploy.
4. Open the Vercel production URL over HTTPS. The PWA manifest and root-scoped service worker enable installation from that URL.

Vercel Hobby is intended for personal, non-commercial projects and has a maximum function duration of five minutes. Streamed responses are supported by the Python runtime; extraction and an individual media transfer must still complete within the configured function duration. Larger media or slow connections may time out. Vercel’s own guidance recommends streaming or dedicated media hosting for large downloads.

## Install on devices

- **Android:** open the production URL in Chrome, then choose **Install app** or **Add to Home screen** from the browser menu.
- **iPhone/iPad:** open the URL in Safari, tap **Share**, then **Add to Home Screen**.
- **Windows/macOS:** open the URL in a Chromium browser and choose **Install app** from the address bar or browser menu. If that option is unavailable, use **Create shortcut** and select **Open as window**.

The cached app shell can load offline after a first visit, but link extraction, previews, and downloads need an internet connection. The web app itself is public to anyone with the URL; GitHub source can remain private.

## Run locally

```bash
python3 -m venv .venv
source .venv/bin/activate       # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
python app.py
```

Open `http://127.0.0.1:5000`. For local app behavior that matches serverless token expiry, set `CLIPMINT_SECRET` in your shell before starting Flask.

Use only media you are authorized to download. Platform access restrictions and changes to their sites may affect extraction.
