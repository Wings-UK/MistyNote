/* ═══════════════════════════════════════════
   MISTYNOTE — app-core.js
   Auth, init, routing, navigation, onboarding,
   location, validation, username picker
═══════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════

   MISTYNOTE — app.js
   Complete rewrite: clean architecture, mobile-first
═══════════════════════════════════════════════════════════ */

'use strict';

// ── CONTENT PROTECTION ─────────────────────────────────────
// Block right-click context menu globally
document.addEventListener('contextmenu', e => e.preventDefault());

// Block image/media drag
document.addEventListener('dragstart', e => {
  if (e.target.tagName === 'IMG' || e.target.tagName === 'VIDEO') e.preventDefault();
});

// ── STATE ──────────────────────────────────────────────────
let currentUser = null;
let currentProfile = null;
let viewingProfile = null; // other user currently being viewed
let feedOffset = 0;
let feedLoading = false;
let feedExhausted = false;
let currentFeedTab = 'for-you'; // 'for-you' | 'following'

// Active moments map — userId → { type: 'regular'|'commerce'|'live'|'live_commerce' }
// Seeded from demo for now — replace with DB query when moments are built
const activeMoments = new Map();
let unreadCount = 0;
let notifChannel = null;
let postsChannel = null;
let selectedFile = null;
let repostTargetId = null;
let repostTargetBtn = null;
let slideStack = [];           // navigation stack for back button
let lastMainPage = 'feed';     // track which main tab was active before sliding
let longPressTimer = null;
let detailPostId = null;
let detailCommentParentId = null;
let editAvatarFile = null;
let editCoverFile = null;
const likedPosts = new Set();
const repostedPosts = new Map();   // postId → myRepostId
const loadedPostIds = new Set();
const savedPosts = new Set();      // postIds saved/bookmarked by current user

const MAX_CHARS = 280;

// ── WAIT FOR SUPABASE ──────────────────────────────────────


// ══════════════════════════════════════════
// UPLOAD PROGRESS — COMPOSE BUTTON RING
// ══════════════════════════════════════════

const uploadState = {
  status: 'idle', // idle | uploading | success | failed
  retryFn: null,
  pendingPostData: null,
};

const RING_CIRCUMFERENCE = 138.2; // 2 * PI * 22

function setComposeRing(status, progress = 0) {
  // ── Profile FAB ring only — nav market button no longer has compose ring ──
  const fab      = document.getElementById('profile-compose-fab');
  const fabRing  = document.getElementById('profile-fab-ring');
  const fabFill  = document.getElementById('profile-fab-ring-fill');
  const fabIcon  = document.getElementById('profile-fab-icon');

  uploadState.status = status;

  if (status === 'idle') {
    if (fabRing) fabRing.style.display = 'none';
    if (fabIcon) { fabIcon.style.display = ''; fabIcon.innerHTML = `<path d="M12 5v14M5 12h14" stroke="white" stroke-width="2.5" stroke-linecap="round"/>`; }
    if (fab)    fab.classList.remove('fab-uploading','fab-success','fab-failed');

  } else if (status === 'uploading') {
    const offset = RING_CIRCUMFERENCE - (progress / 100) * RING_CIRCUMFERENCE;
    if (fabRing) { fabRing.style.display = ''; if (fabFill) fabFill.style.strokeDashoffset = offset; }
    if (fabIcon) { fabIcon.style.display = 'none'; }
    if (fab)    { fab.classList.add('fab-uploading'); fab.classList.remove('fab-success','fab-failed'); }

  } else if (status === 'success') {
    if (fab)    fab.classList.add('fab-success');
    if (fabIcon) { fabIcon.style.display = ''; fabIcon.innerHTML = `<path d="M20 6L9 17l-5-5" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`; }
    if (fabRing) fabRing.style.display = 'none';
    setTimeout(() => setComposeRing('idle'), 2000);

  } else if (status === 'failed') {
    if (fab)    fab.classList.add('fab-failed');
    if (fabIcon) { fabIcon.style.display = ''; fabIcon.innerHTML = `<path d="M12 9v4M12 17h.01" stroke="white" stroke-width="2.5" stroke-linecap="round"/><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`; }
    if (fabRing) fabRing.style.display = 'none';
  }
}

function composeOrRetry() {
  if (uploadState.status === 'uploading') return; // ignore tap while uploading
  if (uploadState.status === 'failed') {
    // Show retry / discard action sheet
    showActionSheet([
      { label: 'Retry Upload', action: () => { if (uploadState.retryFn) uploadState.retryFn(); } },
      { label: 'Discard Post', style: 'destructive', action: () => {
        uploadState.retryFn = null;
        uploadState.pendingPostData = null;
        setComposeRing('idle');
      }},
      { label: 'Cancel', action: () => {} }
    ]);
    return;
  }
  openComposer();
}

// ══════════════════════════════════════════
// ROUTER
// ══════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// ROUTER — disabled (deep links removed, homepage only)
// pushRoute/replaceRoute kept as no-ops so call sites don't break
// ═══════════════════════════════════════════════════════════

function getRoute()          { return { type: 'home' }; }
function pushRoute(path)     { /* no-op */ }
function replaceRoute(path)  { /* no-op */ }
async function handleRoute() { /* no-op */ }

// ═══════════════════════════════════════════════════════════
// BACK BUTTON — Mobile Back Navigation
// ═══════════════════════════════════════════════════════════

let _backReady = false;

function _initBackButton() {
  if (_backReady) return;
  _backReady = true;
  // Push an extra entry so first back press fires popstate
  window.history.pushState(null, '', window.location.pathname);
  addExitDialogStyles();
}

