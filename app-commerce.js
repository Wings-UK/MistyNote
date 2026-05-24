/* ═══════════════════════════════════════════

   MISTYNOTE — app-commerce.js

   Sidepane, Storefront, Products, Cart,

   Orders, My Bag, Merchant Dashboard,

   Discount Codes, Reviews

   Requires: app-core.js, app-wallet.js

═══════════════════════════════════════════ */

'use strict';

// ── COMMERCE STATE ────────────────────────────────────────

let currentStorefront = null;

let cartCount = 0;

let cartItems = [];

let currentProductId = null;

let currentStorefrontId = null;

let editingProductId = null;

function mktNgnToMp(ngn) { return Math.ceil((ngn / BUY_RATE) * 100) / 100; }

function mktMpToNgn(mp)  { return Math.round(mp * BUY_RATE); }

function mktFmtNgn(n)    { return '₦' + Number(n).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }

// ══════════════════════════════════════════

// SIDEPANE

// ══════════════════════════════════════════

async function openSidePanel(section) {

  if (!currentUser) { showToast('Sign in to continue'); return; }

  const pane     = document.getElementById('sidepane');

  const backdrop = document.getElementById('sidepane-backdrop');

  const avEl     = document.getElementById('sidepane-avatar');

  const unEl     = document.getElementById('sidepane-username');

  const snEl     = document.getElementById('sidepane-store-name');

  if (avEl) { avEl.src = currentProfile?.avatar || ''; avEl.className = currentStorefront ? 'sidepane-avatar square' : 'sidepane-avatar'; }

  if (unEl) unEl.textContent = '@' + (currentProfile?.username || '');

  if (snEl) { snEl.textContent = currentStorefront?.store_name || ''; snEl.style.display = currentStorefront ? 'block' : 'none'; }

  const merchantSection  = document.getElementById('sidepane-merchant-section');

  const openStoreSection = document.getElementById('sidepane-open-store-section');

  if (merchantSection)  merchantSection.style.display  = currentStorefront ? 'block' : 'none';

  if (openStoreSection) openStoreSection.style.display = currentStorefront ? 'none'  : 'block';

  await syncCartCount();

  if (pane)     pane.classList.add('open');

  if (backdrop) backdrop.classList.add('open');

  if (section === 'cart') setTimeout(() => { closeSidePanel(); openSidePaneSection('cart'); }, 300);

}

function closeSidePanel() {

  document.getElementById('sidepane')?.classList.remove('open');

  document.getElementById('sidepane-backdrop')?.classList.remove('open');

}

function openSidePaneSection(section) {

  if (section === 'cart') slideTo('cart', loadCartPage);

}

// ══════════════════════════════════════════

// LOAD STOREFRONT STATE ON BOOT

// ══════════════════════════════════════════

async function loadMyStorefrontState() {

  if (!currentUser) return;

  try {

    const { data } = await supabase.from('storefronts').select('*').eq('user_id', currentUser.id).maybeSingle();

    currentStorefront = data || null;

    renderStorefrontBanner();

  } catch(e) { /* silent */ }

}

function renderStorefrontBanner() {

  // Update the existing beautiful banner in app-social.js — don't replace it

  const icon  = document.getElementById('prf-storefront-banner-icon');

  const title = document.getElementById('prf-storefront-banner-title');

  const sub   = document.getElementById('prf-storefront-banner-sub');

  const pill  = document.getElementById('prf-storefront-banner-pill');

  if (currentStorefront) {

    if (icon)  icon.textContent  = '🏪';

    if (title) title.textContent = currentStorefront.store_name;

    if (sub)   sub.textContent   = currentStorefront.category + ' · Tap to manage';

    if (pill)  { pill.textContent = 'Dashboard'; pill.style.background = 'var(--accent)'; pill.style.color = 'white'; }

  } else {

    if (icon)  icon.textContent  = '🛍️';

    if (title) title.textContent = 'Open your storefront';

    if (sub)   sub.textContent   = 'Sell anything. Get paid safely.';

    if (pill)  { pill.textContent = 'Open'; pill.style.background = ''; pill.style.color = ''; }

  }

}

// Called when logged-in user taps their own storefront banner

function handleStorefrontBannerTap() {

  if (currentStorefront) {

    openMyStorefront();

  } else {

    openCreateStorefront();

  }

}

// Called when viewing another user's profile and tapping their store banner

async function openStorefrontByUserId(userId) {

  const { data: sf } = await supabase

    .from('storefronts')

    .select('id')

    .eq('user_id', userId)

    .maybeSingle();

  if (sf) {

    openStorefront(sf.id);

  } else {

    showToast('This user has no active store');

  }

}

// ══════════════════════════════════════════

// CREATE STOREFRONT

// ══════════════════════════════════════════

let csfLogoFile = null;

let csfBannerFile = null;

function openCreateStorefront() {

  if (!currentUser) { showToast('Sign in to open a store'); return; }

  if (currentStorefront) { openMyStorefront(); return; }

  slideTo('create-storefront');

}

function csfPreviewLogo(input) {

  const file = input.files?.[0];

  if (!file) return;

  csfLogoFile = file;

  const preview = document.getElementById('csf-logo-preview');

  if (preview) {

    const img = document.createElement('img');

    img.src = URL.createObjectURL(file);

    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:16px';

    preview.innerHTML = '';

    preview.appendChild(img);

  }

}

function csfPreviewBanner(input) {

  const file = input.files?.[0];

  if (!file) return;

  csfBannerFile = file;

  const wrap = document.getElementById('csf-banner-wrap');

  if (wrap) {

    const img = document.createElement('img');

    img.src = URL.createObjectURL(file);

    img.style.cssText = 'width:100%;height:100%;object-fit:cover';

    wrap.innerHTML = '';

    wrap.appendChild(img);

  }

}

let csfNameDebounce = null;

function csfValidateName(input) {

  const val   = input.value.trim();

  const wrap  = document.getElementById('csf-name-wrap');

  const hint  = document.getElementById('csf-name-hint');

  const error = document.getElementById('csf-name-error');

  const btn   = document.getElementById('csf-submit-btn');

  wrap.classList.remove('error', 'valid');

  error.classList.add('hidden');

  btn.disabled = true;

  if (!val) { if (hint) hint.textContent = 'This will be your brand name on MistyNote'; return; }

  if (val.length < 2) { wrap.classList.add('error'); error.textContent = 'Store name too short'; error.classList.remove('hidden'); return; }

  if (hint) hint.textContent = 'Checking availability…';

  clearTimeout(csfNameDebounce);

  csfNameDebounce = setTimeout(async () => {

    const { data } = await supabase.from('storefronts').select('id').ilike('store_name', val).maybeSingle();

    if (data) {

      wrap.classList.add('error'); error.textContent = 'Store name already taken — try another'; error.classList.remove('hidden');

      if (hint) hint.textContent = '';

    } else {

      wrap.classList.add('valid'); if (hint) hint.textContent = 'Great name! ✓'; btn.disabled = false;

    }

  }, 500);

}

async function submitCreateStorefront() {

  const storeName   = document.getElementById('csf-store-name')?.value.trim();

  const description = document.getElementById('csf-description')?.value.trim();

  const category    = document.getElementById('csf-category')?.value;

  const phone       = document.getElementById('csf-phone')?.value.trim();

  const state       = document.getElementById('csf-state')?.value;

  const btn         = document.getElementById('csf-submit-btn');

  if (!storeName) { showToast('Enter your store name'); return; }

  if (!category)  { showToast('Select a business category'); return; }

  if (!phone)     { showToast('Enter your business phone'); return; }

  if (!state)     { showToast('Select your state'); return; }

  if (walletState.points < 1) { showToast('You need at least MP 1 to open a store'); return; }

  btn.disabled = true; btn.textContent = 'Opening your store…';

  try {

    let logoUrl = '';

    if (csfLogoFile) {

      showToast('Uploading logo…');

      const path = `storefronts/${currentUser.id}/logo.jpg`;

      const compressed = await compressImage(csfLogoFile, 400);

      await supabase.storage.from('avatars').upload(path, compressed, { upsert: true, contentType: 'image/jpeg' });

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);

      logoUrl = urlData.publicUrl + '?t=' + Date.now();

    }

    let bannerUrl = '';

    if (csfBannerFile) {

      showToast('Uploading banner…');

      const path = `storefronts/${currentUser.id}/banner.jpg`;

      const compressed = await compressImage(csfBannerFile, 1200);

      await supabase.storage.from('avatars').upload(path, compressed, { upsert: true, contentType: 'image/jpeg' });

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);

      bannerUrl = urlData.publicUrl + '?t=' + Date.now();

    }

    const slug = storeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const pinOk = await walletPinCheck();

    if (!pinOk) { btn.disabled = false; btn.textContent = 'Open My Store — MP 1/month'; return; }

    const expiry = new Date(); expiry.setMonth(expiry.getMonth() + 1);

    const { data: sf, error } = await supabase.from('storefronts').insert({

      user_id: currentUser.id, store_name: storeName, slug, description, category, phone, state,

      logo_url: logoUrl, banner_url: bannerUrl, subscription_expires_at: expiry.toISOString(), is_active: true,

    }).select().single();

    if (error) throw error;

    currentStorefront = sf;

    renderStorefrontBanner();

    showToast('Your store is open! 🎉');

    slideBack();

    setTimeout(() => openMyStorefront(), 400);

  } catch(e) {

    showToast('Failed to create store: ' + (e.message || 'Try again'));

    btn.disabled = false; btn.textContent = 'Open My Store — MP 1/month';

  }

}

// ══════════════════════════════════════════

// MY STOREFRONT (Merchant view)

// ══════════════════════════════════════════

function openMyStorefront() {

  if (!currentStorefront) { openCreateStorefront(); return; }

  slideTo('my-storefront', renderMyStorefront);

}

async function renderMyStorefront() {

  const el = document.getElementById('my-storefront-content');

  if (!el) return;

  el.innerHTML = `<div class="loading-pulse" style="height:300px"></div>`;

  const [sfRes, productsRes, ordersRes] = await Promise.all([

    supabase.from('storefronts').select('*').eq('id', currentStorefront.id).maybeSingle(),

    supabase.from('products').select('id', { count: 'exact', head: true }).eq('storefront_id', currentStorefront.id).neq('status', 'archived'),

    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('storefront_id', currentStorefront.id).eq('status', 'paid'),

  ]);

  const sf            = sfRes.data || currentStorefront;

  const productCount  = productsRes.count || 0;

  const pendingOrders = ordersRes.count || 0;

  const badge = document.getElementById('sidepane-orders-badge');

  if (badge) { badge.textContent = pendingOrders; badge.style.display = pendingOrders > 0 ? 'flex' : 'none'; }

  el.innerHTML = `

    <div class="msf-banner-wrap">

      ${sf.banner_url ? `<img src="${sf.banner_url}" class="msf-banner-img" alt="">` : `<div class="msf-banner-placeholder"></div>`}

      <div class="msf-banner-overlay">

        <button class="msf-edit-banner-btn" onclick="document.getElementById('msf-banner-input').click()">

          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>

          Edit Banner

        </button>

      </div>

      <input type="file" id="msf-banner-input" accept="image/*" style="display:none" onchange="updateStorefrontBanner(this)">

    </div>

    <div class="msf-info-wrap">

      <div class="msf-logo-wrap">

        <img class="msf-logo" src="${sf.logo_url || ''}" onerror="this.style.display='none'" alt="">

        <button class="msf-edit-logo-btn" onclick="document.getElementById('msf-logo-input').click()">

          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>

        </button>

        <input type="file" id="msf-logo-input" accept="image/*" style="display:none" onchange="updateStorefrontLogo(this)">

      </div>

      <div class="msf-store-details">

        <div class="msf-store-name">${escHtml(sf.store_name)}</div>

        <div class="msf-store-cat">${escHtml(sf.category)}</div>

        ${sf.rating > 0 ? `<div class="msf-store-rating">★ ${sf.rating} · ${sf.review_count} reviews</div>` : ''}

      </div>

      <button class="msf-edit-btn" onclick="openEditStorefront()">Edit Store</button>

    </div>

    <div class="msf-stats-row">

      <div class="msf-stat" onclick="openMyProducts()">

        <div class="msf-stat-num">${productCount}</div>

        <div class="msf-stat-label">Products</div>

      </div>

      <div class="msf-stat" onclick="openShopOrders()">

        <div class="msf-stat-num">${sf.total_sales || 0}</div>

        <div class="msf-stat-label">Sales</div>

      </div>

      <div class="msf-stat" onclick="openMerchantDashboard()">

        <div class="msf-stat-num">${mktFmtNgn(sf.total_revenue || 0)}</div>

        <div class="msf-stat-label">Revenue</div>

      </div>

    </div>

    ${pendingOrders > 0 ? `

    <div class="msf-alert" onclick="openShopOrders()">

      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>

      ${pendingOrders} new order${pendingOrders > 1 ? 's' : ''} waiting · Tap to manage

    </div>` : ''}

    <div class="msf-actions">

      <button class="msf-action-btn" onclick="slideTo('add-product', buildAddProductForm)">

        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>

        Add Product

      </button>

      <button class="msf-action-btn" onclick="openMyProducts()">

        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>

        My Products

      </button>

      <button class="msf-action-btn" onclick="openShopOrders()">

        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>

        Shop Orders

      </button>

      <button class="msf-action-btn" onclick="openMerchantDashboard()">

        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>

        Analytics

      </button>

    </div>

    <div class="msf-subscription">

      <div class="msf-subscription-info">

        <span class="msf-subscription-label">Basic Plan</span>

        <span class="msf-subscription-expiry">Renews ${new Date(sf.subscription_expires_at).toLocaleDateString('en-NG', {day:'numeric',month:'short',year:'numeric'})}</span>

      </div>

      <button class="msf-renew-btn" onclick="renewStorefrontSubscription()">Renew</button>

    </div>

    <div style="padding:0 16px 24px">

      <button class="msf-view-public-btn" onclick="openStorefront('${sf.id}')">View Public Storefront</button>

    </div>`;

}

