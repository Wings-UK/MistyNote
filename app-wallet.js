/* ═══════════════════════════════════════════
   MISTYNOTE — app-wallet.js
   MistyPoints wallet, Squad payment, CheapData
   bills, PIN, earnings, transactions.
   Also: edit profile, settings, legal, toast,
   image upload, share, helpers, view tracking
   Requires: app-core.js
═══════════════════════════════════════════ */

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
  points: 0,               // available MP balance (maps to wallets.available)
  escrow: 0,               // pending escrow balance (maps to wallets.escrow)
  balanceVisible: true,
  selectedGiftRecipient: null,
  giftAmount: 0,
  activeSheet: null,
  txnFilter: 'all',
  squadPublicKey: '',      // set at runtime from Supabase secrets
  bankAccount: null,
};

// ── FORMAT HELPERS ────────────────────────────────────────────────────────────
// All user-facing amounts: MP 12 or MP 1,500
// No Unicode star prefix — unreliable on Android browsers.
// The wallet hero has its own HTML star element separately.
function fmtPts(pts) {
  if (pts === null || pts === undefined) return 'MP 0';
  const n = Number(pts);
  const str = Number.isInteger(n)
    ? n.toLocaleString('en-NG')
    : n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return 'MP\u00a0' + str;
}
// Internal-only conversion helpers — results never shown to users
function pointsToNgn(pts) { return pts * POINTS_RATE; }
function ngnToPoints(ngn) { return ngn / POINTS_RATE; }

// ── OPEN WALLET PAGE ──────────────────────────────────────────────────────────
function openWallet() {
  slideTo('wallet');
  syncPointsRate();
  buildWalletPeopleRow();
  syncWalletBalance();
  loadBankAccount();
  refreshTransactionList();
  subscribeToWalletUpdates();
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
      .select('available, escrow')
      .eq('user_id', currentUser.id)
      .maybeSingle();
    if (error || !data) return;
    walletState.points  = data.available ?? 0;
    walletState.escrow  = data.escrow    ?? 0;
    renderWalletBalance();
  } catch (e) { /* silently fail — show cached value */ }
}

function renderWalletBalance() {
  const el = document.getElementById('wlt-balance');
  if (!el) return;
  el.textContent = fmtPts(walletState.points).replace(/^MP[\u00a0\s]*/,'');
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
  'earnings': 'sheet-earnings',
  'pin':      'sheet-wallet-pin',
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
  if (amount > walletState.points) { showToast('Not enough MistyPoints'); return; }

  // ── Wallet PIN check ──────────────────────────────────────
  var pinOk = await walletPinCheck();
  if (!pinOk) return;

  closeWalletSheet('gift');
  showToast('Gifting MP ' + amount + ' to ' + recipient.name + '...');

  try {
    var res = await supabase.rpc('p2p_transfer_points', {
      sender_id:    currentUser.id,
      recipient_id: recipient.id,
      points:       amount,
      note:         note,
    });
    if (res.error) throw res.error;

    // Generate short reference
    var ref = 'MN-' + Date.now().toString(36).toUpperCase();

    walletState.points -= amount;
    renderWalletBalance();
    showToast('\u2713 Gifted MP ' + amount + ' to ' + recipient.name);
    syncWalletBalance();
    refreshTransactionList();

    // ── Post money bubble into DM thread ─────────────────────
    // Whether sent from wallet or from DM, always post into their DM
    postGiftBubbleToDM(recipient, amount, note, ref);

    // ── Notify recipient via Supabase notification ────────────
    sendGiftNotification(recipient.id, amount, note, ref);

  } catch (e) {
    showToast('Gift failed \u2014 please try again');
    console.error('Points gift error:', e);
  }
}

// Post MP gift bubble into the DM between sender and recipient
async function postGiftBubbleToDM(recipient, amount, note, ref) {
  try {
    // Get or create conversation with this user
    var convId = recipient.fromDM ? recipient.convId : null;
    if (!convId) {
      convId = await getOrCreateConversation(recipient.id);
    }
    if (!convId) return;

    // Insert message of type 'cash' into messages table
    var payload = {
      conversation_id: convId,
      sender_id:       currentUser.id,
      type:            'cash',
      content:         note || '',
      cash_amount:     amount,
      cash_currency:   'MP',
      cash_note:       note,
      cash_status:     'delivered',
      cash_ref:        ref,
    };
    await supabase.from('messages').insert(payload);

    // If we're currently in that chat, render bubble immediately
    if (activeChatId === convId) {
      var msgsEl = document.getElementById('chat-messages');
      if (msgsEl) {
        var tmpMsg = Object.assign({}, payload, {
          id:         'tmp-gift-' + Date.now(),
          created_at: new Date().toISOString(),
          sender:     currentProfile,
        });
        var lastRow      = msgsEl.querySelector('.chat-msg-row:last-child');
        var lastSenderId = lastRow
          ? (lastRow.classList.contains('sent') ? currentUser.id : activeChatUserId)
          : null;
        var el = buildMessageEl(tmpMsg, lastSenderId);
        if (el) { msgsEl.appendChild(el); msgsEl.scrollTop = msgsEl.scrollHeight; }
      }
      updateInboxRow(convId, 'MP ' + amount + ' gift', new Date().toISOString());
    }
  } catch (e) {
    console.warn('postGiftBubbleToDM error:', e);
  }
}