function addExitDialogStyles() {
  if (document.getElementById('exit-dialog-styles')) return;
  const style = document.createElement('style');
  style.id = 'exit-dialog-styles';
  style.textContent = [
    '.exit-dialog-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0);backdrop-filter:blur(0);z-index:100000;display:flex;align-items:flex-end;justify-content:center;transition:background .2s ease,backdrop-filter .2s ease;pointer-events:none;}',
    '.exit-dialog-overlay.visible{background:rgba(0,0,0,0.5);backdrop-filter:blur(8px);pointer-events:all;}',
    '.exit-dialog{background:var(--bg,#fff);border-radius:20px 20px 0 0;width:100%;max-width:480px;padding:16px 20px calc(30px + env(safe-area-inset-bottom,0px));transform:translateY(100%);transition:transform .3s cubic-bezier(.32,.72,0,1);box-shadow:0 -4px 20px rgba(0,0,0,.15);}',
    '.exit-dialog-overlay.visible .exit-dialog{transform:translateY(0);}',
    '.exit-dialog-handle{width:36px;height:4px;background:var(--border,#e5e7eb);border-radius:2px;margin:0 auto 20px;}',
    '.exit-dialog-title{font-size:17px;font-weight:700;color:var(--text,#111);text-align:center;margin-bottom:8px;}',
    '.exit-dialog-message{font-size:14px;color:var(--text2,#6b7280);text-align:center;margin-bottom:24px;line-height:1.5;}',
    '.exit-dialog-btn{width:100%;padding:14px;border-radius:12px;border:none;font-size:16px;font-weight:600;cursor:pointer;transition:transform .1s ease;-webkit-tap-highlight-color:transparent;}',
    '.exit-dialog-btn:active{transform:scale(0.98);}',
    '.exit-dialog-confirm{background:#ff3b5c;color:#fff;margin-bottom:10px;display:block;}',
    '.exit-dialog-cancel{background:var(--bg2,#f3f4f6);color:var(--text,#111);display:block;}'
  ].join('');
  document.head.appendChild(style);
}

function _getActiveMainPage() {
  const pages = ['feed', 'discover', 'notifications', 'profile', 'market'];
  for (const id of pages) {
    if (document.getElementById('page-' + id)?.classList.contains('active')) return id;
  }
  return 'feed';
}

function _getActiveProfileTab() {
  return document.querySelector('#prf-tabs .prf-icon-tab.active')?.dataset?.tab || 'list';
}

function closeExitDialog() {
  const d = document.getElementById('mn-exit-dialog');
  if (!d) return;
  d.classList.remove('visible');
  setTimeout(() => d.remove(), 300);
}

function showExitConfirm() {
  if (document.getElementById('mn-exit-dialog')) return;

  const overlay = document.createElement('div');
  overlay.id = 'mn-exit-dialog';
  overlay.className = 'exit-dialog-overlay';
  overlay.innerHTML =
    '<div class="exit-dialog">' +
    '<div class="exit-dialog-handle"></div>' +
    '<div class="exit-dialog-title">Leave MistyNote?</div>' +
    '<div class="exit-dialog-message">Everything will be here when you come back.</div>' +
    '<button class="exit-dialog-btn exit-dialog-confirm" id="exit-confirm">Exit</button>' +
    '<button class="exit-dialog-btn exit-dialog-cancel" id="exit-cancel">Stay</button>' +
    '</div>';

  document.body.appendChild(overlay);
  setTimeout(() => overlay.classList.add('visible'), 10);

  document.getElementById('exit-confirm').onclick = () => {
    closeExitDialog();
    _backReady = false;
    setTimeout(() => window.history.back(), 350);
  };
  document.getElementById('exit-cancel').onclick = closeExitDialog;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeExitDialog(); });
}

function handlePhysicalBack() {
  // Always push immediately so next back press is also intercepted
  window.history.pushState(null, '', window.location.pathname);

  // P1: Exit dialog
  if (document.getElementById('mn-exit-dialog')) {
    closeExitDialog(); return;
  }

  // P1: Composer
  if (document.getElementById('mn-composer')) {
    closeComposer(); return;
  }

  // P1: Action sheet
  const as = document.querySelector('.action-sheet-overlay');
  if (as) { as.remove(); return; }

  // P1: Echoes overlay
  if (document.getElementById('echoes-overlay')?.classList.contains('open')) {
    closeEchoes(); return;
  }

  // P1: Follow list
  if (document.getElementById('follow-list-overlay')?.classList.contains('visible')) {
    closeFollowList(); return;
  }

  // P1: Video fullscreen
  if (document.getElementById('video-fs')?.classList.contains('active')) {
    closeVideoFS(); return;
  }

  // P1: Chat image viewer
  const civ = document.getElementById('chat-img-viewer');
  if (civ) { civ.remove(); return; }

  // P1: Emoji tray
  const emoji = document.querySelector('.mnc-emoji-tray, .composer-emoji-picker');
  if (emoji) { emoji.remove(); return; }

  // P2: Slide stack
  if (slideStack.length > 0) {
    slideBack(); return;
  }

  // P3: Main page sub-tab logic
  const page = _getActiveMainPage();

  // Feed: following tab → for-you
  if (page === 'feed' && currentFeedTab === 'following') {
    const btn = document.getElementById('feed-tab-foryou');
    if (btn) setFeedTab('for-you', btn);
    return;
  }

  // Discover: search active → clear (tab first if not on posts)
  if (page === 'discover' && (document.getElementById('disc-input')?.value || '').trim()) {
    if (discCurrentTab && discCurrentTab !== 'posts') {
      const btn = document.querySelector('.disc-tab[data-tab="posts"]');
      if (btn) discTab('posts', btn);
    } else {
      discClear();
    }
    return;
  }

  // Profile: non-list tab → list tab
  if (page === 'profile' && _getActiveProfileTab() !== 'list') {
    const btn = document.querySelector('#prf-tabs .prf-icon-tab[data-tab="list"]');
    if (btn) switchPrfTab('list', btn);
    return;
  }

  // P4: Non-home page → go to feed
  if (page !== 'feed') {
    navTo('feed'); return;
  }

  // P5: Home, clean → exit dialog
  showExitConfirm();
}

window.addEventListener('popstate', () => {
  if (!_backReady) return;
  handlePhysicalBack();
});

// ══════════════════════════════════════════
// USERNAME / BIO VALIDATION
// ══════════════════════════════════════════

function validateUsername(raw) {
  // Strip leading @ if present
  const username = raw.replace(/^@/, '').trim();
  if (!username) return { valid: false, error: 'Username is required', value: '' };
  if (username.length < 3) return { valid: false, error: 'At least 3 characters required', value: username };
  if (username.length > 15) return { valid: false, error: 'Max 15 characters', value: username };
  if (!/^[a-z0-9_]+$/.test(username)) return { valid: false, error: 'Only lowercase letters, numbers and _ allowed', value: username };
  if (/^_/.test(username) || /_$/.test(username)) return { valid: false, error: 'Cannot start or end with underscore', value: username };
  if (/__/.test(username)) return { valid: false, error: 'No consecutive underscores', value: username };
  return { valid: true, error: '', value: username };
}

