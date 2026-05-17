/* ═══════════════════════════════════════════════════════════════
   MISTYNOTE — app-video.js
   Full-screen video player
   Modes: video | video_product | live_commerce
   Requires: app-core.js, app-social.js
═══════════════════════════════════════════════════════════════ */

let _vp = {
  postId:      null,
  videoType:   null,
  liked:       false,
  likeCount:   0,
  bookmarked:  false,
  reposted:    false,
  repostCount: 0,
  postUserId:  null,
  postContent: '',
  postUser:    null,
  floatTimer:  null,
};

/* ──────────────────────────────────────────────
   OPEN
────────────────────────────────────────────── */
async function openVideoPlayer(postId, videoType, resumeTime) {
  _vp.postId     = postId;
  _vp.videoType  = videoType || 'video';
  _vp.liked      = likedPosts.has(postId);
  _vp.bookmarked = savedPosts.has(postId);
  _vp.reposted   = repostedPosts.has(postId);
  _vp.likeCount  = 0;

  slideTo('video', async () => {
    _vpReset();

    const { data: p } = await supabase
      .from('posts')
      .select('id, content, video, like_count, comment_count, repost_count, user_id, user:users(id, username, avatar)')
      .eq('id', postId)
      .single();

    if (!p) { slideBack(); return; }

    const user       = p.user || {};
    _vp.likeCount    = p.like_count    || 0;
    _vp.repostCount  = p.repost_count  || 0;
    _vp.postUserId   = p.user_id;
    _vp.postContent  = p.content || '';
    _vp.postUser     = user;

    const vid = document.getElementById('vp-video');
    if (vid) {
      vid.src = p.video || '';
      vid.muted = false;
      if (resumeTime) {
        vid.addEventListener('loadedmetadata', () => { vid.currentTime = resumeTime; }, { once: true });
      }
      vid.play().catch(() => {});
    }

    _vpStartProgress();

    const avEl   = document.getElementById('vp-creator-av');
    const nameEl = document.getElementById('vp-creator-name');
    if (avEl)   avEl.src = user.avatar || '';
    if (nameEl) nameEl.textContent = user.username || '';

    const capEl = document.getElementById('vp-caption');
    if (capEl)  capEl.textContent = p.content || '';

    _vpPaintLike();
    _vpPaintBookmark();
    _vpPaintRepost();

    const lc = document.getElementById('vp-like-count');
    const cc = document.getElementById('vp-comment-count');
    const rc = document.getElementById('vp-repost-count');
    if (lc) lc.textContent = _vp.likeCount   > 0 ? fmtNum(_vp.likeCount)   : '';
    if (rc) rc.textContent = _vp.repostCount > 0 ? fmtNum(_vp.repostCount) : '';

    // Fetch live comment count straight from comments table — same as detail page does
    supabase
      .from('comments')
      .select('*', { count: 'exact', head: true })
      .eq('post_id', postId)
      .is('parent_id', null)
      .then(({ count }) => {
        const live = count || 0;
        if (cc) cc.textContent = live > 0 ? fmtNum(live) : '';
      });

    _vpApplyMode(_vp.videoType);
    recordView(postId);
  });
}

/* ──────────────────────────────────────────────
   MODE
────────────────────────────────────────────── */
function _vpApplyMode(mode) {
  const liveBadge   = document.getElementById('vp-live-badge');
  const viewerCount = document.getElementById('vp-viewer-count');
  const bellBtn     = document.getElementById('vp-bell-btn');
  const productCard = document.getElementById('vp-product-card');
  const floatHearts = document.getElementById('vp-float-hearts');

  if (liveBadge)   liveBadge.style.display   = 'none';
  if (viewerCount) viewerCount.style.display  = 'none';
  if (bellBtn)     bellBtn.style.display      = 'none';
  if (productCard) productCard.style.display  = 'none';
  if (floatHearts) floatHearts.innerHTML      = '';

  if (mode === 'video_product') {
    if (productCard) productCard.style.display = 'flex';
  }

  if (mode === 'live_commerce') {
    if (liveBadge)   liveBadge.style.display   = 'inline-flex';
    if (bellBtn)     bellBtn.style.display      = 'flex';
    if (productCard) productCard.style.display  = 'flex';

    const count = Math.floor(Math.random() * 4800) + 200;
    if (viewerCount) {
      viewerCount.style.display = 'block';
      viewerCount.textContent   = fmtNum(count) + ' watching';
    }
    _vp.floatTimer = setInterval(_vpSpawnHeart, 2200);
    setTimeout(_vpSpawnHeart, 600);
  }
}

