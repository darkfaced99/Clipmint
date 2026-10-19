(() => {
  const $ = (selector) => document.querySelector(selector);
  const urlInput = $('#urlInput'), parseButton = $('#parseButton'), status = $('#status');
  const resultCard = $('#resultCard'), editorDialog = $('#editorDialog'), canvas = $('#editorCanvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const video = $('#sourceVideo'), image = $('#sourceImage');
  const maskCanvas = document.createElement('canvas');
  const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
  const state = {
    media: null, kind: null, ratio: null, rotation: 0, flipX: false, look: 'original',
    brightness: 100, contrast: 100, saturation: 100, warmth: 0,
    text: '', textColor: '#ffffff', textSize: 5.5, textPosition: 'bottom', textAlign: 'center',
    font: 'system-ui,sans-serif', outline: true, textBackground: false,
    brush: false, brushSize: 36, strokes: [], currentStroke: null, drawing: false,
    cleanupApplied: false, cv: null, cvPromise: null, animation: 0, lastInpaintTime: -1,
    recording: false, recorder: null, trimStart: 0, trimEnd: 0, speed: 1
  };

  const lookFilters = {
    original: '', mono: 'grayscale(1)', warm: 'sepia(.28) saturate(1.12)',
    film: 'sepia(.42) contrast(1.08) saturate(.88)', pop: 'contrast(1.16) saturate(1.28)', fade: 'contrast(.88) saturate(.78) brightness(1.08)'
  };

  function say(message, error = false) {
    status.textContent = message;
    status.className = `mt-4 min-h-5 text-sm font-semibold ${error ? 'text-red-700' : 'text-black/65'}`;
  }
  function cleanupSay(message, error = false) {
    const node = $('#cleanupStatus');
    node.textContent = message;
    node.className = `mt-2 text-[11px] font-semibold ${error ? 'text-red-700' : 'text-black/55'}`;
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
      say('Ready. Open the editor to create an edited copy.');
      resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) { say(error.message, true); }
    finally { parseButton.disabled = false; parseButton.innerHTML = 'Get media <span aria-hidden="true">↗</span>'; }
  }
  function safeName(value) { return (value || 'clipmint-edit').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 70) || 'clipmint-edit'; }
  function dimensions() { return state.kind === 'video' ? { w: video.videoWidth, h: video.videoHeight } : { w: image.naturalWidth, h: image.naturalHeight }; }
  function currentSource() { return state.kind === 'video' ? video : image; }
  function targetAspect(w, h) {
    if (state.ratio && state.ratio !== 'original') {
      const [rw, rh] = state.ratio.split(':').map(Number);
      return rw / rh;
    }
    return state.rotation % 180 ? h / w : w / h;
  }
  function setCanvasSize() {
    const { w, h } = dimensions(); if (!w || !h) return;
    const orientedW = state.rotation % 180 ? h : w;
    const orientedH = state.rotation % 180 ? w : h;
    const ratio = targetAspect(w, h);
    let outW = orientedW, outH = orientedH;
    if (orientedW / orientedH > ratio) outW = orientedH * ratio;
    else outH = orientedW / ratio;
    const scale = Math.min(1, 1400 / Math.max(outW, outH));
    canvas.width = Math.max(1, Math.round(outW * scale));
    canvas.height = Math.max(1, Math.round(outH * scale));
    maskCanvas.width = canvas.width; maskCanvas.height = canvas.height;
    state.lastInpaintTime = -1;
  }
  function filterString() {
    const base = lookFilters[state.look] || '';
    const warmth = state.warmth >= 0
      ? `sepia(${(state.warmth / 100 * .22).toFixed(3)})`
      : `hue-rotate(${(state.warmth * .12).toFixed(1)}deg)`;
    return `${base} brightness(${state.brightness}%) contrast(${state.contrast}%) saturate(${state.saturation}%) ${warmth}`.trim();
  }
  function drawSource() {
    const source = currentSource();
    const { w, h } = dimensions();
    if (!source || !w || !h) return;
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.filter = filterString();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(state.rotation * Math.PI / 180);
    ctx.scale(state.flipX ? -1 : 1, 1);
    const orientedW = state.rotation % 180 ? h : w;
    const orientedH = state.rotation % 180 ? w : h;
    const scale = Math.max(canvas.width / orientedW, canvas.height / orientedH);
    ctx.drawImage(source, -(w * scale) / 2, -(h * scale) / 2, w * scale, h * scale);
    ctx.restore();
    ctx.filter = 'none';
  }
  function drawMask(maskContext, color) {
    maskContext.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    maskContext.lineCap = 'round'; maskContext.lineJoin = 'round';
    for (const stroke of state.strokes) {
      if (!stroke.points.length) continue;
      const width = Math.max(2, stroke.radius * 2 * Math.max(maskCanvas.width, maskCanvas.height));
      maskContext.beginPath();
      maskContext.strokeStyle = color; maskContext.fillStyle = color; maskContext.lineWidth = width;
      const first = stroke.points[0];
      maskContext.moveTo(first.x * maskCanvas.width, first.y * maskCanvas.height);
      if (stroke.points.length === 1) {
        maskContext.arc(first.x * maskCanvas.width, first.y * maskCanvas.height, width / 2, 0, Math.PI * 2);
        maskContext.fill();
      } else {
        for (let i = 1; i < stroke.points.length; i++) maskContext.lineTo(stroke.points[i].x * maskCanvas.width, stroke.points[i].y * maskCanvas.height);
        maskContext.stroke();
      }
    }
  }
  function applyInpaint() {
    const cv = state.cv;
    if (!cv || !state.strokes.length) return;
    drawMask(maskCtx, '#ffffff');
    const sourceMat = cv.imread(canvas);
    const sourceRgb = new cv.Mat();
    const maskRgba = cv.imread(maskCanvas);
    const maskGray = new cv.Mat();
    const output = new cv.Mat();
    try {
      cv.cvtColor(sourceMat, sourceRgb, cv.COLOR_RGBA2RGB);
      cv.cvtColor(maskRgba, maskGray, cv.COLOR_RGBA2GRAY);
      cv.inpaint(sourceRgb, maskGray, output, 5, cv.INPAINT_TELEA);
      cv.imshow(canvas, output);
      state.lastInpaintTime = state.kind === 'video' ? video.currentTime : -1;
    } finally {
      sourceMat.delete(); sourceRgb.delete(); maskRgba.delete(); maskGray.delete(); output.delete();
    }
  }
  function drawBrushOverlay() {
    if (state.cleanupApplied || !state.strokes.length) return;
    drawMask(maskCtx, 'rgba(255,94,75,.62)');
    ctx.save(); ctx.globalAlpha = .55; ctx.drawImage(maskCanvas, 0, 0); ctx.restore();
  }
  function drawText() {
    if (!state.text) return;
    ctx.save();
    const fontSize = Math.max(18, Math.round(canvas.width * state.textSize / 100));
    ctx.font = `900 ${fontSize}px ${state.font}`;
    ctx.textAlign = state.textAlign; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    const margin = Math.max(18, canvas.width * .055);
    const x = state.textAlign === 'left' ? margin : state.textAlign === 'right' ? canvas.width - margin : canvas.width / 2;
    const y = state.textPosition === 'top' ? Math.max(fontSize, canvas.height * .12) : state.textPosition === 'middle' ? canvas.height / 2 : canvas.height - Math.max(fontSize, canvas.height * .1);
    const maxWidth = canvas.width - margin * 2;
    if (state.textBackground) {
      const metrics = ctx.measureText(state.text);
      const width = Math.min(maxWidth, metrics.width) + fontSize * .55;
      const left = state.textAlign === 'left' ? x - fontSize * .25 : state.textAlign === 'right' ? x - width + fontSize * .25 : x - width / 2;
      ctx.fillStyle = 'rgba(23,23,20,.78)'; ctx.fillRect(left, y - fontSize * .72, width, fontSize * 1.35);
    }
    if (state.outline) { ctx.strokeStyle = '#171714'; ctx.lineWidth = Math.max(2, fontSize * .12); ctx.strokeText(state.text, x, y, maxWidth); }
    ctx.fillStyle = state.textColor; ctx.fillText(state.text, x, y, maxWidth);
    ctx.restore();
  }
  function render(frameTick = false) {
    if (!canvas.width || !canvas.height) return;
    const { w, h } = dimensions(); if (!w || !h) return;
    const hasCleanup = state.cleanupApplied && state.strokes.length > 0 && state.cv;
    if (frameTick && hasCleanup && state.kind === 'video' && !video.paused && Math.abs(video.currentTime - state.lastInpaintTime) < .001) return;
    drawSource();
    if (hasCleanup) {
      try { applyInpaint(); }
      catch (error) { state.cleanupApplied = false; cleanupSay('Cleanup could not process this frame. Try a smaller selection or a newer browser.', true); }
    } else drawBrushOverlay();
    drawText();
  }
  function animate() {
    render(true);
    if (state.kind === 'video' && !video.paused && !video.ended) state.animation = requestAnimationFrame(animate);
  }
  function resetControls() {
    $('#overlayText').value = ''; $('#textColor').value = '#ffffff'; $('#textSize').value = '5.5'; $('#textPosition').value = 'bottom'; $('#textAlign').value = 'center'; $('#textFont').value = 'system-ui,sans-serif';
    $('#outlineText').checked = true; $('#textBackground').checked = false;
    $('#brightness').value = '100'; $('#contrast').value = '100'; $('#saturation').value = '100'; $('#warmth').value = '0';
    $('#brushSize').value = '36'; $('#cleanupToggle').checked = false; $('#rightsConfirm').checked = false;
    $('#trimStart').value = '0'; $('#trimEnd').value = '0'; $('#playbackSpeed').value = '1';
    $('#brightnessValue').value = $('#brightnessValue').textContent = '100%';
    $('#contrastValue').value = $('#contrastValue').textContent = '100%';
    $('#saturationValue').value = $('#saturationValue').textContent = '100%';
    $('#warmthValue').value = $('#warmthValue').textContent = '0';
    $('#textSizeValue').value = $('#textSizeValue').textContent = '5.5%';
    $('#brushSizeValue').value = $('#brushSizeValue').textContent = '36 px';
  }
  function showEditorDialog() {
    if (editorDialog.hasAttribute('open')) return;
    if (typeof editorDialog.showModal === 'function') {
      try { editorDialog.showModal(); return; } catch (_) {}
    }
    editorDialog.classList.add('editor-fallback');
    document.body.classList.add('editor-fallback-active');
    editorDialog.setAttribute('open', '');
    $('#closeEditor').focus();
  }
  function releaseEditorMedia() {
    video.onloadedmetadata = null; video.onseeked = null; video.onplay = null; video.onpause = null;
    video.onerror = null; video.ontimeupdate = null; video.onended = null;
    image.onload = null; image.onerror = null;
    video.pause(); video.removeAttribute('src'); video.load();
    image.removeAttribute('src'); cancelAnimationFrame(state.animation);
  }
  function closeEditorDialog() {
    if (state.recording && state.recorder?.state !== 'inactive') state.recorder.stop();
    if (!editorDialog.hasAttribute('open')) return;
    if (!editorDialog.classList.contains('editor-fallback') && typeof editorDialog.close === 'function') {
      editorDialog.close(); return;
    }
    editorDialog.removeAttribute('open');
    editorDialog.classList.remove('editor-fallback');
    document.body.classList.remove('editor-fallback-active');
    releaseEditorMedia(); $('#editButton').focus();
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && editorDialog.classList.contains('editor-fallback')) closeEditorDialog();
  });

  async function openEditor() {
    if (!state.media) { say('Parse a supported link first to load a media preview.', true); return; }
    if (!state.media.preview) { say('This link did not return a preview stream. Parse it again or download the original.', true); return; }
    state.ratio = null; state.rotation = 0; state.flipX = false; state.look = 'original';
    state.brightness = 100; state.contrast = 100; state.saturation = 100; state.warmth = 0;
    state.text = ''; state.textColor = '#ffffff'; state.textSize = 5.5; state.textPosition = 'bottom'; state.textAlign = 'center'; state.font = 'system-ui,sans-serif'; state.outline = true; state.textBackground = false;
    state.brush = false; state.brushSize = 36; state.strokes = []; state.currentStroke = null; state.cleanupApplied = false; state.lastInpaintTime = -1; state.trimStart = 0; state.speed = 1;
    resetControls();
    canvas.style.cursor = 'default';
    document.querySelectorAll('[data-ratio],[data-look]').forEach((el) => el.classList.remove('active'));
    image.classList.add('hidden'); video.classList.add('hidden');
    try {
      state.kind = (state.media.mime || '').startsWith('image/') ? 'image' : 'video';
      const src = state.media.preview;
      if (state.kind === 'image') {
        image.onload = () => { setCanvasSize(); render(); };
        image.onerror = () => say('The preview could not be loaded. Try saving the original.', true);
        image.src = src;
        if (image.complete && image.naturalWidth) { setCanvasSize(); render(); }
      } else {
        video.controls = true; video.playsInline = true;
        $('#videoControls').classList.remove('hidden');
        video.onloadedmetadata = () => {
          setCanvasSize(); state.trimEnd = video.duration;
          $('#trimEnd').value = Number.isFinite(video.duration) ? video.duration.toFixed(1) : '0';
          render();
        };
        video.onseeked = () => render();
        video.onplay = () => { video.playbackRate = state.speed; cancelAnimationFrame(state.animation); animate(); $('#playButton').textContent = 'Pause preview'; };
        video.onpause = () => { cancelAnimationFrame(state.animation); render(); $('#playButton').textContent = 'Play preview'; };
        video.onerror = () => say('This browser cannot preview that stream. You can still download the original.', true);
        video.src = src;
      }
      $('#videoControls').classList.toggle('hidden', state.kind !== 'video');
      $('#playButton').textContent = 'Play preview';
      $('#exportButton').textContent = state.kind === 'video' ? 'Export video' : 'Export image';
      $('#exportHint').textContent = state.kind === 'video' ? 'Video is recorded in real time with edits, trim, speed and source audio. MP4 or WebM depends on browser support.' : 'Export a new PNG with your crop, cleanup, text and look.';
      $('#editorNote').textContent = state.kind === 'video' ? 'Preview and export a trimmed, styled copy in this browser.' : 'Edit locally in this browser, then save a new image copy.';
      showEditorDialog();
    } catch (error) { say('Could not open the media preview. Refresh the page or try a current browser.', true); }
  }
  function samplePoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  }
  function brushRadius() { return Number(state.brushSize) / Math.max(canvas.width, canvas.height); }
  canvas.addEventListener('pointerdown', (event) => {
    if (!state.brush) return;
    event.preventDefault(); canvas.setPointerCapture(event.pointerId); state.drawing = true; state.cleanupApplied = false;
    state.currentStroke = { radius: brushRadius(), points: [samplePoint(event)] }; state.strokes.push(state.currentStroke); render();
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!state.drawing || !state.currentStroke) return;
    state.currentStroke.points.push(samplePoint(event)); render();
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((name) => canvas.addEventListener(name, () => { state.drawing = false; state.currentStroke = null; }));

  function loadOpenCv() {
    if (state.cv && state.cv.Mat) return Promise.resolve(state.cv);
    if (state.cvPromise) return state.cvPromise;
    state.cvPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('OpenCV.js took too long to load. Check your connection and try again.')), 120000);
      const settle = (cv) => {
        if (!cv) return;
        clearTimeout(timeout); state.cv = cv; resolve(cv);
      };
      if (window.cv && window.cv.Mat) { settle(window.cv); return; }
      const script = document.createElement('script');
      script.id = 'clipmint-opencv'; script.async = true; script.crossOrigin = 'anonymous';
      script.src = 'https://docs.opencv.org/4.13.0/opencv.js';
      script.onload = () => {
        const candidate = window.cv;
        if (candidate && candidate.Mat) settle(candidate);
        else if (candidate && typeof candidate.then === 'function') candidate.then(settle, reject);
        else if (candidate) {
          const previous = candidate.onRuntimeInitialized;
          candidate.onRuntimeInitialized = () => { if (typeof previous === 'function') previous(); settle(candidate); };
        } else reject(new Error('The cleanup engine did not initialize.'));
      };
      script.onerror = () => { clearTimeout(timeout); reject(new Error('Could not load the cleanup engine. Check your internet connection.')); };
      document.head.appendChild(script);
    }).catch((error) => { state.cvPromise = null; throw error; });
    return state.cvPromise;
  }
  async function cleanSelection() {
    if (!$('#rightsConfirm').checked) { cleanupSay('Please confirm you own this media or have permission to edit it.', true); return; }
    if (!state.strokes.length) { cleanupSay('Paint over a small area first, then choose Clean area.', true); return; }
    const button = $('#cleanButton'); button.disabled = true; button.textContent = 'Loading…';
    cleanupSay('Loading OpenCV.js. The optional cleanup engine is about 11 MB and runs locally in your browser…');
    try {
      state.cv = await loadOpenCv();
      state.cleanupApplied = true; state.lastInpaintTime = -1; render();
      if (!state.cleanupApplied) throw new Error('Cleanup could not process this selection. Try a smaller area.');
      cleanupSay(state.kind === 'video' ? 'Cleanup applied to the fixed selection on each video frame. Check the preview before exporting.' : 'Area filled from nearby pixels. Add a little surrounding margin if traces remain.');
    } catch (error) {
      state.cleanupApplied = false; cleanupSay(error.message || 'Cleanup failed to initialize.', true);
    } finally { button.disabled = false; button.textContent = 'Clean area'; }
  }
  function updateTextState() {
    state.text = $('#overlayText').value; state.textColor = $('#textColor').value; state.textSize = Number($('#textSize').value);
    state.textPosition = $('#textPosition').value; state.textAlign = $('#textAlign').value; state.font = $('#textFont').value;
    state.outline = $('#outlineText').checked; state.textBackground = $('#textBackground').checked;
  }
  function updateAdjustments() {
    state.brightness = Number($('#brightness').value); state.contrast = Number($('#contrast').value);
    state.saturation = Number($('#saturation').value); state.warmth = Number($('#warmth').value);
    $('#brightnessValue').textContent = `${state.brightness}%`; $('#contrastValue').textContent = `${state.contrast}%`;
    $('#saturationValue').textContent = `${state.saturation}%`; $('#warmthValue').textContent = `${state.warmth}`;
  }
  function boundedNumber(node, min, max, fallback) {
    const number = Number(node.value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  }
  function updateTrim() {
    if (state.kind !== 'video' || !Number.isFinite(video.duration)) return;
    state.trimStart = boundedNumber($('#trimStart'), 0, Math.max(0, video.duration - .1), 0);
    state.trimEnd = boundedNumber($('#trimEnd'), Math.min(video.duration, state.trimStart + .1), video.duration, video.duration);
    if (state.trimEnd <= state.trimStart) state.trimEnd = Math.min(video.duration, state.trimStart + .1);
    $('#trimStart').value = state.trimStart.toFixed(1); $('#trimEnd').value = state.trimEnd.toFixed(1);
    if (video.currentTime < state.trimStart || video.currentTime > state.trimEnd) video.currentTime = state.trimStart;
  }

  parseButton.addEventListener('click', parseUrl);
  urlInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') parseUrl(); });
  $('#editButton').addEventListener('click', openEditor);
  $('#playButton').addEventListener('click', async () => {
    try {
      if (video.paused) {
        updateTrim(); if (video.currentTime < state.trimStart || video.currentTime >= state.trimEnd) video.currentTime = state.trimStart;
        video.playbackRate = state.speed; await video.play();
      } else video.pause();
    } catch { say('Video playback was blocked. Try tapping play again.', true); }
  });
  $('#closeEditor').addEventListener('click', closeEditorDialog);
  editorDialog.addEventListener('close', releaseEditorMedia);

  document.querySelectorAll('[data-ratio]').forEach((button) => button.addEventListener('click', () => {
    state.ratio = button.dataset.ratio; document.querySelectorAll('[data-ratio]').forEach((el) => el.classList.toggle('active', el === button)); setCanvasSize(); render();
  }));
  document.querySelectorAll('[data-look]').forEach((button) => button.addEventListener('click', () => {
    state.look = button.dataset.look; document.querySelectorAll('[data-look]').forEach((el) => el.classList.toggle('active', el === button)); render();
  }));
  $('#rotateLeft').addEventListener('click', () => { state.rotation = (state.rotation + 270) % 360; setCanvasSize(); render(); });
  $('#rotateRight').addEventListener('click', () => { state.rotation = (state.rotation + 90) % 360; setCanvasSize(); render(); });
  $('#flipHorizontal').addEventListener('click', () => { state.flipX = !state.flipX; render(); });
  ['brightness','contrast','saturation','warmth'].forEach((id) => $(`#${id}`).addEventListener('input', () => { updateAdjustments(); render(); }));
  ['overlayText','textColor','textSize','textPosition','textAlign','textFont','outlineText','textBackground'].forEach((id) => $(`#${id}`).addEventListener('input', () => { updateTextState(); $('#textSizeValue').textContent = `${state.textSize}%`; render(); }));
  ['textPosition','textAlign','textFont','outlineText','textBackground'].forEach((id) => $(`#${id}`).addEventListener('change', () => { updateTextState(); render(); }));
  $('#cleanupToggle').addEventListener('change', (event) => { state.brush = event.target.checked; canvas.style.cursor = state.brush ? 'crosshair' : 'default'; if (state.brush) cleanupSay('Paint across the mark with a little margin. You can undo the last stroke.'); render(); });
  $('#brushSize').addEventListener('input', (event) => { state.brushSize = Number(event.target.value); $('#brushSizeValue').textContent = `${state.brushSize} px`; });
  $('#cleanButton').addEventListener('click', cleanSelection);
  $('#undoStroke').addEventListener('click', () => { state.strokes.pop(); state.cleanupApplied = false; state.lastInpaintTime = -1; render(); });
  $('#clearMask').addEventListener('click', () => { state.strokes = []; state.cleanupApplied = false; state.lastInpaintTime = -1; render(); cleanupSay('Selection cleared.'); });
  $('#trimStart').addEventListener('change', updateTrim); $('#trimEnd').addEventListener('change', updateTrim);
  $('#playbackSpeed').addEventListener('change', (event) => { state.speed = Number(event.target.value); video.playbackRate = state.speed; });

  $('#resetButton').addEventListener('click', () => {
    state.ratio = null; state.rotation = 0; state.flipX = false; state.look = 'original';
    state.brightness = 100; state.contrast = 100; state.saturation = 100; state.warmth = 0;
    state.text = ''; state.textColor = '#ffffff'; state.textSize = 5.5; state.textPosition = 'bottom'; state.textAlign = 'center'; state.font = 'system-ui,sans-serif'; state.outline = true; state.textBackground = false;
    state.brush = false; state.strokes = []; state.cleanupApplied = false; state.lastInpaintTime = -1; state.trimStart = 0; state.speed = 1;
    resetControls(); document.querySelectorAll('[data-ratio],[data-look]').forEach((el) => el.classList.remove('active'));
    if (state.kind === 'video') { video.playbackRate = 1; video.currentTime = 0; if (Number.isFinite(video.duration)) { state.trimEnd = video.duration; $('#trimEnd').value = video.duration.toFixed(1); } }
    canvas.style.cursor = 'default'; setCanvasSize(); render(); cleanupSay('Edits and cleanup marks reset.');
  });

  $('#exportButton').addEventListener('click', async (event) => {
    if (state.kind === 'image') {
      render(); canvas.toBlob((blob) => { if (blob) saveBlob(blob, `${safeName(state.media?.title)}-edited.png`); else say('Image export failed. Try a smaller image.', true); }, 'image/png');
      return;
    }
    if (!window.MediaRecorder || !canvas.captureStream) { say('Edited video export is not supported in this browser. Try a current version of Chrome, Edge, or Firefox.', true); return; }
    if (!video.duration || !Number.isFinite(video.duration)) { say('Wait for the video to finish loading, then try export.', true); return; }
    if (state.recording) return;
    updateTrim();
    const button = event.currentTarget;
    const supported = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find((type) => MediaRecorder.isTypeSupported(type));
    if (!supported) { say('This browser does not provide an MP4 or WebM encoder for edited video export.', true); return; }
    state.recording = true; button.disabled = true; button.textContent = 'Recording…';
    let stream;
    const oldRate = video.playbackRate;
    try {
      video.pause(); video.currentTime = state.trimStart;
      await new Promise((resolve, reject) => { if (Math.abs(video.currentTime - state.trimStart) < .05) resolve(); else { video.onseeked = resolve; video.onerror = reject; } });
      video.playbackRate = state.speed; await video.play();
      const captureStream = canvas.captureStream(30);
      const tracks = [...captureStream.getVideoTracks()];
      const mediaCapture = video.captureStream ? video.captureStream() : (video.mozCaptureStream ? video.mozCaptureStream() : null);
      if (mediaCapture) tracks.push(...mediaCapture.getAudioTracks());
      stream = new MediaStream(tracks);
      const chunks = [], recorder = new MediaRecorder(stream, { mimeType: supported, videoBitsPerSecond: 5_000_000 });
      state.recorder = recorder;
      const finish = () => {
        stream?.getTracks().forEach((track) => track.stop()); state.recording = false; state.recorder = null;
        button.disabled = false; button.textContent = 'Export video'; video.onended = null; video.ontimeupdate = null; video.playbackRate = oldRate; video.pause(); render();
      };
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      recorder.onerror = () => { say('Video export stopped unexpectedly. Please try again.', true); if (recorder.state !== 'inactive') recorder.stop(); };
      recorder.onstop = () => { if (chunks.length) saveBlob(new Blob(chunks, { type: supported }), `${safeName(state.media?.title)}-edited.${supported.includes('mp4') ? 'mp4' : 'webm'}`); finish(); };
      video.ontimeupdate = () => { if (video.currentTime >= state.trimEnd && recorder.state !== 'inactive') { video.pause(); recorder.stop(); } };
      video.onended = () => { if (recorder.state !== 'inactive') recorder.stop(); };
      recorder.start(1000);
      say(`Recording trimmed video with edits and audio in ${supported.includes('mp4') ? 'MP4' : 'WebM'} at ${state.speed}×. Keep this tab open…`);
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop()); state.recording = false; state.recorder = null;
      button.disabled = false; button.textContent = 'Export video'; video.playbackRate = oldRate;
      say('Video export could not start. Press play once to allow playback, then try again.', true);
    }
  });

  function saveBlob(blob, filename) {
    const link = document.createElement('a'), objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    say('Your edited copy has been downloaded.');
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    const hadController = Boolean(navigator.serviceWorker.controller);
    if (hadController) navigator.serviceWorker.addEventListener('controllerchange', () => say('A new ClipMint version is ready. Reopen the app when convenient.'));
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {});
  }
})();
