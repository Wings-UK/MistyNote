
// ── Rebuild chat composer to Snap-style bar (MP · input · voice · emoji · gallery) ──
function rebuildChatComposer() {
  const bar = document.getElementById('chat-input-bar');
  if (!bar || bar.dataset.composerV2 === '1') return;
  bar.dataset.composerV2 = '1';

  const tray = document.getElementById('chat-extras-tray');
  if (tray) tray.style.display = 'none';

  const row = bar.querySelector('.chat-input-bar-row');
  if (!row) return;

  row.innerHTML = [
    '<button type="button" class="chat-mp-fab" id="chat-mp-fab" onclick="chatSendMP()" aria-label="Send MP">',
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">',
    '<path d="M12 2v20M7 7h7.5a3.5 3.5 0 010 7H9a3.5 3.5 0 000 7h8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
    '</svg></button>',
    '<div class="chat-input-wrap" id="chat-input-wrap">',
    '<textarea id="chat-input-field" class="chat-input-field" placeholder="Send a chat" rows="1" ',
    'oninput="chatInputResize(this);if(typeof syncChatSendBtn===\'function\')syncChatSendBtn();" ',
    'onkeydown="chatInputKeydown(event)"></textarea>',
    '<button type="button" class="chat-voice-btn" id="chat-voice-btn" onclick="chatRecordVoice()" aria-label="Voice note">',
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">',
    '<rect x="4" y="8" width="2.2" height="8" rx="1.1" fill="currentColor"/>',
    '<rect x="8.5" y="5" width="2.2" height="14" rx="1.1" fill="currentColor"/>',
    '<rect x="13" y="7" width="2.2" height="10" rx="1.1" fill="currentColor"/>',
    '<rect x="17.5" y="9" width="2.2" height="6" rx="1.1" fill="currentColor"/>',
    '</svg></button></div>',
    '<button type="button" class="chat-side-btn" id="dm-emoji-btn" onclick="openStickerPicker(\'dm\')" aria-label="Emoji">',
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">',
    '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/>',
    '</svg></button>',
    '<button type="button" class="chat-side-btn" id="chat-gallery-btn" onclick="document.getElementById(\'chat-media-input\').click()" aria-label="Gallery">',
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">',
    '<rect x="3" y="5" width="14" height="14" rx="2"/><path d="M7 19h12a2 2 0 002-2V7"/>',
    '<circle cx="9" cy="10" r="1.5" fill="currentColor" stroke="none"/><path d="M7 15l3-3 2 2 3-4 3 5"/>',
    '</svg></button>',
    '<input type="file" id="chat-media-input" accept="image/*,video/*" style="display:none" onchange="chatImageSelected(this)">',
    '<button type="button" class="chat-send-btn" id="chat-send-btn" onclick="chatSend()" aria-label="Send">',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    '</button>'
  ].join('');

  const input = document.getElementById('chat-input-field');
  if (input) {
    input._typingWired = false;
    if (typeof wireChatTyping === 'function') wireChatTyping();
  }
  if (typeof syncChatSendBtn === 'function') syncChatSendBtn();
}

