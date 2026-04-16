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
  const btn  = document.getElementById('nav-compose-btn');
  const fill = document.getElementById('compose-ring-fill');
  const inner = document.getElementById('compose-btn-inner');
  if (!btn || !fill || !inner) return;

  // Remove all state classes
  btn.classList.remove('uploading', 'upload-success', 'upload-failed');

  if (status === 'idle') {
    fill.style.strokeDashoffset = RING_CIRCUMFERENCE;
    inner.innerHTML = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="white" fill-opacity="0.15"/><path d="M12 5v14M5 12h14" stroke="white" stroke-width="2.5" stroke-linecap="round"/></svg>`;
    btn.style.animation = '';
  } else if (status === 'uploading') {
    btn.classList.add('uploading');
    const offset = RING_CIRCUMFERENCE - (progress / 100) * RING_CIRCUMFERENCE;
    fill.style.strokeDashoffset = offset;
    inner.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  } else if (status === 'success') {
    btn.classList.add('upload-success');
    fill.style.strokeDashoffset = 0;
    inner.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    // Auto-reset after 2 seconds
    setTimeout(() => setComposeRing('idle'), 2000);
  } else if (status === 'failed') {
    btn.classList.add('upload-failed');
    inner.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 9v4M12 17h.01" stroke="white" stroke-width="2.5" stroke-linecap="round"/><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  uploadState.status = status;
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

function getRoute() {
  const path = window.location.pathname;
  if (path === '/' || path === '') return { type: 'home' };
  const postMatch = path.match(/^\/post\/([^/]+)$/);
  if (postMatch) return { type: 'post', id: postMatch[1] };
  const profileMatch = path.match(/^\/profile\/([^/]+)$/);
  if (profileMatch) return { type: 'profile', username: profileMatch[1] };
  return { type: 'home' };
}

function pushRoute(path) {
  if (window.location.pathname !== path) {
    window.history.pushState({}, '', path);
  }
}

function replaceRoute(path) {
  window.history.replaceState({}, '', path);
}

async function handleRoute(route) {
  if (!route) route = getRoute();
  if (route.type === 'post') {
    await openDetail(route.id);
  } else if (route.type === 'profile') {
    // Look up user by username then open profile
    const { data: user } = await supabase.from('users').select('id').eq('username', route.username).maybeSingle();
    if (user) await showUserProfile(user.id, null);
  }
}

window.addEventListener('popstate', () => {
  const route = getRoute();
  if (route.type === 'home') {
    // Close any open slide pages
    if (slideStack.length > 0) {
      slideBack();
    }
  } else {
    handleRoute(route);
  }
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
  const route = getRoute();
  const isDeepLink = route.type !== 'home';

  // On deep links — show splash immediately, hide auth form so it never flashes
  if (isDeepLink) {
    showDeepLinkSplash();
  }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      hideDeepLinkSplash();
      showAuthScreen();
      return;
    }
    currentUser = session.user;

    // Check if this user has a username — Google sign-ups won't have one yet
    const { data: profile } = await supabase
      .from('users').select('username').eq('id', currentUser.id).maybeSingle();

    if (!profile?.username) {
      hideDeepLinkSplash();
      showUsernamePicker(currentUser);
      return;
    }

    await bootApp(isDeepLink);
  } catch (e) {
    console.error('Init error:', e);
    hideDeepLinkSplash();
    showAuthScreen();
  }
}

function showDeepLinkSplash() {
  // Hide auth screen completely
  const auth = document.getElementById('auth-screen');
  if (auth) auth.style.display = 'none';

  // Create and show a minimal branded splash
  if (document.getElementById('deep-link-splash')) return;
  const splash = document.createElement('div');
  splash.id = 'deep-link-splash';
  splash.innerHTML = `
    <div style="
      position:fixed;inset:0;
      background:var(--bg, #fff);
      display:flex;flex-direction:column;
      align-items:center;justify-content:center;
      z-index:9999;gap:16px;
    ">
      <svg width="52" height="52" viewBox="0 0 48 48" fill="none">
        <path d="M8 24C8 24 12 8 24 8C36 8 40 24 40 24" stroke="#6C47FF" stroke-width="3" stroke-linecap="round"/>
        <path d="M8 24C8 24 16 18 24 24C32 30 40 24 40 24" stroke="#6C47FF" stroke-width="3" stroke-linecap="round"/>
        <path d="M8 24C8 24 12 40 24 40C36 40 40 24 40 24" stroke="#6C47FF" stroke-width="3" stroke-linecap="round"/>
      </svg>
      <div style="font-family:'Roboto',sans-serif;font-weight:700;font-size:22px;color:var(--text,#111);">MistyNote</div>
      <div style="width:32px;height:3px;background:#6C47FF;border-radius:2px;animation:splashBar 1.2s ease-in-out infinite alternate;"></div>
    </div>
    <style>
      @keyframes splashBar {
        from { width: 24px; opacity: 0.5; }
        to   { width: 48px; opacity: 1; }
      }
    </style>
  `;
  document.body.appendChild(splash);
}

function hideDeepLinkSplash() {
  const splash = document.getElementById('deep-link-splash');
  if (splash) {
    splash.style.transition = 'opacity 0.25s';
    splash.style.opacity = '0';
    setTimeout(() => splash.remove(), 260);
  }
}

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
  // Hide all fixed headers that float outside .page elements
  document.getElementById('comment-bar').style.display = 'none';
  document.getElementById('my-profile-header').style.display = 'none';
  document.getElementById('user-profile-header').style.display = 'none';
  document.getElementById('bottom-nav').style.display = 'flex';

  // Switch pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-market')?.classList.add('active');

  // Update nav active state
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

async function bootApp(isDeepLink = false) {
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

  // On deep links — keep feed hidden until content is ready, preventing feed flash
  const appEl = document.getElementById('app');
  const feedEl = document.getElementById('page-feed');
  if (isDeepLink && feedEl) feedEl.style.visibility = 'hidden';
  appEl.classList.remove('hidden');

  injectFeedPostStyles();
  injectEchoesPanel();

  // Apply dark mode early to avoid flash
  if (localStorage.getItem('darkMode') === 'true') {
    document.documentElement.setAttribute('data-theme', 'dark');
    const toggle = document.getElementById('dark-mode-toggle');
    if (toggle) toggle.checked = true;
  }

  await loadMyProfile();
  updateNavAvatar();
  initComposerFile();
  setTimeout(() => detectAndSaveLocation(), 2000);
  sortMomentsRow();
  initIntersectionObserver();
  requestAnimationFrame(initFeedTabBar);
  initCommentBarInput();
  subscribeToNotifs();
  subscribeToPostUpdates();

  if (isDeepLink) {
    // Deep link — go straight to content, load feed silently in background
    const route = getRoute();
    hideDeepLinkSplash();
    await handleRoute(route);
    // Restore feed visibility and load in background
    if (feedEl) feedEl.style.visibility = '';
    setTimeout(() => {
      // Only load feed if not already loading from bootApp
      if (!feedLoading && loadedPostIds.size === 0) loadFeed();
      loadNotifications();
      loadInitialNotifCount();
    }, 600);
  } else {
    // Normal load — show feed immediately
    loadFeed();
    loadNotifications();
    loadInitialNotifCount();
  }
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

  // Inject feed styles that bootApp normally handles
  injectFeedPostStyles();
  injectEchoesPanel();
  initIntersectionObserver();
  sortMomentsRow();
  requestAnimationFrame(initFeedTabBar);
  initComposerFile();
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

// ══════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════

function navTo(pageId) {
  if (pageId === 'market') { showMarket(); return; }
  // Stop market countdown when leaving market
  if (_mktCountdownInterval) { clearInterval(_mktCountdownInterval); _mktCountdownInterval = null; }
  // If any slide panels are open, close them all cleanly before navigating
  if (slideStack.length > 0) {
    slideStack.forEach(id => {
      document.getElementById('page-' + id)?.classList.remove('active');
    });
    slideStack.length = 0;
    // Clean up all floating headers and comment bar
    document.getElementById('comment-bar').style.display = 'none';
    const floatingHeader = document.getElementById('user-profile-header');
    if (floatingHeader) floatingHeader.style.display = 'none';
    const miniIdentity = document.getElementById('uprf-header-identity');
    const miniFollow   = document.getElementById('uprf-header-follow');
    if (miniIdentity) { miniIdentity.style.opacity='0'; miniIdentity.style.pointerEvents='none'; }
    if (miniFollow)   { miniFollow.style.opacity='0'; miniFollow.style.display='none'; }
    document.getElementById('page-user-profile')?._uprfAvatarObs?.disconnect();
    document.getElementById('page-profile')?._myprfAvatarObs?.disconnect();
    const myHdr = document.getElementById('my-profile-header');
    if (myHdr) myHdr.style.display = 'none';
  }

  const pages = ['feed','discover','notifications','profile','market'];
  pages.forEach(id => {
    const el = document.getElementById('page-' + id);
    if (el) el.classList.toggle('active', id === pageId);
    document.querySelectorAll('.nav-btn[data-page]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.page === pageId);
    });
  });

  if (pageId === 'notifications') {
    onNotifPageOpen();
  }
  if (pageId === 'profile') {
    renderMyProfile();
    const myHdr = document.getElementById('my-profile-header');
    if (myHdr) myHdr.style.display = 'flex';
    // Re-evaluate header colour based on current scroll position
    const myPage = document.getElementById('page-profile');
    if (myPage?._myprfScroll) myPage._myprfScroll();
    else if (myHdr) myHdr.style.background = 'rgba(0,0,0,0)';
  } else {
    const myHdr = document.getElementById('my-profile-header');
    if (myHdr) { myHdr.style.display = 'none'; }
    const myPage = document.getElementById('page-profile');
    if (myPage?._myprfAvatarObs) myPage._myprfAvatarObs.disconnect();
  }
  if (pageId === 'discover') {
    loadDiscover();
  }
  if (pageId === 'feed') {
    const feedList = document.getElementById('feed-list');
    const hasPosts = feedList && feedList.querySelector('.poster');
    if (!hasPosts && !feedLoading) loadFeed();
  }
}

function animateCount(el, newVal) {
  if (!el) return;
  const current = parseInt(el.textContent.replace(/[^0-9]/g,'')) || 0;
  // Stat table elements always show 0; feed hearts hide when 0
  const isStatEl = el.closest('.dp-stat, .detail-stats');
  el.textContent = (newVal > 0 || isStatEl) ? fmtNum(newVal) : '';

  if (newVal === current) return;

  const scale = newVal > current ? 1.35 : 0.75;
  el.style.transition = 'none';
  el.style.transform = `scale(${scale})`;
  void el.offsetWidth;
  el.style.transition = 'transform 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
  el.style.transform = 'scale(1)';
}

function slideTo(pageId, setupFn) {
  slideStack.push(pageId);
  const el = document.getElementById('page-' + pageId);
  if (!el) return;

  // Block all post taps during slide — prevents ghost clicks
  document.querySelectorAll('[data-post-id]').forEach(post => {
    post.dataset.blockNavigation = 'true';
    setTimeout(() => { post.dataset.blockNavigation = 'false'; }, 600);
  });

  // Block ALL post taps during slide — prevents ghost clicks from landing on profile posts
  document.querySelectorAll('[data-post-id]').forEach(post => {
    post.dataset.blockNavigation = 'true';
    setTimeout(() => { post.dataset.blockNavigation = 'false'; }, 600);
  });

  // Track which main page we're leaving
  const mainPages = ['feed','discover','notifications','profile'];
  mainPages.forEach(id => {
    if (document.getElementById('page-' + id)?.classList.contains('active')) {
      lastMainPage = id;
    }
  });

  // Dim bottom nav pages
  ['feed','discover','notifications','profile'].forEach(id => {
    document.getElementById('page-' + id)?.classList.remove('active');
  });

  // Deactivate any currently active slide page so they don't stack visually
  const slidePages = ['detail','user-profile','settings','wallet','storefront','messages','chat','legal-terms','legal-privacy'];
  slidePages.forEach(id => {
    if (id !== pageId) document.getElementById('page-' + id)?.classList.remove('active');
  });

  // Hide bottom nav for slide pages that need full screen
  if (['messages','chat'].includes(pageId)) {
    document.getElementById('bottom-nav').style.display = 'none';
  }

  // If leaving detail, hide comment bar and restore bottom nav
  if (slideStack[slideStack.length - 2] === 'detail' || document.getElementById('comment-bar')?.style.display === 'flex') {
    if (pageId !== 'detail') {
      document.getElementById('comment-bar').style.display = 'none';
      document.getElementById('bottom-nav').style.display = '';
    }
  }

  if (setupFn) setupFn();

  // Show floating header only for user-profile
  const floatingHeader = document.getElementById('user-profile-header');
  if (floatingHeader) floatingHeader.style.display = pageId === 'user-profile' ? 'flex' : 'none';
  // Reset uprf mini identity immediately — prevent stale content showing during load
  if (pageId === 'user-profile') {
    const _uprfIdentity = document.getElementById('uprf-header-identity');
    const _uprfFollow   = document.getElementById('uprf-header-follow');
    if (_uprfIdentity) { _uprfIdentity.style.opacity = '0'; _uprfIdentity.style.pointerEvents = 'none'; }
    if (_uprfFollow)   { _uprfFollow.style.opacity = '0'; _uprfFollow.style.display = 'none'; }
  }

  // Always hide my-profile floating header when navigating away
  const myHeader = document.getElementById('my-profile-header');
  if (myHeader) myHeader.style.display = 'none';

  requestAnimationFrame(() => {
    el.classList.add('active');
    el.scrollTop = 0;
    if (floatingHeader) floatingHeader.style.background = 'rgba(0,0,0,0)';
  });
}

function slideBack() {
  const pageId = slideStack.pop();
  if (pageId) {
    const el = document.getElementById('page-' + pageId);
    el?.classList.remove('active');
  }

  const returningTo = slideStack.length > 0 ? slideStack[slideStack.length - 1] : null;

  // If still inside a slide page, re-activate it and stop
  if (returningTo) {
    document.getElementById('page-' + returningTo)?.classList.add('active');
  }

  // Hide comment bar only when leaving detail
  if (pageId === 'detail') {
    document.getElementById('comment-bar').style.display = 'none';
  }

  // Clean up wallet when navigating away
  if (pageId === 'wallet') {
    onWalletClose();
  }

  // If returning to detail, re-show comment bar and hide bottom nav
  if (returningTo === 'detail') {
    document.getElementById('comment-bar').style.display = 'flex';
    document.getElementById('bottom-nav').style.display = 'none';
    // Ensure user-profile floating header is hidden when returning to detail
    const fh = document.getElementById('user-profile-header');
    if (fh) fh.style.display = 'none';
    return;
  }

  // Restore URL when sliding back
  if (returningTo === 'detail' && detailPostId) {
    pushRoute('/post/' + detailPostId);
  } else if (!returningTo) {
    replaceRoute('/');
  }

  // Restore bottom nav only when back to a main page
  if (!returningTo) {
    document.getElementById('bottom-nav').style.display = '';
  }

  // Floating user-profile header
  const floatingHeader = document.getElementById('user-profile-header');
  if (floatingHeader) floatingHeader.style.display = returningTo === 'user-profile' ? 'flex' : 'none';
  if (returningTo === 'user-profile') {
    const upPage = document.getElementById('page-user-profile');
    if (upPage?._uprfScroll) upPage._uprfScroll();
  }
  // Reset mini elements only when fully leaving user-profile
  if (returningTo !== 'user-profile') {
    const miniIdentity = document.getElementById('uprf-header-identity');
    const miniFollow   = document.getElementById('uprf-header-follow');
    if (miniIdentity) { miniIdentity.style.opacity='0'; miniIdentity.style.pointerEvents='none'; }
    if (miniFollow)   { miniFollow.style.opacity='0'; miniFollow.style.display='none'; }
    if (document.getElementById('page-user-profile')?._uprfAvatarObs) {
      document.getElementById('page-user-profile')._uprfAvatarObs.disconnect();
    }
  }

  // Restore last main page when fully back
  const lastMain = returningTo || lastMainPage;
  const mainPages = ['feed','discover','notifications','profile'];
  if (mainPages.includes(lastMain)) {
    document.getElementById('page-' + lastMain)?.classList.add('active');
    if (lastMain === 'profile') {
      const myHeader = document.getElementById('my-profile-header');
      if (myHeader) myHeader.style.display = 'flex';
      const myPage = document.getElementById('page-profile');
      if (myPage?._myprfScroll) myPage._myprfScroll();
    }
  } else if (slideStack.length > 0) {
    document.getElementById('page-' + lastMain)?.classList.add('active');
  } else {
    document.getElementById('page-' + lastMainPage)?.classList.add('active');
    if (lastMainPage === 'profile') {
      const myHeader = document.getElementById('my-profile-header');
      if (myHeader) myHeader.style.display = 'flex';
      const myPage = document.getElementById('page-profile');
      if (myPage?._myprfScroll) myPage._myprfScroll();
    }
  }
}

// ══════════════════════════════════════════
// PROFILE
// ══════════════════════════════════════════

async function loadMyProfile() {
  if (!currentUser) return;
  const { data } = await supabase.from('users').select('*').eq('id', currentUser.id).maybeSingle();
  if (data) {
    currentProfile = data;
  } else {
    // Auto-create
    const fallback = {
      id: currentUser.id,
      username: '@user_' + currentUser.id.slice(0,6),
      bio: '', location: '', avatar: '', cover: '', followers: 0, following: 0
    };
    await supabase.from('users').insert(fallback);
    currentProfile = fallback;
  }
}

function updateNavAvatar() {
  if (!currentProfile) return;
  const navAvatar = document.getElementById('nav-avatar');
  const navIcon = document.getElementById('nav-avatar-icon');
  if (currentProfile.avatar) {
    navAvatar.src = currentProfile.avatar;
    navAvatar.style.display = 'block';
    navIcon.style.display = 'none';
  }
  const composerAv = document.getElementById('composer-avatar');
  if (composerAv && currentProfile.avatar) composerAv.src = currentProfile.avatar;
  const commentBarAv = document.getElementById('comment-bar-avatar');
  if (commentBarAv && currentProfile.avatar) commentBarAv.src = currentProfile.avatar;
}

// ══════════════════════════════════════════
// PROFILE STYLES — injected once
// ══════════════════════════════════════════
// ══════════════════════════════════════════
// PROFILE — Original MistyNote DNA, elevated
// ══════════════════════════════════════════

function injectProfileStyles() {
  if (document.getElementById('prf-styles')) return;
  const s = document.createElement('style');
  s.id = 'prf-styles';
  s.textContent = `
    .prf-wrap { display:flex; flex-direction:column; padding-bottom:120px; }

    /* ── COVER ── */
    .prf-cover { position:relative; width:100%; height:190px; overflow:hidden; flex-shrink:0; }
    .prf-cover-img { width:100%; height:100%; object-fit:cover; display:block; }
    .prf-cover-gradient { width:100%; height:100%; background:linear-gradient(135deg,#6C47FF 0%,#a855f7 50%,#ff3b5c 100%); }

    /* ── TOP BAR OVER COVER ── */
    .prf-cover-bar {
      position:absolute; top:0; left:0; right:0;
      display:flex; align-items:center; justify-content:space-between;
      padding:12px 16px; z-index:4;
    }
    .prf-back-btn {
      width:34px; height:34px; border-radius:50%;
      background:rgba(0,0,0,0.35); backdrop-filter:blur(10px);
      display:flex; align-items:center; justify-content:center;
      cursor:pointer; border:none; transition:background .15s;
    }
    .prf-back-btn:active { background:rgba(0,0,0,.55); }
    .prf-cover-actions { display:flex; gap:8px; }
    .prf-cover-action-btn {
      width:34px; height:34px; border-radius:50%;
      background:rgba(0,0,0,0.35); backdrop-filter:blur(10px);
      display:flex; align-items:center; justify-content:center;
      cursor:pointer; border:none; transition:background .15s;
    }
    .prf-cover-action-btn:active { background:rgba(0,0,0,.55); }

    /* ── AVATAR ROW — sits between cover and identity ── */
    .prf-avatar-row {
      display:flex; justify-content:space-between; align-items:flex-end;
      padding:10px 16px 0; margin-top:-44px; position:relative; z-index:10;
    }
    .prf-avatar-wrap {
      width:88px; height:88px; border-radius:50%;
      position:relative; flex-shrink:0;
    }
    .prf-avatar-wrap:active { transform:scale(.97); }
    .prf-avatar {
      width:100%; height:100%; border-radius:50%;
      object-fit:cover; object-position:top; display:block;
      border:4px solid var(--bg,#fff);
      position:relative; z-index:2;
    }
    .prf-avatar-ring {
      position:absolute; inset:-3px; border-radius:50%;
      background:conic-gradient(#6C47FF,#ff3b5c,#ff9500,#6C47FF);
      z-index:1; animation:prfRingSpin 6s linear infinite;
    }
    @keyframes prfRingSpin { to { transform:rotate(360deg); } }
    .prf-avatar-action-btns {
      display:flex; gap:8px; align-items:center; padding-bottom:8px;
    }

    /* ── IDENTITY ── */
    .prf-identity { padding:12px 16px 0; position:relative; z-index:2; }
    .prf-name { font-size:21px; font-weight:700; color:var(--text); margin:0; line-height:1.2; }
    .prf-name-row { display:flex; align-items:center; gap:7px; flex-wrap:wrap; }
    .prf-verified svg { display:block; }
    .prf-handle { font-size:14px; color:var(--text2); margin-top:3px; }

    /* ── LOCATION + QR ── */
    .prf-location-row { display:flex; align-items:center; justify-content:space-between; margin-top:10px; }
    .prf-location { display:flex; align-items:center; gap:5px; font-size:14px; color:var(--text2); }
    .prf-qr-chip {
      display:flex; align-items:center; gap:5px;
      background:var(--bg2,#f3f4f6); border:1px solid var(--border,#e5e7eb);
      padding:4px 10px; border-radius:8px;
      font-size:12px; font-weight:600; color:var(--text2);
      cursor:pointer; transition:background .15s;
    }
    .prf-qr-chip:active { background:var(--border); }

    /* ── FOLLOWING · FOLLOWERS inline ── */
    .prf-follow-line { margin-top:10px; font-size:15px; color:var(--text2); }
    .prf-bld { color:var(--text); font-weight:700; cursor:pointer; margin-right:2px; }
    .prf-bld:hover { text-decoration:none; }
    .prf-follow-sep { margin:0 5px; }

    /* ── BIO ── */
    .prf-bio { margin-top:10px; font-size:15px; color:var(--text); line-height:1.55; white-space:pre-wrap; word-break:break-word; }
    .prf-location { margin-top:6px; font-size:13px; color:var(--text3); display:flex; align-items:center; gap:3px; }
    .prf-location-denied { margin-top:8px; font-size:12px; color:var(--red,#ff3b5c); background:rgba(255,59,92,0.08); padding:8px 12px; border-radius:8px; line-height:1.4; }

    /* ── STATS BAR ── */
    .prf-stats-row {
      display:flex; margin:16px 12px 0;
      background:var(--bg2,#f9fafb);
      border-radius:16px; overflow:hidden;
      border:1px solid var(--border,#e5e7eb);
    }
    .prf-stat-card {
      flex:1; display:flex; flex-direction:column;
      align-items:center; padding:12px 4px; gap:3px;
      position:relative; transition:background .15s;
    }
    .prf-stat-card + .prf-stat-card::before {
      content:''; position:absolute; left:0; top:20%;
      height:60%; width:1px; background:var(--border,#e5e7eb);
    }
    .prf-stat-card.clickable { cursor:pointer; }
    .prf-stat-card.clickable:active { background:rgba(108,71,255,.06); }
    .prf-stat-n { font-size:17px; font-weight:700; color:var(--text); line-height:1; }
    .prf-stat-l { font-size:10px; color:var(--text2); text-transform:uppercase; letter-spacing:.04em; }

    /* ── BUTTONS ── */
    .prf-btn-row { display:flex; gap:10px; margin-top:16px; flex-wrap:wrap; }
    .prf-btn { height:36px; padding:0 18px; border-radius:20px; font-size:14px; font-weight:600; cursor:pointer; border:none; transition:all .18s; display:flex; align-items:center; gap:6px; font-family:inherit; }
    .prf-btn-primary { background:#6C47FF; color:#fff; border:1.5px solid #6C47FF; }
    .prf-btn-primary:active { transform:scale(.96); opacity:.9; }
    .prf-btn-dark { background:var(--text); color:var(--bg); }
    .prf-btn-dark:active { transform:scale(.96); opacity:.85; }
    .prf-btn-outline { background:transparent; color:var(--text); border:1.5px solid var(--border,#e5e7eb); }
    .prf-btn-outline:active { transform:scale(.96); }
    .prf-btn-following { background:transparent; color:#6C47FF; border:1.5px solid #6C47FF; border-radius:20px; }
    .prf-btn-icon { width:36px; height:36px; padding:0; border-radius:50%; justify-content:center; background:var(--bg2); border:1.5px solid var(--border,#e5e7eb); color:var(--text); }
    .prf-btn-icon:active { transform:scale(.94); }

    /* ── OTHER USER PROFILE FLOATING HEADER ── */
    #user-profile-header {
      position:fixed; top:0; left:0; right:0;
      background:rgba(0,0,0,0);
      border:none !important;
      box-shadow:none !important;
      transition:background .25s ease;
      z-index:200;
    }
    #user-profile-header .back-btn {
      background:transparent !important;
      border:none !important;
      box-shadow:none !important;
    }
    #user-profile-header .header-action {
      background:transparent !important;
      border:none !important;
      box-shadow:none !important;
    }
    #user-profile-header .back-btn path,
    #user-profile-header .back-btn polyline {
      stroke:#fff !important;
    }
    #user-profile-header .header-action circle {
      fill:#fff !important;
    }


    .prf-storefront-banner { margin:18px 16px 18px; background:linear-gradient(135deg,#f4f3ff,#fdf2ff); border:1.5px solid #ddd6fe; border-radius:16px; padding:14px 16px; display:flex; align-items:center; gap:12px; cursor:pointer; transition:all .18s; }
    .prf-storefront-banner:active { transform:scale(.98); }
    .prf-storefront-icon { font-size:28px; flex-shrink:0; }
    .prf-storefront-text { flex:1; }
    .prf-storefront-title { font-size:15px; font-weight:700; color:#6C47FF; }
    .prf-storefront-sub { font-size:12px; color:#9b87f5; margin-top:2px; }
    .prf-storefront-pill { font-size:11px; font-weight:700; color:#fff; background:#6C47FF; border-radius:20px; padding:3px 10px; white-space:nowrap; flex-shrink:0; }

    /* ── ICON TAB BAR (original ewe/yeb DNA, elevated) ── */
    .prf-icon-tabs {
      display:flex; width:100%; margin-top:0;
      border-top:1px solid var(--border,#e5e7eb);
      border-bottom:1px solid var(--border,#e5e7eb);
      background:var(--bg);
      position:sticky; top:56px; z-index:10;
      backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);
    }
    .prf-icon-tab {
      flex:1; display:flex; align-items:center; justify-content:center;
      height:56px; cursor:pointer; transition:all .18s;
      border-bottom:3px solid transparent; color:var(--text2); position:relative;
    }
    .prf-icon-tab.active { border-bottom-color:#6C47FF; color:#6C47FF; }
    .prf-icon-tab:active { background:var(--bg2); }
    .prf-icon-tab svg { width:22px; height:22px; }
    .prf-icon-tab-dot { position:absolute; top:10px; right:calc(50% - 14px); width:6px; height:6px; border-radius:50%; background:#6C47FF; opacity:0; transition:opacity .2s; }
    .prf-icon-tab.active .prf-icon-tab-dot { opacity:1; }

    /* ── PANELS ── */
    .prf-panel { min-height:160px; }
    #prf-panel-masonry-list, #prf-panel-likes, .prf-posts-panel { display:flex; flex-direction:column; gap:10px; padding:10px 0; }

    /* ── TWO-COLUMN MASONRY (original left/right column split) ── */
    .prf-masonry { display:flex; gap:8px; padding:8px; align-items:flex-start; width:100%; box-sizing:border-box; }
    .prf-masonry-col { flex:1; display:flex; flex-direction:column; gap:8px; }
    .prf-masonry-tile { border-radius:12px; overflow:hidden; cursor:pointer; background:var(--surface); transition:transform .18s; box-shadow:0 1px 4px rgba(0,0,0,.08); }
    .prf-masonry-tile:active { transform:scale(.97); }
    .prf-masonry-img { width:100%; display:block; object-fit:cover; }
    .prf-masonry-text-tile { width:100%; min-height:120px; display:flex; align-items:center; justify-content:center; padding:16px 12px; }
    .prf-masonry-text-tile p { font-size:13px; color:#fff; line-height:1.45; text-align:center; font-weight:600; margin:0; }
    .prf-masonry-caption { font-size:16px; color:var(--text); line-height:1.4; padding:8px 10px 4px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
    .prf-masonry-footer { display:flex; align-items:center; justify-content:space-between; padding:6px 10px 10px; gap:6px; }
    .prf-masonry-author { display:flex; align-items:center; gap:5px; min-width:0; flex:1; }
    .prf-masonry-avatar { width:20px; height:20px; border-radius:50%; object-fit:cover; flex-shrink:0; }
    .prf-masonry-username { font-size:11px; color:var(--text2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .prf-masonry-like { display:flex; align-items:center; gap:3px; background:none; border:none; cursor:pointer; flex-shrink:0; padding:2px 0; color:#000000; -webkit-tap-highlight-color:transparent; }
    .prf-masonry-like.liked { color:rgb(244,7,82); }
    .prf-masonry-like-count { font-size:11px; font-weight:400; color:inherit; }
    .prf-masonry-like.liked .prf-masonry-like-count { font-weight:600; }

    /* ── PLACEHOLDERS ── */
    .prf-placeholder { margin:20px 16px; border-radius:18px; padding:24px 20px; display:flex; flex-direction:column; align-items:center; gap:10px; text-align:center; }
    .prf-placeholder-icon { font-size:36px; }
    .prf-placeholder h3 { font-size:16px; font-weight:700; margin:0; }
    .prf-placeholder p { font-size:13px; margin:0; line-height:1.5; }

    /* ── EMPTY ── */
    .prf-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:56px 24px; gap:10px; text-align:center; }
    .prf-empty-icon { font-size:40px; opacity:.35; }
    .prf-empty p { font-size:16px; font-weight:600; color:var(--text); margin:0; }
    .prf-empty span { font-size:14px; color:var(--text2); }
  `;
  document.head.appendChild(s);
}

// ══════════════════════════════════════════
// MY PROFILE
// ══════════════════════════════════════════
async function renderMyProfile() {
  const container = document.getElementById('my-profile-content');
  if (!container) return;

  injectProfileStyles();
  await loadMyProfile();
  const profile = currentProfile;
  if (!profile) return;

  const [postsRes, likedRes, savedRes] = await Promise.all([
    supabase.from('posts')
      .select(`id,content,image,video,created_at,like_count,repost_count,views,user_id,reposted_post_id,
               user:users(id,username,avatar,location),
               reposted_post:reposted_post_id(id,content,image,video,created_at,user_id,user:users(id,username,avatar,location))`)
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false })
      .limit(60),
    supabase.from('likes')
      .select(`post:posts(id,content,image,video,created_at,like_count,repost_count,views,user_id,
               user:users(id,username,avatar))`)
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false })
      .limit(60),
    supabase.from('saved_posts')
      .select(`post:posts(id,content,image,video,created_at,like_count,repost_count,views,user_id,reposted_post_id,
               user:users(id,username,avatar),
               reposted_post:reposted_post_id(id,content,image,video,created_at,user_id,user:users(id,username,avatar)))`)
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false })
      .limit(60)
  ]);

  const posts         = postsRes.data || [];
  const likedPostsArr = (likedRes.data || []).map(r => r.post).filter(Boolean);
  const savedPostsArr = (savedRes.data || []).map(r => r.post).filter(Boolean);
  const mediaPosts    = posts.filter(p => (p.image || p.video) && !p.reposted_post_id);
  const totalViews    = posts.reduce((s, p) => s + (p.views || 0), 0);
  const totalLikes    = posts.reduce((s, p) => s + (p.like_count || 0), 0);

  likedPostsArr.forEach(p => { if (p?.id) likedPosts.add(p.id); });

  container.innerHTML = `
    <div class="prf-wrap">

      <!-- COVER -->
      <div class="prf-cover" onclick="viewProfilePhoto('${escHtml(profile.cover||'')}','cover','${escHtml(profile.username||'')}')" style="cursor:${profile.cover ? 'pointer' : 'default'}">
        ${profile.cover
          ? `<img src="${escHtml(profile.cover)}" alt="" class="prf-cover-img">`
          : `<div class="prf-cover-gradient"></div>`}
        <div class="prf-cover-bar">
          <div></div>
          <div class="prf-cover-actions"></div>
        </div>
      </div>

      <!-- AVATAR ROW -->
      <div class="prf-avatar-row">
        <div class="prf-avatar-wrap" title="View profile photo" onclick="viewProfilePhoto('${escHtml(profile.avatar||`https://api.dicebear.com/7.x/adventurer/svg?seed=${escHtml(profile.id)}`)}','avatar','${escHtml(profile.username||'')}')" style="cursor:pointer">
          <div class="prf-avatar-ring"></div>
          <img class="prf-avatar" src="${escHtml(profile.avatar || `https://api.dicebear.com/7.x/adventurer/svg?seed=${escHtml(profile.id)}`)}" onerror="this.src='https://api.dicebear.com/7.x/adventurer/svg?seed=${escHtml(profile.id)}'" alt="">
        </div>
        <div class="prf-avatar-action-btns">
          <button class="prf-btn prf-btn-icon" onclick="showSettings()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
          </button>
          <button class="prf-btn prf-btn-primary" onclick="openEditProfile()">Edit Profile</button>
        </div>
      </div>

      <!-- IDENTITY -->
      <div class="prf-identity">
        <div class="prf-name-row">
          <h1 class="prf-name">${escHtml(profile.username || 'User')}</h1>
          ${profile.is_verified ? `<span class="prf-verified"><svg width="18" height="18" viewBox="0 0 24 24" fill="#6C47FF"><path d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"/></svg></span>` : ''}
        </div>
        ${profile.bio ? `<p class="prf-bio">${escHtml(profile.bio)}</p>` : ''}
        ${profile.location ? `<p class="prf-location"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" style="vertical-align:-1px;margin-right:3px"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="currentColor"/></svg>${escHtml(profile.location)}</p>` : ''}
        ${profile.location_denied && isOwn ? `<p class="prf-location-denied">⚠ Location denied — enable in browser settings to unlock commerce features</p>` : ''}
      </div>

      <!-- STATS BAR -->
      <div class="prf-stats-row">
        <div class="prf-stat-card">
          <span class="prf-stat-n">${fmtNum(posts.length)}</span>
          <span class="prf-stat-l">Posts</span>
        </div>
        <div class="prf-stat-card clickable" onclick="openFollowList('followers', currentUser.id)">
          <span class="prf-stat-n" id="prf-followers-count">${fmtNum(profile.followers||0)}</span>
          <span class="prf-stat-l">Followers</span>
        </div>
        <div class="prf-stat-card clickable" onclick="openFollowList('following', currentUser.id)">
          <span class="prf-stat-n" id="prf-following-count">${fmtNum(profile.following||0)}</span>
          <span class="prf-stat-l">Following</span>
        </div>
        <div class="prf-stat-card">
          <span class="prf-stat-n">${fmtNum(totalViews)}</span>
          <span class="prf-stat-l">Views</span>
        </div>
        <div class="prf-stat-card">
          <span class="prf-stat-n">${fmtNum(totalLikes)}</span>
          <span class="prf-stat-l">Likes</span>
        </div>
      </div>

      <!-- STOREFRONT -->
      <div class="prf-storefront-banner" onclick="showToast('Storefronts coming soon 🛍️')">
        <div class="prf-storefront-icon">🛍️</div>
        <div class="prf-storefront-text">
          <div class="prf-storefront-title">Open your storefront</div>
          <div class="prf-storefront-sub">Sell anything. Get paid safely.</div>
        </div>
        <span class="prf-storefront-pill">Soon</span>
      </div>

      <!-- PEOPLE TO FOLLOW BOX -->
      <div class="prf-suggest-box" id="prf-suggest-own" style="display:none">
        <div class="prf-suggest-header">
          <span class="prf-suggest-title">People you might vibe with</span>
          <button class="prf-suggest-close" onclick="dismissSuggestBox('prf-suggest-own')" aria-label="Dismiss">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="prf-suggest-scroll" id="prf-suggest-own-list"></div>
      </div>

      <!-- ICON TAB BAR -->
      <div class="prf-icon-tabs" id="prf-tabs">
        <div class="prf-icon-tab active" data-tab="list" onclick="switchPrfTab('list',this)">
          <div class="prf-icon-tab-dot"></div>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
        </div>
        <div class="prf-icon-tab" data-tab="media" onclick="switchPrfTab('media',this)">
          <div class="prf-icon-tab-dot"></div>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        </div>
        <div class="prf-icon-tab" data-tab="likes" onclick="switchPrfTab('likes',this)">
          <div class="prf-icon-tab-dot"></div>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
        </div>
        <div class="prf-icon-tab" data-tab="saved" onclick="switchPrfTab('saved',this)">
          <div class="prf-icon-tab-dot"></div>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>
        </div>
      </div>

      <div id="prf-panel-list"   class="prf-panel prf-posts-panel"></div>
      <div id="prf-panel-media"  class="prf-panel" style="display:none"></div>
      <div id="prf-panel-likes"  class="prf-panel prf-posts-panel" style="display:none"></div>
      <div id="prf-panel-saved"  class="prf-panel prf-posts-panel" style="display:none"></div>
    </div>

    <div class="wing-fab" onclick="openComposer()">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="white" stroke-width="2.5" stroke-linecap="round"/></svg>
    </div>
  `;

  if (!document.getElementById('fab-style')) {
    const fs = document.createElement('style');
    fs.id = 'fab-style';
    fs.textContent = `.wing-fab{position:fixed;bottom:calc(var(--nav-h,60px) + 20px + var(--safe-bottom,0px));right:20px;width:52px;height:52px;border-radius:16px;background:linear-gradient(135deg,var(--accent),#ff3b5c);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(108,71,255,.4);cursor:pointer;z-index:50;transition:transform .2s}.wing-fab:active{transform:scale(.92)}`;
    document.head.appendChild(fs);
  }

  container._prfData = { posts, likedPosts: likedPostsArr, mediaPosts, savedPosts: savedPostsArr };
  renderPrfPosts(posts, 'prf-panel-list', true, true);
  document.getElementById('prf-panel-list')._loaded = true;

  // ── Floating header for own profile ──
  const myPage   = document.getElementById('page-profile');
  const myHeader = document.getElementById('my-profile-header');
  if (!myHeader) return;

  // Set mini avatar
  const myMiniAvatar = document.getElementById('myprf-header-avatar');
  if (myMiniAvatar) myMiniAvatar.src = profile.avatar || '';

  // Sample cover colour
  let myR=0, myG=0, myB=0;
  const myCoverImg = container.querySelector('.prf-cover-img');
  if (myCoverImg) {
    const sampleMyColour = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 50; canvas.height = 10;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(myCoverImg, 0, 0, 50, 10);
        const d = ctx.getImageData(0, 0, 50, 10).data;
        let r=0,g=0,b=0,count=0;
        for (let i=0;i<d.length;i+=4){ r+=d[i];g+=d[i+1];b+=d[i+2];count++; }
        myR=Math.round(r/count*0.4);
        myG=Math.round(g/count*0.4);
        myB=Math.round(b/count*0.4);
      } catch(e) {}
    };
    if (myCoverImg.complete) sampleMyColour();
    else myCoverImg.addEventListener('load', sampleMyColour, {once:true});
  }

  // Scroll → header bg
  if (myPage._myprfScroll) myPage.removeEventListener('scroll', myPage._myprfScroll);
  myPage._myprfScroll = () => {
    const opacity = Math.min(myPage.scrollTop / 60, 1);
    myHeader.style.background = `rgba(${myR},${myG},${myB},${opacity})`;
  };
  myPage.addEventListener('scroll', myPage._myprfScroll);

  // Avatar observer → mini avatar in header
  const myAvatarWrap = container.querySelector('.prf-avatar-wrap');
  const myMiniIdentity = document.getElementById('myprf-header-identity');
  if (myPage._myprfAvatarObs) myPage._myprfAvatarObs.disconnect();
  myPage._myprfAvatarObs = new IntersectionObserver(([entry]) => {
    const visible = entry.isIntersecting;
    if (myMiniIdentity) {
      myMiniIdentity.style.opacity = visible ? '0' : '1';
      myMiniIdentity.style.pointerEvents = visible ? 'none' : 'auto';
    }
  }, { root: myPage, threshold: 0 });
  if (myAvatarWrap) myPage._myprfAvatarObs.observe(myAvatarWrap);

  // Load people suggestions after profile renders
  setTimeout(() => loadSuggestedForMe(), 100);
}

function switchPrfTab(tab, el) {
  const container = document.getElementById('my-profile-content');
  document.querySelectorAll('#prf-tabs .prf-icon-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  ['list','media','likes','saved'].forEach(t => {
    const p = document.getElementById('prf-panel-' + t);
    if (p) p.style.display = 'none';
  });
  const panel = document.getElementById('prf-panel-' + tab);
  if (!panel) return;
  panel.style.display = (tab === 'list' || tab === 'likes' || tab === 'saved') ? 'flex' : 'block';
  if (panel._loaded) return;
  const { posts, likedPosts: likedArr, mediaPosts, savedPosts: savedArr } = container._prfData || {};
  if (tab === 'list')  renderPrfPosts(posts || [],    'prf-panel-list',  true, true);
  if (tab === 'media') renderPrfMasonry(mediaPosts || [], 'prf-panel-media', true);
  if (tab === 'likes') renderPrfPosts(likedArr || [], 'prf-panel-likes', false, true);
  if (tab === 'saved') renderPrfSavedSync(savedArr || [], 'prf-panel-saved');
  panel._loaded = true;
}

function switchProfileTab(mode, btn) { switchPrfTab('posts', btn); }

function renderPrfPosts(posts, containerId, isOwn, isProfilePage = false, viewingUserId = null) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!posts.length) {
    container.innerHTML = `<div class="prf-empty"><div class="prf-empty-icon">${isOwn ? '✍️' : '❤️'}</div><p>${isOwn ? 'No posts yet' : 'No likes yet'}</p>${isOwn ? '<span>Share your first thought</span>' : ''}</div>`;
    return;
  }
  container.innerHTML = '';
  posts.forEach(p => {
    const el = createFeedPost(p, isProfilePage, viewingUserId);
    if (el) { container.appendChild(el); observePost(el); }
  });
}

function renderPrfMasonry(posts, containerId, mediaOnly = false) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const items = mediaOnly ? posts.filter(p => (p.image || p.video) && !p.reposted_post_id) : posts;
  if (!items.length) {
    container.innerHTML = `<div class="prf-empty"><div class="prf-empty-icon">✍️</div><p>No posts yet</p><span>Start sharing your world</span></div>`;
    return;
  }
  const wrap = document.createElement('div');
  wrap.className = 'prf-masonry';
  const left = document.createElement('div');
  left.className = 'prf-masonry-col';
  const right = document.createElement('div');
  right.className = 'prf-masonry-col';

  items.forEach((post, i) => {
    const img    = post.image || post.reposted_post?.image || '';
    const text   = post.content || post.reposted_post?.content || '';
    const user   = post.user || post.reposted_post?.user || {};
    const avatar = user.avatar || `https://api.dicebear.com/7.x/adventurer/svg?seed=${user.username}`;
    const uname  = user.username || '';
    const liked  = likedPosts.has(post.id);
    const likes  = post.like_count || 0;

    const tile = document.createElement('div');
    tile.className = 'prf-masonry-tile';
    tile.innerHTML = `
      ${img
        ? `<img src="${escHtml(img)}" alt="" loading="lazy" class="prf-masonry-img">`
        : `<div class="prf-masonry-text-tile" style="background:${gradientFor(post.id)}"><p>${escHtml(text.slice(0,120))}</p></div>`
      }
      ${text && img ? `<div class="prf-masonry-caption">${escHtml(text.slice(0,80))}${text.length > 80 ? '…' : ''}</div>` : ''}
      <div class="prf-masonry-footer">
        <div class="prf-masonry-author">
          <img class="prf-masonry-avatar" src="${escHtml(avatar)}" onerror="this.src='https://api.dicebear.com/7.x/adventurer/svg?seed=${escHtml(uname)}'">
          <span class="prf-masonry-username">${escHtml(uname)}</span>
        </div>
        <button class="prf-masonry-like ${liked ? 'liked' : ''}" data-post-id="${post.id}" data-liked="${liked ? 'true' : 'false'}" onclick="event.stopPropagation(); toggleMasonryLike(this, '${post.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path class="heart-path" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
          </svg>
          <span class="prf-masonry-like-count">${likes > 0 ? fmtNum(likes) : ''}</span>
        </button>
      </div>`;

    tile.addEventListener('click', () => openDetail(post.id));
    if (i % 2 === 0) left.appendChild(tile);
    else             right.appendChild(tile);
  });

  wrap.appendChild(left);
  wrap.appendChild(right);
  container.innerHTML = '';
  container.appendChild(wrap);
}

// ══════════════════════════════════════════
// SAVE / BOOKMARK
// ══════════════════════════════════════════

function setSaveBtnState(btn, isSaved) {
  if (!btn) return;
  const icon = btn.querySelector('.save-icon');
  if (isSaved) {
    btn.classList.add('saved');
    if (icon) { icon.setAttribute('fill', '#6C47FF'); icon.setAttribute('stroke', '#6C47FF'); }
  } else {
    btn.classList.remove('saved');
    if (icon) { icon.setAttribute('fill', 'none'); icon.setAttribute('stroke', '#000000'); }
  }
}

async function toggleSave(postId, btn) {
  if (!currentUser) { showToast('Sign in to save posts'); return; }
  const isSaved = savedPosts.has(postId);
  // Optimistic
  if (isSaved) { savedPosts.delete(postId); setSaveBtnState(btn, false); }
  else          { savedPosts.add(postId);    setSaveBtnState(btn, true);  }

  if (isSaved) {
    const { error } = await supabase.from('saved_posts')
      .delete().eq('user_id', currentUser.id).eq('post_id', postId);
    if (error) { savedPosts.add(postId); setSaveBtnState(btn, true); showToast('Failed to unsave'); }
    else showToast('Removed from saved');
  } else {
    const { error } = await supabase.from('saved_posts')
      .insert({ user_id: currentUser.id, post_id: postId });
    if (error) { savedPosts.delete(postId); setSaveBtnState(btn, false); showToast('Failed to save'); }
    else showToast('Saved 🔖');
  }
  // Refresh saved panel immediately if it's currently visible
  const panel = document.getElementById('prf-panel-saved');
  if (panel) {
    panel._loaded = false;
    if (panel.style.display !== 'none') renderPrfSaved('prf-panel-saved');
  }
}

async function checkSavedPosts(postIds) {
  if (!currentUser || !postIds.length) return;
  const { data } = await supabase.from('saved_posts')
    .select('post_id').eq('user_id', currentUser.id).in('post_id', postIds);
  if (!data) return;
  data.forEach(r => {
    savedPosts.add(r.post_id);
    document.querySelectorAll(`.save-btn[data-post-id="${r.post_id}"]`).forEach(btn => setSaveBtnState(btn, true));
  });
}

function renderPrfSavedSync(posts, containerId) {
  const c = document.getElementById(containerId);
  if (!c) return;
  if (!posts.length) {
    c.innerHTML = '<div class="prf-empty"><div class="prf-empty-icon">🔖</div><p>No saved posts yet</p><span>Tap the bookmark on any post</span></div>';
    return;
  }
  c.innerHTML = '';
  posts.forEach(p => {
    if (!p) return;
    const el = createFeedPost(p, true);
    if (el) { c.appendChild(el); observePost(el); }
  });
}

// Keep async version for invalidation/refresh after save toggle
async function renderPrfSaved(containerId) {
  const c = document.getElementById(containerId);
  if (!c) return;
  if (!currentUser) { c.innerHTML = '<div class="prf-empty"><p>Sign in to see saved posts</p></div>'; return; }
  const { data, error } = await supabase.from('saved_posts')
    .select(`post:posts(id,content,image,video,created_at,like_count,repost_count,views,user_id,reposted_post_id,user:users(id,username,avatar),reposted_post:reposted_post_id(id,content,image,video,created_at,user_id,user:users(id,username,avatar)))`)
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(60);
  if (error || !data?.length) {
    c.innerHTML = '<div class="prf-empty"><div class="prf-empty-icon">🔖</div><p>No saved posts yet</p><span>Tap the bookmark on any post</span></div>';
    return;
  }
  c.innerHTML = '';
  data.map(r => r.post).filter(Boolean).forEach(p => {
    const el = createFeedPost(p, true);
    if (el) { c.appendChild(el); observePost(el); }
  });
}

function renderPrfStore(containerId) {
  const c = document.getElementById(containerId);
  if (!c) return;
  c.innerHTML = `<div class="prf-placeholder" style="background:linear-gradient(135deg,#f4f3ff,#fdf2ff);border:1.5px solid #ddd6fe">
    <div class="prf-placeholder-icon">🛍️</div>
    <h3 style="color:#6C47FF">Your storefront</h3>
    <p style="color:#9b87f5">List products, get paid safely via escrow.<br>Launching very soon.</p>
  </div>`;
}

function renderProfileGrid(posts, profile, containerId, isOwn) {
  renderPrfMasonry(posts, containerId);
}

// ══════════════════════════════════════════
// OTHER USER PROFILE
// ══════════════════════════════════════════
// ── SELF TAP — pulse instead of navigating ──────────────────
function selfTap(el) {
  if (!el) return;
  el.classList.remove('self-pulse');
  void el.offsetWidth; // force reflow to restart animation
  el.classList.add('self-pulse');
  el.addEventListener('animationend', () => el.classList.remove('self-pulse'), { once: true });
}

async function showUserProfile(userId, tapEl) {
  if (!userId) return;
  if (userId === currentUser?.id) { selfTap(tapEl); return; }
  injectProfileStyles();

  // Clear immediately — prevents ghost click landing on previous user's posts
  const body = document.getElementById('user-profile-body');
  if (body) body.innerHTML = '<div class="loading-pulse" style="height:300px;margin:0"></div>';

  slideTo('user-profile', async () => {
    const body = document.getElementById('user-profile-body');
    body.innerHTML = '<div class="loading-pulse" style="height:300px;margin:0"></div>';

    const { data: profile } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
    if (!profile) { body.innerHTML = '<div class="empty-state"><p>User not found</p></div>'; return; }
    pushRoute('/profile/' + profile.username);

    const { data: posts } = await supabase.from('posts')
      .select(`id,content,image,video,created_at,like_count,repost_count,views,user_id,reposted_post_id,
               user:users(id,username,avatar,location),
               reposted_post:reposted_post_id(id,content,image,video,created_at,user_id,user:users(id,username,avatar,location))`)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(60);

    const allPosts   = posts || [];
    const likedPosts = [];
    const mediaPosts = allPosts.filter(p => (p.image || p.video) && !p.reposted_post_id);

    // Await follow state BEFORE rendering — same pattern as detail page, no flash
    const isFollowing = currentUser ? await checkFollowState(userId) : false;

    body.innerHTML = `
      <div class="prf-wrap">
        <div class="prf-cover" onclick="viewProfilePhoto('${escHtml(profile.cover||'')}','cover','${escHtml(profile.username||'')}')" style="cursor:${profile.cover ? 'pointer' : 'default'}">
          ${profile.cover
            ? `<img src="${escHtml(profile.cover)}" alt="" class="prf-cover-img">`
            : `<div class="prf-cover-gradient"></div>`}
          <div class="prf-cover-bar">
            <div></div>
            <div class="prf-cover-actions"></div>
          </div>
        </div>

        <!-- AVATAR ROW -->
        <div class="prf-avatar-row">
          <div class="prf-avatar-wrap" onclick="viewProfilePhoto('${escHtml(profile.avatar||`https://api.dicebear.com/7.x/adventurer/svg?seed=${escHtml(profile.id)}`)}','avatar','${escHtml(profile.username||'')}')" style="cursor:pointer">
            <div class="prf-avatar-ring"></div>
            <img class="prf-avatar" src="${escHtml(profile.avatar || `https://api.dicebear.com/7.x/adventurer/svg?seed=${escHtml(profile.id)}`)}" onerror="this.src='https://api.dicebear.com/7.x/adventurer/svg?seed=${escHtml(profile.id)}'" alt="">
          </div>
          <div class="prf-avatar-action-btns">
            <button class="prf-btn prf-btn-icon" onclick="openDM('${userId}')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
            </button>
            <button class="prf-btn ${isFollowing ? 'prf-btn-following' : 'prf-btn-primary'}" id="follow-btn-${userId}" onclick="toggleFollow('${userId}',this)">${isFollowing ? 'Following' : 'Follow'}</button>
          </div>
        </div>

        <!-- IDENTITY -->
        <div class="prf-identity" style="padding-top:8px">
          <div class="prf-name-row">
            <h1 class="prf-name">${escHtml(profile.username || 'User')}</h1>
            ${profile.is_verified ? `<span class="prf-verified"><svg width="18" height="18" viewBox="0 0 24 24" fill="#6C47FF"><path d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"/></svg></span>` : ''}
          </div>
          ${profile.bio ? `<p class="prf-bio">${escHtml(profile.bio)}</p>` : ''}
          ${profile.location ? `<p class="prf-location"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" style="vertical-align:-1px;margin-right:3px"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="currentColor"/></svg>${escHtml(profile.location)}</p>` : ''}
        ${profile.location ? `<p class="prf-location"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" style="vertical-align:-1px;margin-right:3px"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="currentColor"/></svg>${escHtml(profile.location)}</p>` : ''}
          ${getMomentBanner(userId)}
        </div>

        <!-- STATS BAR -->
        <div class="prf-stats-row">
          <div class="prf-stat-card">
            <span class="prf-stat-n">${fmtNum(allPosts.length)}</span>
            <span class="prf-stat-l">Posts</span>
          </div>
          <div class="prf-stat-card clickable" onclick="openFollowList('followers','${userId}')">
            <span class="prf-stat-n" id="uprf-followers-${userId}">${fmtNum(profile.followers||0)}</span>
            <span class="prf-stat-l">Followers</span>
          </div>
          <div class="prf-stat-card clickable" onclick="openFollowList('following','${userId}')">
            <span class="prf-stat-n" id="uprf-following-${userId}">${fmtNum(profile.following||0)}</span>
            <span class="prf-stat-l">Following</span>
          </div>
          <div class="prf-stat-card">
            <span class="prf-stat-n">${fmtNum(allPosts.reduce((s,p)=>s+(p.views||0),0))}</span>
            <span class="prf-stat-l">Views</span>
          </div>
        </div>

        <!-- CREATOR STOREFRONT BANNER -->
        <div class="prf-storefront-banner" onclick="showToast('Creator storefronts coming soon 🛍️')">
          <div class="prf-storefront-icon">🛍️</div>
          <div class="prf-storefront-text">
            <div class="prf-storefront-title">Shop ${escHtml(profile.username || 'this creator')}'s store</div>
            <div class="prf-storefront-sub">Browse their products & support their hustle.</div>
          </div>
          <span class="prf-storefront-pill">Soon</span>
        </div>

        <!-- ICON TABS: List · Media only on other profiles -->
        <div class="prf-icon-tabs" id="uprf-tabs-${userId}">
          <div class="prf-icon-tab active" onclick="switchUPrfTab('list','${userId}',this)">
            <div class="prf-icon-tab-dot"></div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
          </div>
          <div class="prf-icon-tab" onclick="switchUPrfTab('media','${userId}',this)">
            <div class="prf-icon-tab-dot"></div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          </div>
        </div>

        <div id="uprf-list-${userId}"  class="prf-panel prf-posts-panel"></div>
        <div id="uprf-media-${userId}" class="prf-panel" style="display:none"></div>
      </div>
    `;

    body._uprfData = { posts: allPosts, mediaPosts, likedPosts };
    renderPrfPosts(allPosts, `uprf-list-${userId}`, false, true, userId);
    document.getElementById(`uprf-list-${userId}`)._loaded = true;

    const upPage   = document.getElementById('page-user-profile');
    const upHeader = document.getElementById('user-profile-header');
    if (upPage._uprfScroll) upPage.removeEventListener('scroll', upPage._uprfScroll);

    // ── 1. Sample dominant colour from cover photo ──
    let headerR = 0, headerG = 0, headerB = 0; // default black
    const coverImg = body.querySelector('.prf-cover-img');
    if (coverImg) {
      const sampleColour = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 50; canvas.height = 10;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(coverImg, 0, 0, 50, 10);
          const d = ctx.getImageData(0, 0, 50, 10).data;
          let r=0,g=0,b=0,count=0;
          for (let i=0;i<d.length;i+=4){ r+=d[i];g+=d[i+1];b+=d[i+2];count++; }
          r=Math.round(r/count*0.4); // darken by 60%
          g=Math.round(g/count*0.4);
          b=Math.round(b/count*0.4);
          headerR=r; headerG=g; headerB=b;
        } catch(e) { /* CORS fallback — stays black */ }
      };
      if (coverImg.complete) sampleColour();
      else coverImg.addEventListener('load', sampleColour, {once:true});
    }

    // ── 2. Scroll → header bg colour ──
    upPage._uprfScroll = () => {
      const opacity = Math.min(upPage.scrollTop / 60, 1);
      upHeader.style.background = `rgba(${headerR},${headerG},${headerB},${opacity})`;
    };
    upPage.addEventListener('scroll', upPage._uprfScroll);

    // ── Wire 3-dots more button ──
    viewingProfile = profile;

    // ── 3. Mini avatar + follow in header via IntersectionObserver ──
    const miniIdentity = document.getElementById('uprf-header-identity');
    const miniAvatar   = document.getElementById('uprf-header-avatar');
    const miniFollow   = document.getElementById('uprf-header-follow');

    // Set mini avatar src and wire follow/message buttons
    miniAvatar.src = profile.avatar || '';
    const mainFollowBtn = document.getElementById(`follow-btn-${userId}`);
    const miniMsgBtn    = document.getElementById('uprf-header-message');

    miniFollow.onclick  = () => mainFollowBtn?.click();
    if (miniMsgBtn) miniMsgBtn.onclick = () => openDM(userId);

    // Sync: if following → show Message, hide Follow. If not → show Follow, hide Message
    const syncHeaderBtn = () => {
      if (!mainFollowBtn) return;
      const isFollowing = mainFollowBtn.classList.contains('prf-btn-following');
      // Always show Follow text (legacy) but we hide/show via display
      miniFollow.textContent = 'Follow';
      if (miniMsgBtn) {
        // If following: hide Follow entirely, show Message
        // If not following: show Follow, hide Message
        miniFollow.style.display  = isFollowing ? 'none' : '';
        miniMsgBtn.style.display  = isFollowing ? 'flex' : 'none';
      }
      // Also trigger recommendation box when following
      if (isFollowing) renderSuggestedForOtherProfile(userId, profile.username);
    };
    syncHeaderBtn();
    const followObserver = new MutationObserver(syncHeaderBtn);
    if (mainFollowBtn) followObserver.observe(mainFollowBtn, { attributes:true, attributeFilter:['class'] });

    // Watch avatar element — when it leaves viewport top, show mini
    const avatarWrap = body.querySelector('.prf-avatar-wrap');
    if (upPage._uprfAvatarObs) upPage._uprfAvatarObs.disconnect();
    upPage._uprfAvatarObs = new IntersectionObserver(([entry]) => {
      const visible = entry.isIntersecting;
      miniIdentity.style.opacity       = visible ? '0' : '1';
      miniIdentity.style.pointerEvents = visible ? 'none' : 'auto';

      // Check current follow state to decide which button to show
      const nowFollowing = mainFollowBtn?.classList.contains('prf-btn-following');
      if (nowFollowing) {
        // Show Message, hide Follow
        miniFollow.style.display         = 'none';
        miniFollow.style.opacity         = '0';
        miniFollow.style.pointerEvents   = 'none';
        if (miniMsgBtn) {
          miniMsgBtn.style.display       = visible ? 'none' : 'flex';
          miniMsgBtn.style.opacity       = visible ? '0' : '1';
          miniMsgBtn.style.pointerEvents = visible ? 'none' : 'auto';
        }
      } else {
        // Show Follow, hide Message
        miniFollow.style.display         = 'block';
        miniFollow.style.opacity         = visible ? '0' : '1';
        miniFollow.style.pointerEvents   = visible ? 'none' : 'auto';
        if (miniMsgBtn) {
          miniMsgBtn.style.display       = 'none';
          miniMsgBtn.style.opacity       = '0';
          miniMsgBtn.style.pointerEvents = 'none';
        }
      }
    }, { root: upPage, threshold: 0 });
    if (avatarWrap) upPage._uprfAvatarObs.observe(avatarWrap);
  });
}

function switchUPrfTab(tab, userId, el) {
  const body = document.getElementById('user-profile-body');
  document.querySelectorAll(`#uprf-tabs-${userId} .prf-icon-tab`).forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  ['list','media'].forEach(t => {
    const p = document.getElementById(`uprf-${t}-${userId}`);
    if (p) p.style.display = 'none';
  });
  const panel = document.getElementById(`uprf-${tab}-${userId}`);
  if (!panel) return;
  panel.style.display = tab === 'list' ? 'flex' : 'block';
  if (panel._loaded) return;
  const { posts, mediaPosts } = body._uprfData || {};
  if (tab === 'media') renderPrfMasonry(mediaPosts || [], `uprf-media-${userId}`, true);
  panel._loaded = true;
}

async function toggleFollow(userId, btn) {
  if (!currentUser) { showToast('Sign in to follow'); return; }
  const isFollowing = btn.classList.contains('prf-btn-following');

  // Optimistic UI update
  setFollowBtnState(btn, !isFollowing);

  if (isFollowing) {
    // Unfollow — delete from follows table
    const { data: delData, error } = await supabase
      .from('follows')
      .delete()
      .eq('follower_id', currentUser.id)
      .eq('following_id', userId)
      .select();

    if (error || !delData?.length) {
      setFollowBtnState(btn, true); // revert
      showToast('Failed to unfollow');
      return;
    }
    showToast('Unfollowed');
  } else {
    // Follow — insert into follows table
    const { data: insertData, error } = await supabase
      .from('follows')
      .insert({ follower_id: currentUser.id, following_id: userId })
      .select();

    if (error) {
      console.error('Follow failed:', error, 'follower:', currentUser.id, 'following:', userId);
      setFollowBtnState(btn, false); // revert
      showToast('Failed to follow');
      return;
    }
    showToast('Following ✓');
  }

  // Refresh follower count on the visible profile
  refreshFollowCounts(userId);
}

function setFollowBtnState(btn, isFollowing) {
  btn.classList.toggle('prf-btn-following', isFollowing);
  btn.classList.toggle('prf-btn-primary', !isFollowing);
  btn.textContent = isFollowing ? 'Following' : 'Follow';
}

async function refreshFollowCounts(userId) {
  const { data } = await supabase
    .from('users')
    .select('followers, following')
    .eq('id', userId)
    .maybeSingle();
  if (!data) return;

  // Update visible follower count on other user's profile
  const followerEl = document.querySelector(`#uprf-followers-${userId}`);
  if (followerEl) followerEl.textContent = fmtNum(data.followers || 0);

  // Update follower count on any suggestion card for this user
  document.querySelectorAll(`.prf-suggest-card[data-uid="${userId}"] .prf-suggest-followers`).forEach(el => {
    el.textContent = fmtNum(data.followers || 0) + ' followers';
  });

  // Update own following count on ME page
  if (currentUser) {
    const { data: me } = await supabase
      .from('users')
      .select('followers, following')
      .eq('id', currentUser.id)
      .maybeSingle();
    if (me) {
      currentProfile = { ...currentProfile, ...me };
      const myFollowingEl = document.querySelector('#prf-following-count');
      if (myFollowingEl) myFollowingEl.textContent = fmtNum(me.following || 0);
    }
  }
}

async function checkFollowState(userId) {
  if (!currentUser || userId === currentUser.id) return false;
  const { data } = await supabase
    .from('follows')
    .select('id')
    .eq('follower_id', currentUser.id)
    .eq('following_id', userId)
    .maybeSingle();
  return !!data;
}

// ══════════════════════════════════════════
// FEED
// ══════════════════════════════════════════

async function loadFeed(reset = false) {
  const list = document.getElementById('feed-list');
  if (!list) return;

  if (reset) {
    feedOffset = 0; feedExhausted = false; feedLoading = false;
    loadedPostIds.clear(); list.innerHTML = '';
  }

  if (feedLoading || feedExhausted) return;
  feedLoading = true; // set synchronously — prevents concurrent calls

  const PER_PAGE = 15;

  if (feedOffset === 0) {
    list.innerHTML = Array(5).fill(0).map(() => skeletonPost()).join('');
  }

  try {
    // ── FOLLOWING TAB — pure chronological from followed users ──
    if (currentFeedTab === 'following') {
      await loadFollowingFeed(list, PER_PAGE);
      return;
    }

    // ── EXPLORE TAB — Phase 2 algorithm ──
    await loadExploreFeed(list, PER_PAGE);

  } catch (e) {
    console.error('Feed error:', e);
    if (feedOffset === 0) list.innerHTML = `<div class="empty-state"><div class="empty-icon">😕</div><p>Couldn't load posts</p><span>${e.message}</span></div>`;
  } finally {
    feedLoading = false;
  }
}

// ── FOLLOWING FEED — chronological from followed users only ──
async function loadFollowingFeed(list, PER_PAGE) {
  try {
    if (!currentUser) { feedLoading = false; return; }

    const { data: followingRows } = await supabase
      .from('follows').select('following_id').eq('follower_id', currentUser.id);

    const followingIds = followingRows?.map(r => r.following_id) || [];

    if (followingIds.length === 0) {
      feedExhausted = true;
      if (feedOffset === 0) {
        list.innerHTML = `<div class="empty-state"><div class="empty-icon">👥</div><p>No posts yet</p><span>Follow people to see their posts here</span></div>`;
      }
      return;
    }

    const { data: posts, error } = await supabase
      .from('posts')
      .select(`id,content,image,video,created_at,like_count,repost_count,views,user_id,reposted_post_id,
               user:users(id,username,avatar),
               reposted_post:reposted_post_id(id,content,image,video,created_at,user_id,user:users(id,username,avatar)),
               comments(count)`)
      .in('user_id', followingIds)
      .neq('user_id', currentUser.id)
      .order('created_at', { ascending: false })
      .range(feedOffset, feedOffset + PER_PAGE - 1);

    if (error) throw error;
    // Deduplicate before render
    const uniquePosts = [];
    const seenIds = new Set();
    for (const p of posts || []) {
      if (!seenIds.has(p.id)) { seenIds.add(p.id); uniquePosts.push(p); }
    }
    renderFeedPosts(list, uniquePosts, PER_PAGE);
  } finally {
    feedLoading = false;
  }
}

// ── EXPLORE / FOR YOU FEED ── more like X For You (2025 style)
async function loadExploreFeed(list, PER_PAGE) {
  try {
    const SELECT = `id,content,image,video,created_at,like_count,repost_count,views,user_id,reposted_post_id,
      user:users(id,username,avatar,location),
      reposted_post:reposted_post_id(id,content,image,video,created_at,user_id,user:users(id,username,avatar)),
      comments(count)`;

    // ── Time windows ────────────────────────────────────────
    const NOW               = new Date();
    const MAX_AGE_DAYS      = 7;                    // X shows older viral content
    const HIGH_VELOCITY_HRS = 36;                   // very recent → strong boost
    const MEDIUM_VELOCITY_HRS = 96;                 // still "hot" up to ~4 days

    const MAX_AGE_MS        = MAX_AGE_DAYS * 86400000;
    const HIGH_VEL_MS       = HIGH_VELOCITY_HRS * 3600000;
    const MED_VEL_MS        = MEDIUM_VELOCITY_HRS * 3600000;

    const HIGH_VEL_CUTOFF   = new Date(NOW - HIGH_VEL_MS).toISOString();
    const MED_VEL_CUTOFF    = new Date(NOW - MED_VEL_MS).toISOString();
    const MAX_AGE_CUTOFF    = new Date(NOW - MAX_AGE_MS).toISOString();

    // ── Get social graph ────────────────────────────────────
    let followingIds = [];
    let userCountry  = null;

    if (currentUser) {
      const { data: fl } = await supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', currentUser.id);
      followingIds = fl?.map(r => r.following_id) || [];

      if (currentProfile?.location) {
        const parts = currentProfile.location.split(',');
        userCountry = parts[parts.length - 1]?.trim() || null;
      }
    }

    // ── Friends-of-friends (small graph boost) ──────────────
    let fofIds = [];
    if (followingIds.length > 0) {
      const { data: fof } = await supabase
        .from('follows')
        .select('following_id')
        .in('follower_id', followingIds)
        .not('following_id', 'in', `(${[currentUser?.id, ...followingIds].filter(Boolean).join(',') || 'null'})`)
        .limit(80);
      fofIds = [...new Set(fof?.map(r => r.following_id) || [])];
    }

    // ── Parallel fetches ────────────────────────────────────
    const [
      followingPosts,       // people you follow
      fofPosts,             // friends of friends
      trendingHighVelocity, // very hot right now
      trendingMedium,       // still hot last ~4 days
      localPostsRaw,        // same country
      generalFresh,         // general recent content
    ] = await Promise.all([

      // 1. Following (strongest signal)
      followingIds.length > 0
        ? supabase.from('posts').select(SELECT)
            .in('user_id', followingIds)
            .gte('created_at', MAX_AGE_CUTOFF)
            .order('created_at', { ascending: false })
            .limit(30)
        : { data: [] },

      // 2. Friends-of-friends (social proof)
      fofIds.length > 0
        ? supabase.from('posts').select(SELECT)
            .in('user_id', fofIds)
            .gte('created_at', MAX_AGE_CUTOFF)
            .order('created_at', { ascending: false })
            .limit(25)
        : { data: [] },

      // 3. Very high velocity (last 36 h)
      supabase.from('posts').select(SELECT)
        .gte('created_at', HIGH_VEL_CUTOFF)
        .order('like_count', { ascending: false })
        .limit(12),

      // 4. Medium velocity (last ~4 days)
      supabase.from('posts').select(SELECT)
        .gte('created_at', MED_VEL_CUTOFF)
        .lt('created_at', HIGH_VEL_CUTOFF)
        .order('like_count', { ascending: false })
        .limit(15),

      // 5. Location-based (same country)
      userCountry
        ? supabase.from('posts').select(SELECT)
            .gte('created_at', MAX_AGE_CUTOFF)
            .order('created_at', { ascending: false })
            .limit(60)
        : { data: [] },

      // 6. General recent content (discovery / cold-start filler)
      supabase.from('posts').select(SELECT)
        .gte('created_at', MAX_AGE_CUTOFF)
        .order('created_at', { ascending: false })
        .limit(40),
    ]);

    // Filter local posts client-side
    const localPosts = (localPostsRaw?.data || []).filter(p =>
      p.user?.location && p.user.location.includes(userCountry)
    ).slice(0, 12);

    // ── Scoring function ────────────────────────────────────
    const nowMs = Date.now();

    function scorePost(p) {
      const ageMs     = nowMs - new Date(p.created_at).getTime();
      const ageHours  = ageMs / 3600000;

      // Recency decay — very sharp after 48h, slower after
      let recency = 1;
      if (ageHours > 48) {
        recency = Math.max(0.15, 1 - (ageHours - 48) / 120); // floor at 15% after ~1 week
      }

      // Engagement score — likes + reposts
      const engagement = (p.like_count || 0) + (p.repost_count || 0) * 1.6;

      // Velocity bonus — very recent high-engagement gets huge boost
      let velocityBonus = 0;
      if (ageMs < HIGH_VEL_MS) {
        velocityBonus = Math.min(80, engagement * 2.5);
      } else if (ageMs < MED_VEL_MS) {
        velocityBonus = Math.min(45, engagement * 1.2);
      }

      // Social graph multipliers
      let graphBonus = 0;
      if (followingIds.includes(p.user_id))          graphBonus += 100;   // huge boost
      else if (fofIds.includes(p.user_id))           graphBonus += 45;    // good boost
      else if (localPosts.some(lp => lp.id === p.id)) graphBonus += 18;   // mild local preference

      // Media bonus (social commerce tilt)
      const hasMedia = !!(p.image || p.video);
      const mediaBonus = hasMedia ? 12 : 0;

      // Final score
      return (recency * 100) + graphBonus + velocityBonus + engagement * 0.8 + mediaBonus;
    }

    // ── Build pool ──────────────────────────────────────────
    const pool = new Map(); // post.id → {post, score}

    const add = (posts, sourceBoost = 0) => {
      (posts || []).forEach(p => {
        if (loadedPostIds.has(p.id)) return;
        const s = scorePost(p) + sourceBoost;
        if (!pool.has(p.id) || s > pool.get(p.id).score) {
          pool.set(p.id, { post: p, score: s });
        }
      });
    };

    add(followingPosts?.data, 80);       // strongest source
    add(fofPosts?.data, 35);
    add(trendingHighVelocity?.data, 60);
    add(trendingMedium?.data, 25);
    add(localPosts, 18);
    add(generalFresh?.data, 0);

    // ── Rank & paginate ─────────────────────────────────────
    let ranked = Array.from(pool.values())
      .sort((a, b) => b.score - a.score)
      .map(v => v.post);

    // Final deduplication safety
    const seen = new Set();
    ranked = ranked.filter(p => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });

    const page = ranked.slice(feedOffset, feedOffset + PER_PAGE);

    if (page.length === 0) {
      feedExhausted = true;
      if (feedOffset === 0) {
        list.innerHTML = `<div class="empty-state"><div class="empty-icon">🌙</div><p>Nothing new right now</p><span>Follow more people or post something!</span></div>`;
      }
      return;
    }

    renderFeedPosts(list, page, PER_PAGE);

  } catch (err) {
    console.error('Explore feed error:', err);
    if (feedOffset === 0) {
      list.innerHTML = `<div class="empty-state"><p style="color:var(--red)">Couldn't load explore feed</p><small>${err.message}</small></div>`;
    }
  } finally {
    feedLoading = false;
  }
}


function renderFeedPosts(list, posts, PER_PAGE) {
  if (!posts || !posts.length) {
    feedExhausted = true;
    if (feedOffset === 0) list.innerHTML = `<div class="empty-state"><div class="empty-icon">🌙</div><p>Nothing here yet</p><span>Be the first to post!</span></div>`;
    return;
  }

  if (feedOffset === 0) list.innerHTML = '';

  let blocked = 0;
  for (const p of posts) {
    if (loadedPostIds.has(p.id)) {
      blocked++;
      continue; // already rendered — skip
    }
    loadedPostIds.add(p.id);
    const el = createFeedPost(p);
    if (el) { list.appendChild(el); observePost(el); }
  }

  feedOffset += posts.length;
  if (posts.length < PER_PAGE) feedExhausted = true;

  const ids = [...loadedPostIds];
  checkLikedPosts(ids);
  checkRepostedPosts(ids);
  checkSavedPosts(ids);
  reObserveAllFeedPosts();

  // moment rings removed from feed
}

function setFeedTab(tab, btn) {
  currentFeedTab = tab;
  document.querySelectorAll('.feed-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');

  loadFeed(true);
}

function initFeedTabBar() {
  // tab bar removed
}

function createFeedPost(p, isProfilePage = false, viewingUserId = null) {
  const user = p.user || { username: '@unknown', avatar: '' };
  const isRepost = !!p.reposted_post_id && !!p.reposted_post;
  const orig = isRepost ? p.reposted_post : null;
  const origUser = orig?.user || { username: '@unknown', avatar: '' };
  const isOwnPost = currentUser && p.user_id === currentUser.id;
  // On another user's profile list — tapping their own username should pulse not navigate
  const isViewingUser = viewingUserId && p.user_id === viewingUserId;

  const el = document.createElement('div');
  el.className = 'poster' + (isRepost ? ' is-repost' : '');
  el.dataset.postId = p.id;
  if (isRepost && p.reposted_post_id) el.dataset.repostedPostId = p.reposted_post_id;

  const commentCount = p.comments?.[0]?.count || 0;
  const text = p.content || '';
  const textLimit = (p.image || p.video) ? 150 : 300;
  const truncated = text.length > textLimit;
  const displayText = truncated
    ? linkifyText(text.slice(0, textLimit).trimEnd()) + `...<br><span class="reer">see more</span>`
    : linkifyText(text);

  // ── Main content: repost vs normal ──
  let mainContentHTML = '';

  if (isRepost) {
    const origText = orig.content || '';
    const origTruncated = origText.length > textLimit;
    const origDisplay = origTruncated
      ? origText.slice(0, textLimit).trimEnd() + `...<span class="reer">see more</span>`
      : escHtml(origText);

    mainContentHTML = `
      ${text ? `<div class="tir repost-commentary"><p class="tired">${displayText}</p></div>` : ''}

      <div class="quote-card" data-original-id="${orig.id}" onclick="openDetail('${orig.id}');event.stopPropagation()">
        <div class="quote-card-inner">
          <div class="quote-card-header">
            <img class="quote-card-avatar" src="${origUser.avatar||''}" onerror="this.style.display='none'" alt="">
            <span class="quote-card-name">${escHtml(origUser.username)}</span>
            <span class="quote-card-time">${timeSince(orig.created_at)}</span>
          </div>
          ${orig.content ? `<p class="quote-card-text">${escHtml(orig.content.slice(0,240))}${orig.content.length>240?'…':''}</p>` : ''}
        </div>
        ${orig.image ? `<img class="quote-card-img" src="${orig.image}" alt="" loading="lazy">` : ''}
        ${orig.video && !orig.image ? `
          <div class="quote-card-video-wrap">
            <video class="quote-card-video" preload="metadata"><source src="${orig.video}" type="video/mp4"></video>
            <div class="quote-card-play">
              <svg width="36" height="36" viewBox="0 0 48 48" fill="none">
                <circle cx="24" cy="24" r="22" fill="rgba(0,0,0,0.45)" stroke="white" stroke-width="2"/>
                <path d="M32 24L20 31V17L32 24Z" fill="white"/>
              </svg>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  } else {
    // Detect URL in post — hide raw URL, show preview card in place of image
    const postUrl    = extractFirstUrl(text);
    const textWithoutUrl = postUrl ? text.replace(postUrl, '').trim() : text;
    const hasMedia   = !!(p.image || p.video);

    // Build text display — strip URL from visible text if no other media
    const cleanText  = (!hasMedia && postUrl) ? textWithoutUrl : text;
    const cleanLimit = (hasMedia || (!hasMedia && postUrl)) ? 150 : 300;
    const cleanTrunc = cleanText.length > cleanLimit;
    const cleanDisplay = cleanTrunc
      ? linkifyText(cleanText.slice(0, cleanLimit).trimEnd()) + `...<br><span class="reer">see more</span>`
      : linkifyText(cleanText);

    // URL preview placeholder — only when no real image/video
    const urlPreviewHtml = (!hasMedia && postUrl)
      ? `<div class="post-og-wrap">
           <div class="post-og-shimmer">
             <div class="post-og-shimmer-img"></div>
             <div class="post-og-shimmer-body"><div></div><div></div></div>
           </div>
         </div>`
      : '';

    mainContentHTML = `
      ${p.image ? `<div class="laptop1"><img src="${p.image}" class="laptop" alt="" loading="lazy"></div>` : ''}

      ${p.video && !p.image ? `
        <div class="video-container laptop1" data-post-id="${p.id}">
          <video class="video-thumbnail" preload="metadata">
            <source src="${p.video}" type="video/mp4">
          </video>
          <div class="video-overlay">
            <div class="play-button">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                <circle cx="24" cy="24" r="22" fill="rgba(244,7,82,0.5)" stroke="white" stroke-width="3"/>
                <path d="M34 24L18 34V14L34 24Z" fill="white"/>
              </svg>
            </div>
          </div>
        </div>
      ` : ''}

      ${urlPreviewHtml}

      ${cleanDisplay || cleanText ? `<div class="tir"><p class="tired">${cleanDisplay}</p></div>` : ''}
    `;
  }

  el.innerHTML = `
    <div class="cust-name">
      <a class="post-avatar-link" onclick="${(isProfilePage && (isOwnPost || isViewingUser)) ? 'selfTap(this)' : isOwnPost ? 'navTo(\'profile\')' : `showUserProfile('${p.user_id}',this)`};event.stopPropagation()">
        <img class="small-photo" src="${user.avatar || ''}" onerror="this.style.display='none'" alt="">
      </a>
      <div class="post-meta">
        <a class="post-author-link" onclick="${(isProfilePage && (isOwnPost || isViewingUser)) ? 'selfTap(this)' : isOwnPost ? 'navTo(\'profile\')' : `showUserProfile('${p.user_id}',this)`};event.stopPropagation()">
          <span class="jerry">${escHtml(user.username)}</span>
          <svg xmlns="http://www.w3.org/2000/svg" class="verif" viewBox="0 0 24 24" width="15" height="15"><path d="M12 2L3 7v5c0 5 4 9 9 10 5-1 9-5 9-10V7z" fill="#6C47FF"/><polyline points="8,12 11,15 16,9" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </a>
        <span class="time">${timeSince(p.created_at)}</span>
      </div>
      <div class="dots">
        <svg xmlns="http://www.w3.org/2000/svg" class="dot" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#000000" stroke-width="2"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>
      </div>
    </div>

    ${mainContentHTML}

    <div class="lefto">
      <div class="dick">
        <div><svg xmlns="http://www.w3.org/2000/svg" class="lefti" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.5"/><path d="M8 8 Q18 10 17 20"/></svg></div>
        <div><p class="viewe echoes-btn" data-post-id="${p.id}" onclick="openEchoes('${p.id}', event)"><span class="echoes-count">${commentCount || 0}</span> echoes</p></div>
      </div>
      <div class="twits">
        <div><svg xmlns="http://www.w3.org/2000/svg" class="lefti" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></div>
        <div><p class="viewe"><span class="echoes-count">${fmtNum(p.views) || 0}</span> views</p></div>
      </div>
    </div>

    <div class="reaction">
      <div class="reaction-container">
        <div class="call">
          <div class="mee">
            <div class="comment-btn" data-post-id="${p.id}">
              <svg xmlns="http://www.w3.org/2000/svg" class="feeling" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
              <span>${commentCount > 0 ? fmtNum(commentCount) : ''}</span>
            </div>

            <div class="repost-btn" data-post-id="${p.id}" data-reposted="false">
              <svg xmlns="http://www.w3.org/2000/svg" class="feeling repost-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
              <span>${p.repost_count > 0 ? fmtNum(p.repost_count) : ''}</span>
            </div>

            <div class="heart-ai" data-post-id="${p.id}" data-liked="false">
              <svg class="heart-icon heart-clickable" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path class="heart-path" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
              </svg>
              <span class="like-count heart-clickable">${p.like_count > 0 ? fmtNum(p.like_count) : ''}</span>
            </div>
          </div>
          <div class="mee">
            <div class="donate-btn save-btn" data-post-id="${p.id}"><svg xmlns="http://www.w3.org/2000/svg" class="feeling save-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg></div>
            <div class="donate-btn share-action" data-post-id="${p.id}"><svg xmlns="http://www.w3.org/2000/svg" class="feeling" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg></div>
          </div>
        </div>
      </div>
    </div>
  `;

  // ── Event listeners ──
  // Store post ID on element — read from DOM not closure to prevent stale ID bug
  el.dataset.postId = p.id;

  // Fetch OG preview AFTER innerHTML is set — so el.querySelector works
  if (!p.image && !p.video && !isRepost) {
    const postUrl = extractFirstUrl(p.content || '');
    if (postUrl) {
      const wrap = el.querySelector('.post-og-wrap');
      if (wrap) {
        fetchOgPreview(postUrl).then(og => {
          if (!el.isConnected) return;
          const w = el.querySelector('.post-og-wrap');
          if (!w) return;
          if (!og) { w.remove(); return; }
          w.innerHTML = buildPostOgCard(og, postUrl);
        }).catch(() => {
          const w = el.querySelector('.post-og-wrap');
          if (w) w.remove();
        });
      }
    }
  }

  el.addEventListener('click', e => {
    // ── Avatar/author FIRST — before anything else ──
    if (e.target.closest('.post-avatar-link') || e.target.closest('.post-author-link')) {
      e.stopPropagation();
      return;
    }

    if (el.dataset.blockNavigation === 'true') return;

    // Always read post ID from the DOM element, never from closure
    const postId = el.dataset.postId;

    // Log EVERY click on ANY post
    if (!postId) return;

    if (e.target.closest('.dots')) {
      showPostMenu(p, el, e.target.closest('.dots'));
      return;
    }
    if (e.target.closest('.heart-ai')) {
      toggleLike(postId, e.target.closest('.heart-ai'));
      return;
    }
    if (e.target.closest('.repost-btn')) {
      handleRepost(postId, e.target.closest('.repost-btn'), p.user_id);
      return;
    }
    if (e.target.closest('.comment-btn')) {
      openDetail(postId, true);
      return;
    }
    if (e.target.closest('.share-action')) {
      sharePost(p);
      return;
    }
    if (e.target.closest('.save-btn')) {
      toggleSave(postId, e.target.closest('.save-btn'));
      return;
    }
    if (e.target.closest('.reer')) {
      const tired = e.target.closest('.tired');
      if (tired) { tired.innerHTML = escHtml(text); e.stopPropagation(); return; }
    }
    // Block navigation for any interactive element
    if (e.target.closest('.mention-link')) {
      e.stopPropagation();
      handleMentionTap(e.target.closest('.mention-link').dataset.username);
      return;
    }
    if (e.target.closest('.post-author-link'))  return;
    if (e.target.closest('.post-link'))         return;
    if (e.target.closest('a'))                  return;
    if (e.target.closest('input, textarea, button, select')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.target.closest('.comment-bar'))       return;
    if (e.target.closest('.view-original') || e.target.closest('.quote-card')) {
      openDetail(e.target.closest('[data-original-id]')?.dataset.originalId || orig?.id);
      return;
    }
    openDetail(postId);
  });

  // Repost button — check initial state
  const repostBtn = el.querySelector('.repost-btn');
  if (repostBtn && repostedPosts.has(p.id)) {
    repostBtn.setAttribute('data-reposted', 'true');
    repostBtn.classList.add('reposted');
    const svg = repostBtn.querySelector('.repost-icon');
    if (svg) {
      svg.setAttribute('stroke', '#6C47FF');
      svg.setAttribute('stroke-width', '2.5');
    }
    const span = repostBtn.querySelector('span');
    if (span) span.style.color = '#6C47FF';
  }

  // Save button — check initial state
  const saveBtn = el.querySelector('.save-btn');
  if (saveBtn && savedPosts.has(p.id)) setSaveBtnState(saveBtn, true);

  // Like button — check initial state and seed LikeManager
  const heartContainer = el.querySelector('.heart-ai');
  const _isLiked = likedPosts.has(p.id);
  LikeManager.seed(p.id, p.like_count || 0, _isLiked);
  if (heartContainer && _isLiked) {
    heartContainer.setAttribute('data-liked', 'true');
    heartContainer.querySelector('.heart-icon')?.classList.add('liked');
    heartContainer.querySelector('.like-count')?.classList.add('liked');
  }

  // Long-press for post menu
  let lpTimer;
  el.addEventListener('touchstart', e => {
    if (e.target.closest('.heart-ai, .repost-btn, .comment-btn, .donate-btn, .save-btn, .dots, .post-avatar-link, .post-author-link, .post-link, .mention-link, input, textarea, button, a')) return;
    lpTimer = setTimeout(() => showPostMenu(p, el, null, true), 550);
  }, { passive: true });
  el.addEventListener('touchmove', () => clearTimeout(lpTimer), { passive: true });
  el.addEventListener('touchend', () => clearTimeout(lpTimer), { passive: true });

  return el;
}


// ══════════════════════════════════════════
// FEED POST STYLES (view.js UI)
// ══════════════════════════════════════════

function injectFeedPostStyles() {
  if (document.getElementById('feed-post-view-styles')) return;
  const style = document.createElement('style');
  style.id = 'feed-post-view-styles';
  style.textContent = `
    #feed-list { display: flex; flex-direction: column; gap: 10px; }

    .poster {
      display: block;
      width: 100%;
      border: 0.5px solid rgb(220,220,220);
      border-radius: 10px;
      padding: 10px 10px 0px;
      transition: background-color 0.2s;
      position: relative;
      cursor: pointer;
      overflow: hidden;
      touch-action: manipulation;
    }
    .poster:hover { background-color: rgb(250,250,250); }

    .cust-name {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
      position: relative;
      z-index: 5;
    }
    .post-avatar-link {
      flex-shrink: 0; text-decoration: none;
      position: relative; z-index: 10;
      display: block;
      -webkit-tap-highlight-color: transparent;
    }
    .small-photo { pointer-events: none; }
    /* Avatar ring wrap */
    .small-photo {
      width: 38px;
      height: 38px;
      object-fit: cover;
      object-position: center;
      border-radius: 50%;
      display: block;
      transition: filter 0.15s;
    }
    .small-photo:hover { filter: brightness(0.9); }
    .post-meta { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
    .post-location { font-size: 11px; color: var(--text3); display:flex; align-items:center; gap:2px; }
    .post-author-link { display: flex; align-items: center; gap: 4px; text-decoration: none; cursor: pointer; width: fit-content; }
    .post-author-link:hover .jerry { text-decoration: none; }
    .jerry { font-weight: 600; font-size: 15px; font-family: 'Roboto', -apple-system, sans-serif; color: var(--text); margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    /* Consistent username weight across all pages */
    .detail-name, .profile-name, .original-card-name { font-weight: 600; }
    .verif { width: 15px; flex-shrink: 0; display: block; }
    .time { font-size: 12px; color: var(--text2); margin: 0; line-height: 1; }
    .time:hover { text-decoration: none; }
    .dots { display: flex; align-items: center; padding: 4px; flex-shrink: 0; margin-left: auto; }
    .dot { display: block; }

    .tir {
      padding: 10px 5px 8px;
    }
    .tired { width: 100%; font-size: 16px; white-space: pre-wrap; word-break: break-word; color: var(--text); }
    .reer { color: rgba(244,7,82,0.7); cursor: pointer; }

    .laptop1 { max-width: 100%; margin-top: 10px; padding: 0; overflow: hidden; border-radius: 14px; background: #f4f3f0; max-height: 400px; display: flex; align-items: center; justify-content: center; }
    .laptop { max-height: 400px; width: 100%; object-fit: contain; display: block; margin: 0; }

    /* Video */
    .video-container { position: relative; background: #000; border-radius: 12px; overflow: hidden; margin-top: 10px; }
    .video-thumbnail { width: 100%; display: block; max-height: 400px; }
    .video-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.15); }
    .play-button { display: flex; align-items: center; justify-content: center; }

    /* Stats row */
    .lefto {
      display: flex;
      flex-direction: row;
      gap: 10px;
      width: 100%;
      justify-content: space-between;
      align-items: center;
      margin-top: 10px;
      padding-bottom: 10px;
      border-bottom: 0.5px solid rgb(220,220,220);
    }
    .dick { display: flex; gap: 5px; margin-left: 10px; align-items: center; }
    .twits { display: flex; align-items: center; gap: 5px; margin-right: 10px; }
    .lefti { width: 15px; height: 15px; display: block; }
    .viewe { font-size: 13px; color: var(--text2); margin: 0; line-height: 1; }
    .werey { font-weight: 600; }
    .echoes-count { font-weight: 400; color: var(--text2); }
    .echoes-btn { cursor: pointer; transition: color 0.15s; }
    .echoes-btn:hover { color: #6C47FF; }
    .echoes-btn:hover .echoes-count { color: #6C47FF; }

    /* ── ECHOES PANEL ── */
    .echoes-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.45);
      z-index: 9000; display: flex; align-items: flex-end;
      opacity: 0; transition: opacity 0.25s ease;
      pointer-events: none;
    }
    .echoes-overlay.open { opacity: 1; pointer-events: all; }
    .echoes-sheet {
      width: 100%; max-height: 82vh; background: var(--bg);
      border-radius: 20px 20px 0 0; display: flex; flex-direction: column;
      transform: translateY(100%); transition: transform 0.3s cubic-bezier(.32,.72,0,1);
      overflow: hidden;
    }
    .echoes-overlay.open .echoes-sheet { transform: translateY(0); }
    .echoes-handle-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 18px 10px; border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .echoes-title { font-size: 16px; font-weight: 700; color: var(--text); }
    .echoes-close {
      width: 30px; height: 30px; border-radius: 50%; border: none;
      background: var(--bg2); cursor: pointer; display: flex;
      align-items: center; justify-content: center; color: var(--text);
      font-size: 16px; flex-shrink: 0;
    }
    .echoes-tabs {
      display: flex; border-bottom: 1px solid var(--border); flex-shrink: 0;
    }
    .echoes-tab {
      flex: 1; padding: 11px 8px; font-size: 14px; font-weight: 600;
      color: var(--text2); background: none; border: none; cursor: pointer;
      border-bottom: 3px solid transparent; transition: all 0.2s;
    }
    .echoes-tab.active { color: #6C47FF; border-bottom-color: #6C47FF; }
    .echoes-body {
      flex: 1; overflow-y: auto; padding: 0;
    }
    .echoes-empty {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; padding: 60px 20px; gap: 12px;
      color: var(--text2); font-size: 14px; text-align: center;
    }
    .echoes-empty-icon { font-size: 36px; opacity: 0.4; }
    .echo-item {
      display: flex; gap: 10px; padding: 14px 16px;
      border-bottom: 1px solid var(--border); cursor: pointer;
      transition: background 0.15s;
    }
    .echo-item:hover { background: var(--bg2); }
    .echo-avatar {
      width: 38px; height: 38px; border-radius: 50%;
      object-fit: cover; flex-shrink: 0;
      background: var(--bg2);
    }
    .echo-content { flex: 1; min-width: 0; }
    .echo-header { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
    .echo-username { font-weight: 600; font-size: 14px; color: var(--text); }
    .echo-time { font-size: 12px; color: var(--text2); }
    .echo-type-badge {
      font-size: 11px; font-weight: 600; padding: 2px 7px;
      border-radius: 20px; margin-left: auto; flex-shrink: 0;
    }
    .echo-type-repost { background: #f0eeff; color: #6C47FF; }
    .echo-type-reply  { background: #f0fdf4; color: #16a34a; }
    .echo-text { font-size: 16px; color: var(--text); line-height: 1.4; word-break: break-word; }
    .echo-stats { display: flex; gap: 14px; margin-top: 6px; }
    .echo-stat { font-size: 12px; color: var(--text2); display: flex; align-items: center; gap: 4px; }

    /* Reaction bar */
    .reaction {
      display: flex;
      justify-content: space-between;
      padding: 10px 10px 10px;
    }
    .reaction-container { width: 100%; display: flex; align-items: center; }
    .call { width: 100%; display: flex; justify-content: space-between; }
    .mee { display: flex; gap: 20px; align-items: center; }
    .feeling { width: 22px; }

    .comment-btn { display: flex; width: 55px; align-items: center; gap: 10px; cursor: pointer; font-size: 15px; font-family: 'Roboto', -apple-system, sans-serif; color: #000000; }
    .comment-btn:hover { color: var(--text); }

    .repost-btn { display: flex; width: 55px; align-items: center; gap: 10px; cursor: pointer; font-size: 15px; font-family: 'Roboto', -apple-system, sans-serif; color: #000000; }
    .repost-btn:hover { color: var(--text); }
    .repost-icon { transition: stroke 0.2s ease; }
    .repost-btn.reposted .repost-icon { stroke: #6C47FF; stroke-width: 2.5; }
    .repost-btn.reposted span { color: #6C47FF; font-weight: 600; }

    .heart-ai { width: 55px; gap: 10px; display: flex; align-items: center; cursor: pointer; }
    .heart-clickable { cursor: pointer; }
    .heart-icon { transition: all 0.3s ease; }
    .heart-path { fill: none; stroke: #000000; transition: fill 0.2s ease, stroke 0.2s ease; }
    .heart-ai[data-liked="true"] .heart-path { fill: rgb(244,7,82); stroke: rgb(244,7,82); }
    .prf-masonry-like[data-liked="true"] .heart-path { fill: rgb(244,7,82); stroke: rgb(244,7,82); }
    .cb-like-btn[data-liked="true"] .cb-heart-path { fill: rgb(244,7,82); stroke: rgb(244,7,82); }
    .like-count { font-size: 14px; font-family: 'Roboto', -apple-system, sans-serif; color: #000000; font-weight: 400; transition: color 0.15s, font-weight 0.15s; }
    .like-count.liked { color: rgb(244,7,82); font-weight: 600; }
    .like-count:empty { display: none; }

    @keyframes heartLike {
      0%   { transform: scale(1); }
      40%  { transform: scale(1.5); }
      70%  { transform: scale(1.2); }
      100% { transform: scale(1); }
    }
    @keyframes heartUnlike {
      0%   { transform: scale(1); }
      35%  { transform: scale(0.65); }
      70%  { transform: scale(1.1); }
      100% { transform: scale(1); }
    }
    .heart-anim-like   { animation: heartLike   0.35s cubic-bezier(0.34,1.56,0.64,1) forwards; }
    .heart-anim-unlike { animation: heartUnlike 0.3s  cubic-bezier(0.34,1.56,0.64,1) forwards; }

    .donate-btn { display: flex; align-items: center; cursor: pointer; }
    .donate-btn img { width: 22px; opacity: 0.7; }
    .donate-btn:hover img { opacity: 1; }

    /* Repost card inside feed */
    .repost-commentary .tir { padding-bottom: 2px; } /* quote-card CSS in style.css */

    /* Post action menu */
    .post-action-bar {
      position: absolute;
      bottom: 20%;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(255,255,255,0.94);
      backdrop-filter: blur(20px);
      border-radius: 14px;
      padding: 6px 8px;
      display: flex;
      align-items: center;
      gap: 10px;
      width: fit-content;
      height: auto;
      z-index: 10;
      box-shadow: 0 10px 30px rgba(0,0,0,0.4);
      border: 1px solid rgba(255,255,255,0.08);
    }
    @keyframes slideUpFromBottom {
      0%   { transform: translateX(-50%) translateY(40px); opacity: 0; scale: 0.92; }
      60%  { transform: translateX(-50%) translateY(-6px); opacity: 1; scale: 1.04; }
      100% { transform: translateX(-50%) translateY(0);   opacity: 1; scale: 1; }
    }
    @keyframes slideOutFromBottom {
      0%   { transform: translateX(-50%) translateY(0);    opacity: 1; scale: 1; }
      100% { transform: translateX(-50%) translateY(34px); opacity: 0; scale: 0.94; }
    }
  `;
  document.head.appendChild(style);
}

function expandText(el, fullText) {
  el.innerHTML = escHtml(fullText);
}

function skeletonPost() {
  return `<div class="skeleton-post">
    <div class="sk-header">
      <div class="sk-circle loading-pulse"></div>
      <div style="flex:1">
        <div class="sk-line loading-pulse" style="width:45%"></div>
        <div class="sk-line loading-pulse" style="width:25%"></div>
      </div>
    </div>
    <div style="padding:0 0 0 53px">
      <div class="sk-line loading-pulse" style="width:100%"></div>
      <div class="sk-line loading-pulse" style="width:80%"></div>
      <div class="sk-line loading-pulse" style="width:60%"></div>
    </div>
  </div>`;
}

// ── INTERSECTION OBSERVER (infinite scroll only) ──
let scrollObserver;
function initIntersectionObserver() {
  scrollObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      if (entry.target.id === 'feed-load-trigger') loadFeed();
    });
  }, { threshold: 0.1 });

  const trigger = document.getElementById('feed-load-trigger');
  if (trigger) scrollObserver.observe(trigger);
}

// ── VIEW TRACKING (separate observer) ──
let _viewObserver = null;

function getViewObserver() {
  if (_viewObserver) return _viewObserver;
  _viewObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const el = entry.target;
      const postId = el.dataset.postId;
      if (!postId) return;
      if (entry.isIntersecting) {
        if (el.dataset.viewTracked === 'true') return;
        el._viewTimer = setTimeout(async () => {
          if (!document.contains(el)) return;
          await recordView(postId);
          await syncViewCount(postId);
        }, 1000);
      } else {
        if (el._viewTimer) {
          clearTimeout(el._viewTimer);
          el._viewTimer = null;
          el.dataset.viewTracked = 'false';
        }
      }
    });
  }, { threshold: 0.6 });
  return _viewObserver;
}

function observePost(el) {
  if (el && el.dataset.postId) getViewObserver().observe(el);
}

// ── Debug: find duplicate TOP-LEVEL post elements within feed-list ──
function debugFindDuplicatePosts() {
  const feedList = document.getElementById('feed-list');
  if (!feedList) return;
  // Only check direct .poster children — not child elements that also have data-post-id
  const all = feedList.querySelectorAll(':scope > .poster[data-post-id]');
  const seen = {};
  let dupes = 0;
  all.forEach(el => {
    const id = el.dataset.postId;
    if (!id) return;
    if (seen[id]) {
      dupes++;
      console.error('[DUPLICATE IN FEED]', id,
        'owner1:', seen[id].querySelector('.jerry')?.textContent,
        'owner2:', el.querySelector('.jerry')?.textContent
      );
    }
    seen[id] = el;
  });
  if (dupes === 0) console.log('[NO DUPLICATES IN FEED] Feed is clean');
  else console.warn('[FOUND ' + dupes + ' REAL DUPLICATE(S) IN FEED]');
}

function reObserveAllFeedPosts() {
  document.querySelectorAll('.poster[data-post-id]').forEach(el => {
    if (el.dataset.viewTracked !== 'true') getViewObserver().observe(el);
  });
}

async function syncViewCount(postId) {
  if (!postId) return;
  try {
    const { data, error } = await supabase
      .from('posts').select('views').eq('id', postId).single();
    if (error || !data) return;
    const count = data.views ?? 0;
    document.querySelectorAll(`.poster[data-post-id="${postId}"] .twits .viewe`)
      .forEach(el => { el.textContent = `${fmtNum(count) || 0} views`; });
    if (detailPostId === postId) {
      const el = document.querySelector(`.detail-stat-n[data-type="views"]`);
      if (el) animateCount(el, count);
    }
  } catch (err) {
    console.warn('syncViewCount error:', err.message);
  }
}

// ══════════════════════════════════════════
// LIKES
// ══════════════════════════════════════════

async function checkLikedPosts(postIds) {
  if (!currentUser || !postIds.length) return;
  const { data } = await supabase
    .from('likes').select('post_id').eq('user_id', currentUser.id).in('post_id', postIds);
  (data || []).forEach(r => likedPosts.add(r.post_id));
  postIds.forEach(id => {
    if (likedPosts.has(id)) setLikeUI(id, true, null);
    else setLikeUI(id, false, null);
  });
}

async function checkRepostedPosts(postIds) {
  if (!currentUser || !postIds.length) return;
  // Find any of the current user's reposts where the original is in our postIds
  const { data } = await supabase
    .from('posts')
    .select('id, reposted_post_id')
    .eq('user_id', currentUser.id)
    .not('reposted_post_id', 'is', null)
    .in('reposted_post_id', postIds);

  (data || []).forEach(r => {
    repostedPosts.set(r.reposted_post_id, r.id);
  });

  // Apply bold state to all matching buttons in DOM
  postIds.forEach(id => {
    if (repostedPosts.has(id)) setRepostUI(id, true);
  });
}


// ── Universal heart animation — call with any SVG element ──
function animateHeart(svg, toLike) {
  if (!svg) return;
  svg.style.transition = 'none';
  svg.style.transform = 'scale(1)';
  void svg.offsetWidth; // force reflow
  if (toLike) {
    svg.style.transition = 'transform 0.12s ease-out';
    svg.style.transform = 'scale(1.5)';
    setTimeout(() => {
      svg.style.transition = 'transform 0.1s ease-in';
      svg.style.transform = 'scale(0.88)';
      setTimeout(() => {
        svg.style.transition = 'transform 0.08s ease-out';
        svg.style.transform = 'scale(1)';
      }, 100);
    }, 120);
  } else {
    svg.style.transition = 'transform 0.1s ease-in';
    svg.style.transform = 'scale(0.65)';
    setTimeout(() => {
      svg.style.transition = 'transform 0.15s cubic-bezier(0.34,1.56,0.64,1)';
      svg.style.transform = 'scale(1)';
    }, 100);
  }
}

/* ═══════════════════════════════════════════════════════════
   LIKE MANAGER — Twitter-style robust like system
   • In-memory truth (never reads count from DOM)
   • Debounced queue per post (rapid taps collapse to 1 request)
   • Retry with exponential backoff on network failure (up to 3×)
   • Works offline-first — UI updates instantly, syncs when possible
   • Single source of truth across ALL surfaces:
     feed, detail page, profile masonry, image tab, explore
═══════════════════════════════════════════════════════════ */
const LikeManager = (() => {
  // In-memory state: postId → { count: number, liked: boolean }
  const _state    = new Map();
  // Per-post debounce timers (rapid taps collapse into one request)
  const _timers   = new Map();
  // Per-post in-flight flag (prevents overlapping DB requests)
  const _inflight = new Map();

  const RED = 'rgb(244,7,82)';

  // ── Called when a post is first rendered — seeds the state ──
  function seed(postId, count, liked) {
    // Only seed once; don't overwrite if user already tapped
    if (!_state.has(postId)) {
      _state.set(postId, { count: Math.max(0, count || 0), liked: !!liked });
    }
  }

  // ── Get state (creates a default if post not yet seeded) ────
  function get(postId) {
    if (!_state.has(postId)) _state.set(postId, { count: 0, liked: false });
    return _state.get(postId);
  }

  // ── Called by every like button on every surface ─────────────
  function toggle(postId, btn) {
    if (!currentUser) { showToast('Sign in to like'); return; }

    const s = get(postId);
    s.liked = !s.liked;
    s.count = s.liked ? s.count + 1 : Math.max(0, s.count - 1);

    // Keep global likedPosts set in sync (used by other parts of the app)
    if (s.liked) likedPosts.add(postId); else likedPosts.delete(postId);

    // Instant UI on ALL surfaces — never waits for network
    _updateAllUI(postId, s.liked, s.count);

    // Animate the specific button that was tapped
    if (btn) animateHeart(btn.querySelector('svg'), s.liked);
    // Also animate feed hearts and cb heart if visible
    document.querySelectorAll(`.heart-ai[data-post-id="${postId}"]`).forEach(c => {
      if (c !== btn) animateHeart(c.querySelector('svg'), s.liked);
    });
    const cbBtn = document.getElementById('cb-like-btn');
    if (cbBtn && cbBtn !== btn && cbBtn.dataset.postId === postId) {
      animateHeart(cbBtn.querySelector('svg'), s.liked);
    }

    // Debounce: cancel previous pending request, schedule a new one after 300ms.
    // This means like→unlike→like within 300ms = only ONE "like" request sent.
    if (_timers.has(postId)) clearTimeout(_timers.get(postId));
    const snapshot = { liked: s.liked, count: s.count };
    _timers.set(postId, setTimeout(() => {
      _timers.delete(postId);
      _commit(postId, snapshot.liked, snapshot.count);
    }, 300));
  }

  // ── Commit the final state to Supabase, with retry ─────────
  async function _commit(postId, liked, optimisticCount, attempt = 0) {
    // Wait if another request for this post is still running
    if (_inflight.get(postId)) {
      setTimeout(() => _commit(postId, liked, optimisticCount, attempt), 400);
      return;
    }
    _inflight.set(postId, true);

    try {
      if (liked) {
        const { error } = await supabase.from('likes')
          .insert({ post_id: postId, user_id: currentUser.id });
        // 23505 = unique violation = already liked = that's fine
        if (error && error.code !== '23505') throw error;
        // Fire-and-forget notification
        supabase.from('posts').select('user_id').eq('id', postId).single()
          .then(({ data: post }) => {
            if (post && post.user_id !== currentUser.id) {
              insertNotification({ user_id: post.user_id, actor_id: currentUser.id,
                                   post_id: postId, type: 'like' });
            }
          });
      } else {
        await supabase.from('likes').delete()
          .eq('post_id', postId).eq('user_id', currentUser.id);
      }
      _inflight.set(postId, false);

      // Reconcile: quietly fetch the real server count, but only apply it
      // if the user hasn't tapped again while the request was in-flight.
      supabase.from('posts').select('like_count').eq('id', postId).single()
        .then(({ data }) => {
          if (!data) return;
          // Skip if a new tap is pending or another request is running
          if (_timers.has(postId) || _inflight.get(postId)) return;
          const s = get(postId);
          // Only accept server value if the liked state hasn't changed
          if (s.liked === liked) {
            s.count = Math.max(0, data.like_count);
            _updateAllUI(postId, s.liked, s.count);
          }
        });

    } catch (e) {
      _inflight.set(postId, false);
      if (attempt < 3) {
        // Retry with exponential backoff: 1s → 2s → 4s
        setTimeout(() => _commit(postId, liked, optimisticCount, attempt + 1),
                   1000 * Math.pow(2, attempt));
      } else {
        // All retries exhausted — revert UI to what it was before the tap
        const s = get(postId);
        s.liked  = !liked;
        s.count  = Math.max(0, optimisticCount + (liked ? -1 : 1));
        if (s.liked) likedPosts.add(postId); else likedPosts.delete(postId);
        _updateAllUI(postId, s.liked, s.count);
        showToast('Like failed — check your connection');
      }
    }
  }

  // ── Update every surface that shows this post's like state ─
  function _updateAllUI(postId, liked, count) {
    const countTxt = count > 0 ? fmtNum(count) : '';

    // 1. Feed cards (.heart-ai) — also covers explore/discover feed
    document.querySelectorAll(`.heart-ai[data-post-id="${postId}"]`).forEach(container => {
      container.dataset.liked = liked ? 'true' : 'false';
      const path = container.querySelector('.heart-path');
      if (path) {
        path.setAttribute('fill', liked ? RED : 'none');
        path.setAttribute('stroke', liked ? RED : '#000000');
      }
      const countEl = container.querySelector('.like-count');
      if (countEl) {
        countEl.textContent = countTxt;
        countEl.classList.toggle('liked', liked);
      }
    });

    // 2. Detail page comment-bar heart + count
    const cbLike = document.getElementById('cb-like-btn');
    if (cbLike && cbLike.dataset.postId === postId) {
      cbLike.dataset.liked  = liked ? 'true' : 'false';
      cbLike.dataset.count  = count;  // authoritative — never stale
      cbLike.classList.toggle('cb-liked', liked);
      const cbPath = cbLike.querySelector('.cb-heart-path');
      if (cbPath) {
        cbPath.setAttribute('fill', liked ? RED : 'none');
        cbPath.setAttribute('stroke', liked ? RED : '#000000');
      }
      const cbCount = document.getElementById('cb-like-count');
      if (cbCount) {
        cbCount.textContent = countTxt;
        cbCount.classList.toggle('liked', liked);
      }
    }

    // 3. Detail stat bar (large like count above action row)
    const statEl = document.querySelector(`.detail-stat-n[data-type="likes"]`);
    if (statEl && typeof detailPostId !== 'undefined' && detailPostId === postId) {
      statEl.textContent = fmtNum(count);
    }

    // 4. Profile masonry tiles (Posts tab, Image tab, Liked tab)
    document.querySelectorAll(`.prf-masonry-like[data-post-id="${postId}"]`).forEach(btn => {
      btn.classList.toggle('liked', liked);
      btn.dataset.liked = liked ? 'true' : 'false';
      const mCount = btn.querySelector('.prf-masonry-like-count');
      if (mCount) mCount.textContent = countTxt;
    });
  }

  // ── Called by realtime subscriptions or external DB syncs ──
  function syncCount(postId, serverCount) {
    // Ignore if a tap is pending or a request is in-flight — our state is ahead
    if (_timers.has(postId) || _inflight.get(postId)) return;
    const s = get(postId);
    s.count = Math.max(0, serverCount);
    _updateAllUI(postId, s.liked, s.count);
  }

  return { seed, get, toggle, syncCount, _updateAllUI };
})();

// ── Shims: keep every existing call-site working unchanged ─────
function toggleLike(postId, btn)        { LikeManager.toggle(postId, btn); }
function syncLikeCount(postId, count)   { LikeManager.syncCount(postId, count); }
function setLikeUI(postId, liked, count) {
  const s = LikeManager.get(postId);
  if (liked !== null && liked !== undefined) s.liked = liked;
  if (count !== null && count !== undefined) s.count = Math.max(0, count);
  LikeManager._updateAllUI(postId, s.liked, s.count);
}

// ══════════════════════════════════════════
// REPOSTS
// ══════════════════════════════════════════

function setRepostUI(postId, reposted) {
  document.querySelectorAll(`.repost-btn[data-post-id="${postId}"]`).forEach(btn => {
    btn.dataset.reposted = reposted ? 'true' : 'false';
    btn.classList.toggle('reposted', reposted);
    const svg = btn.querySelector('.repost-icon');
    if (svg) {
      svg.setAttribute('stroke', reposted ? '#6C47FF' : '#000000');
      svg.setAttribute('stroke-width', reposted ? '2.5' : '2');
    }
    const span = btn.querySelector('span');
    if (span) span.classList.toggle('reposted', reposted);
  });
  // Detail page repost button
  document.querySelectorAll(`.dp-repost-btn[data-post-id="${postId}"], .detail-action.repost-action[data-post-id="${postId}"]`).forEach(btn => {
    btn.dataset.reposted = reposted ? 'true' : 'false';
    btn.classList.toggle('reposted', reposted);
    btn.classList.toggle('dp-reposted', reposted);
    const svg = btn.querySelector('.dp-repost-svg, .repost-icon');
    if (svg) {
      svg.setAttribute('stroke', reposted ? '#6C47FF' : 'currentColor');
      svg.setAttribute('stroke-width', reposted ? '2.5' : '2.2');
    }
  });
  // Sync comment bar repost button
  const cbRepost = document.getElementById('cb-repost-btn');
  if (cbRepost && cbRepost.dataset.postId === postId) {
    cbRepost.dataset.reposted = reposted ? 'true' : 'false';
    cbRepost.classList.toggle('cb-reposted', reposted);
    const cbSvg = cbRepost.querySelector('.cb-repost-svg');
    if (cbSvg) { cbSvg.setAttribute('stroke', reposted ? '#6C47FF' : 'currentColor'); cbSvg.setAttribute('stroke-width', reposted ? '2.5' : '2'); }
  }
}

async function syncRepostCount(postId) {
  if (!postId) return;
  try {
    const { data, error } = await supabase
      .from('posts').select('repost_count').eq('id', postId).single();
    if (error || !data) return;
    const count = data.repost_count ?? 0;

    // Feed cards
    document.querySelectorAll(`.repost-btn[data-post-id="${postId}"] span`)
      .forEach(sp => { sp.textContent = count > 0 ? fmtNum(count) : ''; });

    // Detail page stat
    document.querySelectorAll('.repost-count-display')
      .forEach(el => { if (detailPostId === postId) animateCount(el, count); });
  } catch (err) {
    console.warn('syncRepostCount error:', err.message);
  }
}


async function getMyRepostOfPost(originalPostId) {
  if (!currentUser) return null;
  const { data, error } = await supabase
    .from('posts')
    .select('id')
    .eq('user_id', currentUser.id)
    .eq('reposted_post_id', originalPostId)
    .maybeSingle();
  if (error) { console.error('getMyRepostOfPost failed:', error.message); return null; }
  return data?.id || null;
}

async function handleRepost(postId, btn, postUserId) {
  if (!currentUser) { showToast('Sign in to repost'); return; }
  if (postUserId && postUserId === currentUser.id) { showToast("You can't repost your own post"); return; }
  const alreadyReposted = btn?.dataset.reposted === 'true';

  if (alreadyReposted) {
    showActionSheet([
      { label: 'Undo Repost', icon: '🔄', action: () => undoRepost(postId, btn) },
    ]);
  } else {
    // Open composer in repost mode
    repostTargetId = postId;
    repostTargetBtn = btn;

    const { data: orig } = await supabase.from('posts')
      .select(`id,content,image,user_id,user:users(username,avatar)`)
      .eq('id', postId).single();

    openComposer();

    if (orig) {
      const preview = document.getElementById('composer-repost-preview');
      preview.innerHTML = `<div class="composer-repost-card">
        <div class="composer-repost-label">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#6C47FF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
          Reposting from ${escHtml(orig.user?.username || '')}
        </div>
        ${orig.content ? `<p class="composer-repost-text">${escHtml(orig.content.slice(0,100))}${orig.content.length>100?'…':''}</p>` : ''}
        <button class="composer-repost-remove" onclick="clearRepost()">×</button>
      </div>`;
      updateComposerBtn();
    }
  }
}

function clearRepost() {
  repostTargetId = null; repostTargetBtn = null;
  const preview = document.getElementById('composer-repost-preview');
  if (preview) preview.innerHTML = '';
  updateComposerBtn();
}

async function undoRepost(postId, btn) {
  // Optimistic UI immediately
  setRepostUI(postId, false);

  try {
    // Always query DB directly — don't rely on Map which resets on refresh
    const myRepostId = repostedPosts.get(postId) || await getMyRepostOfPost(postId);
    if (!myRepostId) {
      setRepostUI(postId, false);
      showToast('Repost removed');
      return;
    }

    const { error: deleteError } = await supabase
      .from('posts').delete()
      .eq('id', myRepostId)
      .eq('user_id', currentUser.id);

    if (deleteError) throw deleteError;

    // NOTE: No manual decrement here — the DB trigger handles it automatically
    // calling decrement_repost_count manually too would double-decrement the count
    repostedPosts.delete(postId);

    // Wait briefly for trigger to fire before fetching real count
    await new Promise(resolve => setTimeout(resolve, 500));

    const { data: updated } = await supabase
      .from('posts').select('repost_count').eq('id', postId).single();
    const newCount = updated?.repost_count ?? 0;

    document.querySelectorAll(`.repost-btn[data-post-id="${postId}"] span`)
      .forEach(sp => { sp.textContent = newCount > 0 ? fmtNum(newCount) : ''; });
    document.querySelectorAll('.repost-count-display')
      .forEach(el => { if (detailPostId === postId) el.textContent = newCount; });

    // Remove repost card from feed
    document.querySelector(`.poster[data-post-id="${myRepostId}"]`)?.remove();

    showToast('Repost removed');
  } catch (err) {
    console.error('undoRepost failed:', err.message);
    setRepostUI(postId, true);
    showToast("Couldn't remove repost. Try again.");
  }
}

// ══════════════════════════════════════════
// COMPOSER
// ══════════════════════════════════════════

// ══════════════════════════════════════════
// COMPOSER — clean rewrite
// ══════════════════════════════════════════

function openComposer() {
  const overlay  = document.getElementById('composer-overlay');
  const sheet    = document.getElementById('composer-sheet');
  const previews = document.getElementById('composer-previews');

  overlay.classList.remove('hidden');

  if (currentProfile?.avatar) {
    document.getElementById('composer-avatar').src = currentProfile.avatar;
  }

  requestAnimationFrame(() => {
    sheet.classList.add('open');
    const composerTA = document.getElementById('composer-textarea');
    composerTA.focus();
    composerTA._mentionWired = false; // reset so it re-wires fresh
    wireMentionInput(composerTA, null);
  });

  // Visual Viewport: shrink sheet height when keyboard appears
  // The sheet stays anchored at the bottom, previews area shrinks, textarea stays visible
  function onVP() {
    const vv = window.visualViewport;
    if (!vv) return;
    const vvHeight = vv.height;
    // Cap sheet at viewport height so it sits just above keyboard
    sheet.style.maxHeight = vvHeight * 0.95 + 'px';
    // Scroll previews to bottom so latest content stays visible
    if (previews) previews.scrollTop = previews.scrollHeight;
  }

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onVP);
    overlay._vp = onVP;
  }
}

function closeComposer(instant = false) {
  const overlay = document.getElementById('composer-overlay');
  const sheet   = document.getElementById('composer-sheet');

  if (overlay._vp && window.visualViewport) {
    window.visualViewport.removeEventListener('resize', overlay._vp);
    overlay._vp = null;
  }

  sheet.style.maxHeight = '';

  if (instant) {
    sheet.style.transition = 'none';
    overlay.style.transition = 'none';
  }
  sheet.classList.remove('open');

  const cleanup = () => {
    overlay.classList.add('hidden');
    sheet.style.transition = '';
    overlay.style.transition = '';
    const ta = document.getElementById('composer-textarea');
    if (ta) { ta.value = ''; ta.style.height = ''; }
    document.getElementById('composer-media-preview').innerHTML = '';
    document.getElementById('composer-repost-preview').innerHTML = '';
    selectedFile = null;
    repostTargetId = null;
    repostTargetBtn = null;
    updateComposerBtn();
  };

  instant ? cleanup() : setTimeout(cleanup, 350);
}

function initComposerFile() {
  const fileInput = document.getElementById('composer-file');
  if (!fileInput) return;

  fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('Images only'); return; }

    if (file.size > 2 * 1024 * 1024) {
      showToast('Image must be under 2MB');
      fileInput.value = '';
      return;
    }

    selectedFile = file;
    updateComposerBtn();

    const preview = document.getElementById('composer-media-preview');

    const reader = new FileReader();
    reader.onload = ev => {
      preview.innerHTML = `
        <div class="media-preview-item">
          <img src="${ev.target.result}" alt="" style="max-height:220px;width:100%;object-fit:cover;border-radius:12px;">
          <button class="media-preview-remove" onclick="removeMedia()">×</button>
        </div>`;
    };
    reader.onerror = () => {
      preview.innerHTML = `<div style="padding:12px;color:var(--text3);font-size:13px">📷 Image ready to post</div>`;
    };
    reader.readAsDataURL(file);
  });

  const ta = document.getElementById('composer-textarea');
  ta?.addEventListener('input', () => {
    updateComposerBtn();
    updateCharCount(ta.value.length);
    // Auto-grow textarea up to max-height defined in CSS
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  });
}

function removeMedia() {
  selectedFile = null;
  document.getElementById('composer-media-preview').innerHTML = '';
  document.getElementById('composer-file').value = '';
  updateComposerBtn();
}

function updateComposerBtn() {
  const ta  = document.getElementById('composer-textarea');
  const btn = document.getElementById('composer-post-btn');
  const hasText   = ta?.value?.trim().length > 0;
  const hasMedia  = !!selectedFile;
  const hasRepost = !!repostTargetId;
  if (btn) btn.disabled = !(hasText || hasMedia || hasRepost);
}

function updateCharCount(len) {
  const el = document.getElementById('composer-char-count');
  if (!el) return;
  const rem = MAX_CHARS - len;
  el.textContent = rem;
  el.className = 'composer-char-count' + (rem < 20 ? ' critical' : rem < 60 ? ' low' : '');
}

function insertEmoji() { showToast('Emoji picker coming soon!'); }

// ══════════════════════════════════════════
// EMOJI & STICKER PICKER
// ══════════════════════════════════════════

let stickerPickerContext = null; // 'dm' or 'comment'


// Common emojis grouped
const EMOJI_LIST = [
  '😀','😂','🥹','😍','🥰','😘','😎','🤩','😭','😤',
  '🙏','👏','🔥','❤️','💜','💯','✨','🎉','👀','😏',
  '🤣','😅','😬','🫡','🫶','💪','👍','👎','🤝','🙌',
  '😴','🤔','🤯','😱','🥳','🤗','😇','😈','💀','👻',
  '🍔','🍕','🌮','🍜','🍣','🍦','🎂','🥂','🍻','☕',
  '💰','🛍️','📦','🚀','🌍','🏆','🎯','💡','📱','💻',
];

// Milk & Mocha sticker pack — fetched via Telegram Bot API proxy



function openStickerPicker(context) {
  stickerPickerContext = context;
  const picker = document.getElementById('sticker-picker');
  if (!picker) return;

  // Position above the triggering button
  const btnId = context === 'dm' ? 'dm-emoji-btn' : 'comment-emoji-btn';
  const btn = document.getElementById(btnId);
  if (btn) {
    const rect = btn.getBoundingClientRect();
    picker.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
  }

  picker.classList.toggle('hidden');

  if (!picker.classList.contains('hidden')) {
    // Populate emoji grid if empty
    const grid = document.getElementById('sp-emoji-grid');
    if (grid && !grid.children.length) {
      EMOJI_LIST.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'emoji-btn';
        btn.textContent = emoji;
        btn.onclick = () => insertEmojiOrSticker(emoji, 'emoji');
        grid.appendChild(btn);
      });
    }
    // Close when tapping outside
    setTimeout(() => {
      document.addEventListener('click', closeStickerPickerOutside, { once: true });
    }, 50);
  }
}

function closeStickerPickerOutside(e) {
  const picker = document.getElementById('sticker-picker');
  if (picker && !picker.contains(e.target)) {
    picker.classList.add('hidden');
  } else if (picker && !picker.classList.contains('hidden')) {
    document.addEventListener('click', closeStickerPickerOutside, { once: true });
  }
}





function insertEmojiOrSticker(value, type, stickerData) {
  const picker = document.getElementById('sticker-picker');
  picker?.classList.add('hidden');

  if (type === 'emoji') {
    // Insert emoji into active input
    if (stickerPickerContext === 'dm') {
      const field = document.getElementById('chat-input-field');
      if (field) {
        const pos = field.selectionStart || field.value.length;
        field.value = field.value.slice(0, pos) + value + field.value.slice(pos);
        field.setSelectionRange(pos + value.length, pos + value.length);
        field.focus();
        field.dispatchEvent(new Event('input'));
      }
    } else {
      const field = document.getElementById('comment-input');
      if (field) {
        const pos = field.selectionStart || field.value.length;
        field.value = field.value.slice(0, pos) + value + field.value.slice(pos);
        field.setSelectionRange(pos + value.length, pos + value.length);
        field.focus();
        field.dispatchEvent(new Event('input'));
      }
    }
  } else if (type === 'sticker') {
    // Send sticker directly
    if (stickerPickerContext === 'dm') {
      chatSendSticker(value);
    } else {
      submitCommentSticker(value);
    }
  }
}

// ── Feed prepend ──
// FIXED VERSION — removes empty state when first post arrives
function prependPostToFeed(newPost) {
  if (!newPost) return;

  const adapted = { ...newPost, comments: [{ count: 0 }] };
  const el = createFeedPost(adapted);
  const list = document.getElementById('feed-list');
  if (!list || !el) return;

  // ←←← THIS IS THE FIX
  // Remove any existing empty-state message
  const emptyState = list.querySelector('.empty-state');
  if (emptyState) {
    emptyState.remove();
  }

  // Reset exhausted flag now that we have content
  feedExhausted = false;

  // Prepend the new post
  list.prepend(el);
  loadedPostIds.add(newPost.id);
  el.classList.add('fade-up');
  observePost(el);

  // Rest of your original code (notifications, repost handling, etc.)
  if (newPost.reposted_post_id) {
    repostedPosts.set(newPost.reposted_post_id, newPost.id);
    setRepostUI(newPost.reposted_post_id, true);
    setTimeout(() => syncRepostCount(newPost.reposted_post_id), 1200);
    supabase.from('posts').select('user_id').eq('id', newPost.reposted_post_id).single().then(({ data: orig }) => {
      if (orig && orig.user_id !== currentUser.id) {
        insertNotification({ user_id: orig.user_id, actor_id: currentUser.id, post_id: newPost.reposted_post_id, type: 'repost' });
      }
    });
  }

  if (document.getElementById('page-profile')?.classList.contains('active')) {
    renderMyProfile();
  }

  // Mention notifications
  if (newPost.content) {
    const mentionMatches = newPost.content.match(/@([a-zA-Z0-9_]+)/g);
    if (mentionMatches) {
      const mentioned = [...new Set(mentionMatches.map(m => m.slice(1).toLowerCase()))];
      supabase.from('users').select('id,username').in('username', mentioned).then(({ data: users }) => {
        (users || []).forEach(u => {
          if (u.id !== currentUser.id) {
            insertNotification({ user_id: u.id, actor_id: currentUser.id, post_id: newPost.id, type: 'mention' });
          }
        });
      });
    }
  }
}

// ── Image → JPEG blob via canvas, with FileReader fallback ──
// ── Upload: compress → retry loop → return public URL ──
async function uploadToStorage(file, onProgress) {
  onProgress(5);

  // No compression — upload raw file directly
  const blob = file;
  onProgress(25);

  const path = `${currentUser.id}_${Date.now()}_${Math.random().toString(36).slice(2,7)}.jpg`;
  const bucket = 'post-images';

  // Retry up to 4 times with exponential backoff — built for bad networks
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      onProgress(25 + attempt * 14); // 39 / 53 / 67 / 81

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 45000); // 45s per attempt

      const { error } = await supabase.storage
        .from(bucket)
        .upload(path, blob, { upsert: true, contentType: 'image/jpeg' });

      clearTimeout(timer);
      if (error) throw error;

      onProgress(90);
      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      onProgress(100);
      return data.publicUrl;

    } catch (err) {
      if (attempt === 4) throw err;
      // Wait before retry: 2s, 4s, 8s
      await new Promise(r => setTimeout(r, attempt * 2000));
    }
  }
}

// ── Submit post ──
async function submitPost() {
  const ta      = document.getElementById('composer-textarea');
  const content = ta?.value?.trim() || '';
  const btn     = document.getElementById('composer-post-btn');

  if (!content && !selectedFile && !repostTargetId) return;
  if (!currentUser) { showToast('Please sign in'); return; }

  if (btn) btn.disabled = true;

  // Snapshot state before composer clears it
  const fileToUpload = selectedFile;
  const postContent  = content;
  const targetId     = repostTargetId;

  // Dismiss composer immediately
  closeComposer(true);

  // ── Text-only post (instant) ──
  if (!fileToUpload) {
    try {
      const { data: post, error } = await supabase.from('posts').insert({
        user_id: currentUser.id,
        content: postContent || null,
        image: null,
        reposted_post_id: targetId || null
      }).select(`
        id,content,image,video,created_at,like_count,repost_count,views,user_id,reposted_post_id,
        user:users(id,username,avatar,location),
        reposted_post:reposted_post_id(id,content,image,video,created_at,user_id,user:users(id,username,avatar,location))
      `).single();
      if (error) throw error;
      prependPostToFeed(post);

    } catch(e) {
      console.error('Repost error:', e);
      showToast('Repost failed — try again');
    }
    return;
  }

  // ── Image post — ring shows progress ──
  setComposeRing('uploading', 5);

  const doUpload = async () => {
    try {
      // 1. Upload image
      const imageUrl = await uploadToStorage(fileToUpload, pct => setComposeRing('uploading', pct));

      setComposeRing('uploading', 92);

      // 2. Insert post record
      const { data: post, error } = await supabase.from('posts').insert({
        user_id: currentUser.id,
        content: postContent || null,
        image: imageUrl,
        reposted_post_id: targetId || null
      }).select(`
        id,content,image,video,created_at,like_count,repost_count,views,user_id,reposted_post_id,
        user:users(id,username,avatar,location),
        reposted_post:reposted_post_id(id,content,image,video,created_at,user_id,user:users(id,username,avatar,location))
      `).single();

      if (error) throw error;

      // 3. Done
      setComposeRing('success');
      prependPostToFeed(post);
      uploadState.retryFn = null;

    } catch(e) {
      setComposeRing('failed');
      uploadState.retryFn = doUpload;
    }
  };

  doUpload(); // fire and forget — ring handles state
}

// ══════════════════════════════════════════
// POST DETAIL
// ══════════════════════════════════════════

async function openDetail(postId, scrollToComments = false) {
  if (!postId) return;
  detailPostId = postId;
  detailCommentParentId = null;
  pushRoute('/post/' + postId);

  // ── Inject styles once ──
  if (!document.getElementById('detail-styles')) {
    const s = document.createElement('style');
    s.id = 'detail-styles';
    s.textContent = `

      /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
         DETAIL PAGE
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
      #detail-body { padding-bottom: 160px; }

      /* ── Post wrapper ── */
      .dp-wrap { background: var(--bg); }

      /* ── Author row ── */
      .dp-author {
        display: flex; align-items: center; gap: 12px;
        padding: 16px 16px 0;
      }
      .dp-avatar-wrap {
        position: relative; flex-shrink: 0;
        width: 46px; height: 46px;
      }
      .dp-avatar-ring {
        position: absolute; inset: -2.5px; border-radius: 50%;
        background: linear-gradient(135deg, var(--accent), #a78bfa);
        z-index: 0; opacity: 0; transition: opacity 0.2s;
      }
      .dp-avatar-ring.live    { background: linear-gradient(135deg, var(--red), #ff8c42); animation: ringPulse 2s ease-in-out infinite; }
      .dp-avatar-ring.commerce { background: linear-gradient(135deg, var(--gold), #ff8c42); }
      .dp-avatar-ring.live_commerce { background: linear-gradient(135deg, var(--red), var(--gold)); animation: ringPulse 2s ease-in-out infinite; }
      .dp-avatar-wrap.has-moment .dp-avatar-ring { opacity: 1; }
      .dp-avatar {
        width: 46px; height: 46px; border-radius: 50%;
        object-fit: cover; object-position: top;
        cursor: pointer; position: relative; z-index: 1;
        border: 2px solid var(--bg);
        transition: opacity .15s;
      }
      .dp-avatar-wrap:not(.has-moment) .dp-avatar { border-color: var(--border, #e5e7eb); }
      .dp-avatar:active { opacity: .7; }
      .dp-author-info { flex: 1; min-width: 0; }
      .dp-location {
        font-size: 12px; color: var(--text3);
        display: flex; align-items: center; gap: 3px;
        margin-top: 2px;
      }
      .dp-name {
        font-size: 15px; font-weight: 600; color: var(--text);
        cursor: pointer; white-space: nowrap;
        max-width: 180px;
        line-height: 1.2;
      }
      .dp-name span { display: inline-block; }
      .dp-name:hover { text-decoration: none; }
      .dp-follow-btn {
        height: 32px; padding: 0 18px;
        border-radius: 20px; font-size: 13px; font-weight: 700;
        border: 1.5px solid #6C47FF;
        background: #6C47FF; color: #fff;
        cursor: pointer; transition: all .2s; flex-shrink: 0;
        letter-spacing: -.01em;
      }
      .dp-follow-btn.following,
      .dp-follow-btn.prf-btn-following {
        background: transparent; color: #6C47FF; border-color: #6C47FF;
      }
      .dp-follow-btn:active { transform: scale(.93); }

      /* ── Content text ── */
      .dp-text {
        font-size: 17px; line-height: 1.65; color: var(--text);
        padding: 14px 16px 4px; margin: 0;
        white-space: pre-wrap; word-break: break-word;
      }

      /* ── Media ── */
      .dp-media { margin: 12px 0 0; overflow: hidden; }
      .dp-media img {
        width: 100%; display: block;
        max-height: 500px; object-fit: contain;
        background: #000; cursor: zoom-in;
      }
      .dp-media .dp-video-wrap {
        position: relative; background: #000; cursor: pointer;
      }
      .dp-media video { width: 100%; display: block; max-height: 420px; }
      .dp-media .dp-play-overlay {
        position: absolute; inset: 0;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0,0,0,.18);
      }
      .dp-play-circle {
        width: 60px; height: 60px; border-radius: 50%;
        background: rgba(0,0,0,.6); backdrop-filter: blur(10px);
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 4px 20px rgba(0,0,0,.4);
      }

      /* ── Quoted / Repost card ── */
      .dp-quote-intro {
        font-size: 14px; color: var(--text2); padding: 12px 16px 0;
        display: flex; align-items: center; gap: 6px;
      }
      /* quote-card CSS lives in style.css */

      /* ── Full date ── */
      .dp-date {
        padding: 14px 16px 0;
        font-size: 14px; color: var(--text2);
        letter-spacing: -.01em;
      }
      .dp-date b { color: var(--text); font-weight: 600; }

      /* ── Stats bar ── */
      .dp-stats {
        display: flex; margin: 14px 0 0;
        border-top: 1px solid var(--border, #e5e7eb);
        border-bottom: 1px solid var(--border, #e5e7eb);
      }
      .dp-stat {
        flex: 1; display: flex; flex-direction: column;
        align-items: center; padding: 11px 4px; gap: 3px;
        position: relative;
      }
      .dp-stat + .dp-stat::before {
        content: ''; position: absolute; left: 0; top: 18%;
        height: 64%; width: 1px;
        background: var(--border, #e5e7eb);
      }
      .dp-stat-n {
        font-size: 17px; font-weight: 700; color: var(--text);
        line-height: 1; letter-spacing: -.02em;
      }
      .dp-stat-l {
        font-size: 10px; color: var(--text2);
        text-transform: uppercase; letter-spacing: .06em;
      }

      /* ── Action row ── */
      .dp-actions {
        display: flex; align-items: center;
        padding: 2px 6px;
        border-bottom: 1px solid var(--border, #e5e7eb);
      }
      .dp-action {
        flex: 1; display: flex; align-items: center; justify-content: center;
        gap: 6px; height: 46px; border-radius: 12px;
        font-size: 13px; font-weight: 600; color: var(--text2);
        background: transparent; border: none; cursor: pointer;
        transition: all .18s; -webkit-tap-highlight-color: transparent;
      }
      .dp-action:active { background: var(--bg2); transform: scale(.93); }
      .dp-action.dp-liked { color: rgb(244,7,82); }
      .dp-action.dp-liked .dp-heart-path { fill: rgb(244,7,82); stroke: rgb(244,7,82); }
      .dp-action.dp-reposted { color: #6C47FF; }
      .dp-action.dp-reposted .dp-repost-svg { stroke: #6C47FF; }
      .dp-heart-path { transition: all .25s ease; }

      /* ── Divider ── */
      .dp-divider {
        height: 8px;
        background: var(--bg2, #f3f4f6);
        border-top: 1px solid var(--border, #e5e7eb);
        border-bottom: 1px solid var(--border, #e5e7eb);
      }

      /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
         COMMENT BAR (fixed bottom)
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
      .comment-bar {
        display: none;
        position: fixed; bottom: 0; left: 0; right: 0;
        flex-direction: column;
        background: #f0f0f5;
        padding: 10px 14px;
        padding-bottom: calc(10px + env(safe-area-inset-bottom));
        z-index: 200;
        border-top: 1px solid rgba(0,0,0,0.08);
      }
      .comment-bar-input {
        width: 100%; border: none; outline: none;
        background: transparent; resize: none;
        font-size: 16px; line-height: 1.4;
        color: var(--text); font-family: inherit;
        max-height: 120px; margin-bottom: 10px;
      }
      .comment-bar-input::placeholder { color: #999; }
      .cb-actions {
        display: flex; align-items: center;
        justify-content: space-between;
      }
      .cb-left { display: flex; align-items: center; gap: 2px; }
      .cb-right { display: flex; align-items: center; gap: 2px; }
      .cb-action-btn {
        width: 40px; height: 40px; border-radius: 50%;
        border: none; background: transparent; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        color: #333; transition: all .15s;
        -webkit-tap-highlight-color: transparent; flex-shrink: 0;
      }
      .cb-action-btn:active { transform: scale(.85); }
      .cb-like-btn { display: flex; align-items: center; gap: 10px; width: auto; padding: 0 6px; border-radius: 20px; }
      .cb-like-count { font-size: 14px; font-weight: 400; color: #000000; transition: color 0.25s, font-weight 0.25s; }
      .cb-action-btn.cb-liked { color: rgb(244,7,82); }
      .cb-action-btn.cb-liked .cb-heart-path { fill: rgb(244,7,82); stroke: rgb(244,7,82); }
      .cb-action-btn.cb-liked .cb-like-count { color: rgb(244,7,82); font-weight: 600; }
      .cb-action-btn.cb-reposted { color: #6C47FF; }
      .cb-action-btn.cb-reposted .cb-repost-svg { stroke: #6C47FF; stroke-width: 2.5; }
      .cb-heart-path { transition: all .25s; }
      .cb-send-btn {
        width: 44px; height: 44px;
        background: #6C47FF; color: #fff; border-radius: 50%;
      }
      .cb-send-btn:disabled { opacity: .4; cursor: not-allowed; background: #6C47FF; }
      .cb-send-btn:not(:disabled):active { transform: scale(.88); }
    `;
    document.head.appendChild(s);
  }

  slideTo('detail', async () => {
    const body = document.getElementById('detail-body');
    body.innerHTML = `<div class="dp-wrap">${skeletonPost()}</div>`;

    // Clear stale header identity immediately — don't show previous post's author
    const _hdrIdentity = document.getElementById('dp-header-identity');
    const _hdrAvatar   = document.getElementById('dp-header-avatar');
    const _hdrUsername = document.getElementById('dp-header-username');
    if (_hdrIdentity) { _hdrIdentity.style.opacity = '0'; _hdrIdentity.style.pointerEvents = 'none'; }
    if (_hdrAvatar)   { _hdrAvatar.style.visibility = 'hidden'; _hdrAvatar.src = ''; }
    if (_hdrUsername) _hdrUsername.textContent = '';

    const { data: p, error } = await supabase
      .from('posts')
      .select(`id,content,image,video,created_at,like_count,repost_count,views,user_id,reposted_post_id,
               user:users(id,username,avatar,location),
               reposted_post:reposted_post_id(id,content,image,video,created_at,user_id,user:users(id,username,avatar,location))`)
      .eq('id', postId)
      .single();

    if (error || !p) {
      body.innerHTML = '<div class="empty-state"><p>Post not found</p></div>';
      return;
    }

    const user     = p.user || { username: '@unknown', avatar: '' };
    const isOwn    = currentUser && p.user_id === currentUser.id;
    const isLiked  = likedPosts.has(postId);

    // Pre-fetch follow state before render — eliminates the Follow→Following flash
    const isFollowingAuthor = (!isOwn && currentUser) ? await checkFollowState(p.user_id) : false;

    const isRepost = !!p.reposted_post_id && !!p.reposted_post;
    const orig     = isRepost ? p.reposted_post : null;
    const origUser = orig?.user || { username: '@unknown', avatar: '' };

    // ── Media ──
    let mediaHtml = '';
    if (p.image) {
      mediaHtml = `<div class="dp-media"><img src="${p.image}" alt="" onclick="openImageFS('${p.image}')"></div>`;
    } else if (p.video) {
      mediaHtml = `<div class="dp-media"><div class="dp-video-wrap" onclick="openVideoFS('${p.video}')"><video preload="metadata"><source src="${p.video}#t=0.5" type="video/mp4"></video><div class="dp-play-overlay"><div class="dp-play-circle"><svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M5 3l14 9L5 21V3z"/></svg></div></div></div></div>`;
    } else if (p.content) {
      // URL preview — same as feed
      const dpUrl = extractFirstUrl(p.content);
      if (dpUrl) {
        mediaHtml = `<div class="post-og-wrap" id="dp-og-${p.id}">
          <div class="post-og-shimmer">
            <div class="post-og-shimmer-img"></div>
            <div class="post-og-shimmer-body"><div></div><div></div></div>
          </div>
        </div>`;
        fetchOgPreview(dpUrl).then(og => {
          const wrap = document.getElementById(`dp-og-${p.id}`);
          if (!wrap) return;
          if (!og) { wrap.remove(); return; }
          wrap.innerHTML = buildPostOgCard(og, dpUrl);
        }).catch(() => document.getElementById(`dp-og-${p.id}`)?.remove());
      }
    }

    // ── Quoted card ──
    let quoteHtml = '';
    if (isRepost && orig) {
      quoteHtml = `
        <div class="quote-card" onclick="openDetail('${orig.id}')">
          <div class="quote-card-inner">
            <div class="quote-card-header">
              <img class="quote-card-avatar" src="${origUser.avatar||''}" onerror="this.style.display='none'">
              <span class="quote-card-name">${escHtml(origUser.username)}</span>
              <span class="quote-card-time">${timeSince(orig.created_at)}</span>
            </div>
            ${orig.content ? `<p class="quote-card-text">${escHtml(orig.content.slice(0,240))}${orig.content.length>240?'…':''}</p>` : ''}
          </div>
          ${orig.image ? `<img class="quote-card-img" src="${orig.image}" alt="">` : ''}
          ${orig.video && !orig.image ? `
            <div class="quote-card-video-wrap">
              <video class="quote-card-video" preload="metadata"><source src="${orig.video}" type="video/mp4"></video>
              <div class="quote-card-play"><svg width="36" height="36" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="22" fill="rgba(0,0,0,0.45)" stroke="white" stroke-width="2"/><path d="M32 24L20 31V17L32 24Z" fill="white"/></svg></div>
            </div>
          ` : ''}
        </div>`;
    }

    // ── Full timestamp (your original style: "8 May 2025 · 11:42 PM") ──
    const d = new Date(p.created_at);
    const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const dateStr = d.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });

    body.innerHTML = `
      <div class="dp-wrap">

        <!-- AUTHOR -->
        <div class="dp-author">
          ${getDpAvatarRing(p.user_id, user.avatar||'', isOwn)}
          <div class="dp-author-info">
            <div class="dp-name">
              <span onclick="${isOwn ? 'selfTap(this)' : `showUserProfile('${p.user_id}',this)`}">${escHtml(user.username)}</span>
            </div>
            ${user.location ? `<div class="dp-location"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>${escHtml(user.location)}</div>` : ''}
          </div>
          ${!isOwn
            ? `<button class="dp-follow-btn ${isFollowingAuthor ? 'prf-btn-following' : ''}" id="dp-follow-${postId}" onclick="toggleDetailFollow(this,'${p.user_id}')">${isFollowingAuthor ? 'Following' : 'Follow'}</button>`
            : ''}
        </div>

        <!-- TEXT — strip bare URL if it's the whole post or has no media -->
        ${p.content ? (() => {
          const dpUrl = extractFirstUrl(p.content);
          const dpClean = (!p.image && !p.video && dpUrl) ? p.content.replace(dpUrl, '').trim() : p.content;
          return dpClean ? `<p class="dp-text">${linkifyText(dpClean)}</p>` : '';
        })() : ''}

        <!-- MEDIA -->
        ${mediaHtml}

        <!-- QUOTED POST -->
        ${quoteHtml}

        <!-- FULL DATE -->
        <div class="dp-date"><b>${timeStr}</b> · ${dateStr}</div>

        <!-- STATS -->
        <div class="dp-stats">
          <div class="dp-stat">
            <span class="dp-stat-n detail-stat-n" data-type="likes">${fmtNum(p.like_count||0)}</span>
            <span class="dp-stat-l">Likes</span>
          </div>
          <div class="dp-stat">
            <span class="dp-stat-n repost-count-display">${fmtNum(p.repost_count||0)}</span>
            <span class="dp-stat-l">Reposts</span>
          </div>
          <div class="dp-stat">
            <span class="dp-stat-n" data-type="comments">${fmtNum(p.comment_count||0)}</span>
            <span class="dp-stat-l">Replies</span>
          </div>
          <div class="dp-stat">
            <span class="dp-stat-n detail-stat-n" data-type="views">${fmtNum(p.views||0)}</span>
            <span class="dp-stat-l">Views</span>
          </div>
        </div>

        <!-- ACTIONS removed — handled by fixed comment bar below -->

      </div>

      <div class="dp-divider"></div>
      <div id="comments-container"></div>
    `;

    // Share btn (header)
    document.getElementById('detail-share-btn').onclick = () => sharePost(p);

    // ── Mini identity in detail header (fades in when author avatar scrolls out) ──
    const dpHeaderIdentity = document.getElementById('dp-header-identity');
    const dpHeaderAvatar   = document.getElementById('dp-header-avatar');
    const dpHeaderUsername = document.getElementById('dp-header-username');

    dpHeaderAvatar.src = user.avatar || '';
    dpHeaderAvatar.style.visibility = 'visible';
    dpHeaderUsername.textContent = user.username || '';

    // IntersectionObserver on author avatar — show mini identity when avatar scrolls out
    const detailPage = document.getElementById('page-detail');
    if (detailPage._dpAvatarObs) detailPage._dpAvatarObs.disconnect();
    const dpAuthorAvatar = detailPage.querySelector('.dp-avatar-wrap') || detailPage.querySelector('.dp-avatar');
    detailPage._dpAvatarObs = new IntersectionObserver(([entry]) => {
      const visible = entry.isIntersecting;
      dpHeaderIdentity.style.opacity       = visible ? '0' : '1';
      dpHeaderIdentity.style.pointerEvents = visible ? 'none' : 'auto';
    }, { root: detailPage, threshold: 0 });
    if (dpAuthorAvatar) detailPage._dpAvatarObs.observe(dpAuthorAvatar);


    // Comment bar placeholder
    const commentInput = document.getElementById('comment-input');
    commentInput.placeholder = `Reply to ${user.username}...`;
    // Reset and re-wire mention autocomplete each time detail opens
    commentInput._mentionWired = false;
    wireMentionInput(commentInput, postId);

    // Comment bar — wire like button
    const cbLike = document.getElementById('cb-like-btn');
    if (cbLike) {
      // Seed LikeManager with the real DB count for this post
      LikeManager.seed(postId, p.like_count || 0, isLiked);
      // If already seeded (user navigated back), force-update the count to DB value
      const _s = LikeManager.get(postId);
      if (_s.count === 0 && (p.like_count || 0) > 0) _s.count = p.like_count;

      cbLike.dataset.postId = postId;
      cbLike.dataset.liked = isLiked ? 'true' : 'false';
      cbLike.dataset.count = _s.count;
      const cbPath = cbLike.querySelector('.cb-heart-path');
      const cbCount = document.getElementById('cb-like-count');
      if (isLiked) {
        cbPath?.setAttribute('fill', 'rgb(244,7,82)');
        cbPath?.setAttribute('stroke', 'rgb(244,7,82)');
        cbLike.classList.add('cb-liked');
      } else {
        cbPath?.setAttribute('fill', 'none');
        cbPath?.setAttribute('stroke', 'currentColor');
        cbLike.classList.remove('cb-liked');
      }
      if (cbCount) cbCount.textContent = _s.count > 0 ? fmtNum(_s.count) : '';
      cbLike.onclick = () => toggleLike(postId, cbLike);
    }

    // Comment bar — wire repost button
    const cbRepost = document.getElementById('cb-repost-btn');
    if (cbRepost) {
      cbRepost.dataset.postId = postId;
      const alreadyReposted = repostedPosts.has(postId);
      cbRepost.dataset.reposted = alreadyReposted ? 'true' : 'false';
      const cbSvg = cbRepost.querySelector('.cb-repost-svg');
      if (alreadyReposted) {
        cbRepost.classList.add('cb-reposted');
        cbSvg?.setAttribute('stroke', '#6C47FF');
        cbSvg?.setAttribute('stroke-width', '2.5');
      } else {
        cbRepost.classList.remove('cb-reposted');
        cbSvg?.setAttribute('stroke', 'currentColor');
        cbSvg?.setAttribute('stroke-width', '2');
      }
      cbRepost.onclick = () => handleRepost(postId, cbRepost, p.user_id);
    }

    // Swap bottom nav → comment bar
    document.getElementById('bottom-nav').style.display = 'none';
    document.getElementById('comment-bar').style.display = 'flex';

    // Track view + load comments
    await recordView(postId);
    await syncViewCount(postId);

    await loadComments(postId);

    // Live comment count straight from comments table — don't trust cached column
    supabase
      .from('comments')
      .select('*', { count: 'exact', head: true })
      .eq('post_id', postId)
      .then(({ count }) => {
        const statEl = document.querySelector('.dp-stat-n[data-type="comments"]');
        if (statEl && count !== null) animateCount(statEl, count);
        // Also keep the cached column in sync
        supabase.from('posts').update({ comment_count: count }).eq('id', postId);
      });

    if (scrollToComments) {
      setTimeout(() => {
        document.getElementById('comments-container')?.scrollIntoView({ behavior: 'smooth' });
      }, 300);
    }
  });
}

async function toggleDetailFollow(btn, userId) {
  // Ensure btn uses same classes as setFollowBtnState
  const isCurrentlyFollowing = btn.classList.contains('prf-btn-following') || btn.classList.contains('following');
  // Normalise classes so toggleFollow works correctly
  btn.classList.remove('following');
  if (isCurrentlyFollowing) {
    btn.classList.add('prf-btn-following');
    btn.classList.remove('prf-btn-primary');
  } else {
    btn.classList.remove('prf-btn-following');
    btn.classList.add('prf-btn-primary');
  }
  await toggleFollow(userId, btn);
}

function focusCommentBar() {
  document.getElementById('comment-input')?.focus();
}

// ══════════════════════════════════════════
// MENTION AUTOCOMPLETE
// ══════════════════════════════════════════

let mentionDebounceTimer = null;
let mentionActiveInput   = null; // which textarea is being typed in
let mentionPostId        = null; // for comment priority

function insertMentionInComposer() {
  const input = document.getElementById('composer-textarea');
  if (!input) return;
  const pos = input.selectionStart;
  input.value = input.value.slice(0, pos) + '@' + input.value.slice(pos);
  input.setSelectionRange(pos + 1, pos + 1);
  input.focus();
  input.dispatchEvent(new Event('input'));
}

function insertMention() {
  // Called by @ button — insert @ and trigger tray
  const input = document.getElementById('comment-input');
  if (!input) return;
  const pos = input.selectionStart;
  input.value = input.value.slice(0, pos) + '@' + input.value.slice(pos);
  input.setSelectionRange(pos + 1, pos + 1);
  input.focus();
  input.dispatchEvent(new Event('input'));
}

// Wire mention autocomplete to a textarea
function wireMentionInput(inputEl, postId = null) {
  if (!inputEl || inputEl._mentionWired) return;
  inputEl._mentionWired = true;

  inputEl.addEventListener('input', () => {
    mentionActiveInput = inputEl;
    mentionPostId = postId;
    clearTimeout(mentionDebounceTimer);
    const trigger = getMentionTrigger(inputEl);
    if (!trigger || trigger.query.length < 1) {
      hideMentionTray();
      return;
    }
    mentionDebounceTimer = setTimeout(() => fetchMentionSuggestions(trigger.query, inputEl), 180);
  });

  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Escape') hideMentionTray();
  });

  inputEl.addEventListener('blur', () => {
    // Delay so tap on tray item registers first
    setTimeout(hideMentionTray, 200);
  });
}

// Get current @query from cursor position
function getMentionTrigger(input) {
  const val = input.value;
  const pos = input.selectionStart;
  const before = val.slice(0, pos);
  const match = before.match(/@([a-zA-Z0-9_]*)$/);
  if (!match) return null;
  return { query: match[1], start: pos - match[0].length };
}

// Fetch users matching query with priority order
async function fetchMentionSuggestions(query, inputEl) {
  if (!query && query !== '') return;

  const tray = document.getElementById('mention-tray');
  const list = document.getElementById('mention-tray-list');
  if (!tray || !list) return;

  // Show tray with loading state
  list.innerHTML = '<div class="mention-loading">Searching…</div>';
  positionMentionTray(inputEl);
  tray.classList.remove('hidden');

  try {
    const results = [];
    const seen = new Set();

    const add = (users) => {
      (users || []).forEach(u => {
        if (!seen.has(u.id)) { seen.add(u.id); results.push(u); }
      });
    };

    // Priority 1 — commenters on this post (comment context only)
    if (mentionPostId && query.length >= 1) {
      const { data: commenters } = await supabase
        .from('comments')
        .select('user:users(id,username,avatar,followers)')
        .eq('post_id', mentionPostId)
        .limit(30);
      const commentUsers = (commenters || [])
        .map(c => c.user).filter(Boolean)
        .filter(u => u.username?.toLowerCase().startsWith(query.toLowerCase()));
      add(commentUsers);
    }

    // Priority 2 — people I follow
    if (currentUser && query.length >= 1) {
      const { data: following } = await supabase
        .from('follows')
        .select('user:users!following_id(id,username,avatar,followers)')
        .eq('follower_id', currentUser.id)
        .limit(50);
      const followUsers = (following || [])
        .map(f => f.user).filter(Boolean)
        .filter(u => u.username?.toLowerCase().startsWith(query.toLowerCase()));
      add(followUsers);
    }

    // Priority 3 — platform search (only if 2+ chars)
    if (query.length >= 2 && results.length < 6) {
      const { data: platformUsers } = await supabase
        .from('users')
        .select('id,username,avatar,followers')
        .ilike('username', query + '%')
        .order('followers', { ascending: false })
        .limit(6);
      add(platformUsers || []);
    }

    const top = results.slice(0, 6);

    if (!top.length) {
      list.innerHTML = '<div class="mention-empty">No users found</div>';
      return;
    }

    list.innerHTML = '';
    top.forEach(user => {
      const item = document.createElement('div');
      item.className = 'mention-item';
      item.innerHTML = `
        <img class="mention-av" src="${escHtml(user.avatar||'')}" onerror="this.style.background='var(--bg3)';this.removeAttribute('src')" alt="">
        <div class="mention-info">
          <span class="mention-username">@${escHtml(user.username)}</span>
          <span class="mention-followers">${fmtNum(user.followers||0)} followers</span>
        </div>`;
      item.onmousedown = item.ontouchstart = (e) => {
        e.preventDefault();
        completeMention(user.username, inputEl);
      };
      list.appendChild(item);
    });

    positionMentionTray(inputEl);

  } catch(err) {
    list.innerHTML = '<div class="mention-empty">Could not load</div>';
  }
}

function positionMentionTray(inputEl) {
  const tray = document.getElementById('mention-tray');
  if (!tray || !inputEl) return;
  const rect = inputEl.getBoundingClientRect();
  // Position just above the input
  tray.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
  tray.style.left   = '0';
  tray.style.right  = '0';
}

function completeMention(username, inputEl) {
  if (!inputEl) return;
  const trigger = getMentionTrigger(inputEl);
  if (!trigger) return;
  const before = inputEl.value.slice(0, trigger.start);
  const after  = inputEl.value.slice(inputEl.selectionStart);
  const insert = '@' + username + ' ';
  inputEl.value = before + insert + after;
  const newPos = before.length + insert.length;
  inputEl.setSelectionRange(newPos, newPos);
  inputEl.focus();
  inputEl.dispatchEvent(new Event('input'));
  hideMentionTray();
}

function hideMentionTray() {
  const tray = document.getElementById('mention-tray');
  if (tray) tray.classList.add('hidden');
  mentionActiveInput = null;
}

// Wire mention to composer textarea
function wireMentionToComposer() {
  const textarea = document.getElementById('composer-textarea');
  if (textarea) wireMentionInput(textarea, null);
}

function triggerCommentImage() {
  showToast('Image attachments in replies coming soon 🙏');
}

// ── COMMENT BAR ──
function initCommentBarInput() {
  const input = document.getElementById('comment-input');
  const sendBtn = document.getElementById('comment-send-btn');
  if (!input || !sendBtn) return;

  input.addEventListener('input', () => {
    sendBtn.disabled = input.value.trim().length === 0;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });
}

async function submitReplyFromBar() {
  const input = document.getElementById('comment-input');
  const content = input?.value?.trim();
  if (!content || !detailPostId || !currentUser) return;

  input.value = '';
  input.style.height = 'auto';
  document.getElementById('comment-send-btn').disabled = true;

  await submitComment(detailPostId, detailCommentParentId, content);
  detailCommentParentId = null;
  input.placeholder = detailPostId ? `Reply…` : 'Add a reply…';
}

// ── COMMENTS ──
async function loadComments(postId) {
  const container = document.getElementById('comments-container');
  if (!container) return;

  container.innerHTML = `
    <div class="comments-header">
      <span class="comments-title">Replies</span>
    </div>
    <div class="comments-list" id="comments-list"></div>`;

  const { data: comments } = await supabase
    .from('comments')
    .select(`id,content,created_at,like_count,parent_id,user_id,user:users(id,username,avatar)`)
    .eq('post_id', postId)
    .is('parent_id', null)
    .order('created_at', { ascending: false })
    .limit(30);

  const list = document.getElementById('comments-list');
  if (!list) return;

  const pill = document.getElementById('comments-count-pill');
  if (pill) pill.textContent = (comments || []).length;

  const statEl = document.querySelector('.dp-stat-n[data-type="comments"]');
  if (statEl) statEl.textContent = fmtNum((comments || []).length);

  if (!comments || !comments.length) {
    list.innerHTML = `
      <div class="comments-empty">
        <div class="comments-empty-icon">💬</div>
        <div class="comments-empty-text">No replies yet</div>
        <div class="comments-empty-sub">Be the first to say something</div>
      </div>`;
    return;
  }

  const commentIds = comments.map(c => c.id);
  const { data: likedComments } = await supabase
    .from('comment_likes').select('comment_id').eq('user_id', currentUser.id).in('comment_id', commentIds);
  const likedSet = new Set((likedComments || []).map(r => r.comment_id));

  list.innerHTML = '';
  comments.forEach((c, i) => {
    const el = buildCommentEl(c, null, likedSet, postId);
    el.style.animationDelay = (i * 0.03) + 's';
    el.classList.add('fade-up');
    list.appendChild(el);
  });
}

// ── Detect MistyNote profile URL ──
function extractMistyNoteProfile(text) {
  const match = text.match(/https?:\/\/mistynote\.pages\.dev\/profile\/([a-zA-Z0-9_]+)/);
  return match ? match[1] : null;
}

// ── Build compact comment link preview (external URLs only) ──
// MistyNote profile URLs are handled inline by linkifyText as @mentions
async function buildCommentLinkPreview(text) {
  const url = extractFirstUrl(text);
  if (!url || url.includes('mistynote.pages.dev')) return null;

  const og = await fetchOgPreview(url).catch(() => null);
  if (!og) return null;

  const card = document.createElement('div');
  card.className = 'comment-link-card';
  card.onclick = (e) => { e.stopPropagation(); window.open(url, '_blank'); };
  card.innerHTML = `
    ${og.image ? `<img class="comment-link-img" src="${escHtml(og.image)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
    <div class="comment-link-body">
      <div class="comment-link-domain">${escHtml(og.siteName || og.domain || '')}</div>
      <div class="comment-link-title">${escHtml((og.title || '').slice(0, 80))}</div>
    </div>`;
  return card;
}

// ── Strip URLs from comment text for display ──
// linkifyText handles @mentions and profile URLs inline,
// so we only need to strip external URLs that have a separate preview card
function commentDisplayText(text) {
  // Profile URLs are converted to @mentions by linkifyText — no strip needed
  // Only strip external non-mistynote URLs (they get a card below)
  const url = extractFirstUrl(text);
  if (url && !url.includes('mistynote.pages.dev')) {
    return text.replace(url, '').trim();
  }
  return text;
}

function buildCommentEl(c, parentId, likedSet, postId) {
  const u = c.user || { username: '@unknown', avatar: '' };
  const isOwn = currentUser && c.user_id === currentUser.id;
  const liked = likedSet.has(c.id);
  const isReply = !!parentId;

  const wrap = document.createElement('div');
  wrap.className = 'comment-item' + (isReply ? ' reply' : '');
  wrap.dataset.commentId = c.id;

  wrap.innerHTML = `
    <div class="comment-thread-col">
      <img class="comment-avatar" src="${u.avatar||''}" onerror="this.src='https://api.dicebear.com/7.x/adventurer/svg?seed=${escHtml(u.username)}'" alt="" onclick="showUserProfile('${c.user_id}',this)">
      <div class="thread-trunk hidden" id="trunk-${c.id}"></div>
    </div>
    <div class="comment-body">
      <div class="comment-meta-row">
        <span class="comment-name" onclick="showUserProfile('${c.user_id}',this)">${escHtml(u.username)}</span>
        <span class="comment-time">${timeSince(c.created_at)}</span>
      </div>
      ${c.content ? `<p class="comment-text">${linkifyText(commentDisplayText(c.content))}</p>` : ''}
      <div class="comment-link-preview-wrap" id="clp-${c.id}"></div>
      ${c.image_url ? `
        <div class="comment-media">
          <img class="comment-img" src="${c.image_url}" alt="" loading="lazy" onclick="openMediaViewer('${c.image_url}')">
        </div>` : ''}
      ${c.sticker_url ? `
        <div class="comment-sticker-slot" id="sticker-slot-${c.id}">
          <img class="comment-sticker" src="${c.sticker_url}" alt="">
        </div>` : `<div class="comment-sticker-slot" id="sticker-slot-${c.id}"></div>`}
      <div class="comment-actions-row">
        <button class="comment-action like-comment-btn ${liked ? 'liked' : ''}" data-comment-id="${c.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="${liked ? 'var(--red)' : 'none'}" stroke="${liked ? 'var(--red)' : 'currentColor'}" stroke-width="2">
            <path class="cmt-heart-path" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
          </svg>
          <span class="cmt-like-count">${c.like_count > 0 ? c.like_count : ''}</span>
        </button>
        ${!isReply ? `<button class="comment-action reply-btn" data-comment-id="${c.id}">Reply</button>` : ''}
        ${isOwn ? `<button class="comment-action delete-comment-btn" data-comment-id="${c.id}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
        </button>` : ''}
      </div>
      ${!isReply ? `
        <div class="reply-composer" id="reply-composer-${c.id}">
          <div class="reply-composer-inner">
            <img class="reply-composer-avatar" src="${currentProfile?.avatar||''}" onerror="this.style.display='none'">
            <textarea class="reply-textarea" placeholder="Reply to ${escHtml(u.username)}…" rows="1"></textarea>
          </div>
          <div class="reply-composer-footer">
            <button class="reply-sticker-btn" title="Sticker — coming soon" disabled>🎭</button>
            <button class="reply-cancel" onclick="closeReplyComposer('${c.id}')">Cancel</button>
            <button class="reply-submit" disabled onclick="submitReplyInline('${c.id}','${postId}',this)">Reply</button>
          </div>
        </div>
        <div class="replies-ctrl" id="replies-ctrl-${c.id}" style="display:none">
          <button class="expand-replies-btn" id="expand-${c.id}">0 replies</button>
          <button class="collapse-replies-btn hidden" id="collapse-${c.id}" onclick="collapseReplies('${c.id}')">Hide replies</button>
        </div>
        <div class="replies-block" id="replies-${c.id}"></div>
      ` : ''}
    </div>`;

  // Reply btn toggle
  wrap.querySelector('.reply-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    const composer = document.getElementById(`reply-composer-${c.id}`);
    document.querySelectorAll('.reply-composer.open').forEach(rc => {
      if (rc !== composer) rc.classList.remove('open');
    });
    composer?.classList.toggle('open');
    if (composer?.classList.contains('open')) {
      composer.querySelector('.reply-textarea')?.focus();
      detailCommentParentId = c.id;
    }
  });

  // Reply textarea auto-grow
  const replyTa = wrap.querySelector('.reply-textarea');
  const replySubmit = wrap.querySelector('.reply-submit');
  replyTa?.addEventListener('input', () => {
    if (replySubmit) replySubmit.disabled = !replyTa.value.trim();
    replyTa.style.height = 'auto';
    replyTa.style.height = Math.min(replyTa.scrollHeight, 100) + 'px';
  });

  // Trigger link preview for URLs in comment
  if (c.content && extractFirstUrl(c.content)) {
    const previewWrap = wrap.querySelector(`[id="clp-${c.id}"]`);
    if (previewWrap) {
      buildCommentLinkPreview(c.content).then(previewEl => {
        if (!previewEl || !previewWrap.isConnected) return;
        previewWrap.appendChild(previewEl);
      });
    }
  }

  // Like comment
  wrap.querySelector('.like-comment-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    toggleCommentLike(c.id, e.currentTarget);
  });

  // Delete comment
  wrap.querySelector('.delete-comment-btn')?.addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm('Delete this reply?')) return;
    await supabase.from('comments').delete().eq('id', c.id).eq('user_id', currentUser.id);
    wrap.style.transition = 'opacity 0.2s, transform 0.2s';
    wrap.style.opacity = '0'; wrap.style.transform = 'translateY(-4px) scale(0.98)';
    setTimeout(() => wrap.remove(), 220);
    await supabase.rpc('increment_post_comment_count', { pid: postId, delta: -1 });
    updateCommentCountDelta(-1);
  });

  // Load replies
  if (!isReply) {
    loadReplyCount(c.id).then(count => {
      const ctrl = document.getElementById(`replies-ctrl-${c.id}`);
      const expandBtn = document.getElementById(`expand-${c.id}`);
      if (count > 0) {
        if (ctrl) ctrl.style.display = '';
        if (expandBtn) {
          expandBtn.textContent = `${count} ${count === 1 ? 'reply' : 'replies'}`;
          expandBtn.onclick = () => expandReplies(c.id, likedSet, postId);
        }
      }
      // If count === 0, ctrl stays hidden — no clutter
    });
  }

  return wrap;
}

async function submitReplyInline(parentCommentId, postId, btn) {
  const composer = document.getElementById(`reply-composer-${parentCommentId}`);
  const ta = composer?.querySelector('.reply-textarea');
  const content = ta?.value?.trim();
  if (!content || !currentUser) return;

  btn.disabled = true;
  ta.value = '';
  ta.style.height = 'auto';
  composer.classList.remove('open');

  await submitComment(postId, parentCommentId, content);

  // Add optimistic reply — auto-expand if not already open
  const repliesBlock = document.getElementById(`replies-${parentCommentId}`);
  const trunk = document.getElementById(`trunk-${parentCommentId}`);
  const expandBtn = document.getElementById(`expand-${parentCommentId}`);
  const collapseBtn = document.getElementById(`collapse-${parentCommentId}`);
  const ctrl = document.getElementById(`replies-ctrl-${parentCommentId}`);

  // Show ctrl row if hidden
  if (ctrl) ctrl.style.display = '';
  // Show trunk rope
  if (trunk) trunk.classList.remove('hidden');
  if (expandBtn) expandBtn.style.display = 'none';
  if (collapseBtn) collapseBtn.classList.remove('hidden');

  const optimistic = buildCommentEl({
    id: 'opt-' + Date.now(), content, created_at: new Date().toISOString(),
    like_count: 0, parent_id: parentCommentId, user_id: currentUser.id,
    user: currentProfile
  }, parentCommentId, new Set(), postId);
  optimistic.classList.add('fade-up');
  repliesBlock?.appendChild(optimistic);

  // Update expand button count
  loadReplyCount(parentCommentId).then(count => {
    if (expandBtn) expandBtn.textContent = `${count} ${count === 1 ? 'reply' : 'replies'}`;
  });
}

async function submitComment(postId, parentId, content) {
  const { data, error } = await supabase.from('comments').insert({
    post_id: postId, user_id: currentUser.id, parent_id: parentId || null, content
  }).select(`id,content,created_at,like_count,parent_id,user_id,user:users(id,username,avatar)`).single();

  if (!error) {
    await supabase.rpc('increment_post_comment_count', { pid: postId, delta: 1 });
    updateCommentCountDelta(1);
    if (!parentId) {
      const list = document.getElementById('comments-list');
      if (list) {
        const el = buildCommentEl(data, null, new Set(), postId);
        el.classList.add('fade-up');
        list.prepend(el);
        const emptyEl = list.querySelector('.comments-empty');
        if (emptyEl) emptyEl.remove();
      }
      // Notify post owner
      supabase.from('posts').select('user_id').eq('id', postId).single().then(({ data: post }) => {
        if (post && post.user_id !== currentUser.id) {
          insertNotification({ user_id: post.user_id, actor_id: currentUser.id, post_id: postId, type: 'comment', comment_text: content });
        }
      });
    } else {
      // Reply — notify parent comment author
      supabase.from('comments').select('user_id').eq('id', parentId).single().then(({ data: parent }) => {
        if (parent && parent.user_id !== currentUser.id) {
          insertNotification({ user_id: parent.user_id, actor_id: currentUser.id, post_id: postId, type: 'comment', comment_text: content });
        }
      });
    }

    // Mention notifications — scan for @username in content
    const mentionMatches = content.match(/@([a-zA-Z0-9_]+)/g);
    if (mentionMatches) {
      const mentioned = [...new Set(mentionMatches.map(m => m.slice(1).toLowerCase()))];
      supabase.from('users').select('id,username').in('username', mentioned).then(({ data: users }) => {
        (users || []).forEach(u => {
          if (u.id !== currentUser.id) {
            insertNotification({ user_id: u.id, actor_id: currentUser.id, post_id: postId, type: 'mention', comment_text: content });
          }
        });
      });
    }
  }
}

function updateCommentCountDelta(delta) {
  // Update replies pill (if present)
  const pill = document.getElementById('comments-count-pill');
  if (pill) {
    const v = parseInt(pill.textContent) || 0;
    pill.textContent = Math.max(0, v + delta);
  }
  // Update stat table replies count
  const statEl = document.querySelector('.dp-stat-n[data-type="comments"]');
  if (statEl) {
    const v = parseInt(statEl.textContent.replace(/[^0-9]/g,'')) || 0;
    animateCount(statEl, Math.max(0, v + delta));
  }
  // Update feed card comment count
  if (detailPostId) {
    const feedSpan = document.querySelector(`.comment-btn[data-post-id="${detailPostId}"] span`);
    if (feedSpan) {
      const v = parseInt(feedSpan.textContent.replace(/[^0-9]/g,'')) || 0;
      const newVal = Math.max(0, v + delta);
      feedSpan.textContent = newVal > 0 ? fmtNum(newVal) : '';
    }
  }
}

async function toggleCommentLike(commentId, btn) {
  if (!currentUser) return;
  const isLiked = btn.classList.contains('liked');
  const newLiked = !isLiked;
  btn.classList.toggle('liked', newLiked);
  const path = btn.querySelector('.heart-path');
  if (path) { path.setAttribute('fill', newLiked ? 'var(--red)' : 'none'); path.setAttribute('stroke', newLiked ? 'var(--red)' : 'currentColor'); }
  animateHeart(btn?.querySelector('svg'), btn?.dataset.liked !== 'true');
  const sp = btn.querySelector('span');
  const cnt = parseInt(sp?.textContent || '0') || 0;
  if (sp) sp.textContent = newLiked ? cnt + 1 : Math.max(0, cnt - 1) || '';

  if (newLiked) {
    supabase.from('comment_likes').insert({ comment_id: commentId, user_id: currentUser.id }).then(({ error }) => {
      if (!error) {
        supabase.rpc('increment_comment_like', { cid: commentId, delta: 1 });
        // Notify comment author
        supabase.from('comments').select('user_id, post_id').eq('id', commentId).single().then(({ data: cmt }) => {
          if (cmt && cmt.user_id !== currentUser.id) {
            insertNotification({ user_id: cmt.user_id, actor_id: currentUser.id, post_id: cmt.post_id, type: 'like_comment' });
          }
        });
      }
    });
  } else {
    supabase.from('comment_likes').delete().eq('comment_id', commentId).eq('user_id', currentUser.id).then(() => {
      supabase.rpc('increment_comment_like', { cid: commentId, delta: -1 });
    });
  }
}

async function loadReplyCount(parentId) {
  const { count } = await supabase.from('comments').select('*', { count: 'exact', head: true }).eq('parent_id', parentId);
  return count || 0;
}

async function expandReplies(parentId, likedSet, postId) {
  const block      = document.getElementById(`replies-${parentId}`);
  const trunk      = document.getElementById(`trunk-${parentId}`);
  const expandBtn  = document.getElementById(`expand-${parentId}`);
  const collapseBtn = document.getElementById(`collapse-${parentId}`);
  if (!block) return;

  // Show trunk rope
  if (trunk) trunk.classList.remove('hidden');
  if (expandBtn)   expandBtn.style.display   = 'none';
  if (collapseBtn) collapseBtn.classList.remove('hidden');

  block.innerHTML = '<div class="loading-pulse" style="height:60px;margin:8px 0"></div>';

  const { data } = await supabase
    .from('comments')
    .select(`id,content,created_at,like_count,parent_id,user_id,user:users(id,username,avatar)`)
    .eq('parent_id', parentId)
    .order('created_at', { ascending: true })
    .limit(20);

  block.innerHTML = '';
  (data || []).forEach((r, i) => {
    const el = buildCommentEl(r, parentId, likedSet, postId);
    el.style.animationDelay = (i * 0.05) + 's';
    el.classList.add('fade-up');
    block.appendChild(el);
  });
}

function collapseReplies(parentId) {
  const block      = document.getElementById(`replies-${parentId}`);
  const trunk      = document.getElementById(`trunk-${parentId}`);
  const expandBtn  = document.getElementById(`expand-${parentId}`);
  const collapseBtn = document.getElementById(`collapse-${parentId}`);

  if (block) {
    block.style.transition = 'opacity .18s';
    block.style.opacity = '0';
    setTimeout(() => { block.innerHTML = ''; block.style.opacity = ''; block.style.transition = ''; }, 200);
  }
  if (trunk)      trunk.classList.add('hidden');
  if (expandBtn)  expandBtn.style.display = '';
  if (collapseBtn) collapseBtn.classList.add('hidden');
}

async function loadReplies(parentId, container, likedSet, postId) {
  // kept for backward compat — routes to expandReplies
  expandReplies(parentId, likedSet, postId);
}

function closeReplyComposer(commentId) {
  document.getElementById(`reply-composer-${commentId}`)?.classList.remove('open');
  detailCommentParentId = null;
}

// ══════════════════════════════════════════
// DISCOVER
// ══════════════════════════════════════════

// ══════════════════════════════════════════
// DISCOVER — full rebuild
// ══════════════════════════════════════════

// ── State ──
const DISC_RECENT_KEY = 'disc_recent_v1';
const DISC_SOCIAL_PROOF = [
  '🔥 Trending now',
  '⭐ Highly rated',
  '🛒 Added to cart by many',
  '💬 Lots of buzz',
  '✅ Frequently repurchased',
  '⚡ Flash deal',
];

let discCurrentTab   = 'posts';
let discCurrentQuery = '';
let discForYouLoaded = false;

function discGetRecent() {
  try { return JSON.parse(localStorage.getItem(DISC_RECENT_KEY) || '[]'); }
  catch { return []; }
}
function discSaveRecent(arr) {
  localStorage.setItem(DISC_RECENT_KEY, JSON.stringify(arr.slice(0,12)));
}
function discAddRecent(term) {
  const arr = discGetRecent().filter(x => x.toLowerCase() !== term.toLowerCase());
  arr.unshift(term);
  discSaveRecent(arr);
}

function discRenderRecent() {
  const arr  = discGetRecent();
  const wrap = document.getElementById('disc-recent-section');
  const box  = document.getElementById('disc-recent-pills');
  if (!wrap || !box) return;
  if (!arr.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  box.innerHTML = arr.map(t => `
    <div class="disc-recent-pill" onclick="discRunSearch('${escHtml(t)}')">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
        <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      ${escHtml(t)}
      <span class="disc-recent-pill-x" onclick="event.stopPropagation();discRemoveRecent('${escHtml(t)}')">×</span>
    </div>`).join('');
}

function discRemoveRecent(term) {
  discSaveRecent(discGetRecent().filter(x => x !== term));
  discRenderRecent();
}

function discClearAllRecent() {
  discSaveRecent([]);
  discRenderRecent();
}

// ── For You grid ──
async function discLoadForYou() {
  if (discForYouLoaded) return;
  discForYouLoaded = true;
  const grid = document.getElementById('disc-foryou-grid');
  if (!grid) return;

  const { data: posts } = await supabase
    .from('posts')
    .select(`id,content,image,video,created_at,like_count,repost_count,views,user_id,reposted_post_id,
             user:users(id,username,avatar),
             reposted_post:reposted_post_id(id,content,image,video,created_at,user_id,user:users(id,username,avatar)),
             comments(count)`)
    .order('like_count', { ascending: false })
    .limit(20);

  grid.innerHTML = '';

  if (!posts?.length) {
    grid.innerHTML = '<p class="disc-no-results"><strong>Nothing yet</strong>Posts will appear here as people share</p>';
    return;
  }

  (posts || []).forEach(p => {
    const el = createFeedPost(p, false);
    if (el) {
      el.classList.add('fade-in');
      grid.appendChild(el);
      observePost(el);
    }
  });

  const ids = posts.map(p => p.id);
  checkLikedPosts(ids);
  checkRepostedPosts(ids);
  checkSavedPosts(ids);
}

// ── Topic tap ──
function discTopicTap(btn) {
  const raw  = btn.textContent.trim();
  // Strip emoji prefix (first char + space)
  const term = raw.replace(/^\S+\s/, '');
  discRunSearch(term);
}

// ── Run a search ──
function discRunSearch(term) {
  const input = document.getElementById('disc-input');
  if (!input) return;
  input.value = term;
  discOnInput(term);
}

// ── Clear ──
function discClear() {
  const input = document.getElementById('disc-input');
  if (input) input.value = '';
  discOnInput('');
  input?.focus();
}

// ── Tab switch ──
function discTab(tab, btn) {
  discCurrentTab = tab;
  document.querySelectorAll('.disc-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.disc-pane').forEach(p => p.style.display = 'none');
  const pane = document.getElementById('disc-pane-' + tab);
  if (pane) pane.style.display = '';
  // If pane empty, run search again for this tab
  if (pane && !pane.dataset.loaded) {
    discFetchResults(discCurrentQuery, tab);
  }
}

// ── Input handler ──
const discOnInput = debounce(function(val) {
  const q     = (typeof val === 'string' ? val : val?.target?.value || '').trim();
  const xBtn  = document.getElementById('disc-x-btn');
  const tabs  = document.getElementById('disc-tabs');
  const home  = document.getElementById('disc-home');
  const res   = document.getElementById('disc-results');

  discCurrentQuery = q;

  if (xBtn) xBtn.style.display = q ? '' : 'none';

  if (!q) {
    // Back to home state
    if (tabs) tabs.style.display = 'none';
    if (home) home.style.display = '';
    if (res)  res.style.display  = 'none';
    discRenderRecent();
    return;
  }

  // Show results state
  if (tabs) tabs.style.display = 'flex';
  if (home) home.style.display = 'none';
  if (res)  res.style.display  = '';

  // Reset all panes
  ['posts','people','products'].forEach(t => {
    const p = document.getElementById('disc-pane-' + t);
    if (p) { p.dataset.loaded = ''; p.style.display = t === discCurrentTab ? '' : 'none'; }
  });

  discFetchResults(q, discCurrentTab);
}, 380);

// ── Fetch results for active tab ──
async function discFetchResults(q, tab) {
  const pane = document.getElementById('disc-pane-' + tab);
  if (!pane || pane.dataset.loaded === q) return;
  pane.dataset.loaded = q;

  pane.innerHTML = discLoadingHTML();

  if (tab === 'posts')    await discFetchPosts(q, pane);
  if (tab === 'people')   await discFetchPeople(q, pane);
  if (tab === 'products') await discFetchProducts(q || '', pane);

  // Save to recent after successful fetch
  discAddRecent(q);
}

function discLoadingHTML() {
  return `<div style="padding:16px">
    <div style="height:14px;border-radius:8px;background:var(--bg3);margin-bottom:10px;width:60%;animation:shimmer 1.4s infinite;background-size:200% 100%;background-image:linear-gradient(90deg,var(--bg3) 25%,var(--bg2) 50%,var(--bg3) 75%)"></div>
    <div style="height:14px;border-radius:8px;background:var(--bg3);margin-bottom:10px;width:80%;animation:shimmer 1.4s infinite;background-size:200% 100%;background-image:linear-gradient(90deg,var(--bg3) 25%,var(--bg2) 50%,var(--bg3) 75%)"></div>
    <div style="height:14px;border-radius:8px;background:var(--bg3);width:45%;animation:shimmer 1.4s infinite;background-size:200% 100%;background-image:linear-gradient(90deg,var(--bg3) 25%,var(--bg2) 50%,var(--bg3) 75%)"></div>
  </div>`;
}

// ── Posts results ──
async function discFetchPosts(q, pane) {
  const { data } = await supabase
    .from('posts')
    .select(`id,content,image,video,created_at,like_count,repost_count,views,user_id,reposted_post_id,
             user:users(id,username,avatar),
             reposted_post:reposted_post_id(id,content,image,video,created_at,user_id,user:users(id,username,avatar)),
             comments(count)`)
    .ilike('content', `%${q}%`)
    .order('like_count', { ascending: false })
    .limit(30);

  if (!data?.length) {
    pane.innerHTML = `<div class="disc-no-results"><strong>No posts found</strong>Try different words or check spelling</div>`;
    return;
  }

  pane.innerHTML = '';
  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:10px;padding:10px 0';

  data.forEach(p => {
    const el = createFeedPost(p, false);
    if (el) list.appendChild(el);
  });

  pane.appendChild(list);

  const ids = data.map(p => p.id);
  checkLikedPosts(ids);
  checkRepostedPosts(ids);
  checkSavedPosts(ids);
}

// ── People results ──
async function discFetchPeople(q, pane) {
  const { data } = await supabase
    .from('users')
    .select('id,username,avatar,bio,followers')
    .or(`username.ilike.%${q}%,bio.ilike.%${q}%`)
    .limit(20);

  if (!data?.length) {
    pane.innerHTML = `<div class="disc-no-results"><strong>No people found</strong>Try searching a username or topic</div>`;
    return;
  }

  // Get who current user follows
  let followingSet = new Set();
  if (currentUser) {
    const { data: fl } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', currentUser.id);
    (fl || []).forEach(r => followingSet.add(r.following_id));
  }

  const list = document.createElement('div');
  list.className = 'disc-people-list';

  data.forEach(u => {
    if (u.id === currentUser?.id) return; // skip self
    const isFollowing = followingSet.has(u.id);
    const row = document.createElement('div');
    row.className = 'disc-person-row';
    row.innerHTML = `
      <img class="disc-person-av" src="${u.avatar||''}" onerror="this.src=''" alt="">
      <div class="disc-person-info">
        <div class="disc-person-name">${escHtml(u.username||'')}</div>
        ${u.bio ? `<div class="disc-person-bio">${escHtml(u.bio)}</div>` : ''}
      </div>
      <button class="disc-follow-btn ${isFollowing ? 'following' : ''}"
        data-uid="${u.id}"
        onclick="event.stopPropagation(); discToggleFollow(this, '${u.id}')">
        ${isFollowing ? 'Following' : 'Follow'}
      </button>`;
    row.addEventListener('click', () => showUserProfile(u.id));
    list.appendChild(row);
  });

  pane.innerHTML = '';
  pane.appendChild(list);
}

async function discToggleFollow(btn, uid) {
  if (!currentUser) return;
  const isFollowing = btn.classList.contains('following');
  btn.disabled = true;
  if (isFollowing) {
    await supabase.from('follows').delete()
      .eq('follower_id', currentUser.id).eq('following_id', uid);
    btn.classList.remove('following');
    btn.textContent = 'Follow';
  } else {
    const { error: fe } = await supabase.from('follows').insert({ follower_id: currentUser.id, following_id: uid });
    if (!fe) {
      btn.classList.add('following');
      btn.textContent = 'Following';
      if (uid !== currentUser.id) {
        insertNotification({ user_id: uid, actor_id: currentUser.id, post_id: null, type: 'follow' });
      }
    }
  }
  btn.disabled = false;
}

// ── Products results ──
// ── Static demo products — replace with Supabase query when products table is ready ──
const DEMO_PRODUCTS = [
  {
    id: 'demo-1',
    title: 'Ankara Tote Bag — Handmade',
    image: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=400&q=80',
    price: 18500,
    currency: '₦',
    sold_count: 342,
    social: ['🔥 342 people bought this', '⭐ 4.9 star rating', '🛒 12 added to cart today'],
    seller: { username: '@AdaHandcraft', avatar: 'https://i.pravatar.cc/40?img=1' },
  },
  {
    id: 'demo-2',
    title: 'Natural Shea Butter Body Cream 500ml',
    image: 'https://images.unsplash.com/photo-1607006344380-b6775a0824a7?w=400&q=80',
    price: 5200,
    currency: '₦',
    sold_count: 1289,
    social: ['✅ 1.2K repurchased', '💬 "Best cream ever!"', '⚡ Flash sale — 20% off'],
    seller: { username: '@GlowByNkechi', avatar: 'https://i.pravatar.cc/40?img=5' },
  },
  {
    id: 'demo-3',
    title: "Men's Agbada Set — 3 Piece Custom",
    image: 'https://images.unsplash.com/photo-1594938298603-c8148c4b4f60?w=400&q=80',
    price: 95000,
    currency: '₦',
    sold_count: 87,
    social: ['👑 Premium quality fabric', '📦 Ships in 5 days', '🔥 Trending this week'],
    seller: { username: '@KingsTailors_Abj', avatar: 'https://i.pravatar.cc/40?img=3' },
  },
  {
    id: 'demo-4',
    title: 'Wireless Earbuds — 48hr Battery',
    image: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=400&q=80',
    price: 24000,
    currency: '₦',
    sold_count: 673,
    social: ['📱 Works with all phones', '⚡ Flash sale ends tonight', '🛒 2.1K added to cart'],
    seller: { username: '@TechVaultNG', avatar: 'https://i.pravatar.cc/40?img=8' },
  },
  {
    id: 'demo-5',
    title: 'Homemade Chin Chin 1kg — Crispy',
    image: 'https://images.unsplash.com/photo-1621939514649-280e2ee25f60?w=400&q=80',
    price: 3500,
    currency: '₦',
    sold_count: 2104,
    social: ['🍪 2.1K sold this month', '✅ Fresh baked daily', '💬 Customers keep coming back'],
    seller: { username: '@MamaDeliNG', avatar: 'https://i.pravatar.cc/40?img=9' },
  },
  {
    id: 'demo-6',
    title: 'Luxury Wig — 26" Brazilian Body Wave',
    image: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=400&q=80',
    price: 145000,
    currency: '₦',
    sold_count: 215,
    social: ['💅 215 happy customers', '⭐ 5-star reviews only', '🔥 Most wished for'],
    seller: { username: '@HairByFavour', avatar: 'https://i.pravatar.cc/40?img=47' },
  },
  {
    id: 'demo-7',
    title: 'Zobo Drink Set — 6 Bottles Premium',
    image: 'https://images.unsplash.com/photo-1546173159-315724a31696?w=400&q=80',
    price: 7800,
    currency: '₦',
    sold_count: 934,
    social: ['🌿 No preservatives', '✅ 934 orders delivered', '⚡ Order before 12pm, ship today'],
    seller: { username: '@ZoboQueenLagos', avatar: 'https://i.pravatar.cc/40?img=32' },
  },
  {
    id: 'demo-8',
    title: 'Afrobeats Drum Lesson — 4 Week Online',
    image: 'https://images.unsplash.com/photo-1519892300165-cb5542fb47c7?w=400&q=80',
    price: 35000,
    currency: '₦',
    sold_count: 156,
    social: ['🎵 156 students enrolled', '📹 Lifetime video access', '🔥 Trending in Music'],
    seller: { username: '@DrumsByEmeka', avatar: 'https://i.pravatar.cc/40?img=15' },
  },
];

async function discFetchProducts(q, pane) {
  // Filter demo products by query
  const filtered = q
    ? DEMO_PRODUCTS.filter(p =>
        p.title.toLowerCase().includes(q.toLowerCase()) ||
        p.seller.username.toLowerCase().includes(q.toLowerCase())
      )
    : DEMO_PRODUCTS;

  // TODO: When products table is ready, replace above with:
  // const { data, error } = await supabase
  //   .from('products')
  //   .select('id,title,image,price,currency,sold_count,user_id,user:users(id,username,avatar)')
  //   .or(`title.ilike.%${q}%,description.ilike.%${q}%`)
  //   .order('sold_count', { ascending: false })
  //   .limit(20);
  // const filtered = data || [];

  if (!filtered.length) {
    pane.innerHTML = `<div class="disc-no-results"><strong>No products found</strong>Try a different search</div>`;
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'disc-products-grid';

  filtered.forEach(prod => {
    const card     = document.createElement('div');
    card.className = 'disc-product-card';

    const socialId  = 'sp-' + Math.random().toString(36).slice(2);
    const price     = Number(prod.price || 0).toLocaleString();
    const sold      = prod.sold_count ? `${Number(prod.sold_count).toLocaleString()} sold` : '';
    const firstProof = prod.social?.[0] || DISC_SOCIAL_PROOF[0];

    card.innerHTML = `
      <div class="disc-product-img-wrap">
        ${prod.image
          ? `<img src="${prod.image}" alt="${escHtml(prod.title)}" loading="lazy">`
          : `<div style="width:100%;height:100%;background:${gradientFor(prod.id)}"></div>`
        }
      </div>
      <div class="disc-product-body">
        <div class="disc-product-title">${escHtml(prod.title||'')}</div>
        <div class="disc-product-social" id="${socialId}">${firstProof}</div>
        <div class="disc-product-price-row">
          <span class="disc-product-currency">${prod.currency||'₦'}</span>
          <span class="disc-product-amount">${price}</span>
          ${sold ? `<span class="disc-product-sold">${sold}</span>` : ''}
        </div>
        <div class="disc-product-seller" onclick="event.stopPropagation()">
          <img class="disc-product-seller-av" src="${prod.seller?.avatar||''}" onerror="this.src=''" alt="">
          <span class="disc-product-seller-name">${escHtml(prod.seller?.username||'')}</span>
        </div>
      </div>`;

    card.addEventListener('click', () => openProduct(prod.id));
    grid.appendChild(card);
    discCycleSocialProof(socialId, prod.social);
  });

  pane.innerHTML = '';
  pane.appendChild(grid);
}

// ── Social proof cycling ──
function discCycleSocialProof(elId, customArr) {
  const arr = customArr || DISC_SOCIAL_PROOF;
  let idx = 0;
  setInterval(() => {
    const el = document.getElementById(elId);
    if (!el) return;
    el.style.opacity = '0';
    setTimeout(() => {
      idx = (idx + 1) % arr.length;
      el.textContent = arr[idx];
      el.style.opacity = '1';
    }, 400);
  }, 3000);
}

// ── openProduct placeholder ──
function openProduct(id) {
  // Product page — coming soon
  showToast('Product page coming soon');
}

// ── Main init ──
async function loadDiscover() {
  const input = document.getElementById('disc-input');
  if (!input) return;
  if (input.dataset.init) return;
  input.dataset.init = '1';

  // Render recent searches
  discRenderRecent();

  // Load For You grid
  discLoadForYou();

  // Wire input
  input.addEventListener('input', e => discOnInput(e.target.value));
  input.addEventListener('focus', () => discRenderRecent());
}

// ══════════════════════════════════════════
// PROFILE SUGGESTIONS
// ══════════════════════════════════════════

// ── Dismiss a suggestion box for the session ──
function dismissSuggestBox(boxId) {
  const box = document.getElementById(boxId);
  if (box) {
    box.style.transition = 'opacity 0.2s, max-height 0.3s';
    box.style.opacity = '0';
    box.style.maxHeight = '0';
    box.style.overflow = 'hidden';
    setTimeout(() => box.style.display = 'none', 300);
  }
  sessionStorage.setItem('dismissed_' + boxId, '1');
}

// ── Build a suggestion user card ──
function buildSuggestCard(user, isFollowing) {
  const card = document.createElement('div');
  card.className = 'prf-suggest-card';
  card.dataset.uid = user.id;
  card.innerHTML = `
    <div class="prf-suggest-av-wrap" onclick="showUserProfile('${user.id}')">
      <img class="prf-suggest-av" src="${user.avatar||''}" onerror="this.style.background='var(--bg3)';this.removeAttribute('src')" alt="">
    </div>
    <div class="prf-suggest-name" onclick="showUserProfile('${user.id}')">${escHtml(user.username||'')}</div>
    <div class="prf-suggest-followers">${fmtNum(user.followers||user.follower_count||0)} followers</div>
    <button class="prf-suggest-follow-btn ${isFollowing ? 'following' : ''}"
      data-uid="${user.id}"
      onclick="suggestFollow(this,'${user.id}')">
      ${isFollowing ? 'Following' : 'Follow'}
    </button>`;
  return card;
}

async function suggestFollow(btn, uid) {
  if (!currentUser) return;
  const isFollowing = btn.classList.contains('following');
  btn.disabled = true;

  // Optimistic UI — update button instantly
  btn.classList.toggle('following', !isFollowing);
  btn.textContent = isFollowing ? 'Follow' : 'Following';

  // Optimistic — update the follower count on the card instantly
  const card = btn.closest('.prf-suggest-card');
  const followerEl = card?.querySelector('.prf-suggest-followers');
  if (followerEl) {
    const current = parseInt(followerEl.textContent.replace(/[^0-9]/g, '')) || 0;
    const newCount = isFollowing ? Math.max(0, current - 1) : current + 1;
    followerEl.textContent = fmtNum(newCount) + ' followers';
  }

  // Optimistic — update my Following count in my profile stats instantly
  const myFollowingEl = document.querySelector('#prf-following-count');
  if (myFollowingEl) {
    const current = parseInt(myFollowingEl.textContent.replace(/[^0-9]/g, '')) || 0;
    const newCount = isFollowing ? Math.max(0, current - 1) : current + 1;
    myFollowingEl.textContent = fmtNum(newCount);
    if (currentProfile) currentProfile.following = newCount;
  }

  if (isFollowing) {
    const { error } = await supabase.from('follows').delete()
      .eq('follower_id', currentUser.id).eq('following_id', uid);
    if (error) {
      // Revert on failure
      btn.classList.add('following'); btn.textContent = 'Following';
      if (followerEl) followerEl.textContent = fmtNum((parseInt(followerEl.textContent)||0)+1) + ' followers';
    }
  } else {
    const { error } = await supabase.from('follows').insert({ follower_id: currentUser.id, following_id: uid });
    if (error) {
      // Revert on failure
      btn.classList.remove('following'); btn.textContent = 'Follow';
      if (followerEl) followerEl.textContent = fmtNum(Math.max(0,(parseInt(followerEl.textContent)||0)-1)) + ' followers';
    }
  }

  btn.disabled = false;

  // Confirm real counts from DB after action (non-blocking)
  setTimeout(() => refreshFollowCounts(uid), 500);
}

// ── Load "People you might vibe with" on own profile ──
async function loadSuggestedForMe() {
  if (!currentUser) return;
  const boxId = 'prf-suggest-own';
  if (sessionStorage.getItem('dismissed_' + boxId)) return;

  const box  = document.getElementById(boxId);
  const list = document.getElementById('prf-suggest-own-list');
  if (!box || !list) return;

  // Get who I already follow
  const { data: following } = await supabase
    .from('follows').select('following_id').eq('follower_id', currentUser.id);
  const followingIds = (following || []).map(r => r.following_id);
  const excludeIds   = [...followingIds, currentUser.id];

  // Fetch a batch of users then filter client-side — avoids .not('id','in') syntax issues
  const { data: allUsers, error } = await supabase
    .from('users')
    .select('id,username,avatar,followers,location')
    .neq('id', currentUser.id)
    .order('followers', { ascending: false })
    .limit(50);

  if (error) console.error('Suggest error:', error.message);

  const users = (allUsers || []).filter(u => !excludeIds.includes(u.id)).slice(0, 10);

  if (!users.length) return;

  list.innerHTML = '';
  users.forEach(u => list.appendChild(buildSuggestCard(u, false)));
  box.style.display = '';
}

// ── Load "People who follow @X also follow" on other profile ──
async function renderSuggestedForOtherProfile(userId, username) {
  if (!currentUser) return;
  const boxId = `prf-suggest-other-${userId}`;
  if (sessionStorage.getItem('dismissed_' + boxId)) return;

  // Find existing box or create it
  let box = document.getElementById(boxId);
  if (!box) {
    // Insert after prf-btn-row in user profile body
    const body = document.getElementById('user-profile-body');
    if (!body) return;
    const tabBar = body.querySelector('.prf-icon-tabs');
    if (!tabBar) return;

    box = document.createElement('div');
    box.className = 'prf-suggest-box';
    box.id = boxId;
    box.innerHTML = `
      <div class="prf-suggest-header">
        <span class="prf-suggest-title">People who follow ${escHtml(username)} also follow</span>
        <button class="prf-suggest-close" onclick="dismissSuggestBox('${boxId}')" aria-label="Dismiss">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="prf-suggest-scroll" id="${boxId}-list">
        <div style="padding:20px;text-align:center;color:var(--text3)">Loading…</div>
      </div>`;
    tabBar.parentNode.insertBefore(box, tabBar);

    // Animate in
    box.style.opacity = '0';
    box.style.maxHeight = '0';
    box.style.overflow = 'hidden';
    setTimeout(() => {
      box.style.transition = 'opacity 0.3s, max-height 0.4s';
      box.style.opacity = '1';
      box.style.maxHeight = '300px';
    }, 50);
  }

  const list = document.getElementById(`${boxId}-list`);
  if (!list) return;

  // Get who I already follow
  const { data: myFollowing } = await supabase
    .from('follows').select('following_id').eq('follower_id', currentUser.id);
  const myFollowingIds = new Set((myFollowing || []).map(r => r.following_id));
  myFollowingIds.add(currentUser.id);
  myFollowingIds.add(userId); // exclude the profile owner

  // Strategy: show who this user follows that I don't follow yet
  // More useful than their followers when there are few users
  const { data: theyFollow } = await supabase
    .from('follows').select('following_id').eq('follower_id', userId).limit(50);
  let candidates = (theyFollow || []).map(r => r.following_id).filter(id => !myFollowingIds.has(id));

  // Fallback: if they don't follow many people, show popular users I don't follow
  if (candidates.length < 3) {
    const { data: popular } = await supabase
      .from('users')
      .select('id')
      .neq('id', currentUser.id)
      .neq('id', userId)
      .order('followers', { ascending: false })
      .limit(30);
    const popularIds = (popular || []).map(r => r.id).filter(id => !myFollowingIds.has(id));
    candidates = [...new Set([...candidates, ...popularIds])];
  }

  if (!candidates.length) { box.style.display = 'none'; return; }

  const { data: users, error: uErr } = await supabase
    .from('users')
    .select('id,username,avatar,followers')
    .in('id', candidates.slice(0, 20))
    .order('followers', { ascending: false })
    .limit(8);

  if (uErr) console.error('Suggest other error:', uErr.message);
  if (!users?.length) {
    box.style.display = 'none';
    return;
  }

  list.innerHTML = '';
  users.forEach(u => list.appendChild(buildSuggestCard(u, myFollowingIds.has(u.id))));
  console.log('suggest: rendered', users.length, 'cards');
}

// ══════════════════════════════════════════
// MESSAGING
// ══════════════════════════════════════════

// ── State ──
let activeChatId       = null;  // current conversation id
let activeChatUserId   = null;  // the other user's id
let activeChatUser     = null;  // the other user's profile object
let msgRealtimeSub     = null;  // realtime subscription
let msgTypingTimer     = null;
let msgInboxLoaded     = false;

// ── Helpers ──
function msgTimeSince(iso) {
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60)      return 'now';
  if (diff < 3600)    return Math.floor(diff / 60) + 'm';
  if (diff < 86400)   return Math.floor(diff / 3600) + 'h';
  if (diff < 604800)  return Math.floor(diff / 86400) + 'd';
  return new Date(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short' });
}
function msgFormatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
}

// ── Get or create conversation between current user and another user ──
async function msgGetOrCreateConversation(otherUserId) {
  if (!currentUser) return null;

  // Check if conversation already exists between these two users
  const { data: myConvs } = await supabase
    .from('conversation_participants')
    .select('conversation_id')
    .eq('user_id', currentUser.id);

  if (myConvs?.length) {
    const myConvIds = myConvs.map(r => r.conversation_id);
    const { data: sharedConvs } = await supabase
      .from('conversation_participants')
      .select('conversation_id')
      .eq('user_id', otherUserId)
      .in('conversation_id', myConvIds);

    if (sharedConvs?.length) {
      return sharedConvs[0].conversation_id;
    }
  }

  // Create conversation — insert with created_by so RLS can validate
  const { data: conv, error: convErr } = await supabase
    .from('conversations')
    .insert({ created_by: currentUser.id })
    .select('id')
    .single();

  if (convErr) {
    console.error('Conv create error:', convErr.message, convErr.code);
    return null;
  }
  if (!conv) return null;

  // Insert self as participant
  const { error: p1Err } = await supabase
    .from('conversation_participants')
    .insert({ conversation_id: conv.id, user_id: currentUser.id });

  if (p1Err) {
    console.error('Participant 1 error:', p1Err.message);
    return null;
  }

  // Insert other participant
  const { error: p2Err } = await supabase
    .from('conversation_participants')
    .insert({ conversation_id: conv.id, user_id: otherUserId });

  if (p2Err) {
    console.error('Participant 2 error:', p2Err.message);
    // Still return conv — other user joins when they open
  }

  return conv.id;
}

// ── Open DM from anywhere in the app ──
async function openDM(userId) {
  if (!currentUser) { showToast('Sign in to send messages'); return; }
  if (userId === currentUser.id) { showToast("You can't message yourself"); return; }

  // Get user profile
  const { data: user } = await supabase
    .from('users')
    .select('id,username,avatar,bio,location')
    .eq('id', userId)
    .maybeSingle();

  if (!user) { showToast('User not found'); return; }

  const convId = await msgGetOrCreateConversation(userId);
  if (!convId) { showToast('Could not open chat'); return; }

  openChat(convId, user);
}

// ── Open messages inbox (from feed header DM button) ──
function openMessagesInbox() {
  slideTo('messages', () => {
    loadMessages();
  });
}

// ── Load inbox ──
async function loadMessages() {
  if (!currentUser) return;
  if (msgInboxLoaded) return;
  msgInboxLoaded = true;

  const list  = document.getElementById('msg-inbox-list');
  const empty = document.getElementById('msg-inbox-empty');
  if (!list) return;

  list.innerHTML = '<div class="chat-loading"><div class="chat-loading-dot"></div><div class="chat-loading-dot"></div><div class="chat-loading-dot"></div></div>';

  // Get conversations I'm part of
  const { data: myParts } = await supabase
    .from('conversation_participants')
    .select('conversation_id, last_read_at')
    .eq('user_id', currentUser.id);

  if (!myParts?.length) {
    list.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }

  const convIds = myParts.map(r => r.conversation_id);
  const readMap = {};
  myParts.forEach(r => readMap[r.conversation_id] = r.last_read_at);

  // Get conversations with last message info
  const { data: convs } = await supabase
    .from('conversations')
    .select('id, last_message, last_message_at, last_message_type, updated_at')
    .in('id', convIds)
    .order('updated_at', { ascending: false });

  if (!convs?.length) {
    list.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }

  // Get other participants for each conversation
  const { data: allParts } = await supabase
    .from('conversation_participants')
    .select('conversation_id, user_id, user:users(id,username,avatar,location)')
    .in('conversation_id', convIds)
    .neq('user_id', currentUser.id);

  const partMap = {};
  (allParts || []).forEach(p => { partMap[p.conversation_id] = p.user; });

  // Count unread messages — only messages after my last_read_at
  const { data: unreadMsgs } = await supabase
    .from('messages')
    .select('conversation_id, created_at')
    .in('conversation_id', convIds)
    .neq('sender_id', currentUser.id)
    .is('deleted_at', null);

  const unreadMap = {};
  (unreadMsgs || []).forEach(m => {
    const readAt = readMap[m.conversation_id];
    // Only count if message is newer than last_read_at (or never read)
    if (!readAt || new Date(m.created_at) > new Date(readAt)) {
      unreadMap[m.conversation_id] = (unreadMap[m.conversation_id] || 0) + 1;
    }
  });

  list.innerHTML = '';
  if (empty) empty.style.display = 'none';

  // Subscribe to real-time inbox updates
  subscribeToInbox(convIds);

  convs.forEach(conv => {
    const otherUser = partMap[conv.id];
    if (!otherUser) return;

    const unread  = unreadMap[conv.id] || 0;
    const preview = conv.last_message || 'Start a conversation';
    const timeStr = conv.last_message_at ? msgTimeSince(conv.last_message_at) : '';

    const row = document.createElement('div');
    row.className = 'msg-conv-row';
    row.dataset.convId = conv.id;

    // Active indicator: green dot if last message within 5 minutes
    const lastMsgMs = conv.last_message_at ? Date.now() - new Date(conv.last_message_at).getTime() : Infinity;
    const isActive  = lastMsgMs < 5 * 60 * 1000;   // 5 min
    const isRecent  = lastMsgMs < 60 * 60 * 1000;   // 1 hour

    row.innerHTML = `
      <div class="msg-conv-av-wrap">
        <img class="msg-conv-av" src="${otherUser.avatar||''}" onerror="this.style.background='var(--bg3)';this.removeAttribute('src')" alt="">
        ${isActive ? '<span class="msg-conv-online-dot"></span>' : ''}
      </div>
      <div class="msg-conv-body">
        <div class="msg-conv-name-row">
          <span class="msg-conv-name">${escHtml(otherUser.username||'')}</span>
          <span class="msg-conv-time"${isActive ? ' style="color:var(--accent);font-weight:700"' : ''}>${isActive ? 'Active now' : timeStr}</span>
        </div>
        <div class="msg-conv-preview-row">
          <span class="msg-conv-preview${unread ? ' unread' : ''}">${escHtml(preview)}</span>
          ${unread ? `<div class="msg-conv-unread-badge">${unread > 9 ? '9+' : unread}</div>` : ''}
        </div>
      </div>`;
    row.addEventListener('click', () => openChat(conv.id, otherUser));
    list.appendChild(row);
  });

  // Check message requests
  const { data: requests } = await supabase
    .from('message_requests')
    .select('id')
    .eq('to_user_id', currentUser.id)
    .eq('status', 'pending');

  if (requests?.length) {
    const banner = document.getElementById('msg-requests-banner');
    const badge  = document.getElementById('msg-requests-badge');
    const text   = document.getElementById('msg-requests-count-text');
    if (banner) banner.style.display = 'flex';
    if (badge)  badge.textContent = requests.length;
    if (text)   text.textContent  = `${requests.length} ${requests.length === 1 ? 'person wants' : 'people want'} to chat`;
  }
}

// ── Open a chat ──
// ── Scroll chat to bottom when keyboard opens ──
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    if (activeChatId) {
      const msgsEl = document.getElementById('chat-messages');
      if (msgsEl) setTimeout(() => { msgsEl.scrollTop = msgsEl.scrollHeight; }, 50);
    }
  });
}

// ══════════════════════════════════════════
// ONLINE STATUS + TYPING INDICATORS
// ══════════════════════════════════════════

let presenceChannel = null;
let typingTimeout   = null;
let lastSeenInterval = null;
let isCurrentlyTyping = false;

// ── Chat status helpers (typing only) ──

// Restore status to location or MistyNote after typing stops
function restoreChatStatus() {
  const location = activeChatUser?.location || '';
  updateChatStatus(location || 'MistyNote');
}

// ── Update chat topbar status ──
function updateChatStatus(text, typing = false) {
  const statusEl = document.getElementById('chat-topbar-status');
  const onlineDot = document.getElementById('chat-topbar-online');
  if (statusEl) {
    statusEl.textContent = typing ? '✦ typing...' : text;
    statusEl.className = 'chat-topbar-status' + (typing ? ' typing' : '');
  }
  if (onlineDot) onlineDot.style.display = 'none';
}

// ── Load other user's online status ──


// ── Subscribe to typing broadcasts only ──
function subscribeToPresence(convId) {
  if (presenceChannel) {
    supabase.removeChannel(presenceChannel);
    presenceChannel = null;
  }

  presenceChannel = supabase.channel(`typing:${convId}`);

  presenceChannel
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (!payload || payload.user_id === currentUser?.id) return;
      if (payload.isTyping) {
        updateChatStatus('typing...', true, true);
        setInboxTyping(convId, true);
        clearTimeout(window._typingClearTimer);
        window._typingClearTimer = setTimeout(() => {
          restoreChatStatus();
          setInboxTyping(convId, false);
        }, 4000);
      } else {
        clearTimeout(window._typingClearTimer);
        restoreChatStatus();
        setInboxTyping(convId, false);
      }
    })
    .subscribe();
}

// ── Broadcast typing state via broadcast ──
async function broadcastTyping(isTyping) {
  if (!presenceChannel || isCurrentlyTyping === isTyping) return;
  isCurrentlyTyping = isTyping;
  presenceChannel.send({
    type: 'broadcast',
    event: 'typing',
    payload: { user_id: currentUser.id, isTyping }
  }).catch(() => {});
}

// ── Wire typing detection to chat input ──
function wireChatTyping() {
  const input = document.getElementById('chat-input-field');
  if (!input || input._typingWired) return;
  input._typingWired = true;

  input.addEventListener('input', () => {
    // Send typing=true on every keystroke
    if (!isCurrentlyTyping) {
      broadcastTyping(true);
    } else {
      // Already typing — just re-send to keep it alive
      presenceChannel?.send({
        type: 'broadcast',
        event: 'typing',
        payload: { user_id: currentUser.id, isTyping: true }
      }).catch(() => {});
    }
    // Reset the stop timer on every keystroke
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => broadcastTyping(false), 3000);
  });

  input.addEventListener('blur', () => {
    clearTimeout(typingTimeout);
    broadcastTyping(false);
  });
}

// ── Stop presence when leaving chat ──
function stopPresence() {
  clearTimeout(typingTimeout);
  isCurrentlyTyping = false;
  if (presenceChannel) {
    presenceChannel.untrack().catch(() => {});
    supabase.removeChannel(presenceChannel);
    presenceChannel = null;
  }
  const input = document.getElementById('chat-input-field');
  if (input) input._typingWired = false;
}

function openChat(convId, otherUser) {
  activeChatId     = convId;
  activeChatUserId = otherUser.id;
  activeChatUser   = otherUser;

  // Set topbar
  const nameEl   = document.getElementById('chat-topbar-name');
  const statusEl = document.getElementById('chat-topbar-status');
  const avEl     = document.getElementById('chat-topbar-av');
  if (nameEl)   nameEl.textContent = otherUser.username || '';
  const locationText = otherUser.location || 'MistyNote';
  if (statusEl) { statusEl.textContent = locationText; statusEl.className = 'chat-topbar-status'; }
  if (avEl) {
    if (otherUser.avatar) {
      avEl.innerHTML = `<img src="${otherUser.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" onerror="this.parentElement.style.background='var(--bg3)'">`;
    } else {
      avEl.style.background = 'var(--accent-soft)';
      avEl.innerHTML = '';
    }
  }

  // Clear and slide in
  const msgsEl = document.getElementById('chat-messages');
  if (msgsEl) msgsEl.innerHTML = '<div class="chat-loading"><div class="chat-loading-dot"></div><div class="chat-loading-dot"></div><div class="chat-loading-dot"></div></div>';

  // Clear badge immediately from inbox row
  const inboxBadge = document.querySelector(`.msg-conv-row[data-conv-id="${convId}"] .msg-conv-unread-badge`);
  if (inboxBadge) inboxBadge.remove();
  const inboxPreview = document.querySelector(`.msg-conv-row[data-conv-id="${convId}"] .msg-conv-preview`);
  if (inboxPreview) inboxPreview.classList.remove('unread');

  slideTo('chat', async () => {
    await loadChatMessages(convId);
    subscribeToChat(convId);
    markConvRead(convId);
    subscribeToPresence(convId);
    wireChatTyping();
    // Poll other user's status every 15s
    clearInterval(window._statusPollInterval);
    window._statusPollInterval = setInterval(() => {
      if (activeChatUserId && !isCurrentlyTyping) {
        loadChatUserStatus(activeChatUserId);
      }
      // Also keep our own presence fresh
        }, 15000);


  });
}

// ── Close chat ──
function closeChat() {
  stopPresence();
  if (msgRealtimeSub) {
    supabase.removeChannel(msgRealtimeSub);
    msgRealtimeSub = null;
  }
  activeChatId = null;
  activeChatUser = null;

  // Force inbox to reload with fresh unread counts
  msgInboxLoaded = false;

  const el = document.getElementById('page-chat');
  if (el) el.classList.remove('active');
  slideStack.pop();

  // If returning to messages inbox, keep nav hidden
  const returningTo = slideStack[slideStack.length - 1];
  if (returningTo === 'messages') {
    document.getElementById('page-messages')?.classList.add('active');
  } else {
    // Returning all the way back — restore nav
    document.getElementById('bottom-nav').style.display = '';
    const backTo = lastMainPage || 'feed';
    document.getElementById('page-' + backTo)?.classList.add('active');
    document.querySelectorAll('.nav-btn[data-page]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.page === backTo);
    });
  }
}

// ── Close messages inbox (back button) ──
function closeMessagesInbox() {
  msgInboxLoaded = false;
  const el = document.getElementById('page-messages');
  if (el) el.classList.remove('active');
  slideStack.pop();
  // Restore nav and main page
  document.getElementById('bottom-nav').style.display = '';
  const backTo = lastMainPage || 'feed';
  document.getElementById('page-' + backTo)?.classList.add('active');
  document.querySelectorAll('.nav-btn[data-page]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === backTo);
  });
}

// ── Load messages for a conversation ──
async function loadChatMessages(convId) {
  const msgsEl = document.getElementById('chat-messages');
  if (!msgsEl) return;

  const { data: messages, error } = await supabase
    .from('messages')
    .select(`id, type, content, media_url, media_duration,
             cash_amount, cash_currency, cash_note, cash_status,
             product_id, offer_amount, offer_status,
             order_status, reply_to_id, created_at, sender_id, status,
             sender:users!sender_id(id, username, avatar)`)
    .eq('conversation_id', convId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    msgsEl.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text3)">Could not load messages</div>';
    return;
  }

  msgsEl.innerHTML = '';

  if (!messages?.length) {
    msgsEl.innerHTML = '';
    renderStaticDemoChat(msgsEl);
    return;
  }

  // Reverse so oldest is at top, newest at bottom
  const ordered = [...messages].reverse();

  let lastDate = null;
  let lastSenderId = null;

  ordered.forEach((msg, idx) => {
    const msgDate = new Date(msg.created_at).toDateString();
    if (msgDate !== lastDate) {
      const divider = document.createElement('div');
      divider.className = 'chat-date-divider';
      const today = new Date().toDateString();
      const yesterday = new Date(Date.now() - 86400000).toDateString();
      divider.innerHTML = `<span>${msgDate === today ? 'Today' : msgDate === yesterday ? 'Yesterday' : new Date(msg.created_at).toLocaleDateString('en-GB', {day:'numeric',month:'short'})}</span>`;
      msgsEl.appendChild(divider);
      lastDate = msgDate;
    }

    const el = buildMessageEl(msg, lastSenderId);
    if (el) msgsEl.appendChild(el);
    lastSenderId = msg.sender_id;
  });

  msgsEl.scrollTop = msgsEl.scrollHeight;
  assignClusterClasses(msgsEl);
}

// ── Assign cluster classes for bubble shaping ──
function assignClusterClasses(container) {
  const rows = Array.from(container.querySelectorAll('.chat-msg-row'));
  rows.forEach((row, i) => {
    const sender = row.classList.contains('sent') ? 'sent' : 'recv';
    const prevSame = i > 0 && rows[i-1].classList.contains(sender);
    const nextSame = i < rows.length-1 && rows[i+1].classList.contains(sender);
    row.classList.remove('cluster-top','cluster-mid','cluster-bot','cluster-only');
    if (!prevSame && !nextSame) row.classList.add('cluster-only');
    else if (!prevSame && nextSame) row.classList.add('cluster-top');
    else if (prevSame && nextSame)  row.classList.add('cluster-mid');
    else if (prevSame && !nextSame) row.classList.add('cluster-bot');
  });
}

// ── Build a message element ──
function buildMessageEl(msg, prevSenderId) {
  const isSent     = msg.sender_id === currentUser?.id;
  const isNewSender = prevSenderId !== null && msg.sender_id !== prevSenderId;
  const timeStr    = msgFormatTime(msg.created_at);

  const row = document.createElement('div');
  row.className = `chat-msg-row ${isSent ? 'sent' : 'recv'}${isNewSender ? ' new-sender' : ''}`;
  row.dataset.msgId = msg.id;

  // ── Tap to show Snapchat-style popup ──
  attachTapPopup(row, msg);

  // ── Reply quote ──
  let replyQuoteHtml = '';
  const replyData = msg._replySnapshot || null;
  if (replyData || msg.reply_to_id) {
    // Use embedded snapshot for optimistic messages, or fetch for loaded ones
    if (replyData) {
      replyQuoteHtml = buildReplyQuoteHtml(replyData.senderName, replyData.content, replyData.mediaUrl);
    } else if (msg.reply_to_id) {
      // Will be populated async below
    }
  }

  // Build bubble based on type
  let bubbleEl;

  if (msg.type === 'image') {
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble img-bubble';
    const imgSrc = escHtml(msg.media_url || '');
    bubble.innerHTML = `
      ${replyQuoteHtml}
      <img class="chat-bubble-img" src="${imgSrc}" alt="photo" loading="lazy"
        onclick="chatViewImage('${imgSrc}')"
        onerror="this.style.opacity='0.3'">
      ${msg.content ? `<div style="font-size:14px;margin-top:6px;padding:0 2px">${escHtml(msg.content)}</div>` : ''}
      <span class="chat-bubble-meta">${timeStr}</span>`;
    bubbleEl = bubble;

  } else if (msg.type === 'cash') {
    bubbleEl = buildCashBubble(msg, isSent, timeStr);
  } else if (msg.type === 'product') {
    bubbleEl = buildProductBubble(msg, isSent, timeStr);
  } else if (msg.type === 'voice') {
    bubbleEl = buildVoiceBubble(msg, isSent, timeStr);
  } else if (msg.type === 'offer') {
    bubbleEl = buildOfferBubble(msg, isSent, timeStr);
  } else if (msg.type === 'order_update') {
    bubbleEl = buildOrderBubble(msg, timeStr);
  } else {
    const content  = msg.content || '';
    const url      = extractFirstUrl(content);
    const isUrlOnly = url && content.trim() === url.trim();

    if (url) {
      const msgCol = document.createElement('div');
      msgCol.className = `chat-url-col ${isSent ? 'sent' : 'recv'}`;
      row.appendChild(msgCol);

      if (!isUrlOnly) {
        const textOnly = content.replace(url, '').trim();
        if (textOnly) {
          const textBubble = document.createElement('div');
          textBubble.className = 'chat-bubble';
          textBubble.innerHTML = `${replyQuoteHtml}${linkifyText(textOnly)}<span class="chat-bubble-meta">${timeStr}${isSent ? `` : ''}</span>`;
          msgCol.appendChild(textBubble);
        }
      }

      const previewCard = document.createElement('div');
      previewCard.className = `chat-og-outer ${isSent ? 'sent' : 'recv'}`;
      previewCard.innerHTML = `<div class="chat-og-shimmer"><div class="chat-og-shimmer-img"></div><div class="chat-og-shimmer-lines"><div></div><div></div></div></div>`;
      msgCol.appendChild(previewCard);

      fetchOgPreview(url).then(og => {
        if (!og) {
          previewCard.remove();
          const fallback = document.createElement('div');
          fallback.className = 'chat-bubble';
          fallback.innerHTML = `${replyQuoteHtml}<a href="${escHtml(url)}" target="_blank" rel="noopener noreferrer" class="post-link" onclick="event.stopPropagation()">${escHtml(url)}</a><span class="chat-bubble-meta">${timeStr}${isSent ? `` : ''}</span>`;
          msgCol.appendChild(fallback);
          return;
        }
        previewCard.innerHTML = buildOgCard(og, url, isSent, timeStr, isUrlOnly);
      }).catch(() => {
        previewCard.remove();
      });

      return row;

    } else {
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble';
      bubble.innerHTML = `${replyQuoteHtml}${linkifyText(content)}<span class="chat-bubble-meta">${timeStr}${isSent ? `` : ''}</span>`;
      bubbleEl = bubble;
    }
  }

  if (bubbleEl) {
    row.appendChild(bubbleEl);
    // Async: fetch reply context if reply_to_id exists but no snapshot
    if (msg.reply_to_id && !msg._replySnapshot) {
      fetchAndInjectReplyQuote(row, bubbleEl, msg.reply_to_id, isSent);
    }
  }
  return row;
}

// ── Fetch reply context from DB and inject into bubble ──
async function fetchAndInjectReplyQuote(row, bubbleEl, replyToId, isSent) {
  const { data: orig } = await supabase
    .from('messages')
    .select('id, content, media_url, type, sender_id, sender:users!sender_id(username)')
    .eq('id', replyToId)
    .maybeSingle();
  if (!orig) return;
  const senderName = orig.sender?.username || '…';
  const previewText = orig.type === 'image' ? '📷 Photo' : (orig.content || '').slice(0, 80);
  const mediaUrl = orig.type === 'image' ? orig.media_url : null;
  const quoteHtml = buildReplyQuoteHtml(senderName, previewText, mediaUrl);
  // Prepend inside bubble
  bubbleEl.insertAdjacentHTML('afterbegin', quoteHtml);
}

function buildReplyQuoteHtml(senderName, previewText, mediaUrl) {
  return `
    <div class="chat-reply-quote" onclick="event.stopPropagation()">
      <div class="chat-reply-quote-accent"></div>
      <div class="chat-reply-quote-body">
        <div class="chat-reply-quote-name">${escHtml(senderName)}</div>
        <div class="chat-reply-quote-text">${escHtml(previewText)}</div>
      </div>
      ${mediaUrl ? `<img class="chat-reply-quote-img" src="${escHtml(mediaUrl)}" alt="">` : ''}
    </div>`;
}

// ── Tap-to-popup: attach to bubble element only ──
function attachTapPopup(row, msg) {
  let longPressTimer = null;
  let didScroll = false;
  let touchStartX = 0;
  let touchStartY = 0;

  const LONG_PRESS_MS = 420;

  row.addEventListener('touchstart', (e) => {
    didScroll = false;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;

    const bubble = e.target.closest('.chat-bubble, .chat-product-bubble, .chat-cash-bubble, .chat-order-bubble, .chat-offer-bubble, .chat-voice-bubble, .chat-bubble.img-bubble');
    if (!bubble) return;
    if (e.target.closest('a, button, .chat-reply-quote')) return;

    longPressTimer = setTimeout(() => {
      if (didScroll) return;
      if (navigator.vibrate) navigator.vibrate(32);
      showMsgPopup(row, msg, bubble);
    }, LONG_PRESS_MS);
  }, { passive: true });

  row.addEventListener('touchmove', (e) => {
    const dx = Math.abs(e.touches[0].clientX - touchStartX);
    const dy = Math.abs(e.touches[0].clientY - touchStartY);
    if (dx > 6 || dy > 6) {
      didScroll = true;
      clearTimeout(longPressTimer);
    }
  }, { passive: true });

  row.addEventListener('touchend', (e) => {
    clearTimeout(longPressTimer);
    if (didScroll) return;

    // Single tap on image → fullscreen viewer (not popup)
    if (msg.type === 'image') {
      const imgEl = e.target.closest('.chat-bubble-img');
      if (imgEl) {
        e.preventDefault();
        chatViewImage(msg.media_url || imgEl.src);
        return;
      }
    }
  }, { passive: false });

  // Desktop fallback: right-click or long mousedown
  row.addEventListener('contextmenu', (e) => {
    const bubble = e.target.closest('.chat-bubble, .chat-product-bubble, .chat-cash-bubble, .chat-order-bubble, .chat-offer-bubble, .chat-voice-bubble');
    if (!bubble) return;
    e.preventDefault();
    showMsgPopup(row, msg, bubble);
  });
}

function showMsgPopup(row, msg, bubbleEl) {
  closeMsgPopup();

  const isSent = row.classList.contains('sent');

  // ── 1. Backdrop (blur layer) ──
  const backdrop = document.createElement('div');
  backdrop.className = 'chat-popup-backdrop';
  backdrop.id = 'chat-popup-backdrop';
  document.body.appendChild(backdrop);
  // Trigger CSS transition to blur state
  requestAnimationFrame(() => backdrop.classList.add('visible'));

  const closeAll = (e) => {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    closeMsgPopup();
  };
  backdrop.addEventListener('click', closeAll);
  backdrop.addEventListener('touchend', closeAll, { passive: false });

  // ── 2. Float clone — snapshot the bubble position and clone it above blur ──
  const rect = bubbleEl.getBoundingClientRect();
  const vw   = window.innerWidth;
  const vh   = window.innerHeight;

  const floatEl = document.createElement('div');
  floatEl.className = 'chat-popup-float-msg';
  floatEl.id = 'chat-popup-float-msg';
  // Clone bubble's visual
  const cloneNode = bubbleEl.cloneNode(true);
  // Disable any inner interaction on clone
  cloneNode.style.pointerEvents = 'none';
  floatEl.appendChild(cloneNode);

  // Match exact position and size
  floatEl.style.left   = rect.left + 'px';
  floatEl.style.top    = rect.top  + 'px';
  floatEl.style.width  = rect.width  + 'px';
  document.body.appendChild(floatEl);

  // ── 3. Popup container (emoji row + actions) ──
  const popup = document.createElement('div');
  popup.className = 'chat-msg-popup';
  popup.id = 'chat-msg-popup';
  popup.addEventListener('click', e => e.stopPropagation());
  popup.addEventListener('touchend', e => e.stopPropagation(), { passive: false });

  // Emoji row
  const emojis = ['❤️', '😂', '😮', '😢', '👏', '🔥'];
  const emojiRow = document.createElement('div');
  emojiRow.className = 'chat-popup-emojis';
  emojis.forEach(em => {
    const btn = document.createElement('button');
    btn.className = 'chat-popup-emoji-btn';
    btn.textContent = em;
    btn.addEventListener('click', () => { showToast(`Reacted ${em}`); closeMsgPopup(); });
    emojiRow.appendChild(btn);
  });
  const moreBtn = document.createElement('button');
  moreBtn.className = 'chat-popup-emoji-more';
  moreBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/><circle cx="5" cy="12" r="1.5" fill="currentColor"/></svg>`;
  moreBtn.addEventListener('click', () => { showToast('More reactions — coming soon'); closeMsgPopup(); });
  emojiRow.appendChild(moreBtn);
  popup.appendChild(emojiRow);

  // Action rows
  const actions = document.createElement('div');
  actions.className = 'chat-popup-actions';

  const chevronSvg = `<svg class="chat-popup-action-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M9 18l6-6-6-6"/></svg>`;

  const addAction = (iconSvg, label, cls, fn) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `chat-popup-action${cls ? ' ' + cls : ''}`;
    btn.innerHTML = `
      <div class="chat-popup-action-left">
        <span class="chat-popup-action-icon">${iconSvg}</span>
        <span class="chat-popup-action-label">${label}</span>
      </div>
      ${chevronSvg}`;
    btn.addEventListener('click', () => { closeMsgPopup(); fn(); });
    actions.appendChild(btn);
  };

  addAction(
    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 17l-4-4 4-4M5 13h8a6 6 0 016 6"/></svg>`,
    'Reply', '', () => chatSetReply(msg.id)
  );

  if (msg.type !== 'image' && msg.content) {
    addAction(
      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`,
      'Copy', '', () => {
        navigator.clipboard?.writeText(msg.content).then(() => showToast('Copied')).catch(() => showToast('Could not copy'));
      }
    );
  }

  if (msg.type === 'image' && msg.media_url) {
    addAction(
      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
      'View Photo', '', () => chatViewImage(msg.media_url)
    );
  }

  addAction(
    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 10 20 15 15 20"/><path d="M4 4v7a4 4 0 004 4h12"/></svg>`,
    'Forward', '', () => showToast('Forward — coming soon')
  );

  if (isSent) {
    addAction(
      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/></svg>`,
      'Delete', 'danger', async () => {
        const { error } = await supabase.from('messages').update({ deleted_at: new Date().toISOString() }).eq('id', msg.id);
        if (!error) row.remove(); else showToast('Could not delete');
      }
    );
  }

  popup.appendChild(actions);
  document.body.appendChild(popup);

  // ── 4. Position popup above or below the floated bubble ──
  const popW = Math.min(240, vw - 24);
  popup.style.visibility = 'hidden';
  popup.style.width = popW + 'px';
  popup.style.left = '0px';
  popup.style.top  = '0px';

  requestAnimationFrame(() => {
    const popH = popup.offsetHeight;
    const MARGIN = 12;
    const GAP = 10;

    // Horizontal: align with bubble edge
    let left = isSent ? rect.right - popW : rect.left;
    left = Math.max(MARGIN, Math.min(left, vw - popW - MARGIN));

    // Vertical: prefer above the bubble, fall back below
    let top = rect.top - popH - GAP;
    if (top < 60) top = rect.bottom + GAP;
    top = Math.max(60, Math.min(top, vh - popH - MARGIN));

    popup.style.left = left + 'px';
    popup.style.top  = top  + 'px';
    popup.style.transformOrigin = isSent ? 'right top' : 'left top';
    popup.style.visibility = 'visible';
  });
}

function closeMsgPopup() {
  const backdrop = document.getElementById('chat-popup-backdrop');
  if (backdrop) {
    backdrop.classList.remove('visible');
    setTimeout(() => backdrop.remove(), 280);
  }
  document.getElementById('chat-popup-float-msg')?.remove();
  document.getElementById('chat-msg-popup')?.remove();
}

// ── View full-screen image ──
function chatViewImage(src) {
  const overlay = document.createElement('div');
  overlay.className = 'chat-img-viewer';
  overlay.id = 'chat-img-viewer';

  const img = document.createElement('img');
  img.className = 'chat-img-viewer-img';
  img.src = src;
  img.alt = 'Photo';
  img.onclick = (e) => e.stopPropagation();

  const closeBtn = document.createElement('button');
  closeBtn.className = 'chat-img-viewer-close';
  closeBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
  closeBtn.onclick = closeViewer;

  const saveBtn = document.createElement('button');
  saveBtn.className = 'chat-img-viewer-save';
  saveBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg> Save`;
  saveBtn.onclick = () => {
    const a = document.createElement('a');
    a.href = src; a.download = 'photo.jpg'; a.target = '_blank';
    a.click();
  };

  overlay.appendChild(closeBtn);
  overlay.appendChild(img);
  overlay.appendChild(saveBtn);
  overlay.onclick = closeViewer;
  document.body.appendChild(overlay);

  // Trigger animation
  requestAnimationFrame(() => overlay.classList.add('visible'));

  function closeViewer() {
    overlay.classList.remove('visible');
    setTimeout(() => overlay.remove(), 240);
  }

  // Swipe down to close
  let startY = 0;
  overlay.addEventListener('touchstart', e => { startY = e.touches[0].clientY; }, { passive: true });
  overlay.addEventListener('touchend', e => {
    if (e.changedTouches[0].clientY - startY > 80) closeViewer();
  }, { passive: true });
}

// ── Extract first URL from text ──
function extractFirstUrl(text) {
  const match = text.match(/https?:\/\/[^\s]+/);
  return match ? match[0] : null;
}

// ── Linkify text — @mentions, MistyNote profile URLs, external URLs ──
function linkifyText(text) {
  // Step 1 — replace MistyNote profile URLs with @username before escaping
  text = text.replace(
    /https?:\/\/mistynote\.pages\.dev\/profile\/([a-zA-Z0-9_]+)/g,
    (match, username) => '@' + username
  );

  // Step 2 — escape HTML
  const escaped = escHtml(text);

  // Step 3 — @username → purple tappable span
  let result = escaped.replace(
    /@([a-zA-Z0-9_]+)/g,
    (match, username) =>
      '<span class="mention-link" onclick="event.stopPropagation();handleMentionTap(\'' + username + '\')" data-username="' + username + '">@' + username + '</span>'
  );

  // Step 4 — remaining external URLs → tappable links
  result = result.replace(
    /https?:\/\/[^\s&lt;&gt;"]+/g,
    url => {
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) return url;
        const safeHref = url.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        return '<a href="' + safeHref + '" target="_blank" rel="noopener noreferrer nofollow" class="post-link" onclick="event.stopPropagation()">' + url + '</a>';
      } catch {
        return url;
      }
    }
  );

  return result;
}

// ── Handle @mention tap — look up user and open profile ──
async function handleMentionTap(username) {
  const { data: user } = await supabase
    .from('users').select('id').eq('username', username).maybeSingle();
  if (user?.id) showUserProfile(user.id);
  else showToast('@' + username + ' not found');
}

// ── Fetch OG data via our own Cloudflare Pages Function ──
const ogCache = {};
async function fetchOgPreview(url) {
  if (ogCache[url] !== undefined) return ogCache[url];
  try {
    const res  = await fetch(`/api/og?url=${encodeURIComponent(url)}`);
    if (!res.ok) { ogCache[url] = null; return null; }
    const data = await res.json();
    if (!data || data.error || !data.title) { ogCache[url] = null; return null; }
    ogCache[url] = data;
    return data;
  } catch {
    ogCache[url] = null;
    return null;
  }
}

// ── Build OG preview card for FEED POSTS (X/Twitter style) ──
function buildPostOgCard(og, url) {
  const safeUrl = escHtml(url);
  return `
    <div class="post-og-card" onclick="event.stopPropagation();window.open('${safeUrl}','_blank')">
      ${og.image ? `<div class="post-og-img-wrap"><img class="post-og-img" src="${escHtml(og.image)}" alt="" loading="lazy" onerror="this.closest('.post-og-img-wrap').remove()"></div>` : ''}
      <div class="post-og-body">
        <div class="post-og-domain">${escHtml(og.siteName || og.domain || '')}</div>
        ${og.title ? `<div class="post-og-title">${escHtml(og.title.slice(0, 100))}</div>` : ''}
        ${og.description ? `<div class="post-og-desc">${escHtml(og.description.slice(0, 140))}</div>` : ''}
      </div>
    </div>`;
}

// ── Build OG preview card HTML ──
function buildOgCard(og, url, isSent, timeStr, isUrlOnly) {
  const safeUrl  = escHtml(url);
  const imgHtml  = og.image
    ? `<img class="chat-og-img" src="${escHtml(og.image)}" alt="" loading="lazy" onerror="this.remove()">`
    : '';
  const metaHtml = isUrlOnly && timeStr
    ? `<div class="chat-og-meta">${timeStr}${isSent ? `` : ''}</div>`
    : '';
  return `
    <div class="chat-og-card ${isSent ? 'sent' : 'recv'}" onclick="window.open('${safeUrl}','_blank')">
      ${imgHtml}
      <div class="chat-og-body">
        <div class="chat-og-domain">${escHtml(og.siteName || og.domain)}</div>
        ${og.title       ? `<div class="chat-og-title">${escHtml(og.title.slice(0,80))}</div>` : ''}
        ${og.description ? `<div class="chat-og-desc">${escHtml(og.description.slice(0,120))}</div>` : ''}
        ${metaHtml}
      </div>
    </div>`;
}

function buildCashBubble(msg, isSent, timeStr) {
  const currency = msg.cash_currency === 'NGN' ? '₦' : '$';
  const amount   = Number(msg.cash_amount || 0).toLocaleString();
  const div = document.createElement('div');
  div.className = 'chat-cash-bubble';
  div.onclick = () => showToast('Cash transfer details — coming soon');
  div.innerHTML = `
    <div class="chat-cash-shimmer"></div>
    <div class="chat-cash-inner">
      <div class="chat-cash-label">💸 ${isSent ? 'Cash Sent' : 'Cash Received'}</div>
      <div class="chat-cash-amount-row">
        <span class="chat-cash-currency">${currency}</span>
        <span class="chat-cash-amount">${amount}</span>
      </div>
      ${msg.cash_note ? `<div class="chat-cash-note">${escHtml(msg.cash_note)}</div>` : ''}
      <div class="chat-cash-status">
        <div class="chat-cash-status-dot"></div>
        ${msg.cash_status === 'held' ? 'Held in escrow' : msg.cash_status === 'released' ? 'Released ✓' : 'Pending'}
      </div>
      <div style="font-size:10px;color:rgba(255,184,0,0.5);margin-top:8px;text-align:right">${timeStr}</div>
    </div>`;
  return div;
}

function buildProductBubble(msg, isSent, timeStr) {
  const div = document.createElement('div');
  div.className = 'chat-product-bubble';
  div.onclick = () => showToast('Product page — coming soon');
  div.innerHTML = `
    <div class="chat-product-bubble-img" style="background:var(--bg2);display:flex;align-items:center;justify-content:center;font-size:36px">🛒</div>
    <div class="chat-product-bubble-body">
      <div class="chat-product-bubble-title">Product</div>
      <div style="font-size:10px;color:var(--text3);margin-top:6px;text-align:right">${timeStr}</div>
    </div>`;
  return div;
}

function buildVoiceBubble(msg, isSent, timeStr) {
  const waveId = 'wv-' + msg.id.slice(0,8);
  const dur    = msg.media_duration || 0;
  const durStr = dur < 60 ? `0:${String(dur).padStart(2,'0')}` : `${Math.floor(dur/60)}:${String(dur%60).padStart(2,'0')}`;

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  bubble.innerHTML = `
    <div class="chat-voice-bubble">
      <button class="chat-voice-play" onclick="chatPlayVoice(this,'${waveId}')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg>
      </button>
      <div class="chat-voice-waveform" id="${waveId}"></div>
      <span class="chat-voice-dur">${durStr}</span>
    </div>
    <div class="chat-bubble-meta"><span>${timeStr}</span></div>`;

  // Build waveform bars after insert
  setTimeout(() => {
    const wv = document.getElementById(waveId);
    if (!wv) return;
    const heights = [4,8,14,10,18,12,22,16,20,14,8,18,24,16,12,20,10,16,8,12];
    wv.innerHTML = heights.map(h => `<div class="chat-voice-bar" style="height:${h}px"></div>`).join('');
  }, 0);

  return bubble;
}

function buildOfferBubble(msg, isSent, timeStr) {
  const currency = '₦';
  const amount   = Number(msg.offer_amount || 0).toLocaleString();
  const div = document.createElement('div');
  div.className = 'chat-offer-bubble';
  const isPending = msg.offer_status === 'pending';
  div.innerHTML = `
    <div class="chat-offer-header">
      <div class="chat-offer-label">💬 Price Offer</div>
      <div class="chat-offer-product">Product negotiation</div>
    </div>
    <div class="chat-offer-body">
      <div class="chat-offer-amount-row">
        <span class="chat-offer-currency">${currency}</span>
        <span class="chat-offer-amount">${amount}</span>
      </div>
      ${!isSent && isPending ? `
        <div class="chat-offer-actions">
          <button class="chat-offer-btn chat-offer-accept" onclick="chatRespondOffer('${msg.id}','accepted')">Accept</button>
          <button class="chat-offer-btn chat-offer-counter" onclick="chatRespondOffer('${msg.id}','countered')">Counter</button>
          <button class="chat-offer-btn chat-offer-decline" onclick="chatRespondOffer('${msg.id}','declined')">Decline</button>
        </div>` : `<div style="font-size:12px;color:var(--text3);text-transform:capitalize">${msg.offer_status}</div>`}
      <div style="font-size:10px;color:var(--text3);margin-top:8px;text-align:right">${timeStr}</div>
    </div>`;
  return div;
}

function buildOrderBubble(msg, timeStr) {
  const steps  = ['Confirmed','Packed','Shipped','Delivered'];
  const active = steps.findIndex(s => s.toLowerCase() === (msg.order_status||'').toLowerCase());
  const div = document.createElement('div');
  div.className = 'chat-order-bubble';
  let stepsHtml = '<div class="chat-order-steps">';
  steps.forEach((s, i) => {
    const cls = i < active ? 'done' : i === active ? 'active' : '';
    stepsHtml += `
      <div class="chat-order-step">
        <div class="chat-order-dot ${cls}">${i < active ? '✓' : i === active ? '→' : ''}</div>
        <div class="chat-order-step-label ${cls}">${s}</div>
      </div>`;
    if (i < steps.length - 1) {
      stepsHtml += `<div class="chat-order-line ${i < active ? 'done' : ''}"></div>`;
    }
  });
  stepsHtml += '</div>';
  div.innerHTML = `<div class="chat-order-label">📦 Order Status</div>${stepsHtml}
    <div style="font-size:10px;color:var(--text3);margin-top:10px;text-align:right">${timeStr}</div>`;
  return div;
}

// ── Static demo chat — shows all message types for UI preview ──
function renderStaticDemoChat(msgsEl) {
  const them = activeChatUser?.username || 'them';
  const items = [
    { type: 'date', label: 'Today' },
    { type: 'recv', text: `Hi! 👋 Welcome to MistyNote messaging` },
    { type: 'sent', text: `Hey! This is looking great 🔥` },
    { type: 'recv', text: `Check out this product I have for you` },
    { type: 'product-recv' },
    { type: 'sent-offer' },
    { type: 'recv', text: `Let me think about it...` },
    { type: 'cash-sent' },
    { type: 'order-recv' },
    { type: 'voice-recv' },
    { type: 'sent', text: `Thank you! Will confirm when delivered 🙏` },
    { type: 'recv-reaction', text: `Can't wait! 😊`, reaction: '❤️ 1' },
  ];

  const now = new Date();
  const fmt = (d) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  let lastSender = null;

  items.forEach((item, idx) => {
    if (item.type === 'date') {
      const d = document.createElement('div');
      d.className = 'chat-date-divider';
      d.innerHTML = `<span>${item.label}</span>`;
      msgsEl.appendChild(d);
      lastSender = null;
      return;
    }

    const isSent = item.type.startsWith('sent') || item.type === 'cash-sent';
    const isNewSender = lastSender !== null && (isSent ? 'sent' : 'recv') !== lastSender;
    const timeStr = fmt(new Date(now - (items.length - idx) * 60000));

    if (item.type === 'recv' || item.type === 'sent' || item.type === 'recv-reaction') {
      const row = document.createElement('div');
      row.className = `chat-msg-row ${isSent ? 'sent' : 'recv'}${isNewSender ? ' new-sender' : ''}`;
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble';
      if (item.reaction) {
        bubble.innerHTML = `${escHtml(item.text)}<span class="chat-bubble-meta">${timeStr}</span>`;
        const react = document.createElement('div');
        react.className = 'chat-bubble-reaction';
        react.textContent = item.reaction;
        bubble.appendChild(react);
      } else {
        bubble.innerHTML = `${escHtml(item.text)}<span class="chat-bubble-meta">${timeStr}${isSent ? `` : ''}</span>`;
      }
      row.appendChild(bubble);
      msgsEl.appendChild(row);

    } else if (item.type === 'product-recv') {
      const row = document.createElement('div');
      row.className = `chat-msg-row recv${isNewSender ? ' new-sender' : ''}`;
      const card = document.createElement('div');
      card.className = 'chat-product-bubble';
      card.onclick = () => showToast('Product page — coming soon');
      card.innerHTML = `
        <div class="chat-product-bubble-img" style="background:linear-gradient(135deg,#1a0a10,#3d1525);display:flex;align-items:center;justify-content:center;font-size:40px">👜</div>
        <div class="chat-product-bubble-body">
          <div class="chat-product-bubble-title">Ankara Tote Bag — Handmade Premium</div>
          <div class="chat-product-price-row">
            <span class="chat-product-currency">₦</span>
            <span class="chat-product-price">18,500</span>
            <span style="font-size:11px;color:var(--text3);margin-left:4px">342 sold</span>
          </div>
          <button class="chat-product-btn" onclick="event.stopPropagation();showToast('View product')">View Product</button>
        </div>`;
      row.appendChild(card);
      msgsEl.appendChild(row);

    } else if (item.type === 'sent-offer') {
      const row = document.createElement('div');
      row.className = `chat-msg-row sent${isNewSender ? ' new-sender' : ''}`;
      const card = document.createElement('div');
      card.className = 'chat-offer-bubble';
      card.innerHTML = `
        <div class="chat-offer-header">
          <div class="chat-offer-label">💬 Price Offer</div>
          <div class="chat-offer-product">Ankara Tote Bag</div>
        </div>
        <div class="chat-offer-body">
          <div class="chat-offer-amount-row">
            <span class="chat-offer-currency">₦</span>
            <span class="chat-offer-amount">15,000</span>
          </div>
          <div style="font-size:12px;color:var(--text3);margin-bottom:10px">My offer</div>
          <div class="chat-offer-actions">
            <button class="chat-offer-btn chat-offer-accept" onclick="showToast('Offer accepted ✓')">Accept</button>
            <button class="chat-offer-btn chat-offer-counter" onclick="showToast('Counter sent')">Counter</button>
          </div>
          <div style="font-size:10px;color:rgba(255,255,255,0.4);margin-top:8px;text-align:right">${timeStr}</div>
        </div>`;
      row.appendChild(card);
      msgsEl.appendChild(row);

    } else if (item.type === 'cash-sent') {
      const row = document.createElement('div');
      row.className = `chat-msg-row sent${isNewSender ? ' new-sender' : ''}`;
      const card = document.createElement('div');
      card.className = 'chat-cash-bubble';
      card.onclick = () => showToast('Cash transfer details — coming soon');
      card.innerHTML = `
        <div class="chat-cash-shimmer"></div>
        <div class="chat-cash-inner">
          <div class="chat-cash-label">💸 Cash Sent</div>
          <div class="chat-cash-amount-row">
            <span class="chat-cash-currency">₦</span>
            <span class="chat-cash-amount">15,000</span>
          </div>
          <div class="chat-cash-note">For: Ankara Tote Bag</div>
          <div class="chat-cash-status">
            <div class="chat-cash-status-dot"></div>
            Held in escrow · Awaiting delivery
          </div>
          <div style="font-size:10px;color:rgba(255,184,0,0.5);margin-top:8px;text-align:right">${timeStr}</div>
        </div>`;
      row.appendChild(card);
      msgsEl.appendChild(row);

    } else if (item.type === 'order-recv') {
      const row = document.createElement('div');
      row.className = `chat-msg-row recv${isNewSender ? ' new-sender' : ''}`;
      const card = document.createElement('div');
      card.className = 'chat-order-bubble';
      card.innerHTML = `
        <div class="chat-order-label">📦 Order Status</div>
        <div class="chat-order-steps">
          <div class="chat-order-step"><div class="chat-order-dot done">✓</div><div class="chat-order-step-label done">Confirmed</div></div>
          <div class="chat-order-line done"></div>
          <div class="chat-order-step"><div class="chat-order-dot done">✓</div><div class="chat-order-step-label done">Packed</div></div>
          <div class="chat-order-line done"></div>
          <div class="chat-order-step"><div class="chat-order-dot active">→</div><div class="chat-order-step-label active">Shipped</div></div>
          <div class="chat-order-line"></div>
          <div class="chat-order-step"><div class="chat-order-dot">🏠</div><div class="chat-order-step-label">Delivered</div></div>
        </div>
        <div style="font-size:10px;color:var(--text3);margin-top:10px;text-align:right">${timeStr}</div>`;
      row.appendChild(card);
      msgsEl.appendChild(row);

    } else if (item.type === 'voice-recv') {
      const waveId = 'demo-wave-' + idx;
      const row = document.createElement('div');
      row.className = `chat-msg-row recv${isNewSender ? ' new-sender' : ''}`;
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble';
      bubble.innerHTML = `
        <div class="chat-voice-bubble">
          <button class="chat-voice-play" onclick="chatPlayVoice(this,'${waveId}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg>
          </button>
          <div class="chat-voice-waveform" id="${waveId}"></div>
          <span class="chat-voice-dur">0:12</span>
        </div>
        <div class="chat-bubble-meta" style="float:right;margin-top:4px">${timeStr}</div>`;
      setTimeout(() => {
        const wv = document.getElementById(waveId);
        if (!wv) return;
        const heights = [4,8,14,10,18,12,22,16,20,14,8,18,24,16,12,20,10,16,8,12];
        wv.innerHTML = heights.map(h => `<div class="chat-voice-bar" style="height:${h}px"></div>`).join('');
      }, 50);
      row.appendChild(bubble);
      msgsEl.appendChild(row);
    }

    lastSender = isSent ? 'sent' : 'recv';
  });

  msgsEl.scrollTop = msgsEl.scrollHeight;
}

// ── Send a text message ──
// ── Show "Seen" below last sent message ──
function showSeenIndicator() {
  const msgsEl = document.getElementById('chat-messages');
  if (!msgsEl) return;
  // Remove any existing seen label
  msgsEl.querySelector('.chat-seen-label')?.remove();
  // Find last sent row
  const sentRows = msgsEl.querySelectorAll('.chat-msg-row.sent');
  const lastSent = sentRows[sentRows.length - 1];
  if (!lastSent) return;
  const seen = document.createElement('div');
  seen.className = 'chat-seen-label';
  seen.textContent = 'Seen';
  lastSent.after(seen);
}

async function chatSend() {
  const field = document.getElementById('chat-input-field');
  const text  = field?.value?.trim();
  const hasImage = !!chatPendingImage;

  if (!text && !hasImage) return;
  if (!activeChatId || !currentUser) return;

  // Capture reply & image state then clear immediately
  const replySnapshot = chatReplyTo ? { ...chatReplyTo } : null;
  const imageSnapshot = chatPendingImage ? { ...chatPendingImage } : null;

  field.value = '';
  field.style.height = 'auto';
  chatCancelReply();
  chatCancelImage();

  const msgsEl = document.getElementById('chat-messages');
  const lastRow = msgsEl?.querySelector('.chat-msg-row:last-child');
  const lastSenderId = lastRow ? (lastRow.classList.contains('sent') ? currentUser.id : activeChatUserId) : null;

  // ── IMAGE SEND ──
  if (imageSnapshot) {
    const tmpImgMsg = {
      id: 'tmp-img-' + Date.now(),
      type: 'image',
      content: text || '',
      media_url: imageSnapshot.dataUrl, // optimistic local URL
      sender_id: currentUser.id,
      created_at: new Date().toISOString(),
      sender: currentProfile,
      reply_to_id: replySnapshot?.id || null,
      _replySnapshot: replySnapshot,
    };
    const imgEl = buildMessageEl(tmpImgMsg, lastSenderId);
    if (imgEl && msgsEl) {
      msgsEl.appendChild(imgEl);
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }

    // Upload to Supabase Storage — compress first to fix landscape/HEIC issues
    const compressed = await compressChatImage(imageSnapshot.file);
    const path = `chat/${activeChatId}/${currentUser.id}-${Date.now()}.jpg`;
    const { data: uploadData, error: uploadErr } = await supabase.storage
      .from('media')
      .upload(path, compressed, { contentType: 'image/jpeg', upsert: false });

    if (uploadErr) {
      showToast('Image upload failed');
      imgEl?.remove();
      return;
    }

    const { data: urlData } = supabase.storage.from('media').getPublicUrl(path);
    const publicUrl = urlData.publicUrl;

    if (!publicUrl) {
      showToast('Could not get image URL');
      imgEl?.remove();
      return;
    }

    // Replace optimistic thumb with real URL
    const thumbEl = imgEl?.querySelector('.chat-bubble-img');
    if (thumbEl) thumbEl.src = publicUrl;

    const msgPayload = {
      conversation_id: activeChatId,
      sender_id: currentUser.id,
      type: 'image',
      media_url: publicUrl,
      content: text || '',
      reply_to_id: replySnapshot?.id || null,
    };
    const { error: insertErr } = await supabase.from('messages').insert(msgPayload);
    if (insertErr) showToast('Failed to send image');
    else {
      updateInboxRow(activeChatId, '📷 Photo', new Date().toISOString());
      markConvRead(activeChatId);
    }
    return;
  }

  // ── TEXT SEND ──
  const tmpMsg = {
    id: 'tmp-' + Date.now(),
    type: 'text',
    content: text,
    sender_id: currentUser.id,
    created_at: new Date().toISOString(),
    sender: currentProfile,
    reply_to_id: replySnapshot?.id || null,
    _replySnapshot: replySnapshot,
  };
  const el = buildMessageEl(tmpMsg, lastSenderId);
  if (el && msgsEl) {
    msgsEl.appendChild(el);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  updateInboxRow(activeChatId, text, tmpMsg.created_at);

  const { error } = await supabase.from('messages').insert({
    conversation_id: activeChatId,
    sender_id: currentUser.id,
    type: 'text',
    content: text,
    reply_to_id: replySnapshot?.id || null,
  });

  if (error) showToast('Message failed to send');
  markConvRead(activeChatId);
}

// ── Subscribe to realtime messages ──
function subscribeToChat(convId) {
  if (msgRealtimeSub) supabase.removeChannel(msgRealtimeSub);

  msgRealtimeSub = supabase
    .channel('chat-' + convId)

    // ── New message arrives ──
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: `conversation_id=eq.${convId}`,
    }, payload => {
      const msg = payload.new;
      if (msg.sender_id === currentUser?.id) return;

      supabase.from('users').select('id,username,avatar').eq('id', msg.sender_id).maybeSingle()
        .then(({ data: sender }) => {
          msg.sender = sender;
          const msgsEl = document.getElementById('chat-messages');
          if (!msgsEl) return;
          const lastRow = msgsEl.querySelector('.chat-msg-row:last-child');
          const lastSenderId = lastRow
            ? (lastRow.classList.contains('sent') ? currentUser?.id : activeChatUserId)
            : null;
          const el = buildMessageEl(msg, lastSenderId);
          if (el) {
            msgsEl.appendChild(el);
            msgsEl.scrollTop = msgsEl.scrollHeight;
          }
          markConvRead(convId);
          updateInboxRow(convId, msg.content || '', msg.created_at);
        });
    })

    // ── Other user read the chat → show Seen ──
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'conversation_participants',
    }, payload => {
      // Check it's this conversation and NOT the current user
      if (payload.new.conversation_id === convId &&
          payload.new.user_id !== currentUser?.id &&
          payload.new.last_read_at) {
        showSeenIndicator();
      }
    })

    .subscribe();
}

// ── Update inbox row with latest message (real-time) ──
// ── Show typing in inbox row ──
function setInboxTyping(convId, isTyping) {
  const row = document.querySelector(`.msg-conv-row[data-conv-id="${convId}"]`);
  if (!row) return;
  const preview = row.querySelector('.msg-conv-preview');
  if (!preview) return;
  if (isTyping) {
    if (!preview.dataset.originalText) preview.dataset.originalText = preview.textContent;
    preview.textContent = 'typing...';
    preview.style.color = 'var(--accent)';
    preview.style.fontStyle = 'italic';
    preview.style.fontWeight = '500';
  } else {
    preview.textContent = preview.dataset.originalText || preview.textContent;
    preview.style.color = '';
    preview.style.fontStyle = '';
    preview.style.fontWeight = '';
    preview.dataset.originalText = '';
  }
}

function updateInboxRow(convId, text, time) {
  const row = document.querySelector(`.msg-conv-row[data-conv-id="${convId}"]`);
  if (!row) return;
  const preview = row.querySelector('.msg-conv-preview');
  const timeEl  = row.querySelector('.msg-conv-time');
  if (preview) preview.textContent = text.slice(0, 60) || 'New message';
  if (timeEl)  timeEl.textContent  = msgTimeSince(time);
  // Move row to top of inbox
  const list = document.getElementById('msg-inbox-list');
  if (list && list.firstChild !== row) list.prepend(row);
}

// ── Subscribe to inbox updates (new messages in any conversation) ──
let inboxRealtimeSub = null;
function subscribeToInbox(convIds) {
  if (inboxRealtimeSub) supabase.removeChannel(inboxRealtimeSub);
  if (!convIds?.length) return;

  inboxRealtimeSub = supabase
    .channel('inbox-updates')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'conversations',
    }, payload => {
      const conv = payload.new;
      if (!convIds.includes(conv.id)) return;
      // Update preview and unread badge if message is from other user
      const row = document.querySelector(`.msg-conv-row[data-conv-id="${conv.id}"]`);
      if (!row) { msgInboxLoaded = false; return; } // row not in DOM, force reload next open
      const preview = row.querySelector('.msg-conv-preview');
      const timeEl  = row.querySelector('.msg-conv-time');
      if (preview) preview.textContent = (conv.last_message || '').slice(0, 60);
      if (timeEl)  timeEl.textContent  = msgTimeSince(conv.updated_at);
      // Add unread badge if not currently in this chat
      if (activeChatId !== conv.id) {
        const previewRow = row.querySelector('.msg-conv-preview-row');
        if (previewRow) {
          let badge = previewRow.querySelector('.msg-conv-unread-badge');
          if (!badge) {
            badge = document.createElement('div');
            badge.className = 'msg-conv-unread-badge';
            previewRow.appendChild(badge);
          }
          const current = parseInt(badge.textContent) || 0;
          badge.textContent = current + 1 > 9 ? '9+' : current + 1;
        }
      }
      // Move to top
      const list = document.getElementById('msg-inbox-list');
      if (list && list.firstChild !== row) list.prepend(row);
    })
    .subscribe();
}

// ── Mark conversation as read ──
async function markConvRead(convId) {
  if (!currentUser) return;
  const now = new Date().toISOString();
  
  // Update DB — no catch so we know if it fails
  const { error } = await supabase
    .from('conversation_participants')
    .update({ last_read_at: now })
    .eq('conversation_id', convId)
    .eq('user_id', currentUser.id);

  if (error) {
    console.warn('markConvRead failed:', error.message);
    return;
  }

  // Update badge on inbox row immediately
  const badge = document.querySelector(`.msg-conv-row[data-conv-id="${convId}"] .msg-conv-unread-badge`);
  if (badge) badge.remove();
  const preview = document.querySelector(`.msg-conv-row[data-conv-id="${convId}"] .msg-conv-preview`);
  if (preview) preview.classList.remove('unread');
}

// ── Input helpers ──
function chatInputResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 100) + 'px';
}
function chatInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatSend();
  }
}

// ── Quick action stubs (to be built out) ──


function chatSendCash() {
  showToast('Cash transfer — coming in next update 💸');
}
function chatTagProduct() {
  showToast('Tag a product — coming soon 🛒');
}
function chatMakeOffer() {
  showToast('Price negotiation — coming soon 💬');
}
function chatSendInvoice() {
  showToast('Invoice generator — coming soon 🧾');
}
function chatRecordVoice() {
  showToast('Voice notes — coming soon 🎙');
}
function chatAttach() {
  // Now handled via hidden file input in HTML
  document.getElementById('chat-img-input')?.click();
}

// ── Reply-to state ──
let chatReplyTo = null; // { id, senderName, content, mediaUrl }

function chatSetReply(msgId) {
  const row = document.querySelector(`.chat-msg-row[data-msg-id="${msgId}"]`);
  if (!row) return;
  const bubble = row.querySelector('.chat-bubble');
  if (!bubble) return;

  const isSent = row.classList.contains('sent');
  const name = isSent
    ? (currentProfile?.username || 'You')
    : (activeChatUser?.username || 'them');

  const imgEl = bubble.querySelector('.chat-bubble-img');
  const previewText = imgEl ? '📷 Photo' : (bubble.textContent?.trim().slice(0, 80) || '');
  const mediaUrl = imgEl ? imgEl.src : null;

  chatReplyTo = { id: msgId, senderName: name, content: previewText, mediaUrl };

  const bar = document.getElementById('chat-reply-bar');
  const nameEl = document.getElementById('chat-reply-bar-name');
  const textEl = document.getElementById('chat-reply-bar-text');
  if (bar) bar.style.display = 'flex';
  if (nameEl) nameEl.textContent = name;
  if (textEl) textEl.textContent = previewText;

  document.getElementById('chat-input-field')?.focus();
}

function chatCancelReply() {
  chatReplyTo = null;
  const bar = document.getElementById('chat-reply-bar');
  if (bar) bar.style.display = 'none';
}

// ── Image attach state ──
let chatPendingImage = null; // { file, dataUrl }

function chatImageSelected(input) {
  const file = input.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast('Please select an image'); return; }
  if (file.size > 10 * 1024 * 1024) { showToast('Image must be under 10MB'); return; }

  const reader = new FileReader();
  reader.onload = (e) => {
    chatPendingImage = { file, dataUrl: e.target.result };
    const bar = document.getElementById('chat-img-preview-bar');
    const thumb = document.getElementById('chat-img-preview-thumb');
    if (bar) bar.style.display = 'block';
    if (thumb) thumb.src = e.target.result;
  };
  reader.readAsDataURL(file);
  input.value = '';
}

function chatCancelImage() {
  chatPendingImage = null;
  const bar = document.getElementById('chat-img-preview-bar');
  if (bar) bar.style.display = 'none';
}

// ── Compress image via canvas (handles landscape, HEIC, EXIF rotation) ──
function compressChatImage(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 1280;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
        else                { width = Math.round(width * MAX / height);  height = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => resolve(blob || file), 'image/jpeg', 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}
function chatOpenProfile() {
  if (activeChatUserId) openDM(activeChatUserId);
}
function chatMoreOptions() {
  showToast('More options — coming soon');
}
function chatPlayVoice(btn, waveId) {
  const bars = document.getElementById(waveId)?.querySelectorAll('.chat-voice-bar');
  if (!bars?.length) return;
  let idx = 0;
  btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/></svg>`;
  const iv = setInterval(() => {
    if (idx < bars.length) { bars[idx].classList.add('played'); idx++; }
    else {
      clearInterval(iv);
      bars.forEach(b => b.classList.remove('played'));
      btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg>`;
    }
  }, 200);
}
async function chatRespondOffer(msgId, status) {
  await supabase.from('messages').update({ offer_status: status }).eq('id', msgId);
  showToast(status === 'accepted' ? 'Offer accepted ✓' : status === 'declined' ? 'Offer declined' : 'Counter sent');
  loadChatMessages(activeChatId);
}

function msgShowRequests() {
  showToast('Message requests — coming soon');
}
function msgStartNew() {
  showToast('New message — coming soon');
}
function msgSearch(val) {
  // Filter visible conv rows
  const rows = document.querySelectorAll('.msg-conv-row');
  rows.forEach(r => {
    const name = r.querySelector('.msg-conv-name')?.textContent?.toLowerCase() || '';
    r.style.display = name.includes(val.toLowerCase()) ? '' : 'none';
  });
}

// ══════════════════════════════════════════
// NOTIFICATIONS — PREMIUM ENGINE
// ══════════════════════════════════════════

const NOTIF_CONFIG = {
  GROUPING_WINDOW_MS: 24 * 60 * 60 * 1000,
  GROUPING_THRESHOLD: 3,
  BATCH_SIZE: 50,
  BANNER_DURATION: 4500,
  BANNER_SWIPE_THRESHOLD: 60,
};

const NOTIF_TYPES = {
  like:             { emoji: '❤️',  label: 'liked your post',           badgeClass: 'badge-like',    accentColor: '#f0385a' },
  comment:          { emoji: '💬',  label: 'replied to your post',      badgeClass: 'badge-comment', accentColor: '#6c47ff' },
  follow:           { emoji: '👤',  label: 'started following you',     badgeClass: 'badge-follow',  accentColor: '#00b87a' },
  repost:           { emoji: '🔁',  label: 'reposted your post',        badgeClass: 'badge-repost',  accentColor: '#f5a623' },
  mention:          { emoji: '📣',  label: 'mentioned you',             badgeClass: 'badge-mention', accentColor: '#00c4ff' },
  like_comment:     { emoji: '❤️',  label: 'liked your comment',        badgeClass: 'badge-like',    accentColor: '#f0385a' },
  order_placed:     { emoji: '📦',  label: 'placed an order',           badgeClass: 'badge-order',   accentColor: '#ff6b35' },
  order_shipped:    { emoji: '🚚',  label: 'Your order has shipped',    badgeClass: 'badge-order',   accentColor: '#ff6b35' },
  order_delivered:  { emoji: '✅',  label: 'Order delivered!',          badgeClass: 'badge-order',   accentColor: '#00b87a' },
  payment_received: { emoji: '💰',  label: 'Payment received',          badgeClass: 'badge-wallet',  accentColor: '#00b87a' },
  wallet_credit:    { emoji: '💳',  label: 'Wallet credited',           badgeClass: 'badge-wallet',  accentColor: '#00b87a' },
  system:           { emoji: '📢',  label: '',                           badgeClass: 'badge-system',  accentColor: '#5e5e5a' },
};

const NOTIF_FILTERS = [
  { id: 'all',      label: 'All',      types: null },
  { id: 'social',   label: 'Social',   types: ['like','comment','repost','mention','like_comment'] },
  { id: 'follows',  label: 'Follows',  types: ['follow'] },
  { id: 'commerce', label: 'Commerce', types: ['order_placed','order_shipped','order_delivered'] },
  { id: 'wallet',   label: 'Wallet',   types: ['payment_received','wallet_credit'] },
];

let notifCurrentFilter = 'all';
let notifRawData = [];
let bannerQueue = [];
let bannerShowing = false;
let bannerTimer = null;

// ── LOAD & RENDER ─────────────────────────

async function loadNotifications() {
  if (!currentUser) return;
  const container = document.getElementById('notif-list');
  if (!container) return;

  renderNotifSkeletons(container, 5);

  const { data, error } = await supabase
    .from('notifications')
    .select(`id,created_at,read,type,actor_id,post_id,comment_text,
             actor:users!actor_id(id,username,avatar),
             post:posts!fk_notifications_post_id(id,image,user_id,user:users!user_id(username,avatar))`)
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(NOTIF_CONFIG.BATCH_SIZE);

  if (error) { container.innerHTML = renderNotifEmpty('Something went wrong', 'Pull down to try again.'); return; }

  notifRawData = data || [];
  renderNotifList(notifCurrentFilter);
  updateNotifTabCounts();
}

function renderNotifList(filter) {
  const container = document.getElementById('notif-list');
  if (!container) return;

  const filterDef = NOTIF_FILTERS.find(f => f.id === filter);
  let items = notifRawData;
  if (filterDef && filterDef.types) items = items.filter(n => filterDef.types.includes(n.type));

  if (!items.length) {
    container.innerHTML = renderNotifEmpty(
      filter === 'all' ? 'All caught up! 🎉' : `No ${filterDef?.label?.toLowerCase()} notifications`,
      filter === 'all' ? "When people interact with your posts, you'll see it here." : ''
    );
    return;
  }

  const grouped = groupNotifications(items);
  const now = Date.now();
  const sections = {
    new:     { label: 'New',        items: [] },
    today:   { label: 'Today',      items: [] },
    week:    { label: 'This week',  items: [] },
    earlier: { label: 'Earlier',    items: [] },
  };

  grouped.forEach(g => {
    const age = now - new Date(g.latestAt).getTime();
    if (!g.read && age < 1000 * 60 * 60 * 3) sections.new.items.push(g);
    else if (age < 1000 * 60 * 60 * 24) sections.today.items.push(g);
    else if (age < 1000 * 60 * 60 * 24 * 7) sections.week.items.push(g);
    else sections.earlier.items.push(g);
  });

  let html = '';
  let delay = 0;
  Object.entries(sections).forEach(([, section]) => {
    if (!section.items.length) return;
    html += `<div class="notif-section-header">${section.label}</div>`;
    section.items.forEach(g => { html += renderNotifItem(g, delay); delay += 25; });
  });

  container.innerHTML = html;
  container.querySelectorAll('.notif-item').forEach(el => attachSwipeDismiss(el));
}

function groupNotifications(items) {
  const groups = [];
  const usedIds = new Set();

  items.forEach(item => {
    if (usedIds.has(item.id)) return;

    // Only group: same type + same post_id + DIFFERENT actors within time window
    // One actor liking 3 different posts = 3 separate notifications (never group same actor)
    const canGroup = item.post_id && ['like','repost','comment'].includes(item.type);

    if (canGroup) {
      const siblings = items.filter(s =>
        s.id !== item.id &&
        !usedIds.has(s.id) &&
        s.type === item.type &&
        s.post_id === item.post_id &&
        // CRITICAL: only group DIFFERENT actors on the SAME post
        s.actor_id !== item.actor_id &&
        Math.abs(new Date(s.created_at) - new Date(item.created_at)) < NOTIF_CONFIG.GROUPING_WINDOW_MS
      );

      if (siblings.length >= NOTIF_CONFIG.GROUPING_THRESHOLD - 1) {
        const all = [item, ...siblings];
        // Deduplicate actors by id — never show same username twice
        const seenActorIds = new Set();
        const uniqueActors = all
          .map(s => s.actor)
          .filter(a => {
            if (!a?.id || seenActorIds.has(a.id)) return false;
            seenActorIds.add(a.id);
            return true;
          });
        all.forEach(s => usedIds.add(s.id));
        groups.push({
          grouped: true, type: item.type, post: item.post, post_id: item.post_id,
          actors: uniqueActors,
          actor_id: item.actor_id,
          count: uniqueActors.length, read: all.every(s => s.read),
          latestAt: item.created_at, ids: all.map(s => s.id),
        });
        return;
      }
    }

    usedIds.add(item.id);
    groups.push({ grouped: false, ...item, actors: [item.actor], latestAt: item.created_at, ids: [item.id] });
  });
  return groups;
}

function renderNotifItem(g, animDelay = 0) {
  const cfg = NOTIF_TYPES[g.type] || NOTIF_TYPES.system;
  const isUnread = !g.read;

  let avatarHtml;
  if (g.grouped && g.actors.length > 1) {
    const shown = g.actors.slice(0, 3);
    const extra = g.count - shown.length;
    let imgs = shown.map((a, i) => {
      const src = a?.avatar || `https://api.dicebear.com/7.x/adventurer/svg?seed=${a?.id || i}`;
      return `<img src="${escHtml(src)}" onerror="this.src='https://api.dicebear.com/7.x/adventurer/svg?seed=${i}'" alt="">`;
    }).join('');
    if (extra > 0) imgs += `<span class="stack-more">+${extra > 99 ? '99' : extra}</span>`;
    avatarHtml = `
      <div class="notif-avatar-wrap" style="width:52px;height:48px;">
        <div class="notif-avatar-stack">${imgs}</div>
        <div class="notif-type-badge ${cfg.badgeClass}">${cfg.emoji}</div>
      </div>`;
  } else {
    const actor = g.actors[0] || {};
    const src = actor.avatar || `https://api.dicebear.com/7.x/adventurer/svg?seed=${actor.id || 'x'}`;
    avatarHtml = `
      <div class="notif-avatar-wrap">
        <img class="notif-avatar" src="${escHtml(src)}"
          onerror="this.src='https://api.dicebear.com/7.x/adventurer/svg?seed=fallback'" alt="">
        <div class="notif-type-badge ${cfg.badgeClass}">${cfg.emoji}</div>
      </div>`;
  }

  // Build text
  const actors = g.actors.filter(Boolean);
  let who = '';
  if (g.grouped && actors.length > 1) {
    const names = actors.slice(0, 2).map(a => `<strong>${escHtml(a.username)}</strong>`).join(', ');
    const rest = g.count - 2;
    who = rest > 0 ? `${names} <span class="and-others">and ${fmtNum(rest)} others</span>` : names;
  } else if (actors[0]) {
    who = `<strong>${escHtml(actors[0].username)}</strong>`;
  } else {
    who = '<strong>Someone</strong>';
  }

  const commentPreview = (g.type === 'comment' && g.comment_text)
    ? `<div class="notif-comment-preview">"${escHtml(g.comment_text.slice(0,120))}${g.comment_text.length > 120 ? '…' : ''}"</div>`
    : '';

  const followBtn = (g.type === 'follow' && !g.grouped)
    ? `<button class="notif-follow-btn" id="nfb-${g.actor_id}" onclick="notifFollowToggle('${g.actor_id}',this);event.stopPropagation()">Follow</button>`
    : '';
  if (g.type === 'follow' && !g.grouped) setTimeout(() => loadNotifFollowState(g.actor_id), 100);

  const thumbHtml = (g.post?.image && g.type !== 'follow')
    ? `<div class="notif-thumb-wrap"><img class="notif-thumb" src="${escHtml(g.post.image)}" alt=""></div>`
    : '';

  // Pass type so notifItemClick knows exactly where to navigate
  const clickActorId = g.actor_id || (g.actors[0]?.id) || '';
  const clickTarget = g.post_id
    ? `notifItemClick('${g.post_id}','${clickActorId}','${g.ids.join(',')}','${g.type}')`
    : `notifItemClick(null,'${clickActorId}','${g.ids.join(',')}','${g.type}')`;

  return `
    <div class="notif-item${isUnread ? ' unread' : ''}${g.grouped ? ' grouped' : ''}"
         data-ids="${g.ids.join(',')}"
         style="animation-delay:${animDelay}ms"
         onclick="${clickTarget}">
      ${avatarHtml}
      <div class="notif-body">
        <p class="notif-text">${who} ${cfg.label}</p>
        ${commentPreview}
        ${followBtn}
        <div class="notif-meta">
          <span class="notif-time">${timeSince(g.latestAt)}</span>
          ${isUnread ? '<span class="notif-unread-dot"></span>' : ''}
        </div>
      </div>
      ${thumbHtml}
    </div>`;
}

function renderNotifEmpty(title, sub) {
  return `<div class="notif-empty">
    <div class="notif-empty-icon">🔔</div>
    <div class="notif-empty-title">${escHtml(title)}</div>
    ${sub ? `<p class="notif-empty-sub">${escHtml(sub)}</p>` : ''}
  </div>`;
}

function renderNotifSkeletons(container, count) {
  container.innerHTML = Array.from({ length: count }, () => `
    <div class="notif-skeleton">
      <div class="notif-skeleton-avatar loading-pulse"></div>
      <div class="notif-skeleton-body">
        <div class="notif-skeleton-line w80 loading-pulse"></div>
        <div class="notif-skeleton-line w55 loading-pulse"></div>
      </div>
    </div>`).join('');
}

function updateNotifTabCounts() {
  NOTIF_FILTERS.forEach(f => {
    const tab = document.getElementById(`ntab-${f.id}`);
    const countEl = tab?.querySelector('.tab-count');
    if (!countEl) return;
    let items = notifRawData;
    if (f.types) items = items.filter(n => f.types.includes(n.type));
    const unread = items.filter(n => !n.read).length;
    countEl.textContent = unread > 0 ? (unread > 99 ? '99+' : unread) : '';
    countEl.style.display = unread > 0 ? '' : 'none';
  });
}

function switchNotifFilter(filterId) {
  notifCurrentFilter = filterId;
  document.querySelectorAll('.notif-filter-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.filter === filterId);
  });
  renderNotifList(filterId);
}

async function notifItemClick(postId, actorId, idsStr, type) {
  // ── Mark read ──
  const ids = idsStr.split(',').filter(Boolean);
  if (ids.length) {
    supabase.from('notifications').update({ read: true }).in('id', ids).catch(() => {});
    ids.forEach(id => {
      const el = document.querySelector(`.notif-item[data-ids="${id}"], .notif-item[data-ids^="${id},"], .notif-item[data-ids*=",${id},"], .notif-item[data-ids$=",${id}"]`);
      if (el) { el.classList.remove('unread'); el.querySelector('.notif-unread-dot')?.remove(); }
    });
    unreadCount = Math.max(0, unreadCount - ids.length);
    updateNotifBadge();
    updateNotifTabCounts();
  }

  // CRITICAL: tell slideTo we're coming from notifications
  // so the back button returns here correctly
  lastMainPage = 'notifications';

  const hasPost  = postId  && postId  !== 'null' && postId  !== 'undefined';
  const hasActor = actorId && actorId !== 'null' && actorId !== 'undefined';

  // ── Navigate based on notification type ──
  if (type === 'follow') {
    // Follow notification → open the follower's profile
    if (hasActor) await showUserProfile(actorId, null);

  } else if (type === 'comment' || type === 'mention') {
    // Comment or mention → open post and scroll straight to the comments section
    if (hasPost) await openDetail(postId, true);
    else if (hasActor) await showUserProfile(actorId, null);

  } else if (type === 'like' || type === 'repost' || type === 'like_comment' || type === 'quote') {
    // Like / repost / like_comment / quote → open the post (no comment scroll)
    if (hasPost) await openDetail(postId, false);
    else if (hasActor) await showUserProfile(actorId, null);

  } else if (type === 'order_placed' || type === 'order_shipped' || type === 'order_delivered') {
    // Order notifications → open the product post if available
    if (hasPost) await openDetail(postId, false);
    else showToast('Open the Market tab to view your orders');

  } else if (type === 'payment_received' || type === 'wallet_credit') {
    // Wallet notifications → go straight to wallet page
    slideTo('wallet');

  } else {
    // Fallback for system / unknown types
    if (hasPost) await openDetail(postId, false);
    else if (hasActor) await showUserProfile(actorId, null);
  }
}

async function loadNotifFollowState(actorId) {
  if (!currentUser) return;
  const btn = document.getElementById(`nfb-${actorId}`);
  if (!btn) return;
  const { data } = await supabase.from('follows')
    .select('id').eq('follower_id', currentUser.id).eq('following_id', actorId).maybeSingle();
  if (data) { btn.classList.add('following'); btn.textContent = 'Following'; }
}

async function notifFollowToggle(actorId, btn) {
  if (!currentUser) { showToast('Sign in to follow'); return; }
  const isFollowing = btn.classList.contains('following');
  btn.classList.toggle('following', !isFollowing);
  btn.textContent = !isFollowing ? 'Following' : 'Follow';
  if (isFollowing) {
    const { error } = await supabase.from('follows').delete().eq('follower_id', currentUser.id).eq('following_id', actorId);
    if (error) { btn.classList.add('following'); btn.textContent = 'Following'; }
  } else {
    const { error } = await supabase.from('follows').insert({ follower_id: currentUser.id, following_id: actorId });
    if (error) { btn.classList.remove('following'); btn.textContent = 'Follow'; }
  }
}

async function markAllNotifsRead() {
  if (!currentUser) return;
  await supabase.from('notifications').update({ read: true }).eq('user_id', currentUser.id).eq('read', false);
  unreadCount = 0;
  updateNotifBadge();
  notifRawData.forEach(n => n.read = true);
  renderNotifList(notifCurrentFilter);
  updateNotifTabCounts();
}

// kept as alias so any old internal calls still work
async function markAllRead() { return markAllNotifsRead(); }

// ── BADGE ──────────────────────────────────

async function loadInitialNotifCount() {
  if (!currentUser) return;
  const { count } = await supabase.from('notifications').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id).eq('read', false);
  unreadCount = count || 0;
  updateNotifBadge();
}

function updateNotifDot() { updateNotifBadge(); }

function updateNotifBadge() {
  const dot = document.getElementById('notif-dot');
  if (dot) dot.style.display = unreadCount > 0 ? 'block' : 'none';
  const badge = document.getElementById('notif-count-badge');
  if (badge) {
    if (unreadCount > 0) { badge.classList.add('visible'); badge.textContent = unreadCount > 99 ? '99+' : unreadCount; }
    else badge.classList.remove('visible');
  }
}

// ── REAL-TIME SUBSCRIPTION ────────────────

// ── Safe notification insert — logs errors, never throws ──
async function insertNotification(payload) {
  try {
    // Build clean payload — omit post_id entirely if null/undefined (avoids NOT NULL constraint issues)
    const row = {
      user_id:      payload.user_id,
      actor_id:     payload.actor_id,
      type:         payload.type,
      read:         false,
    };
    if (payload.post_id)      row.post_id      = payload.post_id;
    if (payload.comment_text) row.comment_text = payload.comment_text;

    const { error } = await supabase.from('notifications').insert(row);
    if (error) console.warn(`[notif:${payload.type}] Insert failed:`, error.message, error.details || '', error.hint || '');
    return !error;
  } catch(e) {
    console.warn('[notif] Unexpected error:', e.message);
    return false;
  }
}

function subscribeToNotifs() {
  if (!currentUser || notifChannel) return;
  notifChannel = supabase
    .channel(`notifs-${currentUser.id}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'notifications',
      filter: `user_id=eq.${currentUser.id}`
    }, async (payload) => {
      const n = payload.new;
      if (!n.read) { unreadCount++; updateNotifBadge(); }
      if (navigator.vibrate) navigator.vibrate([40, 20, 40]);

      // Enrich with actor and post in parallel
      const [{ data: actor }, { data: postData }] = await Promise.all([
        supabase.from('users').select('id,username,avatar').eq('id', n.actor_id).maybeSingle(),
        n.post_id ? supabase.from('posts').select('image').eq('id', n.post_id).maybeSingle() : Promise.resolve({ data: null })
      ]);

      const enriched = { ...n, actor, post: postData, actors: [actor], latestAt: n.created_at, ids: [n.id] };
      notifRawData.unshift(enriched);

      queueNotifBanner({ type: n.type, actor, comment_text: n.comment_text, post_image: postData?.image, post_id: n.post_id, actor_id: n.actor_id, id: n.id });

      const notifPage = document.getElementById('page-notifications');
      if (notifPage?.classList.contains('active')) { renderNotifList(notifCurrentFilter); updateNotifTabCounts(); }
    })
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') {
        console.warn('Notif channel error — retrying in 3s');
        notifChannel = null;
        setTimeout(subscribeToNotifs, 3000);
      }
    });
}

// ── BANNER ────────────────────────────────

function queueNotifBanner(data) {
  bannerQueue.push(data);
  if (!bannerShowing) showNextBanner();
}

function showNextBanner() {
  if (!bannerQueue.length) { bannerShowing = false; return; }
  bannerShowing = true;
  showNotifBanner(bannerQueue.shift());
}

function showNotifBanner(data) {
  const cfg = NOTIF_TYPES[data.type] || NOTIF_TYPES.system;
  const actor = data.actor || {};
  const src = actor.avatar || `https://api.dicebear.com/7.x/adventurer/svg?seed=${actor.id || 'x'}`;
  const title = actor.username ? `@${actor.username}` : 'MistyNote';
  const subtitle = (data.type === 'comment' && data.comment_text)
    ? data.comment_text.slice(0, 60) + (data.comment_text.length > 60 ? '…' : '')
    : cfg.label;

  const banner = document.getElementById('notif-banner');
  if (!banner) return;

  banner.style.setProperty('--notif-accent', cfg.accentColor);
  banner.innerHTML = `
    <div class="notif-banner-inner" onclick="notifBannerClick('${data.post_id || ''}','${data.actor_id || ''}','${data.id}')">
      <img class="notif-banner-avatar" src="${escHtml(src)}"
        onerror="this.src='https://api.dicebear.com/7.x/adventurer/svg?seed=fallback'" alt="">
      <div class="notif-banner-content">
        <div class="notif-banner-title">${escHtml(title)}</div>
        <div class="notif-banner-subtitle">${escHtml(subtitle)}</div>
      </div>
      ${data.post_image ? `<img class="notif-banner-thumb" src="${escHtml(data.post_image)}" alt="">` : `<span class="notif-banner-time">now</span>`}
    </div>`;

  requestAnimationFrame(() => { banner.classList.remove('hide'); banner.classList.add('show'); });
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(dismissNotifBanner, NOTIF_CONFIG.BANNER_DURATION);
  attachBannerSwipe(banner);
}

function dismissNotifBanner() {
  const banner = document.getElementById('notif-banner');
  if (!banner) return;
  banner.classList.remove('show');
  banner.classList.add('hide');
  clearTimeout(bannerTimer);
  setTimeout(showNextBanner, 400);
}

function notifBannerClick(postId, actorId, notifId) {
  dismissNotifBanner();
  if (postId) openDetail(postId);
  else if (actorId) showUserProfile(actorId, null);
  if (notifId) supabase.from('notifications').update({ read: true }).eq('id', notifId).catch(() => {});
}

function attachBannerSwipe(banner) {
  let startY = 0, currentY = 0, dragging = false;
  banner.addEventListener('touchstart', e => { startY = e.touches[0].clientY; dragging = true; clearTimeout(bannerTimer); }, { passive: true });
  banner.addEventListener('touchmove', e => {
    if (!dragging) return;
    currentY = e.touches[0].clientY - startY;
    if (currentY < 0) { banner.style.transform = `translateY(${currentY}px)`; banner.style.opacity = String(1 + currentY / 120); }
  }, { passive: true });
  banner.addEventListener('touchend', () => {
    dragging = false;
    if (currentY < -NOTIF_CONFIG.BANNER_SWIPE_THRESHOLD) { dismissNotifBanner(); }
    else { banner.style.transform = ''; banner.style.opacity = ''; bannerTimer = setTimeout(dismissNotifBanner, NOTIF_CONFIG.BANNER_DURATION); }
    currentY = 0;
  });
}

function attachSwipeDismiss(el) {
  let startX = 0, currentX = 0, dragging = false;
  el.addEventListener('touchstart', e => { startX = e.touches[0].clientX; dragging = true; el.classList.add('swiping'); }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (!dragging) return;
    currentX = e.touches[0].clientX - startX;
    if (currentX < 0) el.style.transform = `translateX(${currentX}px)`;
  }, { passive: true });
  el.addEventListener('touchend', () => {
    dragging = false; el.classList.remove('swiping');
    if (currentX < -80) {
      const ids = (el.dataset.ids || '').split(',').filter(Boolean);
      el.classList.add('dismissed');
      setTimeout(() => el.remove(), 300);
      if (ids.length) {
        supabase.from('notifications').delete().in('id', ids).catch(() => {});
        notifRawData = notifRawData.filter(n => !ids.includes(String(n.id)));
        updateNotifTabCounts();
      }
    } else { el.style.transform = ''; }
    currentX = 0;
  });
}

// ── PAGE ENTRY ────────────────────────────

function onNotifPageOpen() {
  buildNotifFilterTabs();
  loadNotifications();
  setTimeout(async () => {
    if (unreadCount > 0) {
      await supabase.from('notifications').update({ read: true }).eq('user_id', currentUser.id).eq('read', false);
      unreadCount = 0;
      updateNotifBadge();
    }
  }, 1200);
}

function buildNotifFilterTabs() {
  const wrap = document.getElementById('notif-filter-tabs');
  if (!wrap || wrap.dataset.built) return;
  wrap.dataset.built = '1';
  wrap.innerHTML = NOTIF_FILTERS.map(f => `
    <button id="ntab-${f.id}" class="notif-filter-tab${f.id === 'all' ? ' active' : ''}"
      data-filter="${f.id}" onclick="switchNotifFilter('${f.id}')">
      ${f.label}
      <span class="tab-count" style="display:none"></span>
    </button>`).join('');
}

// ── DEMO HELPER (remove in production) ────
window.demoNotif = function(type = 'like') {
  queueNotifBanner({ type, actor: { username: 'amara.lagos', avatar: `https://api.dicebear.com/7.x/adventurer/svg?seed=amara` }, comment_text: type === 'comment' ? 'This is so beautiful! 🔥' : null, post_image: null, post_id: null, actor_id: null, id: 'demo-' + Date.now() });
};

function subscribeToPostUpdates() {
  if (postsChannel) return;

  postsChannel = supabase
    .channel('posts-realtime')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'posts'
    }, (payload) => {
      const post = payload.new;
      if (!post?.id) return;

      const postId = post.id;
      const likeCount    = post.like_count    ?? 0;
      const repostCount  = post.repost_count  ?? 0;
      const viewCount    = post.views         ?? 0;

      // ── Like count — plain update, no animation ──
      document.querySelectorAll(`.heart-ai[data-post-id="${postId}"] .like-count`)
        .forEach(el => { el.textContent = likeCount > 0 ? fmtNum(likeCount) : ''; });

      // Detail page like stat — plain update
      if (detailPostId === postId) {
        const statEl = document.querySelector(`.detail-stat-n[data-type="likes"]`);
        if (statEl) statEl.textContent = fmtNum(likeCount);
      }

      // ── Repost count ──
      document.querySelectorAll(`.repost-btn[data-post-id="${postId}"] span`)
        .forEach(el => {
          const currentVal = parseInt(el.textContent || '0') || 0;
          if (currentVal !== repostCount) {
            el.textContent = repostCount > 0 ? fmtNum(repostCount) : '';
          }
        });

      // Detail page repost stat
      if (detailPostId === postId) {
        document.querySelectorAll('.repost-count-display').forEach(el => {
          const currentVal = parseInt(el.textContent || '0') || 0;
          if (currentVal !== repostCount) animateCount(el, repostCount);
        });
      }

      // ── View count ──
      document.querySelectorAll(`.poster[data-post-id="${postId}"] .twits .viewe`)
        .forEach(el => {
          el.textContent = `${fmtNum(viewCount) || 0} views`;
        });

      if (detailPostId === postId) {
        const viewEl = document.querySelector(`.detail-stat-n[data-type="views"]`);
        if (viewEl) {
          const currentVal = parseInt(viewEl.textContent || '0') || 0;
          if (currentVal !== viewCount) animateCount(viewEl, viewCount);
        }
      }
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('✓ Realtime post updates active');
      }
    });
}

// ══════════════════════════════════════════
// ECHOES PANEL
// ══════════════════════════════════════════

function injectEchoesPanel() {
  if (document.getElementById('echoes-overlay')) return;
  const el = document.createElement('div');
  el.id = 'echoes-overlay';
  el.className = 'echoes-overlay';
  el.innerHTML = `
    <div class="echoes-sheet" id="echoes-sheet">
      <div class="echoes-handle-row">
        <span class="echoes-title">✦ echoes</span>
        <button class="echoes-close" onclick="closeEchoes()">✕</button>
      </div>
      <div class="echoes-tabs">
        <button class="echoes-tab active" data-tab="all"     onclick="switchEchoTab('all',this)">All</button>
        <button class="echoes-tab"        data-tab="reposts" onclick="switchEchoTab('reposts',this)">Reposts</button>
        <button class="echoes-tab"        data-tab="replies" onclick="switchEchoTab('replies',this)">Replies</button>
      </div>
      <div class="echoes-body" id="echoes-body">
        <div class="echoes-empty"><div class="echoes-empty-icon">🔇</div><p>No echoes yet</p></div>
      </div>
    </div>
  `;
  el.addEventListener('click', e => { if (e.target === el) closeEchoes(); });
  document.body.appendChild(el);
}

let echoesPostId   = null;
let echoesAllData  = { reposts: [], replies: [] };
let echoesActiveTab = 'all';

async function openEchoes(postId, e) {
  e?.stopPropagation();
  echoesPostId = postId;
  echoesActiveTab = 'all';

  // Reset tabs UI
  document.querySelectorAll('.echoes-tab').forEach(t => t.classList.remove('active'));
  document.querySelector('.echoes-tab[data-tab="all"]')?.classList.add('active');

  const overlay = document.getElementById('echoes-overlay');
  const body    = document.getElementById('echoes-body');
  overlay.classList.add('open');

  // Loading state
  body.innerHTML = `<div class="echoes-empty"><div class="echoes-empty-icon" style="font-size:28px;animation:spin 1s linear infinite">⟳</div><p>Loading echoes…</p></div>`;

  // Fetch reposts and replies in parallel
  const [repostsRes, repliesRes] = await Promise.all([
    supabase
      .from('posts')
      .select(`id, content, created_at, like_count, repost_count, user_id,
               user:users(id, username, avatar)`)
      .eq('reposted_post_id', postId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('comments')
      .select(`id, content, created_at, like_count, user_id,
               user:users(id, username, avatar)`)
      .eq('post_id', postId)
      .is('parent_id', null)
      .order('created_at', { ascending: false })
      .limit(50)
  ]);

  echoesAllData = {
    reposts: repostsRes.data || [],
    replies: repliesRes.data || []
  };

  renderEchoTab('all');
}

function closeEchoes() {
  const overlay = document.getElementById('echoes-overlay');
  overlay?.classList.remove('open');
  echoesPostId = null;
}

function switchEchoTab(tab, btn) {
  echoesActiveTab = tab;
  document.querySelectorAll('.echoes-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  renderEchoTab(tab);
}

function renderEchoTab(tab) {
  const body = document.getElementById('echoes-body');
  const { reposts, replies } = echoesAllData;

  let items = [];
  if (tab === 'all') {
    // Merge and sort by date
    const r = reposts.map(p => ({ ...p, _type: 'repost' }));
    const c = replies.map(p => ({ ...p, _type: 'reply' }));
    items = [...r, ...c].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  } else if (tab === 'reposts') {
    items = reposts.map(p => ({ ...p, _type: 'repost' }));
  } else {
    items = replies.map(p => ({ ...p, _type: 'reply' }));
  }

  if (!items.length) {
    const labels = { all: 'No echoes yet', reposts: 'No reposts yet', replies: 'No replies yet' };
    const icons  = { all: '🔇', reposts: '🔁', replies: '💬' };
    body.innerHTML = `<div class="echoes-empty"><div class="echoes-empty-icon">${icons[tab]}</div><p>${labels[tab]}</p></div>`;
    return;
  }

  body.innerHTML = items.map(item => {
    const user    = item.user || { username: '@unknown', avatar: '' };
    const isRepost = item._type === 'repost';
    const badge   = isRepost
      ? `<span class="echo-type-badge echo-type-repost">🔁 Repost</span>`
      : `<span class="echo-type-badge echo-type-reply">💬 Reply</span>`;
    const text    = item.content
      ? `<p class="echo-text">${escHtml(item.content.slice(0, 200))}${item.content.length > 200 ? '…' : ''}</p>`
      : `<p class="echo-text" style="color:var(--text2);font-style:italic">Reposted without comment</p>`;
    const stats   = isRepost
      ? `<span class="echo-stat">❤️ ${fmtNum(item.like_count||0)}</span><span class="echo-stat">🔁 ${fmtNum(item.repost_count||0)}</span>`
      : `<span class="echo-stat">❤️ ${fmtNum(item.like_count||0)}</span>`;

    return `
      <div class="echo-item" onclick="${isRepost ? `openDetail('${item.id}')` : `openDetail('${echoesPostId}', true)`}; closeEchoes();">
        <img class="echo-avatar" src="${escHtml(user.avatar||'')}" onerror="this.src=''" alt="">
        <div class="echo-content">
          <div class="echo-header">
            <span class="echo-username">${escHtml(user.username)}</span>
            <span class="echo-time">${timeSince(item.created_at)}</span>
            ${badge}
          </div>
          ${text}
          <div class="echo-stats">${stats}</div>
        </div>
      </div>
    `;
  }).join('');
}

// ══════════════════════════════════════════
// POST MENU / ACTION SHEET
// ══════════════════════════════════════════

function showPostMenu(post, el, triggerBtn, fromLongPress = false) {
  const isOwn = currentUser && post.user_id === currentUser.id;
  const actions = isOwn
    ? [
        { label: 'Delete Post', icon: '🗑️', danger: true, action: () => deletePost(post.id, el) }
      ]
    : [
        { label: 'Report Post', icon: '🚩', action: () => showToast('Reported') },
        { label: 'Not Interested', icon: '🙅', action: () => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 300); showToast('Got it'); } }
      ];

  showActionSheet(actions);
}

function showActionSheet(actions) {
  const overlay = document.createElement('div');
  overlay.className = 'action-sheet-overlay';

  const sheet = document.createElement('div');
  sheet.className = 'action-sheet';

  actions.forEach((a, i) => {
    if (i > 0 && a.divider) {
      const div = document.createElement('div');
      div.className = 'action-sheet-divider';
      sheet.appendChild(div);
    }
    const item = document.createElement('div');
    item.className = 'action-sheet-item' + (a.danger ? ' danger' : '');
    item.innerHTML = `${a.icon ? `<span style="font-size:20px">${a.icon}</span>` : ''}<span>${a.label}</span>`;
    item.addEventListener('click', () => { document.body.removeChild(overlay); a.action?.(); });
    sheet.appendChild(item);
  });

  const cancelItem = document.createElement('div');
  cancelItem.className = 'action-sheet-item';
  cancelItem.style.cssText = 'font-weight:700;margin-top:8px;border-top:1px solid var(--border);';
  cancelItem.textContent = 'Cancel';
  cancelItem.addEventListener('click', () => document.body.removeChild(overlay));
  sheet.appendChild(cancelItem);

  overlay.appendChild(sheet);
  overlay.addEventListener('click', e => { if (e.target === overlay) document.body.removeChild(overlay); });
  document.body.appendChild(overlay);
}

async function deletePost(postId, el) {
  if (!currentUser) return;

  // Check if this is a repost before deleting
  const originalPostId = el?.dataset.repostedPostId || null;

  const { error } = await supabase.from('posts').delete().eq('id', postId).eq('user_id', currentUser.id);
  if (error) { showToast('Delete failed'); return; }

  // Animate out
  el.style.transition = 'opacity .3s, transform .3s';
  el.style.opacity = '0'; el.style.transform = 'scale(0.96)';
  setTimeout(() => el.remove(), 300);
  loadedPostIds.delete(postId);
  repostedPosts.delete(originalPostId);

  // If this was a repost — clean up UI on the original post
  if (originalPostId) {
    setRepostUI(originalPostId, false);

    // Fetch real count from DB (trigger already decremented it) and update DOM
    const { data } = await supabase
      .from('posts').select('repost_count').eq('id', originalPostId).single();
    const newCount = data?.repost_count ?? 0;
    document.querySelectorAll(`.repost-btn[data-post-id="${originalPostId}"] span`)
      .forEach(sp => { sp.textContent = newCount > 0 ? fmtNum(newCount) : ''; });
    document.querySelectorAll('.repost-count-display')
      .forEach(sp => { if (detailPostId === originalPostId) sp.textContent = newCount; });
  }

  showToast('Post deleted');
}

// ══════════════════════════════════════════
// EDIT PROFILE
// ══════════════════════════════════════════


// ── Full-screen photo viewer ──
function viewProfilePhoto(url, type, username) {
  if (!url) return;

  // ── Overlay shell ──
  const overlay = document.createElement('div');
  overlay.id = 'photo-viewer-overlay';
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:9999',
    'background:rgba(0,0,0,0)',
    'display:flex;flex-direction:column',
    'align-items:center;justify-content:center',
    'transition:background 0.28s ease',
    '-webkit-backdrop-filter:blur(0px);backdrop-filter:blur(0px)',
    'transition:background 0.28s ease, backdrop-filter 0.28s ease, -webkit-backdrop-filter 0.28s ease',
  ].join(';');

  // ── Close button ──
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
  closeBtn.style.cssText = [
    'position:absolute',
    'top:calc(env(safe-area-inset-top,0px) + 14px)',
    'right:16px',
    'width:38px;height:38px;border-radius:50%',
    'background:rgba(255,255,255,0.12)',
    'border:1px solid rgba(255,255,255,0.18)',
    'display:flex;align-items:center;justify-content:center',
    'cursor:pointer;z-index:2',
    'backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)',
    'transition:background 0.15s',
  ].join(';');
  closeBtn.onmouseover = () => closeBtn.style.background = 'rgba(255,255,255,0.22)';
  closeBtn.onmouseout  = () => closeBtn.style.background = 'rgba(255,255,255,0.12)';

  // ── Type label ──
  const labelEl = document.createElement('div');
  labelEl.textContent = type === 'avatar'
    ? (username ? `@${username}` : 'Profile Photo')
    : (username ? `@${username}'s cover` : 'Cover Photo');
  labelEl.style.cssText = [
    'position:absolute',
    'top:calc(env(safe-area-inset-top,0px) + 20px)',
    'left:50%;transform:translateX(-50%)',
    'color:white;font-size:14px;font-weight:700',
    'font-family:Roboto,-apple-system,sans-serif',
    'text-shadow:0 1px 6px rgba(0,0,0,0.5)',
    'white-space:nowrap;pointer-events:none;z-index:2',
  ].join(';');

  // ── Loading spinner ──
  const spinner = document.createElement('div');
  spinner.style.cssText = [
    'width:36px;height:36px;border-radius:50%',
    'border:3px solid rgba(255,255,255,0.15)',
    'border-top-color:white',
    'animation:photoViewerSpin 0.7s linear infinite',
    'position:absolute',
  ].join(';');

  // ── Image container (for pinch-zoom feel) ──
  const imgWrap = document.createElement('div');
  imgWrap.style.cssText = [
    'display:flex;align-items:center;justify-content:center',
    'width:100%;height:100%',
    'padding:80px 20px calc(env(safe-area-inset-bottom,0px) + 80px)',
    'box-sizing:border-box',
  ].join(';');

  // ── Image ──
  const img = document.createElement('img');
  img.style.cssText = [
    'max-width:100%;max-height:100%',
    'object-fit:contain',
    'opacity:0',
    'transform:scale(0.88)',
    'transition:opacity 0.3s ease, transform 0.3s cubic-bezier(0.34,1.56,0.64,1)',
    type === 'avatar'
      ? 'border-radius:50%;box-shadow:0 0 0 3px rgba(255,255,255,0.25),0 12px 48px rgba(0,0,0,0.6)'
      : 'border-radius:16px;box-shadow:0 12px 48px rgba(0,0,0,0.6)',
    'will-change:transform,opacity',
    'user-select:none;-webkit-user-drag:none',
  ].join(';');

  // ── Bottom user bar ──
  const bottomBar = document.createElement('div');
  bottomBar.style.cssText = [
    'position:absolute;bottom:0;left:0;right:0',
    'padding:16px 20px calc(env(safe-area-inset-bottom,0px) + 16px)',
    'display:flex;align-items:center;gap:12px',
    'background:linear-gradient(transparent, rgba(0,0,0,0.7))',
    'opacity:0;transition:opacity 0.3s ease',
  ].join(';');

  if (username) {
    const dotEl = document.createElement('div');
    dotEl.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#6C47FF;flex-shrink:0';
    const nameEl = document.createElement('span');
    nameEl.textContent = type === 'avatar' ? `@${username}` : `@${username}'s cover photo`;
    nameEl.style.cssText = 'color:white;font-size:14px;font-weight:600;font-family:Roboto,-apple-system,sans-serif';
    bottomBar.appendChild(dotEl);
    bottomBar.appendChild(nameEl);
  }

  // ── Assemble ──
  imgWrap.appendChild(img);
  overlay.appendChild(imgWrap);
  overlay.appendChild(closeBtn);
  overlay.appendChild(labelEl);
  overlay.appendChild(spinner);
  overlay.appendChild(bottomBar);

  // ── Inject spin keyframe once ──
  if (!document.getElementById('photo-viewer-style')) {
    const s = document.createElement('style');
    s.id = 'photo-viewer-style';
    s.textContent = '@keyframes photoViewerSpin{to{transform:rotate(360deg)}}';
    document.head.appendChild(s);
  }

  document.body.appendChild(overlay);

  // ── Animate in ──
  requestAnimationFrame(() => {
    overlay.style.background = 'rgba(0,0,0,0.93)';
    overlay.style.webkitBackdropFilter = 'blur(20px)';
    overlay.style.backdropFilter = 'blur(20px)';
  });

  // ── Load image ──
  img.onload = () => {
    spinner.remove();
    img.style.opacity = '1';
    img.style.transform = 'scale(1)';
    bottomBar.style.opacity = '1';
  };
  img.onerror = () => {
    spinner.remove();
    const err = document.createElement('p');
    err.textContent = 'Could not load photo';
    err.style.cssText = 'color:rgba(255,255,255,0.5);font-size:14px;font-family:Roboto,-apple-system,sans-serif';
    imgWrap.appendChild(err);
  };
  img.src = url;

  // ── Close logic ──
  const closeViewer = () => {
    overlay.style.background = 'rgba(0,0,0,0)';
    overlay.style.webkitBackdropFilter = 'blur(0px)';
    overlay.style.backdropFilter = 'blur(0px)';
    img.style.opacity = '0';
    img.style.transform = 'scale(0.88)';
    setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 300);
  };

  closeBtn.onclick = (e) => { e.stopPropagation(); closeViewer(); };

  // Tap background to close (not the image itself)
  overlay.onclick = (e) => { if (e.target === overlay || e.target === imgWrap) closeViewer(); };

  // Swipe down to close
  let touchStartY = 0;
  overlay.addEventListener('touchstart', e => { touchStartY = e.touches[0].clientY; }, { passive: true });
  overlay.addEventListener('touchend', e => {
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (dy > 80) closeViewer();
  }, { passive: true });

  // Escape key
  const escHandler = (e) => { if (e.key === 'Escape') { closeViewer(); document.removeEventListener('keydown', escHandler); } };
  document.addEventListener('keydown', escHandler);
}

function openEditProfile() {
  // ── FIX 1: Force gallery (no camera) + wire listeners ──
  const avatarInput = document.getElementById('edit-avatar-file');
  const coverInput  = document.getElementById('edit-cover-file');

  if (avatarInput) {
    avatarInput.removeAttribute('capture');   // ← removes camera
    avatarInput.accept = 'image/*';
    avatarInput.onchange = previewAvatar;     // ensure wired
  }
  if (coverInput) {
    coverInput.accept = 'image/*';
    coverInput.onchange = previewCover;       // ← this was missing → cover now works
  }

  // Reset files so same photo can be re-selected
  editAvatarFile = null;
  editCoverFile  = null;
  if (avatarInput) avatarInput.value = '';
  if (coverInput)  coverInput.value  = '';

  // Wire up live username sanitization
  setTimeout(() => {
    const unInput = document.getElementById('edit-username');
    const unError = document.getElementById('edit-username-error');
    const bioInput = document.getElementById('edit-bio');
    const bioCount = document.getElementById('edit-bio-count');

    if (unInput) {
      unInput.addEventListener('input', () => {
        const sanitized = sanitizeUsernameInput(unInput.value);
        if (unInput.value !== sanitized) unInput.value = sanitized;
        const check = validateUsername(sanitized);
        if (unError) unError.textContent = sanitized.length > 0 && !check.valid ? check.error : '';
      });
    }

    if (bioInput && bioCount) {
      bioInput.addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });
      bioInput.addEventListener('input', () => {
        if (bioInput.value.includes('\n')) bioInput.value = bioInput.value.replace(/\n/g, ' ').trim();
        const len = bioInput.value.length;
        bioCount.textContent = len + '/100';
        bioCount.style.color = len >= 90 ? 'var(--red, #ff3b5c)' : 'var(--text3)';
      });
    }
  }, 50);

  if (!currentProfile) return;

  const overlay = document.getElementById('edit-profile-overlay');
  overlay.classList.remove('hidden');

  document.getElementById('edit-username').value = currentProfile.username || '';
  const bioEl = document.getElementById('edit-bio');
  if (bioEl) bioEl.value = currentProfile.bio || '';

  const coverImg = document.getElementById('edit-cover-img');
  const avatarImg = document.getElementById('edit-avatar-img');
  if (coverImg) {
    if (coverImg._objUrl) URL.revokeObjectURL(coverImg._objUrl);
    coverImg.src = currentProfile.cover || '';
  }
  if (avatarImg) {
    if (avatarImg._objUrl) URL.revokeObjectURL(avatarImg._objUrl);
    avatarImg.src = currentProfile.avatar || `https://api.dicebear.com/7.x/adventurer/svg?seed=${currentProfile.id}`;
  }
}

function closeEditProfile() {
  document.getElementById('edit-profile-overlay').classList.add('hidden');
}

function previewAvatar(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast('Please select an image file'); return; }
  if (file.size > 15 * 1024 * 1024) { showToast('Image must be under 15MB'); return; }
  editAvatarFile = file;
  // Use createObjectURL — works on all mobile browsers, no FileReader needed for preview
  const img = document.getElementById('edit-avatar-img');
  if (img) {
    if (img._objUrl) URL.revokeObjectURL(img._objUrl);
    img._objUrl = URL.createObjectURL(file);
    img.src = img._objUrl;
  }
}

function previewCover(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast('Please select an image file'); return; }
  if (file.size > 15 * 1024 * 1024) { showToast('Image must be under 15MB'); return; }
  editCoverFile = file;
  const img = document.getElementById('edit-cover-img');
  if (img) {
    if (img._objUrl) URL.revokeObjectURL(img._objUrl);
    img._objUrl = URL.createObjectURL(file);
    img.src = img._objUrl;
  }
}

// ── Rate limit helpers ──
function daysUntilAllowed(lastChangedISO, limitDays) {
  if (!lastChangedISO) return 0;
  const last    = new Date(lastChangedISO);
  const now     = new Date();
  const elapsed = (now - last) / (1000 * 60 * 60 * 24); // days elapsed
  const remaining = limitDays - elapsed;
  return remaining > 0 ? Math.ceil(remaining) : 0;
}

// ── Log a profile field change ──
async function logProfileChange(field, oldValue, newValue) {
  if (oldValue === newValue) return; // no change, don't log
  await supabase.from('profile_change_log').insert({
    user_id: currentUser.id,
    field,
    old_value: oldValue || null,
    new_value: newValue || null,
  }).catch(() => {}); // never block the save if logging fails
}

async function saveProfile() {
  const rawUsername = document.getElementById('edit-username').value.trim();
  const bioValue    = document.getElementById('edit-bio').value.trim();
  const unError     = document.getElementById('edit-username-error');

  const usernameCheck = validateUsername(rawUsername);
  if (!usernameCheck.valid) {
    if (unError) unError.textContent = usernameCheck.error;
    document.getElementById('edit-username').focus();
    return;
  }

  const usernameChanged = usernameCheck.value.toLowerCase() !== (currentProfile.username || '').toLowerCase();
  const bioChanged      = bioValue !== (currentProfile.bio || '');

  // Rate limit checks
  if (usernameChanged && daysUntilAllowed(currentProfile.username_last_changed, 90) > 0) {
    if (unError) unError.textContent = `Username locked for ${daysUntilAllowed(currentProfile.username_last_changed, 90)} more days`;
    return;
  }
  if (bioChanged && daysUntilAllowed(currentProfile.bio_last_changed, 7) > 0) {
    showToast(`Bio locked for ${daysUntilAllowed(currentProfile.bio_last_changed, 7)} more days`);
    return;
  }

  const updates = {
    username: usernameCheck.value,
    bio: bioValue,
  };

  const saveBtn = document.querySelector('.modal-save');
  if (saveBtn) {
    saveBtn.textContent = 'Saving...';
    saveBtn.disabled = true;
  }

  try {
    // === AVATAR UPLOAD ===
    if (editAvatarFile) {
      showToast('Uploading avatar...');
      updates.avatar = await uploadImage(editAvatarFile, 'avatars');
    }

    // === COVER UPLOAD (NEW BUCKET) ===
    if (editCoverFile) {
      showToast('Uploading cover photo...');
      try {
        updates.cover = await uploadImage(editCoverFile, 'covers');
      } catch (err) {
        console.warn('Covers bucket failed, falling back to avatars bucket (temporary)');
        updates.cover = await uploadImage(editCoverFile, 'avatars'); // safe fallback
      }
    }

    // Save to users table
    const { error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', currentUser.id);

    if (error) throw error;

    // Update local state
    Object.assign(currentProfile, updates);

    updateNavAvatar();
    closeEditProfile();
    renderMyProfile();

    showToast('Profile updated successfully ✓');

  } catch (e) {
    console.error('Save profile error:', e);
    showToast('Failed to save: ' + (e.message || 'Unknown error'));
  } finally {
    if (saveBtn) {
      saveBtn.textContent = 'Save';
      saveBtn.disabled = false;
    }
  }
}

// ══════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════

function showSettings() {
  slideTo('settings');
}

// ══════════════════════════════════════════
// LEGAL PAGES
// ══════════════════════════════════════════

// Called from settings OR from auth screen (before app loads)
function openLegalPage(which) {
  const pageId = 'legal-' + (which === 'privacy' ? 'privacy' : 'terms');

  // If the app is loaded (user is logged in) — use the slide system
  const appEl = document.getElementById('app');
  if (appEl && !appEl.classList.contains('hidden')) {
    // Register in slideTo so back button works
    slideTo(pageId);
    return;
  }

  // Pre-login: inject a temporary overlay so the auth screen Terms/Privacy links work
  // without needing the full slide infrastructure
  const overlay = document.getElementById('legal-overlay');
  const inner   = document.getElementById('legal-overlay-inner');
  if (!overlay || !inner) return;

  // Clone the content from the real slide page into the overlay
  const sourcePage = document.getElementById('page-' + pageId);
  if (!sourcePage) return;

  // Build a simple header + scrollable clone
  const title = which === 'privacy' ? 'Privacy Policy' : 'Terms of Service';
  inner.innerHTML = `
    <div class="legal-overlay-header">
      <button class="back-btn" onclick="closeLegalOverlay()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <span class="legal-overlay-title">${title}</span>
      <div style="width:36px"></div>
    </div>
    <div style="padding-bottom:40px">
      ${sourcePage.querySelector('.legal-scroll')?.innerHTML || ''}
    </div>`;

  // Fix TOC scroll targets to work inside overlay
  inner.querySelectorAll('.legal-toc-item').forEach(item => {
    const onclick = item.getAttribute('onclick') || '';
    const match = onclick.match(/legalScrollTo\('([^']+)'/);
    if (match) {
      item.setAttribute('onclick', `document.getElementById('${match[1]}')?.scrollIntoView({behavior:'smooth',block:'start'})`);
    }
  });

  overlay.classList.remove('hidden');
  overlay.scrollTop = 0;
}

function closeLegalOverlay() {
  const overlay = document.getElementById('legal-overlay');
  if (overlay) overlay.classList.add('hidden');
}

function closeLegalPage() {
  // Check if we used the overlay (pre-login path)
  const overlay = document.getElementById('legal-overlay');
  if (overlay && !overlay.classList.contains('hidden')) {
    closeLegalOverlay();
    return;
  }
  // Normal slide-back path
  slideBack();
}

function legalScrollTo(sectionId, which) {
  // Determine which scroll container to use
  const scrollEl = document.getElementById('legal-' + which + '-scroll');
  const target   = document.getElementById(sectionId);
  if (!scrollEl || !target) return;

  // Get offset of target relative to scroll container
  const containerTop = scrollEl.getBoundingClientRect().top;
  const targetTop    = target.getBoundingClientRect().top;
  const offset       = targetTop - containerTop + scrollEl.scrollTop - 70;

  scrollEl.scrollTo({ top: offset, behavior: 'smooth' });
}

function toggleDarkMode(isDark) {
  if (isDark) {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('darkMode', 'true');
  } else {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('darkMode', 'false');
  }
}

// ══════════════════════════════════════════
// MISTY POINTS WALLET
// Rate is KWD-pegged — fetched live from exchange API, never shown to users.
// Squad by GTC handles all payment gateway operations.
// CheapData handles all bill payment operations.
// No NGN amounts, no MP rate ever rendered in the UI.
// ══════════════════════════════════════════

// ── RATE ENGINE — KWD-PEGGED, 1% FEE EACH SIDE ─────────────
// BASE_RATE  = live KWD → NGN (fetched on wallet open)
// BUY_RATE   = BASE_RATE * 1.01  (1% fee added on MP purchase)
// Payout     = MP * 0.99 * BASE_RATE  (1% fee deducted on payout)
// Fallback if API unreachable: 4400
const BUY_FEE    = 0.01;
const PAYOUT_FEE = 0.01;
let BASE_RATE    = 4400;
let BUY_RATE     = Math.round(BASE_RATE * (1 + BUY_FEE));
let POINTS_RATE  = BUY_RATE;

async function syncPointsRate() {
  try {
    const res  = await fetch('https://open.er-api.com/v6/latest/KWD');
    const data = await res.json();
    const live = data && data.rates && data.rates.NGN;
    if (live && live > 0) {
      BASE_RATE   = Math.round(live);
      BUY_RATE    = Math.round(BASE_RATE * (1 + BUY_FEE));
      POINTS_RATE = BUY_RATE;
    }
  } catch (e) {
    // Silently fall back to last known rates
  }
}

// Format naira — ₦4,400 or ₦10,200.50
function fmtNgn(amount) {
  var n = Number(amount);
  return '₦' + n.toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// ── WALLET STATE ──────────────────────────────────────────────────────────────
const walletState = {
  points: 0,               // user's Misty Points balance (live from DB)
  balanceVisible: true,
  selectedGiftRecipient: null, // renamed from selectedSendRecipient
  giftAmount: 0,           // in points (renamed from sendAmount)
  activeSheet: null,
  txnFilter: 'all',
  squadPublicKey: '',      // set at runtime from Supabase secrets
};

// ── FORMAT HELPERS ────────────────────────────────────────────────────────────
// All user-facing amounts: ✦12 or ✦1,500 — never NGN
function fmtPts(pts) {
  if (pts === null || pts === undefined) return '✦0';
  const n = Number(pts);
  const str = Number.isInteger(n)
    ? n.toLocaleString('en-NG')
    : n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return '\u2736' + str;
}
// Internal-only conversion helpers — results never shown to users
function pointsToNgn(pts) { return pts * POINTS_RATE; }
function ngnToPoints(ngn) { return ngn / POINTS_RATE; }

// ── OPEN WALLET PAGE ──────────────────────────────────────────────────────────
function openWallet() {
  slideTo('wallet');
  syncPointsRate();          // silently refresh KWD→NGN rate in the background
  buildWalletPeopleRow();
  syncWalletBalance();
  loadBankAccount();
  const fab = document.querySelector('.wlt-qr-fab');
  if (fab) fab.classList.remove('hidden');
  const nav = document.getElementById('bottom-nav');
  if (nav) nav.style.display = 'none';
  const app = document.getElementById('app');
  if (app) app.classList.add('wallet-active');
}

// Called by slideBack when leaving wallet page
function onWalletClose() {
  const fab = document.querySelector('.wlt-qr-fab');
  if (fab) fab.classList.add('hidden');
  closeAllWalletSheets();
  const nav = document.getElementById('bottom-nav');
  if (nav) nav.style.display = '';
  const app = document.getElementById('app');
  if (app) app.classList.remove('wallet-active');
}

// ── BALANCE SYNC ──────────────────────────────────────────────────────────────
async function syncWalletBalance() {
  if (!currentUser) return;
  try {
    const { data, error } = await supabase
      .from('wallets')
      .select('points')
      .eq('user_id', currentUser.id)
      .maybeSingle();
    if (error || !data) return;
    walletState.points = data.points ?? 0;
    renderWalletBalance();
  } catch (e) { /* silently fail — show cached value */ }
}

function renderWalletBalance() {
  const el = document.getElementById('wlt-balance');
  if (!el) return;
  el.textContent = fmtPts(walletState.points);
  const hint = document.getElementById('gift-balance-hint');
  if (hint) hint.textContent = 'Balance: ' + fmtPts(walletState.points);
  // Subrow: show live escrow balance
  renderEscrowSubrow();
}

async function renderEscrowSubrow() {
  var subEl = document.getElementById('wlt-escrow-subrow');
  if (!subEl) return;
  // Default immediately — never hang on "Loading..."
  subEl.textContent = 'No pending balance';
  subEl.style.color = 'rgba(255,255,255,0.45)';
  if (!currentUser) return;
  try {
    var res = await supabase
      .from('wallets')
      .select('escrow')
      .eq('user_id', currentUser.id)
      .maybeSingle();
    if (res.error || !res.data) return; // table missing or no row — keep default
    var escrow = Number(res.data.escrow) || 0;
    if (escrow > 0) {
      subEl.textContent = 'Pending: ' + fmtPts(escrow) + ' · releases on delivery';
      subEl.style.color = 'rgba(255,255,255,0.75)';
    }
  } catch (e) {
    // Table not yet created — silently show default, no error surfaced
  }
}

// ── BALANCE VISIBILITY TOGGLE ─────────────────────────────────────────────────
function toggleBalanceVisibility(btn) {
  walletState.balanceVisible = !walletState.balanceVisible;
  const balEl = document.getElementById('wlt-balance');
  if (balEl) balEl.classList.toggle('blurred', !walletState.balanceVisible);
  const eyeOn  = btn.querySelector('.eye-on');
  const eyeOff = btn.querySelector('.eye-off');
  if (eyeOn)  eyeOn.classList.toggle('hidden',  !walletState.balanceVisible);
  if (eyeOff) eyeOff.classList.toggle('hidden', walletState.balanceVisible);
}

// ── QUICK PAY PEOPLE ROW ──────────────────────────────────────────────────────
async function buildWalletPeopleRow() {
  const container = document.getElementById('wlt-people-dynamic');
  if (!container || !currentUser) return;
  try {
    const { data: txns } = await supabase
      .from('wallet_transactions')
      .select('to_user_id, from_user_id')
      .or('from_user_id.eq.' + currentUser.id + ',to_user_id.eq.' + currentUser.id)
      .order('created_at', { ascending: false })
      .limit(10);

    const seen = new Set();
    const userIds = [];
    if (txns) {
      for (const t of txns) {
        const uid = t.from_user_id === currentUser.id ? t.to_user_id : t.from_user_id;
        if (uid && uid !== currentUser.id && !seen.has(uid)) {
          seen.add(uid); userIds.push(uid);
          if (userIds.length >= 8) break;
        }
      }
    }
    if (userIds.length === 0) {
      const { data: follows } = await supabase
        .from('follows').select('following_id')
        .eq('follower_id', currentUser.id).limit(8);
      if (follows) follows.forEach(f => userIds.push(f.following_id));
    }
    if (userIds.length === 0) { container.innerHTML = ''; return; }

    const { data: users } = await supabase
      .from('users').select('id, username, avatar').in('id', userIds);
    if (!users) return;

    container.innerHTML = users.map(u =>
      '<button class="wlt-person-tile" onclick="quickGiftUser(\'' + u.id + '\',\'' + escHtml(u.username) + '\',\'' + (u.avatar || '') + '\')">' +
        '<img class="wlt-person-avatar" src="' + (u.avatar || 'https://api.dicebear.com/7.x/adventurer/svg?seed=' + u.id) + '" alt="">' +
        '<span class="wlt-person-name">' + escHtml((u.username || '').split(' ')[0]) + '</span>' +
      '</button>'
    ).join('');
  } catch (e) { /* non-critical */ }
}

// Quick-gift a user (renamed from quickPayUser)
function quickGiftUser(userId, name, avatarUrl) {
  walletState.selectedGiftRecipient = { id: userId, name, avatarUrl };
  openWalletSheet('gift');
  setTimeout(function() {
    var selBlock = document.getElementById('gift-selected-user');
    var selName  = document.getElementById('gift-sel-name');
    var selUser  = document.getElementById('gift-sel-username');
    var selAv    = document.getElementById('gift-sel-avatar');
    if (selBlock) selBlock.classList.remove('hidden');
    if (selName)  selName.textContent = name;
    if (selUser)  selUser.textContent = '';
    if (selAv)    selAv.src = avatarUrl || ('https://api.dicebear.com/7.x/adventurer/svg?seed=' + userId);
  }, 50);
}
// Legacy compat alias
function quickPayUser(userId, name, avatarUrl) { quickGiftUser(userId, name, avatarUrl); }

// ── SHEET MANAGEMENT ──────────────────────────────────────────────────────────
const SHEET_MAP = {
  'gift':     'sheet-gift',   // was 'send'
  'add':      'sheet-add',
  'bills':    'sheet-bills',
  'qr':       'sheet-qr',
  'earnings': 'sheet-earnings', // auto-payout info — no manual withdraw
};

function openWalletSheet(type) {
  closeAllWalletSheets();
  var id = SHEET_MAP[type];
  if (id) {
    var el = document.getElementById(id);
    if (el) {
      el.classList.remove('hidden');
      walletState.activeSheet = type;
      if (type === 'qr') initQRSheet();
      if (type === 'earnings') renderEarningsSheet();
      return;
    }
  }
  var labels = {
    'split':       'Split Bill — coming soon ✨',
    'find-people': 'Find People — coming soon ✨',
    'history':     'Full Activity History — coming soon ✨',
  };
  showToast(labels[type] || 'Coming soon ✨');
}

function closeWalletSheet(type) {
  var id = SHEET_MAP[type];
  if (id) {
    var el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  }
  walletState.activeSheet = null;
}

function closeAllWalletSheets() {
  Object.values(SHEET_MAP).forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  walletState.activeSheet = null;
}

function walletHandleBackGesture() {
  if (walletState.activeSheet) { closeAllWalletSheets(); return true; }
  return false;
}

// ── GIFT POINTS (was: Send Points) ───────────────────────────────────────────
function updateGiftAmount(val) {
  var num = parseFloat(val.replace(/[^0-9.]/g, '')) || 0;
  walletState.giftAmount = num;
  var btn     = document.getElementById('gift-confirm-btn');
  var amtSpan = document.getElementById('gift-confirm-amount');
  if (btn) btn.disabled = num <= 0 || num > walletState.points;
  if (amtSpan) amtSpan.textContent = num > 0 ? fmtPts(num) : '';
}
// Legacy alias
function updateSendAmount(val) { updateGiftAmount(val); }

async function confirmGiftPoints() {
  var recipient = walletState.selectedGiftRecipient;
  var amount    = walletState.giftAmount;
  var noteEl    = document.getElementById('gift-note');
  var note      = noteEl ? noteEl.value.trim() : '';
  if (!recipient || amount <= 0) return;
  if (amount > walletState.points) { showToast('Not enough Misty Points'); return; }

  closeWalletSheet('gift');
  showToast('Gifting ' + fmtPts(amount) + ' to ' + recipient.name + '...');

  try {
    var res = await supabase.rpc('p2p_transfer_points', {
      sender_id:    currentUser.id,
      recipient_id: recipient.id,
      points:       amount,
      note:         note,
    });
    if (res.error) throw res.error;
    walletState.points -= amount;
    renderWalletBalance();
    showToast('\u2713 Gifted ' + fmtPts(amount) + ' to ' + recipient.name);
    syncWalletBalance();
    refreshTransactionList();
  } catch (e) {
    showToast('Gift failed \u2014 please try again');
    console.error('Points gift error:', e);
  }
}
// Legacy alias
async function confirmSendMoney() { return confirmGiftPoints(); }

function clearGiftRecipient() {
  walletState.selectedGiftRecipient = null;
  var selBlock = document.getElementById('gift-selected-user');
  if (selBlock) selBlock.classList.add('hidden');
}
// Legacy alias
function clearSendRecipient() { clearGiftRecipient(); }

// ── QUICK AMOUNT SETTER ────────────────────────────────────────────────────────
function setQuickAmount(context, points) {
  var inputMap = { add: 'add-amount-input' };
  var el = document.getElementById(inputMap[context]);
  if (!el) return;
  el.value = points;
  el.dispatchEvent(new Event('input'));
  updateBuyPointsPreview(points);
}

// ── BUY POINTS PREVIEW ────────────────────────────────────────────────────────
// Shows the naira cost: MP x BUY_RATE (live KWD x 1.01 — 1% fee)
function updateBuyPointsPreview(val) {
  var pts  = parseFloat(val) || 0;
  var hint = document.getElementById('buy-pts-preview');
  if (!hint) return;
  if (pts <= 0) {
    hint.textContent = 'Enter how many MistyPoints to buy';
    return;
  }
  var cost = Math.round(pts * BUY_RATE);
  hint.textContent = 'You will spend ' + fmtNgn(cost);
}

// ── BUY POINTS VIA SQUAD BY GTC ───────────────────────────────────────────────
// User picks how many Misty Points. NGN amount computed internally — never shown.
function initiateBuyPoints() {
  var ptInput = document.getElementById('add-amount-input');
  var points  = parseFloat((ptInput ? ptInput.value : '') || '0');
  if (!points || points <= 0) { showToast('Enter how many points to buy'); return; }
  if (!currentUser) { showToast('Please sign in first'); return; }

  var ngnAmount = pointsToNgn(points); // internal only — never shown to user

  // Squad JS SDK: https://checkout.squadco.com/widget/squad.min.js
  // Constructor is `new squad({...})` (lowercase). onSuccess fires with no args —
  // verification is done server-side via webhook or explicit verify call using txRef.
  if (typeof squad === 'undefined') {
    loadScript('https://checkout.squadco.com/widget/squad.min.js', function() {
      runSquadPayment(points, ngnAmount);
    });
  } else {
    runSquadPayment(points, ngnAmount);
  }
}

function runSquadPayment(points, ngnAmount) {
  var txRef = 'MN-' + currentUser.id + '-' + Date.now();

  var squadInstance = new squad({
    onLoad:    function() { /* widget ready */ },
    onClose:   function() { /* user dismissed — no action needed */ },
    onSuccess: async function() {
      // onSuccess fires when Squad confirms payment on their side.
      // We verify server-side via our edge function using txRef.
      // txRef was generated above and sent to Squad as transaction_ref.
      closeWalletSheet('add');
      showToast('Verifying payment\u2026');
      try {
        await creditPointsSquad(txRef, points);
        showToast(fmtPts(points) + ' added to your wallet \u2713');
        syncWalletBalance();
        refreshTransactionList();
      } catch (e) {
        showToast('Payment received \u2014 points will reflect shortly');
      }
    },
    key:              walletState.squadPublicKey,  // set from Supabase secrets at runtime
    email:            currentUser.email,
    amount:           ngnAmount * 100,             // Squad expects kobo
    currency_code:    'NGN',
    transaction_ref:  txRef,
    customer_name:    (currentUser.user_metadata && currentUser.user_metadata.full_name) || '',
    // Squad modal shows card, bank transfer, and USSD tabs natively.
    // Omitting payment_channels lets Squad show all available options.
  });

  squadInstance.setup();
  squadInstance.open();
}

async function creditPointsSquad(txRef, points) {
  // Supabase edge function calls Squad's verify endpoint server-side:
  // GET https://api-d.squadco.com/transaction/verify/{txRef}
  // Authorization: Bearer <squad_secret_key>
  // On success it credits walletState.points via RPC.
  var res = await supabase.functions.invoke('credit-points', {
    body: { tx_ref: txRef, points: points, user_id: currentUser.id, gateway: 'squad' }
  });
  if (res.error) throw res.error;
}

// Legacy no-ops — Squad's own modal handles its loading UI
function showFlutterwaveLoader() {}
function hideFlutterwaveLoader() {}

// ── CHEAPDATA BILL PAYMENT ────────────────────────────────────────────────────
// CheapData API: https://www.cheapdata.com.ng/developer
// Each bill type maps to a CheapData endpoint.
// Deducts walletState.points via RPC after successful API call.

const CHEAPDATA_SERVICE_MAP = {
  // Airtime
  airtime: {
    label:    'Airtime Top-up',
    networks: ['MTN', 'Airtel', 'Glo', '9Mobile'],
    type:     'airtime',
  },
  // Data bundles
  data: {
    label:    'Data Bundle',
    networks: ['MTN', 'Airtel', 'Glo', '9Mobile'],
    type:     'data',
    // CheapData network codes: mtn=1, glo=2, airtel=4, 9mobile=3
  },
  // Cable TV
  tv: {
    label:    'TV / Cable',
    providers: ['DSTV', 'GOtv', 'StarTimes', 'ShowMax'],
    type:     'cabletv',
    // CheapData service: dstv, gotv, startimes
  },
  // Electricity
  electricity: {
    label:    'Electricity',
    providers: ['IKEDC', 'EKEDC', 'IBEDC', 'PHED', 'AEDC', 'KEDCO', 'JEDC', 'BEDC', 'EEDC'],
    type:     'electricity',
  },
  // Betting
  betting: {
    label:    'Betting / Gaming',
    providers: ['Bet9ja', 'SportyBet', '1xBet', 'NairaBet', 'MSport'],
    type:     'betting',
    // CheapData: betcode funding
  },
  // Internet
  internet: {
    label:    'Internet / Broadband',
    providers: ['Spectranet', 'Smile', 'Swift', 'iPNX'],
    type:     'internet',
  },
};

function openBillSheet(type) {
  closeAllWalletSheets();
  const config = CHEAPDATA_SERVICE_MAP[type];
  const label = config ? config.label : type;

  // TODO: When CheapData API keys are ready (store in Supabase secrets as
  // 'cheapdata_api_key'), build a dynamic form sheet for each bill type here.
  // Flow: user fills form → call Supabase Edge Function 'pay-bill' →
  //   Edge Function calls CheapData API → deducts walletState.points via RPC.
  //
  // CheapData endpoints (via your Supabase edge function):
  //   POST https://www.cheapdata.com.ng/api/v1/airtime/  → { network, mobile_number, airtime_amount, Ported_number }
  //   POST https://www.cheapdata.com.ng/api/v1/data/     → { network, mobile_number, plan, Ported_number }
  //   POST https://www.cheapdata.com.ng/api/v1/cabletv/  → { cablename, smart_card_number, Validity }
  //   POST https://www.cheapdata.com.ng/api/v1/electricity/ → { disco_name, meter_number, amount, meter_type }
  //
  // Auth header: Authorization: Token <cheapdata_api_key>

  showToast(label + ' — coming soon ✨');
}

// ── QR CODE ───────────────────────────────────────────────────────────────────
function initQRSheet() {
  if (!currentUser) return;
  var avatar = document.getElementById('qr-avatar');
  var name   = document.getElementById('qr-name');
  if (avatar && currentProfile && currentProfile.avatar) avatar.src = currentProfile.avatar;
  if (name) name.textContent = '@' + ((currentProfile && currentProfile.username) || '');
}

function copyPayLink() {
  var link = 'https://mistynote.app/pay/' + ((currentProfile && currentProfile.username) || '');
  if (navigator.clipboard) {
    navigator.clipboard.writeText(link)
      .then(function() { showToast('Pay link copied \u2713'); })
      .catch(function() { showToast('Copy: ' + link); });
  } else {
    showToast('Copy: ' + link);
  }
}

function shareQRCode() {
  var link = 'https://mistynote.app/pay/' + ((currentProfile && currentProfile.username) || '');
  if (navigator.share) {
    navigator.share({ title: 'Send me Misty Points', url: link }).catch(function() {});
  } else {
    copyPayLink();
  }
}

function openQRScan(context) {
  showToast('QR Scanner \u2014 coming soon \uD83D\uDCF7');
}

// ── PENDING REQUEST ACTIONS ───────────────────────────────────────────────────
async function handlePendingRequest(btn, action) {
  var item = btn.closest('.wlt-pending-item');
  if (!item) return;
  if (action === 'accept') {
    item.style.opacity = '0.5';
    item.style.pointerEvents = 'none';
    showToast('Points sent \u2713');
    setTimeout(function() { item.remove(); }, 800);
    updatePendingCount(-1);
  } else {
    item.style.opacity = '0.5';
    item.style.pointerEvents = 'none';
    showToast('Request declined');
    setTimeout(function() { item.remove(); }, 500);
    updatePendingCount(-1);
  }
}

function updatePendingCount(delta) {
  var badge = document.getElementById('wlt-pending-count');
  if (!badge) return;
  var curr = parseInt(badge.textContent) || 0;
  var next = Math.max(0, curr + delta);
  badge.textContent = next;
  if (next === 0) {
    var section = document.getElementById('wlt-pending-section');
    if (section) section.classList.add('hidden');
  }
}

// ── TRANSACTION FILTER ────────────────────────────────────────────────────────
function filterWalletTxns(tab, filter) {
  document.querySelectorAll('.wlt-txn-tab').forEach(function(t) { t.classList.remove('active'); });
  tab.classList.add('active');
  walletState.txnFilter = filter;
  document.querySelectorAll('.wlt-txn-item').forEach(function(item) {
    if (filter === 'all') {
      item.classList.remove('hidden');
    } else {
      item.classList.toggle('hidden', item.dataset.type !== filter);
    }
  });
}

async function refreshTransactionList() {
  // TODO: query wallet_transactions from Supabase and re-render wlt-txn-list
}

// ── USER SEARCH (gift) ────────────────────────────────────────────────────────
var searchDebounceTimer;
async function searchWalletUser(query, context) {
  clearTimeout(searchDebounceTimer);
  var resultsEl = context === 'gift' ? document.getElementById('gift-results') : null;
  if (!resultsEl) return;
  if (!query || query.length < 2) { resultsEl.classList.add('hidden'); return; }

  searchDebounceTimer = setTimeout(async function() {
    try {
      var q = query.replace(/^@/, '').trim().toLowerCase();
      var res = await supabase
        .from('users')
        .select('id, username, avatar')
        .ilike('username', '%' + q + '%')
        .neq('id', currentUser.id)
        .limit(6);
      var users = res.data;

      if (!users || !users.length) {
        resultsEl.innerHTML = '<div class="wlt-search-result-item"><div style="color:var(--text3);font-size:13px;padding:4px 0">No users found</div></div>';
        resultsEl.classList.remove('hidden');
        return;
      }
      resultsEl.innerHTML = users.map(function(u) {
        return '<div class="wlt-search-result-item" onclick="selectWalletUser(\'' + u.id + '\',\'' + escHtml(u.username) + '\',\'' + (u.avatar || '') + '\',\'' + context + '\')">' +
          '<img class="wlt-search-result-avatar" src="' + (u.avatar || 'https://api.dicebear.com/7.x/adventurer/svg?seed=' + u.id) + '" alt="">' +
          '<div><div class="wlt-search-result-name">' + escHtml(u.username) + '</div>' +
          '<div class="wlt-search-result-user">@' + escHtml(u.username) + '</div></div>' +
          '</div>';
      }).join('');
      resultsEl.classList.remove('hidden');
    } catch (e) { /* silent */ }
  }, 280);
}

function selectWalletUser(userId, name, avatarUrl, context) {
  if (context === 'gift') {
    walletState.selectedGiftRecipient = { id: userId, name: name, avatarUrl: avatarUrl };
    var sel     = document.getElementById('gift-selected-user');
    var selName = document.getElementById('gift-sel-name');
    var selAv   = document.getElementById('gift-sel-avatar');
    if (sel)     sel.classList.remove('hidden');
    if (selName) selName.textContent = name;
    if (selAv)   selAv.src = avatarUrl || ('https://api.dicebear.com/7.x/adventurer/svg?seed=' + userId);
    var resultsEl = document.getElementById('gift-results');
    if (resultsEl) resultsEl.classList.add('hidden');
    var searchEl = document.getElementById('gift-search');
    if (searchEl) searchEl.value = '';
    var amtEl = document.getElementById('gift-amount-input');
    if (amtEl) amtEl.focus();
  }
}

// ── DM PAYMENT BRIDGE ─────────────────────────────────────────────────────────
function openDMPaySheet(recipientUserId, recipientName, avatarUrl) {
  quickGiftUser(recipientUserId, recipientName, avatarUrl);
}

function renderDMMoneyBubble(opts) {
  var amount    = opts.amount;
  var note      = opts.note;
  var status    = opts.status;
  var direction = opts.direction;
  var sign = direction === 'incoming' ? '+' : '-';
  var col  = direction === 'incoming' ? 'var(--green)' : 'white';
  return '<div class="msg-money-bubble">' +
    '<div class="msg-money-amount" style="color:' + col + '">' + sign + fmtPts(amount) + '</div>' +
    (note ? '<div class="msg-money-note">' + escHtml(note) + '</div>' : '') +
    '<div class="msg-money-status">' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>' +
      (status === 'completed' ? 'Gifted' : status) +
    '</div></div>';
}

// ── MARKET PURCHASE BRIDGE ────────────────────────────────────────────────────
async function purchaseProduct(opts) {
  var productId = opts.productId;
  var sellerId  = opts.sellerId;
  var points    = opts.points;
  var title     = opts.title;
  if (!currentUser) { showToast('Please sign in to purchase'); return; }
  if (points > walletState.points) {
    showToast('Not enough Misty Points \u2014 buy more first');
    openWalletSheet('add');
    return;
  }
  try {
    var res = await supabase.rpc('escrow_hold_points', {
      buyer_id:   currentUser.id,
      seller_id:  sellerId,
      product_id: productId,
      points:     points,
    });
    if (res.error) throw res.error;
    walletState.points -= points;
    renderWalletBalance();
    showToast('Order placed! ' + fmtPts(points) + ' held in escrow \u2713');
  } catch (e) {
    showToast('Purchase failed \u2014 please try again');
    console.error('purchaseProduct error:', e);
  }
}

// ── NOTE EMOJI PICKER ─────────────────────────────────────────────────────────
var NOTE_EMOJIS = ['\uD83D\uDE0A','\uD83C\uDF82','\uD83D\uDE4F','\uD83D\uDCBC','\uD83C\uDF55','\uD83C\uDF89','\u2736','\uD83D\uDE95','\uD83D\uDED9','\u2764\uFE0F','\uD83D\uDE4C','\u2615'];
var emojiPickerOpen = false;

function pickNoteEmoji(span) {
  if (emojiPickerOpen) return;
  emojiPickerOpen = true;
  var picker = document.createElement('div');
  picker.style.cssText = 'position:fixed;z-index:9999;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:12px;display:grid;grid-template-columns:repeat(6,1fr);gap:4px;box-shadow:var(--shadow-lg);bottom:120px;left:50%;transform:translateX(-50%);';
  picker.innerHTML = NOTE_EMOJIS.map(function(e) {
    return '<button style="font-size:22px;padding:6px;border-radius:10px;transition:background 0.1s" onmouseover="this.style.background=\'var(--bg3)\'" onmouseout="this.style.background=\'\'" onclick="selectNoteEmoji(this.closest(\'.wlt-note-wrap\').querySelector(\'.wlt-note-emoji\'),\'' + e + '\',this.closest(\'div\'))">' + e + '</button>';
  }).join('');
  document.body.appendChild(picker);
  setTimeout(function() {
    document.addEventListener('click', function() {
      picker.remove(); emojiPickerOpen = false;
    }, { once: true });
  }, 10);
}

function selectNoteEmoji(span, emoji, picker) {
  if (span) span.textContent = emoji;
  picker.remove(); emojiPickerOpen = false;
}

// ── LEGACY COMPAT ─────────────────────────────────────────────────────────────
function walletAction(type) {
  // Map old action names to new ones
  var map = {
    add:             'add',
    send:            'gift',      // send → gift
    gift:            'gift',
    bills:           'bills',
    history:         'history',
    'sell-withdraw': 'earnings',
    'withdraw-bank': 'earnings',
    'gift-points':   'gift',
  };
  openWalletSheet(map[type] || type);
}


// ── EARNINGS SHEET ────────────────────────────────────────────────────────────
// No manual withdrawal. Every Friday 3pm the system automatically pays out
// the full balance (if >= 1 MP) minus 1% settlement fee to registered bank.

function openEarningsSheet() {
  openWalletSheet('earnings');
  renderEarningsSheet();
}

function renderEarningsSheet() {
  // Next Friday at 15:00 WAT (UTC+1)
  var now    = new Date();
  var day    = now.getDay(); // 0=Sun, 5=Fri
  var daysToFriday = (5 - day + 7) % 7 || 7; // if today is Friday, show next Friday
  var nextFriday = new Date(now);
  nextFriday.setDate(now.getDate() + daysToFriday);
  nextFriday.setHours(15, 0, 0, 0);

  var dateStr = nextFriday.toLocaleDateString('en-NG', { weekday:'long', day:'numeric', month:'long' });

  var balEl    = document.getElementById('earnings-balance');
  var netEl    = document.getElementById('earnings-net');
  var dateEl   = document.getElementById('earnings-date');
  var statusEl = document.getElementById('earnings-status');

  var pts        = walletState.points;
  var netPts    = Math.floor(pts * (1 - PAYOUT_FEE) * 100) / 100;
  var payoutNgn = Math.round(netPts * BASE_RATE);
  var feePts    = Math.floor(pts * PAYOUT_FEE * 100) / 100;
  var eligible   = pts >= 1;

  if (balEl)    balEl.textContent = fmtPts(pts);
  if (dateEl)   dateEl.textContent = dateStr + ' · 3:00 PM';
  if (netEl) {
    if (eligible) {
      netEl.innerHTML =
        fmtNgn(payoutNgn) +
        '<span style="font-size:11px;font-weight:400;color:var(--text3);margin-left:6px;">' +
        '(' + fmtPts(netPts) + ' after 1% fee)' +
        '</span>';
    } else {
      netEl.textContent = '—';
    }
  }
  if (statusEl) statusEl.textContent = eligible
    ? 'Estimated bank credit based on live KWD rate'
    : 'Minimum ✶1 required for payout. Balance rolls over.';

  // Bank account display
  renderEarningsBankInfo();
}

function renderEarningsBankInfo() {
  var bankEl = document.getElementById('earnings-bank-info');
  if (!bankEl) return;
  var bank = walletState.bankAccount;
  if (bank && bank.account_number) {
    bankEl.innerHTML =
      '<div class="earn-bank-row">' +
        '<div class="earn-bank-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></div>' +
        '<div class="earn-bank-details">' +
          '<div class="earn-bank-name">' + escHtml(bank.bank_name) + '</div>' +
          '<div class="earn-bank-num">' + bank.account_number.replace(/(.{3})(.+)(.{4})/, '$1 •••• $3') + '</div>' +
        '</div>' +
        '<button class="earn-bank-change" onclick="openBankSetup()">Change</button>' +
      '</div>';
  } else {
    bankEl.innerHTML =
      '<button class="earn-add-bank-btn" onclick="openBankSetup()">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>' +
        'Add bank account for payouts' +
      '</button>';
  }
}

function openBankSetup() {
  // Show inline bank account form inside earnings sheet
  var formEl = document.getElementById('earnings-bank-form');
  if (formEl) formEl.classList.toggle('hidden');
}

async function saveBankAccount() {
  var bankName  = document.getElementById('bank-name-input')  ? document.getElementById('bank-name-input').value.trim()  : '';
  var acctNum   = document.getElementById('bank-acct-input')  ? document.getElementById('bank-acct-input').value.trim()  : '';
  var acctName  = document.getElementById('bank-acct-name')   ? document.getElementById('bank-acct-name').value.trim()   : '';
  if (!bankName || !acctNum || acctNum.length !== 10) {
    showToast('Enter a valid 10-digit account number');
    return;
  }
  try {
    var res = await supabase
      .from('user_bank_accounts')
      .upsert({ user_id: currentUser.id, bank_name: bankName, account_number: acctNum, account_name: acctName })
      .select().single();
    if (res.error) throw res.error;
    walletState.bankAccount = res.data;
    showToast('Bank account saved ✓');
    var formEl = document.getElementById('earnings-bank-form');
    if (formEl) formEl.classList.add('hidden');
    renderEarningsBankInfo();
  } catch (e) {
    showToast('Could not save bank account — try again');
  }
}

async function loadBankAccount() {
  if (!currentUser) return;
  try {
    var res = await supabase
      .from('user_bank_accounts')
      .select('*')
      .eq('user_id', currentUser.id)
      .maybeSingle();
    if (res.data) walletState.bankAccount = res.data;
  } catch (e) { /* silent */ }
}

function loadScript(src, cb) {
  var s = document.createElement('script');
  s.src = src; s.onload = cb;
  document.head.appendChild(s);
}


// ══════════════════════════════════════════
// VIEW TRACKING
// ══════════════════════════════════════════

async function recordView(postId) {
  if (!currentUser || !postId) return;
  try {
    const el = document.querySelector(`.poster[data-post-id="${postId}"]`);
    if (el) el.dataset.viewTracked = 'true';
    const { error } = await supabase.rpc('record_post_view', {
      p_post_id: postId,
      p_user_id: currentUser.id
    });
    if (error) console.warn('recordView error (non-fatal):', error.message);
  } catch (err) {
    console.warn('recordView error (non-fatal):', err.message);
  }
}

// ══════════════════════════════════════════
// IMAGE UPLOAD — avatar + cover
// ══════════════════════════════════════════

async function uploadImage(file, bucket) {
  if (!file) throw new Error('No file provided');
  if (!currentUser) throw new Error('Not logged in');

  const maxPx = bucket === 'covers' ? 1400 : 500;
  const compressed = await compressImage(file, maxPx);

  // Always overwrite same path per user — no storage bloat, no rate limit
  const slot = bucket === 'covers' ? 'cover' : 'avatar';
  const path = `${currentUser.id}/${slot}.jpg`;

  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, compressed, { upsert: true, contentType: 'image/jpeg' });

  if (error) {
    console.error(`[uploadImage] Storage error (${bucket}):`, error);
    throw new Error(error.message || 'Upload failed');
  }

  // Cache-bust so browser fetches fresh image immediately
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl + '?t=' + Date.now();
}

// Compress image using createObjectURL — avoids FileReader memory issues on mobile
function compressImage(file, maxPx) {
  return new Promise((resolve, reject) => {
    // createObjectURL is instant, synchronous, never fails with "cannot read file"
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not load image — file may be corrupted'));
    };

    img.onload = () => {
      URL.revokeObjectURL(objectUrl); // free memory immediately after load

      try {
        const scale = Math.min(1, maxPx / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
        const w = Math.max(1, Math.round(img.naturalWidth  * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));

        const canvas = document.createElement('canvas');
        canvas.width  = w;
        canvas.height = h;

        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas not supported')); return; }

        ctx.drawImage(img, 0, 0, w, h);

        canvas.toBlob(
          blob => {
            if (!blob) { reject(new Error('Compression produced no output')); return; }
            resolve(blob);
          },
          'image/jpeg',
          0.85
        );
      } catch (err) {
        reject(err);
      }
    };

    img.src = objectUrl;
  });
}

// ══════════════════════════════════════════
// SHARE
// ══════════════════════════════════════════

function sharePost(post) {
  const text = post.content ? post.content.slice(0, 100) : 'Check this out on MistyNote';
  const url  = window.location.origin + '/post/' + post.id;
  if (navigator.share) {
    navigator.share({ title: 'MistyNote', text, url }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(url).then(() => showToast('Link copied!'));
  }
}

function shareMyProfile() {
  const user = currentProfile;
  const text = user?.username ? `Check out ${user.username} on MistyNote` : 'Check out my profile on MistyNote';
  const url  = user?.username ? window.location.origin + '/profile/' + user.username : window.location.origin;
  if (navigator.share) {
    navigator.share({ title: 'MistyNote', text, url }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(url).then(() => showToast('Profile link copied!'));
  }
}

// ── PROFILE SHARE SHEET ──
let shareSheetProfile = null; // stores the profile being shared

async function openProfileShare(profile) {
  shareSheetProfile = profile;
  const overlay = document.getElementById('profile-share-overlay');
  const sheet   = document.getElementById('profile-share-sheet');
  if (!overlay || !sheet) return;

  overlay.classList.remove('hidden');
  setTimeout(() => sheet.classList.add('open'), 10);

  const row = document.getElementById('share-followers-row');
  if (!row) return;

  if (!currentUser) {
    row.innerHTML = '<span style="font-size:13px;color:var(--text3);padding:8px 0;">Sign in to share</span>';
    return;
  }

  row.innerHTML = '<span style="font-size:13px;color:var(--text3);padding:8px 0;">Loading…</span>';

  try {
    // Get people I follow — simple query without fkey alias
    const { data: follows } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', currentUser.id)
      .limit(10);

    if (!follows?.length) {
      row.innerHTML = '<span style="font-size:13px;color:var(--text3);padding:8px 0;">Follow people to share with them</span>';
      return;
    }

    const ids = follows.map(f => f.following_id);
    const { data: users } = await supabase
      .from('users')
      .select('id,username,avatar')
      .in('id', ids)
      .limit(8);

    if (!users?.length) {
      row.innerHTML = '<span style="font-size:13px;color:var(--text3);padding:8px 0;">No one to show yet</span>';
      return;
    }

    row.innerHTML = users.map(u => {
      const avatar = u.avatar || `https://api.dicebear.com/7.x/adventurer/svg?seed=${u.username}`;
      return `
        <div class="share-person" onclick="shareToDM('${u.id}','${escHtml(u.username)}')">
          <img class="share-person-avatar" src="${avatar}" onerror="this.src='https://api.dicebear.com/7.x/adventurer/svg?seed=${u.username}'" alt="">
          <span class="share-person-name">${escHtml(u.username)}</span>
        </div>`;
    }).join('');

  } catch(e) {
    row.innerHTML = '<span style="font-size:13px;color:var(--text3);padding:8px 0;">Could not load</span>';
  }
}

function closeProfileShare(e) {
  if (e && e.target !== document.getElementById('profile-share-overlay')) return;
  const overlay = document.getElementById('profile-share-overlay');
  const sheet   = document.getElementById('profile-share-sheet');
  sheet?.classList.remove('open');
  setTimeout(() => overlay?.classList.add('hidden'), 380);
}

function getProfileUrl(profile) {
  return profile?.username
    ? `${window.location.origin}/profile/${profile.username}`
    : window.location.origin;
}

function shareToApp(app) {
  if (!shareSheetProfile) return;
  const url  = getProfileUrl(shareSheetProfile);
  const text = `Check out ${shareSheetProfile.username} on MistyNote`;
  const encoded = encodeURIComponent(url);
  const encodedText = encodeURIComponent(text);
  const links = {
    whatsapp:  `https://wa.me/?text=${encodedText}%20${encoded}`,
    facebook:  `https://www.facebook.com/sharer/sharer.php?u=${encoded}`,
    twitter:   `https://twitter.com/intent/tweet?text=${encodedText}&url=${encoded}`,
    telegram:  `https://t.me/share/url?url=${encoded}&text=${encodedText}`,
    instagram: null // Instagram has no web share URL — use native share
  };
  if (app === 'instagram') {
    if (navigator.share) {
      navigator.share({ title: 'MistyNote', text, url }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(url).then(() => showToast('Link copied — paste in Instagram'));
    }
    return;
  }
  window.open(links[app], '_blank');
}

async function shareToDM(userId, username) {
  if (!shareSheetProfile) return;
  closeProfileShare();

  const profileUrl  = getProfileUrl(shareSheetProfile);
  const shareText   = `Check out ${shareSheetProfile.username} on MistyNote 👤\n${profileUrl}`;

  // Get or create conversation with this user
  const convId = await msgGetOrCreateConversation(userId);
  if (!convId) { showToast('Could not open DM'); return; }

  // Get user profile for chat header
  const { data: user } = await supabase
    .from('users').select('id,username,avatar').eq('id', userId).maybeSingle();
  if (!user) { showToast('User not found'); return; }

  // Open chat
  openChat(convId, user);

  // Send the share message after a short delay so chat loads first
  setTimeout(async () => {
    await supabase.from('messages').insert({
      conversation_id: convId,
      sender_id: currentUser.id,
      type: 'text',
      content: shareText,
    });
    // Reload messages to show it
    loadChatMessages(convId);
  }, 600);
}

function copyProfileLink() {
  if (!shareSheetProfile) return;
  const url = getProfileUrl(shareSheetProfile);
  navigator.clipboard?.writeText(url).then(() => showToast('Profile link copied!'));
  closeProfileShare();
}

async function reportProfile() {
  if (!shareSheetProfile || !currentUser) return;
  try {
    await supabase.from('reports').insert({
      reporter_id: currentUser.id,
      reported_user_id: shareSheetProfile.id,
      type: 'profile',
      created_at: new Date().toISOString()
    });
  } catch(e) { /* table may not exist yet */ }
  showToast('Report submitted. Thank you.');
  closeProfileShare();
}

function blockUser() {
  if (!shareSheetProfile) return;
  const username = shareSheetProfile.username || 'This user';
  closeProfileShare();
  // Confirm before blocking
  const overlay = document.createElement('div');
  overlay.className = 'action-sheet-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'action-sheet';
  sheet.innerHTML = `
    <div style="padding:20px 20px 8px;text-align:center;">
      <div style="font-size:16px;font-weight:600;color:var(--text);margin-bottom:6px;">Block @${escHtml(username)}?</div>
      <div style="font-size:14px;color:var(--text2);line-height:1.5;">They won't be able to see your posts or interact with you.</div>
    </div>
    <div class="action-sheet-divider"></div>
  `;
  const confirmBtn = document.createElement('div');
  confirmBtn.className = 'action-sheet-item danger';
  confirmBtn.innerHTML = '<span style="font-size:20px">🚫</span><span>Block</span>';
  confirmBtn.addEventListener('click', () => {
    document.body.removeChild(overlay);
    showToast(`@${username} has been blocked.`);
    // TODO: insert into blocks table when available
    slideBack();
  });
  const cancelBtn = document.createElement('div');
  cancelBtn.className = 'action-sheet-item';
  cancelBtn.style.cssText = 'font-weight:700;border-top:1px solid var(--border);';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => document.body.removeChild(overlay));
  sheet.appendChild(confirmBtn);
  sheet.appendChild(cancelBtn);
  overlay.appendChild(sheet);
  overlay.addEventListener('click', e => { if (e.target === overlay) document.body.removeChild(overlay); });
  document.body.appendChild(overlay);
}


// ══════════════════════════════════════════
// VIDEO FULLSCREEN
// ══════════════════════════════════════════

function openVideoFS(src) {
  const overlay = document.getElementById('video-fs');
  const player = document.getElementById('video-fs-player');
  if (!overlay || !player) return;
  player.src = src;
  overlay.classList.remove('hidden');
  player.play().catch(() => {});
}

function closeVideoFS() {
  const overlay = document.getElementById('video-fs');
  const player = document.getElementById('video-fs-player');
  player?.pause();
  overlay?.classList.add('hidden');
}

// ══════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════

// ══════════════════════════════════════════
// FOLLOW LIST MODAL
// ══════════════════════════════════════════

async function openFollowList(type, userId) {
  // type = 'followers' | 'following'
  // userId is always the auth id (users.id column) — used directly in follows table
  const title = type === 'followers' ? 'Followers' : 'Following';

  // Build modal
  const overlay = document.createElement('div');
  overlay.id = 'follow-list-overlay';
  overlay.innerHTML = `
    <div class="follow-list-sheet">
      <div class="follow-list-header">
        <span class="follow-list-title">${title}</span>
        <button class="follow-list-close" onclick="closeFollowList()">✕</button>
      </div>
      <div class="follow-list-body" id="follow-list-body">
        <div class="follow-list-loading">Loading...</div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('visible'));

  // Close on backdrop tap
  overlay.addEventListener('click', e => { if (e.target === overlay) closeFollowList(); });

  // Fetch list — two step: get follow rows, then fetch user profiles
  const body = document.getElementById('follow-list-body');
  if (!body) return;

  let followRows, fetchError;
  if (type === 'followers') {
    ({ data: followRows, error: fetchError } = await supabase
      .from('follows')
      .select('follower_id')
      .eq('following_id', userId)
      .order('created_at', { ascending: false }));
  } else {
    ({ data: followRows, error: fetchError } = await supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', userId)
      .order('created_at', { ascending: false }));
  }


  if (fetchError || !followRows || followRows.length === 0) {
    body.innerHTML = `<div class="follow-list-empty">No ${title.toLowerCase()} yet</div>`;
    return;
  }

  const userIds = followRows.map(r => type === 'followers' ? r.follower_id : r.following_id);
  const { data: usersData, error: usersError } = await supabase
    .from('users')
    .select('id, username, avatar, is_verified')
    .in('id', userIds);

  const users = usersData || [];

  // Check which ones current user is already following
  let followingSet = new Set();
  if (currentUser) {
    const authIds = users.map(u => u.id).filter(uid => uid && uid !== currentUser.id);
    if (authIds.length) {
      const { data: myFollows } = await supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', currentUser.id)
        .in('following_id', authIds);
      if (myFollows) myFollows.forEach(f => followingSet.add(f.following_id));
    }
  }

  body.innerHTML = users.map(u => {
    const isMe = currentUser && u.id === currentUser.id;
    const isFollowing = followingSet.has(u.id);
    const avatar = u.avatar || `https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(u.username)}`;
    const verified = u.is_verified ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="#6C47FF"><path d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"/></svg>` : '';
    return `
      <div class="follow-list-row" onclick="followListTapUser('${u.id}')">
        <img class="follow-list-avatar" src="${avatar}" onerror="this.src='https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(u.username)}'">
        <div class="follow-list-info">
          <span class="follow-list-name">${escHtml(u.username)}${verified}</span>
        </div>
        ${!isMe ? `<button class="follow-list-btn ${isFollowing ? 'following' : ''}"
          id="flbtn-${u.id}"
          onclick="event.stopPropagation(); followListToggle('${u.id}', this)">
          ${isFollowing ? 'Following' : 'Follow'}
        </button>` : ''}
      </div>`;
  }).join('');
}

function closeFollowList() {
  const overlay = document.getElementById('follow-list-overlay');
  if (!overlay) return;
  overlay.classList.remove('visible');
  setTimeout(() => overlay.remove(), 280);
}

async function followListToggle(userId, btn) {
  const isFollowing = btn.classList.contains('following');
  // Optimistic
  btn.classList.toggle('following', !isFollowing);
  btn.textContent = !isFollowing ? 'Following' : 'Follow';

  if (isFollowing) {
    const { data, error } = await supabase.from('follows').delete()
      .eq('follower_id', currentUser.id).eq('following_id', userId).select();
    if (error || !data?.length) { btn.classList.add('following'); btn.textContent = 'Following'; showToast('Failed'); }
    else { showToast('Unfollowed'); refreshFollowCounts(userId); }
  } else {
    const { error } = await supabase.from('follows').insert({ follower_id: currentUser.id, following_id: userId });
    if (error) { btn.classList.remove('following'); btn.textContent = 'Follow'; showToast('Failed'); }
    else { showToast('Following ✓'); refreshFollowCounts(userId); }
  }
}

async function followListTapUser(userAuthId) {
  closeFollowList();
  // userAuthId is the auth UUID (user_id column) — need to find the profile id
  setTimeout(async () => {
    if (currentUser && userAuthId === currentUser.id) { navTo('profile'); return; }
    // Look up the profile.id from user_id
    const { data } = await supabase.from('users').select('id').eq('user_id', userAuthId).maybeSingle();
    const profileId = data?.id || userAuthId;
    showUserProfile(profileId, null);
  }, 200);
}

let toastTimer;
function showToast(msg, duration = 2500) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

// ══════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════

function timeSince(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s/60) + 'm';
  if (s < 86400) return Math.floor(s/3600) + 'h';
  if (s < 172800) return 'yesterday';
  if (s < 604800) return Math.floor(s/86400) + 'd';
  return Math.floor(s/604800) + 'w';
}

function fmtNum(n) {
  if (n === null || n === undefined) return '0';
  if (n === 0) return '0';
  if (n >= 1000000) return (n/1000000).toFixed(1).replace(/\.0$/,'') + 'M';
  if (n >= 1000) return (n/1000).toFixed(1).replace(/\.0$/,'') + 'K';
  return String(n);
}

// ══════════════════════════════════════════
// MOMENTS — ring helper
// ══════════════════════════════════════════

function getDpAvatarRing(userId, avatarSrc, isOwn) {
  const moment = activeMoments.get(userId);
  const src = avatarSrc || `https://api.dicebear.com/7.x/adventurer/svg?seed=${userId}`;
  const onclick = isOwn ? 'selfTap(this)' : `showUserProfile('${userId}',this)`;
  if (!moment) {
    return `<img class="dp-avatar" src="${src}" onerror="this.style.display='none'" onclick="${onclick}">`;
  }
  const type = moment.type;
  return `
    <div class="dp-avatar-wrap has-moment ${type}">
      <div class="dp-avatar-ring ${type}"></div>
      <img class="dp-avatar" src="${src}"
        onerror="this.src='https://api.dicebear.com/7.x/adventurer/svg?seed=${userId}'"
        onclick="${onclick}">
    </div>`;
}

function getMomentBanner(userId) {
  const moment = activeMoments.get(userId);
  if (!moment) return '';
  const configs = {
    regular:       { label: '● Active Moment',       color: 'var(--accent)',  bg: 'var(--accent-soft)' },
    commerce:      { label: '🛍️ Selling Now',         color: '#b8860b',        bg: 'rgba(255,184,0,0.12)' },
    live:          { label: '● Live Now',             color: 'var(--red)',     bg: 'var(--red-soft)' },
    live_commerce: { label: '● Live Sales Ongoing',    color: 'var(--red)',   bg: 'var(--red-soft)' },
  };
  const c = configs[moment.type] || configs.regular;
  return `
    <div class="prf-moment-banner" style="--mb-color:${c.color};--mb-bg:${c.bg}"
         onclick="openMomentFromAvatar('${userId}')">
      <span class="prf-moment-banner-text">${c.label}</span>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
    </div>`;
}

function getMomentRing(userId, avatarSrc) {
  const moment = activeMoments.get(userId);
  const seed = avatarSrc || `https://api.dicebear.com/7.x/adventurer/svg?seed=${userId}`;
  if (!moment) {
    return `<img class="small-photo" src="${seed}" onerror="this.style.display='none'" alt="">`;
  }
  const type = moment.type; // regular | commerce | live | live_commerce
  return `
    <div class="avatar-moment-wrap has-moment ${type}" onclick="openMomentFromAvatar('${userId}');event.stopPropagation()">
      <div class="avatar-moment-ring ${type}"></div>
      <img class="small-photo" src="${seed}" onerror="this.src='https://api.dicebear.com/7.x/adventurer/svg?seed=${userId}'" alt="">
    </div>`;
}

function openMomentFromAvatar(userId) {
  const moment = activeMoments.get(userId);
  if (!moment) return;
  const typeLabel = moment.type === 'live' || moment.type === 'live_commerce' ? 'Live session' : 'Moment';
  showToast(`${typeLabel} — coming soon ✨`);
}

function seedDemoMoments(posts) {
  // Wire demo moment types to real user IDs from loaded posts
  // In production this will be replaced by a DB query
  if (activeMoments.size > 0) return; // already seeded
  const types = ['regular', 'commerce', 'live', 'live_commerce', 'regular'];
  let i = 0;
  const seen = new Set();
  for (const p of posts) {
    if (!seen.has(p.user_id) && i < types.length) {
      activeMoments.set(p.user_id, { type: types[i] });
      seen.add(p.user_id);
      i++;
    }
  }
}

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function toggleMasonryLike(btn, postId) {
  // Routes through LikeManager — same robust system as feed/detail likes
  LikeManager.toggle(postId, btn);
}

function gradientFor(id) {
  const gradients = [
    'linear-gradient(135deg,#667eea,#764ba2)',
    'linear-gradient(135deg,#f093fb,#f5576c)',
    'linear-gradient(135deg,#4facfe,#00f2fe)',
    'linear-gradient(135deg,#43e97b,#38f9d7)',
    'linear-gradient(135deg,#fa709a,#fee140)',
    'linear-gradient(135deg,#a18cd1,#fbc2eb)',
  ];
  const hash = (str) => str ? [...str].reduce((a,c) => a + c.charCodeAt(0), 0) : 0;
  return gradients[hash(id) % gradients.length];
}

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };

}