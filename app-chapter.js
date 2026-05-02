/* ═══════════════════════════════════════════
   MISTYNOTE — app-chapters.js
   "Note" structured post feature — Phase 1
   Composer Note mode, feed chapter indicator,
   detail reading view with progress bar.
   Requires: app-core.js, app-social.js
   ═══════════════════════════════════════════ */

'use strict';

// ═══════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════

const ChapterComposer = {
  active:    false,       // is Note mode on?
  chapters:  [],          // [{ title, content, image, file, preview }]
  busy:      false,
};

// ═══════════════════════════════════════════
// INJECT NOTE BUTTON INTO COMPOSER
// Called once when composer opens
// ═══════════════════════════════════════════

function chaptersWireComposer() {
  const tools = document.querySelector('.mnc-tools');
  if (!tools || document.getElementById('mnc-note-btn')) return;

  const btn = document.createElement('button');
  btn.className   = 'mnc-tool mnc-note-btn';
  btn.id          = 'mnc-note-btn';
  btn.setAttribute('aria-label', 'Note — structured post');
  btn.setAttribute('title', 'Note');
  btn.innerHTML   = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
      <polyline points="10 9 9 9 8 9"/>
    </svg>`;

  btn.addEventListener('click', () => {
    if (ChapterComposer.active) {
      _chapExitNoteMode();
    } else {
      _chapEnterNoteMode();
    }
  });

  tools.appendChild(btn);
}

// ═══════════════════════════════════════════
// ENTER NOTE MODE
// ═══════════════════════════════════════════

function _chapEnterNoteMode() {
  ChapterComposer.active = true;

  // Seed first chapter with whatever text is already typed
  const existingText = document.getElementById('mnc-textarea')?.value?.trim() || '';
  ChapterComposer.chapters = [
    { title: '', content: existingText, image: null, file: null, preview: null }
  ];

  _chapRenderNoteMode();
  _chapHighlightNoteBtn(true);
}

function _chapExitNoteMode() {
  ChapterComposer.active   = false;
  ChapterComposer.chapters = [];

  // Restore normal composer body
  const body = document.getElementById('mnc-body');
  if (body) {
    body.innerHTML = `
      <textarea
        class="mnc-textarea"
        id="mnc-textarea"
        placeholder="What's happening?"
        autocomplete="off"
        autocorrect="on"
        spellcheck="true"
      ></textarea>
      <div class="mnc-media-wrap" id="mnc-media-wrap" style="display:none">
        <img  id="mnc-img"  class="mnc-preview-img" style="display:none" alt="">
        <video id="mnc-vid" class="mnc-preview-vid" controls playsinline style="display:none"></video>
        <button class="mnc-remove-media" id="mnc-remove-media" aria-label="Remove">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>`;
    const ta = body.querySelector('#mnc-textarea');
    if (ta) {
      ta.addEventListener('input', () => {
        _cAutoGrow(ta);
        _cUpdateRing(ta.value.length);
        _cSync();
      });
      ta.focus();
    }
  }

  _chapHighlightNoteBtn(false);
  _cSync();
}

// ═══════════════════════════════════════════
// RENDER NOTE MODE BODY
// ═══════════════════════════════════════════

function _chapRenderNoteMode() {
  const body = document.getElementById('mnc-body');
  if (!body) return;

  body.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'chp-composer-wrap';
  wrap.id        = 'chp-composer-wrap';

  ChapterComposer.chapters.forEach((ch, i) => {
    wrap.appendChild(_chapBuildChapterBlock(ch, i));
  });

  // Add chapter button
  const addBtn = document.createElement('button');
  addBtn.className   = 'chp-add-btn';
  addBtn.id          = 'chp-add-btn';
  addBtn.innerHTML   = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
      <line x1="12" y1="5" x2="12" y2="19"/>
      <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
    Add chapter`;
  addBtn.addEventListener('click', () => {
    ChapterComposer.chapters.push({ title: '', content: '', image: null, file: null, preview: null });
    _chapRenderNoteMode();
    // Focus new chapter
    const blocks = document.querySelectorAll('.chp-content-ta');
    const last   = blocks[blocks.length - 1];
    if (last) { last.focus(); last.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    _chapSyncPostBtn();
  });

  wrap.appendChild(addBtn);
  body.appendChild(wrap);

  // Focus first textarea if empty
  const firstTa = wrap.querySelector('.chp-content-ta');
  if (firstTa && !ChapterComposer.chapters[0].content) firstTa.focus();

  _chapSyncPostBtn();
}

function _chapBuildChapterBlock(ch, idx) {
  const block = document.createElement('div');
  block.className      = 'chp-block';
  block.dataset.chpIdx = String(idx);

  const num = idx + 1;
  const canDelete = ChapterComposer.chapters.length > 1;

  block.innerHTML = `
    <div class="chp-block-header">
      <span class="chp-block-num">Chapter ${num}</span>
      ${canDelete ? `<button class="chp-delete-btn" data-idx="${idx}" aria-label="Remove chapter">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>` : ''}
    </div>
    <input
      class="chp-title-input"
      data-idx="${idx}"
      placeholder="Chapter title (optional)"
      value="${escHtml(ch.title || '')}"
      maxlength="80"
    >
    <textarea
      class="chp-content-ta"
      data-idx="${idx}"
      placeholder="${idx === 0 ? "Start writing…" : "Continue your story…"}"
      rows="3"
      autocorrect="on"
      spellcheck="true"
    >${escHtml(ch.content || '')}</textarea>
    <div class="chp-media-row">
      ${ch.preview
        ? `<div class="chp-preview-wrap">
             <img class="chp-preview-img" src="${ch.preview}" alt="">
             <button class="chp-remove-img" data-idx="${idx}" aria-label="Remove image">
               <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
                 <path d="M18 6L6 18M6 6l12 12"/>
               </svg>
             </button>
           </div>`
        : `<button class="chp-img-btn" data-idx="${idx}" aria-label="Add image to chapter">
             <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="1.9" stroke-linecap="round">
               <rect x="3" y="3" width="18" height="18" rx="3"/>
               <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none"/>
               <path d="M21 15l-5-5L5 21"/>
             </svg>
             Add image
           </button>`}
    </div>`;

  // Wire events
  const titleInput  = block.querySelector('.chp-title-input');
  const contentArea = block.querySelector('.chp-content-ta');
  const deleteBtn   = block.querySelector('.chp-delete-btn');
  const imgBtn      = block.querySelector('.chp-img-btn');
  const removeImg   = block.querySelector('.chp-remove-img');

  if (titleInput) {
    titleInput.addEventListener('input', e => {
      ChapterComposer.chapters[idx].title = e.target.value;
      _chapSyncPostBtn();
    });
  }

  if (contentArea) {
    _chapAutoGrow(contentArea);
    contentArea.addEventListener('input', e => {
      ChapterComposer.chapters[idx].content = e.target.value;
      _chapAutoGrow(contentArea);
      _chapSyncPostBtn();
    });
  }

  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      ChapterComposer.chapters.splice(idx, 1);
      _chapRenumberChapters();
      _chapRenderNoteMode();
    });
  }

  if (imgBtn) {
    imgBtn.addEventListener('click', () => _chapPickImage(idx));
  }

  if (removeImg) {
    removeImg.addEventListener('click', () => {
      ChapterComposer.chapters[idx].image   = null;
      ChapterComposer.chapters[idx].file    = null;
      ChapterComposer.chapters[idx].preview = null;
      _chapRenderNoteMode();
    });
  }

  return block;
}

