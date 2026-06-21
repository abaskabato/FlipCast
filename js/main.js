import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { buildPhone } from './phone.js';
import { drawKeypad, drawExtMessage } from './faces.js';
import { playFlip } from './audio.js';
import { Radio } from './radio.js';
import { Podcasts } from './podcasts.js';
import { parseShareParams, applyShareParams, buildShareURL } from './share.js';

// ---------- renderer / scene ----------
const canvasEl = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const stage = canvasEl.parentElement; // the .hero section
renderer.setSize(stage.clientWidth, stage.clientHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(34, stage.clientWidth / stage.clientHeight, 0.1, 100);
camera.position.set(0.1, 0.25, 4.6);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

scene.add(new THREE.HemisphereLight(0xbcd0ff, 0x202028, 0.45));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
keyLight.position.set(2.6, 4.2, 3.4);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 1; keyLight.shadow.camera.far = 14;
keyLight.shadow.camera.left = -3; keyLight.shadow.camera.right = 3;
keyLight.shadow.camera.top = 3; keyLight.shadow.camera.bottom = -3;
keyLight.shadow.bias = -0.0004;
scene.add(keyLight);
const rim = new THREE.DirectionalLight(0x88aaff, 0.9);
rim.position.set(-3, 1.5, -2.5);
scene.add(rim);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.32 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -1.55;
ground.receiveShadow = true;
scene.add(ground);

// ---------- canvases / textures ----------
function makeCanvasTexture(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return { canvas: c, ctx: c.getContext('2d'), tex, W: w, H: h };
}
const screenC = makeCanvasTexture(512, 576);
const keypadC = makeCanvasTexture(540, 760);
const extC = makeCanvasTexture(360, 150);
const sponsorC = makeCanvasTexture(512, 280);

drawKeypad(keypadC.ctx, keypadC.W, keypadC.H);
keypadC.tex.needsUpdate = true;
drawBackPanel(sponsorC.ctx, sponsorC.W, sponsorC.H);
sponsorC.tex.needsUpdate = true;

const phone = buildPhone({
    screenTex: screenC.tex, keypadTex: keypadC.tex,
    extScreenTex: extC.tex, sponsorTex: sponsorC.tex,
});
// The phone's vertical position tracks the open amount so both states stay
// centred: a folded clamshell is only ~half as tall as an open one, so without
// this it would sink to the bottom of the frame. Closed → raised & centred;
// open → lowered so the upright lid/screen sits in the clear zone below the
// header. Lerped each frame in the render loop.
const Y_CLOSED = 0.5;
const Y_OPEN = -0.28;
phone.group.position.y = Y_CLOSED;
scene.add(phone.group);

// ---------- controls ----------
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.enableZoom = false; // let the page scroll over the canvas
controls.minDistance = 2.6;
controls.maxDistance = 7;
controls.minPolarAngle = 0.55;
controls.maxPolarAngle = Math.PI - 0.7;
controls.target.set(0, -0.05, 0);
controls.addEventListener('start', () => { grabbed = true; });
let grabbed = false;

// ---------- stick / lock phone position ----------
let stuck = false;
// world-Y the camera looks at; updated by the responsive framing below so the
// pin / search views stay consistent with whatever the resize logic chose.
let frameTargetY = -0.05;
let savedCamPos = null;
let savedTarget = null;
let savedPhoneRotY = 0;
const stickBtn = document.getElementById('stickBtn');
stickBtn?.addEventListener('click', () => {
    stuck = !stuck;
    controls.enabled = !stuck;
    stickBtn.classList.toggle('on', stuck);
    stickBtn.textContent = stuck ? '📌 Unpin' : '📌 Pin';
    if (stuck) {
        savedCamPos = camera.position.clone();
        savedTarget = controls.target.clone();
        savedPhoneRotY = phone.group.rotation.y;
        // Snap to a clean, face-on view at the SAME distance the responsive
        // framing already uses (don't zoom in) so the whole open phone —
        // including the SEND/END keys — stays clear of the on-screen controls
        // on every device instead of being covered by them.
        const dist = camera.position.distanceTo(controls.target);
        controls.target.set(0, frameTargetY, 0);
        camera.position.set(0, frameTargetY + 0.12, dist);
        controls.update();
    } else if (savedCamPos && savedTarget) {
        camera.position.copy(savedCamPos);
        controls.target.copy(savedTarget);
        phone.group.rotation.y = savedPhoneRotY;
        controls.update();
    }
});

// ---------- audio + the one app ----------
const audioEl = document.createElement('audio');
audioEl.id = 'radio-audio';
// no crossOrigin: nothing reads the audio buffer (the EQ is synthesized), and
// most podcast CDNs / radio streams don't send CORS headers, so requesting
// them anonymously would block playback.
audioEl.preload = 'none';
document.body.appendChild(audioEl);

// Two "bands" share one screen + one <audio>: live RADIO and on-demand PODCASTS.
const radio = new Radio(screenC.canvas);
const podcasts = new Podcasts(screenC.canvas);
radio.setAudio(audioEl);
podcasts.setAudio(audioEl);
let app = radio;            // the active band
let band = 'radio';
radio.active = true;
podcasts.active = false;

function setBand(name) {
    const next = name === 'podcast' ? podcasts : radio;
    if (next === app) return;
    app.exit();             // stops playback on the band we're leaving
    app.active = false;
    app = next;
    band = name;
    app.active = true;
    app.enter();
    updateBandUI();
    refreshExternal();
}
// Switch the active band without triggering its default load — used when a
// share link is injecting its own station/episode that must not be overwritten.
function activateSharedBand(name) {
    const next = name === 'podcast' ? podcasts : radio;
    if (next !== app) {
        app.exit();
        app.active = false;
        app = next;
        band = name;
        app.active = true;
    }
    updateBandUI();
    refreshExternal();
}

function updateBandUI() {
    bandRadioBtn?.classList.toggle('on', band === 'radio');
    bandPodsBtn?.classList.toggle('on', band === 'podcast');
    bandRadioBtn?.setAttribute('aria-pressed', String(band === 'radio'));
    bandPodsBtn?.setAttribute('aria-pressed', String(band === 'podcast'));
    positionBandSlider();
}

// slide the highlight pill to sit exactly under the active band tab
function positionBandSlider() {
    const activeBtn = band === 'radio' ? bandRadioBtn : bandPodsBtn;
    if (!bandSliderEl || !activeBtn || !activeBtn.offsetWidth) return;
    bandSliderEl.style.width = activeBtn.offsetWidth + 'px';
    bandSliderEl.style.height = activeBtn.offsetHeight + 'px';
    bandSliderEl.style.transform = `translate(${activeBtn.offsetLeft}px, ${activeBtn.offsetTop}px)`;
}

// ---------- external display ----------
function refreshExternal() {
    const playing = app.status === 'live';
    const title = band === 'podcast' ? 'PODCAST' : 'RADIO';
    drawExtMessage(extC.ctx, extC.W, extC.H, title, playing ? '● ON AIR' : app.genre.toUpperCase());
    extC.tex.needsUpdate = true;
}
refreshExternal();
setInterval(refreshExternal, 2000);

// ---------- open / close ----------
let open = 0, openTarget = 0;
phone.setOpenAmount(0);
function setOpenTarget(v) {
    openTarget = v;
    playFlip(v === 1);
}
function toggle() { setOpenTarget(openTarget > 0.5 ? 0 : 1); }
document.getElementById('flipBtn').addEventListener('click', toggle);

// tap the phone: when open, a tap on the keypad presses that key; otherwise flip
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downXY = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downXY = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downXY) return;
    const moved = Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]);
    downXY = null;
    if (moved > 6) return; // a drag, not a tap
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(phone.group, true);
    if (!hits.length) return;
    if (open > 0.5) {
        const kp = hits.find((h) => h.object === phone.keypad && h.uv);
        if (kp) { const key = keyAtUV(kp.uv.x, kp.uv.y); if (key) { app.keypadPress(key); return; } }
    }
    toggle();
});

