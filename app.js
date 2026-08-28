(() => {
  'use strict';

  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => [...root.querySelectorAll(s)];
  const toastEl = $('#toast');
  let toastTimer;
  const toast = (msg) => {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
  };

  // Supabase client
  let sb = null;
  try {
    if (!window.supabase || !window.SUPABASE_URL || !window.SUPABASE_PUBLISHABLE_KEY) {
      throw new Error('Supabase 설정을 불러오지 못했습니다.');
    }
    sb = window.supabase.createClient(
      window.SUPABASE_URL,
      window.SUPABASE_PUBLISHABLE_KEY,
      { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
    );
  } catch (e) {
    console.error(e);
  }

  const state = {
    user: null,
    member: null,
    organization: null,
    event: null,
    people: [],
    filter: 'all',
    search: '',
    channel: null
  };

  let recoveryActive = false;

  function ensureLoginUI() {
    if ($('#authGate')) return;
    const gate = document.createElement('div');
    gate.id = 'authGate';
    gate.innerHTML = `
      <div class="auth-card">
        <img src="icons/apple-touch-icon.png" class="auth-icon" alt="">
        <h2>관리자 로그인</h2>
        <p>QR 자동 출석부 관리자 계정으로 로그인하세요.</p>
        <form id="loginForm">
          <label>이메일<input id="loginEmail" type="email" autocomplete="username" required></label>
          <label>비밀번호<input id="loginPassword" type="password" autocomplete="current-password" required></label>
          <button class="primary-button" type="submit" id="loginButton">로그인</button>
        </form>
        <button class="auth-link-button" type="button" id="forgotPasswordButton">비밀번호를 잊으셨나요?</button>
        <div class="auth-message" id="authMessage"></div>
      </div>`;
    document.body.appendChild(gate);

    const recovery = document.createElement('div');
    recovery.id = 'recoveryGate';
    recovery.hidden = true;
    recovery.innerHTML = `
      <div class="auth-card">
        <img src="icons/apple-touch-icon.png" class="auth-icon" alt="">
        <h2>새 비밀번호 설정</h2>
        <p>새로 사용할 관리자 비밀번호를 입력하세요.</p>
        <form id="recoveryForm">
          <label>새 비밀번호<input id="newPassword" type="password" autocomplete="new-password" minlength="6" required></label>
          <label>비밀번호 확인<input id="newPasswordConfirm" type="password" autocomplete="new-password" minlength="6" required></label>
          <button class="primary-button" type="submit" id="recoveryButton">비밀번호 변경</button>
        </form>
        <div class="auth-message" id="recoveryMessage"></div>
      </div>`;
    document.body.appendChild(recovery);

    const style = document.createElement('style');
    style.textContent = `
      #authGate,#recoveryGate{position:fixed;inset:0;z-index:999;background:linear-gradient(180deg,#fff,#f2fbf9);display:grid;place-items:center;padding:24px}
      #authGate[hidden],#recoveryGate[hidden]{display:none}
      .auth-card{width:min(100%,420px);background:#fff;border:1px solid #e8edef;border-radius:28px;padding:28px 22px;box-shadow:0 18px 55px rgba(21,44,52,.12);text-align:center}
      .auth-icon{width:78px;height:78px;border-radius:22px;box-shadow:0 8px 22px rgba(12,142,129,.16)}
      .auth-card h2{font-size:26px;margin:18px 0 7px}.auth-card>p{color:#7b8590;font-size:14px;margin:0 0 22px}
      .auth-card label{display:block;text-align:left;font-size:13px;font-weight:800;margin:14px 0}
      .auth-card input{display:block;width:100%;height:50px;border:1px solid #e3e9eb;border-radius:15px;margin-top:7px;padding:0 14px;font-size:16px;outline:none;box-sizing:border-box}
      .auth-message{min-height:20px;margin-top:12px;font-size:13px;color:#e44c51}
      .auth-link-button{border:0;background:transparent;color:#168f84;font-size:14px;font-weight:800;padding:15px 8px 2px;cursor:pointer}
      .logout-button{width:100%;min-height:48px;border:1px solid #ffd7d9;background:#fff6f6;color:#e44c51;border-radius:15px;font-weight:800;margin-top:10px}
      .empty-state{padding:24px 16px;text-align:center;color:#7b8590;background:#fff;border:1px solid #e8edef;border-radius:19px}
    `;
    document.head.appendChild(style);

    $('#loginForm').addEventListener('submit', login);
    $('#forgotPasswordButton').addEventListener('click', requestPasswordReset);
    $('#recoveryForm').addEventListener('submit', updateRecoveredPassword);
  }

  async function login(e) {
    e.preventDefault();
    if (!sb) return;
    const button = $('#loginButton');
    const message = $('#authMessage');
    button.disabled = true; button.textContent = '로그인 중…'; message.textContent = '';
    const email = $('#loginEmail').value.trim();
    const password = $('#loginPassword').value;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      message.textContent = '이메일 또는 비밀번호를 확인해주세요.';
      button.disabled = false; button.textContent = '로그인';
      return;
    }
    button.disabled = false; button.textContent = '로그인';
  }

  async function requestPasswordReset() {
    if (!sb) return;
    const emailInput = $('#loginEmail');
    const message = $('#authMessage');
    const email = emailInput?.value.trim() || '';
    if (!email) {
      message.textContent = '먼저 이메일을 입력해주세요.';
      emailInput?.focus();
      return;
    }

    const button = $('#forgotPasswordButton');
    button.disabled = true;
    button.textContent = '복구 메일 보내는 중…';
    message.textContent = '';

    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });

    button.disabled = false;
    button.textContent = '비밀번호를 잊으셨나요?';

    if (error) {
      console.error(error);
      if ((error.message || '').toLowerCase().includes('rate limit')) {
        message.textContent = '복구 메일 요청이 많습니다. 잠시 후 다시 시도해주세요.';
      } else {
        message.textContent = '복구 메일 발송에 실패했습니다. 이메일을 확인해주세요.';
      }
      return;
    }

    message.style.color = '#168f84';
    message.textContent = '비밀번호 복구 메일을 보냈습니다. 메일함을 확인해주세요.';
  }

  function showRecoveryUI() {
    recoveryActive = true;
    if ($('#authGate')) $('#authGate').hidden = true;
    if ($('#recoveryGate')) $('#recoveryGate').hidden = false;
    setTimeout(() => $('#newPassword')?.focus(), 100);
  }

  async function updateRecoveredPassword(e) {
    e.preventDefault();
    if (!sb) return;
    const password = $('#newPassword').value;
    const confirm = $('#newPasswordConfirm').value;
    const message = $('#recoveryMessage');
    const button = $('#recoveryButton');

    message.style.color = '#e44c51';
    message.textContent = '';

    if (password.length < 6) {
      message.textContent = '비밀번호는 6자 이상으로 입력해주세요.';
      return;
    }
    if (password !== confirm) {
      message.textContent = '두 비밀번호가 일치하지 않습니다.';
      return;
    }

    button.disabled = true;
    button.textContent = '변경 중…';
    const { error } = await sb.auth.updateUser({ password });
    if (error) {
      console.error(error);
      message.textContent = '비밀번호 변경에 실패했습니다. 복구 링크를 다시 확인해주세요.';
      button.disabled = false;
      button.textContent = '비밀번호 변경';
      return;
    }

    message.style.color = '#168f84';
    message.textContent = '비밀번호가 변경되었습니다. 새 비밀번호로 로그인해주세요.';
    button.textContent = '변경 완료';

    await sb.auth.signOut();
    recoveryActive = false;
    $('#recoveryGate').hidden = true;
    $('#authGate').hidden = false;
    $('#loginPassword').value = '';
    const loginMessage = $('#authMessage');
    loginMessage.style.color = '#168f84';
    loginMessage.textContent = '비밀번호 변경 완료. 새 비밀번호로 로그인해주세요.';
  }

  async function logout() {
    if (sb) await sb.auth.signOut();
  }

  async function onSession(session) {
    state.user = session?.user || null;
    if (!state.user) {
      if (!recoveryActive) $('#authGate').hidden = false;
      return;
    }
    if (recoveryActive) return;
    $('#authGate').hidden = true;
    await loadWorkspace();
  }

  async function loadWorkspace() {
    try {
      const { data: member, error: memberError } = await sb
        .from('organization_members')
        .select('organization_id, role, display_name')
        .eq('user_id', state.user.id)
        .limit(1)
        .single();
      if (memberError) throw memberError;
      state.member = member;

      const { data: org, error: orgError } = await sb
        .from('organizations')
        .select('id, name')
        .eq('id', member.organization_id)
        .single();
      if (orgError) throw orgError;
      state.organization = org;

      setHeaderIdentity();
      installLogout();
      await loadLatestEvent();
      await loadPeople();
      subscribeRealtime();
      renderAll();
    } catch (e) {
      console.error(e);
      toast('관리자 데이터 연결을 확인해주세요.');
    }
  }

  function setHeaderIdentity() {
    const welcome = $('.welcome-card strong');
    if (welcome) welcome.textContent = `안녕하세요, ${state.member?.display_name || '관리자'}님!`;
    if ($('#orgInput')) $('#orgInput').value = state.organization?.name || '';
    if ($('#managerInput')) $('#managerInput').value = state.member?.display_name || '';
  }

  function installLogout() {
    if ($('#logoutButton')) return;
    const settingsCard = $('[data-screen="settings"] .form-card');
    if (!settingsCard) return;
    const b = document.createElement('button');
    b.id = 'logoutButton';
    b.className = 'logout-button';
    b.type = 'button';
    b.textContent = '로그아웃';
    b.addEventListener('click', logout);
    settingsCard.appendChild(b);
  }

  async function loadLatestEvent() {
    const { data, error } = await sb.from('events')
      .select('id,title,event_date,location,status,starts_at,ends_at')
      .eq('organization_id', state.member.organization_id)
      .order('event_date', { ascending:false })
      .order('created_at', { ascending:false })
      .limit(1);
    if (error) throw error;
    state.event = data?.[0] || null;
  }

  async function loadPeople() {
    if (!state.event) { state.people = []; return; }
    const { data, error } = await sb.from('event_participants')
      .select('id,participant_id,travel_mode,attendance_status,checked_at,arrived_at,participants(id,name,affiliation,phone_last4)')
      .eq('event_id', state.event.id)
      .order('created_at', { ascending:true });
    if (error) throw error;
    state.people = (data || []).map(row => ({
      linkId: row.id,
      participantId: row.participant_id,
      name: row.participants?.name || '이름 없음',
      org: row.participants?.affiliation || '',
      phone: row.participants?.phone_last4 || '',
      status: row.travel_mode === 'individual' ? 'individual' :
              row.attendance_status === 'present' ? 'present' : 'unknown',
      checkedAt: row.checked_at
    }));
  }

  function eventLabel() {
    if (!state.event) return '등록된 행사가 없습니다';
    const d = state.event.event_date || '';
    return `${d.replaceAll('-','.')} · ${state.event.title}`;
  }

  function renderAll() {
    if ($('#eventTitle')) $('#eventTitle').textContent = eventLabel();
    $$('.eyebrow').forEach((el) => {
      if (el.textContent === '오늘 행사' && state.event) el.textContent = state.event.event_date || '행사';
    });
    const eventStatus = $('.event-status');
    if (eventStatus) eventStatus.textContent = state.event ? statusLabel(state.event.status) : '행사 없음';
    renderStats(); renderPeople(); renderStatus();
  }

  function statusLabel(s) {
    return ({draft:'진행 전',active:'진행 중',ended:'종료'})[s] || s || '진행 전';
  }

  function renderStats() {
    const total = state.people.length;
    const present = state.people.filter(p=>p.status==='present').length;
    const individual = state.people.filter(p=>p.status==='individual').length;
    const unknown = total-present-individual;
    if ($('#statTotal')) $('#statTotal').textContent = total;
    if ($('#statPresent')) $('#statPresent').textContent = present;
    if ($('#statIndividual')) $('#statIndividual').textContent = individual;
    if ($('#statUnknown')) $('#statUnknown').textContent = unknown;
    const denominator = Math.max(1, total-individual);
    const rate = total ? Math.round(present/denominator*100) : 0;
    if ($('#rateText')) $('#rateText').textContent = `${rate}%`;
    if ($('#progressBar')) $('#progressBar').style.width = `${rate}%`;
  }

  function filteredPeople() {
    const q = state.search.toLowerCase();
    return state.people.filter(p => {
      const filterOk = state.filter === 'all' || p.status === state.filter;
      const searchOk = !q || `${p.name} ${p.org} ${p.phone}`.toLowerCase().includes(q);
      return filterOk && searchOk;
    });
  }

  function renderPeople() {
    const list = $('#peopleList');
    if (!list) return;
    const rows = filteredPeople();
    if (!state.event) { list.innerHTML = '<div class="empty-state">먼저 행사를 등록해주세요.</div>'; return; }
    if (!rows.length) { list.innerHTML = '<div class="empty-state">등록된 참가자가 없습니다.</div>'; return; }
    list.innerHTML = rows.map(p => `
      <div class="person-card">
        <div class="avatar">${escapeHtml(p.name.slice(0,1))}</div>
        <div class="person-main"><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.org || '소속 없음')}${p.phone ? ` · •••• ${escapeHtml(p.phone)}` : ''}</small></div>
        <button class="status-button ${p.status}" data-person="${p.linkId}">${labelFor(p.status)}</button>
      </div>`).join('');
    $$('[data-person]', list).forEach(b => b.addEventListener('click', () => cycleStatus(b.dataset.person)));
  }

  function renderStatus() {
    const list = $('#statusList');
    if (!list) return;
    if (!state.people.length) { list.innerHTML = '<div class="empty-state">출석 기록이 없습니다.</div>'; return; }
    list.innerHTML = state.people.map(p => `
      <div class="status-row">
        <div><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.org || '소속 없음')}</small></div>
        <span class="badge ${p.status}">${labelFor(p.status)}</span>
      </div>`).join('');
  }

  const labelFor = s => ({present:'출석',individual:'개인출발',unknown:'미확인'})[s] || '미확인';

  async function cycleStatus(linkId) {
    const p = state.people.find(x=>x.linkId===linkId);
    if (!p || !state.event) return;
    const next = p.status === 'unknown' ? 'present' : p.status === 'present' ? 'individual' : 'unknown';
    const patch = next === 'individual'
      ? { travel_mode:'individual', attendance_status:'unconfirmed', checked_at:null, check_source:'manual' }
      : next === 'present'
        ? { travel_mode:'bus', attendance_status:'present', checked_at:new Date().toISOString(), check_source:'manual' }
        : { travel_mode:'bus', attendance_status:'unconfirmed', checked_at:null, check_source:'manual' };

    const { error } = await sb.from('event_participants').update(patch).eq('id', linkId);
    if (error) { console.error(error); toast('상태 변경에 실패했습니다.'); return; }

    await sb.from('attendance_logs').insert({
      event_id: state.event.id, participant_id:p.participantId,
      action: next, source:'manual', actor_user_id:state.user.id
    });
    await loadPeople(); renderAll();
    toast(`${p.name} · ${labelFor(next)}`);
  }

  async function addPerson(e) {
    e.preventDefault();
    if (!state.event) { toast('먼저 행사를 등록해야 합니다.'); return; }
    const name = $('#personName').value.trim();
    const affiliation = $('#personOrg').value.trim();
    const phone_last4 = $('#personPhone').value.trim();
    if (!name) return;

    const { data: participant, error } = await sb.from('participants')
      .insert({ organization_id:state.member.organization_id, name, affiliation, phone_last4 })
      .select('id').single();
    if (error) { console.error(error); toast('참가자 등록에 실패했습니다.'); return; }

    const { error: linkError } = await sb.from('event_participants')
      .insert({ event_id:state.event.id, participant_id:participant.id });
    if (linkError) { console.error(linkError); toast('행사 명단 연결에 실패했습니다.'); return; }

    $('#personDialog').close();
    $('#personForm').reset();
    await loadPeople(); renderAll(); toast(`${name} 등록 완료`);
  }

  function subscribeRealtime() {
    if (state.channel) sb.removeChannel(state.channel);
    if (!state.event) return;
    state.channel = sb.channel(`event-${state.event.id}`)
      .on('postgres_changes',
        {event:'*',schema:'public',table:'event_participants',filter:`event_id=eq.${state.event.id}`},
        async () => { await loadPeople(); renderAll(); })
      .subscribe();
  }

  function wireUI() {
    $$('[data-go]').forEach(btn => btn.addEventListener('click', () => go(btn.dataset.go)));
    $$('.chip').forEach(btn => btn.addEventListener('click', () => {
      state.filter = btn.dataset.filter;
      $$('.chip').forEach(x=>x.classList.toggle('active', x===btn));
      renderPeople();
    }));
    $('#searchInput')?.addEventListener('input', e => { state.search=e.target.value.trim(); renderPeople(); });
    $('#addPersonButton')?.addEventListener('click', () => $('#personDialog')?.showModal());
    $('#personForm')?.addEventListener('submit', addPerson);
    $('#manualButton')?.addEventListener('click', () => go('roster'));
    $('#saveSettings')?.addEventListener('click', () => toast('설정 저장 완료'));
    $('#notificationButton')?.addEventListener('click', () => toast('실시간 출석 알림 연결 준비 완료'));
    $('#ocrButton')?.addEventListener('click', () => toast('OCR 명단 등록은 다음 단계에서 연결합니다.'));
    $('#sheetButton')?.addEventListener('click', () => toast('Excel · Numbers · Sheets 연결은 다음 단계입니다.'));
    $('#proxyButton')?.addEventListener('click', () => toast('대리 QR은 행사 QR 기능과 함께 연결합니다.'));
    $('#demoShare')?.addEventListener('click', () => toast('대리 QR 공유는 다음 단계에서 활성화합니다.'));
    $('#demoStart')?.addEventListener('click', () => toast(state.event ? '실제 행사 QR 생성은 다음 단계입니다.' : '먼저 행사를 등록해주세요.'));
  }

  function go(screen) {
    $$('.screen').forEach(x=>x.classList.toggle('active', x.dataset.screen===screen));
    $$('.tab').forEach(x=>x.classList.toggle('active', x.dataset.go===screen));
    window.scrollTo({top:0,behavior:'smooth'});
  }

  function escapeHtml(v='') {
    return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  async function init() {
    ensureLoginUI();
    wireUI();
    if (!sb) {
      $('#authMessage').textContent = 'Supabase 연결 설정을 확인해주세요.';
      return;
    }

    // PASSWORD_RECOVERY 이벤트를 먼저 듣고 새 비밀번호 화면으로 전환한다.
    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        showRecoveryUI();
        return;
      }
      setTimeout(() => onSession(session), 0);
    });

    const { data } = await sb.auth.getSession();
    await onSession(data.session);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js').catch(console.error);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