function sanitizeUsernameInput(input) {
  // Force lowercase, strip invalid chars as user types
  return input.toLowerCase().replace(/[^a-z0-9_]/g, '');
}

window.addEventListener('supabase-ready', init);

// ── INIT ──────────────────────────────────────────────────
async function init() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      showAuthScreen();
      return;
    }
    currentUser = session.user;

    const { data: profile } = await supabase
      .from('users').select('username').eq('id', currentUser.id).maybeSingle();

    if (!profile?.username) {
      showUsernamePicker(currentUser);
      return;
    }

    await bootApp();
  } catch (e) {
    console.error('Init error:', e);
    showAuthScreen();
  }
}

// showDeepLinkSplash / hideDeepLinkSplash removed — deep links disabled

// ══════════════════════════════════════════
// LOCATION — silent auto-detect on every boot
// ══════════════════════════════════════════

// ── Silent background location detection — every session ──
// No UI, no manual input, retries automatically, always current
async function detectAndSaveLocation() {
  if (!currentUser) return;
  if (!navigator.geolocation) return;
  _gpsAttempt(currentUser.id, true, 0);
}

function _gpsAttempt(userId, highAccuracy, attempt) {
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try {
        const { latitude, longitude } = pos.coords;
        const res = await fetch(
          `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`
        );
        if (!res.ok) throw new Error('api_fail');
        const data = await res.json();

        const city    = data.locality || data.city || data.principalSubdivision || '';
        const state   = data.principalSubdivision || '';
        const country = data.countryName || '';
        const parts   = [city];
        if (state && state !== city) parts.push(state);
        if (country) parts.push(country);
        const location = parts.filter(Boolean).join(', ');

        if (location && country) {
          // Save silently — update every session so it's always current
          await supabase.from('users').update({ location }).eq('id', userId).catch(() => {});
          if (currentProfile && currentUser?.id === userId) {
            currentProfile.location = location;
            if (document.getElementById('page-profile')?.classList.contains('active')) {
              renderMyProfile();
            }
          }
        } else if (attempt < 2) {
          // Data returned but no usable location — retry after delay
          setTimeout(() => _gpsAttempt(userId, false, attempt + 1), 3000);
        }
      } catch(e) {
        // API failed — retry up to 2 times with increasing delay
        if (attempt < 2) {
          setTimeout(() => _gpsAttempt(userId, false, attempt + 1), (attempt + 1) * 4000);
        }
      }
    },
    (err) => {
      if (err.code === 1) return; // Permission denied — respect user choice, silent
      // Timeout or unavailable — retry with low accuracy
      if (highAccuracy && attempt < 2) {
        setTimeout(() => _gpsAttempt(userId, false, attempt + 1), 2000);
      }
    },
    {
      timeout: highAccuracy ? 12000 : 20000,
      maximumAge: highAccuracy ? 0 : 600000,
      enableHighAccuracy: highAccuracy
    }
  );
}



function sortMomentsRow() {
  const row = document.getElementById('stories-row');
  if (!row) return;
  // Move all .seen cards to the end, keeping unseen at front
  const seen   = Array.from(row.querySelectorAll('.moment-card.seen'));
  const unseen = Array.from(row.querySelectorAll('.moment-card:not(.seen)'));
  // Re-append: add button stays first (it's not .moment-card), then unseen, then seen
  unseen.forEach(el => row.appendChild(el));
  seen.forEach(el  => row.appendChild(el));
}

// ══════════════════════════════════════════
// USERNAME PICKER — for Google sign-up
// ══════════════════════════════════════════

function showUsernamePicker(user) {
  const picker = document.getElementById('username-picker');
  const authScreen = document.getElementById('auth-screen');
  const app = document.getElementById('app');
  if (authScreen) authScreen.style.display = 'none';
  if (app) app.classList.add('hidden');
  if (picker) picker.classList.remove('hidden');

  // Show their Google avatar
  const avatar = user.user_metadata?.avatar_url || user.user_metadata?.picture || '';
  const avatarEl = document.getElementById('up-avatar');
  if (avatarEl) {
    if (avatar) { avatarEl.src = avatar; }
    else { avatarEl.style.background = 'rgba(108,71,255,0.3)'; }
  }
}

function hideUsernamePicker() {
  const picker = document.getElementById('username-picker');
  if (picker) picker.classList.add('hidden');
}

let upDebounce = null;
function validateUsernamePickerInput(input) {
  const btn = document.getElementById('up-btn');
  const wrap = document.getElementById('up-input-wrap');
  const hint = document.getElementById('up-hint');
  const err  = document.getElementById('up-error');
  const val  = input.value.trim().toLowerCase();

  // Clear debounce
  clearTimeout(upDebounce);
  err.classList.add('hidden');
  wrap.classList.remove('valid', 'error');
  btn.disabled = true;

  if (!val) { hint.style.display = 'block'; return; }
  hint.style.display = 'none';

  // Basic validation
  if (!/^[a-z0-9_]+$/.test(val)) {
    wrap.classList.add('error');
    err.textContent = 'Only letters, numbers and underscores allowed';
    err.classList.remove('hidden');
    return;
  }
  if (val.length < 3) {
    wrap.classList.add('error');
    err.textContent = 'Username must be at least 3 characters';
    err.classList.remove('hidden');
    return;
  }

  // Debounce availability check
  upDebounce = setTimeout(async () => {
    const { data } = await supabase.from('users').select('id').eq('username', val).maybeSingle();
    if (data) {
      wrap.classList.add('error');
      err.textContent = 'Username already taken — try another';
      err.classList.remove('hidden');
    } else {
      wrap.classList.add('valid');
      btn.disabled = false;
    }
  }, 400);
}