// ══════════════════════════════════════════

// PUBLIC STOREFRONT PAGE

// ══════════════════════════════════════════

async function openStorefront(storefrontId) {

  currentStorefrontId = storefrontId;

  slideTo('storefront', () => renderStorefront(storefrontId));

}

async function renderStorefront(storefrontId) {

  const el = document.getElementById('storefront-content');

  if (!el) return;

  el.innerHTML = `<div class="loading-pulse" style="height:400px"></div>`;

  const [sfRes, productsRes, reviewsRes] = await Promise.all([

    supabase.from('storefronts').select('*').eq('id', storefrontId).single(),

    supabase.from('products').select('*').eq('storefront_id', storefrontId).eq('status','active').order('created_at', { ascending: false }).limit(30),

    supabase.from('product_reviews').select('*, reviewer:users(username,avatar)').eq('storefront_id', storefrontId).order('created_at', { ascending: false }).limit(5),

  ]);

  const sf = sfRes.data;

  // Fetch store owner profile separately — avoids foreign key join issues

  let sfUser = {};

  if (sf?.user_id) {

    const { data: u } = await supabase.from('users').select('id,username,avatar,followers').eq('id', sf.user_id).maybeSingle();

    sfUser = u || {};

  }

  const products = productsRes.data || [];

  const reviews  = reviewsRes.data || [];

  if (!sf) { el.innerHTML = `<div class="empty-state"><p>Store not found</p></div>`; return; }

  const isOwner   = currentUser && sf.user_id === currentUser.id;

  const followers = sfUser.followers || 0;

  el.innerHTML = `

    <div class="sf-banner-wrap">

      ${sf.banner_url ? `<img src="${sf.banner_url}" class="sf-banner-img" alt="">` : `<div class="sf-banner-placeholder" style="background:${gradientFor(sf.id)}"></div>`}

      <div class="sf-banner-gradient"></div>

      <button class="sf-back-btn" onclick="slideBack()">

        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>

      </button>

    </div>

    <div class="sf-header">

      <img class="sf-logo merchant-avatar" src="${sf.logo_url || ''}" onerror="this.style.background='var(--bg2)';this.removeAttribute('src')" alt="">

      <div class="sf-header-info">

        <div class="sf-store-name">${escHtml(sf.store_name)}</div>

        <div class="sf-store-meta">

          ${sf.rating > 0 ? `<span>★ ${sf.rating}</span> · ` : ''}

          <span>${fmtNum(followers)} followers</span> · <span>${sf.category}</span>

        </div>

        ${sf.description ? `<div class="sf-store-desc">${escHtml(sf.description)}</div>` : ''}

      </div>

      ${!isOwner ? `<button class="sf-follow-btn" id="sf-follow-btn" onclick="toggleStorefrontFollow('${sf.user_id}',this)">Follow</button>`

        : `<button class="sf-follow-btn" onclick="openMyStorefront()">Manage</button>`}

    </div>

    <div class="sf-section">

      <div class="sf-section-title">Products <span style="color:var(--text3);font-weight:400">(${products.length})</span></div>

      ${products.length === 0 ? `<div class="sf-empty">No products yet</div>`

        : `<div class="sf-products-grid">${products.map(p => renderProductCard(p, sf)).join('')}</div>`}

    </div>

    ${reviews.length > 0 ? `

    <div class="sf-section">

      <div class="sf-section-title">Reviews</div>

      <div class="sf-reviews">

        ${reviews.map(r => `

          <div class="sf-review">

            <div class="sf-review-header">

              <img class="sf-review-avatar" src="${r.reviewer?.avatar || ''}" alt="">

              <div><div class="sf-review-name">@${escHtml(r.reviewer?.username||'')}</div>

              <div class="sf-review-stars">${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</div></div>

              <div class="sf-review-time">${timeSince(r.created_at)}</div>

            </div>

            ${r.review ? `<div class="sf-review-text">${escHtml(r.review)}</div>` : ''}

          </div>`).join('')}

      </div>

    </div>` : ''}`;

  if (!isOwner && currentUser) {

    const { data: followData } = await supabase.from('follows').select('id')

      .eq('follower_id', currentUser.id).eq('following_id', sf.user_id).maybeSingle();

    const followBtn = document.getElementById('sf-follow-btn');

    if (followBtn && followData) { followBtn.textContent = 'Following'; followBtn.classList.add('following'); }

  }

}

function renderProductCard(p, sf) {

  const img     = p.images?.[0] || '';

  const price   = mktFmtNgn(p.price_ngn);

  const mp      = fmtPts(mktNgnToMp(p.price_ngn));

  const orig    = p.compare_price_ngn > p.price_ngn ? `<span class="prd-card-orig">${mktFmtNgn(p.compare_price_ngn)}</span>` : '';

  const badge   = p.compare_price_ngn > p.price_ngn ? `<div class="prd-card-discount-badge">${Math.round((1-p.price_ngn/p.compare_price_ngn)*100)}% OFF</div>` : '';

  return `

    <div class="prd-card" onclick="openProductPage('${p.id}')">

      <div class="prd-card-img-wrap">

        ${img ? `<img src="${img}" class="prd-card-img" alt="" loading="lazy">` : `<div class="prd-card-img-placeholder" style="background:${gradientFor(p.id)}"></div>`}

        ${badge}

        ${p.stock === 0 ? `<div class="prd-card-sold-out">Sold Out</div>` : ''}

      </div>

      <div class="prd-card-body">

        <div class="prd-card-title">${escHtml(p.title)}</div>

        <div class="prd-card-price-row"><span class="prd-card-price">${price}</span>${orig}</div>

        <div class="prd-card-mp">${mp}</div>

        ${p.rating > 0 ? `<div class="prd-card-rating">★ ${p.rating} (${p.review_count})</div>` : ''}

      </div>

    </div>`;

}

async function toggleStorefrontFollow(userId, btn) {

  if (!currentUser) { showToast('Sign in to follow'); return; }

  const isFollowing = btn.classList.contains('following');

  btn.disabled = true;

  if (isFollowing) {

    const { error } = await supabase.from('follows').delete().eq('follower_id', currentUser.id).eq('following_id', userId);

    if (!error) { btn.textContent = 'Follow'; btn.classList.remove('following'); }

  } else {

    const { error } = await supabase.from('follows').insert({ follower_id: currentUser.id, following_id: userId });

    if (!error) { btn.textContent = 'Following'; btn.classList.add('following'); }

  }

  btn.disabled = false;

}

// ══════════════════════════════════════════

// PRODUCT PAGE

// ══════════════════════════════════════════

async function openProductPage(productId) {

  currentProductId = productId;

  pdpQty = 1;

  selectedVariants = {};

  slideTo('product', () => renderProductPage(productId));

}

