
// ── Rebuild chat composer to Snap-style bar (MP · input · voice · emoji · gallery) ──
function rebuildChatComposer(force) {
  const bar = document.getElementById('chat-input-bar');
  if (!bar) return;
  // Bump version so deploy always rewires the live DOM (fixes stuck gallery mode)
  if (!force && bar.dataset.composerV4 === '1') {
    // still re-sync send state
    if (typeof syncChatActionBtn === 'function') syncChatActionBtn();
    return;
  }
  bar.dataset.composerV4 = '1';
  delete bar.dataset.composerV3;

  const tray = document.getElementById('chat-extras-tray');
  if (tray) tray.style.display = 'none';

  let row = bar.querySelector('.chat-input-bar-row');
  if (!row) {
    row = document.createElement('div');
    row.className = 'chat-input-bar-row';
    bar.appendChild(row);
  }

  row.innerHTML = [
    '<button type="button" class="chat-mp-fab" id="chat-mp-fab" aria-label="Send MP">',
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">',
    '<path d="M12 2v20M7 7h7.5a3.5 3.5 0 010 7H9a3.5 3.5 0 000 7h8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
    '</svg></button>',
    '<div class="chat-input-wrap" id="chat-input-wrap">',
    '<textarea id="chat-input-field" class="chat-input-field" placeholder="Send a chat" rows="1"></textarea>',
    '<button type="button" class="chat-voice-btn" id="chat-voice-btn" aria-label="Voice note">',
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">',
    '<rect x="4" y="8" width="2.2" height="8" rx="1.1" fill="currentColor"/>',
    '<rect x="8.5" y="5" width="2.2" height="14" rx="1.1" fill="currentColor"/>',
    '<rect x="13" y="7" width="2.2" height="10" rx="1.1" fill="currentColor"/>',
    '<rect x="17.5" y="9" width="2.2" height="6" rx="1.1" fill="currentColor"/>',
    '</svg></button></div>',
    '<button type="button" class="chat-side-btn" id="dm-emoji-btn" aria-label="Emoji">',
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">',
    '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/>',
    '</svg></button>',
    '<button type="button" class="chat-side-btn chat-action-btn" id="chat-action-btn" data-mode="gallery" aria-label="Gallery">',
    '<span class="chat-action-icon chat-action-gallery" aria-hidden="true">',
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">',
    '<rect x="3" y="5" width="14" height="14" rx="2"/><path d="M7 19h12a2 2 0 002-2V7"/>',
    '<circle cx="9" cy="10" r="1.5" fill="currentColor" stroke="none"/><path d="M7 15l3-3 2 2 3-4 3 5"/>',
    '</svg></span>',
    '<span class="chat-action-icon chat-action-send" aria-hidden="true">',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    '</span></button>',
    '<input type="file" id="chat-media-input" accept="image/*,video/*" style="display:none">'
  ].join('');

  // Wire events in JS (reliable; no stale inline handlers)
  const field = document.getElementById('chat-input-field');
  const actionBtn = document.getElementById('chat-action-btn');
  const mediaInput = document.getElementById('chat-media-input');
  const emojiBtn = document.getElementById('dm-emoji-btn');
  const voiceBtn = document.getElementById('chat-voice-btn');
  const mpBtn = document.getElementById('chat-mp-fab');

  if (field) {
    field._typingWired = false;
    field.addEventListener('input', function() {
      if (typeof chatInputResize === 'function') chatInputResize(field);
      syncChatActionBtn();
    });
    field.addEventListener('keydown', function(e) {
      if (typeof chatInputKeydown === 'function') chatInputKeydown(e);
    });
    if (typeof wireChatTyping === 'function') wireChatTyping();
  }

  if (actionBtn) {
    actionBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      chatActionBtnTap();
    });
  }
  if (mediaInput) {
    mediaInput.addEventListener('change', function() {
      if (typeof chatImageSelected === 'function') chatImageSelected(mediaInput);
    });
  }
  if (emojiBtn) {
    emojiBtn.addEventListener('click', function(e) {
      e.preventDefault();
      openStickerPicker('dm');
    });
  }
  if (voiceBtn) {
    voiceBtn.addEventListener('click', function(e) {
      e.preventDefault();
      if (typeof chatRecordVoice === 'function') chatRecordVoice();
    });
  }
  if (mpBtn) {
    mpBtn.addEventListener('click', function(e) {
      e.preventDefault();
      if (typeof chatSendMP === 'function') chatSendMP();
    });
  }

  syncChatActionBtn();
}

function chatActionBtnTap() {
  try {
    const field = document.getElementById('chat-input-field');
    const hasText = !!(field && String(field.value || '').trim());
    const hasMedia = !!(typeof chatPendingImage !== 'undefined' && chatPendingImage);
    if (hasText || hasMedia) {
      syncChatActionBtn();
      chatSend();
      return;
    }
    const btn = document.getElementById('chat-action-btn');
    if (btn && btn.dataset.mode === 'send') {
      chatSend();
      return;
    }
    const input = document.getElementById('chat-media-input');
    if (input) input.click();
  } catch (err) {
    console.error('[chatActionBtnTap]', err);
    if (typeof showToast === 'function') showToast('Send failed — try again');
  }
}

/** Gallery ↔ Send: text or pending image → send mode; else gallery */
function syncChatActionBtn() {
  const input = document.getElementById('chat-input-field');
  const btn = document.getElementById('chat-action-btn');
  if (!btn) return;
  const hasText = !!(input && String(input.value || '').trim());
  const hasMedia = !!(typeof chatPendingImage !== 'undefined' && chatPendingImage);
  const sendMode = hasText || hasMedia;
  btn.dataset.mode = sendMode ? 'send' : 'gallery';
  btn.classList.toggle('is-send', sendMode);
  btn.setAttribute('aria-label', sendMode ? 'Send' : 'Gallery');
}
function syncChatSendBtn() { syncChatActionBtn(); }


/* ═══════════════════════════════════════════
   MISTYNOTE — app-dm.js
   Messaging, conversations, typing indicators,
   online status, DM gift modal (Send MP)
   Requires: app-core.js, app-wallet.js
═══════════════════════════════════════════ */
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
let chatPendingImage   = null;  // { file, dataUrl } — MUST exist before chatSend
let chatReplyTo        = null;  // { id, senderName, content, mediaUrl }
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
async function getOrCreateConversation(otherUserId) {
  return msgGetOrCreateConversation(otherUserId);
}
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
// ── Update the DM notification dot on the feed header ──
function updateDmDot(totalUnread) {
  const dot = document.getElementById('dm-dot');
  if (!dot) return;
  if (totalUnread > 0) {
    dot.style.display = 'flex';
    dot.textContent   = totalUnread > 9 ? '9+' : String(totalUnread);
  } else {
    dot.style.display = 'none';
    dot.textContent   = '';
  }
}