async function submitUsernamePicker() {
  if (!currentUser) return;
  const input = document.getElementById('up-username-input');
  const btn   = document.getElementById('up-btn');
  const loader = document.getElementById('up-loader');
  const btnText = document.getElementById('up-btn-text');
  const username = input.value.trim().toLowerCase();

  if (!username) return;

  btn.disabled = true;
  loader.classList.remove('hidden');
  btnText.style.display = 'none';

  try {
    // Double-check availability
    const { data: existing } = await supabase.from('users').select('id').eq('username', username).maybeSingle();
    if (existing) {
      showToast('Username taken — try another');
      document.getElementById('up-input-wrap').classList.add('error');
      return;
    }

    // Get Google profile data
    const meta = currentUser.user_metadata || {};
    const avatar = meta.avatar_url || meta.picture || '';
    const fullName = meta.full_name || meta.name || '';

    // Create user profile
    await supabase.from('users').upsert({
      id: currentUser.id,
      username,
      bio: '',
      location: '',
      avatar,
      cover: '',
      followers: 0,
      following: 0,
      display_name: fullName,
    });

    hideUsernamePicker();
    await bootApp(false);

  } catch (e) {
    showToast('Something went wrong. Please try again.');
  } finally {
    btn.disabled = false;
    loader.classList.add('hidden');
    btnText.style.display = 'block';
  }
}


// ══════════════════════════════════════════
// MARKET PAGE
// ══════════════════════════════════════════
function showMarket() {
  // Close any slide pages first
  if (typeof slideStack !== 'undefined' && slideStack.length > 0) {
    slideStack.forEach(id => document.getElementById('page-' + id)?.classList.remove('active'));
    slideStack.length = 0;
  }
  document.getElementById('comment-bar').style.display = 'none';
  document.getElementById('my-profile-header').style.display = 'none';
  document.getElementById('user-profile-header').style.display = 'none';
  document.getElementById('bottom-nav').style.display = 'flex';

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-market')?.classList.add('active');

  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.page === 'market');
  });

  startMktCountdown();
}

function mktSetCat(btn) {
  document.querySelectorAll('.mkt-cat').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

let _mktCountdownInterval = null;
function startMktCountdown() {
  if (_mktCountdownInterval) return;
  let secs = 2 * 3600 + 45 * 60 + 18;
  const el = document.getElementById('mkt-countdown');
  const tick = () => {
    if (!el) return;
    secs = Math.max(0, secs - 1);
    const h = String(Math.floor(secs / 3600)).padStart(2, '0');
    const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
    const s = String(secs % 60).padStart(2, '0');
    el.textContent = `${h}:${m}:${s}`;
  };
  _mktCountdownInterval = setInterval(tick, 1000);
}

async function bootApp() {
  document.getElementById('auth-screen').style.display = 'none';

  // Check if this user needs to pick a username (Google OAuth new users)
  const user = currentUser || (await supabase.auth.getUser()).data?.user;
  if (user) {
    const { data: profile } = await supabase
      .from('users')
      .select('username, onboarding_done')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile?.username) {
      currentUser = user;
      showUsernamePicker(user);
      return;
    }
    if (!profile?.onboarding_done) {
      currentUser = user;
      await loadMyProfile();
      showOnboarding();
      return;
    }
  }

  const appEl = document.getElementById('app');
  appEl.classList.remove('hidden');
  _initBackButton();

  injectFeedPostStyles();
  injectEchoesPanel();

  if (localStorage.getItem('darkMode') === 'true') {
    document.documentElement.setAttribute('data-theme', 'dark');
    const toggle = document.getElementById('dark-mode-toggle');
    if (toggle) toggle.checked = true;
  }

  await loadMyProfile();
  updateNavAvatar();
  setTimeout(() => detectAndSaveLocation(), 2000);
  sortMomentsRow();
  initIntersectionObserver();
  requestAnimationFrame(initFeedTabBar);
  initCommentBarInput();
  subscribeToNotifs();
  subscribeToPostUpdates();

  // Always load feed normally
  loadFeed();
  loadNotifications();
  loadInitialNotifCount();
  initOneSignal(); // OneSignal push — links device to logged-in user
}

// ══════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════

let isSignup = false;

// ══════════════════════════════════════════
// ONBOARDING FLOW
// ══════════════════════════════════════════

const OB_INTERESTS = [
  { emoji: '\u{1F5F3}', name: 'Politics' },
  { emoji: '\u{1F3B5}', name: 'Afrobeats' },
  { emoji: '\u{1F3E0}', name: 'BBNaija' },
  { emoji: '\u{1F3AC}', name: 'Nollywood' },
  { emoji: '\u{1F457}', name: 'Fashion' },
  { emoji: '\u{1F372}', name: 'Food & Recipes' },
  { emoji: '\u{1F4B0}', name: 'Business & Money' },
  { emoji: '\u{1F484}', name: 'Beauty & Skincare' },
  { emoji: '\u{1F4F1}', name: 'Tech & Gadgets' },
  { emoji: '\u{26BD}', name: 'Sports & Football' },
  { emoji: '\u{1F602}', name: 'Comedy & Skits' },
  { emoji: '\u{1F4AA}', name: 'Fitness & Wellness' },
  { emoji: '\u2708\uFE0F', name: 'Travel & Lifestyle' },
  { emoji: '\u{1F3A8}', name: 'Art & Creativity' },
  { emoji: '\u{1F3AE}', name: 'Gaming' },
  { emoji: '\u{1F4C8}', name: 'Crypto & Finance' },
  { emoji: '\u{1F495}', name: 'Relationships' },
  { emoji: '\u{1F4DA}', name: 'Education' },
];

let obCurrentStep = 1;
let obSelectedInterests = new Set();
let obFollowCount = 0;
let obAvatarUrl = '';
let obAvatarFile = null;

function showOnboarding() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('username-picker-screen')?.classList.add('hidden');
  document.getElementById('app')?.classList.add('hidden');
  // Lock body to prevent keyboard from shifting layout
  document.body.classList.add('ob-open');
  const screen = document.getElementById('onboarding-screen');
  screen.classList.remove('hidden');
  obCurrentStep = 1;
  obUpdateProgress();
  obRenderInterests();
  const googleAvatar = currentProfile?.avatar || '';
  if (googleAvatar) {
    obAvatarUrl = googleAvatar;
    const img = document.getElementById('ob-avatar-preview');
    if (img) { img.src = googleAvatar; img.style.display = 'block'; }
    const ph = document.getElementById('ob-avatar-placeholder');
    if (ph) ph.style.display = 'none';
  }
}

function hideOnboarding() {
  document.getElementById('onboarding-screen').classList.add('hidden');
  document.body.classList.remove('ob-open');
}