async function renderProductPage(productId) {

  const el = document.getElementById('product-content');

  if (!el) return;

  el.innerHTML = `<div class="loading-pulse" style="height:400px"></div>`;

  // Fetch all separately to avoid foreign key join issues

  const [pRes, variantsRes, reviewsRes] = await Promise.all([

    supabase.from('products').select('*').eq('id', productId).maybeSingle(),

    supabase.from('product_variants').select('*').eq('product_id', productId),

    supabase.from('product_reviews').select('*, reviewer:users(username,avatar)').eq('product_id', productId).order('created_at', { ascending: false }).limit(10),

  ]);

  const p = pRes.data;

  if (!p) { el.innerHTML = `<div class="empty-state"><p>Product not found</p></div>`; return; }

  // Fetch storefront separately

  let sf = {};

  if (p.storefront_id) {

    const { data: sfData } = await supabase.from('storefronts').select('*').eq('id', p.storefront_id).maybeSingle();

    sf = sfData || {};

  }

  const images   = p.images || [];

  const variants = variantsRes.data || [];

  const reviews  = reviewsRes.data || [];

  const discount = p.compare_price_ngn > p.price_ngn ? Math.round((1 - p.price_ngn / p.compare_price_ngn) * 100) : 0;

  pdpCurrentImage = 0;

  el.innerHTML = `

    <!-- FIXED TOP HEADER BAR -->
    <div class="pdp-top-bar">
      <button class="pdp-top-back" onclick="slideBack()">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
      </button>
      <div class="pdp-top-brand">
        <div class="pdp-top-brand-logo">
          <svg width="28" height="14" viewBox="0 0 28 14" fill="none">
            <text x="2" y="11" font-family="Arial Black,sans-serif" font-size="11" font-weight="900" fill="white">MN</text>
          </svg>
        </div>
      </div>
      <div class="pdp-top-store">${escHtml(sf.store_name || 'MistyNote')}</div>
      <div class="pdp-top-actions">
        <button class="pdp-top-action-btn" onclick="/* search */">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        </button>
        <button class="pdp-top-action-btn" onclick="slideTo('cart')">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
        </button>
        <button class="pdp-top-action-btn" onclick="/* menu */">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
      </div>
    </div>

    <!-- SPACER below fixed header -->
    <div class="pdp-header-spacer"></div>

    <!-- PRODUCT IMAGE (square, full-width) -->
    <div class="pdp-images" id="pdp-images">
      ${images.length > 0
        ? images.map((img, i) => `<div class="pdp-img-slide ${i===0?'active':''}" data-index="${i}"><img src="${img}" class="pdp-img" alt="" loading="${i===0?'eager':'lazy'}"></div>`).join('')
        : `<div class="pdp-img-placeholder" style="background:${gradientFor(p.id)}"></div>`}
      ${images.length > 1
        ? `<div class="pdp-img-dots">${images.map((_,i) => `<div class="pdp-img-dot ${i===0?'active':''}" onclick="pdpGoToImage(${i})"></div>`).join('')}</div>`
        : ''}
      ${discount > 0 ? `<div class="pdp-discount-badge">${discount}%</div>` : ''}
    </div>

    <!-- MAIN INFO BLOCK -->
    <div class="pdp-info-block">

      <!-- Title -->
      <div class="pdp-title">${escHtml(p.title)}</div>

      <!-- Rating row: star + score + (recent 6mo score) + pipe + review count -->
      ${p.rating > 0 ? `
      <div class="pdp-rating-row">
        <span class="pdp-star">★</span>
        <span class="pdp-rating-score">${Number(p.rating).toFixed(2)}</span>
        <span class="pdp-rating-recent">(최근 6개월 ${Number(p.rating).toFixed(2)})</span>
        <span class="pdp-rating-pipe">|</span>
        <span class="pdp-rating-link">${p.review_count || 0}건 리뷰</span>
      </div>` : ''}

      <!-- Discount % + strikethrough original price -->
      ${p.compare_price_ngn > p.price_ngn ? `
      <div class="pdp-discount-row">
        <span class="pdp-discount-pct">${discount}%</span>
        <span class="pdp-compare-price">${mktFmtNgn(p.compare_price_ngn)}</span>
      </div>` : ''}

      <!-- Big red price -->
      <div class="pdp-price-big">${mktFmtNgn(p.price_ngn)}</div>

      <!-- Free delivery row -->
      <div class="pdp-free-delivery">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
        무료배송
      </div>

    </div><!-- /pdp-info-block -->

    <!-- INFO ROWS: Points · Benefits · Shipping -->
    <div class="pdp-info-rows">

      <!-- Points row -->
      <div class="pdp-info-row">
        <span class="pdp-row-label">적립</span>
        <div class="pdp-row-content">
          <div class="pdp-points-amount" onclick="this.closest('.pdp-info-row').querySelector('.pdp-points-card').style.display=this.closest('.pdp-info-row').querySelector('.pdp-points-card').style.display==='none'?'block':'none'">
            최대 적립 포인트 ${fmtPts(mktNgnToMp(p.price_ngn))}
            <span class="pdp-points-chevron">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
            </span>
          </div>
          <!-- Expandable points card -->
          <div class="pdp-points-card" style="display:none">
            <div class="pdp-points-card-top">
              <span class="pdp-points-badge">M+</span>
              <span class="pdp-points-card-desc">최대 5% 추가 적립</span>
              <span class="pdp-points-card-val">${fmtPts(Math.round(mktNgnToMp(p.price_ngn)*0.05))}</span>
            </div>
            <button class="pdp-points-card-btn">
              MP로 결제하고 최대 적립 받기
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          </div>
        </div>
      </div>

      <!-- Benefits row -->
      <div class="pdp-info-row">
        <span class="pdp-row-label">혜택</span>
        <div class="pdp-row-content">
          <div class="pdp-benefit-line">
            <span>MP 결제 시 최대 ${fmtPts(Math.round(mktNgnToMp(p.price_ngn)*0.02))} 추가 적립(2%)</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
          </div>
          <div class="pdp-benefit-line">
            <span>최대 12개월 할부 · 에스크로 보호</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
          </div>
        </div>
      </div>

      <!-- Shipping row -->
      <div class="pdp-info-row">
        <span class="pdp-row-label">배송</span>
        <div class="pdp-row-content">
          <div class="pdp-ship-detail">
            <strong>오늘출발 가능</strong><span class="pdp-ship-dot">·</span>도착 예정일 확인<br>
            지금 결제 시 빠른 발송 예정<br>
            무료배송
          </div>
          <div class="pdp-ship-more">
            자세히 보기
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
          </div>
        </div>
      </div>

    </div><!-- /pdp-info-rows -->

    <!-- REVIEW SUMMARY -->
    ${reviews.length > 0 || (p.review_count > 0) ? `
    <div class="pdp-review-summary">
      <div class="pdp-review-summary-title">
        4점 이상 리뷰가 <span>94%</span>예요
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="vertical-align:middle;margin-left:4px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      </div>
      <div class="pdp-review-cards">
        ${reviews.slice(0,5).map(r => `
          <div class="pdp-review-card">
            <img class="pdp-review-card-img" src="${r.reviewer?.avatar||''}" onerror="this.style.background='var(--bg3)';this.src=''" alt="">
            <div class="pdp-review-card-body">
              <div class="pdp-review-card-top">
                <span class="pdp-review-card-star">★</span>
                <span class="pdp-review-card-score">${r.rating}</span>
                <span class="pdp-review-card-tag">정사이즈</span>
              </div>
              <div class="pdp-review-card-text">${escHtml(r.review||'')}</div>
            </div>
          </div>`).join('')}
        ${reviews.length === 0 ? `
          <div class="pdp-review-card">
            <div class="pdp-review-card-img" style="background:var(--bg3)"></div>
            <div class="pdp-review-card-body">
              <div class="pdp-review-card-top"><span class="pdp-review-card-star">★</span><span class="pdp-review-card-score">5</span><span class="pdp-review-card-tag">정사이즈</span></div>
              <div class="pdp-review-card-text">편하고 예뻐요. 여름에 샌들에 신어도 잘어울리...</div>
            </div>
          </div>` : ''}
      </div>
    </div>` : ''}

    <!-- RELATED PRODUCTS -->
    <div class="pdp-related-section">
      <div class="pdp-related-header">
        <div class="pdp-related-title">다른 컬러&amp;디자인 상품</div>
      </div>
      <div class="pdp-related-scroll" id="pdp-related-scroll">
        <!-- Static placeholders; populate dynamically later -->
        <div class="pdp-related-card">
          <div class="pdp-related-img-wrap">
            <div class="pdp-related-img" style="background:var(--bg2)"></div>
            <button class="pdp-related-wish">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
            </button>
          </div>
          <button class="pdp-related-add-btn">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/></svg>
            담기
          </button>
          <div class="pdp-related-name">관련 상품</div>
          <div class="pdp-related-price-row">
            <span class="pdp-related-price">${mktFmtNgn(p.price_ngn)}</span>
          </div>
          <div class="pdp-related-ship">무료배송</div>
        </div>
      </div>
    </div>

    <!-- TAB BAR -->
    <div class="pdp-tab-bar" id="pdp-tab-bar">
      <button class="pdp-tab-btn active" onclick="pdpSwitchTab('details',this)">상세정보</button>
      <button class="pdp-tab-btn" onclick="pdpSwitchTab('reviews',this)">리뷰 ${p.review_count||0}</button>
      <button class="pdp-tab-btn" onclick="pdpSwitchTab('qa',this)">Q&amp;A</button>
      <button class="pdp-tab-btn" onclick="pdpSwitchTab('seller',this)">판매자정보</button>
      <button class="pdp-tab-btn" onclick="pdpSwitchTab('related',this)">추천</button>
    </div>

    <!-- TAB: DETAILS (default active) -->
    <div class="pdp-tab-panel active" id="pdp-panel-details">
      <div class="pdp-detail-panel">

        ${variants.length > 0 ? `
        <div class="pdp-variants" id="pdp-variants">
          ${variants.map(v => `
            <div class="pdp-variant-group">
              <div class="pdp-variant-label">${escHtml(v.name)}</div>
              <div class="pdp-variant-options">
                ${(v.options||[]).map((opt,i) => `
                  <button class="pdp-variant-opt ${i===0?'selected':''} ${opt.stock===0?'out-of-stock':''}"
                    data-variant-id="${v.id}" data-option-index="${i}"
                    onclick="selectVariantOption(this,'${v.id}',${i})" ${opt.stock===0?'disabled':''}>
                    ${escHtml(opt.name)}
                    ${opt.price_ngn && opt.price_ngn !== p.price_ngn ? `<span style="font-size:10px;opacity:0.7;display:block">${mktFmtNgn(opt.price_ngn)}</span>` : ''}
                  </button>`).join('')}
              </div>
            </div>`).join('')}
        </div>` : ''}

        <div class="pdp-qty-row">
          <span class="pdp-qty-label">수량</span>
          <div class="pdp-qty-ctrl">
            <button class="pdp-qty-btn" onclick="pdpChangeQty(-1)">−</button>
            <span class="pdp-qty-val" id="pdp-qty">1</span>
            <button class="pdp-qty-btn" onclick="pdpChangeQty(1)">+</button>
          </div>
          <span class="pdp-stock-hint">${p.stock > 0 ? p.stock + ' in stock' : 'Out of stock'}</span>
        </div>

        ${p.description ? `
        <div class="pdp-detail-section-title">상품 설명</div>
        <div class="pdp-description">${escHtml(p.description)}</div>` : ''}

        <div class="pdp-detail-section-title">상품 정보</div>
        <div class="pdp-details">
          <div class="pdp-detail-row"><span>상태</span><span>${p.condition||'—'}</span></div>
          ${p.sku ? `<div class="pdp-detail-row"><span>SKU</span><span>${escHtml(p.sku)}</span></div>` : ''}
          ${p.weight_kg ? `<div class="pdp-detail-row"><span>무게</span><span>${p.weight_kg}kg</span></div>` : ''}
          <div class="pdp-detail-row"><span>카테고리</span><span>${escHtml(p.category||'—')}</span></div>
        </div>

      </div>

      <!-- Safety notice -->
      <div class="pdp-safety-card">
        <svg class="pdp-safety-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10" fill="#ff3b5c" opacity="0.15"/><circle cx="12" cy="12" r="10" fill="none" stroke="#ff3b5c" stroke-width="2"/><line x1="12" y1="8" x2="12" y2="12" stroke="#ff3b5c" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16" r="1" fill="#ff3b5c"/></svg>
        <div class="pdp-safety-text">
          판매자가 타 사이트 안내 및 현금 결제, 개인정보 유시
          <a>결제/입력하지 마시고</a> 즉시 <a>고객센터로 신고</a>해주세요.
        </div>
      </div>
    </div>

    <!-- TAB: REVIEWS -->
    <div class="pdp-tab-panel" id="pdp-panel-reviews">
      <div class="pdp-reviews-panel">
        ${reviews.length > 0
          ? `<div class="pdp-reviews-top">4점 이상 리뷰가 <span>94%</span>예요</div>
             ${reviews.map(r => `
               <div class="sf-review">
                 <div class="sf-review-header">
                   <img class="sf-review-avatar" src="${r.reviewer?.avatar||''}" onerror="this.src=''" alt="">
                   <div>
                     <div class="sf-review-name">@${escHtml(r.reviewer?.username||'User')}</div>
                     <div class="sf-review-stars">${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</div>
                   </div>
                   <div class="sf-review-time">${timeSince(r.created_at)}</div>
                 </div>
                 ${r.review ? `<div class="sf-review-text">${escHtml(r.review)}</div>` : ''}
               </div>`).join('')}`
          : `<div style="padding:40px 0;text-align:center;color:var(--text3);font-size:14px;">아직 리뷰가 없어요</div>`}
      </div>
    </div>

    <!-- TAB: Q&A -->
    <div class="pdp-tab-panel" id="pdp-panel-qa">
      <div style="padding:40px 16px;text-align:center;color:var(--text3);font-size:14px;">Q&amp;A 준비 중입니다</div>
    </div>

    <!-- TAB: SELLER INFO -->
    <div class="pdp-tab-panel" id="pdp-panel-seller">
      ${sf.id ? `
      <div style="padding:16px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--border2);cursor:pointer" onclick="openStorefront('${sf.id}')">
        <img style="width:48px;height:48px;border-radius:10px;object-fit:cover;background:var(--bg2)" src="${sf.logo_url||''}" onerror="this.style.background='var(--bg2)'" alt="">
        <div style="flex:1">
          <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:2px">${escHtml(sf.store_name||'')}</div>
          <div style="font-size:12px;color:var(--text3)">${escHtml(sf.category||'')} · 스토어 방문</div>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
      </div>` : `<div style="padding:40px 16px;text-align:center;color:var(--text3);font-size:14px;">판매자 정보 없음</div>`}
    </div>

    <!-- TAB: RECOMMENDED -->
    <div class="pdp-tab-panel" id="pdp-panel-related">
      <div style="padding:40px 16px;text-align:center;color:var(--text3);font-size:14px;">추천 상품 준비 중입니다</div>
    </div>

    <!-- Bottom spacer so last content clears fixed CTA -->
    <div style="height:calc(72px + var(--safe-bottom))"></div>

    <!-- FIXED CTA BAR (wishlist | gift | buy now) -->
    <div class="pdp-cta-bar" id="pdp-cta-bar">
      <button class="pdp-wish-btn" id="pdp-wish-btn" onclick="/* wishlist */">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
      </button>
      ${p.stock > 0
        ? `<button class="pdp-gift-btn" onclick="/* gift */">
             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/></svg>
             선물하기
           </button>
           <button class="pdp-buy-now-btn" onclick="buyNow('${p.id}')">
             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><text x="7" y="16" font-family="Arial Black" font-size="9" fill="white" font-weight="900">M</text></svg>
             구매하기
           </button>`
        : `<button class="pdp-sold-out-btn" disabled>품절</button>`}
    </div>`;

  initPdpSwipe();

  // Record view

  if (currentUser) supabase.rpc('record_product_view', { p_product_id: productId }).catch(() => {});

}

let pdpCurrentImage = 0;

function pdpGoToImage(index) {

  document.querySelectorAll('.pdp-img-slide').forEach((s,i) => s.classList.toggle('active', i===index));

  document.querySelectorAll('.pdp-img-dot').forEach((d,i)   => d.classList.toggle('active', i===index));

  pdpCurrentImage = index;

}

function pdpSwitchTab(tab, btn) {

  // Switch panels
  document.querySelectorAll('.pdp-tab-panel').forEach(function(p) { p.classList.remove('active'); });
  var panel = document.getElementById('pdp-panel-' + tab);
  if (panel) panel.classList.add('active');

  // Switch active tab button
  document.querySelectorAll('.pdp-tab-btn').forEach(function(b) { b.classList.remove('active'); });
  if (btn) btn.classList.add('active');

  // Scroll tab bar so active tab is visible
  if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });

}

function initPdpSwipe() {

  const container = document.getElementById('pdp-images');

  if (!container) return;

  let startX = 0;

  container.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });

  container.addEventListener('touchend', e => {

    const diff  = startX - e.changedTouches[0].clientX;

    const total = document.querySelectorAll('.pdp-img-slide').length;

    if (Math.abs(diff) > 50) {

      if (diff > 0 && pdpCurrentImage < total - 1) pdpGoToImage(pdpCurrentImage + 1);

      if (diff < 0 && pdpCurrentImage > 0)         pdpGoToImage(pdpCurrentImage - 1);

    }

  }, { passive: true });

}

let pdpQty = 1;

function pdpChangeQty(delta) {

  pdpQty = Math.max(1, pdpQty + delta);

  const el = document.getElementById('pdp-qty');

  if (el) el.textContent = pdpQty;

}

let selectedVariants = {};

function selectVariantOption(btn, variantId, optionIndex) {

  document.querySelectorAll(`.pdp-variant-opt[data-variant-id="${variantId}"]`).forEach(b => b.classList.remove('selected'));

  btn.classList.add('selected');

  selectedVariants[variantId] = optionIndex;

}

// ══════════════════════════════════════════

// CART

// ══════════════════════════════════════════

async function syncCartCount() {

  if (!currentUser) return;

  try {

    const { count } = await supabase.from('cart_items').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id);

    cartCount = count || 0;

    updateCartBadges();

  } catch(e) { /* silent */ }

}

function updateCartBadges() {

  ['mkt-cart-badge','sidepane-cart-badge'].forEach(id => {

    const el = document.getElementById(id);

    if (el) { el.textContent = cartCount; el.style.display = cartCount > 0 ? 'flex' : 'none'; }

  });

}

