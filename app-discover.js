/* ═══════════════════════════════════════════
   MISTYNOTE — app-discover.js
   Discovery tab: search bar, tabs (Posts /
   People / Products), For You grid, recent
   searches, trending topics.
   Requires: app-core.js, app-social.js
   ═══════════════════════════════════════════ */

// ── Module state ──────────────────────────
const Disc = {
  query:        '',          // current search term
  tab:          'posts',     // active tab: posts | people | products
  forYouLoaded: false,       // guard – only load once per session
  debounceTimer: null,
  RECENT_KEY: 'disc_recent_v2',

  // Social proof labels cycling on product cards
  PROOF: [
    '🔥 Trending now',
    '⭐ Highly rated',
    '🛒 Added to cart by many',
    '💬 Lots of buzz',
    '✅ Frequently repurchased',
    '⚡ Flash deal',
  ],
};

// ═══════════════════════════════════════════
// RECENT SEARCHES
// ═══════════════════════════════════════════

function discGetRecent() {
  try { return JSON.parse(localStorage.getItem(Disc.RECENT_KEY) || '[]'); }
  catch { return []; }
}

function discSaveRecent(arr) {
  localStorage.setItem(Disc.RECENT_KEY, JSON.stringify(arr.slice(0, 12)));
}

function discAddRecent(term) {
  if (!term || term.length < 2) return;
  const arr = discGetRecent().filter(x => x.toLowerCase() !== term.toLowerCase());
  arr.unshift(term);
  discSaveRecent(arr);
}

function discRemoveRecent(term) {
  discSaveRecent(discGetRecent().filter(x => x !== term));
  discRenderRecent();
}

