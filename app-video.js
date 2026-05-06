/* ═══════════════════════════════════════════
   MISTYNOTE — app-video.js
   Full-screen video player
   Modes: video | video_product | live_commerce
   Requires: app-core.js, app-social.js
═══════════════════════════════════════════ */

// ── State ──────────────────────────────────
let _vp = {
  postId:    null,
  videoType: null,   // 'video' | 'video_product' | 'live_commerce'
  liked:     false,
  likeCount: 0,
  floatTimer: null,
};

// ── Open video player ──────────────────────
async function openVideoPlayer(postId, videoType) {
  _vp.postId    = postId;
  _vp.videoType = videoType || 'video';
  _vp.liked     = likedPosts.has(postId);
  _vp.likeCount = 0;

  slideTo('video', async () => {
    // Reset UI
    _vpReset();

    // Fetch post data
    const { data: p } = await supabase
      .from('posts')
      .select(`id, content, video, like_count, comment_count, user_id,
               user:users(id, username, avatar)`)
      .eq('id', postId)
      .single();

    if (!p) { slideBack(); return; }

    const user = p.user || {};
    _vp.likeCount = p.like_count || 0;

    // ── Wire video ──
    const vid = document.getElementById('vp-video');
    if (vid) {
      vid.src = p.video || '';
      vid.muted = false;
      vid.play().catch(() => {});
    }

    // ── Creator info ──
    const avEl   = document.getElementById('vp-creator-av');
    const nameEl = document.getElementById('vp-creator-name');
    if (avEl)   avEl.src = user.avatar || '';
    if (nameEl) nameEl.textContent = user.username || '';

    // ── Caption ──
    const capEl = document.getElementById('vp-caption');
    if (capEl) capEl.textContent = p.content || '';

    // ── Like button ──
    _vpPaintLike();
    document.getElementById('vp-like-count').textContent =
      _vp.likeCount > 0 ? fmtNum(_vp.likeCount) : '';
    document.getElementById('vp-comment-count').textContent =
      p.comment_count > 0 ? fmtNum(p.comment_count) : '';

    // ── Mode-specific features ──
    _vpApplyMode(_vp.videoType);

    // Track view
    recordView(postId);
  });
}

// ── Apply mode-specific UI ─────────────────
function _vpApplyMode(mode) {
  const liveBadge   = document.getElementById('vp-live-badge');
  const viewerCount = document.getElementById('vp-viewer-count');
  const bellBtn     = document.getElementById('vp-bell-btn');
  const productCard = document.getElementById('vp-product-card');
  const floatHearts = document.getElementById('vp-float-hearts');

  // Hide all mode-specific elements first
  if (liveBadge)   liveBadge.style.display   = 'none';
  if (viewerCount) viewerCount.style.display  = 'none';
  if (bellBtn)     bellBtn.style.display      = 'none';
  if (productCard) productCard.style.display  = 'none';
  if (floatHearts) floatHearts.innerHTML      = '';

  if (mode === 'video') {
    // Mode 1 — nothing extra
  }

  if (mode === 'video_product') {
    // Mode 2 — show product card (placeholder)
    if (productCard) productCard.style.display = 'flex';
  }

  if (mode === 'live_commerce') {
    // Mode 3 — LIVE badge + viewers + bell + product card + floating hearts
    if (liveBadge)   liveBadge.style.display   = 'inline-flex';
    if (bellBtn)     bellBtn.style.display      = 'flex';
    if (productCard) productCard.style.display  = 'flex';

    // Simulated viewer count
    const count = Math.floor(Math.random() * 4800) + 200;
    if (viewerCount) {
      viewerCount.style.display = 'block';
      viewerCount.textContent   = fmtNum(count) + ' watching';
    }

    // Auto floating hearts every few seconds
    _vp.floatTimer = setInterval(_vpSpawnHeart, 2200);
    // First heart immediately
    setTimeout(_vpSpawnHeart, 600);
  }
}

// ── Spawn a floating heart (mode 3) ─────────
function _vpSpawnHeart() {
  const container = document.getElementById('vp-float-hearts');
  if (!container) return;
  const emojis = ['❤️','🧡','💛','💜','🩷'];
  const em = document.createElement('div');
  em.className = 'vp-float-heart';
  em.textContent = emojis[Math.floor(Math.random() * emojis.length)];
  em.style.right = (8 + Math.random() * 20) + 'px';
  em.style.animationDuration = (2 + Math.random() * 1.2) + 's';
  container.appendChild(em);
  setTimeout(() => em.remove(), 3500);
}

// ── Toggle like ────────────────────────────
function vpToggleLike() {
  if (!currentUser) { showToast('Sign in to love this'); return; }
  _vp.liked     = !_vp.liked;
  _vp.likeCount = _vp.liked
    ? _vp.likeCount + 1
    : Math.max(0, _vp.likeCount - 1);

  _vpPaintLike();

  // Animate heart
  const svg = document.querySelector('#vp-like-btn .vp-heart-svg');
  if (svg) {
    svg.classList.remove('vp-heart-pop');
    void svg.offsetWidth;
    svg.classList.add('vp-heart-pop');
  }

  // Spawn floating heart if live_commerce
  if (_vp.videoType === 'live_commerce') _vpSpawnHeart();

  // Commit to LikeStore
  LikeStore.toggle(_vp.postId);
}