// ── Check unread DMs on startup — runs as soon as user is authenticated ──
// This mirrors how app-notif.js shows its badge immediately on load,
// without requiring the user to open the inbox first.
async function checkUnreadDmsOnStartup() {
  if (!currentUser) return;
  try {
    // Get conversation IDs I'm in
    const { data: myParts } = await supabase
      .from('conversation_participants')
      .select('conversation_id, last_read_at')
      .eq('user_id', currentUser.id);
    if (!myParts?.length) return;

    const convIds = myParts.map(r => r.conversation_id);
    const readMap = {};
    myParts.forEach(r => { readMap[r.conversation_id] = r.last_read_at; });

    // Count messages sent by others after my last_read_at
    const { data: unreadMsgs } = await supabase
      .from('messages')
      .select('conversation_id, created_at')
      .in('conversation_id', convIds)
      .neq('sender_id', currentUser.id)
      .is('deleted_at', null);

    let total = 0;
    (unreadMsgs || []).forEach(m => {
      const readAt = readMap[m.conversation_id];
      if (!readAt || new Date(m.created_at) > new Date(readAt)) total++;
    });

    updateDmDot(total);

    // Also subscribe to new incoming messages so the dot updates in real-time
    // even if the user never opens the inbox
    supabase
      .channel('dm-dot-realtime')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=in.(${convIds.join(',')})`,
      }, payload => {
        if (payload.new?.sender_id === currentUser.id) return;
        const dot = document.getElementById('dm-dot');
        const current = parseInt(dot?.textContent) || 0;
        updateDmDot(current + 1);
      })
      .subscribe();
  } catch (e) {
    console.warn('[DM] startup unread check failed:', e);
  }
}

// Fire as soon as Supabase is ready and user is authenticated
window.addEventListener('supabase-ready', () => {
  // Wait briefly for currentUser to be set by app-core.js auth flow
  const tryCheck = (attempts = 0) => {
    if (window.currentUser) {
      checkUnreadDmsOnStartup();
    } else if (attempts < 20) {
      setTimeout(() => tryCheck(attempts + 1), 300);
    }
  };
  tryCheck();
});
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
  msgInboxLoaded = false; // always refresh list for live unread/previews
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
    if (!readAt || new Date(m.created_at) > new Date(readAt)) {
      unreadMap[m.conversation_id] = (unreadMap[m.conversation_id] || 0) + 1;
    }
  });
  // Update the DM dot on the feed header
  const totalUnread = Object.values(unreadMap).reduce((a, b) => a + b, 0);
  updateDmDot(totalUnread);
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
    if (unread) row.classList.add('has-unread');
    const statusLine = unread
      ? ('New · ' + (timeStr || 'now'))
      : (isActive ? 'Active now' : (preview ? escHtml(preview.slice(0, 42)) : 'Tap to chat'));
    row.innerHTML = `
      <div class="msg-conv-av-wrap">
        <img class="msg-conv-av" src="${otherUser.avatar||''}" onerror="this.style.background='var(--bg3)';this.removeAttribute('src')" alt="">
        ${isActive ? '<span class="msg-conv-online-dot"></span>' : ''}
      </div>
      <div class="msg-conv-body">
        <div class="msg-conv-name-row">
          <span class="msg-conv-name">${escHtml(otherUser.username||'')}</span>
        </div>
        <div class="msg-conv-preview-row">
          <span class="msg-conv-preview${unread ? ' unread' : ''}">${statusLine}</span>
          ${unread ? `<div class="msg-conv-unread-badge">${unread > 9 ? '9+' : unread}</div>` : ''}
        </div>
      </div>
      <div class="msg-conv-action" aria-hidden="true">
        ${unread
          ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg><span>Open</span>'
          : '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>'}
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

async function loadChatUserStatus(userId) {
  // Optional: refresh topbar location / last-seen. Safe no-op if users table lacks fields.
  if (!userId) return;
  try {
    const { data } = await supabase
      .from('users')
      .select('location,username')
      .eq('id', userId)
      .maybeSingle();
    if (data && !isCurrentlyTyping) {
      const statusEl = document.getElementById('chat-topbar-status');
      if (statusEl) statusEl.textContent = data.location || 'MistyNote';
    }
  } catch (e) {}
}

// ── Open a chat ──
// ── Push chat input above keyboard using visualViewport ──
// Approach: only shrink the messages area, never touch the page height/transform.
(function initChatKeyboardFix() {
  if (!window.visualViewport) return;
  let _lastKeyboardH = 0;
  function scrollToBottom(msgsEl) {
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }
  function onViewportChange() {
    const page   = document.getElementById('page-chat');
    const msgsEl = document.getElementById('chat-messages');
    if (!page || !page.classList.contains('active') || !msgsEl) return;
    const vv        = window.visualViewport;
    const fullH     = window.innerHeight;
    const visibleH  = vv.height + vv.offsetTop;
    const keyboardH = Math.max(0, fullH - visibleH);
    // Shrink messages area so input bar rises above keyboard
    // Always keep ≥20px between last message and input bar
    msgsEl.style.paddingBottom = (keyboardH > 0 ? keyboardH + 20 : 20) + 'px';
    // Scroll to bottom immediately and again after animation completes
    scrollToBottom(msgsEl);
    if (keyboardH !== _lastKeyboardH) {
      setTimeout(() => scrollToBottom(msgsEl), 150);
    }
    _lastKeyboardH = keyboardH;
  }
  window.visualViewport.addEventListener('resize',  onViewportChange, { passive: true });
  window.visualViewport.addEventListener('scroll',  onViewportChange, { passive: true });
})();
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
function ensureChatTypingWaves() {
  let el = document.getElementById('chat-typing-waves');
  if (el) return el;
  const bar = document.getElementById('chat-input-bar');
  if (!bar) return null;
  el = document.createElement('div');
  el.id = 'chat-typing-waves';
  el.className = 'chat-typing-waves';
  el.setAttribute('aria-hidden', 'true');
  // Two curly sea paths — red & purple, opposite animation phase via CSS
  el.innerHTML =
    '<svg viewBox="0 0 320 22" preserveAspectRatio="none" aria-hidden="true">' +
      '<path class="chat-wave-path red" d="M0 11 C40 4, 80 18, 120 11 S200 4, 240 11 S300 18, 320 11"/>' +
      '<path class="chat-wave-path purple" d="M0 11 C40 18, 80 4, 120 11 S200 18, 240 11 S300 4, 320 11"/>' +
    '</svg>';
  bar.insertBefore(el, bar.firstChild);
  return el;
}
function setChatTypingWaves(on) {
  const el = ensureChatTypingWaves();
  if (!el) return;
  el.classList.toggle('active', !!on);
  el.setAttribute('aria-hidden', on ? 'false' : 'true');
}
function updateChatStatus(text, typing = false) {
  const statusEl = document.getElementById('chat-topbar-status');
  const onlineDot = document.getElementById('chat-topbar-online');
  // Waves above input = typing signal (no "typing..." text)
  setChatTypingWaves(!!typing);
  if (statusEl) {
    if (typing) {
      // Keep name area calm — optional soft label
      statusEl.textContent = text || (activeChatUser?.location || 'MistyNote');
      statusEl.className = 'chat-topbar-status';
    } else {
      statusEl.textContent = text;
      statusEl.className = 'chat-topbar-status';
    }
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
  const syncSend = () => {
    const btn = document.querySelector('.chat-send-btn, #chat-send-btn');
    if (!btn) return;
    const has = (input.value || '').trim().length > 0 || !!chatPendingImage;
    btn.classList.toggle('ready', has);
  };
  input.addEventListener('input', () => {
    syncSend();
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
  if (typeof setChatTypingWaves === 'function') setChatTypingWaves(false);
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
  try { rebuildChatComposer(true); } catch (e) {}
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
    // Poll other user's status every 15s (optional helper)
    clearInterval(window._statusPollInterval);
    window._statusPollInterval = setInterval(() => {
      if (activeChatUserId && !isCurrentlyTyping && typeof loadChatUserStatus === 'function') {
        try { loadChatUserStatus(activeChatUserId); } catch (e) {}
      }
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
  if (!msg || msg.deleted_at) return null;
  const isSent = msg.sender_id === currentUser?.id;
  const isNewSender = !prevSenderId || prevSenderId !== msg.sender_id;
  const row = document.createElement('div');
  row.className = `chat-msg-row ${isSent ? 'sent' : 'recv'}${isNewSender ? ' new-sender' : ' same-sender'}`;
  row.dataset.msgId = msg.id || '';
  row.dataset.senderId = msg.sender_id || '';

  const timeStr = msg.created_at ? msgFormatTime(msg.created_at) : '';
  const label = isSent ? 'ME' : (msg.sender?.username || activeChatUser?.username || 'Them');

  const labelRow = document.createElement('div');
  labelRow.className = 'chat-msg-label-row';
  labelRow.innerHTML = `<span class="chat-msg-label">${escHtml(label)}</span><span class="chat-msg-time">${timeStr}</span>`;

  const type = msg.type || 'text';
  const content = msg.content || '';
  const timeHtml = ''; // time in label row

  // Reply quote
  let replyQuoteHtml = '';
  if (msg.reply_to_id && msg.reply_to) {
    const rName = msg.reply_to.sender_id === currentUser?.id ? 'You' : (msg.reply_to.sender?.username || 'Reply');
    const rText = (msg.reply_to.content || 'Message').slice(0, 60);
    replyQuoteHtml = `<div class="chat-reply-quote"><strong>${escHtml(rName)}</strong> ${escHtml(rText)}</div>`;
  }

  const bubble = document.createElement('div');

  // Voice BEFORE image — media_url alone must not force image UI
  if (type === 'voice' || type === 'audio') {
    const vb = buildVoiceBubble(msg, isSent, timeStr);
    if (isNewSender) {
      vb.insertAdjacentHTML('afterbegin',
        '<div class="chat-msg-label-row">' +
          '<span class="chat-msg-label">' + escHtml(label) + '</span>' +
          '<span class="chat-msg-time">' + timeStr + '</span>' +
        '</div>'
      );
    }
    row.appendChild(vb);
    applyChatBubbleWidth(row, vb);
    try { attachTapPopup(row, msg); } catch (e) {}
    return row;
  } else if (type === 'image' || type === 'photo' || (msg.media_url && (type === 'image' || type === 'photo' || (!type || type === 'text') && /\.(jpe?g|png|gif|webp)/i.test(msg.media_url || '')))) {
    // only treat as image when type says so, or URL looks like an image
    bubble.className = 'chat-bubble img-bubble';
    const imgSrc = msg.media_url || content;
    bubble.innerHTML = `${replyQuoteHtml}<img class="chat-bubble-img" src="${escHtml(imgSrc)}" alt="photo" loading="lazy">`;
  } else if (type === 'gift' || type === 'mp_gift') {
    bubble.className = 'chat-bubble';
    bubble.innerHTML = `${replyQuoteHtml}🎁 ${escHtml(content || 'Sent MistyPoints')}`;
  } else {
    const text = content;
    // 50px = single emoji only; 20px = emoji-only (no letters), any count; else normal
    const singleEmoji = !replyQuoteHtml && typeof isSingleEmojiOnly === 'function' && isSingleEmojiOnly(text);
    const emojiOnly = !replyQuoteHtml && !singleEmoji && typeof isEmojiOnlyMessage === 'function' && isEmojiOnlyMessage(text);
    if (singleEmoji) {
      bubble.className = 'chat-bubble chat-bubble-emoji';
      bubble.innerHTML = '<span class="chat-emoji-xl">' + text + '</span>';
    } else if (emojiOnly) {
      bubble.className = 'chat-bubble chat-bubble-emoji-sm';
      bubble.innerHTML = '<span class="chat-emoji-md" style="font-size:20px;line-height:1.3;letter-spacing:2px">' + text + '</span>';
    } else {
      // CRITICAL: always set chat-bubble so white card CSS applies
      bubble.className = 'chat-bubble';
      if (typeof linkifyText === 'function') {
        bubble.innerHTML = `${replyQuoteHtml}${linkifyText(text)}`;
      } else {
        bubble.textContent = '';
        if (replyQuoteHtml) bubble.innerHTML = replyQuoteHtml;
        bubble.appendChild(document.createTextNode(text));
      }
    }
  }

  if (isNewSender) {
    bubble.insertAdjacentHTML('afterbegin',
      '<div class="chat-msg-label-row">' +
        '<span class="chat-msg-label">' + escHtml(label) + '</span>' +
        '<span class="chat-msg-time">' + timeStr + '</span>' +
      '</div>'
    );
  }
  row.appendChild(bubble);
  applyChatBubbleWidth(row, bubble);
  try { attachTapPopup(row, msg); } catch (e) {}
  return row;
}


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
    const bubble = e.target.closest('.chat-bubble, .chat-product-bubble, .chat-cash-bubble, .chat-order-bubble, .chat-offer-bubble, .chat-voice-bubble, .vn-card, .vn-player, .chat-bubble.img-bubble, .vn-card, .vn-player');
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
    const bubble = e.target.closest('.chat-bubble, .chat-product-bubble, .chat-cash-bubble, .chat-order-bubble, .chat-offer-bubble, .chat-voice-bubble, .vn-card, .vn-player');
    if (!bubble) return;
    e.preventDefault();
    showMsgPopup(row, msg, bubble);
  });
}
function showMsgPopup(row, msg, bubbleEl) {
  closeMsgPopup();
  const isSent = row.classList.contains('sent');

  // Prefer full message row content (label + bubble) so highlight matches chat
  const snapshotSrc = bubbleEl.closest('.chat-msg-row') || row;

  // 1. Dim backdrop
  const backdrop = document.createElement('div');
  backdrop.className = 'chat-popup-backdrop';
  backdrop.id = 'chat-popup-backdrop';
  document.body.appendChild(backdrop);
  requestAnimationFrame(function() { backdrop.classList.add('visible'); });

  const closeAll = function(e) {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    closeMsgPopup();
  };
  backdrop.addEventListener('click', closeAll);

  // 2. Floating snapshot — fixed: 20px from left, 20px above sheet
  const floatEl = document.createElement('div');
  floatEl.className = 'chat-popup-float-msg';
  floatEl.id = 'chat-popup-float-msg';
  const cloneRow = snapshotSrc.cloneNode(true);
  cloneRow.classList.add('chat-popup-float-clone');
  cloneRow.style.pointerEvents = 'none';
  // neutralize inline widths from fit-content measurements
  cloneRow.querySelectorAll('.chat-bubble, .vn-card').forEach(function(el) {
    el.style.width = '';
    el.style.maxWidth = '';
    el.style.minWidth = '';
  });
  floatEl.appendChild(cloneRow);
  document.body.appendChild(floatEl);
  // Same half-screen / full-width rule as live chat
  const cloneBubble = cloneRow.querySelector('.chat-bubble:not(.chat-bubble-emoji)');
  if (cloneBubble && typeof applyChatBubbleWidth === 'function') {
    applyChatBubbleWidth(cloneRow, cloneBubble);
  }


  // 3. Bottom options sheet (static for now)
  const sheet = document.createElement('div');
  sheet.className = 'chat-msg-action-sheet';
  sheet.id = 'chat-msg-popup';
  sheet.addEventListener('click', function(e) { e.stopPropagation(); });

  // Optional reaction strip (like screenshot)
  const reactions = document.createElement('div');
  reactions.className = 'chat-msg-reactions';
  ['👍','😮','❤️','😂','🔥','👎'].forEach(function(em) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chat-msg-reaction-btn';
    b.textContent = em;
    b.addEventListener('click', function() {
      showToast('Reaction — coming soon');
      closeMsgPopup();
    });
    reactions.appendChild(b);
  });
  const moreR = document.createElement('button');
  moreR.type = 'button';
  moreR.className = 'chat-msg-reaction-more';
  moreR.textContent = '+';
  moreR.addEventListener('click', function() {
    showToast('More reactions — coming soon');
    closeMsgPopup();
  });
  reactions.appendChild(moreR);
  sheet.appendChild(reactions);

  const list = document.createElement('div');
  list.className = 'chat-msg-action-list';

  function addOpt(icon, label, fn) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chat-msg-action-item';
    btn.innerHTML =
      '<span class="chat-msg-action-icon" aria-hidden="true">' + icon + '</span>' +
      '<span class="chat-msg-action-label">' + label + '</span>';
    btn.addEventListener('click', function() {
      closeMsgPopup();
      if (typeof fn === 'function') fn();
      else showToast(label + ' — coming soon');
    });
    list.appendChild(btn);
  }

  const icSave = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
  const icCopy = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
  const icDel  = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>';
  const icFwd  = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><polyline points="15 10 20 15 15 20"/><path d="M4 4v7a4 4 0 004 4h12"/></svg>';
  const icSnap = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>';
  const icFlag = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>';

  addOpt(icSave, 'Save in Chat', function() { showToast('Save in Chat — coming soon'); });
  addOpt(icCopy, 'Copy', function() {
    const t = msg.content || (msg.type === 'voice' ? 'Voice note' : '') || '';
    if (!t) { showToast('Nothing to copy'); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(function() { showToast('Copied'); }).catch(function() { showToast('Could not copy'); });
    } else showToast('Could not copy');
  });
  addOpt(icDel, 'Delete', function() { showToast('Delete — coming soon'); });
  addOpt(icFwd, 'Forward Message', function() { showToast('Forward — coming soon'); });
  addOpt(icSnap, 'Snap Reply', function() {
    if (typeof chatSetReply === 'function') chatSetReply(msg.id);
    else showToast('Reply — coming soon');
  });
  addOpt(icFlag, 'Report', function() { showToast('Report — coming soon'); });

  sheet.appendChild(list);
  document.body.appendChild(sheet);
  // Position the float ONCE, synchronously, before the browser paints.
  // The sheet's final geometry is known without waiting for its slide-in:
  // it is pinned to bottom:0, and offsetHeight ignores CSS transforms.
  const sheetH = sheet.offsetHeight;
  const gap = 20, minTop = 12;
  const maxFloatH = Math.max(60, window.innerHeight - sheetH - gap - minTop);
  // Anchor by bottom edge so later size changes (images/fonts) can't shift it
  floatEl.style.setProperty('left', '20px', 'important');
  floatEl.style.setProperty('top', 'auto', 'important');
  floatEl.style.setProperty('bottom', (sheetH + gap) + 'px', 'important');
  floatEl.style.maxHeight = maxFloatH + 'px';
  floatEl.style.overflow = 'hidden';
  floatEl.classList.add('visible');

  // Start the sheet slide-up on the next frame (transition needs a start state)
  requestAnimationFrame(function() { sheet.classList.add('open'); });
}

function closeMsgPopup() {
  const backdrop = document.getElementById('chat-popup-backdrop');
  if (backdrop) {
    backdrop.classList.remove('visible');
    setTimeout(function() { backdrop.remove(); }, 280);
  }
  const floatEl = document.getElementById('chat-popup-float-msg');
  if (floatEl) floatEl.remove();
  const sheet = document.getElementById('chat-msg-popup');
  if (sheet) {
    sheet.classList.remove('open');
    setTimeout(function() { sheet.remove(); }, 220);
  }
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
  // Step 2 — escape HTML, keep line breaks for chat display
  const escaped = escHtml(text).replace(/\r\n|\n|\r/g, '<br>');
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
  var isMP     = msg.cash_currency === 'MP';
  var amount   = isMP
    ? 'MP\u00a0' + Number(msg.cash_amount || 0).toLocaleString('en-NG', {maximumFractionDigits:4})
    : '\u20a6' + Number(msg.cash_amount || 0).toLocaleString();
  var ref      = msg.cash_ref || '';
  var shortRef = ref ? ref.slice(0, 12) : '';
  var note     = msg.cash_note || msg.content || '';
  var status   = msg.cash_status;
  var statusLabel = status === 'delivered' ? '\u2713 Delivered'
    : status === 'held'     ? 'Held in escrow'
    : status === 'released' ? 'Released \u2713'
    : status === 'refunded' ? 'Refunded'
    : '\u2713 Delivered';
  var div = document.createElement('div');
  div.className = 'chat-mp-bubble' + (isSent ? ' sent' : ' recv');
  div.innerHTML =
    '<div class="chat-mp-glow"></div>' +
    '<div class="chat-mp-inner">' +
      '<div class="chat-mp-label">' +
        (isMP
          ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><polyline points="20 12 20 22 4 22 4 12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><rect x="2" y="7" width="20" height="5" rx="1" stroke="currentColor" stroke-width="2.2"/><line x1="12" y1="22" x2="12" y2="7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z" stroke="currentColor" stroke-width="2"/><path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z" stroke="currentColor" stroke-width="2"/></svg>'
          : '\uD83D\uDCB8') +
        (isSent ? ' MistyPoints Sent' : ' MistyPoints Received') +
      '</div>' +
      '<div class="chat-mp-amount">' + amount + '</div>' +
      (note ? '<div class="chat-mp-note">' + escHtml(note) + '</div>' : '') +
      '<div class="chat-mp-footer">' +
        '<div class="chat-mp-status">' +
          '<svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>' +
          statusLabel +
        '</div>' +
        (shortRef ? '<div class="chat-mp-ref" onclick="chatCopyRef(this.dataset.ref)" data-ref="' + escHtml(ref) + '" title="Tap to copy reference">' + shortRef + '</div>' : '') +
      '</div>' +
      '<div class="chat-mp-time">' + timeStr + '</div>' +
    '</div>';
  // Long press → share receipt
  var pressTimer;
  div.addEventListener('touchstart', function() {
    pressTimer = setTimeout(function() { chatShareReceipt(msg); }, 600);
  });
  div.addEventListener('touchend', function() { clearTimeout(pressTimer); });
  div.addEventListener('touchmove', function() { clearTimeout(pressTimer); });
  return div;
}
function chatCopyRef(ref) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(ref).then(function() {
      showToast('Reference copied: ' + ref);
    });
  } else {
    showToast('Ref: ' + ref);
  }
}
function chatShareReceipt(msg) {
  var text = [
    'MistyNote Payment Receipt',
    '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500',
    'Amount: MP ' + msg.cash_amount,
    msg.cash_note ? 'Note: ' + msg.cash_note : '',
    'Ref: ' + (msg.cash_ref || 'N/A'),
    'Date: ' + new Date(msg.created_at).toLocaleString('en-NG'),
    '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500',
    'MistyNote · mistynote.pages.dev',
  ].filter(Boolean).join('\n');
  if (navigator.share) {
    navigator.share({ title: 'MistyNote Receipt', text: text }).catch(function() {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(function() {
      showToast('Receipt copied to clipboard');
    });
  }
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
  const id = String(msg.id || Date.now());
  const waveId = 'wv-' + id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 14);
  const dur = Number(msg.media_duration || 0);
  const durStr = (typeof _voiceFmt === 'function') ? _voiceFmt(dur) : (Math.floor(dur / 60) + ':' + String(dur % 60).padStart(2, '0'));
  const url = (msg.media_url || '').replace(/"/g, '');

  let seed = 11;
  for (let i = 0; i < id.length; i++) seed = (seed * 33 + id.charCodeAt(i)) >>> 0;
  const heights = [];
  for (let i = 0; i < 26; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const envelope = 0.4 + 0.6 * Math.sin((i / 25) * Math.PI);
    heights.push(Math.max(8, Math.round((10 + (seed % 18)) * envelope)));
  }
  const barsHtml = heights.map(function(h) {
    return '<i class="vn-bar" style="height:' + h + 'px"></i>';
  }).join('');

  // Standard chat card (same family as text bubbles) + inner voice row
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble chat-bubble-voice';
  if (url) bubble.setAttribute('data-voice-url', url);

  bubble.innerHTML =
    '<div class="vn-player" data-voice-url="' + url + '">' +
      '<button type="button" class="vn-play" data-src="' + url + '" data-wave="' + waveId + '" data-dur="' + dur + '" onclick="chatPlayVoice(this,\'' + waveId + '\')" aria-label="Play">' +
        '<svg class="vn-ic-play" viewBox="0 0 24 24" width="40" height="40"><path fill="currentColor" d="M8 5.2v13.6a.9.9 0 001.35.78l10.4-6.8a.9.9 0 000-1.56L9.35 4.42A.9.9 0 008 5.2z"/></svg>' +
        '<svg class="vn-ic-pause" viewBox="0 0 24 24" width="40" height="40" style="display:none"><rect x="6" y="5" width="4.5" height="14" rx="1.2" fill="currentColor"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.2" fill="currentColor"/></svg>' +
      '</button>' +
      '<div class="vn-wave" id="' + waveId + '">' + barsHtml + '</div>' +
      '<button type="button" class="vn-speed" onclick="event.stopPropagation();voiceCycleSpeed(this)" data-speed="1">1x</button>' +
      '<span class="vn-time" data-elapsed data-total="' + durStr + '">' + durStr + '</span>' +
    '</div>';
  return bubble;
}

function voiceCycleSpeed(btn) {
  if (!btn) return;
  const steps = [1, 1.5, 2];
  let cur = parseFloat(btn.dataset.speed || '1');
  let idx = steps.indexOf(cur);
  if (idx < 0) idx = 0;
  idx = (idx + 1) % steps.length;
  const next = steps[idx];
  btn.dataset.speed = String(next);
  btn.textContent = next + 'x';
  if (_voiceAudio) {
    try { _voiceAudio.playbackRate = next; } catch (e) {}
  }
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

// ── Single-emoji auto-send (50px card) ─────────────────────
function _emojiGraphemes(str) {
  const s = String(str || '').trim();
  if (!s) return [];
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      return [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(s)].map(p => p.segment);
    }
  } catch (e) {}
  return Array.from(s);
}
function _isEmojiGrapheme(g) {
  if (!g) return false;
  const t = g.trim();
  if (!t) return false;
  try {
    if (/\p{L}|\p{N}/u.test(t)) return false; // any letter/number → not pure emoji
    // Emoji presentation or extended pictographic (covers most keyboard emoji)
    if (/\p{Extended_Pictographic}/u.test(t)) return true;
    if (/\p{Emoji_Presentation}/u.test(t)) return true;
    // Some symbols only count as emoji with FE0F
    if (/\p{Emoji}/u.test(t) && /\uFE0F/.test(t)) return true;
    return false;
  } catch (e) {
    // Very old engines: rough fallback
    return t.length <= 8 && !/[A-Za-z0-9]/.test(t);
  }
}
/** Exactly one emoji (in-app quick send → 50px) */
function isSingleEmojiOnly(str) {
  const parts = _emojiGraphemes(str).filter(g => g.trim().length);
  return parts.length === 1 && _isEmojiGrapheme(parts[0]);
}
/** One or more emojis only — no letters (keyboard → 20px) */
function isEmojiOnlyMessage(str) {
  const s = String(str || '').trim();
  if (!s) return false;
  // Fast reject if Latin letters/digits present
  try {
    if (/\p{L}|\p{N}/u.test(s)) return false;
  } catch (e) {
    if (/[A-Za-z0-9]/.test(s)) return false;
  }
  const parts = _emojiGraphemes(s).filter(g => g.trim().length);
  if (!parts.length) return false;
  return parts.every(_isEmojiGrapheme);
}

/** After paint: short text = hug content; longer than half screen = full width */
function applyChatBubbleWidth(row, bubble) {
  if (!row || !bubble) return;
  if (bubble.classList.contains('chat-bubble-emoji')) return; // 50px emoji stays compact
  requestAnimationFrame(function() {
    try {
      const half = Math.floor(window.innerWidth * 0.5);
      // Measure unconstrained
      bubble.style.width = 'fit-content';
      bubble.style.maxWidth = '100%';
      row.style.width = 'auto';
      row.style.maxWidth = '100%';
      const w = bubble.offsetWidth || bubble.scrollWidth;
      if (w >= half) {
        row.style.width = '100%';
        row.style.maxWidth = '100%';
        bubble.style.width = '100%';
        bubble.style.maxWidth = '100%';
        bubble.classList.add('chat-bubble-full');
      } else {
        bubble.classList.remove('chat-bubble-full');
      }
    } catch (e) {}
  });
}

/** Tap from emoji picker: empty field → instant send at 50px; else append to text */
function chatPickEmoji(emoji) {
  if (!emoji) return;
  const field = document.getElementById('chat-input-field');
  const current = (field?.value || '').trim();
  if (!current) {
    // Standalone emoji → send immediately (one emoji only)
    if (field) field.value = emoji;
    chatSend({ forceEmoji: true });
    return;
  }
  // Already typing letters → normal insert
  if (field) {
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? field.value.length;
    const v = field.value;
    field.value = v.slice(0, start) + emoji + v.slice(end);
    field.focus();
    const pos = start + emoji.length;
    try { field.setSelectionRange(pos, pos); } catch (e) {}
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
}


function chatSetReply(msgId) {
  const row = document.querySelector('.chat-msg-row[data-msg-id="' + msgId + '"]');
  if (!row) return;
  const bubble = row.querySelector('.chat-bubble, .vn-card');
  if (!bubble) return;
  const isSent = row.classList.contains('sent');
  const name = isSent
    ? ((typeof currentProfile !== 'undefined' && currentProfile?.username) || 'You')
    : (activeChatUser?.username || 'them');
  const imgEl = bubble.querySelector('.chat-bubble-img');
  const previewText = imgEl ? '📷 Photo' : (bubble.textContent || '').trim().slice(0, 80);
  const mediaUrl = imgEl ? imgEl.src : null;
  chatReplyTo = { id: msgId, senderName: name, content: previewText, mediaUrl: mediaUrl };
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
function chatImageSelected(input) {
  const file = input && input.files && input.files[0];
  if (!file) return;
  if (!file.type || !file.type.startsWith('image/')) {
    showToast('Please select an image');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast('Image must be under 10MB');
    return;
  }
  const reader = new FileReader();
  reader.onload = function(e) {
    chatPendingImage = { file: file, dataUrl: e.target.result };
    const bar = document.getElementById('chat-img-preview-bar');
    const thumb = document.getElementById('chat-img-preview-thumb');
    if (bar) bar.style.display = 'block';
    if (thumb) thumb.src = e.target.result;
    if (typeof syncChatActionBtn === 'function') syncChatActionBtn();
  };
  reader.readAsDataURL(file);
  input.value = '';
}
function chatCancelImage() {
  chatPendingImage = null;
  const bar = document.getElementById('chat-img-preview-bar');
  if (bar) bar.style.display = 'none';
  if (typeof syncChatActionBtn === 'function') syncChatActionBtn();
}
function compressChatImage(file) {
  return new Promise(function(resolve) {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = function() {
      URL.revokeObjectURL(url);
      const MAX = 1280;
      let width = img.width, height = img.height;
      if (width > MAX || height > MAX) {
        if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
        else { width = Math.round(width * MAX / height); height = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(function(blob) { resolve(blob || file); }, 'image/jpeg', 0.82);
    };
    img.onerror = function() { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

async function chatSend(opts) {
  opts = opts || {};
  const field = document.getElementById('chat-input-field');
  const text  = field?.value?.trim();
  const hasImage = !!(typeof chatPendingImage !== 'undefined' && chatPendingImage);
  if (!text && !hasImage) return;
  if (!activeChatId || !currentUser) return;
  let isBigEmoji = false;
  try {
    isBigEmoji = !hasImage && (opts.forceEmoji || (typeof isSingleEmojiOnly === 'function' && isSingleEmojiOnly(text)));
  } catch (e) { isBigEmoji = !!opts.forceEmoji; }
  // Capture reply & image state then clear immediately
  const replySnapshot = chatReplyTo ? { ...chatReplyTo } : null;
  const imageSnapshot = chatPendingImage ? { ...chatPendingImage } : null;
  if (field) {
    field.value = '';
    field.style.height = 'auto';
  }
  if (typeof syncChatActionBtn === 'function') syncChatActionBtn();
  try { if (typeof chatCancelReply === 'function') chatCancelReply(); } catch (e) {}
  try { if (typeof chatCancelImage === 'function') chatCancelImage(); } catch (e) {}
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
        // Update the dm-dot total
        const allBadges = document.querySelectorAll('.msg-conv-unread-badge');
        let total = 0;
        allBadges.forEach(b => { total += parseInt(b.textContent) || 0; });
        updateDmDot(total);
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
  // Recalculate dm-dot
  const allBadges = document.querySelectorAll('.msg-conv-unread-badge');
  let total = 0;
  allBadges.forEach(b => { total += parseInt(b.textContent) || 0; });
  updateDmDot(total);
}
// ── Input helpers ──
function chatInputResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 100) + 'px';
}
function chatInputKeydown(e) {
  // Enter = new line (do not send). Use the purple send / gallery morph to send.
}
// ── Quick action stubs (to be built out) ──
function chatSendCash() { chatSendMP(); } // legacy alias
function chatSendMP() {
  if (!activeChatUserId || !activeChatUser) {
    showToast('Open a conversation first');
    return;
  }
  walletState.selectedGiftRecipient = {
    id:        activeChatUserId,
    name:      activeChatUser.username || activeChatUser.name || 'User',
    avatarUrl: activeChatUser.avatar || '',
    fromDM:    true,
    convId:    activeChatId,
  };
  openDMGiftModal();
}
function openDMGiftModal() {
  var existing = document.getElementById('dm-gift-modal');
  if (existing) existing.remove();
  var r       = walletState.selectedGiftRecipient;
  if (!r) return;
  var balance = walletState.points || 0;
  var modal   = document.createElement('div');
  modal.id = 'dm-gift-modal';
  modal.className = 'dm-gift-overlay';
  modal.innerHTML =
    '<div class="dm-gift-sheet" role="dialog" aria-label="Send MP">' +
      '<div class="dm-gift-handle"></div>' +
      '<div class="dm-gift-head">' +
        '<div class="dm-gift-user">' +
          '<img class="dm-gift-av" src="' + (r.avatarUrl || '') + '" alt="" onerror="this.style.display=\'none\'">' +
          '<div class="dm-gift-user-meta">' +
            '<div class="dm-gift-to">To ' + escHtml(r.name) + '</div>' +
            '<div class="dm-gift-bal">MP ' + balance.toLocaleString('en-NG', { maximumFractionDigits: 4 }) + ' available</div>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="dm-gift-x" onclick="closeDMGiftModal()" aria-label="Close">×</button>' +
      '</div>' +
      '<div class="dm-gift-amount-row">' +
        '<span class="dm-gift-mp-label">MP</span>' +
        '<input id="dm-gift-amount" class="dm-gift-amount" type="tel" inputmode="decimal" placeholder="0" oninput="dmGiftPreview(this.value)">' +
      '</div>' +
      '<div class="dm-gift-quick">' +
        '<button type="button" class="dm-gift-chip" onclick="dmGiftQuick(0.5)">0.5</button>' +
        '<button type="button" class="dm-gift-chip" onclick="dmGiftQuick(1)">1</button>' +
        '<button type="button" class="dm-gift-chip" onclick="dmGiftQuick(5)">5</button>' +
        '<button type="button" class="dm-gift-chip" onclick="dmGiftQuick(10)">10</button>' +
      '</div>' +
      '<div id="dm-gift-preview" class="dm-gift-preview">Enter amount</div>' +
      '<input id="dm-gift-note" class="dm-gift-note" type="text" placeholder="Note (optional)" maxlength="80">' +
      '<button id="dm-gift-btn" class="dm-gift-submit" onclick="confirmDMGift()" disabled>Send MP</button>' +
    '</div>';
  modal.addEventListener('click', function(e) {
    if (e.target === modal) closeDMGiftModal();
  });
  document.body.appendChild(modal);
  // Don't autofocus amount — avoids keyboard shoving sheet up; user taps field if needed
}
function dmGiftQuick(n) {
  var el = document.getElementById('dm-gift-amount');
  if (!el) return;
  el.value = String(n);
  dmGiftPreview(el.value);
}
function dmGiftPreview(val) {
  var pts  = parseFloat(val) || 0;
  var prev = document.getElementById('dm-gift-preview');
  var btn  = document.getElementById('dm-gift-btn');
  if (!prev || !btn) return;
  var bal  = walletState.points || 0;
  if (pts <= 0) {
    prev.textContent = 'Enter amount to gift';
    btn.disabled = true; btn.style.opacity = '0.5';
  } else if (pts > bal) {
    prev.textContent = 'Not enough MistyPoints';
    btn.disabled = true; btn.style.opacity = '0.5';
  } else {
    prev.textContent = 'Gifting MP ' + pts.toLocaleString('en-NG', {maximumFractionDigits:4}) + ' to ' + escHtml(walletState.selectedGiftRecipient.name);
    btn.disabled = false; btn.style.opacity = '1';
  }
}
function closeDMGiftModal() {
  var m = document.getElementById('dm-gift-modal'); if (m) m.remove();
}
async function confirmDMGift() {
  var amtEl  = document.getElementById('dm-gift-amount');
  var noteEl = document.getElementById('dm-gift-note');
  var amount = parseFloat(amtEl ? amtEl.value : '0') || 0;
  var note   = noteEl ? noteEl.value.trim() : '';
  var r      = walletState.selectedGiftRecipient;
  if (!r || amount <= 0 || amount > walletState.points) return;
  var pinOk  = await walletPinCheck();
  if (!pinOk) return;
  closeDMGiftModal();
  showToast('Gifting MP ' + amount + ' to ' + r.name + '...');
  try {
    var res = await supabase.rpc('p2p_transfer_points', {
      sender_id: currentUser.id, recipient_id: r.id, points: amount, note: note,
    });
    if (res.error) throw res.error;
    var ref = 'MN-' + Date.now().toString(36).toUpperCase();
    walletState.points -= amount;
    renderWalletBalance();
    showToast('✓ Gifted MP ' + amount + ' to ' + r.name);
    syncWalletBalance();
    refreshTransactionList();
    if (typeof postGiftBubbleToDM === 'function') postGiftBubbleToDM(r, amount, note, ref);
    if (typeof sendGiftNotification === 'function') sendGiftNotification(r.id, amount, note, ref);
  } catch (e) {
    showToast('Gift failed — please try again');
    console.error('DM gift error:', e);
  }
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


// ══════════════════════════════════════════════════════════
// VOICE NOTES — record → preview (play / delete / send) → R2 → chat
// ══════════════════════════════════════════════════════════
let _voiceRec = {
  recording: false,
  mediaRecorder: null,
  chunks: [],
  stream: null,
  startedAt: 0,
  tickTimer: null,
  maxTimer: null,
};
let _voiceDraft = null; // { blob, url, durationSec, mime }
let _voiceAudio = null;

function _voiceFmt(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}

function ensureVoicePanels() {
  const bar = document.getElementById('chat-input-bar');
  if (!bar) return null;
  let rec = document.getElementById('chat-voice-recording');
  if (!rec) {
    rec = document.createElement('div');
    rec.id = 'chat-voice-recording';
    rec.className = 'chat-voice-panel chat-voice-recording';
    rec.innerHTML =
      '<div class="chat-voice-panel-inner">' +
        '<span class="chat-voice-rec-dot" aria-hidden="true"></span>' +
        '<span class="chat-voice-rec-label">Recording</span>' +
        '<span class="chat-voice-rec-timer" id="chat-voice-rec-timer">0:00</span>' +
        '<button type="button" class="chat-voice-panel-btn stop" onclick="voiceStopRecording()" aria-label="Stop">Stop</button>' +
      '</div>';
    bar.insertBefore(rec, bar.firstChild);
  }
  let prev = document.getElementById('chat-voice-preview');
  if (!prev) {
    prev = document.createElement('div');
    prev.id = 'chat-voice-preview';
    prev.className = 'chat-voice-panel chat-voice-preview';
    prev.innerHTML =
      '<div class="chat-voice-panel-inner">' +
        '<button type="button" class="chat-voice-panel-btn icon" id="chat-voice-preview-play" onclick="voicePreviewTogglePlay()" aria-label="Play">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg>' +
        '</button>' +
        '<div class="chat-voice-preview-meta">' +
          '<span class="chat-voice-preview-title">Voice note</span>' +
          '<span class="chat-voice-preview-dur" id="chat-voice-preview-dur">0:00</span>' +
        '</div>' +
        '<button type="button" class="chat-voice-panel-btn danger" onclick="voiceDiscardDraft()" aria-label="Delete">Delete</button>' +
        '<button type="button" class="chat-voice-panel-btn primary" onclick="voiceSendDraft()" aria-label="Send">Send</button>' +
      '</div>';
    bar.insertBefore(prev, bar.firstChild);
  }
  return { rec: rec, prev: prev };
}

function voiceShowRecordingUI(on) {
  ensureVoicePanels();
  const rec = document.getElementById('chat-voice-recording');
  const prev = document.getElementById('chat-voice-preview');
  const row = document.querySelector('#chat-input-bar .chat-input-bar-row');
  if (rec) rec.classList.toggle('open', !!on);
  if (prev && on) prev.classList.remove('open');
  if (row) row.classList.toggle('voice-ui-hidden', !!on);
  document.getElementById('chat-voice-btn')?.classList.toggle('recording', !!on);
}

function voiceShowPreviewUI(on) {
  ensureVoicePanels();
  const rec = document.getElementById('chat-voice-recording');
  const prev = document.getElementById('chat-voice-preview');
  const row = document.querySelector('#chat-input-bar .chat-input-bar-row');
  if (prev) prev.classList.toggle('open', !!on);
  if (rec) rec.classList.remove('open');
  if (row) row.classList.toggle('voice-ui-hidden', !!on);
  document.getElementById('chat-voice-btn')?.classList.remove('recording');
}

function voiceCleanupMic() {
  try {
    (_voiceRec.stream && _voiceRec.stream.getTracks() || []).forEach(function(t) { t.stop(); });
  } catch (e) {}
  _voiceRec.stream = null;
  _voiceRec.mediaRecorder = null;
  _voiceRec.recording = false;
  clearInterval(_voiceRec.tickTimer);
  clearTimeout(_voiceRec.maxTimer);
  _voiceRec.tickTimer = null;
  _voiceRec.maxTimer = null;
}

/** Tap wave icon: start recording (or ignore if draft open) */
async function chatRecordVoice() {
  if (!activeChatId || !currentUser) {
    showToast('Open a chat first');
    return;
  }
  if (_voiceDraft) {
    showToast('Send or delete the voice note first');
    return;
  }
  if (_voiceRec.recording) {
    voiceStopRecording();
    return;
  }
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    showToast('Voice notes not supported here');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    _voiceRec.stream = stream;
    _voiceRec.chunks = [];
    let mime = '';
    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mime = 'audio/webm;codecs=opus';
    else if (MediaRecorder.isTypeSupported('audio/webm')) mime = 'audio/webm';
    else if (MediaRecorder.isTypeSupported('audio/mp4')) mime = 'audio/mp4';
    const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    _voiceRec.mediaRecorder = mr;
    _voiceRec.startedAt = Date.now();
    mr.ondataavailable = function(e) {
      if (e.data && e.data.size > 0) _voiceRec.chunks.push(e.data);
    };
    mr.start(200);
    _voiceRec.recording = true;
    voiceShowRecordingUI(true);
    const timerEl = document.getElementById('chat-voice-rec-timer');
    if (timerEl) timerEl.textContent = '0:00';
    _voiceRec.tickTimer = setInterval(function() {
      const s = Math.floor((Date.now() - _voiceRec.startedAt) / 1000);
      const el = document.getElementById('chat-voice-rec-timer');
      if (el) el.textContent = _voiceFmt(s);
    }, 250);
    _voiceRec.maxTimer = setTimeout(function() {
      if (_voiceRec.recording) voiceStopRecording();
    }, 60000);
  } catch (err) {
    console.warn('[voice] mic', err);
    showToast('Allow microphone to record');
    voiceCleanupMic();
    voiceShowRecordingUI(false);
  }
}

/** Stop recording → build draft → preview UI (play / delete / send) */
function voiceStopRecording() {
  if (!_voiceRec.mediaRecorder || !_voiceRec.recording) {
    voiceCleanupMic();
    voiceShowRecordingUI(false);
    return;
  }
  const mr = _voiceRec.mediaRecorder;
  const durationSec = Math.max(1, Math.round((Date.now() - _voiceRec.startedAt) / 1000));
  const mime = mr.mimeType || 'audio/webm';

  const finish = function(blob) {
    voiceCleanupMic();
    voiceShowRecordingUI(false);
    if (!blob || blob.size < 80) {
      showToast('Recording too short');
      return;
    }
    if (_voiceDraft && _voiceDraft.url) {
      try { URL.revokeObjectURL(_voiceDraft.url); } catch (e) {}
    }
    const url = URL.createObjectURL(blob);
    _voiceDraft = { blob: blob, url: url, durationSec: durationSec, mime: mime };
    const durEl = document.getElementById('chat-voice-preview-dur');
    if (durEl) durEl.textContent = _voiceFmt(durationSec);
    voiceShowPreviewUI(true);
  };

  mr.onstop = function() {
    finish(new Blob(_voiceRec.chunks, { type: mime }));
  };
  try {
    mr.stop();
  } catch (e) {
    finish(new Blob(_voiceRec.chunks, { type: mime }));
  }
}

function voicePreviewTogglePlay() {
  if (!_voiceDraft || !_voiceDraft.url) return;
  const btn = document.getElementById('chat-voice-preview-play');
  if (_voiceAudio && !_voiceAudio.paused) {
    _voiceAudio.pause();
    _voiceAudio = null;
    if (btn) btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg>';
    return;
  }
  if (_voiceAudio) {
    try { _voiceAudio.pause(); } catch (e) {}
  }
  const audio = new Audio(_voiceDraft.url);
  _voiceAudio = audio;
  if (btn) btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
  audio.play().catch(function() { showToast('Could not play'); });
  audio.onended = function() {
    if (btn) btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg>';
    if (_voiceAudio === audio) _voiceAudio = null;
  };
}

function voiceDiscardDraft() {
  if (_voiceAudio) {
    try { _voiceAudio.pause(); } catch (e) {}
    _voiceAudio = null;
  }
  if (_voiceDraft && _voiceDraft.url) {
    try { URL.revokeObjectURL(_voiceDraft.url); } catch (e) {}
  }
  _voiceDraft = null;
  voiceShowPreviewUI(false);
  const row = document.querySelector('#chat-input-bar .chat-input-bar-row');
  if (row) row.classList.remove('voice-ui-hidden');
}

async function voiceSendDraft() {
  if (!_voiceDraft || !activeChatId || !currentUser) return;
  if (typeof uploadToR2 !== 'function') {
    showToast('Upload not ready');
    return;
  }
  const draft = _voiceDraft;
  const durationSec = draft.durationSec;
  const blob = draft.blob;
  const mime = draft.mime || blob.type || 'audio/webm';
  const ext = mime.indexOf('mp4') >= 0 ? 'm4a' : 'webm';

  // Hide preview, restore composer
  if (_voiceAudio) {
    try { _voiceAudio.pause(); } catch (e) {}
    _voiceAudio = null;
  }
  _voiceDraft = null;
  voiceShowPreviewUI(false);
  const row = document.querySelector('#chat-input-bar .chat-input-bar-row');
  if (row) row.classList.remove('voice-ui-hidden');

  const msgsEl = document.getElementById('chat-messages');
  const lastRow = msgsEl && msgsEl.querySelector('.chat-msg-row:last-child');
  const lastSenderId = lastRow
    ? (lastRow.classList.contains('sent') ? currentUser.id : activeChatUserId)
    : null;
  const tmpId = 'tmp-voice-' + Date.now();
  const tmpMsg = {
    id: tmpId,
    type: 'voice',
    content: '',
    media_url: draft.url,
    media_duration: durationSec,
    sender_id: currentUser.id,
    created_at: new Date().toISOString(),
    sender: typeof currentProfile !== 'undefined' ? currentProfile : null,
  };
  const el = buildMessageEl(tmpMsg, lastSenderId);
  if (el && msgsEl) {
    msgsEl.appendChild(el);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }
  if (typeof updateInboxRow === 'function') {
    updateInboxRow(activeChatId, '🎙 Voice note', tmpMsg.created_at);
  }

  showToast('Sending voice…');
  let publicUrl = null;
  try {
    const filename = (currentUser.id || 'u') + '-' + Date.now() + '.' + ext;
    publicUrl = await uploadToR2(blob, 'chat-voice', filename);
  } catch (err) {
    console.warn('[voice] R2', err);
    showToast('Upload failed — try again');
    if (el) el.remove();
    try { URL.revokeObjectURL(draft.url); } catch (e) {}
    return;
  }

  const payload = {
    conversation_id: activeChatId,
    sender_id: currentUser.id,
    type: 'voice',
    media_url: publicUrl,
    media_duration: durationSec,
    content: '',
  };
  const { error: insertErr } = await supabase.from('messages').insert(payload);
  if (insertErr) {
    console.warn('[voice] insert', insertErr);
    showToast(insertErr.message || 'Could not save voice note');
    if (el) el.remove();
    return;
  }

  const playBtn = el && el.querySelector('.chat-voice-play');
  if (playBtn) playBtn.dataset.src = publicUrl;
  if (el) {
    const bubble = el.querySelector('.chat-bubble');
    if (bubble) bubble.setAttribute('data-voice-url', publicUrl);
  }
  try { URL.revokeObjectURL(draft.url); } catch (e) {}
  if (typeof markConvRead === 'function') markConvRead(activeChatId);
  showToast('Voice sent');
}

function chatPlayVoice(btn, waveId) {
  if (!btn) return;
  const player = btn.closest('.vn-player');
  const bubble = btn.closest('.chat-bubble');
  let url = btn.dataset.src
    || (player && player.getAttribute('data-voice-url'))
    || (bubble && bubble.getAttribute('data-voice-url'));
  if (!url) {
    showToast('Audio unavailable');
    return;
  }

  const wave = document.getElementById(waveId) || document.getElementById(btn.dataset.wave);
  const bars = wave ? wave.querySelectorAll('.vn-bar') : [];
  const timeEl = player && player.querySelector('[data-elapsed]');
  const totalStr = (timeEl && timeEl.getAttribute('data-total')) || (typeof _voiceFmt === 'function' ? _voiceFmt(btn.dataset.dur) : '0:00');
  const totalDur = Number(btn.dataset.dur || 0);
  const icPlay = btn.querySelector('.vn-ic-play');
  const icPause = btn.querySelector('.vn-ic-pause');
  const speedBtn = player && player.querySelector('.vn-speed');
  const rate = speedBtn ? (parseFloat(speedBtn.dataset.speed) || 1) : 1;

  function setPlayingUI(on) {
    btn.classList.toggle('is-playing', !!on);
    player && player.classList.toggle('is-playing', !!on);
    btn.dataset.playing = on ? '1' : '0';
    if (icPlay) icPlay.style.display = on ? 'none' : 'block';
    if (icPause) icPause.style.display = on ? 'block' : 'none';
  }

  function resetProgress() {
    bars.forEach(function(b) { b.classList.remove('played'); });
    if (timeEl) timeEl.textContent = totalStr;
  }

  if (_voiceAudio && btn.dataset.playing === '1') {
    try { _voiceAudio.pause(); } catch (e) {}
    _voiceAudio = null;
    setPlayingUI(false);
    // keep elapsed where paused? user asked stop → back to total
    resetProgress();
    return;
  }

  if (_voiceAudio) {
    try { _voiceAudio.pause(); } catch (e) {}
    document.querySelectorAll('.vn-play.is-playing').forEach(function(b) {
      b.classList.remove('is-playing');
      b.dataset.playing = '0';
      const p = b.closest('.vn-player');
      if (p) p.classList.remove('is-playing');
      const ip = b.querySelector('.vn-ic-play');
      const iu = b.querySelector('.vn-ic-pause');
      if (ip) ip.style.display = 'block';
      if (iu) iu.style.display = 'none';
      const te = p && p.querySelector('[data-elapsed]');
      if (te) te.textContent = te.getAttribute('data-total') || te.textContent;
      const w = document.getElementById(b.dataset.wave);
      if (w) w.querySelectorAll('.vn-bar').forEach(function(x) { x.classList.remove('played'); });
    });
  }

  const audio = new Audio(url);
  audio.playbackRate = rate;
  _voiceAudio = audio;
  setPlayingUI(true);
  bars.forEach(function(b) { b.classList.remove('played'); });
  if (timeEl) timeEl.textContent = '0:00';

  audio.play().catch(function() {
    showToast('Could not play');
    setPlayingUI(false);
    resetProgress();
    _voiceAudio = null;
  });

  audio.ontimeupdate = function() {
    if (!_voiceAudio || _voiceAudio !== audio) return;
    const t = audio.currentTime || 0;
    const d = audio.duration && isFinite(audio.duration) ? audio.duration : totalDur;
    if (timeEl && typeof _voiceFmt === 'function') timeEl.textContent = _voiceFmt(t);
    if (bars.length && d > 0) {
      const n = Math.floor((t / d) * bars.length);
      bars.forEach(function(b, i) { b.classList.toggle('played', i < n); });
    }
  };

  audio.onended = function() {
    setPlayingUI(false);
    resetProgress();
    if (_voiceAudio === audio) _voiceAudio = null;
  };
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



// ── Emoji tray (keyboard-slot, toggles, docks under input) ──
let _stickerPickerTarget = 'dm';
let _emojiTrayOpen = false;

function _emojiTrayEl() {
  return document.getElementById('chat-emoji-tray');
}

function ensureChatEmojiTray() {
  let tray = _emojiTrayEl();
  if (tray) return tray;
  const page = document.getElementById('page-chat');
  if (!page) return null;
  tray = document.createElement('div');
  tray.id = 'chat-emoji-tray';
  tray.className = 'chat-emoji-tray';
  tray.setAttribute('aria-hidden', 'true');
  const emojis = ['😀','😂','🥰','😍','😎','😭','🔥','❤️','💯','👍','🙏','👏','🎉','😮','😢','💪','🤝','✨','🫂','💋','🥺','😤','🤔','👀','💬','🇳🇬','⚽','🎵','🍕','☕','🙌','😊','😘','🤩','😴','😡','🫶','😅','🤣','😌'];
  tray.innerHTML =
    '<div class="chat-emoji-tray-grid">' +
      emojis.map(function(e) {
        return '<button type="button" class="chat-emoji-tray-btn" data-emoji="' + e + '">' + e + '</button>';
      }).join('') +
    '</div>';
  tray.addEventListener('click', function(ev) {
    const btn = ev.target.closest('.chat-emoji-tray-btn');
    if (!btn) return;
    const em = btn.dataset.emoji;
    if (_stickerPickerTarget === 'dm' && typeof chatPickEmoji === 'function') {
      // Empty input → auto-send emoji (same as before). Else append into text.
      chatPickEmoji(em);
      if (typeof syncChatActionBtn === 'function') syncChatActionBtn();
    }
  });
  // Insert after input bar so tray sits where keyboard would
  const bar = document.getElementById('chat-input-bar');
  if (bar && bar.parentNode) {
    bar.parentNode.insertBefore(tray, bar.nextSibling);
  } else {
    page.appendChild(tray);
  }
  return tray;
}

function openChatEmojiTray() {
  const tray = ensureChatEmojiTray();
  if (!tray) return;
  // Dismiss soft keyboard so tray occupies that space
  const field = document.getElementById('chat-input-field');
  if (field) field.blur();
  tray.classList.add('open');
  tray.setAttribute('aria-hidden', 'false');
  _emojiTrayOpen = true;
  document.getElementById('page-chat')?.classList.add('emoji-tray-open');
  document.getElementById('dm-emoji-btn')?.classList.add('active');
  // Scroll messages so last stays visible above input+tray
  const msgs = document.getElementById('chat-messages');
  if (msgs) {
    requestAnimationFrame(function() {
      msgs.scrollTop = msgs.scrollHeight;
    });
  }
}

function closeChatEmojiTray() {
  const tray = _emojiTrayEl();
  if (tray) {
    tray.classList.remove('open');
    tray.setAttribute('aria-hidden', 'true');
  }
  _emojiTrayOpen = false;
  document.getElementById('page-chat')?.classList.remove('emoji-tray-open');
  document.getElementById('dm-emoji-btn')?.classList.remove('active');
}

function toggleChatEmojiTray() {
  if (_emojiTrayOpen) closeChatEmojiTray();
  else openChatEmojiTray();
}

/** Public API used by emoji button — replaces old floating sticker picker for DM */
function openStickerPicker(target) {
  _stickerPickerTarget = target || 'dm';
  if (target && target !== 'dm') {
    // comments / other: fall back to simple tray toggle still
  }
  toggleChatEmojiTray();
}

function closeStickerPicker() {
  closeChatEmojiTray();
}

// When user focuses the text field, close emoji tray (keyboard takes over)
document.addEventListener('focusin', function(e) {
  if (e.target && e.target.id === 'chat-input-field') {
    closeChatEmojiTray();
  }
});

document.addEventListener('DOMContentLoaded', function() {
  try { rebuildChatComposer(true); } catch (e) {}
});