/* ──────────────────────────────────────────────
   FLOATING HEARTS (live)
────────────────────────────────────────────── */
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

/* ──────────────────────────────────────────────
   LIKE — same as feed
────────────────────────────────────────────── */
function vpToggleLike() {
  if (!currentUser) { showToast('Sign in to love this'); return; }

  _vp.liked     = !_vp.liked;
  _vp.likeCount = _vp.liked ? _vp.likeCount + 1 : Math.max(0, _vp.likeCount - 1);
  _vpPaintLike();

  const svg = document.querySelector('#vp-like-btn .vp-heart-svg');
  if (svg) animateHeart(svg, _vp.liked);

  if (_vp.videoType === 'live_commerce') _vpSpawnHeart();

  LikeStore.toggle(_vp.postId);
}

function _vpPaintLike() {
  const btn  = document.getElementById('vp-like-btn');
  const path = document.querySelector('#vp-like-btn .vp-heart-path');
  const svg  = document.querySelector('#vp-like-btn .vp-heart-svg');
  const cnt  = document.getElementById('vp-like-count');
  const RED  = 'rgb(244,7,82)';

  if (btn)  btn.classList.toggle('liked', _vp.liked);
  if (path) {
    path.setAttribute('fill',   _vp.liked ? RED   : 'white');
    path.setAttribute('stroke', _vp.liked ? RED   : 'white');
  }
  if (svg) {
    svg.setAttribute('fill',   _vp.liked ? RED   : 'white');
    svg.setAttribute('stroke', _vp.liked ? RED   : 'white');
  }
  if (cnt) cnt.textContent = _vp.likeCount > 0 ? fmtNum(_vp.likeCount) : '';
}

/* ──────────────────────────────────────────────
   BOOKMARK — delegates to toggleSave() from app-social.js
────────────────────────────────────────────── */
function vpToggleBookmark() {
  if (!currentUser) { showToast('Sign in to save this'); return; }
  const btn = document.getElementById('vp-bookmark-btn');
  toggleSave(_vp.postId, btn);
  setTimeout(() => {
    _vp.bookmarked = savedPosts.has(_vp.postId);
    _vpPaintBookmark();
  }, 0);
}

function _vpPaintBookmark() {
  const btn  = document.getElementById('vp-bookmark-btn');
  const path = document.querySelector('#vp-bookmark-btn .vp-bookmark-path');
  const PURPLE = '#6C47FF';
  if (btn)  btn.classList.toggle('bookmarked', _vp.bookmarked);
  if (path) path.setAttribute('fill', _vp.bookmarked ? PURPLE : 'white');
}

/* ──────────────────────────────────────────────
   REPOST — identical to feed: calls handleRepost()
────────────────────────────────────────────── */
function vpRepost() {
  const btn = document.getElementById('vp-repost-btn');
  handleRepost(_vp.postId, btn, _vp.postUserId);
}

function _vpPaintRepost() {
  const btn = document.getElementById('vp-repost-btn');
  const svg = btn?.querySelector('.vp-repost-svg');
  if (btn) {
    btn.classList.toggle('reposted', _vp.reposted);
    // Must match how feed sets this — handleRepost reads dataset.reposted to decide undo vs repost
    btn.dataset.reposted = _vp.reposted ? 'true' : 'false';
  }
  if (svg) svg.style.stroke = _vp.reposted ? '#6C47FF' : 'white';
}

/* ──────────────────────────────────────────────
   COMMENT — slides back to detail page with PiP bubble
────────────────────────────────────────────── */
function vpOpenComments() {
  if (!_vp.postId) return;

  const mainVid = document.getElementById('vp-video');
  const savedSrc  = mainVid?.src  || '';
  const savedTime = mainVid?.currentTime || 0;
  const savedPostId = _vp.postId;
  const savedType   = _vp.videoType;

  // Pause main video before leaving (no audio bleed)
  if (mainVid) { mainVid.pause(); }

  // Go back then open detail at comments
  slideBack();
  openDetail(savedPostId, true);

  // Inject PiP after detail page has rendered
  setTimeout(() => {
    _vpInjectPiP(savedSrc, savedTime, savedPostId, savedType);
  }, 380);
}