// map a UV hit on the keypad texture to a physical key (mirrors faces.js layout)
function keyAtUV(u, v) {
    const W = 540, H = 760, cx = W / 2;
    const x = u * W, y = (1 - v) * H;
    const dY = 110, dR = 90;
    const dx = x - cx, dy = y - dY, dist = Math.hypot(dx, dy);
    if (dist <= 44) return 'OK';
    if (dist <= dR + 8) return Math.abs(dy) >= Math.abs(dx) ? (dy < 0 ? 'UP' : 'DOWN') : (dx < 0 ? 'LEFT' : 'RIGHT');
    const callY = dY + dR + 28;
    if (y >= callY && y <= callY + 46) {
        if (x >= cx - 150 && x <= cx - 10) return 'SEND';
        if (x >= cx + 10 && x <= cx + 150) return 'END';
    }
    const gridTop = callY + 70, cols = 3, gap = 18, bw = (W - 80 - gap * 2) / cols, bh = 76;
    const labels = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
    for (let i = 0; i < 12; i++) {
        const c = i % cols, r = (i / cols) | 0;
        const kx = 40 + c * (bw + gap), ky = gridTop + r * (bh + gap);
        if (x >= kx && x <= kx + bw && y >= ky && y <= ky + bh) return labels[i];
    }
    return null;
}