function discClearAllRecent() {
  discSaveRecent([]);
  discRenderRecent();
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
        <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      ${escHtml(t)}
      <span class="disc-recent-pill-x"
            onclick="event.stopPropagation(); discRemoveRecent('${escHtml(t)}')">×</span>
    </div>`).join('');
}

// ═══════════════════════════════════════════
// SEARCH ENTRY POINTS
// ═══════════════════════════════════════════

/** Called by topic pill taps — strip leading emoji */
function discTopicTap(btn) {
  const raw  = btn.textContent.trim();
  const term = raw.replace(/^\S+\s/, ''); // strip "🔥 " prefix
  discRunSearch(term);
}

/** Programmatically set search term and run */
function discRunSearch(term) {
  const input = document.getElementById('disc-input');
  if (!input) return;
  input.value = term;
  discHandleInput(term);
}

/** Clear button */
function discClear() {
  const input = document.getElementById('disc-input');
  if (input) { input.value = ''; input.focus(); }
  discHandleInput('');
}

// ═══════════════════════════════════════════
// INPUT HANDLER (debounced)
// ═══════════════════════════════════════════

function discHandleInput(rawVal) {
  clearTimeout(Disc.debounceTimer);
  Disc.debounceTimer = setTimeout(() => discProcess(rawVal.trim()), 320);
}

function discProcess(q) {
  Disc.query = q;

  const xBtn = document.getElementById('disc-x-btn');
  const tabs = document.getElementById('disc-tabs');
  const home = document.getElementById('disc-home');
  const res  = document.getElementById('disc-results');

  if (xBtn) xBtn.style.display = q ? '' : 'none';

  if (!q) {
    // ── HOME state ──
    if (tabs) tabs.style.display = 'none';
    if (home) home.style.display = '';
    if (res)  res.style.display  = 'none';
    discRenderRecent();
    return;
  }

  // ── RESULTS state ──
  if (tabs) tabs.style.display = 'flex';
  if (home) home.style.display = 'none';
  if (res)  res.style.display  = '';

  // Reset all pane cache keys so they reload
  ['posts', 'people', 'products'].forEach(t => {
    const p = document.getElementById('disc-pane-' + t);
    if (p) {
      p.dataset.loadedFor = '';         // invalidate
      p.style.display = t === Disc.tab ? '' : 'none';
    }
  });

  discFetchResults(q, Disc.tab);
}

// ═══════════════════════════════════════════
// TAB SWITCHING
// ═══════════════════════════════════════════

function discTab(tab, btn) {
  Disc.tab = tab;

  // Highlight active tab button
  document.querySelectorAll('.disc-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');

  // Show/hide panes
  ['posts', 'people', 'products'].forEach(t => {
    const p = document.getElementById('disc-pane-' + t);
    if (p) p.style.display = t === tab ? '' : 'none';
  });

  // Fetch if pane not already loaded for current query
  if (Disc.query) discFetchResults(Disc.query, tab);
}

// ═══════════════════════════════════════════
// FETCH RESULTS ROUTER
// ═══════════════════════════════════════════

async function discFetchResults(q, tab) {
  const pane = document.getElementById('disc-pane-' + tab);
  if (!pane) return;

  // Skip if already loaded for this exact query
  if (pane.dataset.loadedFor === q) return;
  pane.dataset.loadedFor = q;

  pane.innerHTML = discSkeletonHTML();

  if (tab === 'posts')    await discFetchPosts(q, pane);
  if (tab === 'people')   await discFetchPeople(q, pane);
  if (tab === 'products') await discFetchProducts(q, pane);

  discAddRecent(q);
}

// ── Loading skeleton ──
function discSkeletonHTML() {
  const line = (w) => `
    <div style="height:13px;border-radius:8px;width:${w};margin-bottom:10px;
         background:var(--bg3);animation:shimmer 1.4s infinite;
         background-size:200% 100%;
         background-image:linear-gradient(90deg,var(--bg3) 25%,var(--bg2) 50%,var(--bg3) 75%)">
    </div>`;
  return `<div style="padding:18px 16px">
    ${line('55%')}${line('80%')}${line('40%')}${line('70%')}${line('35%')}
  </div>`;
}

// ═══════════════════════════════════════════
// POSTS TAB
// ═══════════════════════════════════════════

async function discFetchPosts(q, pane) {
  try {
    const { data, error } = await supabase
      .from('posts')
      .select(`id,content,image,video,created_at,like_count,repost_count,views,
               user_id,reposted_post_id,
               user:users(id,username,avatar),
               reposted_post:reposted_post_id(id,content,image,video,created_at,user_id,
                 user:users(id,username,avatar)),
               comments(count)`)
      .ilike('content', `%${q}%`)
      .order('like_count', { ascending: false })
      .limit(30);

    if (error) throw error;

    if (!data || !data.length) {
      pane.innerHTML = discNoResults('No posts found', 'Try different words or check spelling');
      return;
    }

    pane.innerHTML = '';
    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:10px;padding:10px 0';

    data.forEach(p => {
      const el = createFeedPost(p, false);
      if (el) {
        list.appendChild(el);
        observePost(el);
        LikeStore.seed(p.id, p.like_count || 0, likedPosts.has(p.id));
      }
    });

    pane.appendChild(list);

    const ids = data.map(p => p.id);
    checkLikedPosts(ids);
    checkRepostedPosts(ids);
    checkSavedPosts(ids);

  } catch (err) {
    console.error('[Discover] posts error:', err);
    pane.innerHTML = discNoResults('Could not load posts', err.message || '');
  }
}

// ═══════════════════════════════════════════
// PEOPLE TAB
// ═══════════════════════════════════════════

async function discFetchPeople(q, pane) {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id,username,avatar,bio,followers')
      .or(`username.ilike.%${q}%,bio.ilike.%${q}%`)
      .order('followers', { ascending: false })
      .limit(25);

    if (error) throw error;

    if (!data || !data.length) {
      pane.innerHTML = discNoResults('No people found', 'Try searching a username or topic');
      return;
    }

    // Batch-fetch who current user follows
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
        <img class="disc-person-av"
             src="${u.avatar || ''}"
             onerror="this.src='https://api.dicebear.com/7.x/adventurer/svg?seed=${escHtml(u.username||u.id)}'"
             alt="">
        <div class="disc-person-info">
          <div class="disc-person-name">${escHtml(u.username || '')}</div>
          <div class="disc-person-bio">
            ${u.bio
              ? escHtml(u.bio.slice(0, 60)) + (u.bio.length > 60 ? '…' : '')
              : fmtNum(u.followers || 0) + ' followers'}
          </div>
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

  } catch (err) {
    console.error('[Discover] people error:', err);
    pane.innerHTML = discNoResults('Could not load people', err.message || '');
  }
}

/** Follow / unfollow from discover people results */
async function discToggleFollow(btn, uid) {
  if (!currentUser) { showToast('Sign in to follow'); return; }
  const isFollowing = btn.classList.contains('following');
  btn.disabled = true;

  if (isFollowing) {
    const { error } = await supabase.from('follows').delete()
      .eq('follower_id', currentUser.id).eq('following_id', uid);
    if (!error) {
      btn.classList.remove('following');
      btn.textContent = 'Follow';
    } else {
      showToast('Could not unfollow');
    }
  } else {
    const { error } = await supabase.from('follows')
      .insert({ follower_id: currentUser.id, following_id: uid });
    if (!error) {
      btn.classList.add('following');
      btn.textContent = 'Following';
      insertNotification({ user_id: uid, actor_id: currentUser.id, post_id: null, type: 'follow' });
    } else {
      showToast('Could not follow');
    }
  }

  btn.disabled = false;
}

// ═══════════════════════════════════════════
// PRODUCTS TAB
// ═══════════════════════════════════════════

// Static demo products — swap for real Supabase query when products table is live
const DISC_DEMO_PRODUCTS = [
  {
    id: 'dp-1',
    title: 'Ankara Tote Bag — Handmade',
    image: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=400&q=80',
    price: 18500, currency: '₦', sold_count: 342,
    social: ['🔥 342 people bought this', '⭐ 4.9 star rating', '🛒 12 added to cart today'],
    seller: { username: '@AdaHandcraft', avatar: 'https://i.pravatar.cc/40?img=1' },
  },
  {
    id: 'dp-2',
    title: 'Natural Shea Butter Body Cream 500ml',
    image: 'https://images.unsplash.com/photo-1607006344380-b6775a0824a7?w=400&q=80',
    price: 5200, currency: '₦', sold_count: 1289,
    social: ['✅ 1.2K repurchased', '💬 "Best cream ever!"', '⚡ Flash sale — 20% off'],
    seller: { username: '@GlowByNkechi', avatar: 'https://i.pravatar.cc/40?img=5' },
  },
  {
    id: 'dp-3',
    title: "Men's Agbada Set — 3 Piece Custom",
    image: 'https://images.unsplash.com/photo-1594938298603-c8148c4b4f60?w=400&q=80',
    price: 95000, currency: '₦', sold_count: 87,
    social: ['👑 Premium quality fabric', '📦 Ships in 5 days', '🔥 Trending this week'],
    seller: { username: '@KingsTailors_Abj', avatar: 'https://i.pravatar.cc/40?img=3' },
  },
  {
    id: 'dp-4',
    title: 'Wireless Earbuds — 48hr Battery',
    image: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=400&q=80',
    price: 24000, currency: '₦', sold_count: 673,
    social: ['📱 Works with all phones', '⚡ Flash sale ends tonight', '🛒 2.1K added to cart'],
    seller: { username: '@TechVaultNG', avatar: 'https://i.pravatar.cc/40?img=8' },
  },
  {
    id: 'dp-5',
    title: 'Homemade Chin Chin 1kg — Crispy',
    image: 'https://images.unsplash.com/photo-1621939514649-280e2ee25f60?w=400&q=80',
    price: 3500, currency: '₦', sold_count: 2104,
    social: ['🍪 2.1K sold this month', '✅ Fresh baked daily', '💬 Customers keep coming back'],
    seller: { username: '@MamaDeliNG', avatar: 'https://i.pravatar.cc/40?img=9' },
  },
  {
    id: 'dp-6',
    title: 'Luxury Wig — 26" Brazilian Body Wave',
    image: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=400&q=80',
    price: 145000, currency: '₦', sold_count: 215,
    social: ['💅 215 happy customers', '⭐ 5-star reviews only', '🔥 Most wished for'],
    seller: { username: '@HairByFavour', avatar: 'https://i.pravatar.cc/40?img=47' },
  },
  {
    id: 'dp-7',
    title: 'Zobo Drink Set — 6 Bottles Premium',
    image: 'https://images.unsplash.com/photo-1546173159-315724a31696?w=400&q=80',
    price: 7800, currency: '₦', sold_count: 934,
    social: ['🌿 No preservatives', '✅ 934 orders delivered', '⚡ Order before 12pm, ship today'],
    seller: { username: '@ZoboQueenLagos', avatar: 'https://i.pravatar.cc/40?img=32' },
  },
  {
    id: 'dp-8',
    title: 'Afrobeats Drum Lesson — 4 Week Online',
    image: 'https://images.unsplash.com/photo-1519892300165-cb5542fb47c7?w=400&q=80',
    price: 35000, currency: '₦', sold_count: 156,
    social: ['🎵 156 students enrolled', '📹 Lifetime video access', '🔥 Trending in Music'],
    seller: { username: '@DrumsByEmeka', avatar: 'https://i.pravatar.cc/40?img=15' },
  },
];

async function discFetchProducts(q, pane) {
  try {
    // Filter demo list by query (replace with real Supabase query when ready)
    const filtered = q
      ? DISC_DEMO_PRODUCTS.filter(p =>
          p.title.toLowerCase().includes(q.toLowerCase()) ||
          (p.seller?.username || '').toLowerCase().includes(q.toLowerCase()))
      : DISC_DEMO_PRODUCTS;

    if (!filtered.length) {
      pane.innerHTML = discNoResults('No products found', 'Try a different search term');
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'disc-products-grid';

    filtered.forEach(prod => {
      const card = document.createElement('div');
      card.className = 'disc-product-card';

      const proofId   = 'sp-' + Math.random().toString(36).slice(2);
      const price     = Number(prod.price || 0).toLocaleString();
      const sold      = prod.sold_count ? Number(prod.sold_count).toLocaleString() + ' sold' : '';
      const firstProof = prod.social?.[0] || Disc.PROOF[0];

      card.innerHTML = `
        <div class="disc-product-img-wrap">
          ${prod.image
            ? `<img src="${prod.image}" alt="${escHtml(prod.title)}" loading="lazy">`
            : `<div style="width:100%;height:100%;background:${gradientFor(prod.id)}"></div>`}
        </div>
        <div class="disc-product-body">
          <div class="disc-product-title">${escHtml(prod.title || '')}</div>
          <div class="disc-product-social" id="${proofId}"
               style="transition:opacity .4s">${firstProof}</div>
          <div class="disc-product-price-row">
            <span class="disc-product-currency">${prod.currency || '₦'}</span>
            <span class="disc-product-amount">${price}</span>
            ${sold ? `<span class="disc-product-sold">${sold}</span>` : ''}
          </div>
          <div class="disc-product-seller" onclick="event.stopPropagation()">
            <img class="disc-product-seller-av"
                 src="${prod.seller?.avatar || ''}"
                 onerror="this.src=''"
                 alt="">
            <span class="disc-product-seller-name">${escHtml(prod.seller?.username || '')}</span>
          </div>
        </div>`;

      card.addEventListener('click', () => openProduct(prod.id));
      grid.appendChild(card);
      _discCycleProof(proofId, prod.social);
    });

    pane.innerHTML = '';
    pane.appendChild(grid);

  } catch (err) {
    console.error('[Discover] products error:', err);
    pane.innerHTML = discNoResults('Could not load products', err.message || '');
  }
}

function _discCycleProof(elId, arr) {
  const labels = arr && arr.length ? arr : Disc.PROOF;
  let idx = 0;
  const iv = setInterval(() => {
    const el = document.getElementById(elId);
    if (!el) { clearInterval(iv); return; }
    el.style.opacity = '0';
    setTimeout(() => {
      idx = (idx + 1) % labels.length;
      el.textContent  = labels[idx];
      el.style.opacity = '1';
    }, 400);
  }, 3200);
}

// Product page placeholder
function openProduct(id) {
  showToast('Product page coming soon 🛍️');
}

// ═══════════════════════════════════════════
// FOR YOU GRID (home state)
// ═══════════════════════════════════════════

async function discLoadForYou() {
  if (Disc.forYouLoaded) return;
  Disc.forYouLoaded = true;

  const grid = document.getElementById('disc-foryou-grid');
  if (!grid) return;

  try {
    const { data: posts, error } = await supabase
      .from('posts')
      .select(`id,content,image,video,created_at,like_count,repost_count,views,
               user_id,reposted_post_id,
               user:users(id,username,avatar),
               reposted_post:reposted_post_id(id,content,image,video,created_at,user_id,
                 user:users(id,username,avatar)),
               comments(count)`)
      .order('like_count', { ascending: false })
      .limit(20);

    if (error) throw error;

    grid.innerHTML = '';

    if (!posts || !posts.length) {
      grid.innerHTML = `<p style="color:var(--text2);padding:20px 16px;font-size:14px">
        Nothing here yet — be the first to post!</p>`;
      return;
    }

    posts.forEach(p => {
      const el = createFeedPost(p, false);
      if (el) {
        el.classList.add('fade-in');
        grid.appendChild(el);
        observePost(el);
        LikeStore.seed(p.id, p.like_count || 0, likedPosts.has(p.id));
      }
    });

    const ids = posts.map(p => p.id);
    checkLikedPosts(ids);
    checkRepostedPosts(ids);
    checkSavedPosts(ids);

  } catch (err) {
    console.error('[Discover] ForYou error:', err);
    const grid = document.getElementById('disc-foryou-grid');
    if (grid) grid.innerHTML = `<p style="color:var(--text3);padding:16px;font-size:13px">
      Couldn't load posts — ${err.message}</p>`;
  }
}

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════

function discNoResults(title, sub) {
  return `<div class="disc-no-results">
    <strong>${escHtml(title)}</strong>
    ${sub ? `<span>${escHtml(sub)}</span>` : ''}
  </div>`;
}

// ═══════════════════════════════════════════
// INIT — called every time the Discover tab
// is opened (navTo → loadDiscover)
// ═══════════════════════════════════════════

function loadDiscover() {
  const input = document.getElementById('disc-input');
  if (!input) return;

  // Wire events only once (flag stored on the element itself, not a module var,
  // so it survives hot-reloads of the page but not hard refreshes)
  if (!input._discWired) {
    input._discWired = true;

    input.addEventListener('input', e => discHandleInput(e.target.value));

    input.addEventListener('focus', () => {
      // Always refresh recent list on focus
      discRenderRecent();
    });

    // iOS: "Search" key on keyboard triggers search
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        discHandleInput(input.value);
      }
    });
  }

  // Always refresh recent section when tab opens
  discRenderRecent();

  // Load For You grid (idempotent)
  discLoadForYou();

  // Restore correct UI state based on current query value
  discProcess(input.value.trim());
}
