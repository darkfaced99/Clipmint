from __future__ import annotations

import ipaddress
import os
import socket
from typing import Any
from urllib.parse import urljoin, urlparse

import requests
from flask import Flask, Response, jsonify, render_template, request, send_file, stream_with_context
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from yt_dlp import YoutubeDL

app = Flask(__name__, template_folder=".", static_folder=None)
app.config.update(MAX_CONTENT_LENGTH=16 * 1024, JSON_SORT_KEYS=False)

TTL_SECONDS = 45 * 60
ALLOWED_HOSTS = ("youtube.com", "youtu.be", "instagram.com", "x.com", "twitter.com", "facebook.com", "fb.watch")
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36"
SECRET_KEY = os.environ.get("CLIPMINT_SECRET")
if os.environ.get("VERCEL") and not SECRET_KEY:
    raise RuntimeError("Set CLIPMINT_SECRET in Vercel project environment variables.")
serializer = URLSafeTimedSerializer(SECRET_KEY or "local-development-only-change-before-deploy", salt="clipmint-media-token-v1")


def allowed_site(url: str) -> bool:
    try:
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower().rstrip(".")
        return parsed.scheme in {"http", "https"} and any(host == d or host.endswith("." + d) for d in ALLOWED_HOSTS)
    except ValueError:
        return False


def public_http_url(url: str) -> bool:
    """Allow only public HTTP(S) stream hosts when proxying extracted URLs."""
    try:
        p = urlparse(url)
        if p.scheme not in {"http", "https"} or not p.hostname or p.username or p.password:
            return False
        addresses = socket.getaddrinfo(p.hostname, p.port or (443 if p.scheme == "https" else 80), type=socket.SOCK_STREAM)
        return bool(addresses) and all(ipaddress.ip_address(item[4][0]).is_global for item in addresses)
    except (ValueError, OSError):
        return False


def choose_format(info: dict[str, Any]) -> dict[str, Any] | None:
    # extract_info returns the requested, selector-chosen stream at the top level.
    # Respect it so the H.264/AAC MP4 preference below is not replaced by a
    # separately listed higher-resolution format.
    if info.get("url"):
        return info
    formats = info.get("formats") or []
    candidates = [f for f in formats if f.get("url") and f.get("vcodec") != "none"]
    # Prefer a format with audio, then higher resolution; avoid separate video-only streams.
    candidates.sort(key=lambda f: (f.get("acodec") not in (None, "none"), f.get("height") or 0, f.get("tbr") or 0), reverse=True)
    return candidates[0] if candidates else None


def media_headers(entry: dict[str, Any]) -> dict[str, str]:
    headers = {"User-Agent": USER_AGENT}
    if entry.get("referer"):
        headers["Referer"] = entry["referer"]
    if entry.get("origin"):
        headers["Origin"] = entry["origin"]
    return headers


@app.get("/")
def home():
    return render_template("index.html")


@app.get("/manifest.json")
def manifest():
    return send_file("manifest.json", mimetype="application/manifest+json")


@app.get("/app.js")
def frontend_script():
    return send_file("app.js", mimetype="application/javascript")


@app.get("/icon.svg")
def icon_svg():
    return Response('''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="3" y="3" width="58" height="58" rx="14" fill="#a8e6cf" stroke="#171714" stroke-width="5"/><path d="M19 12h20l10 10v29H19a4 4 0 0 1-4-4V16a4 4 0 0 1 4-4Z" fill="#fff" stroke="#171714" stroke-width="4" stroke-linejoin="round"/><path d="M37 13v10h10M23 34h22M23 42h15" fill="none" stroke="#171714" stroke-width="4" stroke-linecap="round"/><circle cx="46" cy="47" r="8" fill="#c8ef70" stroke="#171714" stroke-width="3"/></svg>''', mimetype="image/svg+xml")


@app.get("/apple-touch-icon.png")
def apple_icon():
    # Generated locally with Pillow when available; PNG keeps iOS A2HS icon support.
    from io import BytesIO
    from PIL import Image, ImageDraw
    image = Image.new("RGB", (180, 180), "#a8e6cf")
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((7, 7, 173, 173), radius=34, fill="#a8e6cf", outline="#171714", width=9)
    draw.rounded_rectangle((47, 34, 134, 150), radius=7, fill="#ffffff", outline="#171714", width=7)
    draw.line((109, 36, 109, 61, 132, 61), fill="#171714", width=7)
    draw.line((65, 89, 116, 89), fill="#171714", width=7)
    draw.line((65, 106, 104, 106), fill="#171714", width=7)
    draw.ellipse((109, 110, 145, 146), fill="#c8ef70", outline="#171714", width=6)
    output = BytesIO(); image.save(output, format="PNG")
    return Response(output.getvalue(), mimetype="image/png")


@app.get("/sw.js")
def service_worker():
    response = send_file("sw.js", mimetype="application/javascript")
    response.headers["Service-Worker-Allowed"] = "/"
    response.headers["Cache-Control"] = "no-cache"
    return response