async function addToCart(productId) {

  if (!currentUser) { showToast('Sign in to add to cart'); return; }

  const btn = document.getElementById('pdp-cart-btn');

  if (btn) btn.disabled = true;

  try {

    const { error } = await supabase.from('cart_items').upsert({

      user_id: currentUser.id, product_id: productId, quantity: pdpQty,

    }, { onConflict: 'user_id,product_id,variant_id' });

    if (error) throw error;

    cartCount++;

    updateCartBadges();

    if (btn) { btn.textContent = 'Added to Cart ✓'; btn.style.background = '#00c48c'; }

    showToast('Added to cart ✓');

  } catch(e) {

    showToast('Failed to add to cart');

    if (btn) btn.disabled = false;

  }

}

async function loadCartPage() {

  const el = document.getElementById('cart-content');

  if (!el) return;

  el.innerHTML = `<div class="loading-pulse" style="height:300px"></div>`;

  if (!currentUser) { el.innerHTML = `<div class="empty-state"><p>Sign in to view cart</p></div>`; return; }

  const { data: items } = await supabase.from('cart_items')

    .select('*, product:products(*, storefront:storefronts(store_name,logo_url))')

    .eq('user_id', currentUser.id).order('created_at', { ascending: false });

  cartItems = items || [];

  if (!cartItems.length) {

    el.innerHTML = `<div class="empty-state"><div style="font-size:48px;margin-bottom:12px">🛒</div><p>Your cart is empty</p><span>Browse the market to find products</span><button class="btn-primary" style="margin-top:16px" onclick="slideBack();navTo('market')">Browse Market</button></div>`;

    return;

  }

  const byStore = {};

  cartItems.forEach(item => {

    const key = item.product?.storefront?.store_name || 'Unknown Store';

    if (!byStore[key]) byStore[key] = [];

    byStore[key].push(item);

  });

  let subtotal = 0;

  cartItems.forEach(item => { subtotal += (item.product?.price_ngn || 0) * item.quantity; });

  el.innerHTML = `

    <div class="cart-body">

      ${Object.entries(byStore).map(([storeName, storeItems]) => `

        <div class="cart-store-group">

          <div class="cart-store-header">

            <img class="cart-store-logo merchant-avatar" src="${storeItems[0].product?.storefront?.logo_url||''}" onerror="this.style.display='none'" alt="">

            <span class="cart-store-name">${escHtml(storeName)}</span>

          </div>

          ${storeItems.map(item => `

            <div class="cart-item" id="cart-item-${item.id}">

              <div class="cart-item-img-wrap">

                ${item.product?.images?.[0] ? `<img src="${item.product.images[0]}" class="cart-item-img" alt="">` : `<div class="cart-item-img" style="background:${gradientFor(item.product_id)}"></div>`}

              </div>

              <div class="cart-item-info">

                <div class="cart-item-title">${escHtml(item.product?.title||'')}</div>

                <div class="cart-item-price">${mktFmtNgn(item.product?.price_ngn||0)}</div>

                <div class="cart-item-mp">${fmtPts(mktNgnToMp(item.product?.price_ngn||0))}</div>

              </div>

              <div class="cart-item-actions">

                <div class="cart-qty-ctrl">

                  <button class="cart-qty-btn" onclick="updateCartQty('${item.id}','${item.product_id}',-1)">−</button>

                  <span class="cart-qty-val" id="cart-qty-${item.id}">${item.quantity}</span>

                  <button class="cart-qty-btn" onclick="updateCartQty('${item.id}','${item.product_id}',1)">+</button>

                </div>

                <button class="cart-remove-btn" onclick="removeFromCart('${item.id}')">

                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/></svg>

                </button>

              </div>

            </div>`).join('')}

        </div>`).join('')}

      <div class="cart-summary">

        <div class="cart-summary-row"><span>Subtotal</span><span>${mktFmtNgn(subtotal)}</span></div>

        <div class="cart-summary-row"><span>Shipping</span><span>Calculated at checkout</span></div>

        <div class="cart-summary-total"><span>Total</span><span>${mktFmtNgn(subtotal)}</span></div>

        <div class="cart-summary-mp">Pay with ${fmtPts(mktNgnToMp(subtotal))}</div>

      </div>

      <div style="padding:0 16px 32px">

        <button class="cart-checkout-btn" onclick="openCheckout()">Proceed to Checkout</button>

      </div>

    </div>`;

}

async function updateCartQty(itemId, productId, delta) {

  const qtyEl  = document.getElementById(`cart-qty-${itemId}`);

  const newQty = Math.max(1, parseInt(qtyEl?.textContent || '1') + delta);

  if (qtyEl) qtyEl.textContent = newQty;

  await supabase.from('cart_items').update({ quantity: newQty }).eq('id', itemId);

}

async function removeFromCart(itemId) {

  const el = document.getElementById(`cart-item-${itemId}`);

  if (el) { el.style.opacity = '0.4'; el.style.pointerEvents = 'none'; }

  await supabase.from('cart_items').delete().eq('id', itemId);

  cartCount = Math.max(0, cartCount - 1);

  updateCartBadges();

  if (el) el.remove();

}

async function clearCart() {

  if (!currentUser) return;

  showActionSheet([{ label: 'Clear Cart', danger: true, action: async () => {

    await supabase.from('cart_items').delete().eq('user_id', currentUser.id);

    cartCount = 0; updateCartBadges(); loadCartPage();

  }}]);

}

async function buyNow(productId) {

  await addToCart(productId);

  openCheckout();

}

// ══════════════════════════════════════════

// CHECKOUT

// ══════════════════════════════════════════

async function openCheckout() { slideTo('checkout', loadCheckoutPage); }

async function loadCheckoutPage() {

  const el = document.getElementById('checkout-content');

  if (!el) return;

  el.innerHTML = `<div class="loading-pulse" style="height:300px"></div>`;

  if (!currentUser) { el.innerHTML = `<div class="empty-state"><p>Sign in to checkout</p></div>`; return; }

  const { data: items } = await supabase.from('cart_items')

    .select('*, product:products(*, storefront:storefronts(id,store_name,logo_url,user_id))')

    .eq('user_id', currentUser.id);

  if (!items?.length) { slideBack(); return; }

  const byStore = {};

  items.forEach(item => {

    const sfId = item.product?.storefront?.id;

    if (!byStore[sfId]) byStore[sfId] = { storefront: item.product?.storefront, items: [] };

    byStore[sfId].items.push(item);

  });

  const subtotal = items.reduce((s, i) => s + (i.product?.price_ngn||0) * i.quantity, 0);

  const { data: states } = await supabase.from('ng_states').select('name').order('name');

  el.innerHTML = `

    <div class="co-body">

      <div class="co-section">

        <div class="co-section-title">Order Summary</div>

        ${items.map(item => `

          <div class="co-item">

            <div class="co-item-img-wrap">

              ${item.product?.images?.[0] ? `<img src="${item.product.images[0]}" class="co-item-img" alt="">` : `<div class="co-item-img" style="background:${gradientFor(item.product_id)}"></div>`}

            </div>

            <div class="co-item-info">

              <div class="co-item-title">${escHtml(item.product?.title||'')}</div>

              <div class="co-item-qty">Qty: ${item.quantity}</div>

            </div>

            <div class="co-item-price">${mktFmtNgn((item.product?.price_ngn||0)*item.quantity)}</div>

          </div>`).join('')}

      </div>

      <div class="co-section">

        <div class="co-section-title">Delivery Information</div>

        <div class="co-field"><label class="co-label">Full Name</label><input class="co-input" id="co-name" placeholder="Recipient name" value="${currentProfile?.display_name||''}"></div>

        <div class="co-field"><label class="co-label">Phone Number</label><input class="co-input" id="co-phone" type="tel" placeholder="08012345678"></div>

        <div class="co-field"><label class="co-label">State</label>

          <select class="co-input" id="co-state" onchange="loadShippingRates()">

            <option value="">Select delivery state…</option>

            ${(states||[]).map(s => `<option>${s.name}</option>`).join('')}

          </select>

        </div>

        <div class="co-field"><label class="co-label">Delivery Address</label><textarea class="co-input" id="co-address" placeholder="Street address, area, landmark…" rows="2"></textarea></div>

      </div>

      <div class="co-section">

        <div class="co-section-title">Discount Code</div>

        <div class="co-discount-row">

          <input class="co-input" id="co-discount-code" placeholder="Enter code" style="flex:1">

          <button class="co-apply-btn" onclick="applyDiscountCode()">Apply</button>

        </div>

        <div class="co-discount-result" id="co-discount-result" style="display:none"></div>

      </div>

      <div class="co-section co-summary">

        <div class="co-summary-row"><span>Subtotal</span><span id="co-subtotal">${mktFmtNgn(subtotal)}</span></div>

        <div class="co-summary-row"><span>Shipping</span><span id="co-shipping">Select state above</span></div>

        <div class="co-summary-row" id="co-discount-row" style="display:none;color:var(--red)"><span>Discount</span><span id="co-discount-amount">-₦0</span></div>

        <div class="co-summary-total"><span>Total</span><span id="co-total">${mktFmtNgn(subtotal)}</span></div>

        <div class="co-wallet-balance">Wallet: ${fmtPts(walletState.points)}<span id="co-balance-status" style="margin-left:8px"></span></div>

      </div>

      <div class="co-pin-notice">

        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>

        Payment secured by your Wallet PIN

      </div>

      <button class="co-place-order-btn" id="co-place-btn" onclick="placeOrder()">Place Order</button>

      <div style="height:32px"></div>

    </div>`;

  window._coItems    = items;

  window._coByStore  = byStore;

  window._coSubtotal = subtotal;

  window._coDiscount = 0;

  window._coShipping = 0;

}

let _shippingByStore = {};

async function loadShippingRates() {

  const state      = document.getElementById('co-state')?.value;

  const shippingEl = document.getElementById('co-shipping');

  const totalEl    = document.getElementById('co-total');

  const balEl      = document.getElementById('co-balance-status');

  if (!state || !shippingEl) return;

  shippingEl.textContent = 'Loading…';

  const storeIds = Object.keys(window._coByStore || {});

  let totalShipping = 0;

  _shippingByStore  = {};

  for (const sfId of storeIds) {

    const { data: rate } = await supabase.from('shipping_rates').select('rate_ngn').eq('storefront_id', sfId).eq('state', state).maybeSingle();

    const r = rate?.rate_ngn || 0;

    _shippingByStore[sfId] = r;

    totalShipping += r;

  }

  window._coShipping = totalShipping;

  shippingEl.textContent = totalShipping > 0 ? mktFmtNgn(totalShipping) : 'Free';

  const total  = (window._coSubtotal||0) + totalShipping - (window._coDiscount||0);

  if (totalEl) totalEl.textContent = mktFmtNgn(total);

  const needed = mktNgnToMp(total);

  if (balEl) {

    balEl.textContent = walletState.points >= needed ? '✓ Sufficient' : `Need ${fmtPts(needed - walletState.points)} more`;

    balEl.style.color = walletState.points >= needed ? '#00c48c' : 'var(--red)';

  }

}

let _appliedDiscount = null;

async function applyDiscountCode() {

  const code     = document.getElementById('co-discount-code')?.value.trim().toUpperCase();

  const resultEl = document.getElementById('co-discount-result');

  if (!code || !resultEl) return;

  const storeIds = Object.keys(window._coByStore || {});

  let found = null;

  for (const sfId of storeIds) {

    const { data } = await supabase.from('discount_codes').select('*').eq('storefront_id', sfId).ilike('code', code).eq('is_active', true).maybeSingle();

    if (data) { found = data; break; }

  }

  if (!found) { resultEl.style.display='block'; resultEl.style.color='var(--red)'; resultEl.textContent='Invalid or expired code'; return; }

  if (found.expires_at && new Date(found.expires_at) < new Date()) { resultEl.style.display='block'; resultEl.style.color='var(--red)'; resultEl.textContent='This code has expired'; return; }

  if (found.max_uses && found.uses_count >= found.max_uses) { resultEl.style.display='block'; resultEl.style.color='var(--red)'; resultEl.textContent='This code has reached its usage limit'; return; }

  const subtotal = window._coSubtotal || 0;

  if (subtotal < (found.min_order_ngn||0)) { resultEl.style.display='block'; resultEl.style.color='var(--red)'; resultEl.textContent=`Minimum order ${mktFmtNgn(found.min_order_ngn)} required`; return; }

  const discount = found.type === 'percentage' ? Math.round(subtotal * found.value / 100) : found.value;

  window._coDiscount = discount;

  _appliedDiscount   = found;

  const discountRow = document.getElementById('co-discount-row');

  const discountAmt = document.getElementById('co-discount-amount');

  if (discountRow) discountRow.style.display = 'flex';

  if (discountAmt) discountAmt.textContent   = '-' + mktFmtNgn(discount);

  const total   = subtotal + (window._coShipping||0) - discount;

  const totalEl = document.getElementById('co-total');

  if (totalEl) totalEl.textContent = mktFmtNgn(total);

  resultEl.style.display='block'; resultEl.style.color='#00c48c';

  resultEl.textContent = `${found.type==='percentage' ? found.value+'%' : mktFmtNgn(found.value)} discount applied ✓`;

}

