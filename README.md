# ClipMint

A lightweight Flask-backed Progressive Web App for retrieving supported public media links and editing images or videos in the browser. On Vercel, expiring signed media tokens let stateless functions share extraction results, and the media route streams source bytes instead of buffering the whole file.

## Editor features

- Crop presets: original, square, portrait 4:5, landscape 16:9, and story 9:16.
- Rotate and horizontal flip.
- Looks and manual brightness, contrast, saturation, and warmth adjustments.
- Text/caption overlays with font, size, position, alignment, color, outline, and a solid backing.
- Video trim start/end and playback-speed controls; browser-based export records the edited canvas with source audio as MP4 or WebM where supported.
- Content-aware cleanup with a paint mask. The first cleanup loads the optional OpenCV.js 4.13 runtime (about 11 MB) from the official OpenCV documentation host. It is loaded only when requested; the inpainting runs locally in the browser. It reconstructs a plausible fill from nearby pixels, not the original covered pixels. Results depend on the size and texture of the marked area. Video cleanup uses the same fixed mask on each frame, so it works best for a stationary corner mark.

Only edit media that you own or are authorized to modify. Do not remove creator attribution from other people's content.

## Deploy with GitHub and Vercel

1. Put the project files in a GitHub repository. Keep `.env`, `.venv`, and credentials out of Git. The repository may be private or public; the deployed Vercel site is public to anyone with its URL.
2. Import the repository in Vercel as a Flask project. `vercel.json` configures the Python function duration.
3. In **Settings → Environment Variables**, add `CLIPMINT_SECRET` with at least 32 random bytes, for Production and Preview, then redeploy. Do not commit the secret.
4. Open the production URL over HTTPS. The web app manifest and root-scoped service worker enable browser installation.

Vercel Hobby is intended for personal, non-commercial use and has a maximum function duration of five minutes. Extraction and each media transfer must finish within that limit; slow or large transfers can time out.

Full YouTube support also requires a supported JavaScript runtime in the backend environment: Node.js 22 or newer, or Deno 2.3 or newer. `requirements.txt` installs yt-dlp's official default extras, including its EJS challenge scripts, and `app.py` enables Node automatically when it is available on `PATH`. Other supported platforms remain subject to their own access restrictions.

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

Install Node.js 22 or newer, or Deno 2.3 or newer, if you want full YouTube extraction locally. The app automatically uses Node when it is on `PATH`.

Platform access restrictions and changes to source sites can affect extraction. Use media you are authorized to download and edit.