@app.post("/api/extract")
def extract():
    payload = request.get_json(silent=True) or {}
    url = str(payload.get("url", "")).strip()
    if len(url) > 4096 or not allowed_site(url):
        return jsonify(error="Paste a valid YouTube, Instagram, X, or Facebook URL."), 400
    opts = {
        "quiet": True, "no_warnings": True, "skip_download": True,
        "noplaylist": True,
        # Prefer a widely uploadable, already-muxed H.264/AAC MP4; never fetch
        # separate audio/video streams that this lightweight proxy cannot mux.
        "format": "best[ext=mp4][vcodec^=avc1][acodec^=mp4a]/best[acodec!=none][vcodec!=none]/best",
        "socket_timeout": 15, "retries": 1, "extractor_retries": 1,
        "http_headers": {"User-Agent": USER_AGENT},
    }
    try:
        with YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
        if info.get("entries"):
            info = next((item for item in info["entries"] if item), {})
        fmt = choose_format(info)
        if not fmt or not fmt.get("url"):
            return jsonify(error="No playable media stream was found for that link."), 422
        raw_url = fmt["url"]
        if not public_http_url(raw_url):
            return jsonify(error="The source returned an unsupported stream address."), 422
        entry = {
            "url": raw_url, "title": info.get("title") or "Your media",
            "mime": fmt.get("mime_type") or info.get("mime_type") or "video/mp4",
            "ext": fmt.get("ext") or info.get("ext") or "mp4",
            "width": fmt.get("width") or info.get("width"), "height": fmt.get("height") or info.get("height"),
            "referer": url, "origin": f"{urlparse(url).scheme}://{urlparse(url).netloc}",
        }
        # A timed signature makes the token portable between serverless instances
        # without a database. Its lifetime is bounded by TTL_SECONDS.
        token = serializer.dumps(entry)
        return jsonify(title=entry["title"], mime=entry["mime"], ext=entry["ext"], width=entry["width"], height=entry["height"],
                       preview=f"/api/media/{token}", download=f"/api/download/{token}", expiresIn=TTL_SECONDS)
    except Exception as exc:
        app.logger.warning("Extraction failed (%s)", type(exc).__name__)
        return jsonify(error="Could not extract this link. It may be private, region-limited, unsupported, or blocked by the platform."), 422


def proxy(token: str, attachment: bool = False):
    try:
        entry = serializer.loads(token, max_age=TTL_SECONDS)
    except SignatureExpired:
        return jsonify(error="This media link has expired. Parse the URL again."), 404
    except BadSignature:
        return jsonify(error="This media link is invalid. Parse the URL again."), 400
    if not public_http_url(entry["url"]):
        return jsonify(error="The media source is no longer available."), 422
    headers = media_headers(entry)
    if request.headers.get("Range"):
        headers["Range"] = request.headers["Range"]
    try:
        target = entry["url"]
        upstream = None
        for _ in range(6):
            if not public_http_url(target):
                return jsonify(error="The media source redirected to an unsupported address."), 422
            upstream = requests.get(target, headers=headers, stream=True, timeout=(10, 45), allow_redirects=False)
            if upstream.status_code not in (301, 302, 303, 307, 308):
                break
            destination = upstream.headers.get("Location")
            upstream.close()
            if not destination:
                return jsonify(error="The media source returned an invalid redirect."), 502
            target = urljoin(target, destination)
        if upstream is None or upstream.status_code in (301, 302, 303, 307, 308):
            if upstream is not None:
                upstream.close()
            return jsonify(error="The media source redirected too many times."), 502
    except requests.RequestException:
        return jsonify(error="The media stream could not be reached. Please parse the link again."), 502

    def generate():
        try:
            for chunk in upstream.iter_content(chunk_size=128 * 1024):
                if chunk:
                    yield chunk
        finally:
            upstream.close()

    status = upstream.status_code if upstream.status_code in (200, 206, 416) else 502
    response = Response(stream_with_context(generate()), status=status, content_type=upstream.headers.get("Content-Type", entry["mime"]))
    for header in ("Content-Length", "Content-Range", "Accept-Ranges", "Last-Modified", "ETag"):
        if header in upstream.headers:
            response.headers[header] = upstream.headers[header]
    response.headers["Cache-Control"] = "private, max-age=300"
    response.headers["X-Content-Type-Options"] = "nosniff"
    if attachment:
        safe_title = "".join(c for c in entry["title"] if c.isalnum() or c in " -_").strip()[:80] or "download"
        response.headers["Content-Disposition"] = f'attachment; filename="{safe_title}.{entry["ext"]}"'
    return response


@app.get("/api/media/<token>")
def media(token: str):
    return proxy(token)


@app.get("/api/download/<token>")
def download(token: str):
    return proxy(token, attachment=True)


@app.get("/health")
def health():
    return jsonify(status="ok")


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