function syncChatSendBtn() {
  const input = document.getElementById('chat-input-field');
  const btn = document.getElementById('chat-send-btn');
  if (!btn) return;
  const has = !!(input && input.value.trim()) || !!window.chatPendingImage;
  btn.classList.toggle('ready', has);
  btn.classList.toggle('chat-send-visible', has);
}


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
  try { rebuildChatComposer(); } catch (e) {}
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

  if (type === 'image' || (msg.media_url && type !== 'text')) {
    bubble.className = 'chat-bubble img-bubble';
    const imgSrc = msg.media_url || content;
    bubble.innerHTML = `${replyQuoteHtml}<img class="chat-bubble-img" src="${escHtml(imgSrc)}" alt="photo" loading="lazy">`;
  } else if (type === 'gift' || type === 'mp_gift') {
    bubble.className = 'chat-bubble';
    bubble.innerHTML = `${replyQuoteHtml}🎁 ${escHtml(content || 'Sent MistyPoints')}`;
  } else if (type === 'voice' || type === 'audio') {
    const vb = buildVoiceBubble(msg, isSent, timeStr);
    // buildVoiceBubble returns a chat-bubble already
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
    return row;
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
  const waveId = 'wv-' + id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
  const dur = Number(msg.media_duration || 0);
  const durStr = _voiceFmt ? _voiceFmt(dur) : (dur < 60 ? '0:' + String(dur).padStart(2, '0') : Math.floor(dur / 60) + ':' + String(dur % 60).padStart(2, '0'));
  const url = msg.media_url || '';
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble chat-bubble-voice';
  if (url) bubble.setAttribute('data-voice-url', url);
  bubble.innerHTML =
    '<div class="chat-voice-bubble">' +
      '<button type="button" class="chat-voice-play" data-src="' + (url || '').replace(/"/g, '') + '" onclick="chatPlayVoice(this,\'' + waveId + '\')">' +
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg>' +
      '</button>' +
      '<div class="chat-voice-waveform" id="' + waveId + '"></div>' +
      '<span class="chat-voice-dur">' + durStr + '</span>' +
    '</div>';
  setTimeout(function() {
    const wv = document.getElementById(waveId);
    if (!wv) return;
    const heights = [4, 8, 14, 10, 18, 12, 22, 16, 20, 14, 8, 18, 24, 16, 12, 20, 10, 16, 8, 12];
    wv.innerHTML = heights.map(function(h) {
      return '<div class="chat-voice-bar" style="height:' + h + 'px"></div>';
    }).join('');
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

async function chatSend(opts) {
  opts = opts || {};
  const field = document.getElementById('chat-input-field');
  const text  = field?.value?.trim();
  const hasImage = !!chatPendingImage;
  if (!text && !hasImage) return;
  if (!activeChatId || !currentUser) return;
  const isBigEmoji = !hasImage && (opts.forceEmoji || isSingleEmojiOnly(text));
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
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatSend();
  }
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

// ── Voice notes ────────────────────────────────────────────
let _voiceRec = {
  recording: false,
  mediaRecorder: null,
  chunks: [],
  stream: null,
  startedAt: 0,
  timer: null,
};
let _voiceAudio = null; // currently playing Audio element

function _voiceFmt(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function _voiceSetBtnRecording(on) {
  const btn = document.getElementById('chat-voice-btn');
  if (!btn) return;
  btn.classList.toggle('recording', !!on);
  if (on) {
    btn.setAttribute('aria-label', 'Stop recording');
  } else {
    btn.setAttribute('aria-label', 'Voice note');
  }
}

async function chatRecordVoice() {
  if (!activeChatId || !currentUser) {
    showToast('Open a chat first');
    return;
  }
  // Toggle: if already recording → stop & send
  if (_voiceRec.recording) {
    _voiceStopAndSend();
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast('Voice notes not supported on this browser');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    _voiceRec.stream = stream;
    _voiceRec.chunks = [];
    let mime = '';
    if (window.MediaRecorder) {
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mime = 'audio/webm;codecs=opus';
      else if (MediaRecorder.isTypeSupported('audio/webm')) mime = 'audio/webm';
      else if (MediaRecorder.isTypeSupported('audio/mp4')) mime = 'audio/mp4';
    }
    const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    _voiceRec.mediaRecorder = mr;
    _voiceRec.startedAt = Date.now();
    mr.ondataavailable = function(e) {
      if (e.data && e.data.size > 0) _voiceRec.chunks.push(e.data);
    };
    mr.onstop = function() {
      // handled in _voiceStopAndSend after stop
    };
    mr.start(250);
    _voiceRec.recording = true;
    _voiceSetBtnRecording(true);
    showToast('Recording… tap again to send');
    // Auto-stop at 60s
    clearTimeout(_voiceRec.timer);
    _voiceRec.timer = setTimeout(function() {
      if (_voiceRec.recording) _voiceStopAndSend();
    }, 60000);
  } catch (err) {
    console.warn('mic error', err);
    showToast('Microphone permission needed');
    _voiceCleanupStream();
  }
}

function _voiceCleanupStream() {
  try {
    (_voiceRec.stream && _voiceRec.stream.getTracks() || []).forEach(function(t) { t.stop(); });
  } catch (e) {}
  _voiceRec.stream = null;
  _voiceRec.mediaRecorder = null;
  _voiceRec.recording = false;
  clearTimeout(_voiceRec.timer);
  _voiceSetBtnRecording(false);
}

async function _voiceStopAndSend() {
  if (!_voiceRec.mediaRecorder) {
    _voiceCleanupStream();
    return;
  }
  const mr = _voiceRec.mediaRecorder;
  const durationSec = Math.max(1, Math.round((Date.now() - _voiceRec.startedAt) / 1000));
  const blob = await new Promise(function(resolve) {
    mr.onstop = function() {
      const type = mr.mimeType || 'audio/webm';
      resolve(new Blob(_voiceRec.chunks, { type: type }));
    };
    try { mr.stop(); } catch (e) { resolve(new Blob(_voiceRec.chunks, { type: 'audio/webm' })); }
  });
  _voiceCleanupStream();

  if (!blob || blob.size < 100) {
    showToast('Recording too short');
    return;
  }
  if (durationSec < 1) {
    showToast('Hold a bit longer');
    return;
  }

  const ext = (blob.type || '').indexOf('mp4') >= 0 ? 'm4a' : 'webm';
  const localUrl = URL.createObjectURL(blob);

  // Optimistic UI
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
    media_url: localUrl,
    media_duration: durationSec,
    sender_id: currentUser.id,
    created_at: new Date().toISOString(),
    sender: currentProfile,
  };
  const el = buildMessageEl(tmpMsg, lastSenderId);
  if (el && msgsEl) {
    msgsEl.appendChild(el);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }
  if (typeof updateInboxRow === 'function') {
    updateInboxRow(activeChatId, '🎙 Voice note', tmpMsg.created_at);
  }

  // Upload
  showToast('Sending voice…');
  const path = 'chat/' + activeChatId + '/' + currentUser.id + '-voice-' + Date.now() + '.' + ext;
  let publicUrl = null;
  try {
    const { data: uploadData, error: uploadErr } = await supabase.storage
      .from('media')
      .upload(path, blob, { contentType: blob.type || 'audio/webm', upsert: false });
    if (uploadErr) throw uploadErr;
    const { data: urlData } = supabase.storage.from('media').getPublicUrl(path);
    publicUrl = urlData && urlData.publicUrl;
  } catch (upErr) {
    console.warn('voice upload', upErr);
    // Try R2 worker if present (same as images)
    try {
      if (typeof uploadToR2 === 'function') {
        publicUrl = await uploadToR2(blob, path);
      }
    } catch (e2) {}
  }

  if (!publicUrl) {
    showToast('Voice upload failed');
    el && el.remove();
    return;
  }

  const { error: insertErr } = await supabase.from('messages').insert({
    conversation_id: activeChatId,
    sender_id: currentUser.id,
    type: 'voice',
    media_url: publicUrl,
    media_duration: durationSec,
    content: '',
  });
  if (insertErr) {
    console.warn(insertErr);
    showToast('Could not send voice note');
    el && el.remove();
    return;
  }
  // Point optimistic bubble at permanent URL
  const playBtn = el && el.querySelector('.chat-voice-play');
  if (playBtn) playBtn.dataset.src = publicUrl;
  if (el) el.dataset.mediaUrl = publicUrl;
  markConvRead(activeChatId);
  showToast('Voice sent');
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
  const row = btn.closest('.chat-msg-row');
  const src = btn.dataset.src
    || row?.dataset?.mediaUrl
    || row?.querySelector('.chat-bubble')?.dataset?.mediaUrl
    || btn.getAttribute('data-src');
  // Resolve media_url from nearest bubble dataset set at build time
  let url = src;
  if (!url && row) {
    const b = row.querySelector('[data-voice-url]');
    if (b) url = b.getAttribute('data-voice-url');
  }
  if (!url) {
    // last resort: find from buildVoiceBubble data attribute on bubble
    const bubble = btn.closest('.chat-bubble');
    url = bubble && bubble.getAttribute('data-voice-url');
  }
  if (!url) {
    showToast('Audio unavailable');
    return;
  }

  // Stop previous
  if (_voiceAudio) {
    try { _voiceAudio.pause(); } catch (e) {}
    _voiceAudio = null;
  }

  const bars = document.getElementById(waveId)?.querySelectorAll('.chat-voice-bar');
  const playIcon = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg>';
  const pauseIcon = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/></svg>';

  const audio = new Audio(url);
  _voiceAudio = audio;
  btn.innerHTML = pauseIcon;
  if (bars) bars.forEach(function(b) { b.classList.remove('played'); });

  audio.play().catch(function() {
    showToast('Could not play');
    btn.innerHTML = playIcon;
  });

  audio.ontimeupdate = function() {
    if (!bars || !bars.length || !audio.duration) return;
    const n = Math.floor((audio.currentTime / audio.duration) * bars.length);
    bars.forEach(function(b, i) {
      b.classList.toggle('played', i < n);
    });
  };
  audio.onended = function() {
    btn.innerHTML = playIcon;
    if (bars) bars.forEach(function(b) { b.classList.remove('played'); });
    if (_voiceAudio === audio) _voiceAudio = null;
  };
  // Tap again to pause
  btn.onclick = function(ev) {
    ev.stopPropagation();
    if (_voiceAudio === audio && !audio.paused) {
      audio.pause();
      btn.innerHTML = playIcon;
      _voiceAudio = null;
      btn.onclick = function(e) {
        e.stopPropagation();
        chatPlayVoice(btn, waveId);
      };
      return;
    }
    chatPlayVoice(btn, waveId);
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


// ── Emoji / sticker picker (DM + comments) ─────────────────
let _stickerPickerTarget = 'dm';
function openStickerPicker(target) {
  _stickerPickerTarget = target || 'dm';

  // Backdrop — tap outside closes
  let backdrop = document.getElementById('sticker-picker-backdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'sticker-picker-backdrop';
    backdrop.className = 'sticker-picker-backdrop';
    backdrop.addEventListener('click', function() { closeStickerPicker(); });
    document.body.appendChild(backdrop);
  }
  backdrop.classList.add('open');

  let panel = document.getElementById('sticker-picker');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'sticker-picker';
    panel.className = 'sticker-picker';
    panel.innerHTML =
      '<div class="sticker-picker-head">' +
        '<span class="sticker-picker-title">Emoji</span>' +
        '<button type="button" class="sticker-picker-close" onclick="closeStickerPicker()" aria-label="Close">×</button>' +
      '</div>' +
      '<div class="sticker-picker-body"><div class="emoji-grid" id="sp-emoji-grid"></div></div>';
    // stop clicks inside panel from hitting backdrop
    panel.addEventListener('click', function(e) { e.stopPropagation(); });
    document.body.appendChild(panel);
  }
  const grid = document.getElementById('sp-emoji-grid');
  if (grid && !grid.dataset.filled) {
    const emojis = ['😀','😂','🥰','😍','😎','😭','🔥','❤️','💯','👍','🙏','👏','🎉','😮','😢','💪','🤝','✨','🫂','💋','🥺','😤','🤔','👀','💬','🇳🇬','⚽','🎵','🍕','☕','🙌','😊','😘','🤩','😴','😡'];
    grid.innerHTML = emojis.map(function(e) {
      return '<button type="button" class="sp-emoji-btn" data-emoji="' + e + '">' + e + '</button>';
    }).join('');
    grid.dataset.filled = '1';
    grid.addEventListener('click', function(ev) {
      const btn = ev.target.closest('.sp-emoji-btn');
      if (!btn) return;
      const em = btn.dataset.emoji;
      closeStickerPicker();
      if (_stickerPickerTarget === 'dm') chatPickEmoji(em);
    });
  }
  panel.classList.remove('hidden');
  panel.classList.add('open');
  panel.style.display = 'flex';

  if (!window._stickerEscWired) {
    window._stickerEscWired = true;
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeStickerPicker();
    });
  }
}
function closeStickerPicker() {
  const panel = document.getElementById('sticker-picker');
  if (panel) {
    panel.classList.add('hidden');
    panel.classList.remove('open');
    panel.style.display = 'none';
  }
  const backdrop = document.getElementById('sticker-picker-backdrop');
  if (backdrop) backdrop.classList.remove('open');
}

document.addEventListener('DOMContentLoaded', function() {
  try { rebuildChatComposer(); } catch (e) {}
});