// ---------- physical keyboard ----------
addEventListener('keydown', (e) => {
    if (e.target.tagName === 'TEXTAREA' || (e.target.tagName === 'INPUT' && e.target !== hiddenInput)) return;
    if (open < 0.5) return; // controls only matter when the phone is open
    if (e.key === 'Tab') { setBand(band === 'radio' ? 'podcast' : 'radio'); e.preventDefault(); return; }
    app.handleKey(e);
});

// ---------- mobile keyboard: hidden input feeding the search box ----------
const hiddenInput = document.createElement('input');
hiddenInput.type = 'text';
hiddenInput.id = 'hidden-input';
hiddenInput.autocomplete = 'off'; hiddenInput.autocorrect = 'off';
hiddenInput.autocapitalize = 'off'; hiddenInput.spellcheck = false;
Object.assign(hiddenInput.style, {
    position: 'fixed', left: '-9999px', top: '-9999px',
    opacity: '0', width: '1px', height: '1px', pointerEvents: 'none',
});
document.body.appendChild(hiddenInput);
hiddenInput.addEventListener('input', () => {
    if (!hiddenInput.value) return;
    app.typeString(hiddenInput.value);
    hiddenInput.value = '';
});
hiddenInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Backspace' || e.key === 'Escape') app.handleKey(e);
});
// when search opens on a touch device, pop the soft keyboard
app.onSearchOpen = () => { if (matchMedia('(pointer: coarse)').matches) hiddenInput.focus(); };
renderer.domElement.addEventListener('pointerdown', () => {
    if (open > 0.5 && app.mode === 'search') hiddenInput.focus();
});

// ---------- on-screen controls ----------
const hud = {
    search: document.getElementById('searchBtn'),
};
const bandRadioBtn = document.getElementById('bandRadio');
const bandPodsBtn = document.getElementById('bandPods');
const bandSliderEl = document.querySelector('.band-slider');
const bandToggleEl = document.querySelector('.band-toggle');
bandRadioBtn?.addEventListener('click', () => { ensureOpen(); setBand('radio'); });
bandPodsBtn?.addEventListener('click', () => { ensureOpen(); setBand('podcast'); });

// place the pill on first paint without animating, then enable the slide
requestAnimationFrame(() => {
    positionBandSlider();
    requestAnimationFrame(() => bandToggleEl?.classList.add('slider-ready'));
});
addEventListener('resize', positionBandSlider);
addEventListener('orientationchange', positionBandSlider);
addEventListener('load', positionBandSlider); // re-measure once emoji/fonts settle