function obUpdateProgress() {
  const pct = (obCurrentStep / 5) * 100; // 0-5 steps
  const bar = document.getElementById('ob-progress-bar');
  if (bar) bar.style.width = pct + '%';
}

function obGoToStep(step) {
  const current = document.getElementById('ob-step-' + obCurrentStep);
  const next = document.getElementById('ob-step-' + step);
  if (!next) return;
  if (current) {
    current.classList.add('slide-out');
    setTimeout(() => { current.classList.remove('active', 'slide-out'); }, 380);
  }
  setTimeout(() => {
    next.classList.add('active', 'slide-in');
    setTimeout(() => next.classList.remove('slide-in'), 380);
    obCurrentStep = step;
    obUpdateProgress();
    if (step === 3) obRenderInterests();
    if (step === 4) obLoadSuggestedUsers();
    if (step === 5) obSetupCelebration();
  }, current ? 200 : 0);
}

function obNext() { obGoToStep(obCurrentStep + 1); }

async function obSaveProfile() {
  const bio = document.getElementById('ob-bio-input')?.value?.trim() || '';
  const saveBtn = document.getElementById('ob-save-profile-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

  // Upload avatar first if selected
  if (obAvatarFile && currentUser) {
    try {
      const ext = obAvatarFile.name.split('.').pop();
      const path = 'avatars/' + currentUser.id + '.' + ext;
      const { data: upData } = await supabase.storage.from('avatars').upload(path, obAvatarFile, { upsert: true });
      if (upData) {
        const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
        obAvatarUrl = urlData?.publicUrl || '';
      }
    } catch(e) { console.warn('Avatar upload failed:', e); }
  }

  // Save bio + avatar to DB — await so we confirm it worked
  if (currentUser) {
    try {
      await supabase.from('users').update({
        bio,
        ...(obAvatarUrl ? { avatar: obAvatarUrl } : {})
      }).eq('id', currentUser.id);
      // Update local profile
      if (currentProfile) {
        currentProfile.bio = bio;
        if (obAvatarUrl) currentProfile.avatar = obAvatarUrl;
      }
    } catch(e) { console.warn('Profile save failed:', e); }
  }

  // Navigate after save completes
  obNext();
}

function obHandleAvatar(input) {
  const file = input.files?.[0];
  if (!file) return;
  obAvatarFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    const img = document.getElementById('ob-avatar-preview');
    const ph = document.getElementById('ob-avatar-placeholder');
    if (img) { img.src = e.target.result; img.style.display = 'block'; }
    if (ph) ph.style.display = 'none';
  };
  reader.readAsDataURL(file);
}

// ── Step 0: Username ──
function obValidateUsername(input) {
  const val = input.value.replace(/[^a-zA-Z0-9_]/g, '');
  input.value = val;
  const wrap = document.getElementById('ob-username-wrap');
  const hint = document.getElementById('ob-username-hint');
  const btn  = document.getElementById('ob-username-btn');
  const err  = document.getElementById('ob-username-error');

  wrap.classList.remove('error', 'success');
  err.classList.add('hidden');

  if (!val) {
    hint.textContent = 'Letters, numbers and underscores only. Min 3, max 15.';
    btn.disabled = true;
    return;
  }
  if (val.length < 3) {
    hint.textContent = val.length + '/15 — minimum 3 characters';
    btn.disabled = true;
    return;
  }
  hint.textContent = val.length + '/15';
  wrap.classList.add('success');
  btn.disabled = false;
}

async function obSaveUsername() {
  const input = document.getElementById('ob-username-input');
  const btn   = document.getElementById('ob-username-btn');
  const wrap  = document.getElementById('ob-username-wrap');
  const err   = document.getElementById('ob-username-error');
  const username = input.value.trim().toLowerCase();

  if (!username || username.length < 3) return;

  btn.disabled = true;
  btn.textContent = 'Checking...';
  err.classList.add('hidden');

  try {
    // Check not taken
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('username', username)
      .maybeSingle();

    if (existing) {
      wrap.classList.remove('success');
      wrap.classList.add('error');
      err.textContent = 'Username already taken — try another';
      err.classList.remove('hidden');
      btn.disabled = false;
      btn.innerHTML = 'Continue <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
      return;
    }

    // Save username
    const googleAvatar = currentUser?.user_metadata?.avatar_url || currentUser?.user_metadata?.picture || '';
    await supabase.from('users').upsert({
      id: currentUser.id,
      username,
      avatar: googleAvatar,
      bio: '', location: '', cover: '', followers: 0, following: 0
    });

    if (currentProfile) currentProfile.username = username;
    else currentProfile = { id: currentUser.id, username, avatar: googleAvatar };

    obGoToStep(1);
  } catch(e) {
    err.textContent = 'Something went wrong. Try again.';
    err.classList.remove('hidden');
    btn.disabled = false;
    btn.innerHTML = 'Continue <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
  }
}

function obRenderInterests() {
  const grid = document.getElementById('ob-interests-grid');
  if (!grid) return;
  // Always clear and re-render to ensure click listeners are fresh
  grid.innerHTML = '';
  obSelectedInterests.clear();
  // Reset button and hint
  const btn = document.getElementById('ob-interests-btn');
  const hint = document.getElementById('ob-interests-hint');
  if (btn) btn.disabled = true;
  if (hint) hint.textContent = 'Select at least 3 to continue';
  OB_INTERESTS.forEach(interest => {
    const card = document.createElement('div');
    card.className = 'ob-interest-card';
    card.innerHTML = '<span class="ob-interest-emoji">' + interest.emoji + '</span>' +
      '<span class="ob-interest-name">' + interest.name + '</span>' +
      '<div class="ob-interest-check"><svg width="10" height="10" viewBox="0 0 12 12" fill="none">' +
      '<path d="M2 6l3 3 5-5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>';
    card.addEventListener('click', () => obToggleInterest(card, interest.name));
    grid.appendChild(card);
  });
}

function obToggleInterest(card, name) {
  if (obSelectedInterests.has(name)) { obSelectedInterests.delete(name); card.classList.remove('selected'); }
  else { obSelectedInterests.add(name); card.classList.add('selected'); }
  const count = obSelectedInterests.size;
  const hint = document.getElementById('ob-interests-hint');
  const btn = document.getElementById('ob-interests-btn');
  if (hint) hint.textContent = count < 3 ? 'Select at least ' + (3 - count) + ' more' : count + ' selected — looking good!';
  if (btn) btn.disabled = count < 3;
}