async function placeOrder() {

  const name    = document.getElementById('co-name')?.value.trim();

  const phone   = document.getElementById('co-phone')?.value.trim();

  const state   = document.getElementById('co-state')?.value;

  const address = document.getElementById('co-address')?.value.trim();

  const btn     = document.getElementById('co-place-btn');

  if (!name)    { showToast('Enter recipient name'); return; }

  if (!phone)   { showToast('Enter phone number'); return; }

  if (!state)   { showToast('Select delivery state'); return; }

  if (!address) { showToast('Enter delivery address'); return; }

  const subtotal = window._coSubtotal || 0;

  const shipping = window._coShipping || 0;

  const discount = window._coDiscount || 0;

  const total    = subtotal + shipping - discount;

  const mpNeeded = mktNgnToMp(total);

  if (walletState.points < mpNeeded) { showToast('Insufficient MistyPoints — top up your wallet'); openWallet(); return; }

  const pinOk = await walletPinCheck();

  if (!pinOk) return;

  btn.disabled = true; btn.textContent = 'Placing order…';

  try {

    for (const [sfId, storeData] of Object.entries(window._coByStore || {})) {

      const storeSubtotal = storeData.items.reduce((s,i) => s + (i.product?.price_ngn||0)*i.quantity, 0);

      const storeShipping = _shippingByStore[sfId] || 0;

      const storeDiscount = Math.round(storeData.items.length / (window._coItems?.length||1) * discount);

      const storeTotal    = storeSubtotal + storeShipping - storeDiscount;

      const storeMp       = mktNgnToMp(storeTotal);

      const { data: numData } = await supabase.rpc('generate_order_number');

      const orderNumber = numData || ('MN-' + Date.now().toString(36).toUpperCase());

      await supabase.rpc('escrow_hold_points', {

        buyer_id: currentUser.id, seller_id: storeData.storefront?.user_id, product_id: storeData.items[0]?.product_id, points: storeMp,

      });

      const { data: order, error: orderErr } = await supabase.from('orders').insert({

        order_number: orderNumber, buyer_id: currentUser.id, storefront_id: sfId,

        seller_id: storeData.storefront?.user_id, status: 'paid',

        subtotal_ngn: storeSubtotal, shipping_ngn: storeShipping, discount_ngn: storeDiscount,

        total_ngn: storeTotal, points_amount: storeMp, discount_code: _appliedDiscount?.code||null,

        shipping_state: state, shipping_address: address, shipping_phone: phone, shipping_name: name,

      }).select().single();

      if (orderErr) throw orderErr;

      await supabase.from('order_items').insert(storeData.items.map(item => ({

        order_id: order.id, product_id: item.product_id, product_title: item.product?.title||'',

        product_image: item.product?.images?.[0]||'', quantity: item.quantity, price_ngn: item.product?.price_ngn||0,

      })));

      for (const item of storeData.items) {

        await supabase.rpc('decrement_stock', { p_product_id: item.product_id, p_qty: item.quantity }).catch(() => {});

      }

      if (_appliedDiscount) {

        await supabase.from('discount_codes').update({ uses_count: (_appliedDiscount.uses_count||0)+1 }).eq('id', _appliedDiscount.id);

      }

      insertNotification({ user_id: storeData.storefront?.user_id, actor_id: currentUser.id, type: 'new_order', comment_text: `New order ${orderNumber} — ${mktFmtNgn(storeTotal)}` });

    }

    await supabase.from('cart_items').delete().eq('user_id', currentUser.id);

    cartCount = 0; updateCartBadges(); syncWalletBalance();

    showToast('Order placed successfully! 🎉');

    slideBack();

    setTimeout(() => openMyBag(), 400);

  } catch(e) {

    showToast('Order failed: ' + (e.message||'Try again'));

    btn.disabled = false; btn.textContent = 'Place Order';

  }

}

// ══════════════════════════════════════════

// MY BAG (Buyer orders)

// ══════════════════════════════════════════

function openMyBag() { slideTo('my-bag', loadMyBag); }

async function loadMyBag() {

  const el = document.getElementById('my-bag-content');

  if (!el) return;

  el.innerHTML = `<div class="loading-pulse" style="height:300px"></div>`;

  if (!currentUser) { el.innerHTML = `<div class="empty-state"><p>Sign in to view your bag</p></div>`; return; }

  const { data: orders } = await supabase.from('orders')

    .select('*, storefront:storefronts(store_name,logo_url), items:order_items(*, product:products(images,title))')

    .eq('buyer_id', currentUser.id).order('created_at', { ascending: false });

  if (!orders?.length) {

    el.innerHTML = `<div class="empty-state"><div style="font-size:48px;margin-bottom:12px">🛍️</div><p>No orders yet</p><span>Your purchases will appear here</span><button class="btn-primary" style="margin-top:16px" onclick="slideBack();navTo('market')">Start Shopping</button></div>`;

    return;

  }

  const statusColors = { pending:'#ff9500', paid:'#007aff', processing:'#007aff', shipped:'#6C47FF', delivered:'#00c48c', cancelled:'var(--text3)', refunded:'var(--text3)' };

  el.innerHTML = `

    <div class="bag-list">

      ${orders.map(order => {

        const img       = order.items?.[0]?.product?.images?.[0] || '';

        const statusCol = statusColors[order.status] || 'var(--text3)';

        return `

          <div class="bag-order-card" onclick="openOrderDetail('${order.id}','buyer')">

            <div class="bag-order-img-wrap">

              ${img ? `<img src="${img}" class="bag-order-img" alt="">` : `<div class="bag-order-img" style="background:${gradientFor(order.id)}"></div>`}

            </div>

            <div class="bag-order-info">

              <div class="bag-order-number">${order.order_number}</div>

              <div class="bag-order-store">${escHtml(order.storefront?.store_name||'')}</div>

              <div class="bag-order-items-hint">${order.items?.length||0} item${(order.items?.length||0)!==1?'s':''}</div>

              <div class="bag-order-total">${mktFmtNgn(order.total_ngn)}</div>

            </div>

            <div class="bag-order-right">

              <div class="bag-order-status" style="color:${statusCol}">${order.status.replace('_',' ')}</div>

              <div class="bag-order-date">${timeSince(order.created_at)}</div>

              ${order.status==='shipped' ? `<button class="bag-confirm-btn" onclick="event.stopPropagation();confirmDelivery('${order.id}')">Confirm Delivery</button>` : ''}

            </div>

          </div>`;

      }).join('')}

    </div>`;

}

async function confirmDelivery(orderId) {

  showActionSheet([{ label: 'Confirm Delivery', action: async () => {

    showToast('Confirming delivery…');

    const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single();

    if (!order) { showToast('Order not found'); return; }

    await supabase.rpc('escrow_release_points', { seller_id: order.seller_id, buyer_id: order.buyer_id, product_id: order.items?.[0]?.product_id, points: order.points_amount }).catch(() => {});

    await supabase.from('orders').update({ status: 'delivered', delivery_confirmed_at: new Date().toISOString() }).eq('id', orderId);

    await supabase.from('storefronts').update({ total_sales: supabase.raw('total_sales + 1'), total_revenue: supabase.raw(`total_revenue + ${order.total_ngn}`) }).eq('id', order.storefront_id).catch(() => {});

    insertNotification({ user_id: order.seller_id, actor_id: currentUser.id, type: 'delivery_confirmed', comment_text: `Order ${order.order_number} confirmed — MP released to your wallet` });

    showToast('Delivery confirmed! Payment released to seller ✓');

    loadMyBag();

    setTimeout(() => promptReview(orderId), 1000);

  }}]);

}

async function promptReview(orderId) {

  const { data: order } = await supabase.from('orders').select('*, items:order_items(product_id,product_title), storefront_id').eq('id', orderId).single();

  if (!order?.items?.length) return;

  showActionSheet([{ label: '⭐ Leave a Review', action: () => openLeaveReview(order) }, { label: 'Maybe later', action: () => {} }]);

}

// ══════════════════════════════════════════

// SHOP ORDERS (Seller incoming orders)

// ══════════════════════════════════════════

function openShopOrders() { slideTo('shop-orders', loadShopOrders); }

async function loadShopOrders() {

  const el = document.getElementById('shop-orders-content');

  if (!el || !currentStorefront) return;

  el.innerHTML = `<div class="loading-pulse" style="height:300px"></div>`;

  const { data: orders } = await supabase.from('orders')

    .select('*, buyer:users(username,avatar), items:order_items(*, product:products(title,images))')

    .eq('storefront_id', currentStorefront.id).order('created_at', { ascending: false });

  if (!orders?.length) {

    el.innerHTML = `<div class="empty-state"><div style="font-size:48px;margin-bottom:12px">📦</div><p>No orders yet</p><span>Orders from customers will appear here</span></div>`;

    return;

  }

  const tabs = ['All','Paid','Processing','Shipped','Delivered'];

  el.innerHTML = `

    <div class="so-tabs">

      ${tabs.map((t,i) => `<button class="so-tab ${i===0?'active':''}" onclick="filterShopOrders('${t.toLowerCase()}',this)">${t}</button>`).join('')}

    </div>

    <div class="so-list" id="so-list">

      ${orders.map(order => renderShopOrderCard(order)).join('')}

    </div>`;

}

function renderShopOrderCard(order) {

  const img       = order.items?.[0]?.product?.images?.[0] || '';

  const statusColors = { paid:'#007aff', processing:'#007aff', shipped:'#6C47FF', delivered:'#00c48c', cancelled:'var(--text3)' };

  const statusCol = statusColors[order.status] || 'var(--text3)';

  return `

    <div class="so-order-card" data-status="${order.status}" onclick="openOrderDetail('${order.id}','seller')">

      <div class="so-order-header">

        <div class="so-order-num">${order.order_number}</div>

        <div class="so-order-status" style="color:${statusCol}">${order.status.replace('_',' ')}</div>

      </div>

      <div class="so-order-body">

        <div class="so-order-img-wrap">

          ${img ? `<img src="${img}" class="so-order-img" alt="">` : `<div class="so-order-img" style="background:${gradientFor(order.id)}"></div>`}

        </div>

        <div class="so-order-info">

          <div class="so-order-buyer">

            <img class="so-order-buyer-av" src="${order.buyer?.avatar||''}" onerror="this.style.display='none'" alt="">

            @${escHtml(order.buyer?.username||'')}

          </div>

          <div class="so-order-items">${order.items?.length||0} item${(order.items?.length||0)!==1?'s':''}</div>

          <div class="so-order-total">${mktFmtNgn(order.total_ngn)} · ${fmtPts(order.points_amount)}</div>

          <div class="so-order-addr">${escHtml(order.shipping_state||'')} · ${timeSince(order.created_at)}</div>

        </div>

      </div>

      ${order.status==='paid'||order.status==='processing' ? `

      <div class="so-order-actions">

        ${order.status==='paid' ? `<button class="so-process-btn" onclick="event.stopPropagation();updateOrderStatus('${order.id}','processing')">Mark Processing</button>` : ''}

        <button class="so-ship-btn" onclick="event.stopPropagation();openShipOrder('${order.id}')">Upload Shipping Proof</button>

      </div>` : ''}

    </div>`;

}

function filterShopOrders(status, btn) {

  document.querySelectorAll('.so-tab').forEach(t => t.classList.remove('active'));

  btn.classList.add('active');

  document.querySelectorAll('.so-order-card').forEach(card => {

    card.style.display = (status==='all' || card.dataset.status===status) ? 'block' : 'none';

  });

}

async function updateOrderStatus(orderId, status) {

  await supabase.from('orders').update({ status, updated_at: new Date().toISOString() }).eq('id', orderId);

  showToast('Order updated to ' + status);

  loadShopOrders();

}

async function openShipOrder(orderId) {

  const input    = document.createElement('input');

  input.type     = 'file';

  input.accept   = 'image/*';

  input.onchange = async (e) => {

    const file = e.target.files?.[0];

    if (!file) return;

    showToast('Uploading shipping proof…');

    try {

      const path       = `shipping/${orderId}.jpg`;

      const compressed = await compressImage(file, 800);

      await supabase.storage.from('avatars').upload(path, compressed, { upsert: true, contentType: 'image/jpeg' });

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);

      const autoRelease = new Date(); autoRelease.setDate(autoRelease.getDate() + 7);

      await supabase.from('orders').update({

        status: 'shipped', shipping_proof_url: urlData.publicUrl,

        shipping_proof_uploaded_at: new Date().toISOString(),

        auto_release_at: autoRelease.toISOString(), updated_at: new Date().toISOString(),

      }).eq('id', orderId);

      const { data: order } = await supabase.from('orders').select('buyer_id,order_number').eq('id', orderId).single();

      if (order) insertNotification({ user_id: order.buyer_id, actor_id: currentUser.id, type: 'order_shipped', comment_text: `Your order ${order.order_number} has been shipped!` });

      showToast('Shipping proof uploaded ✓ MP auto-releases in 7 days if buyer doesn\'t confirm');

      loadShopOrders();

    } catch(e) { showToast('Upload failed — try again'); }

  };

  input.click();

}