function _vpInjectPiP(src, startTime, postId, videoType) {
  _vpRemovePiP();

  const pip = document.createElement('div');
  pip.id = 'vp-pip-bubble';
  pip.innerHTML = `
    <video id="vp-pip-vid" playsinline loop
      style="width:100%;height:100%;object-fit:cover;display:block;border-radius:14px"></video>
    <button id="vp-pip-close" onclick="event.stopPropagation();_vpRemovePiP()" aria-label="Close">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.8" stroke-linecap="round">
        <path d="M18 6L6 18M6 6l12 12"/>
      </svg>
    </button>
    <div id="vp-pip-play-hint">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M5 3l14 9L5 21V3z"/></svg>
    </div>
  `;

  document.body.appendChild(pip);

  // ── Aspect-ratio shaping ──────────────────────────────
  const vid = document.getElementById('vp-pip-vid');
  if (vid) {
    vid.src = src;
    vid.currentTime = startTime;
    vid.addEventListener('loadedmetadata', () => {
      const isLandscape = vid.videoWidth > vid.videoHeight;
      if (isLandscape) {
        pip.style.width  = '220px';
        pip.style.height = '124px';
      } else {
        pip.style.width  = '140px';
        pip.style.height = '235px';
      }
      _vpMakeDraggable(pip);
    }, { once: true });
    vid.play().catch(() => {});
  }

  // ── Tap to return to full screen ──────────────────────
  pip.addEventListener('click', () => {
    const pipVid = document.getElementById('vp-pip-vid');
    const resumeTime = pipVid?.currentTime || 0;
    _vpRemovePiP();
    openVideoPlayer(postId, videoType || 'video', resumeTime);
  });
}

function _vpMakeDraggable(pip) {
  let startX, startY, startLeft, startTop, dragging = false, moved = false;

  pip.addEventListener('touchstart', e => {
    // Only drag from the bubble itself, not the close button
    if (e.target.closest('#vp-pip-close')) return;
    const t = e.touches[0];
    const rect = pip.getBoundingClientRect();
    startX    = t.clientX;
    startY    = t.clientY;
    startLeft = rect.left;
    startTop  = rect.top;
    dragging  = true;
    moved     = false;
    pip.style.transition = 'none';
  }, { passive: true });

  pip.addEventListener('touchmove', e => {
    if (!dragging) return;
    const t = e.touches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
    if (!moved) return;

    const W = window.innerWidth;
    const H = window.innerHeight;
    const pw = pip.offsetWidth;
    const ph = pip.offsetHeight;

    const newLeft = Math.min(Math.max(0, startLeft + dx), W - pw);
    const newTop  = Math.min(Math.max(0, startTop  + dy), H - ph);

    pip.style.left = newLeft + 'px';
    pip.style.top  = newTop  + 'px';
    pip.style.right = 'auto';
  }, { passive: true });

  pip.addEventListener('touchend', e => {
    if (!dragging) return;
    dragging = false;
    if (!moved) return; // was a tap — let click handler fire

    // Snap to nearest edge (left or right)
    const W    = window.innerWidth;
    const pw   = pip.offsetWidth;
    const curL = pip.getBoundingClientRect().left;
    const snapLeft = curL + pw / 2 < W / 2 ? 16 : W - pw - 16;

    pip.style.transition = 'left 0.25s cubic-bezier(0.25,0.46,0.45,0.94), top 0.25s cubic-bezier(0.25,0.46,0.45,0.94)';
    pip.style.left = snapLeft + 'px';
    pip.style.right = 'auto';

    // Block the subsequent click so it doesn't trigger open-fullscreen
    pip._blockNextClick = true;
    setTimeout(() => { pip._blockNextClick = false; }, 350);
  });

  // Guard click after drag
  pip.addEventListener('click', e => {
    if (pip._blockNextClick) { e.stopImmediatePropagation(); }
  }, true);
}

function _vpRemovePiP() {
  const pip = document.getElementById('vp-pip-bubble');
  if (pip) pip.remove();
  const pipVid = document.getElementById('vp-pip-vid');
  if (pipVid) { pipVid.pause(); pipVid.src = ''; pipVid.load(); }
}

/* ──────────────────────────────────────────────
   PLAY / PAUSE / SEEK / PROGRESS
────────────────────────────────────────────── */
function vpTogglePlay() {
  const vid = document.getElementById('vp-video');
  if (!vid) return;

  const indicator = document.getElementById('vp-play-indicator');
  const iconPath  = document.getElementById('vp-play-indicator-icon');

  if (vid.paused) {
    vid.play();
    if (iconPath) iconPath.setAttribute('d', 'M5 3l14 9L5 21V3z');
  } else {
    vid.pause();
    if (iconPath) iconPath.setAttribute('d', 'M6 4h4v16H6zM14 4h4v16h-4z');
  }

  if (indicator) {
    indicator.classList.remove('show');
    void indicator.offsetWidth;
    indicator.classList.add('show');
  }
}