// Fire in-app notification for the recipient
async function sendGiftNotification(recipientId, amount, note, ref) {
  // Routes through insertNotification which auto-dispatches push notification
  var bannerText = 'MP ' + amount + (note ? ' - ' + note.slice(0, 60) : '');
  if (typeof insertNotification === 'function') {
    insertNotification({
      user_id:      recipientId,
      actor_id:     currentUser.id,
      type:         'mp_gift',
      comment_text: bannerText,
    });
  } else {
    supabase.from('notifications').insert({
      user_id:      recipientId,
      actor_id:     currentUser.id,
      type:         'mp_gift',
      comment_text: bannerText,
      read:         false,
    }).catch(() => {});
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
  if (!currentUser) return;
  var listEl = document.getElementById('wlt-txn-list');
  if (!listEl) return;
  // Wipe immediately — never leave hardcoded HTML visible
  listEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text3);font-size:13px;">Loading activity…</div>';
  try {
    var res = await supabase
      .from('wallet_transactions')
      .select('id, from_user_id, to_user_id, amount, type, note, status, created_at, reference')
      .or('from_user_id.eq.' + currentUser.id + ',to_user_id.eq.' + currentUser.id)
      .order('created_at', { ascending: false })
      .limit(30);
    if (res.error || !res.data || !res.data.length) return;

    // Collect unique user IDs to fetch names/avatars
    var uids = new Set();
    res.data.forEach(function(t) {
      if (t.from_user_id && t.from_user_id !== currentUser.id) uids.add(t.from_user_id);
      if (t.to_user_id   && t.to_user_id   !== currentUser.id) uids.add(t.to_user_id);
    });
    var userMap = {};
    if (uids.size > 0) {
      var uRes = await supabase.from('users').select('id,username,avatar').in('id', Array.from(uids));
      if (uRes.data) uRes.data.forEach(function(u) { userMap[u.id] = u; });
    }

    var typeMap = { gift:'gift', buy:'receive', payout:'payout', bill_payment:'bills', purchase:'purchase', escrow_hold:'purchase', escrow_release:'receive', escrow_refund:'receive' };
    var html = res.data.map(function(t) {
      var isSent    = t.from_user_id === currentUser.id;
      var otherId   = isSent ? t.to_user_id : t.from_user_id;
      var other     = userMap[otherId] || {};
      var avatar    = other.avatar || 'https://api.dicebear.com/7.x/adventurer/svg?seed=' + (otherId || 'x');
      var name      = other.username || (t.type === 'buy' ? 'MistyNote' : t.type === 'payout' ? 'Bank Payout' : 'User');
      var sign      = isSent ? '-' : '+';
      var amtCls    = isSent ? 'wlt-amount-neg' : 'ca-amount-pos';
      var badgeCls  = isSent ? 'wlt-badge-out' : 'wlt-badge-in';
      var badgeSvg  = isSent
        ? '<svg width="8" height="8" viewBox="0 0 24 24" fill="none"><polyline points="20 12 20 22 4 22 4 12" stroke="white" stroke-width="2.5"/><rect x="2" y="7" width="20" height="5" rx="1" stroke="white" stroke-width="2"/></svg>'
        : '<svg width="8" height="8" viewBox="0 0 24 24" fill="none"><path d="M12 19V5M5 12l7 7 7-7" stroke="white" stroke-width="2.5" stroke-linecap="round"/></svg>';
      var typeLabel = t.type === 'gift' ? (isSent ? 'Gifted' : 'Received')
        : t.type === 'buy'      ? 'Points Bought'
        : t.type === 'payout'   ? 'Bank Payout'
        : t.type === 'bill_payment' ? 'Bill Payment'
        : t.type === 'purchase' ? 'Purchase'
        : t.type === 'escrow_hold'    ? 'In Escrow'
        : t.type === 'escrow_release' ? 'Escrow Released'
        : t.type === 'escrow_refund'  ? 'Refunded'
        : t.type;
      var timeStr   = msgTimeSince(t.created_at);
      var note      = t.note ? escHtml(t.note.slice(0, 60)) : '';
      var dataType  = typeMap[t.type] || 'all';

      return '<div class="wlt-txn-item ca-txn-item" data-type="' + dataType + '">' +
        '<div class="wlt-txn-left">' +
          '<div class="wlt-txn-avatar-wrap">' +
            '<img class="wlt-txn-avatar ca-txn-avatar" src="' + avatar + '" alt="">' +
            '<div class="wlt-txn-badge ' + badgeCls + ' ca-txn-badge">' + badgeSvg + '</div>' +
          '</div>' +
          '<div class="wlt-txn-details">' +
            '<div class="wlt-txn-name ca-txn-name">' + escHtml(name) + '</div>' +
            (note ? '<div class="wlt-txn-note ca-txn-note">' + note + '</div>' : '') +
            '<div class="wlt-txn-time ca-txn-time">' + timeStr + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="wlt-txn-right">' +
          '<div class="wlt-txn-amount ' + amtCls + ' ca-txn-amount">' + sign + ' MP ' + Number(t.amount).toLocaleString('en-NG', {maximumFractionDigits:4}) + '</div>' +
          '<div class="wlt-txn-status completed ca-txn-status">' + typeLabel + '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    listEl.innerHTML = html || '<div class="wlt-txn-empty">No transactions yet</div>';
  } catch (e) {
    listEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text3);font-size:13px;">Could not load transactions. Check your connection.</div>';
    console.warn('refreshTransactionList error:', e);
  }
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
    ? 'Your balance will be settled to your bank automatically'
    : 'Minimum MP 1 required for payout. Balance rolls over.';

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
  loadWalletPinStatus(); // load PIN status alongside bank account
  try {
    var res = await supabase
      .from('user_bank_accounts')
      .select('*')
      .eq('user_id', currentUser.id)
      .maybeSingle();
    if (res.data) walletState.bankAccount = res.data;
  } catch (e) { /* silent */ }
}


// ── WALLET PIN ─────────────────────────────────────────────────────────────────
// PIN protects all outgoing wallet actions (gift, bill, buy).
// Stored hashed via Supabase. Never plain text.
// walletPinCheck() returns a Promise<boolean> — resolves true if PIN ok or not set.

var walletPinState = {
  isSet:       false,  // loaded from DB on wallet open
  attempts:    0,
  lockedUntil: null,
  resolver:    null,   // resolve function for the active PIN promise
};

async function loadWalletPinStatus() {
  if (!currentUser) return;
  try {
    var res = await supabase
      .from('wallet_pins')
      .select('id')
      .eq('user_id', currentUser.id)
      .maybeSingle();
    walletPinState.isSet = !!(res.data);
  } catch (e) { /* table may not exist yet — treat as no PIN */ }
}

// Returns Promise<boolean>. Resolves immediately if no PIN set.
function walletPinCheck() {
  if (!walletPinState.isSet) return Promise.resolve(true);
  if (walletPinState.lockedUntil && Date.now() < walletPinState.lockedUntil) {
    var secs = Math.ceil((walletPinState.lockedUntil - Date.now()) / 1000);
    showToast('Wallet locked. Try again in ' + secs + 's');
    return Promise.resolve(false);
  }
  return new Promise(function(resolve) {
    walletPinState.resolver = resolve;
    openPinSheet('verify');
  });
}

function openPinSheet(mode) {
  var sheet = document.getElementById('sheet-wallet-pin');
  if (!sheet) return;
  sheet.dataset.mode = mode;
  var title = document.getElementById('pin-sheet-title');
  var sub   = document.getElementById('pin-sheet-sub');
  if (mode === 'verify') {
    if (title) title.textContent = 'Enter Wallet PIN';
    if (sub)   sub.textContent   = 'Required to complete this action';
    _pinBuffer = ''; clearPinDots();      // full reset for verify
  } else if (mode === 'set') {
    if (title) title.textContent = 'Set Wallet PIN';
    if (sub)   sub.textContent   = 'Choose a 4-digit PIN to protect outgoing payments';
    resetPinBuffers();                    // full reset for set
  } else if (mode === 'confirm') {
    if (title) title.textContent = 'Confirm PIN';
    if (sub)   sub.textContent   = 'Enter the same PIN again';
    _confirmBuffer = ''; clearPinDots(); // preserve _pinBuffer!
  }
  sheet.classList.remove('hidden');
  walletState.activeSheet = 'pin';
}

function closePinSheet(cancel) {
  var sheet = document.getElementById('sheet-wallet-pin');
  if (sheet) sheet.classList.add('hidden');
  walletState.activeSheet = null;
  if (cancel && walletPinState.resolver) {
    walletPinState.resolver(false);
    walletPinState.resolver = null;
  }
  resetPinBuffers();
}

var _pinBuffer = '';
var _confirmBuffer = '';

function pinPad(digit) {
  var sheet = document.getElementById('sheet-wallet-pin');
  if (!sheet) return;
  var mode = sheet.dataset.mode;

  if (mode === 'set') {
    if (_pinBuffer.length < 4) {
      _pinBuffer += digit;
      updatePinDots(_pinBuffer.length);
      if (_pinBuffer.length === 4) {
        setTimeout(function() { openPinSheet('confirm'); }, 200);
      }
    }
  } else if (mode === 'confirm') {
    if (_confirmBuffer.length < 4) {
      _confirmBuffer += digit;
      updatePinDots(_confirmBuffer.length);
      if (_confirmBuffer.length === 4) {
        if (_confirmBuffer === _pinBuffer) {
          setTimeout(function() { saveWalletPin(_pinBuffer); }, 200);
        } else {
          showToast('PINs do not match — try again');
          _pinBuffer = ''; _confirmBuffer = '';
          clearPinDots();
          openPinSheet('set');
        }
      }
    }
  } else {
    // verify mode
    if (_pinBuffer.length < 4) {
      _pinBuffer += digit;
      updatePinDots(_pinBuffer.length);
      if (_pinBuffer.length === 4) {
        setTimeout(function() { verifyWalletPin(_pinBuffer); }, 200);
      }
    }
  }
}

function pinBackspace() {
  var sheet = document.getElementById('sheet-wallet-pin');
  if (!sheet) return;
  var mode = sheet.dataset.mode;
  if (mode === 'confirm') {
    if (_confirmBuffer.length > 0) {
      _confirmBuffer = _confirmBuffer.slice(0, -1);
      updatePinDots(_confirmBuffer.length);
    }
  } else {
    if (_pinBuffer.length > 0) {
      _pinBuffer = _pinBuffer.slice(0, -1);
      updatePinDots(_pinBuffer.length);
    }
  }
}

function updatePinDots(filled) {
  var dots = document.querySelectorAll('.pin-dot');
  dots.forEach(function(dot, i) {
    dot.classList.toggle('filled', i < filled);
  });
}

function clearPinDots() {
  // Visual only — never wipes buffers
  document.querySelectorAll('.pin-dot').forEach(function(d) { d.classList.remove('filled'); });
}
function resetPinBuffers() {
  _pinBuffer = ''; _confirmBuffer = '';
  clearPinDots();
}

async function verifyWalletPin(pin) {
  try {
    var res = await supabase.rpc('verify_wallet_pin', {
      p_user_id: currentUser.id,
      p_pin:     pin,
    });
    if (res.data === true) {
      walletPinState.attempts = 0;
      closePinSheet(false);
      if (walletPinState.resolver) {
        walletPinState.resolver(true);
        walletPinState.resolver = null;
      }
    } else {
      walletPinState.attempts++;
      clearPinDots();
      if (walletPinState.attempts >= 5) {
        walletPinState.lockedUntil = Date.now() + 24 * 60 * 60 * 1000;
        showToast('Too many wrong attempts. Wallet locked for 24h');
        closePinSheet(true);
      } else if (walletPinState.attempts >= 2) {
        var left = 5 - walletPinState.attempts;
        showToast('Wrong PIN · ' + left + ' attempt' + (left === 1 ? '' : 's') + ' left');
      } else {
        showToast('Incorrect PIN');
      }
    }
  } catch (e) {
    showToast('PIN check failed — try again');
    clearPinDots();
  }
}

async function saveWalletPin(pin) {
  try {
    await supabase.rpc('set_wallet_pin', {
      p_user_id: currentUser.id,
      p_pin:     pin,
    });
    walletPinState.isSet = true;
    showToast('Wallet PIN set \u2713');
    closePinSheet(false);
  } catch (e) {
    showToast('Could not save PIN — try again');
    clearPinDots();
    openPinSheet('set');
  }
}

function openSetPin() {
  resetPinBuffers();
  openPinSheet('set');
}

function openChangePin() {
  openSetPin();
}

// ── REALTIME WALLET UPDATES ───────────────────────────────────────────────────
var walletRealtimeSub = null;
function subscribeToWalletUpdates() {
  if (!currentUser) return;
  if (walletRealtimeSub) supabase.removeChannel(walletRealtimeSub);
  walletRealtimeSub = supabase
    .channel('wallet-incoming-' + currentUser.id)
    .on('postgres_changes', {
      event:  'INSERT',
      schema: 'public',
      table:  'wallet_transactions',
      filter: 'to_user_id=eq.' + currentUser.id,
    }, function(payload) {
      var t = payload.new;
      if (t.type === 'gift') {
        showToast('MP ' + t.amount + ' received \u2713');
      }
      syncWalletBalance();
      refreshTransactionList();
    })
    .subscribe();
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