// ══════════════════════════════════════════

// MY PRODUCTS

// ══════════════════════════════════════════

function openMyProducts() { slideTo('my-products', loadMyProducts); }

async function loadMyProducts() {

  const el = document.getElementById('my-products-content');

  if (!el || !currentStorefront) return;

  el.innerHTML = `<div class="loading-pulse" style="height:300px"></div>`;

  const { data: products } = await supabase.from('products').select('*')

    .eq('storefront_id', currentStorefront.id).neq('status','archived').order('created_at', { ascending: false });

  if (!products?.length) {

    el.innerHTML = `<div class="empty-state"><div style="font-size:48px;margin-bottom:12px">📦</div><p>No products yet</p><span>Add your first product to start selling</span><button class="btn-primary" style="margin-top:16px" onclick="slideTo('add-product',buildAddProductForm)">Add Product</button></div>`;

    return;

  }

  el.innerHTML = `

    <div class="mp-list">

      ${products.map(p => `

        <div class="mp-product-row" onclick="slideTo('add-product',()=>buildAddProductForm('${p.id}'))">

          <div class="mp-product-img-wrap">

            ${p.images?.[0] ? `<img src="${p.images[0]}" class="mp-product-img" alt="">` : `<div class="mp-product-img" style="background:${gradientFor(p.id)}"></div>`}

          </div>

          <div class="mp-product-info">

            <div class="mp-product-title">${escHtml(p.title)}</div>

            <div class="mp-product-price">${mktFmtNgn(p.price_ngn)}</div>

            <div class="mp-product-meta">

              <span class="mp-product-stock ${p.stock===0?'out':''}">${p.stock} in stock</span>

              <span class="mp-product-status ${p.status}">${p.status}</span>

            </div>

          </div>

          <div class="mp-product-stats">

            <div class="mp-product-stat">${p.views} views</div>

            <div class="mp-product-stat">${p.sales_count} sold</div>

          </div>

        </div>`).join('')}

    </div>`;

}

// ══════════════════════════════════════════

// ADD / EDIT PRODUCT

// ══════════════════════════════════════════

let productImages  = [];

let productVariants = [];

async function buildAddProductForm(productId) {

  editingProductId = productId || null;

  const el      = document.getElementById('add-product-content');

  const titleEl = document.getElementById('add-product-title');

  if (titleEl) titleEl.textContent = productId ? 'Edit Product' : 'Add Product';

  if (!el) return;

  let p = null;

  if (productId) {

    const { data } = await supabase.from('products').select('*, variants:product_variants(*)').eq('id', productId).single();

    p = data;

  }

  productImages   = p?.images || [];

  productVariants = p?.variants || [];

  const categories = ['Fashion & Clothing','Beauty & Skincare','Food & Beverages','Electronics & Gadgets','Home & Living','Health & Wellness','Kids & Baby','Sports & Fitness','Art & Crafts','Books & Education','Automotive','Agriculture & Farm','Services','Other'];

  el.innerHTML = `

    <div class="ap-body">

      <div class="ap-section">

        <div class="ap-section-title">Product Images <span style="color:var(--text3);font-weight:400">(up to 6)</span></div>

        <div class="ap-images-grid" id="ap-images-grid">

          ${productImages.map((img,i) => `<div class="ap-img-item" id="ap-img-${i}"><img src="${img}" class="ap-img-preview" alt=""><button class="ap-img-remove" onclick="removeProductImage(${i})">✕</button></div>`).join('')}

          ${productImages.length < 6 ? `<div class="ap-img-add" onclick="document.getElementById('ap-img-input').click()"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 5v14M5 12h14"/></svg></div>` : ''}

        </div>

        <input type="file" id="ap-img-input" accept="image/*" multiple style="display:none" onchange="addProductImages(this)">

      </div>

      <div class="ap-section">

        <div class="ap-field"><label class="ap-label">Product Title <span class="csf-required">*</span></label><input class="ap-input" id="ap-title" placeholder="e.g. Men's Leather Belt" maxlength="100" value="${escHtml(p?.title||'')}"></div>

        <div class="ap-field"><label class="ap-label">Description</label><textarea class="ap-textarea" id="ap-description" placeholder="Describe your product…" rows="4" maxlength="2000">${escHtml(p?.description||'')}</textarea></div>

        <div class="ap-field-row">

          <div class="ap-field" style="flex:1"><label class="ap-label">Price (₦) <span class="csf-required">*</span></label><input class="ap-input" id="ap-price" type="number" placeholder="0" min="0" value="${p?.price_ngn||''}"></div>

          <div class="ap-field" style="flex:1"><label class="ap-label">Compare Price (₦)</label><input class="ap-input" id="ap-compare-price" type="number" placeholder="Original price" min="0" value="${p?.compare_price_ngn||''}"></div>

        </div>

        <div class="ap-field-row">

          <div class="ap-field" style="flex:1"><label class="ap-label">Category <span class="csf-required">*</span></label>

            <select class="ap-input" id="ap-category"><option value="">Select…</option>${categories.map(c => `<option ${p?.category===c?'selected':''}>${c}</option>`).join('')}</select>

          </div>

          <div class="ap-field" style="flex:1"><label class="ap-label">Condition</label>

            <select class="ap-input" id="ap-condition">

              <option value="new" ${(!p?.condition||p?.condition==='new')?'selected':''}>New</option>

              <option value="used" ${p?.condition==='used'?'selected':''}>Used</option>

              <option value="refurbished" ${p?.condition==='refurbished'?'selected':''}>Refurbished</option>

            </select>

          </div>

        </div>

        <div class="ap-field-row">

          <div class="ap-field" style="flex:1"><label class="ap-label">Stock Quantity</label><input class="ap-input" id="ap-stock" type="number" placeholder="0" min="0" value="${p?.stock??1}"></div>

          <div class="ap-field" style="flex:1"><label class="ap-label">SKU</label><input class="ap-input" id="ap-sku" placeholder="Optional" value="${escHtml(p?.sku||'')}"></div>

        </div>

        <div class="ap-field"><label class="ap-label">Weight (kg)</label><input class="ap-input" id="ap-weight" type="number" placeholder="0.5" min="0" step="0.1" value="${p?.weight_kg||''}"></div>

      </div>

      <div class="ap-section">

        <div class="ap-section-header"><div class="ap-section-title">Variants</div><button class="ap-add-variant-btn" onclick="addVariantGroup()">+ Add Variant</button></div>

        <div id="ap-variants-list">${productVariants.map((v,vi) => renderVariantGroup(v,vi)).join('')}</div>

      </div>

      <div class="ap-section">

        <div class="ap-section-title">Shipping Rates</div>

        <button class="ap-shipping-btn" onclick="openShippingRates()">Manage Shipping by State →</button>

      </div>

      <div class="ap-section">

        <div class="ap-field"><label class="ap-label">Product Status</label>

          <select class="ap-input" id="ap-status">

            <option value="active" ${(!p?.status||p?.status==='active')?'selected':''}>Active</option>

            <option value="paused" ${p?.status==='paused'?'selected':''}>Paused</option>

          </select>

        </div>

      </div>

      ${productId ? `<button class="ap-delete-btn" onclick="archiveProduct('${productId}')">Delete Product</button>` : ''}

      <div style="height:32px"></div>

    </div>`;

}

function renderVariantGroup(v, vi) {

  return `

    <div class="ap-variant-group" id="ap-variant-${vi}">

      <div class="ap-variant-header">

        <input class="ap-input" placeholder="Variant name (e.g. Size)" value="${escHtml(v.name||'')}" id="ap-vname-${vi}">

        <button class="ap-remove-variant" onclick="removeVariantGroup(${vi})">✕</button>

      </div>

      <div class="ap-variant-options" id="ap-vopts-${vi}">

        ${(v.options||[]).map((opt,oi) => renderVariantOption(vi,oi,opt)).join('')}

      </div>

      <button class="ap-add-opt-btn" onclick="addVariantOption(${vi})">+ Add Option</button>

    </div>`;

}

function renderVariantOption(vi, oi, opt) {

  return `

    <div class="ap-variant-opt-row" id="ap-vopt-${vi}-${oi}">

      <input class="ap-input" placeholder="Option (e.g. XL)" value="${escHtml(opt?.name||'')}" style="flex:2" id="ap-vopt-name-${vi}-${oi}">

      <input class="ap-input" type="number" placeholder="Price ₦" value="${opt?.price_ngn||''}" style="flex:1" id="ap-vopt-price-${vi}-${oi}">

      <input class="ap-input" type="number" placeholder="Stock" value="${opt?.stock||''}" style="flex:1" id="ap-vopt-stock-${vi}-${oi}">

      <button class="ap-remove-variant" onclick="removeVariantOption(${vi},${oi})">✕</button>

    </div>`;

}

function addVariantGroup() {

  const idx  = document.querySelectorAll('.ap-variant-group').length;

  const list = document.getElementById('ap-variants-list');

  if (list) { const div = document.createElement('div'); div.innerHTML = renderVariantGroup({name:'',options:[]},idx); list.appendChild(div.firstElementChild); }

}

function removeVariantGroup(vi)        { document.getElementById(`ap-variant-${vi}`)?.remove(); }

function addVariantOption(vi)          { const opts = document.getElementById(`ap-vopts-${vi}`); if (!opts) return; const oi = opts.children.length; const div = document.createElement('div'); div.innerHTML = renderVariantOption(vi,oi,{}); opts.appendChild(div.firstElementChild); }

function removeVariantOption(vi, oi)   { document.getElementById(`ap-vopt-${vi}-${oi}`)?.remove(); }

async function addProductImages(input) {

  const files = Array.from(input.files||[]);

  if (!files.length) return;

  if (productImages.length + files.length > 6) { showToast('Maximum 6 images'); return; }

  showToast('Uploading images…');

  for (const file of files) {

    try {

      const path = `products/${currentUser.id}/${Date.now()}.jpg`;

      const compressed = await compressImage(file, 800);

      await supabase.storage.from('avatars').upload(path, compressed, { upsert: false, contentType: 'image/jpeg' });

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);

      productImages.push(urlData.publicUrl);

    } catch(e) { console.warn('Image upload failed', e); }

  }

  refreshImagesGrid(); input.value = '';

}

function removeProductImage(index) { productImages.splice(index, 1); refreshImagesGrid(); }

function refreshImagesGrid() {

  const grid = document.getElementById('ap-images-grid');

  if (!grid) return;

  grid.innerHTML = productImages.map((img,i) => `<div class="ap-img-item" id="ap-img-${i}"><img src="${img}" class="ap-img-preview" alt=""><button class="ap-img-remove" onclick="removeProductImage(${i})">✕</button></div>`).join('') +

    (productImages.length < 6 ? `<div class="ap-img-add" onclick="document.getElementById('ap-img-input').click()"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 5v14M5 12h14"/></svg></div>` : '');

}

async function saveProduct() {

  const title        = document.getElementById('ap-title')?.value.trim();

  const description  = document.getElementById('ap-description')?.value.trim();

  const price        = parseFloat(document.getElementById('ap-price')?.value||'0');

  const comparePrice = parseFloat(document.getElementById('ap-compare-price')?.value||'0');

  const category     = document.getElementById('ap-category')?.value;

  const condition    = document.getElementById('ap-condition')?.value||'new';

  const stock        = parseInt(document.getElementById('ap-stock')?.value||'0');

  const sku          = document.getElementById('ap-sku')?.value.trim();

  const weight       = parseFloat(document.getElementById('ap-weight')?.value||'0');

  const status       = document.getElementById('ap-status')?.value||'active';

  const btn          = document.getElementById('add-product-save-btn');

  if (!title)    { showToast('Enter product title'); return; }

  if (!price)    { showToast('Enter product price'); return; }

  if (!category) { showToast('Select a category'); return; }

  if (!currentStorefront) { showToast('No storefront found'); return; }

  if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }

  try {

    const variantGroups = document.querySelectorAll('.ap-variant-group');

    const variants = Array.from(variantGroups).map((group, vi) => {

      const name    = document.getElementById(`ap-vname-${vi}`)?.value.trim();

      const optRows = group.querySelectorAll('.ap-variant-opt-row');

      const options = Array.from(optRows).map((_,oi) => ({

        name:      document.getElementById(`ap-vopt-name-${vi}-${oi}`)?.value.trim(),

        price_ngn: parseFloat(document.getElementById(`ap-vopt-price-${vi}-${oi}`)?.value||'0')||price,

        stock:     parseInt(document.getElementById(`ap-vopt-stock-${vi}-${oi}`)?.value||'0'),

      })).filter(o => o.name);

      return { name, options };

    }).filter(v => v.name && v.options.length);

    const productData = {

      storefront_id: currentStorefront.id, seller_id: currentUser.id,

      title, description, category, condition, images: productImages,

      price_ngn: price, compare_price_ngn: comparePrice||null,

      sku: sku||null, weight_kg: weight||null, stock, has_variants: variants.length>0, status,

      updated_at: new Date().toISOString(),

    };

    let productId = editingProductId;

    if (editingProductId) {

      await supabase.from('products').update(productData).eq('id', editingProductId);

      await supabase.from('product_variants').delete().eq('product_id', editingProductId);

    } else {

      const { data: newProduct, error } = await supabase.from('products').insert(productData).select().single();

      if (error) throw error;

      productId = newProduct.id;

    }

    if (variants.length > 0 && productId) {

      await supabase.from('product_variants').insert(variants.map(v => ({ product_id: productId, name: v.name, options: v.options })));

    }

    showToast(editingProductId ? 'Product updated ✓' : 'Product listed ✓');

    slideBack();

  } catch(e) {

    showToast('Failed to save: ' + (e.message||'Try again'));

    if (btn) { btn.textContent = 'Save'; btn.disabled = false; }

  }

}

