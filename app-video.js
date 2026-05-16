/* ═══════════════════════════════════════════
   MISTYNOTE — app-video.js
   Full-screen video player
   Modes: video | video_product | live_commerce
   Requires: app-core.js, app-social.js
═══════════════════════════════════════════ */

let _vp = {
  postId:     null,
  videoType:  null,
  liked:      false,
  likeCount:  0,
  floatTimer: null,
};

async function openVideoPlayer(postId, videoType) {
  _vp.postId    = postId;
  _vp.videoType = videoType || 'video';
  _vp.liked     = likedPosts.has(postId);
  _vp.likeCount = 0;

  slideTo('video', async () => {
    _vpReset();

    const { data: p } = await supabase
      .from('posts')
      .select('id, content, video, like_count, comment_count, user_id, user:users(id, username, avatar)')
      .eq('id', postId)
      .single();

    if (!p) { slideBack(); return; }

    const user = p.user || {};
    _vp.likeCount = p.like_count || 0;

    const vid = document.getElementById('vp-video');
    if (vid) { vid.src = p.video || ''; vid.muted = false; vid.play().catch(() => {}); }
    _vpStartProgress();

    const avEl   = document.getElementById('vp-creator-av');
    const nameEl = document.getElementById('vp-creator-name');
    if (avEl)   avEl.src = user.avatar || '';
    if (nameEl) nameEl.textContent = user.username || '';

    const capEl = document.getElementById('vp-caption');
    if (capEl) capEl.textContent = p.content || '';

    _vpPaintLike();
    const lc = document.getElementById('vp-like-count');
    const cc = document.getElementById('vp-comment-count');
    if (lc) lc.textContent = _vp.likeCount > 0 ? fmtNum(_vp.likeCount) : '';
    if (cc) cc.textContent = p.comment_count > 0 ? fmtNum(p.comment_count) : '';

    _vpApplyMode(_vp.videoType);
    recordView(postId);
  });
}

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

function vpToggleLike() {
  if (!currentUser) { showToast('Sign in to love this'); return; }
  _vp.liked     = !_vp.liked;
  _vp.likeCount = _vp.liked ? _vp.likeCount + 1 : Math.max(0, _vp.likeCount - 1);
  _vpPaintLike();
  // Use same animateHeart animation as the feed
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
  if (cnt)  cnt.textContent = _vp.likeCount > 0 ? fmtNum(_vp.likeCount) : '';
}

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
  if (indicator) { indicator.classList.remove('show'); void indicator.offsetWidth; indicator.classList.add('show'); }
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
  vid.addEventListener('timeupdate', () => {
    if (vid.duration) fill.style.width = (vid.currentTime / vid.duration * 100) + '%';
  });
}

function vpOpenComments() { if (_vp.postId) openDetail(_vp.postId, true); }
function vpShare() { if (_vp.postId) sharePost({ id: _vp.postId, content: '' }); }

function _vpReset() {
  if (_vp.floatTimer) { clearInterval(_vp.floatTimer); _vp.floatTimer = null; }
  const vid = document.getElementById('vp-video');
  if (vid) { vid.pause(); vid.src = ''; }
  const btn  = document.getElementById('vp-like-btn');
  const path = document.querySelector('#vp-like-btn .vp-heart-path');
  if (btn)  btn.classList.remove('liked');
  if (path) { path.setAttribute('fill','none'); path.setAttribute('stroke','white'); }
  ['vp-like-count','vp-comment-count','vp-caption'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  });
  const fh = document.getElementById('vp-float-hearts');
  if (fh) fh.innerHTML = '';
}

function closeVideoPlayer() { _vpReset(); slideBack(); }

// ══════════════════════════════════════════
// FEED VIDEO THUMBNAIL
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
      const dur = videoEl.duration;
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