function _chapAutoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.max(80, ta.scrollHeight) + 'px';
}

function _chapRenumberChapters() {
  // chapters array order IS the number — no extra field needed
}

function _chapHighlightNoteBtn(on) {
  const btn = document.getElementById('mnc-note-btn');
  if (btn) btn.classList.toggle('mnc-note-btn-active', on);
}

function _chapSyncPostBtn() {
  const btn = document.getElementById('mnc-post-btn');
  if (!btn) return;
  const hasContent = ChapterComposer.chapters.some(
    ch => (ch.content || '').trim().length > 0 || ch.image
  );
  btn.disabled = !hasContent;
  if (hasContent) btn.classList.add('mnc-post-ready');
  else btn.classList.remove('mnc-post-ready');
}

// ═══════════════════════════════════════════
// IMAGE PICKER PER CHAPTER
// ═══════════════════════════════════════════

function _chapPickImage(idx) {
  const old = document.getElementById('chp-file-input');
  if (old) old.remove();

  const inp  = document.createElement('input');
  inp.id     = 'chp-file-input';
  inp.type   = 'file';
  inp.accept = 'image/*';
  Object.assign(inp.style, {
    position: 'fixed', top: '0', left: '0',
    width: '1px', height: '1px',
    opacity: '0', pointerEvents: 'none', zIndex: '-1',
  });
  document.body.appendChild(inp);

  inp.addEventListener('change', async () => {
    const file = inp.files[0];
    inp.remove();
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 20 * 1024 * 1024) { showToast('Max 20MB per image'); return; }

    const preview = URL.createObjectURL(file);
    ChapterComposer.chapters[idx].file    = file;
    ChapterComposer.chapters[idx].preview = preview;
    _chapRenderNoteMode();
  });

  setTimeout(() => inp.click(), 10);
}