async function archiveProduct(productId) {

  showActionSheet([{ label: 'Delete Product', danger: true, action: async () => {

    await supabase.from('products').update({ status: 'archived' }).eq('id', productId);

    showToast('Product deleted'); slideBack();

  }}]);

}

// ══════════════════════════════════════════

// SHIPPING RATES MANAGER

// ══════════════════════════════════════════

async function openShippingRates() {

  if (!currentStorefront) return;

  const overlay = document.createElement('div');

  overlay.id    = 'shipping-rates-overlay';

  overlay.style.cssText = 'position:fixed;inset:0;z-index:900;background:var(--bg);overflow-y:auto;padding:0 0 80px';

  const { data: rates }  = await supabase.from('shipping_rates').select('*').eq('storefront_id', currentStorefront.id);

  const { data: states } = await supabase.from('ng_states').select('name').order('name');

  const rateMap = {};

  (rates||[]).forEach(r => { rateMap[r.state] = r; });

  overlay.innerHTML = `

    <div style="padding:calc(var(--safe-top)+16px) 16px 0;display:flex;align-items:center;gap:12px;margin-bottom:16px">

      <button onclick="document.getElementById('shipping-rates-overlay').remove()" style="background:none;border:none;cursor:pointer">

        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>

      </button>

      <h2 style="font-size:17px;font-weight:700;color:var(--text);margin:0">Shipping Rates</h2>

    </div>

    <div style="padding:0 16px 12px;font-size:13px;color:var(--text3)">Set your shipping fee per state. Leave blank or 0 for free shipping.</div>

    <div id="sr-list">

      ${(states||[]).map(s => `

        <div style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border)">

          <span style="flex:1;font-size:14px;color:var(--text)">${s.name}</span>

          <span style="font-size:13px;color:var(--text3);margin-right:4px">₦</span>

          <input type="number" class="ap-input" placeholder="0 = Free" style="width:100px;padding:8px 10px;font-size:13px"

            value="${rateMap[s.name]?.rate_ngn||''}" id="sr-${s.name.replace(/\s/g,'-')}">

        </div>`).join('')}

    </div>

    <div style="padding:20px 16px">

      <button onclick="saveShippingRates()" style="width:100%;height:48px;border-radius:24px;background:var(--accent);color:white;border:none;font-size:15px;font-weight:700;cursor:pointer">Save Shipping Rates</button>

    </div>`;

  document.body.appendChild(overlay);

  window._srStates = (states||[]).map(s => s.name);

}

async function saveShippingRates() {

  if (!currentStorefront || !window._srStates) return;

  showToast('Saving rates…');

  const upserts = window._srStates.map(state => ({

    storefront_id: currentStorefront.id, state,

    rate_ngn: parseFloat(document.getElementById('sr-'+state.replace(/\s/g,'-'))?.value||'0')||0,

  }));

  const { error } = await supabase.from('shipping_rates').upsert(upserts, { onConflict: 'storefront_id,state' });

  if (error) { showToast('Failed to save rates'); return; }

  showToast('Shipping rates saved ✓');

  document.getElementById('shipping-rates-overlay')?.remove();

}

// ══════════════════════════════════════════

// MERCHANT ANALYTICS

// ══════════════════════════════════════════

function openMerchantDashboard() { slideTo('merchant-dashboard', loadMerchantDashboard); }

async function loadMerchantDashboard() {

  const el = document.getElementById('merchant-dashboard-content');

  if (!el || !currentStorefront) return;

  el.innerHTML = `<div class="loading-pulse" style="height:300px"></div>`;

  const [ordersRes, productsRes] = await Promise.all([

    supabase.from('orders').select('id,total_ngn,points_amount,status,created_at').eq('storefront_id', currentStorefront.id),

    supabase.from('products').select('id,title,views,sales_count,price_ngn,images').eq('storefront_id', currentStorefront.id).neq('status','archived').order('sales_count', { ascending: false }).limit(5),

  ]);

  const orders   = ordersRes.data   || [];

  const products = productsRes.data || [];

  const revenue  = orders.filter(o => o.status==='delivered').reduce((s,o) => s+o.total_ngn, 0);

  const totalOrders     = orders.length;

  const pendingOrders   = orders.filter(o => o.status==='paid'||o.status==='processing').length;

  const shippedOrders   = orders.filter(o => o.status==='shipped').length;

  const deliveredOrders = orders.filter(o => o.status==='delivered').length;

  const weekAgo    = new Date(Date.now() - 7*86400000);

  const weekOrders = orders.filter(o => new Date(o.created_at) > weekAgo && o.status==='delivered');

  const weekRevenue = weekOrders.reduce((s,o) => s+o.total_ngn, 0);

  el.innerHTML = `

    <div class="dash-body">

      <div class="dash-cards">

        <div class="dash-card" style="background:linear-gradient(135deg,#6C47FF,#a78bfa)">

          <div class="dash-card-label">Total Revenue</div>

          <div class="dash-card-value">${mktFmtNgn(revenue)}</div>

          <div class="dash-card-sub">All time</div>

        </div>

        <div class="dash-card" style="background:linear-gradient(135deg,#00c48c,#34d399)">

          <div class="dash-card-label">This Week</div>

          <div class="dash-card-value">${mktFmtNgn(weekRevenue)}</div>

          <div class="dash-card-sub">${weekOrders.length} orders</div>

        </div>

      </div>

      <div class="dash-order-stats">

        <div class="dash-order-stat"><div class="dash-order-stat-num">${totalOrders}</div><div class="dash-order-stat-label">Total</div></div>

        <div class="dash-order-stat" style="color:#ff9500" onclick="openShopOrders()"><div class="dash-order-stat-num">${pendingOrders}</div><div class="dash-order-stat-label">Pending</div></div>

        <div class="dash-order-stat" style="color:#6C47FF"><div class="dash-order-stat-num">${shippedOrders}</div><div class="dash-order-stat-label">Shipped</div></div>

        <div class="dash-order-stat" style="color:#00c48c"><div class="dash-order-stat-num">${deliveredOrders}</div><div class="dash-order-stat-label">Delivered</div></div>

      </div>

      ${currentStorefront.rating > 0 ? `

      <div class="dash-section">

        <div class="dash-section-title">Store Rating</div>

        <div class="dash-rating">

          <span class="dash-rating-stars">${'★'.repeat(Math.round(currentStorefront.rating))}${'☆'.repeat(5-Math.round(currentStorefront.rating))}</span>

          <span class="dash-rating-val">${currentStorefront.rating} out of 5</span>

          <span class="dash-rating-count">(${currentStorefront.review_count} reviews)</span>

        </div>

      </div>` : ''}

      ${products.length > 0 ? `

      <div class="dash-section">

        <div class="dash-section-title">Top Products</div>

        ${products.map(p => `

          <div class="dash-product-row" onclick="slideTo('add-product',()=>buildAddProductForm('${p.id}'))">

            <div class="dash-product-img-wrap">

              ${p.images?.[0] ? `<img src="${p.images[0]}" class="dash-product-img" alt="">` : `<div class="dash-product-img" style="background:${gradientFor(p.id)}"></div>`}

            </div>

            <div class="dash-product-info">

              <div class="dash-product-title">${escHtml(p.title)}</div>

              <div class="dash-product-price">${mktFmtNgn(p.price_ngn)}</div>

            </div>

            <div class="dash-product-stats">

              <div class="dash-product-stat">${p.views} views</div>

              <div class="dash-product-stat" style="color:#00c48c">${p.sales_count} sold</div>

            </div>

          </div>`).join('')}

      </div>` : ''}

      <div style="height:32px"></div>

    </div>`;

}

// ══════════════════════════════════════════

// DISCOUNT CODES

// ══════════════════════════════════════════

function openDiscountCodes() { slideTo('discount-codes', loadDiscountCodes); }

async function loadDiscountCodes() {

  const el = document.getElementById('discount-codes-content');

  if (!el || !currentStorefront) return;

  el.innerHTML = `<div class="loading-pulse" style="height:300px"></div>`;

  const { data: codes } = await supabase.from('discount_codes').select('*').eq('storefront_id', currentStorefront.id).order('created_at', { ascending: false });

  if (!codes?.length) {

    el.innerHTML = `<div class="empty-state"><div style="font-size:48px;margin-bottom:12px">🏷️</div><p>No discount codes yet</p><span>Create codes to reward your customers</span><button class="btn-primary" style="margin-top:16px" onclick="openCreateDiscountCode()">Create Code</button></div>`;

    return;

  }

  el.innerHTML = `

    <div class="dc-list">

      ${codes.map(code => `

        <div class="dc-code-card ${!code.is_active?'inactive':''}">

          <div class="dc-code-top">

            <div class="dc-code-value">${escHtml(code.code)}</div>

            <div class="dc-code-discount">${code.type==='percentage' ? code.value+'% OFF' : mktFmtNgn(code.value)+' OFF'}</div>

          </div>

          <div class="dc-code-meta">

            <span>${code.uses_count}${code.max_uses?'/'+code.max_uses:''} uses</span>

            ${code.expires_at ? `<span>Expires ${new Date(code.expires_at).toLocaleDateString('en-NG')}</span>` : '<span>No expiry</span>'}

            ${code.min_order_ngn > 0 ? `<span>Min ${mktFmtNgn(code.min_order_ngn)}</span>` : ''}

          </div>

          <div class="dc-code-actions">

            <button class="dc-toggle-btn" onclick="toggleDiscountCode('${code.id}',${code.is_active},this)">${code.is_active?'Deactivate':'Activate'}</button>

            <button class="dc-delete-btn" onclick="deleteDiscountCode('${code.id}')">Delete</button>

          </div>

        </div>`).join('')}

    </div>`;

}

function openCreateDiscountCode() {

  const overlay = document.createElement('div');

  overlay.id    = 'create-dc-overlay';

  overlay.style.cssText = 'position:fixed;inset:0;z-index:900;background:rgba(0,0,0,0.5);display:flex;align-items:flex-end';

  overlay.innerHTML = `

    <div style="background:var(--bg);border-radius:20px 20px 0 0;width:100%;padding:20px 16px calc(var(--safe-bottom)+24px)">

      <div style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:16px">New Discount Code</div>

      <div class="csf-field"><label class="csf-label">Code <span class="csf-required">*</span></label><input class="csf-input" id="dc-code" placeholder="e.g. SAVE20" style="text-transform:uppercase"></div>

      <div style="display:flex;gap:10px">

        <div class="csf-field" style="flex:1"><label class="csf-label">Type</label><select class="csf-select" id="dc-type"><option value="percentage">Percentage %</option><option value="fixed">Fixed ₦</option></select></div>

        <div class="csf-field" style="flex:1"><label class="csf-label">Value <span class="csf-required">*</span></label><input class="csf-input" id="dc-value" type="number" placeholder="20"></div>

      </div>

      <div style="display:flex;gap:10px">

        <div class="csf-field" style="flex:1"><label class="csf-label">Min Order (₦)</label><input class="csf-input" id="dc-min" type="number" placeholder="0"></div>

        <div class="csf-field" style="flex:1"><label class="csf-label">Max Uses</label><input class="csf-input" id="dc-max-uses" type="number" placeholder="Unlimited"></div>

      </div>

      <div class="csf-field"><label class="csf-label">Expiry Date</label><input class="csf-input" id="dc-expiry" type="date"></div>

      <div style="display:flex;gap:10px;margin-top:8px">

        <button onclick="document.getElementById('create-dc-overlay').remove()" style="flex:1;height:46px;border-radius:23px;border:1px solid var(--border);background:none;color:var(--text);font-size:14px;font-weight:600;cursor:pointer">Cancel</button>

        <button onclick="saveDiscountCode()" style="flex:2;height:46px;border-radius:23px;border:none;background:var(--accent);color:white;font-size:14px;font-weight:700;cursor:pointer">Create Code</button>

      </div>

    </div>`;

  overlay.addEventListener('click', e => { if (e.target===overlay) overlay.remove(); });

  document.body.appendChild(overlay);

}