function vpSeek(e) {
  const vid  = document.getElementById('vp-video');
  const wrap = document.getElementById('vp-progress-wrap');
  if (!vid || !wrap || !vid.duration) return;
  const r = wrap.getBoundingClientRect();
  vid.currentTime = ((e.clientX - r.left) / r.width) * vid.duration;
}

function _vpStartProgress() {
  const vid  = document.getElementById('vp-video');
  const fill = document.getElementById('vp-progress-fill');
  if (!vid || !fill) return;
  // Remove any old listener to avoid stacking on re-open
  vid.ontimeupdate = null;
  vid.ontimeupdate = () => {
    if (vid.duration) fill.style.width = (vid.currentTime / vid.duration * 100) + '%';
  };
}

function vpShare() { if (_vp.postId) sharePost({ id: _vp.postId, content: _vp.postContent || '' }); }

/* ──────────────────────────────────────────────
   RESET / CLOSE
   Hard-stops video and aborts any pending network
   request so audio never bleeds into background.
────────────────────────────────────────────── */
function _vpReset() {
  if (_vp.floatTimer) { clearInterval(_vp.floatTimer); _vp.floatTimer = null; }
  _vpRemovePiP();

  const vid = document.getElementById('vp-video');
  if (vid) {
    vid.ontimeupdate = null;   // remove progress listener
    vid.pause();
    vid.src = '';              // detach source
    vid.load();                // abort any pending network fetch — kills buffering audio
    const fill = document.getElementById('vp-progress-fill');
    if (fill) fill.style.width = '0%';
  }

  const btn  = document.getElementById('vp-like-btn');
  const path = document.querySelector('#vp-like-btn .vp-heart-path');
  if (btn)  btn.classList.remove('liked');
  if (path) { path.setAttribute('fill', 'white'); path.setAttribute('stroke', 'white'); }

  const bBtn  = document.getElementById('vp-bookmark-btn');
  const bPath = document.querySelector('#vp-bookmark-btn .vp-bookmark-path');
  if (bBtn)  bBtn.classList.remove('bookmarked');
  if (bPath) bPath.setAttribute('fill', 'white');

  const rBtn = document.getElementById('vp-repost-btn');
  const rSvg = rBtn?.querySelector('.vp-repost-svg');
  if (rBtn) { rBtn.classList.remove('reposted'); rBtn.dataset.reposted = 'false'; }
  if (rSvg) rSvg.style.stroke = 'white';

  ['vp-like-count', 'vp-comment-count', 'vp-repost-count', 'vp-caption'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  });

  const fh = document.getElementById('vp-float-hearts');
  if (fh) fh.innerHTML = '';
}

function closeVideoPlayer() { _vpReset(); slideBack(); }

/* ──────────────────────────────────────────────
   FEED VIDEO THUMBNAIL
────────────────────────────────────────────── */
function createFeedVideoThumb(p) {
  const isLive = p.video_type === 'live_commerce';
  const wrap   = document.createElement('div');
  wrap.className = 'feed-video-thumb';
  wrap.dataset.postId = p.id;

  wrap.innerHTML = `
    <video preload="metadata" muted playsinline>
      <source src="${p.video}#t=0.5" type="video/mp4">
    </video>
    ${isLive ? `<div class="feed-video-live-badge"><span style="width:6px;height:6px;border-radius:50%;background:#fff;display:inline-block;margin-right:4px"></span>LIVE</div>` : ''}
    <div class="feed-video-play-wrap">
      <div class="feed-video-play-circle">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="white" style="margin-left:3px">
          <path d="M5 3l14 9L5 21V3z"/>
        </svg>
      </div>
    </div>
    <div class="feed-video-duration" id="fvd-${p.id}"></div>
  `;

  const videoEl = wrap.querySelector('video');
  if (videoEl) {
    videoEl.addEventListener('loadedmetadata', () => {
      const dur   = videoEl.duration;
      const durEl = document.getElementById('fvd-' + p.id);
      if (durEl && dur && isFinite(dur)) {
        const m = Math.floor(dur / 60);
        const s = Math.floor(dur % 60).toString().padStart(2, '0');
        durEl.textContent = m + ':' + s;
      }
    });
  }

  wrap.addEventListener('click', (e) => {
    e.stopPropagation();
    openVideoPlayer(p.id, p.video_type || 'video');
  });

  return wrap;
}