async function obSaveInterests() {
  // Navigate immediately so DB errors never block the user
  obNext();
  // Save in background
  const interests = Array.from(obSelectedInterests);
  if (currentUser && interests.length >= 3) {
    supabase.from('users').update({ interests }).eq('id', currentUser.id);
    if (currentProfile) currentProfile.interests = interests;
  }
}

async function obLoadSuggestedUsers() {
  const list = document.getElementById('ob-follow-list');
  if (!list) return;
  obFollowCount = 0; // reset count
  try {
    const { data: users } = await supabase.from('users').select('id,username,avatar,bio,followers')
      .neq('id', currentUser?.id || '').order('followers', { ascending: false }).limit(10);
    if (!users?.length) {
      list.innerHTML = '<p style="text-align:center;color:var(--text3);padding:40px 0;font-size:14px">No suggestions yet. You are an early bird!</p>';
      const fb = document.getElementById('ob-follow-btn');
      if (fb) fb.disabled = false;
      return;
    }

    // Get who I already follow
    let alreadyFollowing = new Set();
    if (currentUser) {
      const { data: myFollows } = await supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', currentUser.id);
      (myFollows || []).forEach(f => alreadyFollowing.add(f.following_id));
    }

    // Pre-count already followed
    obFollowCount = 0;
    users.forEach(u => { if (alreadyFollowing.has(u.id)) obFollowCount++; });

    list.innerHTML = '';
    users.forEach(user => {
      const isFollowing = alreadyFollowing.has(user.id);
      const row = document.createElement('div');
      row.className = 'ob-follow-row';
      // Build row with DOM to avoid quote escaping issues
      const av = document.createElement('img');
      av.className = 'ob-follow-av';
      av.src = user.avatar || '';
      av.alt = '';
      av.onerror = () => { av.style.background = 'rgba(108,71,255,0.15)'; av.removeAttribute('src'); };

      const info = document.createElement('div');
      info.className = 'ob-follow-info';
      info.innerHTML = '<div class="ob-follow-name">@' + escHtml(user.username || '') + '</div>' +
        '<div class="ob-follow-bio">' + escHtml(user.bio || fmtNum(user.followers || 0) + ' followers') + '</div>';

      const followBtn = document.createElement('button');
      followBtn.className = 'ob-row-follow-btn';
      followBtn.textContent = isFollowing ? 'Following' : 'Follow';
      if (isFollowing) followBtn.classList.add('following');
      followBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        obToggleFollow(followBtn, user.id);
      });

      row.appendChild(av);
      row.appendChild(info);
      row.appendChild(followBtn);
      list.appendChild(row);
    });

    // Update counter with pre-existing follows
    const ct = document.getElementById('ob-follow-count-text');
    const fb = document.getElementById('ob-follow-btn');
    if (ct) ct.textContent = obFollowCount < 3
      ? 'Follow ' + Math.max(0, 3 - obFollowCount) + ' more to continue'
      : obFollowCount + ' followed';
    if (fb) fb.disabled = obFollowCount < 3;

  } catch(e) {
    list.innerHTML = '<p style="text-align:center;color:rgba(255,255,255,0.3);padding:40px 0;font-size:14px">Could not load suggestions</p>';
    const fb = document.getElementById('ob-follow-btn');
    if (fb) fb.disabled = false;
  }
}