// publish the (variable-height) header's height so the band toggle can sit
// just below it instead of being hidden under the banner
const headerEl = document.querySelector('.site-header');
function syncHeaderHeight() {
    if (!headerEl) return;
    document.documentElement.style.setProperty('--header-h', headerEl.offsetHeight + 'px');
    positionBandSlider();
}
syncHeaderHeight();
addEventListener('resize', syncHeaderHeight);
addEventListener('orientationchange', syncHeaderHeight);
addEventListener('load', syncHeaderHeight);
if (headerEl) new ResizeObserver(syncHeaderHeight).observe(headerEl);
function ensureOpen() { if (openTarget < 0.5) setOpenTarget(1); }
hud.search?.addEventListener('click', () => {
    ensureOpen();
    if (app.mode === 'search') app.submitSearch(); else app.openSearch();
    hiddenInput.focus();
});

// ---------- share: copy / native-share a link to what's playing ----------
const shareBtn = document.getElementById('shareBtn');
const SHARE_LABEL = '🔗 Share';
let shareFlashT = null;
function flashShare(msg) {
    if (!shareBtn) return;
    shareBtn.textContent = msg;
    clearTimeout(shareFlashT);
    shareFlashT = setTimeout(() => { shareBtn.textContent = SHARE_LABEL; }, 1600);
}
shareBtn?.addEventListener('click', async () => {
    const url = buildShareURL(app, band);
    if (!url) { flashShare('Nothing to share yet'); return; }
    const name = app.current?.name || 'FLIPCAST';
    // mobile: hand off to the OS share sheet (WhatsApp/iMessage/etc.) — the loop
    if (navigator.share) {
        try { await navigator.share({ title: 'FLIPCAST', text: name + ' · on FLIPCAST', url }); return; }
        catch (e) { if (e && e.name === 'AbortError') return; } // user dismissed
    }
    try { await navigator.clipboard.writeText(url); flashShare('🔗 Link copied!'); }
    catch { window.prompt('Copy this link:', url); }
});

// ---------- boot ----------
const shared = parseShareParams(location.search);
if (shared) {
    applyShareParams(shared, { radio, podcasts, activate: activateSharedBand });
    ensureOpen();                       // open the phone so the screen shows the shared track
    history.replaceState(null, '', location.origin + location.pathname);
} else {
    app.enter();
}

// ---------- now-playing bar ----------
const npEl = document.createElement('div');
npEl.id = 'nowPlaying';
npEl.innerHTML = `
  <div class="np-wave"><span></span><span></span><span></span><span></span><span></span></div>
  <div class="np-info">
    <div class="np-title">—</div>
    <div class="np-sub">Standing by</div>
  </div>
`;
const npTitle = npEl.querySelector('.np-title');
const npSub = npEl.querySelector('.np-sub');
document.body.appendChild(npEl);

let lastNpTitle = '';
function updateNowPlaying() {
    const live = app.status === 'live';
    const name = app.current?.name || '';
    const bandLabel = band === 'podcast' ? 'Podcast' : 'Radio';
    if (live && name && name !== lastNpTitle) {
        lastNpTitle = name;
        npTitle.textContent = name;
        npSub.textContent = 'Live · ' + bandLabel;
        npEl.classList.add('visible');
    } else if (!live) {
        lastNpTitle = '';
        npEl.classList.remove('visible');
    }
}

// ---------- render loop ----------
const clock = new THREE.Clock();
let booted = false;
function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);

    open += (openTarget - open) * Math.min(1, 9 * dt);
    if (Math.abs(openTarget - open) < 0.001) open = openTarget;
    phone.setOpenAmount(open);
    // keep the handset vertically centred as it folds/unfolds
    phone.group.position.y = THREE.MathUtils.lerp(Y_CLOSED, Y_OPEN, open);

    // when stuck, keep the phone facing forward; otherwise idle spin while
    // closed or settle front when open
    if (stuck) {
        phone.group.rotation.y += (0 - phone.group.rotation.y) * Math.min(1, 5 * dt);
    } else if (open < 0.5) {
        if (!grabbed) phone.group.rotation.y += dt * 0.18;
    } else {
        phone.group.rotation.y += (0 - phone.group.rotation.y) * Math.min(1, 5 * dt);
    }

    app.update(dt);
    screenC.tex.needsUpdate = true;
    updateNowPlaying();

    controls.update();
    renderer.render(scene, camera);

    if (!booted) { booted = true; document.getElementById('loader').classList.add('hidden'); }
}
animate();