async function saveDiscountCode() {

  const code    = document.getElementById('dc-code')?.value.trim().toUpperCase();

  const type    = document.getElementById('dc-type')?.value;

  const value   = parseFloat(document.getElementById('dc-value')?.value||'0');

  const min     = parseFloat(document.getElementById('dc-min')?.value||'0');

  const maxUses = parseInt(document.getElementById('dc-max-uses')?.value||'0')||null;

  const expiry  = document.getElementById('dc-expiry')?.value;

  if (!code)  { showToast('Enter a discount code'); return; }

  if (!value) { showToast('Enter a discount value'); return; }

  if (type==='percentage' && value>100) { showToast('Percentage cannot exceed 100%'); return; }

  const { error } = await supabase.from('discount_codes').insert({ storefront_id: currentStorefront.id, code, type, value, min_order_ngn: min, max_uses: maxUses, expires_at: expiry||null, is_active: true });

  if (error) { showToast(error.code==='23505' ? 'Code already exists' : 'Failed to create code'); return; }

  showToast('Discount code created ✓');

  document.getElementById('create-dc-overlay')?.remove();

  loadDiscountCodes();

}

async function toggleDiscountCode(id, isActive, btn) {

  await supabase.from('discount_codes').update({ is_active: !isActive }).eq('id', id);

  btn.textContent = isActive ? 'Activate' : 'Deactivate';

  btn.closest('.dc-code-card').classList.toggle('inactive', isActive);

  showToast(isActive ? 'Code deactivated' : 'Code activated');

}

async function deleteDiscountCode(id) {

  showActionSheet([{ label: 'Delete Code', danger: true, action: async () => {

    await supabase.from('discount_codes').delete().eq('id', id);

    showToast('Code deleted'); loadDiscountCodes();

  }}]);

}

// ══════════════════════════════════════════

// REVIEWS

// ══════════════════════════════════════════

async function openLeaveReview(order) {

  if (!order?.items?.length) return;

  const product = order.items[0];

  const overlay = document.createElement('div');

  overlay.id    = 'leave-review-overlay';

  overlay.style.cssText = 'position:fixed;inset:0;z-index:900;background:rgba(0,0,0,0.5);display:flex;align-items:flex-end';

  window._reviewRating  = 5;

  overlay.innerHTML = `

    <div style="background:var(--bg);border-radius:20px 20px 0 0;width:100%;padding:20px 16px calc(var(--safe-bottom)+24px)">

      <div style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:4px">Leave a Review</div>

      <div style="font-size:13px;color:var(--text3);margin-bottom:16px">${escHtml(product.product_title)}</div>

      <div id="review-stars" style="display:flex;gap:8px;font-size:36px;margin-bottom:16px;justify-content:center">

        ${[1,2,3,4,5].map(i => `<span onclick="setReviewRating(${i})" style="cursor:pointer" id="rs-${i}">★</span>`).join('')}

      </div>

      <textarea class="csf-textarea" id="review-text" placeholder="Share your experience…" rows="3" maxlength="500"></textarea>

      <div style="display:flex;gap:10px;margin-top:12px">

        <button onclick="document.getElementById('leave-review-overlay').remove()" style="flex:1;height:46px;border-radius:23px;border:1px solid var(--border);background:none;color:var(--text);font-size:14px;font-weight:600;cursor:pointer">Skip</button>

        <button onclick="submitReview('${order.id}','${product.product_id}','${order.storefront_id}')" style="flex:2;height:46px;border-radius:23px;border:none;background:var(--accent);color:white;font-size:14px;font-weight:700;cursor:pointer">Submit Review</button>

      </div>

    </div>`;

  overlay.addEventListener('click', e => { if (e.target===overlay) overlay.remove(); });

  document.body.appendChild(overlay);

}

function setReviewRating(rating) {

  window._reviewRating = rating;

  [1,2,3,4,5].forEach(i => { const s = document.getElementById(`rs-${i}`); if (s) s.style.opacity = i<=rating ? '1' : '0.3'; });

}

async function submitReview(orderId, productId, storefrontId) {

  const text   = document.getElementById('review-text')?.value.trim();

  const rating = window._reviewRating || 5;

  const { error } = await supabase.from('product_reviews').insert({

    product_id: productId, storefront_id: storefrontId, order_id: orderId,

    reviewer_id: currentUser.id, rating, review: text||null, is_verified_purchase: true,

  });

  if (error && error.code==='23505') { showToast('You already reviewed this product'); document.getElementById('leave-review-overlay')?.remove(); return; }

  if (error) { showToast('Failed to submit review'); return; }

  showToast('Review submitted ✓ Thank you!');

  document.getElementById('leave-review-overlay')?.remove();

}

// ══════════════════════════════════════════

// MARKET PAGE — load real products

// ══════════════════════════════════════════

async function loadMarketProducts(category) {

  const grid = document.getElementById('mkt-product-grid');

  if (!grid) return;

  let query = supabase.from('products')

    .select('*, storefront:storefronts(id,store_name,logo_url,rating)')

    .eq('status','active').gt('stock',0)

    .order('created_at', { ascending: false }).limit(40);

  if (category && category !== 'all') query = query.eq('category', category);

  const { data: products } = await query;

  if (!products?.length) return;

  grid.innerHTML = products.map(p => renderProductCard(p, p.storefront)).join('');

}

function openMktSearch() { showToast('Search coming soon ✨'); }

// ══════════════════════════════════════════

// STOREFRONT SUBSCRIPTION RENEWAL

// ══════════════════════════════════════════

async function renewStorefrontSubscription() {

  if (!currentStorefront) return;

  if (walletState.points < 1) { showToast('You need at least MP 1 to renew'); openWallet(); return; }

  showActionSheet([{ label: 'Renew — MP 1', action: async () => {

    const pinOk = await walletPinCheck();

    if (!pinOk) return;

    const expiry = new Date(currentStorefront.subscription_expires_at||new Date());

    expiry.setMonth(expiry.getMonth()+1);

    await supabase.from('storefronts').update({ subscription_expires_at: expiry.toISOString(), is_active: true }).eq('id', currentStorefront.id);

    currentStorefront.subscription_expires_at = expiry.toISOString();

    showToast('Subscription renewed ✓');

    syncWalletBalance();

  }}]);

}

async function openEditStorefront() { showToast('Edit storefront — coming soon ✨'); }

async function updateStorefrontLogo(input) {

  const file = input.files?.[0];

  if (!file || !currentStorefront) return;

  showToast('Uploading logo…');

  try {

    const path = `storefronts/${currentUser.id}/logo.jpg`;

    const compressed = await compressImage(file, 400);

    await supabase.storage.from('avatars').upload(path, compressed, { upsert: true, contentType: 'image/jpeg' });

    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);

    const logoUrl = urlData.publicUrl + '?t=' + Date.now();

    await supabase.from('storefronts').update({ logo_url: logoUrl }).eq('id', currentStorefront.id);

    currentStorefront.logo_url = logoUrl;

    showToast('Logo updated ✓'); renderMyStorefront();

  } catch(e) { showToast('Upload failed'); }

}

async function updateStorefrontBanner(input) {

  const file = input.files?.[0];

  if (!file || !currentStorefront) return;

  showToast('Uploading banner…');

  try {

    const path = `storefronts/${currentUser.id}/banner.jpg`;

    const compressed = await compressImage(file, 1200);

    await supabase.storage.from('avatars').upload(path, compressed, { upsert: true, contentType: 'image/jpeg' });

    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);

    const bannerUrl = urlData.publicUrl + '?t=' + Date.now();

    await supabase.from('storefronts').update({ banner_url: bannerUrl }).eq('id', currentStorefront.id);

    currentStorefront.banner_url = bannerUrl;

    showToast('Banner updated ✓'); renderMyStorefront();

  } catch(e) { showToast('Upload failed'); }

}

// ══════════════════════════════════════════

// ORDER DETAIL

// ══════════════════════════════════════════

async function openOrderDetail(orderId, role) {

  const { data: order } = await supabase.from('orders')

    .select('*, storefront:storefronts(store_name,logo_url), buyer:users(username,avatar), items:order_items(*, product:products(title,images))')

    .eq('id', orderId).single();

  if (!order) { showToast('Order not found'); return; }

  const overlay = document.createElement('div');

  overlay.id    = 'order-detail-overlay';

  overlay.style.cssText = 'position:fixed;inset:0;z-index:900;background:var(--bg);overflow-y:auto;padding:0 0 80px';

  const statusColors = { paid:'#007aff', processing:'#007aff', shipped:'#6C47FF', delivered:'#00c48c', cancelled:'var(--text3)' };

  const statusCol = statusColors[order.status] || 'var(--text3)';

  overlay.innerHTML = `

    <div style="padding:calc(var(--safe-top)+16px) 16px 0;display:flex;align-items:center;gap:12px;margin-bottom:20px">

      <button onclick="document.getElementById('order-detail-overlay').remove()" style="background:none;border:none;cursor:pointer">

        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>

      </button>

      <h2 style="font-size:17px;font-weight:700;color:var(--text);margin:0">${order.order_number}</h2>

      <span style="margin-left:auto;font-size:13px;font-weight:700;color:${statusCol}">${order.status.replace('_',' ')}</span>

    </div>

    <div style="padding:0 16px">

      <div style="display:flex;align-items:center;gap:10px;padding:12px 0;border-bottom:1px solid var(--border)">

        <img style="width:40px;height:40px;border-radius:${role==='buyer'?'10px':'50%'};object-fit:cover;background:var(--bg2)"

          src="${role==='buyer' ? order.storefront?.logo_url||'' : order.buyer?.avatar||''}" alt="">

        <div>

          <div style="font-size:14px;font-weight:600;color:var(--text)">${role==='buyer' ? escHtml(order.storefront?.store_name||'') : '@'+escHtml(order.buyer?.username||'')}</div>

          <div style="font-size:12px;color:var(--text3)">${timeSince(order.created_at)}</div>

        </div>

      </div>

      <div style="padding:16px 0;border-bottom:1px solid var(--border)">

        <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px">Items</div>

        ${(order.items||[]).map(item => `

          <div style="display:flex;gap:10px;margin-bottom:10px;align-items:center">

            ${item.product?.images?.[0] ? `<img src="${item.product.images[0]}" style="width:52px;height:52px;border-radius:10px;object-fit:cover" alt="">` : `<div style="width:52px;height:52px;border-radius:10px;background:${gradientFor(item.product_id)}"></div>`}

            <div style="flex:1"><div style="font-size:13px;font-weight:500;color:var(--text)">${escHtml(item.product_title)}</div><div style="font-size:12px;color:var(--text3)">Qty: ${item.quantity}</div></div>

            <div style="font-size:13px;font-weight:600;color:var(--text)">${mktFmtNgn(item.price_ngn*item.quantity)}</div>

          </div>`).join('')}

      </div>

      <div style="padding:16px 0;border-bottom:1px solid var(--border)">

        <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px">Delivery</div>

        <div style="font-size:13px;color:var(--text2);line-height:1.8">

          <div>${escHtml(order.shipping_name||'')}</div><div>${escHtml(order.shipping_phone||'')}</div>

          <div>${escHtml(order.shipping_address||'')}</div><div>${escHtml(order.shipping_state||'')}</div>

        </div>

      </div>

      <div style="padding:16px 0;border-bottom:1px solid var(--border)">

        <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px">Payment</div>

        <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text2);margin-bottom:6px"><span>Subtotal</span><span>${mktFmtNgn(order.subtotal_ngn)}</span></div>

        <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text2);margin-bottom:6px"><span>Shipping</span><span>${mktFmtNgn(order.shipping_ngn)}</span></div>

        ${order.discount_ngn>0 ? `<div style="display:flex;justify-content:space-between;font-size:13px;color:var(--red);margin-bottom:6px"><span>Discount</span><span>-${mktFmtNgn(order.discount_ngn)}</span></div>` : ''}

        <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:700;color:var(--text);margin-top:6px"><span>Total</span><span>${mktFmtNgn(order.total_ngn)}</span></div>

        <div style="font-size:12px;color:var(--text3);margin-top:4px">Paid with ${fmtPts(order.points_amount)}</div>

      </div>

      ${order.shipping_proof_url ? `

      <div style="padding:16px 0">

        <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px">Shipping Proof</div>

        <img src="${order.shipping_proof_url}" style="width:100%;border-radius:12px;object-fit:cover" alt="">

        ${order.auto_release_at ? `<div style="font-size:12px;color:var(--text3);margin-top:6px">MP auto-releases in 7 days if delivery not confirmed</div>` : ''}

      </div>` : ''}

      ${role==='buyer' && order.status==='shipped' ? `

      <button onclick="confirmDelivery('${order.id}');document.getElementById('order-detail-overlay').remove()"

        style="width:100%;height:48px;border-radius:24px;background:#00c48c;color:white;border:none;font-size:15px;font-weight:700;cursor:pointer;margin-top:8px">

        Confirm Delivery

      </button>` : ''}

      ${role==='seller' && (order.status==='paid'||order.status==='processing') ? `

      <button onclick="openShipOrder('${order.id}');document.getElementById('order-detail-overlay').remove()"

        style="width:100%;height:48px;border-radius:24px;background:var(--accent);color:white;border:none;font-size:15px;font-weight:700;cursor:pointer;margin-top:8px">

        Upload Shipping Proof

      </button>` : ''}

    </div>`;

  document.body.appendChild(overlay);

}