async function obToggleFollow(btn, uid) {
  console.log('obToggleFollow called', uid, currentUser?.id);
  if (!currentUser) { showToast('Not signed in'); return; }
  if (!uid) { showToast('No user ID'); return; }
  const isFollowing = btn.classList.contains('following');
  btn.disabled = true;
  btn.style.opacity = '0.5';
  try {
    if (isFollowing) {
      const { error } = await supabase.from('follows').delete()
        .eq('follower_id', currentUser.id).eq('following_id', uid);
      console.log('Unfollow result:', error);
      if (!error) {
        btn.classList.remove('following'); btn.textContent = 'Follow';
        obFollowCount = Math.max(0, obFollowCount - 1);
      } else {
        showToast('Error: ' + error.message);
      }
    } else {
      const { error } = await supabase.from('follows').insert({
        follower_id: currentUser.id, following_id: uid
      });
      if (!error) {
        btn.classList.add('following'); btn.textContent = 'Following';
        obFollowCount++;
        if (uid !== currentUser.id) {
          insertNotification({ user_id: uid, actor_id: currentUser.id, post_id: null, type: 'follow' });
        }
      } else {
        showToast('Error: ' + error.message);
      }
    }
  } catch(e) {
    console.error('obToggleFollow exception:', e);
    showToast('Failed: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.style.opacity = '1';
  }
  const ct = document.getElementById('ob-follow-count-text');
  const fb = document.getElementById('ob-follow-btn');
  if (ct) ct.textContent = obFollowCount < 3
    ? 'Follow ' + Math.max(0, 3 - obFollowCount) + ' more to continue'
    : obFollowCount + ' followed';
  if (fb) fb.disabled = obFollowCount < 3;
}

function obFinishFollowing() { obNext(); }

function obSetupCelebration() {
  const avatar = obAvatarUrl || currentProfile?.avatar || '';
  const av = document.getElementById('ob-celebrate-avatar');
  if (av) { av.src = avatar; av.onerror = () => { av.style.display = 'none'; }; }
  const title = document.getElementById('ob-celebrate-title');
  if (title) title.textContent = 'You are all set, @' + (currentProfile?.username || '') + '!';
  const stats = document.getElementById('ob-celebrate-stats');
  if (stats) stats.innerHTML =
    '<div class="ob-celebrate-stat"><span class="ob-celebrate-stat-num">' + obFollowCount +
    '</span><span class="ob-celebrate-stat-label">Following</span></div>' +
    '<div class="ob-celebrate-stat"><span class="ob-celebrate-stat-num">' + obSelectedInterests.size +
    '</span><span class="ob-celebrate-stat-label">Interests</span></div>';
  obLaunchConfetti();
}

function obLaunchConfetti() {
  const container = document.getElementById('ob-confetti');
  if (!container) return;
  container.innerHTML = '';
  const colors = ['#6C47FF','#a78bfa','#ff3b5c','#00c48c','#FFB800','#fff'];
  for (let i = 0; i < 60; i++) {
    const piece = document.createElement('div');
    piece.className = 'ob-confetti-piece';
    piece.style.cssText = 'left:' + (Math.random() * 100) + '%;' +
      'background:' + colors[Math.floor(Math.random() * colors.length)] + ';' +
      'width:' + (4 + Math.random() * 8) + 'px;' +
      'height:' + (4 + Math.random() * 8) + 'px;' +
      'border-radius:' + (Math.random() > 0.5 ? '50%' : '2px') + ';' +
      'animation-duration:' + (1.5 + Math.random() * 2) + 's;' +
      'animation-delay:' + Math.random() + 's;';
    container.appendChild(piece);
  }
}

async function obFinish() {
  if (currentUser) {
    try { await supabase.from('users').update({ onboarding_done: true }).eq('id', currentUser.id); } catch(e) {}
    if (currentProfile) currentProfile.onboarding_done = true;
  }
  hideOnboarding();
  const appEl = document.getElementById('app');
  if (appEl) appEl.classList.remove('hidden');
  _initBackButton(); // arm back button for new user

  // Inject feed styles that bootApp normally handles
  injectFeedPostStyles();
  injectEchoesPanel();
  initIntersectionObserver();
  sortMomentsRow();
  requestAnimationFrame(initFeedTabBar);
  updateNavAvatar();
  setTimeout(() => detectAndSaveLocation(), 2000);

  navTo('feed');
}

// ══════════════════════════════════════════
// USERNAME PICKER
// ══════════════════════════════════════════

function showUsernamePicker(user) {
  document.getElementById('auth-screen').style.display = 'none';
  const screen = document.getElementById('username-picker-screen');
  screen.classList.remove('hidden');
  const avatarEl = document.getElementById('up-google-avatar');
  const avatar = user?.user_metadata?.avatar_url || user?.user_metadata?.picture || '';
  if (avatar && avatarEl) { avatarEl.src = avatar; avatarEl.onerror = () => { avatarEl.style.display = 'none'; }; }
  else if (avatarEl) avatarEl.style.display = 'none';
  setTimeout(() => document.getElementById('up-username-input')?.focus(), 300);
}

function hideUsernamePicker() {
  document.getElementById('username-picker-screen').classList.add('hidden');
}

function validateUsernamePickerInput(input) {
  const val = input.value.replace(/[^a-zA-Z0-9_]/g, '');
  input.value = val;
  const wrap = document.getElementById('up-input-wrap');
  const hint = document.getElementById('up-hint');
  const btn = document.getElementById('up-btn');
  const err = document.getElementById('up-error');
  wrap.classList.remove('error', 'success');
  err.classList.add('hidden');
  if (!val) { hint.textContent = 'Letters, numbers and underscores only. Max 15 characters.'; btn.disabled = true; return; }
  if (val.length < 3) { hint.textContent = val.length + '/15 minimum 3 characters'; btn.disabled = true; return; }
  hint.textContent = val.length + '/15';
  wrap.classList.add('success');
  btn.disabled = false;
}

async function submitUsernamePicker() {
  const input = document.getElementById('up-username-input');
  const btn = document.getElementById('up-btn');
  const btnText = document.getElementById('up-btn-text');
  const loader = document.getElementById('up-loader');
  const err = document.getElementById('up-error');
  const wrap = document.getElementById('up-input-wrap');
  const username = input.value.trim().toLowerCase();
  if (!username || username.length < 3) return;
  btn.disabled = true; btnText.style.display = 'none'; loader.classList.remove('hidden'); err.classList.add('hidden');
  try {
    const { data: existing } = await supabase.from('users').select('id').eq('username', username).maybeSingle();
    if (existing) {
      wrap.classList.remove('success'); wrap.classList.add('error');
      err.textContent = 'Username already taken. Try another.'; err.classList.remove('hidden');
      btn.disabled = false; btnText.style.display = 'block'; loader.classList.add('hidden');
      return;
    }
    const user = currentUser || (await supabase.auth.getUser()).data?.user;
    const googleAvatar = user?.user_metadata?.avatar_url || user?.user_metadata?.picture || '';
    await supabase.from('users').upsert({ id: user.id, username, avatar: googleAvatar, bio: '', location: '', cover: '', followers: 0, following: 0 });
    hideUsernamePicker();
    currentUser = user;
    await loadMyProfile();
    showOnboarding();
  } catch(e) {
    err.textContent = e.message || 'Something went wrong. Try again.';
    err.classList.remove('hidden');
    btn.disabled = false; btnText.style.display = 'block'; loader.classList.add('hidden');
  }
}

function showAuthScreen() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app').classList.add('hidden');
  showAuthLanding();
}

function showAuthLanding() {
  document.getElementById('auth-landing').classList.remove('hidden');
  document.getElementById('auth-email-screen').classList.add('hidden');
}

function showEmailAuth(mode = 'login') {
  document.getElementById('auth-landing').classList.add('hidden');
  document.getElementById('auth-email-screen').classList.remove('hidden');
  setAuthTab(mode);
}

function toggleAuthPassword() {
  const pw = document.getElementById('auth-password');
  pw.type = pw.type === 'password' ? 'text' : 'password';
}

async function handleGoogleAuth() {
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    });
    if (error) throw error;
  } catch (e) {
    showToast('Google sign-in failed. Try email instead.');
  }
}

// ══════════════════════════════════════════
// USERNAME PICKER — for Google OAuth new users
// ══════════════════════════════════════════

function showUsernamePicker(user) {
  // Hide auth screen
  document.getElementById('auth-screen').style.display = 'none';
  // Show picker
  const screen = document.getElementById('username-picker-screen');
  screen.classList.remove('hidden');
  // Populate Google avatar if available
  const avatarEl = document.getElementById('up-google-avatar');
  const avatar = user?.user_metadata?.avatar_url || user?.user_metadata?.picture || '';
  if (avatar && avatarEl) {
    avatarEl.src = avatar;
    avatarEl.onerror = () => { avatarEl.style.display = 'none'; };
  } else if (avatarEl) {
    avatarEl.style.display = 'none';
  }
  // Focus input
  setTimeout(() => document.getElementById('up-username-input')?.focus(), 300);
}

