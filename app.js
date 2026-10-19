(() => {
  const $ = (s) => document.querySelector(s);
  const urlInput = $('#urlInput'), parseButton = $('#parseButton'), status = $('#status');
  const resultCard = $('#resultCard'), editorDialog = $('#editorDialog'), canvas = $('#editorCanvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const video = $('#sourceVideo'), image = $('#sourceImage');
  const state = { media: null, kind: null, ratio: null, filter: 'none', text: '', brush: false, size: 36, marks: [], drawing: false, animation: 0, recording: false };
  const filters = { none: 'none', grayscale: 'grayscale(1)', sepia: 'sepia(1)', contrast: 'contrast(1.7)' };
  let crop = null;

  function say(message, error = false) {
    status.textContent = message;
    status.className = `mt-4 min-h-5 text-sm font-semibold ${error ? 'text-red-700' : 'text-black/65'}`;
  }
  async function parseUrl() {
    const value = urlInput.value.trim();
    if (!value) { say('Paste a link first.', true); urlInput.focus(); return; }
    parseButton.disabled = true; parseButton.textContent = 'Working…';
    resultCard.classList.add('hidden'); say('Finding the media…');
    try {
      const response = await fetch('/api/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: value }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not get this media.');
      state.media = data;
      $('#mediaTitle').textContent = data.title || 'Your media';
      $('#downloadButton').href = data.download;
      $('#downloadButton').download = `${safeName(data.title)}.${data.ext || 'mp4'}`;
      resultCard.classList.remove('hidden');
      say('Ready. Open the editor to make and download an edited copy.');
      resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) { say(error.message, true); }
    finally { parseButton.disabled = false; parseButton.innerHTML = 'Get media <span aria-hidden="true">↗</span>'; }
  }
  function safeName(value) { return (value || 'clipmint-edit').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 70) || 'clipmint-edit'; }
  function dimensions() { return state.kind === 'video' ? { w: video.videoWidth, h: video.videoHeight } : { w: image.naturalWidth, h: image.naturalHeight }; }
  function setCanvasSize() {
    const { w, h } = dimensions(); if (!w || !h) return;
    let outW = w, outH = h;
    if (state.ratio) {
      const [rw, rh] = state.ratio.split(':').map(Number), r = rw / rh, source = w / h;
      if (source > r) outW = Math.round(h * r); else outH = Math.round(w / r);
    }
    const scale = Math.min(1, 1400 / Math.max(outW, outH));
    canvas.width = Math.max(1, Math.round(outW * scale)); canvas.height = Math.max(1, Math.round(outH * scale));
  }
  function render() {
    if (!canvas.width || !canvas.height) return;
    const { w, h } = dimensions(); if (!w || !h) return;
    const targetRatio = canvas.width / canvas.height, sourceRatio = w / h;
    let sx = 0, sy = 0, sw = w, sh = h;
    if (sourceRatio > targetRatio) { sw = h * targetRatio; sx = (w - sw) / 2; }
    else { sh = w / targetRatio; sy = (h - sh) / 2; }
    ctx.save(); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.filter = filters[state.filter] || 'none';
    ctx.drawImage(state.kind === 'video' ? video : image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height); ctx.filter = 'none';
    // Blur masks are deliberately a visual cover, not a claim to restore concealed information.
    state.marks.forEach(mark => {
      ctx.save(); ctx.beginPath(); ctx.arc(mark.x * canvas.width, mark.y * canvas.height, mark.ratio * canvas.width, 0, Math.PI * 2); ctx.clip();
      ctx.filter = 'blur(12px)'; ctx.drawImage(state.kind === 'video' ? video : image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height); ctx.restore();
      ctx.save(); ctx.beginPath(); ctx.arc(mark.x * canvas.width, mark.y * canvas.height, mark.ratio * canvas.width, 0, Math.PI * 2); ctx.fillStyle = 'rgba(248,244,232,.32)'; ctx.fill(); ctx.restore();
    });
    if (state.text) {
      ctx.save(); const fontSize = Math.max(18, Math.round(canvas.width * .055)); ctx.font = `900 ${fontSize}px system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.lineJoin = 'round'; ctx.strokeStyle = '#171714'; ctx.lineWidth = Math.max(3, fontSize * .12); ctx.fillStyle = '#ffffff';
      ctx.strokeText(state.text, canvas.width / 2, canvas.height - fontSize * .55, canvas.width * .9); ctx.fillText(state.text, canvas.width / 2, canvas.height - fontSize * .55, canvas.width * .9); ctx.restore();
    }
    ctx.restore();
  }
  function animate() { render(); if (state.kind === 'video' && !video.paused && !video.ended) state.animation = requestAnimationFrame(animate); }
  async function openEditor() {
    if (!state.media) return;
    state.ratio = null; state.filter = 'none'; state.text = ''; state.marks = []; state.brush = false; $('#overlayText').value = ''; $('#brushToggle').checked = false;
    document.querySelectorAll('[data-ratio],[data-filter]').forEach(el => el.classList.remove('active'));
    image.classList.add('hidden'); video.classList.add('hidden');
    try {
      const type = state.media.mime || '';
      state.kind = type.startsWith('image/') ? 'image' : 'video';
      const src = state.media.preview;
      if (state.kind === 'image') {
        image.src = src; image.onload = () => { setCanvasSize(); render(); };
        if (image.complete && image.naturalWidth) { setCanvasSize(); render(); }
      } else {
        video.src = src; video.controls = true; video.playsInline = true;
        $('#videoControls').classList.remove('hidden');
        video.onloadedmetadata = () => { setCanvasSize(); render(); };
        video.onseeked = render; video.onplay = () => { cancelAnimationFrame(state.animation); animate(); };
        video.onpause = () => { cancelAnimationFrame(state.animation); render(); $('#playButton').textContent = 'Play preview'; };
        video.onplay = () => { cancelAnimationFrame(state.animation); animate(); $('#playButton').textContent = 'Pause preview'; };
        video.onerror = () => say('This browser cannot preview that stream. You can still download the original.', true);
      }
      $('#videoControls').classList.toggle('hidden', state.kind !== 'video');
      $('#playButton').textContent = 'Play preview';
      $('#exportButton').textContent = state.kind === 'video' ? 'Export video' : 'Export image';
      $('#exportHint').textContent = state.kind === 'video' ? 'Export records edited video and audio in real time as MP4 where supported, otherwise WebM. Keep this tab open.' : 'Export a new PNG with your crop, overlay, blur masks and filter.';
      $('#editorNote').textContent = state.kind === 'video' ? 'Play the clip to preview edits. Export records the edited video in real time.' : 'Edit locally in this browser, then download your finished image.';
      $('#editorDialog').showModal();
    } catch (error) { say('Could not open the media preview. Try downloading the original.', true); }
  }
  function samplePoint(event) {
    const rect = canvas.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  }
  canvas.addEventListener('pointerdown', event => {
    if (!state.brush) return; event.preventDefault(); canvas.setPointerCapture(event.pointerId); state.drawing = true;
    const p = samplePoint(event); state.marks.push({ ...p, ratio: Number(state.size) / Math.max(canvas.width, canvas.height) }); render();
  });
  canvas.addEventListener('pointermove', event => {
    if (!state.drawing) return; const p = samplePoint(event), last = state.marks[state.marks.length - 1];
    if (last) state.marks.push({ ...p, ratio: Number(state.size) / Math.max(canvas.width, canvas.height) }); render();
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(name => canvas.addEventListener(name, () => { state.drawing = false; }));

  parseButton.addEventListener('click', parseUrl);
  urlInput.addEventListener('keydown', event => { if (event.key === 'Enter') parseUrl(); });
  $('#editButton').addEventListener('click', openEditor);
  $('#playButton').addEventListener('click', async () => {
    try { if (video.paused) await video.play(); else video.pause(); }
    catch { say('Video playback was blocked. Try tapping play again.', true); }
  });
  $('#closeEditor').addEventListener('click', () => editorDialog.close());
  editorDialog.addEventListener('close', () => { video.pause(); video.removeAttribute('src'); video.load(); image.removeAttribute('src'); cancelAnimationFrame(state.animation); });
  document.querySelectorAll('[data-ratio]').forEach(button => button.addEventListener('click', () => {
    state.ratio = button.dataset.ratio; document.querySelectorAll('[data-ratio]').forEach(el => el.classList.toggle('active', el === button)); setCanvasSize(); render();
  }));
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
    state.filter = button.dataset.filter; document.querySelectorAll('[data-filter]').forEach(el => el.classList.toggle('active', el === button)); render();
  }));
  $('#overlayText').addEventListener('input', event => { state.text = event.target.value; render(); });
  $('#brushToggle').addEventListener('change', event => { state.brush = event.target.checked; canvas.style.cursor = state.brush ? 'crosshair' : 'default'; });
  $('#brushSize').addEventListener('input', event => { state.size = event.target.value; });
  $('#undoButton').addEventListener('click', () => { state.ratio = null; state.filter = 'none'; state.text = ''; state.marks = []; $('#overlayText').value = ''; document.querySelectorAll('[data-ratio],[data-filter]').forEach(el => el.classList.remove('active')); setCanvasSize(); render(); });

  $('#exportButton').addEventListener('click', async event => {
    if (state.kind === 'image') {
      render(); canvas.toBlob(blob => { if (blob) saveBlob(blob, `${safeName(state.media?.title)}-edited.png`); else say('Image export failed. Try a smaller image.', true); }, 'image/png');
      return;
    }
    if (!window.MediaRecorder || !canvas.captureStream) { say('Edited video export is not supported in this browser. Try a current version of Chrome, Edge, or Firefox.', true); return; }
    if (!video.duration || !Number.isFinite(video.duration)) { say('Wait for the video to finish loading, then try export.', true); return; }
    if (state.recording) return;
    const button = event.currentTarget, supported = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
    if (!supported) { say('This browser does not provide a supported MP4 or WebM encoder for edited video export.', true); return; }
    state.recording = true; button.disabled = true; button.textContent = 'Recording…';
    let stream;
    try {
      video.pause(); video.currentTime = 0; await video.play();
      const canvasStream = canvas.captureStream(30);
      const tracks = [...canvasStream.getVideoTracks()];
      const capture = video.captureStream ? video.captureStream() : (video.mozCaptureStream ? video.mozCaptureStream() : null);
      if (capture) tracks.push(...capture.getAudioTracks());
      stream = new MediaStream(tracks);
      const chunks = [], recorder = new MediaRecorder(stream, { mimeType: supported, videoBitsPerSecond: 5_000_000 });
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      recorder.onerror = () => { say('Video export stopped unexpectedly. Please try again.', true); finish(); };
      recorder.onstop = () => { if (chunks.length) saveBlob(new Blob(chunks, { type: supported }), `${safeName(state.media?.title)}-edited.${supported.includes('mp4') ? 'mp4' : 'webm'}`); finish(); };
      function finish() { stream?.getTracks().forEach(track => track.stop()); state.recording = false; button.disabled = false; button.textContent = 'Export video'; video.pause(); render(); }
      recorder.start(1000);
      video.onended = () => { if (recorder.state !== 'inactive') recorder.stop(); };
      say(`Recording the edited video with audio in ${supported.includes('mp4') ? 'MP4' : 'WebM'} in real time. Keep this tab open…`);
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop()); state.recording = false; button.disabled = false; button.textContent = 'Export video';
      say('Video export could not start. Press play once to allow playback, then try export again.', true);
    }
  });
  function saveBlob(blob, filename) {
    const link = document.createElement('a'), objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    say('Your edited copy has been downloaded.');
  }

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
