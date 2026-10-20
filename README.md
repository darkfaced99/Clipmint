# ClipMint

A lightweight Flask-backed Progressive Web App for retrieving supported public media links and editing images or videos in the browser. On Vercel, expiring signed media tokens let stateless functions share extraction results, and the media route streams source bytes instead of buffering the whole file.

Live app: [clipmint-sigma.vercel.app](https://clipmint-sigma.vercel.app)

## Current release and PWA cache

The current service-worker shell cache is `clipmint-shell-v8`. The frontend script URL is `/app.js?v=7`; the script query string and service-worker cache name are separate cache-busting versions. The shell includes the 192×192 and 512×512 PNG install icons as well as the SVG and iOS icon. When changing the frontend script, update its query string in `index.html` and `sw.js`. When changing the precached shell or service-worker behavior, increment the cache name in `sw.js` so installed clients fetch the new shell.

## Editor features

- Crop presets: original, square, portrait 4:5, landscape 16:9, and story 9:16.
- Rotate and horizontal flip.
- Looks and manual brightness, contrast, saturation, and warmth adjustments.
- Text/caption overlays with font, size, position, alignment, color, outline, and a solid backing.
- Video trim start/end and playback-speed controls; browser-based export records the edited canvas with source audio as MP4 or WebM where supported.
- Content-aware cleanup with a paint mask. The first cleanup loads the optional OpenCV.js 4.13 runtime (about 11 MB) from the official OpenCV documentation host. It is loaded only when requested; the inpainting runs locally in the browser. It reconstructs a plausible fill from nearby pixels, not the original covered pixels. Results depend on the size and texture of the marked area. Video cleanup uses the same fixed mask on each frame, so it works best for a stationary corner mark.

Only edit media that you own or are authorized to modify. Do not remove creator attribution from other people's content.

## Source-platform access and YouTube notes

Extraction depends on each source platform's current access rules. A link that is public in a browser may still be blocked when requested by a server. YouTube can show `Sign in to confirm you're not a bot` or rate-limit requests from a serverless provider's shared egress IP. These are source-side restrictions, not editor or PWA failures, and a JavaScript runtime alone cannot fix an IP reputation block.

The project requires `yt-dlp[default]>=2026.8.19`. The default extra includes yt-dlp's EJS challenge scripts. Full YouTube extraction also needs a supported JavaScript runtime: Node.js 22 or newer (which `app.py` enables automatically when found on `PATH`) or Deno 2.3 or newer (yt-dlp's default runtime). Vercel's Python runtime does not itself guarantee that a JavaScript runtime is available in the deployed function; confirm runtime availability in the build/runtime environment if YouTube reports a missing-runtime error.

A supported runtime solves JavaScript challenges but does not guarantee that YouTube will accept a request. yt-dlp documents Proof of Origin (PO) tokens for some YouTube clients and formats; tokens are video/session-bound and may need a provider. YouTube can also restrict an egress IP. A proxy can only help if you operate an authorized, reliable egress service and use the required consistent network identity for extraction and subsequent media requests; ClipMint does not bundle a proxy or token provider. Do not assume a proxy, cookie, or extractor switch is a stable bypass.

ClipMint does not ask for, store, or use visitors' YouTube login cookies. Do not put personal browser cookies in this public service: yt-dlp warns that using account cookies can put the account at risk, and cookies are tied to the session and network context. Private, age-restricted, members-only, region-restricted, or otherwise account-gated media may not be extractable.

Useful upstream references: [yt-dlp EJS setup](https://github.com/yt-dlp/yt-dlp/wiki/EJS), [YouTube extractor guidance](https://github.com/yt-dlp/yt-dlp/wiki/Extractors), and [PO Token guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide).

## Deploy with GitHub and Vercel

1. Put the project files in a GitHub repository. Keep `.env`, `.venv`, and credentials out of Git. The repository may be private or public; the deployed Vercel site is public to anyone with its URL.
2. Import the repository in Vercel as a Flask project. `vercel.json` configures the Python function duration.
3. In **Settings → Environment Variables**, add `CLIPMINT_SECRET` with at least 32 random bytes, for Production and Preview, then redeploy. Do not commit the secret.
4. Open the production URL over HTTPS. The web app manifest and root-scoped service worker enable browser installation.

Vercel Hobby functions have a maximum duration of five minutes. Extraction and each media transfer must finish within that limit; slow or large transfers can time out. Vercel's Python functions support streaming responses, but the function duration still covers the streamed response.

## Install on devices

- **Android:** open the production URL in Chrome and choose **Install app** or **Add to Home screen**.
- **iPhone/iPad:** open the URL in Safari, tap **Share**, then **Add to Home Screen**.
- **Windows/macOS:** open the URL in Chrome or Edge and choose **Install app**. If unavailable, create a shortcut and select **Open as window**.

The app shell can load offline after the first visit. Extraction, previews, downloads, and the first use of content-aware cleanup require internet access.

## Run locally

```bash
python3 -m venv .venv
source .venv/bin/activate       # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
python app.py
```

Open `http://127.0.0.1:5000`. For local behavior that matches serverless token expiry, set `CLIPMINT_SECRET` in your shell before starting Flask.

Install Node.js 22 or newer, or Deno 2.3 or newer, for full YouTube JavaScript-challenge support locally. The app automatically enables Node when it is on `PATH`; yt-dlp detects Deno by default. These requirements do not override YouTube's anti-bot, IP-reputation, authentication, or format restrictions.