function hideUsernamePicker() {
  document.getElementById('username-picker-screen').classList.add('hidden');
}

function validateUsernamePickerInput(input) {
  const val = input.value.replace(/[^a-zA-Z0-9_]/g, '');
  input.value = val;
  const wrap = document.getElementById('up-input-wrap');
  const hint = document.getElementById('up-hint');
  const btn  = document.getElementById('up-btn');
  const err  = document.getElementById('up-error');

  wrap.classList.remove('error', 'success');
  err.classList.add('hidden');

  if (!val) {
    hint.textContent = 'Letters, numbers and underscores only. Max 15 characters.';
    btn.disabled = true;
    return;
  }
  if (val.length < 3) {
    hint.textContent = `${val.length}/15 — minimum 3 characters`;
    btn.disabled = true;
    return;
  }
  hint.textContent = `${val.length}/15`;
  wrap.classList.add('success');
  btn.disabled = false;
}

async function submitUsernamePicker() {
  const input    = document.getElementById('up-username-input');
  const btn      = document.getElementById('up-btn');
  const btnText  = document.getElementById('up-btn-text');
  const loader   = document.getElementById('up-loader');
  const err      = document.getElementById('up-error');
  const wrap     = document.getElementById('up-input-wrap');

  const username = input.value.trim().toLowerCase();
  if (!username || username.length < 3) return;

  // Show loader
  btn.disabled = true;
  btnText.style.display = 'none';
  loader.classList.remove('hidden');
  err.classList.add('hidden');

  try {
    // Check not taken
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('username', username)
      .maybeSingle();

    if (existing) {
      wrap.classList.remove('success');
      wrap.classList.add('error');
      err.textContent = 'Username already taken — try another';
      err.classList.remove('hidden');
      btn.disabled = false;
      btnText.style.display = 'block';
      loader.classList.add('hidden');
      return;
    }

    // Save to users table
    const user = currentUser || (await supabase.auth.getUser()).data?.user;
    const googleAvatar = user?.user_metadata?.avatar_url || user?.user_metadata?.picture || '';
    const googleName   = user?.user_metadata?.full_name || user?.user_metadata?.name || '';

    await supabase.from('users').upsert({
      id:        user.id,
      username:  username,
      avatar:    googleAvatar,
      bio:       '',
      location:  '',
      cover:     '',
      followers: 0,
      following: 0,
    });

    hideUsernamePicker();
    await bootApp();

  } catch (e) {
    err.textContent = e.message || 'Something went wrong. Try again.';
    err.classList.remove('hidden');
    btn.disabled = false;
    btnText.style.display = 'block';
    loader.classList.add('hidden');
  }
}

function setAuthTab(mode) {
  isSignup = mode === 'signup';
  document.getElementById('tab-login').classList.toggle('active', !isSignup);
  document.getElementById('tab-signup').classList.toggle('active', isSignup);
  document.getElementById('auth-btn-text').textContent = isSignup ? 'Create Account' : 'Sign In';
  document.getElementById('username-wrap').style.display = isSignup ? 'flex' : 'none';
  document.getElementById('auth-error').textContent = '';
  // Update header text
  const title = document.getElementById('auth-form-title');
  const sub = document.getElementById('auth-form-sub');
  if (title) title.textContent = isSignup ? 'Create your account' : 'Sign in to MistyNote';
  if (sub) sub.textContent = isSignup ? 'Join thousands of Africans on MistyNote.' : 'Welcome back. Enter your details below.';
}

async function handleAuth() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const errorEl = document.getElementById('auth-error');
  const loader = document.getElementById('auth-loader');
  const btnText = document.getElementById('auth-btn-text');

  if (!email || !password) { errorEl.textContent = 'Please fill in all fields'; return; }

  loader.style.display = 'block'; btnText.style.display = 'none';
  errorEl.textContent = '';

  try {
    if (isSignup) {
      const rawUsername = document.getElementById('auth-username')?.value || '';
      const usernameCheck = validateUsername(rawUsername);
      if (!usernameCheck.valid) { throw new Error(usernameCheck.error); }
      const cleanUsername = usernameCheck.value;

      const { data: existing } = await supabase.from('users').select('id').eq('username', cleanUsername).maybeSingle();
      if (existing) { throw new Error('Username already taken — try another'); }

      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;

      if (data.user) {
        await supabase.from('users').upsert({
          id: data.user.id,
          username: cleanUsername,
          bio: '', location: '', avatar: '', cover: '',
          followers: 0, following: 0
        });

        const { error: loginErr } = await supabase.auth.signInWithPassword({ email, password });
        if (!loginErr) {
          currentUser = data.user;
          await loadMyProfile();
          showOnboarding();
          return;
        }
        errorEl.style.color = '#6C47FF';
        errorEl.textContent = 'Account created! Check your email to verify, then sign in.';
      }
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      currentUser = data.user;
      await bootApp();
    }
  } catch (e) {
    errorEl.textContent = e.message || 'Authentication failed';
  } finally {
    loader.style.display = 'none'; btnText.style.display = 'block';
  }
}

async function handleLogout() {
  showActionSheet([
    { label: 'Sign Out', danger: true, action: async () => {
      await supabase.auth.signOut();

      // Reset ALL state — full clean slate for next login
      currentUser = null; currentProfile = null; viewingProfile = null;
      loadedPostIds.clear(); likedPosts.clear(); repostedPosts.clear();
      savedPosts.clear();
      activeMoments.clear();
      feedOffset = 0; feedLoading = false; feedExhausted = false;
      currentFeedTab = 'for-you';
      unreadCount = 0;

      // Clear feed DOM
      const feedList = document.getElementById('feed-list');
      if (feedList) feedList.innerHTML = '';

      // Reset feed tab UI back to Explore
      document.querySelectorAll('.feed-tab').forEach(t => t.classList.remove('active'));
      const forYouTab = document.getElementById('feed-tab-foryou');
      if (forYouTab) forYouTab.classList.add('active');

      // Clean up realtime channels
      if (notifChannel) { supabase.removeChannel(notifChannel); notifChannel = null; }
      if (postsChannel) { supabase.removeChannel(postsChannel); postsChannel = null; }

      document.getElementById('app').classList.add('hidden');
      showAuthScreen();
    }}
  ]);
}