// ═══════════════════════════════════════════
// SUBMIT NOTE POST
// Hooked into _cSubmit — intercepts when Note mode is active
// ═══════════════════════════════════════════

async function chaptersSubmit() {
  if (!currentUser || ChapterComposer.busy) return;

  const chapters = ChapterComposer.chapters.filter(
    ch => (ch.content || '').trim() || ch.image
  );
  if (!chapters.length) { showToast('Write at least one chapter'); return; }

  ChapterComposer.busy = true;
  const btn = document.getElementById('mnc-post-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="mnc-spinner"></span>'; }

  try {
    // 1. Insert parent post row (no content — chapters hold the content)
    const { data: post, error: postErr } = await supabase
      .from('posts')
      .insert({
        user_id:      currentUser.id,
        content:      chapters[0].content?.slice(0, 280) || null, // first chapter preview
        has_chapters: true,
      })
      .select('id, content, created_at, like_count, repost_count, views, user_id, has_chapters, user:users(id,username,avatar,location)')
      .single();

    if (postErr) throw new Error('Post failed: ' + postErr.message);

    // 2. Upload images + insert chapters
    for (let i = 0; i < chapters.length; i++) {
      const ch      = chapters[i];
      let   imgUrl  = null;

      if (ch.file) {
        const path = `${currentUser.id}/chp_${post.id}_${i}_${Date.now()}.jpg`;
        const blob = await _chapCompressImage(ch.file);
        const { error: upErr } = await supabase.storage
          .from('avatars')
          .upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' });
        if (upErr) throw new Error('Image upload failed: ' + upErr.message);
        const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
        imgUrl = urlData.publicUrl;
      }

      const { error: chErr } = await supabase.from('post_chapters').insert({
        post_id:        post.id,
        chapter_number: i + 1,
        title:          ch.title?.trim() || null,
        content:        ch.content?.trim() || null,
        image:          imgUrl,
      });

      if (chErr) throw new Error('Chapter ' + (i + 1) + ' failed: ' + chErr.message);
    }

    // 3. Success
    if (btn) {
      btn.innerHTML    = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
      btn.style.background = '#00b87a';
    }

    // Attach chapter count for feed card
    post.chapter_count = chapters.length;

    setTimeout(() => {
      closeComposer();
      prependPostToFeed(post);
      showToast('Note posted ✓');
    }, 380);

  } catch (err) {
    console.error('[Chapters] submit error:', err);
    showToast('Failed: ' + (err?.message || 'unknown error'), 4000);
    if (btn) { btn.disabled = false; btn.textContent = 'Post'; btn.classList.add('mnc-post-ready'); }
  } finally {
    ChapterComposer.busy = false;
  }
}

async function _chapCompressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxPx = 1200;
      const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth  * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
    img.src = url;
  });
}

// ═══════════════════════════════════════════
// FEED CARD — chapter indicator
// Injected into createFeedPost output
// ═══════════════════════════════════════════

function chaptersGetFeedIndicator(post) {
  if (!post.has_chapters) return '';
  const count    = post.chapter_count || post.chapters_count || '';
  const countStr = count ? `${count} chapter${count !== 1 ? 's' : ''}` : 'Note';
  // Estimate read time: avg 200 wpm, rough from content length
  const words    = (post.content || '').split(/\s+/).length;
  const mins     = Math.max(1, Math.round((words * (count || 1)) / 200));
  return `
    <div class="chp-feed-indicator">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
      </svg>
      <span>${countStr} · ${mins} min read</span>
    </div>`;
}

// ═══════════════════════════════════════════
// DETAIL VIEW — render chapters
// Called from openDetail when has_chapters = true
// ═══════════════════════════════════════════