function _vpPaintLike() {
  const btn  = document.getElementById('vp-like-btn');
  const path = document.querySelector('#vp-like-btn .vp-heart-path');
  const cnt  = document.getElementById('vp-like-count');

  if (btn)  btn.classList.toggle('liked', _vp.liked);
  if (path) {
    path.setAttribute('fill',   _vp.liked ? 'rgb(244,7,82)' : 'none');
    path.setAttribute('stroke', _vp.liked ? 'rgb(244,7,82)' : 'white');
  }
  if (cnt)  cnt.textContent = _vp.likeCount > 0 ? fmtNum(_vp.likeCount) : '';
}

// ── Toggle play/pause ──────────────────────
function vpTogglePlay() {
  const vid = document.getElementById('vp-video');
  if (!vid) return;

  const indicator = document.getElementById('vp-play-indicator');
  const iconPath  = document.getElementById('vp-play-indicator-icon');

  if (vid.paused) {
    vid.play();
    if (iconPath) iconPath.setAttribute('d', 'M5 3l14 9L5 21V3z'); // play icon
  } else {
    vid.pause();
    if (iconPath) iconPath.setAttribute('d', 'M6 4h4v16H6zM14 4h4v16h-4z'); // pause icon
  }

  // Show indicator animation
  if (indicator) {
    indicator.classList.remove('show');
    void indicator.offsetWidth;
    indicator.classList.add('show');
  }
}

// ── Open comments ──────────────────────────
function vpOpenComments() {
  if (_vp.postId) openDetail(_vp.postId, true);
}

// ── Share ──────────────────────────────────
function vpShare() {
  if (!_vp.postId) return;
  // Build a minimal post-like object for sharePost
  sharePost({ id: _vp.postId, content: '' });
}

// ── Reset ──────────────────────────────────
function _vpReset() {
  // Stop floating hearts timer
  if (_vp.floatTimer) { clearInterval(_vp.floatTimer); _vp.floatTimer = null; }

  // Pause and clear video
  const vid = document.getElementById('vp-video');
  if (vid) { vid.pause(); vid.src = ''; }

  // Clear like state
  const btn  = document.getElementById('vp-like-btn');
  const path = document.querySelector('#vp-like-btn .vp-heart-path');
  if (btn)  btn.classList.remove('liked');
  if (path) { path.setAttribute('fill','none'); path.setAttribute('stroke','white'); }

  document.getElementById('vp-like-count').textContent    = '';
  document.getElementById('vp-comment-count').textContent = '';
  document.getElementById('vp-caption').textContent        = '';

  const floatHearts = document.getElementById('vp-float-hearts');
  if (floatHearts) floatHearts.innerHTML = '';
}

// ── Close ──────────────────────────────────
function closeVideoPlayer() {
  _vpReset();
  slideBack();
}

// ══════════════════════════════════════════
// FEED — Video thumbnail renderer
// Called from createFeedPost in app-social.js
// when post has video and no image
// ══════════════════════════════════════════

function createFeedVideoThumb(p) {
  const isLive = p.video_type === 'live_commerce';
  const wrap   = document.createElement('div');
  wrap.className = 'feed-video-thumb';
  wrap.dataset.postId = p.id;

  wrap.innerHTML = `
    <video preload="metadata" muted playsinline loop>
      <source src="${p.video}#t=0.5" type="video/mp4">
    </video>
    <div class="feed-video-thumb-overlay">
      <div class="feed-video-play-btn">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
          <path d="M5 3l14 9L5 21V3z"/>
        </svg>
      </div>
    </div>
    ${isLive ? `<div class="feed-video-live-badge"><span style="width:6px;height:6px;border-radius:50%;background:#fff;display:inline-block"></span>LIVE</div>` : ''}
    <div class="feed-video-duration" id="fvd-${p.id}"></div>
  `;

  // Auto-play muted on scroll into view
  const videoEl = wrap.querySelector('video');
  if (videoEl) {
    videoEl.addEventListener('loadedmetadata', () => {
      const dur = videoEl.duration;
      const durEl = document.getElementById(`fvd-${p.id}`);
      if (durEl && dur && isFinite(dur)) {
        const m = Math.floor(dur / 60);
        const s = Math.floor(dur % 60).toString().padStart(2,'0');
        durEl.textContent = `${m}:${s}`;
      }
    });
  }

  // Tap → open full screen player
  wrap.addEventListener('click', (e) => {
    e.stopPropagation();
    openVideoPlayer(p.id, p.video_type || 'video');
  });

  // IntersectionObserver for muted autoplay on feed
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!videoEl) return;
      if (entry.isIntersecting && entry.intersectionRatio > 0.5) {
        videoEl.muted = true;
        videoEl.play().catch(() => {});
      } else {
        videoEl.pause();
      }
    });
  }, { threshold: 0.5 });
  obs.observe(wrap);

  return wrap;
}

// ══════════════════════════════════════════
// INJECT feed video support into createFeedPost
// We monkey-patch the video block in the feed
// ══════════════════════════════════════════

// Intercept openVideoFS to route video posts to our player
const _origOpenVideoFS = window.openVideoFS;
window.openVideoFS = function(videoUrl, postId, videoType) {
  if (postId) {
    openVideoPlayer(postId, videoType || 'video');
  } else if (_origOpenVideoFS) {
    _origOpenVideoFS(videoUrl);
  }
};
