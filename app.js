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
    channel: null,
    qrToken: null
  };

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
          <label>이메일
            <input id="loginEmail" type="email" autocomplete="username" required>
          </label>
          <label>비밀번호
            <input id="loginPassword" type="password" autocomplete="current-password" required>
          </label>
          <button class="primary-button" type="submit" id="loginButton">로그인</button>
        </form>

        <button id="forgotPasswordButton" class="forgot-button" type="button">비밀번호를 잊으셨나요?</button>
        <div class="auth-message" id="authMessage"></div>
      </div>`;
    document.body.appendChild(gate);

    const recovery = document.createElement('div');
    recovery.id = 'passwordRecoveryGate';
    recovery.hidden = true;
    recovery.innerHTML = `
      <div class="auth-card">
        <img src="icons/apple-touch-icon.png" class="auth-icon" alt="">
        <h2>새 비밀번호 설정</h2>
        <p>관리자 계정에서 사용할 새 비밀번호를 입력하세요.</p>

        <form id="recoveryForm">
          <label>새 비밀번호
            <input id="newPassword" type="password" autocomplete="new-password" minlength="8" required>
          </label>
          <label>새 비밀번호 확인
            <input id="newPasswordConfirm" type="password" autocomplete="new-password" minlength="8" required>
          </label>
          <button class="primary-button" type="submit" id="recoveryButton">비밀번호 변경</button>
        </form>

        <div class="auth-message" id="recoveryMessage"></div>
      </div>`;
    document.body.appendChild(recovery);

    const style = document.createElement('style');
    style.textContent = `
      #authGate,#passwordRecoveryGate{
        position:fixed;inset:0;z-index:9999;
        background:linear-gradient(180deg,#fff,#f2fbf9);
        display:grid;place-items:center;padding:24px
      }
      #authGate[hidden],#passwordRecoveryGate[hidden]{display:none}
      .auth-card{
        width:min(100%,420px);background:#fff;border:1px solid #e8edef;
        border-radius:28px;padding:28px 22px;
        box-shadow:0 18px 55px rgba(21,44,52,.12);text-align:center
      }
      .auth-icon{width:78px;height:78px;border-radius:22px;box-shadow:0 8px 22px rgba(12,142,129,.16)}
      .auth-card h2{font-size:26px;margin:18px 0 7px}
      .auth-card>p{color:#7b8590;font-size:14px;margin:0 0 22px}
      .auth-card label{display:block;text-align:left;font-size:13px;font-weight:800;margin:14px 0}
      .auth-card input{
        box-sizing:border-box;display:block;width:100%;height:50px;border:1px solid #e3e9eb;
        border-radius:15px;margin-top:7px;padding:0 14px;font-size:16px;outline:none
      }
      .auth-message{min-height:20px;margin-top:12px;font-size:13px;color:#e44c51}
      .forgot-button{
        border:0;background:transparent;color:#169f94;font-weight:800;font-size:14px;
        margin-top:14px;padding:8px 12px
      }
      .logout-button{
        width:100%;min-height:48px;border:1px solid #ffd7d9;background:#fff6f6;color:#e44c51;
        border-radius:15px;font-weight:800;margin-top:10px
      }
      .empty-state{padding:24px 16px;text-align:center;color:#7b8590;background:#fff;border:1px solid #e8edef;border-radius:19px}
    `;
    document.head.appendChild(style);

    $('#loginForm').addEventListener('submit', login);
    $('#forgotPasswordButton').addEventListener('click', requestPasswordReset);
    $('#recoveryForm').addEventListener('submit', updatePassword);
  }

  function showLogin() {
    $('#passwordRecoveryGate').hidden = true;
    $('#authGate').hidden = false;
  }

  function hideLogin() {
    $('#authGate').hidden = true;
  }

  function showRecovery() {
    $('#authGate').hidden = true;
    $('#passwordRecoveryGate').hidden = false;
  }

  async function login(e) {
    e.preventDefault();
    if (!sb) return;

    const button = $('#loginButton');
    const message = $('#authMessage');

    button.disabled = true;
    button.textContent = '로그인 중…';
    message.textContent = '';

    const email = $('#loginEmail').value.trim();
    const password = $('#loginPassword').value;

    const { error } = await sb.auth.signInWithPassword({ email, password });

    button.disabled = false;
    button.textContent = '로그인';

    if (error) {
      message.textContent = '이메일 또는 비밀번호를 확인해주세요.';
      return;
    }
  }

  async function requestPasswordReset() {
    if (!sb) return;

    const email = $('#loginEmail').value.trim();
    const message = $('#authMessage');

    if (!email) {
      message.textContent = '먼저 이메일을 입력해주세요.';
      return;
    }

    message.style.color = '#169f94';
    message.textContent = '복구 이메일을 보내는 중…';

    const redirectTo = `${location.origin}${location.pathname}`;
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });

    if (error) {
      console.error(error);
      message.style.color = '#e44c51';
      if (String(error.message || '').toLowerCase().includes('rate')) {
        message.textContent = '복구 이메일 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.';
      } else {
        message.textContent = '복구 이메일 발송에 실패했습니다.';
      }
      return;
    }

    message.style.color = '#169f94';
    message.textContent = '복구 이메일을 보냈습니다. 받은편지함을 확인해주세요.';
  }

  async function updatePassword(e) {
    e.preventDefault();
    if (!sb) return;

    const p1 = $('#newPassword').value;
    const p2 = $('#newPasswordConfirm').value;
    const message = $('#recoveryMessage');
    const button = $('#recoveryButton');

    message.textContent = '';

    if (p1.length < 8) {
      message.textContent = '비밀번호는 8자 이상으로 입력해주세요.';
      return;
    }
    if (p1 !== p2) {
      message.textContent = '두 비밀번호가 서로 다릅니다.';
      return;
    }

    button.disabled = true;
    button.textContent = '변경 중…';

    const { error } = await sb.auth.updateUser({ password: p1 });

    button.disabled = false;
    button.textContent = '비밀번호 변경';

    if (error) {
      console.error(error);
      message.textContent = '비밀번호 변경에 실패했습니다. 최신 복구 메일을 다시 열어주세요.';
      return;
    }

    message.style.color = '#169f94';
    message.textContent = '비밀번호가 변경되었습니다.';
    setTimeout(() => {
      $('#passwordRecoveryGate').hidden = true;
      toast('비밀번호 변경 완료');
    }, 700);
  }

  async function logout() {
    if (sb) await sb.auth.signOut();
  }

  async function onSession(session) {
    state.user = session?.user || null;

    if (!state.user) {
      showLogin();
      return;
    }

    hideLogin();
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
      await loadGatheringQr();
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

    if (!$('#changePasswordButton')) {
      const p = document.createElement('button');
      p.id = 'changePasswordButton';
      p.className = 'logout-button';
      p.type = 'button';
      p.textContent = '비밀번호 변경';
      p.style.cssText = 'border-color:#cceee9;background:#f4fffd;color:#159f93;margin-top:10px;';
      p.addEventListener('click', openPasswordChange);
      settingsCard.insertBefore(p, b);
    }
  }

  function openPasswordChange() {
    let dialog = $('#changePasswordDialog');

    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'changePasswordDialog';
      dialog.style.cssText = 'width:min(calc(100% - 36px),420px);border:0;border-radius:24px;padding:0;box-shadow:0 20px 70px rgba(0,0,0,.2);';
      dialog.innerHTML = `
        <form id="changePasswordForm" style="padding:26px 22px;background:#fff;">
          <h2 style="margin:0 0 8px;font-size:24px;">비밀번호 변경</h2>
          <p style="margin:0 0 20px;color:#7b8590;font-size:14px;">새 관리자 비밀번호를 입력하세요.</p>

          <label style="display:block;font-weight:800;margin:14px 0 7px;">새 비밀번호</label>
          <input id="settingsNewPassword" type="password" autocomplete="new-password" minlength="8" required
            style="box-sizing:border-box;width:100%;height:52px;border:1px solid #dfe7e9;border-radius:15px;padding:0 14px;font-size:16px;">

          <label style="display:block;font-weight:800;margin:16px 0 7px;">새 비밀번호 확인</label>
          <input id="settingsNewPasswordConfirm" type="password" autocomplete="new-password" minlength="8" required
            style="box-sizing:border-box;width:100%;height:52px;border:1px solid #dfe7e9;border-radius:15px;padding:0 14px;font-size:16px;">

          <div id="settingsPasswordMessage" style="min-height:22px;margin:10px 0 4px;color:#e44c51;font-size:13px;font-weight:700;"></div>

          <button id="settingsPasswordSave" type="submit" class="primary-button" style="width:100%;margin-top:4px;">비밀번호 저장</button>
          <button id="settingsPasswordCancel" type="button"
            style="width:100%;height:50px;border:0;background:transparent;color:#7b8590;font-weight:800;margin-top:8px;">취소</button>
        </form>`;
      document.body.appendChild(dialog);

      $('#changePasswordForm').addEventListener('submit', savePasswordFromSettings);
      $('#settingsPasswordCancel').addEventListener('click', () => dialog.close());
    }

    $('#changePasswordForm')?.reset();
    const m = $('#settingsPasswordMessage');
    if (m) m.textContent = '';
    dialog.showModal();
  }

  async function savePasswordFromSettings(e) {
    e.preventDefault();

    const p1 = $('#settingsNewPassword').value;
    const p2 = $('#settingsNewPasswordConfirm').value;
    const message = $('#settingsPasswordMessage');
    const button = $('#settingsPasswordSave');

    message.style.color = '#e44c51';
    message.textContent = '';

    if (p1.length < 8) {
      message.textContent = '비밀번호는 8자 이상으로 입력해주세요.';
      return;
    }

    if (p1 !== p2) {
      message.textContent = '두 비밀번호가 서로 다릅니다.';
      return;
    }

    button.disabled = true;
    button.textContent = '저장 중…';

    const { error } = await sb.auth.updateUser({ password: p1 });

    button.disabled = false;
    button.textContent = '비밀번호 저장';

    if (error) {
      console.error(error);
      message.textContent = `변경 실패: ${error.message || '다시 시도해주세요.'}`;
      return;
    }

    message.style.color = '#159f93';
    message.textContent = '비밀번호가 변경되었습니다.';
    toast('비밀번호 변경 완료');

    setTimeout(() => $('#changePasswordDialog')?.close(), 900);
  }

  async function loadLatestEvent() {
    const { data, error } = await sb
      .from('events')
      .select('id,title,event_date,location,status,starts_at,ends_at')
      .eq('organization_id', state.member.organization_id)
      .order('event_date', { ascending:false })
      .order('created_at', { ascending:false })
      .limit(1);

    if (error) throw error;
    state.event = data?.[0] || null;
  }


  async function loadGatheringQr() {
    state.qrToken = null;
    if (!state.event) return;

    const now = new Date().toISOString();
    const { data, error } = await sb
      .from('qr_tokens')
      .select('id,event_id,kind,token,is_active,valid_from,valid_until,created_at')
      .eq('event_id', state.event.id)
      .eq('kind', 'gathering')
      .eq('is_active', true)
      .gte('valid_until', now)
      .order('created_at', { ascending:false })
      .limit(1);

    if (error) {
      console.error('QR load error:', error);
      return;
    }

    state.qrToken = data?.[0] || null;
  }

  function checkinUrl(token) {
    const url = new URL('checkin.html', location.href);
    url.searchParams.set('t', token);
    return url.toString();
  }

  function renderQr() {
    const qrBox = $('.fake-qr');
    const qrPanel = $('.qr-panel');
    const pill = $('[data-screen="qr"] .pill');
    if (!qrBox || !qrPanel) return;

    const desc = qrPanel.querySelector('p');
    const startBtn = $('#demoStart');

    if (!state.qrToken?.token) {
      if (pill) pill.textContent = '준비 전';
      if (desc) desc.textContent = '행사 시작을 누르면 이 행사 전용 QR이 생성됩니다.';
      if (startBtn) startBtn.textContent = '행사 시작';
      return;
    }

    const target = checkinUrl(state.qrToken.token);
    const qrImage =
      'https://quickchart.io/qr?size=320&margin=2&text=' +
      encodeURIComponent(target);

    qrBox.innerHTML = '';
    qrBox.style.cssText =
      'width:260px;height:260px;margin:0 auto 22px;background:#fff;border-radius:22px;padding:12px;box-sizing:border-box;display:grid;place-items:center;';
    const img = document.createElement('img');
    img.src = qrImage;
    img.alt = '집결지 출석 QR';
    img.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;';
    qrBox.appendChild(img);

    if (pill) pill.textContent = '실제 QR';
    if (desc) {
      const until = state.qrToken.valid_until
        ? new Date(state.qrToken.valid_until).toLocaleString('ko-KR', {
            month:'numeric', day:'numeric', hour:'numeric', minute:'2-digit'
          })
        : '';
      desc.textContent = until
        ? `이 행사 전용 QR입니다. ${until}까지 유효합니다.`
        : '이 행사 전용 QR입니다.';
    }
    if (startBtn) startBtn.textContent = 'QR 새로고침';
  }

  async function startEventQr() {
    if (!state.event) {
      toast('먼저 행사를 등록해주세요.');
      return;
    }

    if (state.qrToken?.token) {
      renderQr();
      toast('출석 QR 준비 완료');
      return;
    }

    const validUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await sb
      .from('qr_tokens')
      .insert({
        event_id: state.event.id,
        kind: 'gathering',
        valid_until: validUntil
      })
      .select('id,event_id,kind,token,is_active,valid_from,valid_until,created_at')
      .single();

    if (error) {
      console.error('QR create error:', error);
      toast(`QR 생성 실패 · ${error.message || error.code || '확인 필요'}`);
      return;
    }

    state.qrToken = data;
    renderQr();
    toast('행사 전용 QR 생성 완료');
  }

  async function loadPeople() {
    if (!state.event) {
      state.people = [];
      return;
    }

    const { data, error } = await sb
      .from('event_participants')
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
      status:
        row.travel_mode === 'individual' ? 'individual' :
        row.attendance_status === 'checked_in' ? 'present' :
        'unknown',
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
      if (el.textContent === '오늘 행사' && state.event) {
        el.textContent = state.event.event_date || '행사';
      }
    });

    const eventStatus = $('.event-status');
    if (eventStatus) {
      eventStatus.textContent = state.event ? statusLabel(state.event.status) : '행사 없음';
    }

    renderStats();
    renderPeople();
    renderStatus();
    renderQr();
  }

  function statusLabel(s) {
    return ({draft:'진행 전', active:'진행 중', ended:'종료'})[s] || s || '진행 전';
  }

  function renderStats() {
    const total = state.people.length;
    const present = state.people.filter(p => p.status === 'present').length;
    const individual = state.people.filter(p => p.status === 'individual').length;
    const unknown = total - present - individual;

    if ($('#statTotal')) $('#statTotal').textContent = total;
    if ($('#statPresent')) $('#statPresent').textContent = present;
    if ($('#statIndividual')) $('#statIndividual').textContent = individual;
    if ($('#statUnknown')) $('#statUnknown').textContent = unknown;

    const denominator = Math.max(1, total - individual);
    const rate = total ? Math.round(present / denominator * 100) : 0;

    if ($('#rateText')) $('#rateText').textContent = `${rate}%`;
    if ($('#progressBar')) $('#progressBar').style.width = `${rate}%`;
  }

  function filteredPeople() {
    const q = state.search.toLowerCase();

    return state.people.filter(p => {
      const filterOk = state.filter === 'all' || p.status === state.filter;
      const searchOk =
        !q ||
        `${p.name} ${p.org} ${p.phone}`.toLowerCase().includes(q);

      return filterOk && searchOk;
    });
  }

  function formatCheckTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('ko-KR', {
      hour:'2-digit',
      minute:'2-digit',
      hour12:false
    });
  }

  const notificationState = {
    items: [],
    expanded: false,
    storageKey: 'qr-attendance-notification-stack-v16',
    positionKey: 'qr-attendance-notification-position-v18',
    y: null,
    dragging: false,
    moved: false
  };

  function loadNotificationState() {
    try {
      const saved = JSON.parse(localStorage.getItem(notificationState.storageKey) || '[]');
      notificationState.items = Array.isArray(saved) ? saved.slice(-30) : [];
    } catch {
      notificationState.items = [];
    }

    try {
      const savedY = Number(localStorage.getItem(notificationState.positionKey));
      notificationState.y = Number.isFinite(savedY) ? savedY : null;
    } catch {
      notificationState.y = null;
    }
  }

  function saveNotificationState() {
    try {
      localStorage.setItem(
        notificationState.storageKey,
        JSON.stringify(notificationState.items.slice(-30))
      );
    } catch {}
  }

  function ensureNotificationCenter() {
    if ($('#attendanceNoticeCenter')) return;

    const style = document.createElement('style');
    style.textContent = `
      #attendanceNoticeCenter{
        position:fixed;
        left:50%;
        top:52%;
        transform:translate(-50%,-50%);
        width:min(calc(100% - 26px),540px);
        z-index:9000;
        pointer-events:none;
      }
      #attendanceNoticeCenter.is-empty{display:none}
      #attendanceNoticeCenter.dragging{transition:none}
      #attendanceNoticeCenter.expanded{
        inset:0;
        left:0;
        top:0;
        width:100%;
        height:100dvh;
        transform:none;
        pointer-events:none;
      }
      #attendanceNoticeStack{
        position:relative;
        width:100%;
        pointer-events:auto;
      }
      #attendanceNoticeStack.collapsed{
        height:82px;
        overflow:visible;
      }
      #attendanceNoticeStack.expanded{
        position:absolute;
        left:10px;
        right:10px;
        top:calc(env(safe-area-inset-top) + 16px);
        bottom:calc(env(safe-area-inset-bottom) + 78px);
        display:flex;
        flex-direction:column;
        gap:10px;
        overflow-y:auto;
        -webkit-overflow-scrolling:touch;
        overscroll-behavior:contain;
        scroll-behavior:smooth;
        padding:48px 2px 26px;
        touch-action:pan-y;
        pointer-events:auto;
      }
      .attendance-notice{
        position:relative;
        width:100%;
        min-height:72px;
        border-radius:22px;
        background:rgba(174,174,178,.96);
        border:1px solid rgba(255,255,255,.6);
        box-shadow:0 10px 28px rgba(20,28,34,.24);
        backdrop-filter:blur(24px) saturate(1.08);
        -webkit-backdrop-filter:blur(24px) saturate(1.08);
        display:flex;
        align-items:center;
        padding:0 54px 0 18px;
        color:#111820;
        font-size:15px;
        font-weight:800;
        letter-spacing:-.25px;
        user-select:none;
        -webkit-user-select:none;
        touch-action:pan-y;
        overflow:hidden;
        transition:transform .24s ease,opacity .2s ease;
      }
      #attendanceNoticeStack.expanded .attendance-notice{
        flex:0 0 auto;
        opacity:1;
        transform:none;
      }
      .attendance-notice-line{
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
        width:100%;
      }
      .attendance-notice .notice-status{color:#087f74;font-weight:900}
      .attendance-notice[data-status="individual"] .notice-status{color:#663bb8}
      .attendance-notice[data-status="unknown"] .notice-status{color:#bd343b}

      #attendanceNoticeStack.collapsed .attendance-notice{
        position:absolute;
        left:0;
        top:0;
      }
      #attendanceNoticeStack.collapsed .attendance-notice:not(:last-child) .attendance-notice-line{
        opacity:0;
      }
      #attendanceNoticeStack.collapsed .attendance-notice:nth-last-child(1){
        z-index:6;transform:translateY(0) scale(1);opacity:1;
      }
      #attendanceNoticeStack.collapsed .attendance-notice:nth-last-child(2){
        z-index:5;transform:translateY(-9px) scale(.965);opacity:.92;
      }
      #attendanceNoticeStack.collapsed .attendance-notice:nth-last-child(3){
        z-index:4;transform:translateY(-17px) scale(.93);opacity:.76;
      }
      #attendanceNoticeStack.collapsed .attendance-notice:nth-last-child(n+4){
        opacity:0;transform:translateY(-23px) scale(.91);pointer-events:none;
      }

      #attendanceNoticeClear{
        position:absolute;
        right:8px;
        top:50%;
        transform:translateY(-50%);
        width:38px;
        height:38px;
        border:0;
        border-radius:50%;
        background:rgba(72,72,74,.28);
        color:#2f3439;
        font-size:24px;
        line-height:1;
        display:grid;
        place-items:center;
        z-index:50;
        pointer-events:auto;
      }
      #attendanceNoticeCenter.expanded #attendanceNoticeClear{
        position:fixed;
        top:calc(env(safe-area-inset-top) + 18px);
        right:18px;
        transform:none;
      }
      .attendance-notice.swiping{transition:none!important}
      @media (max-width:390px){
        .attendance-notice{font-size:14px;padding-left:15px;padding-right:50px}
        #attendanceNoticeStack.expanded{
          left:8px;right:8px;
          bottom:calc(env(safe-area-inset-bottom) + 72px);
        }
      }
    `;
    document.head.appendChild(style);

    const center = document.createElement('div');
    center.id = 'attendanceNoticeCenter';
    center.className = 'is-empty';
    center.innerHTML = `
      <div id="attendanceNoticeStack" class="collapsed" aria-label="출석 알림"></div>
      <button id="attendanceNoticeClear" type="button" aria-label="알림 전체 삭제">×</button>
    `;
    document.body.appendChild(center);
    installNotificationCenterDrag(center);

    $('#attendanceNoticeClear').addEventListener('click', e => {
      e.stopPropagation();
      notificationState.items = [];
      notificationState.expanded = false;
      saveNotificationState();
      renderNotificationCenter();
    });

    $('#attendanceNoticeStack').addEventListener('click', e => {
      if (notificationState.dragging || notificationState.moved) return;
      if (e.target.closest('.attendance-notice')?.dataset.justSwiped === '1') return;
      if (notificationState.expanded) return;
      if (notificationState.items.length <= 1) return;

      notificationState.expanded = true;
      renderNotificationCenter();

      requestAnimationFrame(() => {
        const stack = $('#attendanceNoticeStack');
        if (stack) stack.scrollTop = stack.scrollHeight;
      });
    });
  }

  function clampNotificationY(y, center) {
    const rect = center.getBoundingClientRect();
    const half = Math.max(42, rect.height / 2);
    const minY = half + 14;
    const maxY = window.innerHeight - half - 92;
    return Math.min(Math.max(y, minY), Math.max(minY, maxY));
  }

  function applyNotificationPosition() {
    const center = $('#attendanceNoticeCenter');
    if (!center || notificationState.expanded) return;

    if (!Number.isFinite(notificationState.y)) {
      notificationState.y = Math.round(window.innerHeight * .52);
    }

    notificationState.y = clampNotificationY(notificationState.y, center);
    center.style.top = `${notificationState.y}px`;
  }

  function saveNotificationPosition() {
    try {
      if (Number.isFinite(notificationState.y)) {
        localStorage.setItem(notificationState.positionKey, String(notificationState.y));
      }
    } catch {}
  }

  function installNotificationCenterDrag(center) {
    let startX = 0;
    let startY = 0;
    let startCenterY = 0;
    let dragging = false;
    let moved = false;
    let direction = null;

    center.addEventListener('touchstart', e => {
      if (notificationState.expanded) return;
      if (e.target.closest('#attendanceNoticeClear')) return;

      const t = e.touches?.[0];
      if (!t) return;

      startX = t.clientX;
      startY = t.clientY;
      const rect = center.getBoundingClientRect();
      startCenterY = rect.top + rect.height / 2;
      dragging = false;
      moved = false;
      direction = null;
      notificationState.dragging = false;
      notificationState.moved = false;
    }, {passive:true});

    center.addEventListener('touchmove', e => {
      if (notificationState.expanded) return;
      const t = e.touches?.[0];
      if (!t) return;

      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      if (!direction && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        direction = Math.abs(dy) >= Math.abs(dx) ? 'vertical' : 'horizontal';
      }

      if (direction == 'horizontal') return;
      if (direction != 'vertical') return;

      e.preventDefault();
      dragging = true;
      moved = true;
      notificationState.dragging = true;
      notificationState.moved = true;
      center.classList.add('dragging');

      notificationState.y = clampNotificationY(startCenterY + dy, center);
      center.style.top = `${notificationState.y}px`;
    }, {passive:false});

    const finish = () => {
      if (dragging) {
        center.classList.remove('dragging');
        saveNotificationPosition();
      }
      notificationState.dragging = false;
      dragging = false;
      direction = null;

      if (moved) {
        setTimeout(() => {
          notificationState.moved = false;
        }, 160);
      }
    };

    center.addEventListener('touchend', finish, {passive:true});
    center.addEventListener('touchcancel', finish, {passive:true});
  }

  function noticeStatusText(status) {
    return ({
      present:'출석✓',
      individual:'개인출발',
      unknown:'미확인'
    })[status] || '미확인';
  }

  function renderNotificationCenter() {
    ensureNotificationCenter();

    const center = $('#attendanceNoticeCenter');
    const stack = $('#attendanceNoticeStack');
    if (!center || !stack) return;

    const items = notificationState.items;
    center.classList.toggle('is-empty', items.length === 0);
    center.classList.toggle('expanded', notificationState.expanded);
    stack.className = notificationState.expanded ? 'expanded' : 'collapsed';

    if (notificationState.expanded) {
      center.style.top = '0';
    } else {
      requestAnimationFrame(applyNotificationPosition);
    }

    stack.innerHTML = items.map(item => `
      <div class="attendance-notice"
           data-notice-id="${escapeHtml(item.id)}"
           data-status="${escapeHtml(item.status)}">
        <div class="attendance-notice-line">
          ${escapeHtml(item.name || '이름 없음')}
          <span> · ${escapeHtml(item.phone || '----')}</span>
          <span> · ${escapeHtml(item.org || '소속 없음')}</span>
          <span class="notice-status"> · ${escapeHtml(noticeStatusText(item.status))}</span>
        </div>
      </div>
    `).join('');

    $$('.attendance-notice', stack).forEach(installNoticeSwipe);
  }

  function installNoticeSwipe(card) {
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let active = false;

    card.addEventListener('touchstart', e => {
      const t = e.touches?.[0];
      if (!t) return;
      startX = t.clientX;
      startY = t.clientY;
      dx = 0;
      active = true;
      card.classList.add('swiping');
      card.dataset.justSwiped = '0';
    }, {passive:true});

    card.addEventListener('touchmove', e => {
      if (!active) return;
      const t = e.touches?.[0];
      if (!t) return;
      const dy = t.clientY - startY;
      dx = Math.max(0, t.clientX - startX);
      if (Math.abs(dx) > Math.abs(dy) && dx > 6) {
        card.style.transform = `translateX(${dx}px)`;
        card.style.opacity = String(Math.max(.18, 1 - dx / 260));
      }
    }, {passive:true});

    card.addEventListener('touchend', () => {
      if (!active) return;
      active = false;
      card.classList.remove('swiping');

      if (dx > 82) {
        card.dataset.justSwiped = '1';
        const id = card.dataset.noticeId;
        card.style.transform = 'translateX(120%)';
        card.style.opacity = '0';
        setTimeout(() => removeNotification(id), 160);
      } else {
        card.style.transform = '';
        card.style.opacity = '';
        setTimeout(() => { card.dataset.justSwiped = '0'; }, 80);
      }
    });
  }

  function removeNotification(id) {
    notificationState.items = notificationState.items.filter(x => x.id !== id);
    if (notificationState.items.length <= 1) notificationState.expanded = false;
    saveNotificationState();
    renderNotificationCenter();
  }

  function pushAttendanceNotification(person, status) {
    const toggle = $('#popupToggle');
    if (toggle && !toggle.checked) return;

    ensureNotificationCenter();

    const item = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: person?.name || '이름 없음',
      phone: person?.phone || '----',
      org: person?.org || '소속 없음',
      status,
      createdAt: new Date().toISOString()
    };

    notificationState.items.push(item);
    notificationState.items = notificationState.items.slice(-30);
    notificationState.expanded = false;
    saveNotificationState();
    renderNotificationCenter();
  }

  function showAttendancePopup(person, checkedAt) {
    pushAttendanceNotification(person, 'present');
  }

  function renderPeople() {
    const list = $('#peopleList');
    if (!list) return;

    const rows = filteredPeople();

    if (!state.event) {
      list.innerHTML = '<div class="empty-state">먼저 행사를 등록해주세요.</div>';
      return;
    }

    if (!rows.length) {
      list.innerHTML = '<div class="empty-state">등록된 참가자가 없습니다.</div>';
      return;
    }

    list.innerHTML = rows.map(p => `
      <div class="person-card">
        <div class="avatar">${escapeHtml(p.name.slice(0,1))}</div>
        <div class="person-main">
          <strong>${escapeHtml(p.name)}</strong>
          <small>${escapeHtml(p.org || '소속 없음')}${p.phone ? ` · •••• ${escapeHtml(p.phone)}` : ''}</small>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex:0 0 auto;">
          ${p.status === 'present' && p.checkedAt
            ? `<span class="status-button present" style="width:58px;height:32px;padding:0;display:inline-flex;align-items:center;justify-content:center;">${escapeHtml(formatCheckTime(p.checkedAt))}</span>`
            : ''}
          <button class="status-button ${p.status}" data-person="${p.linkId}"${p.status === 'present' ? ' style="width:58px;height:32px;padding:0;display:inline-flex;align-items:center;justify-content:center;"' : ''}>
            ${labelFor(p.status)}
          </button>
        </div>
      </div>
    `).join('');

    $$('[data-person]', list).forEach(b => {
      b.addEventListener('click', () => cycleStatus(b.dataset.person));
    });
  }

  function renderStatus() {
    const list = $('#statusList');
    if (!list) return;

    if (!state.people.length) {
      list.innerHTML = '<div class="empty-state">출석 기록이 없습니다.</div>';
      return;
    }

    list.innerHTML = state.people.map(p => `
      <div class="status-row">
        <div>
          <strong>${escapeHtml(p.name)}</strong>
          <small>${escapeHtml(p.org || '소속 없음')}</small>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex:0 0 auto;">
          ${p.status === 'present' && p.checkedAt
            ? `<span class="badge present" style="width:58px;height:32px;padding:0;display:inline-flex;align-items:center;justify-content:center;">${escapeHtml(formatCheckTime(p.checkedAt))}</span>`
            : ''}
          <span class="badge ${p.status}"${p.status === 'present' ? ' style="width:58px;height:32px;padding:0;display:inline-flex;align-items:center;justify-content:center;"' : ''}>${labelFor(p.status)}</span>
        </div>
      </div>
    `).join('');
  }

  const labelFor = s =>
    ({present:'출석', individual:'개인출발', unknown:'미확인'})[s] || '미확인';

  async function cycleStatus(linkId) {
    const p = state.people.find(x => x.linkId === linkId);
    if (!p || !state.event) return;

    const next =
      p.status === 'unknown' ? 'present' :
      p.status === 'present' ? 'individual' :
      'unknown';

    const patch =
      next === 'individual'
        ? {
            travel_mode:'individual',
            attendance_status:'unconfirmed',
            checked_at:null,
            check_source:'manual'
          }
        : next === 'present'
        ? {
            travel_mode:'bus',
            attendance_status:'checked_in',
            checked_at:new Date().toISOString(),
            check_source:'manual'
          }
        : {
            travel_mode:'bus',
            attendance_status:'unconfirmed',
            checked_at:null,
            check_source:'manual'
          };

    const { error } = await sb
      .from('event_participants')
      .update(patch)
      .eq('id', linkId);

    if (error) {
      console.error(error);
      toast(`오류 ${error.code || ''} · ${error.message || '상태 변경 실패'}${error.details ? ' · ' + error.details : ''}`);
      return;
    }

    await sb.from('attendance_logs').insert({
      event_id: state.event.id,
      participant_id: p.participantId,
      action: next,
      source: 'manual',
      actor_user_id: state.user.id
    });

    await loadPeople();
    renderAll();
    const updatedPerson = state.people.find(x => x.linkId === linkId) || p;
    pushAttendanceNotification(updatedPerson, next);
  }

  async function addPerson(e) {
    e.preventDefault();

    if (!state.event) {
      toast('먼저 행사를 등록해야 합니다.');
      return;
    }

    const name = $('#personName').value.trim();
    const affiliation = $('#personOrg').value.trim();
    const phone_last4 = $('#personPhone').value.trim();

    if (!name) return;

    const { data: participant, error } = await sb
      .from('participants')
      .insert({
        organization_id: state.member.organization_id,
        name,
        affiliation,
        phone_last4
      })
      .select('id')
      .single();

    if (error) {
      console.error(error);
      toast('참가자 등록에 실패했습니다.');
      return;
    }

    const { error: linkError } = await sb
      .from('event_participants')
      .insert({
        event_id: state.event.id,
        participant_id: participant.id
      });

    if (linkError) {
      console.error(linkError);
      toast('행사 명단 연결에 실패했습니다.');
      return;
    }

    $('#personDialog')?.close();
    $('#personForm')?.reset();

    await loadPeople();
    renderAll();
    toast(`${name} 등록 완료`);
  }

  function subscribeRealtime() {
    if (state.channel) sb.removeChannel(state.channel);
    if (!state.event) return;

    state.channel = sb
      .channel(`event-${state.event.id}`)
      .on(
        'postgres_changes',
        {
          event:'*',
          schema:'public',
          table:'event_participants',
          filter:`event_id=eq.${state.event.id}`
        },
        async (payload) => {
          const isQrCheckIn =
            payload?.eventType === 'UPDATE' &&
            payload?.new?.attendance_status === 'checked_in' &&
            payload?.new?.check_source === 'qr';
          const participantId = payload?.new?.participant_id || null;
          const checkedAt = payload?.new?.checked_at || null;
          await loadPeople();
          renderAll();
          if (isQrCheckIn) {
            const person = state.people.find(p => p.participantId === participantId);
            showAttendancePopup(person, checkedAt);
          }
        }
      )
      .subscribe();
  }

  function wireUI() {
    $$('[data-go]').forEach(btn =>
      btn.addEventListener('click', () => go(btn.dataset.go))
    );

    $$('.chip').forEach(btn =>
      btn.addEventListener('click', () => {
        state.filter = btn.dataset.filter;
        $$('.chip').forEach(x => x.classList.toggle('active', x === btn));
        renderPeople();
      })
    );

    $('#searchInput')?.addEventListener('input', e => {
      state.search = e.target.value.trim();
      renderPeople();
    });

    $('#addPersonButton')?.addEventListener('click', () =>
      $('#personDialog')?.showModal()
    );

    $('#personForm')?.addEventListener('submit', addPerson);

    $('#manualButton')?.addEventListener('click', () => go('roster'));
    $('#saveSettings')?.addEventListener('click', () => toast('설정 저장 완료'));
    $('#notificationButton')?.addEventListener('click', () => toast('실시간 출석 알림 연결 준비 완료'));
    $('#ocrButton')?.addEventListener('click', () => toast('OCR 명단 등록은 다음 단계에서 연결합니다.'));
    $('#sheetButton')?.addEventListener('click', () => toast('Excel · Numbers · Sheets 연결은 다음 단계입니다.'));
    $('#proxyButton')?.addEventListener('click', () => toast('대리 QR은 행사 QR 기능과 함께 연결합니다.'));
    $('#demoShare')?.addEventListener('click', () => toast('대리 QR 공유는 다음 단계에서 활성화합니다.'));
    $('#demoStart')?.addEventListener('click', startEventQr);
  }

  function go(screen) {
    $$('.screen').forEach(x =>
      x.classList.toggle('active', x.dataset.screen === screen)
    );
    $$('.tab').forEach(x =>
      x.classList.toggle('active', x.dataset.go === screen)
    );
    window.scrollTo({top:0, behavior:'smooth'});
  }

  function escapeHtml(v='') {
    return String(v).replace(/[&<>"']/g, c => ({
      '&':'&amp;',
      '<':'&lt;',
      '>':'&gt;',
      '"':'&quot;',
      "'":'&#39;'
    }[c]));
  }

  async function init() {
    ensureLoginUI();
    loadNotificationState();
    ensureNotificationCenter();
    renderNotificationCenter();
    wireUI();

    window.addEventListener('resize', () => {
      if (!notificationState.expanded) {
        requestAnimationFrame(applyNotificationPosition);
      }
    });

    if (!sb) {
      $('#authMessage').textContent = 'Supabase 연결 설정을 확인해주세요.';
      return;
    }

    const { data } = await sb.auth.getSession();

    const looksLikeRecovery =
      location.href.includes('type=recovery') ||
      new URLSearchParams(location.search).get('type') === 'recovery';

    if (looksLikeRecovery && data.session) {
      showRecovery();
    } else {
      await onSession(data.session);
    }

    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setTimeout(showRecovery, 0);
        return;
      }
      setTimeout(() => onSession(session), 0);
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js').catch(console.error);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();