async function chaptersRenderDetail(postId, containerEl, pageEl) {
  const { data: chapters, error } = await supabase
    .from('post_chapters')
    .select('id, chapter_number, title, content, image, like_count')
    .eq('post_id', postId)
    .order('chapter_number', { ascending: true });

  if (error || !chapters?.length) return;

  // ── Progress bar ──
  const progressBar = document.createElement('div');
  progressBar.className = 'chp-progress-bar';
  progressBar.id        = 'chp-progress-bar';
  progressBar.innerHTML = '<div class="chp-progress-fill" id="chp-progress-fill"></div>';

  const detailHeader = document.getElementById('page-detail')?.querySelector('header');
  if (detailHeader && !document.getElementById('chp-progress-bar')) {
    detailHeader.appendChild(progressBar);
  }

  // Wire progress to scroll
  const fill = progressBar.querySelector('.chp-progress-fill');
  if (pageEl && fill) {
    const onScroll = () => {
      const pct = pageEl.scrollTop / (pageEl.scrollHeight - pageEl.clientHeight);
      fill.style.width = Math.min(100, Math.round(pct * 100)) + '%';
    };
    pageEl.addEventListener('scroll', onScroll, { passive: true });
    // Clean up when leaving detail
    pageEl._chapScrollClean = () => pageEl.removeEventListener('scroll', onScroll);
  }

  // ── Chapter sections ──
  const wrapper = document.createElement('div');
  wrapper.className = 'chp-detail-wrap';

  // "Note" header label
  const noteLabel = document.createElement('div');
  noteLabel.className = 'chp-detail-note-label';
  noteLabel.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
    </svg>
    Note · ${chapters.length} chapter${chapters.length !== 1 ? 's' : ''}`;
  wrapper.appendChild(noteLabel);

  chapters.forEach((ch, i) => {
    const section = document.createElement('div');
    section.className = 'chp-detail-section';
    section.id        = `chp-section-${ch.chapter_number}`;

    section.innerHTML = `
      <div class="chp-detail-divider">
        <div class="chp-detail-divider-line"></div>
        <span class="chp-detail-divider-label">
          Chapter ${ch.chapter_number}${ch.title ? ` · ${escHtml(ch.title)}` : ''}
        </span>
        <div class="chp-detail-divider-line"></div>
      </div>
      ${ch.title ? `<h2 class="chp-detail-title">${escHtml(ch.title)}</h2>` : ''}
      ${ch.content ? `<div class="chp-detail-text">${linkifyText(ch.content)}</div>` : ''}
      ${ch.image   ? `<div class="chp-detail-img-wrap"><img class="chp-detail-img" src="${escHtml(ch.image)}" alt="" loading="lazy"></div>` : ''}
    `;

    wrapper.appendChild(section);
  });

  containerEl.appendChild(wrapper);
}

// ── Clean up progress bar when leaving detail ──
function chaptersDetailCleanup() {
  const bar = document.getElementById('chp-progress-bar');
  if (bar) bar.remove();
  const page = document.getElementById('page-detail');
  if (page?._chapScrollClean) {
    page._chapScrollClean();
    delete page._chapScrollClean;
  }
}

// ═══════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════

function chaptersInjectStyles() {
  if (document.getElementById('chp-styles')) return;
  const s = document.createElement('style');
  s.id = 'chp-styles';
  s.textContent = `

  /* ── Note button active state ── */
  .mnc-note-btn-active {
    background: rgba(108,71,255,0.12) !important;
    color: #6C47FF !important;
  }

  /* ── Chapter composer wrap ── */
  .chp-composer-wrap {
    padding: 0 0 12px;
    overflow-y: auto;
    max-height: 55vh;
    -webkit-overflow-scrolling: touch;
  }

  /* ── Chapter block ── */
  .chp-block {
    border-bottom: 1px solid var(--border);
    padding: 14px 16px 12px;
  }
  .chp-block:last-of-type { border-bottom: none; }

  .chp-block-header {
    display: flex; align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .chp-block-num {
    font-size: 11px; font-weight: 700;
    letter-spacing: .07em; text-transform: uppercase;
    color: #6C47FF;
  }
  .chp-delete-btn {
    width: 28px; height: 28px; border-radius: 50%;
    background: transparent; border: none;
    color: var(--text3); display: flex;
    align-items: center; justify-content: center;
    cursor: pointer; transition: all .15s;
    -webkit-tap-highlight-color: transparent;
  }
  .chp-delete-btn:active { background: var(--bg3); color: rgb(244,7,82); }

  .chp-title-input {
    width: 100%; background: transparent; border: none;
    font-size: 15px; font-weight: 700; color: var(--text);
    font-family: var(--font); padding: 0 0 6px;
    outline: none; border-bottom: 1px solid var(--border);
    margin-bottom: 8px;
  }
  .chp-title-input::placeholder { color: var(--text3); font-weight: 400; }

  .chp-content-ta {
    width: 100%; background: transparent; border: none;
    font-size: 15px; color: var(--text); line-height: 1.55;
    font-family: var(--font); resize: none; outline: none;
    min-height: 80px; padding: 0;
  }
  .chp-content-ta::placeholder { color: var(--text3); }

  /* ── Per-chapter image ── */
  .chp-media-row { margin-top: 10px; }
  .chp-img-btn {
    display: inline-flex; align-items: center; gap: 6px;
    background: var(--bg2); border: 1.5px dashed var(--border);
    border-radius: 10px; padding: 7px 12px;
    font-size: 12px; color: var(--text2); cursor: pointer;
    font-family: var(--font); transition: all .15s;
    -webkit-tap-highlight-color: transparent;
  }
  .chp-img-btn:active { background: var(--bg3); }

  .chp-preview-wrap { position: relative; display: inline-block; }
  .chp-preview-img {
    max-width: 100%; max-height: 180px; border-radius: 10px;
    object-fit: cover; display: block;
  }
  .chp-remove-img {
    position: absolute; top: 6px; right: 6px;
    width: 22px; height: 22px; border-radius: 50%;
    background: rgba(0,0,0,0.6); border: none; color: #fff;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
  }

  /* ── Add chapter button ── */
  .chp-add-btn {
    display: flex; align-items: center; gap: 8px;
    width: calc(100% - 32px); margin: 8px 16px 4px;
    background: transparent; border: 1.5px dashed var(--border);
    border-radius: 12px; padding: 11px 16px;
    font-size: 14px; font-weight: 600; color: #6C47FF;
    cursor: pointer; font-family: var(--font);
    transition: all .15s; -webkit-tap-highlight-color: transparent;
  }
  .chp-add-btn:active { background: rgba(108,71,255,0.06); transform: scale(.98); }

  /* ── Feed card indicator ── */
  .chp-feed-indicator {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 12px; color: var(--text3); font-weight: 500;
    margin-top: 6px; padding: 4px 0;
  }
  .chp-feed-indicator svg { flex-shrink: 0; color: #6C47FF; opacity: .8; }
  .chp-feed-indicator span { color: var(--text2); }

  /* ── Detail reading view ── */
  .chp-progress-bar {
    position: absolute; bottom: 0; left: 0; right: 0;
    height: 2.5px; background: var(--border);
    overflow: hidden; z-index: 10;
  }
  .chp-progress-fill {
    height: 100%; width: 0%;
    background: linear-gradient(90deg, #6C47FF, #a855f7);
    transition: width .1s linear;
    border-radius: 0 2px 2px 0;
  }

  .chp-detail-wrap { padding: 0 16px 24px; }

  .chp-detail-note-label {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 11px; font-weight: 700; letter-spacing: .07em;
    text-transform: uppercase; color: #6C47FF;
    padding: 12px 0 16px;
  }

  .chp-detail-section { margin-bottom: 32px; }

  .chp-detail-divider {
    display: flex; align-items: center; gap: 10px;
    margin-bottom: 16px;
  }
  .chp-detail-divider-line {
    flex: 1; height: 1px; background: var(--border);
  }
  .chp-detail-divider-label {
    font-size: 11px; font-weight: 700; color: var(--text3);
    letter-spacing: .05em; white-space: nowrap;
    text-transform: uppercase;
  }

  .chp-detail-title {
    font-size: 20px; font-weight: 800; color: var(--text);
    line-height: 1.3; margin: 0 0 12px; letter-spacing: -.2px;
  }
  .chp-detail-text {
    font-size: 15px; color: var(--text); line-height: 1.65;
    white-space: pre-wrap; word-break: break-word;
  }
  .chp-detail-img-wrap { margin-top: 14px; }
  .chp-detail-img {
    width: 100%; border-radius: 14px;
    object-fit: cover; display: block;
    max-height: 420px;
  }
  `;
  document.head.appendChild(s);
}

// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════

function initChapters() {
  chaptersInjectStyles();
}