// Responsive framing.
// The camera's fov is vertical, so the phone — a tall, portrait object
// (~1.0 wide x ~2.6 tall when open) — is always sized to the viewport HEIGHT.
// That's why it looks great on tall/portrait screens but shrinks on short, wide
// laptop and desktop windows: there just aren't many vertical pixels to fill, so
// the LCD becomes unreadable and the wide sides go empty.
//
// Fix: frame ADAPTIVELY. We blend from "show the whole phone" on tall/portrait
// viewports to "lean in on the lid's LCD" as the viewport gets wider/shorter, so
// the screen stays large everywhere. The keypad half slides below the on-screen
// controls (an HTML overlay), which is fine. `lean` (0 tall -> 1 wide) drives
// both the zoom and the look-at height as one smooth function of aspect ratio.
//
// Tuning knobs: WIDE_FRAME_H / WIDE_TARGET_Y control how tight + how high the
// wide-screen view sits; the lean range sets where the blend starts/ends.
const PHONE_W = 1.06;          // open-phone width incl. a little margin
const TALL_FRAME_H = 2.85;     // world units shown when tall/portrait (whole phone)
const WIDE_FRAME_H = 1.8;      // world units shown when wide/short (LCD + upper body)
const TALL_TARGET_Y = -0.05;   // look at the phone's centre
const WIDE_TARGET_Y = 0.42;    // look up toward the lid's LCD
function sizeToStage() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    const aspect = w / h;
    camera.aspect = aspect;

    const lean = THREE.MathUtils.clamp((aspect - 0.72) / (1.5 - 0.72), 0, 1);
    const frameH = THREE.MathUtils.lerp(TALL_FRAME_H, WIDE_FRAME_H, lean);
    frameTargetY = THREE.MathUtils.lerp(TALL_TARGET_Y, WIDE_TARGET_Y, lean);

    const halfTan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const distForH = frameH / (2 * halfTan);                  // fit frameH vertically
    const distForW = (PHONE_W / 0.9) / aspect / (2 * halfTan); // never clip the sides
    const dist = Math.max(distForH, distForW);

    controls.minDistance = Math.min(2.6, dist - 0.1);
    controls.maxDistance = Math.max(7, dist + 0.5);

    // re-aim at the new look-at height, preserving the user's current orbit angle
    const off = camera.position.clone().sub(controls.target).setLength(dist);
    controls.target.set(0, frameTargetY, 0);
    camera.position.copy(controls.target).add(off);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
}
sizeToStage();
addEventListener('resize', sizeToStage);
addEventListener('orientationchange', sizeToStage);
new ResizeObserver(sizeToStage).observe(stage);

// ---------- back-of-lid printed panel ----------
function drawBackPanel(ctx, W, H) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#16161f'); g.addColorStop(1, '#0a0a10');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#39ff14';
    ctx.shadowColor = 'rgba(57,255,20,0.6)'; ctx.shadowBlur = 12;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = "bold 50px 'Courier New', monospace";
    ctx.fillText('FLIP', W / 2, H * 0.34);
    ctx.fillText('CAST', W / 2, H * 0.56);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = "20px 'Courier New', monospace";
    ctx.fillText('flip it open · tune the world', W / 2, H * 0.82);
}

// debug/test hook
window.DD = {
    get app() { return app; }, radio, podcasts, audio: audioEl, phone,
    setBand, setOpen: (v) => setOpenTarget(v), stopIdle: () => { grabbed = true; },
};
