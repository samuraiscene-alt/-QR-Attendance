(() => {
  'use strict';
  // QR Attendance V36.11 · reset stale timestamps when returning to unconfirmed + V36.10 grace preserved

  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => [...root.querySelectorAll(s)];
  const toastEl = $('#toast');
  let toastTimer;
  let googleSheetsSyncTimer = null;

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
    logs: [],
    historyEvents: [],
    historyOffset: 0,
    historyHasMore: false,
    historySelectedEvent: null,
    historyDeleteContext: null,
    spreadsheetRows: [],
    spreadsheetFileName: '',
    ocrRows: [],
    ocrRawText: '',
    ocrFileName: '',
    filter: 'all',
    search: '',
    channel: null,
    qrToken: null,
    arrivalQrToken: null,
    qrView: 'gathering',
    previousEvent: null,
    awaitingNewEvent: false,
    rosterSelectMode: false,
    rosterSelectedIds: [],
    proxyTokens: [],
    statusScope: 'current',
    statusAggregate: null,
    statusLoading: false
  };

  const QR_NEXT_EVENT_KEY = 'qr-attendance-awaiting-new-event-v22';

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
      await loadAttendanceLogs();
      await ensureManualEndQrValidity();
      await loadGatheringQr();
      subscribeRealtime();
      renderAll();
      recoverMissedQrNotifications();
      updateNotificationBellState();
      queueGoogleSheetsCurrentSync(500);
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
      .order('created_at', { ascending:false })
      .limit(1);

    if (error) throw error;

    state.event = data?.[0] || null;
    state.previousEvent = state.event;

    try {
      const waitingFor = localStorage.getItem(QR_NEXT_EVENT_KEY);
      state.awaitingNewEvent = Boolean(
        state.event &&
        state.event.status === 'ended' &&
        waitingFor === state.event.id
      );
    } catch {
      state.awaitingNewEvent = false;
    }
  }


  async function ensureManualEndQrValidity() {
    if (!state.event || state.event.status !== 'active') return;

    const { error } = await sb
      .from('qr_tokens')
      .update({ valid_until: null })
      .eq('event_id', state.event.id)
      .eq('is_active', true);

    if (error) {
      console.error('QR manual-end validity error:', error);
      toast('현재 행사 QR 유효 상태를 확인해주세요.');
    }
  }

  async function loadGatheringQr() {
    state.qrToken = null;
    state.arrivalQrToken = null;
    if (!state.event) return;

    const { data, error } = await sb
      .from('qr_tokens')
      .select('id,event_id,kind,token,is_active,valid_from,valid_until,created_at')
      .eq('event_id', state.event.id)
      .in('kind', ['gathering','arrival'])
      .eq('is_active', true)
      .is('revoked_at', null)
      .order('created_at', { ascending:false });

    if (error) {
      console.error('QR load error:', error);
      return;
    }

    const rows = data || [];
    state.qrToken = rows.find(x => x.kind === 'gathering') || null;
    state.arrivalQrToken = rows.find(x => x.kind === 'arrival') || null;
  }

  function appBaseUrl() {
    const path = location.pathname || '/';

    if (path.endsWith('/')) {
      return `${location.origin}${path}`;
    }

    const lastSegment = path.split('/').pop() || '';
    if (lastSegment.includes('.')) {
      return `${location.origin}${path.slice(0, path.lastIndexOf('/') + 1)}`;
    }

    return `${location.origin}${path}/`;
  }

  function checkinUrl(token, kind='gathering') {
    const url = new URL('checkin.html', appBaseUrl());
    url.searchParams.set('t', token);
    if (kind === 'arrival') url.searchParams.set('mode', 'arrival');
    return url.toString();
  }

  function ensureQrKindSelector() {
    const qrPanel = $('.qr-panel');
    const qrBox = $('.fake-qr');
    if (!qrPanel || !qrBox || $('#qrKindSelector')) return;

    const style = document.createElement('style');
    style.textContent = `
      #qrKindSelector{
        display:grid;grid-template-columns:1fr 1fr;gap:5px;
        width:calc(100% - 24px);max-width:430px;
        margin:0 auto 24px;padding:5px;border-radius:17px;background:#eef3f3
      }
      #qrKindSelector[hidden]{display:none}
      .qr-kind-button{
        min-height:46px;border:0;border-radius:13px;background:transparent;
        color:#7b878c;font-size:15px;font-weight:900;letter-spacing:-.2px
      }
      .qr-kind-button.active{
        background:#fff;color:#10a997;
        box-shadow:0 3px 12px rgba(27,67,68,.10)
      }
      .qr-kind-button:disabled{opacity:.42}
    `;
    document.head.appendChild(style);

    const selector = document.createElement('div');
    selector.id = 'qrKindSelector';
    selector.hidden = true;
    selector.innerHTML = `
      <button type="button" class="qr-kind-button active" data-qr-kind="gathering">집결지 QR</button>
      <button type="button" class="qr-kind-button" data-qr-kind="arrival">현장 QR</button>
    `;
    qrPanel.insertBefore(selector, qrBox);

    $$('[data-qr-kind]', selector).forEach(button => {
      button.addEventListener('click', () => {
        state.qrView = button.dataset.qrKind === 'arrival' ? 'arrival' : 'gathering';
        renderQr();
      });
    });
  }

  function syncQrKindSelector(cycle) {
    ensureQrKindSelector();
    const selector = $('#qrKindSelector');
    if (!selector) return;

    selector.hidden = cycle !== 'active';

    $$('[data-qr-kind]', selector).forEach(button => {
      const kind = button.dataset.qrKind;
      button.classList.toggle('active', kind === state.qrView);
      button.disabled =
        kind === 'gathering'
          ? !state.qrToken?.token
          : !state.arrivalQrToken?.token;
    });
  }

  function renderQrPlaceholder() {
    const qrBox = $('.fake-qr');
    if (!qrBox) return;

    qrBox.removeAttribute('style');
    qrBox.innerHTML = `
      <div class="finder f1"></div>
      <div class="finder f2"></div>
      <div class="finder f3"></div>
      <div class="pixels"></div>
    `;
  }

  function currentQrCycle() {
    if (!state.event || state.awaitingNewEvent) return 'new_event';
    if (state.event.status === 'ended') return 'refresh';
    if (state.qrToken?.token || state.event.status === 'active') return 'active';
    return 'ready';
  }

  function renderQr() {
    const qrBox = $('.fake-qr');
    const qrPanel = $('.qr-panel');
    const pill = $('[data-screen="qr"] .pill');
    if (!qrBox || !qrPanel) return;

    const title = qrPanel.querySelector('h3');
    const desc = qrPanel.querySelector('p');
    const startBtn = $('#demoStart');
    const shareBtn = $('#demoShare');
    const cycle = currentQrCycle();

    ensureProxyManagerUI();
    syncQrKindSelector(cycle);

    if (cycle === 'new_event') {
      renderQrPlaceholder();
      if (pill) pill.textContent = '다음 행사 준비';
      if (title) title.textContent = '새 행사 등록';
      if (desc) desc.textContent = state.event
        ? '이전 행사는 종료되었습니다. 다음 행사를 먼저 등록해주세요.'
        : '새 행사를 등록한 뒤 QR을 생성할 수 있습니다.';
      if (startBtn) startBtn.textContent = '새 행사 등록';
      if (shareBtn) shareBtn.disabled = true;
      return;
    }

    if (cycle === 'refresh') {
      renderQrPlaceholder();
      if (pill) pill.textContent = '행사 종료';
      if (title) title.textContent = '행사가 종료되었습니다';
      if (desc) desc.textContent = 'QR 새로고침을 누르면 다음 행사 등록 단계로 넘어갑니다.';
      if (startBtn) startBtn.textContent = 'QR 새로고침';
      if (shareBtn) shareBtn.disabled = true;
      return;
    }

    if (cycle === 'ready') {
      renderQrPlaceholder();
      if (pill) pill.textContent = '준비 전';
      if (title) title.textContent = '집결지 · 현장 QR';
      if (desc) desc.textContent = '원하는 시간에 QR 생성을 누르면 집결지 QR과 현장 QR이 함께 생성됩니다.';
      if (startBtn) startBtn.textContent = 'QR 생성';
      if (shareBtn) shareBtn.disabled = true;
      return;
    }

    const selectedKind = state.qrView === 'arrival' ? 'arrival' : 'gathering';
    const selectedToken = selectedKind === 'arrival' ? state.arrivalQrToken : state.qrToken;
    const selectedLabel = selectedKind === 'arrival' ? '현장 도착 QR' : '집결지 출석 QR';

    if (!selectedToken?.token) {
      renderQrPlaceholder();
      if (pill) pill.textContent = '진행 중';
      if (title) title.textContent = selectedLabel;
      if (desc) desc.textContent = '행사는 진행 중입니다. QR 정보를 다시 불러오고 있습니다.';
      if (startBtn) startBtn.textContent = '행사 종료';
      if (shareBtn) shareBtn.disabled = false;
      return;
    }

    const target = checkinUrl(selectedToken.token, selectedKind);
    const qrImage =
      'https://quickchart.io/qr?size=320&margin=2&text=' +
      encodeURIComponent(target);

    qrBox.innerHTML = '';
    qrBox.style.cssText =
      'width:260px;height:260px;margin:0 auto 22px;background:#fff;border-radius:22px;padding:12px;box-sizing:border-box;display:grid;place-items:center;';
    const img = document.createElement('img');
    img.src = qrImage;
    img.alt = selectedLabel;
    img.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;';
    qrBox.appendChild(img);

    if (pill) pill.textContent = '진행 중';
    if (title) title.textContent = selectedLabel;
    if (desc) {
      const until = selectedToken.valid_until
        ? new Date(selectedToken.valid_until).toLocaleString('ko-KR', {
            month:'numeric', day:'numeric', hour:'numeric', minute:'2-digit'
          })
        : '';
      const roleText = selectedKind === 'arrival'
        ? '현장 도착 확인용 QR입니다.'
        : '집결지 출석 확인용 QR입니다.';
      desc.textContent = until
        ? `${roleText} ${until}까지 유효하며 행사 종료 시 즉시 폐기됩니다.`
        : `${roleText} 행사 종료 시 즉시 폐기됩니다.`;
    }
    if (startBtn) startBtn.textContent = '행사 종료';
    if (shareBtn) shareBtn.disabled = false;
  }

  function proxyPageUrl(proxyToken) {
    const url = new URL('proxy.html', appBaseUrl());
    url.searchParams.set('p', proxyToken);
    return url.toString();
  }

  async function shareProxyQr() {
    if (!state.event || currentQrCycle() !== 'active') {
      toast('진행 중인 행사에서만 대리 QR을 공유할 수 있습니다.');
      return;
    }

    const selectedKind = state.qrView === 'arrival' ? 'arrival' : 'gathering';
    const selectedToken = selectedKind === 'arrival' ? state.arrivalQrToken : state.qrToken;
    const shareButton = $('#demoShare');

    if (!selectedToken?.token) {
      toast('먼저 사용할 QR을 선택해주세요.');
      return;
    }

    const label = selectedKind === 'arrival' ? '현장 QR' : '집결지 QR';

    if (shareButton) {
      shareButton.disabled = true;
      shareButton.textContent = '대리 QR 준비 중…';
    }

    try {
      const { data, error } = await sb
        .from('qr_tokens')
        .insert({
          event_id: state.event.id,
          kind: 'proxy',
          proxy_target_kind: selectedKind,
          valid_until: null,
          created_by: state.user?.id || null
        })
        .select('id,token,valid_until')
        .single();

      if (error) throw error;

      if ($('#proxyManagerDialog')?.open) {
        await loadProxyTokens();
        renderProxyManager();
      }

      const url = proxyPageUrl(data.token);
      const title = `${state.event.title} · ${label}`;
      const text = `${state.event.title} ${label} 대리 공유입니다. 행사 종료 시 자동으로 만료됩니다.`;

      if (navigator.share) {
        try {
          await navigator.share({ title, text, url });
          toast(`${label} 대리 공유 완료`);
          return;
        } catch (err) {
          if (err?.name === 'AbortError') return;
          console.error('share error:', err);
        }
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        toast(`${label} 대리 링크를 복사했습니다.`);
      } else {
        window.prompt('대리 QR 링크를 복사해주세요.', url);
      }
    } catch (err) {
      console.error('proxy qr create error:', err);
      toast(`대리 QR 생성 실패 · ${err.message || '확인 필요'}`);
    } finally {
      if (shareButton) {
        shareButton.disabled = false;
        shareButton.textContent = '대리 QR 공유';
      }
    }
  }

  async function loadProxyTokens() {
    state.proxyTokens = [];
    if (!state.event) return;

    const { data, error } = await sb
      .from('qr_tokens')
      .select('id,token,proxy_target_kind,is_active,revoked_at,created_at,valid_until')
      .eq('event_id', state.event.id)
      .eq('kind', 'proxy')
      .order('created_at', { ascending:false })
      .limit(100);

    if (error) {
      console.error('proxy token list error:', error);
      return;
    }
    state.proxyTokens = data || [];
  }

  function proxyTokenStatus(token) {
    if (token?.revoked_at || token?.is_active === false) return '폐기됨';
    if (state.event?.status === 'ended') return '행사 종료';
    return '사용 가능';
  }

  function ensureProxyManagerUI() {
    const shareButton = $('#demoShare');
    if (shareButton && !$('#proxyManageButton')) {
      const b = document.createElement('button');
      b.id = 'proxyManageButton';
      b.type = 'button';
      b.className = 'secondary-button';
      b.textContent = '대리 QR 관리';
      b.style.marginTop = '10px';
      b.addEventListener('click', openProxyManager);
      shareButton.insertAdjacentElement('afterend', b);
    }

    if ($('#proxyManagerDialog')) return;

    const style = document.createElement('style');
    style.textContent = `
      #proxyManagerDialog{width:min(calc(100% - 28px),480px);border:0;border-radius:26px;padding:0;background:#fff;box-shadow:0 22px 70px rgba(20,39,45,.24)}
      #proxyManagerDialog::backdrop{background:rgba(18,26,30,.38);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}
      .proxy-manager-body{box-sizing:border-box;padding:22px 18px 20px;max-height:84dvh;overflow-y:auto;-webkit-overflow-scrolling:touch}
      .proxy-manager-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px}
      .proxy-manager-head h2{font-size:22px;margin:0 0 4px}.proxy-manager-head p{margin:0;color:#7f8a90;font-size:12px;line-height:1.45}
      .proxy-manager-close{border:0;background:#f1f3f4;width:38px;height:38px;border-radius:50%;font-size:23px;color:#596267;flex:0 0 auto}
      .proxy-manager-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin:8px 0 13px}
      .proxy-manager-summary div{background:#f7fafb;border-radius:13px;padding:10px 5px;text-align:center}.proxy-manager-summary span{display:block;color:#89949a;font-size:9px;font-weight:800}.proxy-manager-summary b{display:block;font-size:18px;margin-top:3px}
      .proxy-token-row{display:flex;align-items:center;gap:10px;padding:13px 2px;border-top:1px solid #edf1f2}.proxy-token-row:first-child{border-top:0}
      .proxy-token-main{min-width:0;flex:1}.proxy-token-main strong{display:block;font-size:14px}.proxy-token-main small{display:block;color:#7d898f;font-size:11px;margin-top:4px}
      .proxy-token-badge{flex:0 0 auto;border-radius:999px;padding:7px 9px;font-size:10px;font-weight:900;background:#e8faf6;color:#159f93}.proxy-token-badge.off{background:#fff0f1;color:#d94d55}
      .proxy-revoke{flex:0 0 auto;border:1px solid #ffd4d7;background:#fff7f7;color:#d94d55;border-radius:11px;min-height:36px;padding:0 10px;font-size:11px;font-weight:900}.proxy-revoke:disabled{opacity:.45}
      .proxy-empty{padding:22px 6px;text-align:center;color:#88949a;font-size:13px}
    `;
    document.head.appendChild(style);

    const dialog = document.createElement('dialog');
    dialog.id = 'proxyManagerDialog';
    dialog.innerHTML = `
      <div class="proxy-manager-body">
        <div class="proxy-manager-head">
          <div><h2>대리 QR 관리</h2><p>현재 행사에서 발급한 대리 QR을 확인하고 개별 폐기할 수 있습니다.</p></div>
          <button type="button" class="proxy-manager-close" id="proxyManagerClose" aria-label="닫기">×</button>
        </div>
        <div id="proxyManagerContent"></div>
      </div>`;
    document.body.appendChild(dialog);
    $('#proxyManagerClose')?.addEventListener('click', () => dialog.close());
  }

  async function openProxyManager() {
    ensureProxyManagerUI();
    if (!state.event) {
      toast('현재 행사가 없습니다.');
      return;
    }
    $('#proxyManagerDialog')?.showModal();
    const content = $('#proxyManagerContent');
    if (content) content.innerHTML = '<div class="proxy-empty">대리 QR 목록을 불러오는 중…</div>';
    await loadProxyTokens();
    renderProxyManager();
  }

  function renderProxyManager() {
    const content = $('#proxyManagerContent');
    if (!content) return;
    const tokens = state.proxyTokens || [];
    const active = tokens.filter(t => proxyTokenStatus(t) === '사용 가능').length;
    const revoked = tokens.filter(t => proxyTokenStatus(t) === '폐기됨').length;

    content.innerHTML = `
      <div class="proxy-manager-summary">
        <div><span>전체 발급</span><b>${tokens.length}</b></div>
        <div><span>사용 가능</span><b>${active}</b></div>
        <div><span>폐기</span><b>${revoked}</b></div>
      </div>
      ${tokens.length ? tokens.map(token => {
        const label = token.proxy_target_kind === 'arrival' ? '현장 QR' : '집결지 QR';
        const status = proxyTokenStatus(token);
        const canRevoke = status === '사용 가능';
        return `
          <div class="proxy-token-row">
            <div class="proxy-token-main">
              <strong>${escapeHtml(label)} 대리 QR</strong>
              <small>${escapeHtml(formatLogDateTime(token.created_at))} 발급</small>
            </div>
            <span class="proxy-token-badge ${canRevoke ? '' : 'off'}">${escapeHtml(status)}</span>
            <button type="button" class="proxy-revoke" data-revoke-proxy="${escapeHtml(token.id)}" ${canRevoke ? '' : 'disabled'}>폐기</button>
          </div>`;
      }).join('') : '<div class="proxy-empty">아직 발급한 대리 QR이 없습니다.</div>'}
    `;

    $$('[data-revoke-proxy]', content).forEach(button => {
      button.addEventListener('click', () => revokeProxyToken(button.dataset.revokeProxy));
    });
  }

  async function revokeProxyToken(id) {
    const token = state.proxyTokens.find(x => x.id === id);
    if (!token) return;
    const label = token.proxy_target_kind === 'arrival' ? '현장 QR' : '집결지 QR';
    if (!window.confirm(`${label} 대리 QR 하나를 즉시 폐기하시겠습니까?\n다른 QR에는 영향을 주지 않습니다.`)) return;

    const { error } = await sb
      .from('qr_tokens')
      .update({ is_active:false, revoked_at:new Date().toISOString() })
      .eq('id', id)
      .eq('event_id', state.event.id)
      .eq('kind', 'proxy');

    if (error) {
      console.error('proxy revoke error:', error);
      toast(`대리 QR 폐기 실패 · ${error.message || '확인 필요'}`);
      return;
    }
    await loadProxyTokens();
    renderProxyManager();
    toast(`${label} 대리 QR 폐기 완료`);
  }

  function ensureEventRegistrationUI() {
    if ($('#eventRegistrationDialog')) return;

    const style = document.createElement('style');
    style.textContent = `
      #eventRegistrationDialog{
        width:min(calc(100% - 30px),430px);border:0;border-radius:26px;padding:0;
        box-shadow:0 22px 70px rgba(20,39,45,.22);background:#fff
      }
      #eventRegistrationDialog::backdrop{background:rgba(18,26,30,.34);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}
      .event-reg-form{padding:24px 20px 20px}
      .event-reg-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
      .event-reg-head strong{font-size:22px}
      .event-reg-close{border:0;background:#f1f3f4;width:38px;height:38px;border-radius:50%;font-size:23px;color:#596267}
      .event-reg-form label{display:block;font-size:13px;font-weight:850;margin:13px 0 6px}
      .event-reg-form input{box-sizing:border-box;width:100%;height:50px;border:1px solid #dfe7e9;border-radius:15px;padding:0 14px;font-size:16px;background:#fff}
      .roster-choice{display:grid;gap:9px;margin:8px 0 18px}
      .roster-choice label{display:flex;align-items:center;gap:10px;margin:0;padding:13px 14px;border:1px solid #e2e8e9;border-radius:15px;font-size:14px;background:#fbfdfd}
      .roster-choice input{width:20px;height:20px;margin:0;accent-color:#1eb9aa}
      #eventRegistrationMessage{min-height:20px;margin:8px 0;color:#d94d55;font-size:13px;font-weight:750}
    `;
    document.head.appendChild(style);

    const dialog = document.createElement('dialog');
    dialog.id = 'eventRegistrationDialog';
    dialog.innerHTML = `
      <form id="eventRegistrationForm" class="event-reg-form">
        <div class="event-reg-head">
          <strong>새 행사 등록</strong>
          <button type="button" class="event-reg-close" id="eventRegistrationClose" aria-label="닫기">×</button>
        </div>
        <label>행사명</label>
        <input id="newEventTitle" maxlength="80" placeholder="예: 가을 야유회" required>
        <label>행사 날짜</label>
        <input id="newEventDate" type="date" required>
        <label>장소</label>
        <input id="newEventLocation" maxlength="120" placeholder="예: 서울역 1번 출구">
        <label>명단</label>
        <div class="roster-choice" id="newEventRosterChoice">
          <label><input type="radio" name="rosterMode" value="new" checked> 새 명단으로 시작</label>
          <label id="copyPreviousRosterLabel"><input type="radio" name="rosterMode" value="copy"> 이전 행사 명단 불러오기</label>
        </div>
        <div id="eventRegistrationMessage"></div>
        <button type="submit" class="primary-button" id="eventRegistrationSave">행사 등록</button>
      </form>
    `;
    document.body.appendChild(dialog);

    $('#eventRegistrationClose').addEventListener('click', () => dialog.close());
    $('#eventRegistrationForm').addEventListener('submit', createNewEvent);
  }

  function openEventRegistration() {
    ensureEventRegistrationUI();
    const dialog = $('#eventRegistrationDialog');
    const form = $('#eventRegistrationForm');
    const message = $('#eventRegistrationMessage');
    const copyLabel = $('#copyPreviousRosterLabel');

    form?.reset();
    if (message) message.textContent = '';
    if ($('#newEventDate')) $('#newEventDate').value = new Date().toISOString().slice(0,10);
    if (copyLabel) copyLabel.hidden = !state.previousEvent?.id;
    dialog?.showModal();
  }

  async function createNewEvent(e) {
    e.preventDefault();
    if (!state.member?.organization_id || !state.user?.id) return;

    const title = $('#newEventTitle').value.trim();
    const eventDate = $('#newEventDate').value;
    const location = $('#newEventLocation').value.trim();
    const rosterMode = $('input[name="rosterMode"]:checked', $('#eventRegistrationForm'))?.value || 'new';
    const message = $('#eventRegistrationMessage');
    const save = $('#eventRegistrationSave');
    const previousEventId = state.previousEvent?.id || null;

    if (!title || !eventDate) {
      message.textContent = '행사명과 행사 날짜를 입력해주세요.';
      return;
    }

    save.disabled = true;
    save.textContent = '등록 중…';
    message.textContent = '';

    try {
      const { data: created, error } = await sb
        .from('events')
        .insert({
          organization_id: state.member.organization_id,
          title,
          event_date: eventDate,
          location: location || null,
          status: 'draft',
          created_by: state.user.id
        })
        .select('id,title,event_date,location,status,starts_at,ends_at')
        .single();

      if (error) throw error;

      if (rosterMode === 'copy' && previousEventId) {
        const { data: oldLinks, error: oldError } = await sb
          .from('event_participants')
          .select('participant_id')
          .eq('event_id', previousEventId);
        if (oldError) throw oldError;

        const rows = (oldLinks || []).map(x => ({
          event_id: created.id,
          participant_id: x.participant_id
        }));

        if (rows.length) {
          const { error: copyError } = await sb
            .from('event_participants')
            .insert(rows);
          if (copyError) throw copyError;
        }
      }

      state.event = created;
      state.previousEvent = created;
      state.awaitingNewEvent = false;
      state.qrToken = null;
      state.arrivalQrToken = null;
      state.qrView = 'gathering';
      try { localStorage.removeItem(QR_NEXT_EVENT_KEY); } catch {}

      await loadPeople();
      await loadAttendanceLogs();
      subscribeRealtime();
      renderAll();
      queueGoogleSheetsCurrentSync(300);
      $('#eventRegistrationDialog')?.close();
      toast(rosterMode === 'copy' ? '새 행사 등록 · 이전 명단 불러오기 완료' : '새 행사 등록 완료');
    } catch (err) {
      console.error('event create error:', err);
      message.textContent = `행사 등록 실패 · ${err.message || '확인 필요'}`;
    } finally {
      save.disabled = false;
      save.textContent = '행사 등록';
    }
  }

  async function createEventQr() {
    if (!state.event) {
      openEventRegistration();
      return;
    }

    const { data, error } = await sb
      .from('qr_tokens')
      .insert([
        { event_id: state.event.id, kind: 'gathering', valid_until: null },
        { event_id: state.event.id, kind: 'arrival', valid_until: null }
      ])
      .select('id,event_id,kind,token,is_active,valid_from,valid_until,created_at');

    if (error) {
      console.error('QR create error:', error);
      toast(`QR 생성 실패 · ${error.message || error.code || '확인 필요'}`);
      return;
    }

    const gathering = (data || []).find(x => x.kind === 'gathering') || null;
    const arrival = (data || []).find(x => x.kind === 'arrival') || null;
    state.qrToken = gathering;
    state.arrivalQrToken = arrival;
    state.qrView = 'gathering';

    const { error: eventError } = await sb
      .from('events')
      .update({ status:'active' })
      .eq('id', state.event.id);

    if (eventError) {
      console.error('event start error:', eventError);
      toast('QR은 생성됐지만 행사 상태 변경을 확인해주세요.');
    } else {
      state.event.status = 'active';
      renderAll();
      toast('집결지 · 현장 QR 생성 완료');
    }
  }

  async function endCurrentEvent() {
    if (!state.event) return;

    const ok = window.confirm('현재 행사를 종료하시겠습니까?\n종료하면 현재 행사 QR은 더 이상 사용할 수 없습니다.');
    if (!ok) return;

    const { error: qrError } = await sb
      .from('qr_tokens')
      .update({ is_active:false })
      .eq('event_id', state.event.id)
      .eq('is_active', true);

    if (qrError) {
      console.error('QR end error:', qrError);
      toast('QR 종료 처리에 실패했습니다.');
      return;
    }

    const { error: eventError } = await sb
      .from('events')
      .update({ status:'ended' })
      .eq('id', state.event.id);

    if (eventError) {
      console.error('event end error:', eventError);
      toast('행사 종료 처리에 실패했습니다.');
      return;
    }

    state.event.status = 'ended';
    state.qrToken = null;
    state.arrivalQrToken = null;
    state.qrView = 'gathering';
    state.awaitingNewEvent = false;
    clearPopupTimer();
    notificationState.popupItems = [];
    notificationState.bellItems = [];
    notificationState.expanded = false;
    notificationState.eventId = state.event.id;
    saveBellNotificationState();
    renderNotificationCenter();
    updateNotificationBellState();
    if ($('#notificationHistoryDialog')) renderNotificationHistory();
    renderAll();

    const archivedToSheets = await archiveGoogleSheetsEvent(false);
    if (archivedToSheets) {
      await syncGoogleSheetsCurrent(false);
      toast('행사 종료 · QR 폐기 · Google Sheets 보관 완료');
    } else {
      toast('행사 종료 완료 · Google Sheets 보관 상태는 확인해주세요.');
    }
  }

  function prepareNextEvent() {
    if (!state.event || state.event.status !== 'ended') return;
    state.previousEvent = state.event;
    state.awaitingNewEvent = true;
    try { localStorage.setItem(QR_NEXT_EVENT_KEY, state.event.id); } catch {}
    renderQr();
    toast('다음 행사 등록 준비 완료');
  }

  async function startEventQr() {
    const cycle = currentQrCycle();

    if (cycle === 'new_event') {
      openEventRegistration();
      return;
    }
    if (cycle === 'refresh') {
      prepareNextEvent();
      return;
    }
    if (cycle === 'active') {
      await endCurrentEvent();
      return;
    }
    await createEventQr();
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
        (row.attendance_status === 'checked_in' || row.attendance_status === 'arrived' || row.checked_at) ? 'present' :
        'unknown',
      checkedAt: row.checked_at,
      arrivedAt: row.arrived_at
    }));
  }

  async function loadAttendanceLogs() {
    if (!state.event) {
      state.logs = [];
      return;
    }

    const { data, error } = await sb
      .from('attendance_logs')
      .select('id,participant_id,action,source,created_at,participants(name,affiliation)')
      .eq('event_id', state.event.id)
      .order('created_at', { ascending:false })
      .limit(100);

    if (error) {
      console.error('attendance logs load error:', error);
      state.logs = [];
      return;
    }

    state.logs = (data || []).map(row => ({
      id: row.id,
      participantId: row.participant_id,
      name: row.participants?.name || '참가자',
      org: row.participants?.affiliation || '',
      action: row.action || '',
      source: row.source || '',
      createdAt: row.created_at
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
    popupItems: [],
    bellItems: [],
    popupTimer: null,
    freshPopupId: null,
    seenIds: [],
    baselineReady: false,
    eventId: null,
    expanded: false,
    y: null,
    dragging: false,
    moved: false,
    scrolling: false,
    bellStorageKey: 'qr-attendance-bell-v36-8',
    legacyStorageKey: 'qr-attendance-notification-stack-v35',
    seenKey: 'qr-attendance-notification-seen-v35',
    baselineKey: 'qr-attendance-notification-baseline-v35',
    positionKey: 'qr-attendance-notification-position-v21'
  };

  function defaultNotificationY() {
    return Math.round(window.innerHeight * 0.52);
  }

  function loadNotificationState() {
    notificationState.popupItems = [];
    notificationState.freshPopupId = null;
    notificationState.expanded = false;

    try {
      const saved = JSON.parse(localStorage.getItem(notificationState.bellStorageKey) || 'null');
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        notificationState.eventId = saved.eventId || null;
        notificationState.bellItems = Array.isArray(saved.items) ? saved.items : [];
      } else {
        notificationState.bellItems = [];
      }
    } catch {
      notificationState.bellItems = [];
      notificationState.eventId = null;
    }

    // V35~V36.7에서 쓰던 알림 스택은 새 '종 보관함'으로 한 번만 이관합니다.
    if (!notificationState.bellItems.length) {
      try {
        const legacy = JSON.parse(localStorage.getItem(notificationState.legacyStorageKey) || '[]');
        if (Array.isArray(legacy) && legacy.length) {
          notificationState.bellItems = legacy;
        }
      } catch {}
    }

    try {
      const seen = JSON.parse(localStorage.getItem(notificationState.seenKey) || '[]');
      notificationState.seenIds = Array.isArray(seen) ? seen.slice(-5000) : [];
    } catch {
      notificationState.seenIds = [];
    }

    try {
      notificationState.baselineReady = localStorage.getItem(notificationState.baselineKey) === '1';
    } catch {
      notificationState.baselineReady = false;
    }

    try {
      const savedY = Number(localStorage.getItem(notificationState.positionKey));
      notificationState.y = Number.isFinite(savedY) ? savedY : defaultNotificationY();
    } catch {
      notificationState.y = defaultNotificationY();
    }
  }

  function saveBellNotificationState() {
    try {
      localStorage.setItem(
        notificationState.bellStorageKey,
        JSON.stringify({
          eventId: notificationState.eventId || null,
          items: notificationState.bellItems
        })
      );
      localStorage.removeItem(notificationState.legacyStorageKey);
    } catch {}
  }

  function saveSeenNotificationIds() {
    try {
      localStorage.setItem(
        notificationState.seenKey,
        JSON.stringify(notificationState.seenIds.slice(-5000))
      );
    } catch {}
  }

  function markNotificationSeen(id) {
    if (!id || notificationState.seenIds.includes(id)) return;
    notificationState.seenIds.push(id);
    notificationState.seenIds = notificationState.seenIds.slice(-5000);
    saveSeenNotificationIds();
  }

  function markNotificationsSeen(items=[]) {
    items.forEach(item => markNotificationSeen(item?.logId || item?.id));
  }

  function saveNotificationPosition() {
    try {
      if (Number.isFinite(notificationState.y)) {
        localStorage.setItem(notificationState.positionKey, String(notificationState.y));
      }
    } catch {}
  }

  function clearPopupTimer() {
    clearTimeout(notificationState.popupTimer);
    notificationState.popupTimer = null;
  }

  function schedulePopupEmphasisEnd() {
    clearPopupTimer();
    if (!notificationState.freshPopupId || !notificationState.popupItems.length) return;
    const highlightedId = notificationState.freshPopupId;
    notificationState.popupTimer = setTimeout(() => {
      if (notificationState.freshPopupId === highlightedId) {
        notificationState.freshPopupId = null;
        renderNotificationCenter();
      }
      notificationState.popupTimer = null;
    }, 3000);
  }

  function syncNotificationEventScope() {
    const currentId = state.event?.id || null;
    const ended = state.event?.status === 'ended';

    if (!currentId || ended) {
      if (notificationState.popupItems.length || notificationState.bellItems.length || notificationState.eventId) {
        clearPopupTimer();
        notificationState.popupItems = [];
        notificationState.freshPopupId = null;
        notificationState.bellItems = [];
        notificationState.expanded = false;
        notificationState.eventId = currentId;
        saveBellNotificationState();
        renderNotificationCenter();
        updateNotificationBellState();
        if ($('#notificationHistoryDialog')) renderNotificationHistory();
      }
      return;
    }

    if (notificationState.eventId !== currentId) {
      clearPopupTimer();
      notificationState.popupItems = [];
      notificationState.freshPopupId = null;
      notificationState.bellItems = [];
      notificationState.expanded = false;
      notificationState.eventId = currentId;
      saveBellNotificationState();
    }
  }

  function ensureNotificationCenter() {
    if ($('#attendanceNoticeCenter')) return;

    const style = document.createElement('style');
    style.textContent = `
      #attendanceNoticeCenter{
        position:fixed;
        left:16px;
        right:16px;
        top:52%;
        transform:translateY(-50%);
        z-index:9000;
        pointer-events:none;
        transition:top .18s ease;
      }
      #attendanceNoticeCenter.is-empty{display:none}
      #attendanceNoticeCenter.dragging{transition:none}
      #attendanceNoticeStack{position:relative;width:100%;pointer-events:auto}
      #attendanceNoticeStack.collapsed{height:82px;overflow:visible}
      #attendanceNoticeStack.expanded{
        display:flex;flex-direction:column;gap:10px;
        max-height:min(68dvh,620px);overflow-y:auto;
        -webkit-overflow-scrolling:touch;overscroll-behavior:contain;
        scroll-behavior:smooth;padding:4px 0 8px;touch-action:pan-y;
      }
      .attendance-notice{
        position:relative;box-sizing:border-box;width:100%;min-height:72px;
        border-radius:22px;background:rgba(232,232,237,.88);
        border:1px solid rgba(255,255,255,.78);
        box-shadow:0 10px 28px rgba(28,34,40,.18);
        backdrop-filter:blur(24px) saturate(1.18);
        -webkit-backdrop-filter:blur(24px) saturate(1.18);
        display:flex;align-items:center;padding:0 58px 0 18px;
        color:#12181f;font-size:15px;font-weight:800;letter-spacing:-.25px;
        user-select:none;-webkit-user-select:none;touch-action:pan-y;overflow:hidden;
        transition:transform .2s ease,opacity .18s ease;
      }
      .attendance-notice-line{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:100%}
      .attendance-notice .notice-status{color:#0b9184;font-weight:900}
      .attendance-notice[data-status="individual"] .notice-status{color:#7348c7}
      .attendance-notice[data-status="unknown"] .notice-status{color:#d4444b}
      #attendanceNoticeStack.collapsed .attendance-notice{position:absolute;left:0;top:0}
      #attendanceNoticeStack.collapsed .attendance-notice:not(:last-child) .attendance-notice-line{opacity:0}
      #attendanceNoticeStack.collapsed .attendance-notice:nth-last-child(1){z-index:6;transform:translateY(0) scale(1);opacity:1}
      #attendanceNoticeStack.collapsed .attendance-notice:nth-last-child(2){z-index:5;transform:translateY(-9px) scale(.965);opacity:.90}
      #attendanceNoticeStack.collapsed .attendance-notice:nth-last-child(3){z-index:4;transform:translateY(-17px) scale(.93);opacity:.72}
      #attendanceNoticeStack.collapsed .attendance-notice:nth-last-child(n+4){opacity:0;transform:translateY(-23px) scale(.91);pointer-events:none}
      #attendanceNoticeStack.expanded .attendance-notice{position:relative;flex:0 0 auto;transform:none;opacity:1}
      #attendanceNoticeClear{
        position:absolute;right:10px;top:17px;width:40px;height:40px;border:0;border-radius:50%;
        background:rgba(120,120,128,.22);color:#444a50;font-size:24px;line-height:1;
        display:grid;place-items:center;z-index:30;pointer-events:auto;
        backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
      }
      .attendance-notice.is-fresh{
        box-shadow:0 12px 34px rgba(28,34,40,.28),0 0 0 3px rgba(32,185,170,.16);
        animation:attendanceNoticeFresh 1s ease-in-out 3;
      }
      @keyframes attendanceNoticeFresh{
        0%,100%{filter:brightness(1)}
        50%{filter:brightness(1.07)}
      }
      .attendance-notice.swiping{transition:none!important}
      @media(max-width:390px){
        #attendanceNoticeCenter{left:12px;right:12px}
        .attendance-notice{font-size:14px;padding-left:15px;padding-right:56px}
        #attendanceNoticeStack.expanded{max-height:66dvh}
      }
    `;
    document.head.appendChild(style);

    const center = document.createElement('div');
    center.id = 'attendanceNoticeCenter';
    center.className = 'is-empty';
    center.innerHTML = `
      <div id="attendanceNoticeStack" class="collapsed" aria-label="실시간 출석 알림"></div>
      <button id="attendanceNoticeClear" type="button" aria-label="실시간 팝업 전체 삭제">×</button>
    `;
    document.body.appendChild(center);

    installNotificationCenterDrag(center);

    $('#attendanceNoticeClear').addEventListener('click', e => {
      e.stopPropagation();
      clearAllPopupNotifications();
    });

    const stack = $('#attendanceNoticeStack');
    let tapStartX = 0;
    let tapStartY = 0;
    let tapMoved = false;
    let stackSwipeDx = 0;
    let stackGesture = null;

    stack.addEventListener('touchstart', e => {
      const t = e.touches?.[0];
      if (!t) return;
      tapStartX = t.clientX;
      tapStartY = t.clientY;
      tapMoved = false;
      stackSwipeDx = 0;
      stackGesture = null;
      notificationState.scrolling = false;
    }, {passive:true});

    stack.addEventListener('touchmove', e => {
      const t = e.touches?.[0];
      if (!t) return;
      const dx = t.clientX - tapStartX;
      const dy = t.clientY - tapStartY;

      if (!stackGesture && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
        stackGesture = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
      }
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) tapMoved = true;

      if (notificationState.expanded) {
        if (stackGesture === 'vertical') notificationState.scrolling = true;
        return;
      }

      if (stackGesture === 'horizontal' && dx > 0 && notificationState.popupItems.length > 0) {
        e.preventDefault();
        stackSwipeDx = dx;
        stack.style.transition = 'none';
        stack.style.transform = `translateX(${dx}px)`;
        stack.style.opacity = String(Math.max(.18, 1 - dx / 300));
      }
    }, {passive:false});

    stack.addEventListener('touchend', () => {
      if (
        !notificationState.expanded &&
        stackGesture === 'horizontal' &&
        stackSwipeDx > 86 &&
        notificationState.popupItems.length > 0
      ) {
        notificationState.moved = true;
        stack.style.transition = 'transform .18s ease, opacity .16s ease';
        stack.style.transform = 'translateX(120%)';
        stack.style.opacity = '0';
        setTimeout(() => {
          stack.style.transition = '';
          stack.style.transform = '';
          stack.style.opacity = '';
          clearAllPopupNotifications();
          setTimeout(() => { notificationState.moved = false; }, 120);
        }, 170);
      } else {
        stack.style.transition = '';
        stack.style.transform = '';
        stack.style.opacity = '';
      }

      if (notificationState.scrolling) {
        setTimeout(() => { notificationState.scrolling = false; }, 140);
      }
      stackGesture = null;
      stackSwipeDx = 0;
    }, {passive:true});

    stack.addEventListener('touchcancel', () => {
      stack.style.transition = '';
      stack.style.transform = '';
      stack.style.opacity = '';
      stackGesture = null;
      stackSwipeDx = 0;
      notificationState.scrolling = false;
    }, {passive:true});

    stack.addEventListener('click', () => {
      if (notificationState.dragging || notificationState.moved || notificationState.scrolling || tapMoved) return;
      if (notificationState.popupItems.length === 0 || notificationState.expanded) return;
      clearPopupTimer();
      notificationState.expanded = true;
      renderNotificationCenter();
    });
  }

  function clearAllPopupNotifications() {
    clearPopupTimer();
    notificationState.popupItems = [];
    notificationState.freshPopupId = null;
    notificationState.expanded = false;
    renderNotificationCenter();
  }

  function noticeStatusText(status) {
    return ({present:'출석✓',arrived:'현장도착✓',individual:'개인출발',unknown:'미확인'})[status] || '미확인';
  }

  function clampNotificationY(y, center) {
    const rect = center.getBoundingClientRect();
    const height = notificationState.expanded
      ? Math.min(rect.height || 320, window.innerHeight * 0.68)
      : 82;
    const half = Math.max(41, height / 2);
    const topSafe = 78;
    const bottomSafe = 92;
    const minY = topSafe + half;
    const maxY = Math.max(minY, window.innerHeight - bottomSafe - half);
    return Math.min(Math.max(y, minY), maxY);
  }

  function applyNotificationPosition() {
    const center = $('#attendanceNoticeCenter');
    if (!center || !notificationState.popupItems.length) return;
    if (!Number.isFinite(notificationState.y)) notificationState.y = defaultNotificationY();
    requestAnimationFrame(() => {
      notificationState.y = clampNotificationY(notificationState.y, center);
      center.style.top = `${notificationState.y}px`;
    });
  }

  function renderNotificationCenter() {
    ensureNotificationCenter();
    const center = $('#attendanceNoticeCenter');
    const stack = $('#attendanceNoticeStack');
    const clear = $('#attendanceNoticeClear');
    if (!center || !stack) return;

    const items = notificationState.popupItems;
    center.classList.toggle('is-empty', items.length === 0);
    stack.className = notificationState.expanded ? 'expanded' : 'collapsed';
    if (clear) clear.style.display = items.length === 0 ? 'none' : 'grid';

    stack.innerHTML = items.map(item => `
      <div class="attendance-notice ${item.id === notificationState.freshPopupId ? 'is-fresh' : ''}" data-notice-id="${escapeHtml(item.id)}" data-status="${escapeHtml(item.status)}">
        <div class="attendance-notice-line">
          ${escapeHtml(item.name || '이름 없음')}
          <span> · ${escapeHtml(item.phone || '----')}</span>
          <span> · ${escapeHtml(item.org || '소속 없음')}</span>
          <span class="notice-status"> · ${escapeHtml(noticeStatusText(item.status))}</span>
        </div>
      </div>
    `).join('');

    $$('.attendance-notice', stack).forEach(card => {
      if (notificationState.expanded) installNoticeSwipe(card);
      card.addEventListener('click', e => {
        if (!notificationState.expanded || notificationState.scrolling || card.dataset.justSwiped === '1') return;
        e.stopPropagation();
        const item = notificationState.popupItems.find(x => x.id === card.dataset.noticeId);
        if (item) openPopupNotificationParticipant(item);
      });
    });

    applyNotificationPosition();
  }

  function installNotificationCenterDrag(center) {
    let startX = 0;
    let startY = 0;
    let startCenterY = 0;
    let mode = null;
    let moved = false;

    center.addEventListener('touchstart', e => {
      if (notificationState.expanded) return;
      if (e.target.closest('#attendanceNoticeClear')) return;
      const t = e.touches?.[0];
      if (!t) return;
      startX = t.clientX;
      startY = t.clientY;
      const rect = center.getBoundingClientRect();
      startCenterY = rect.top + rect.height / 2;
      mode = null;
      moved = false;
      notificationState.dragging = false;
      notificationState.moved = false;
    }, {passive:true});

    center.addEventListener('touchmove', e => {
      if (notificationState.expanded) return;
      const t = e.touches?.[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (!mode && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        mode = Math.abs(dy) > Math.abs(dx) ? 'drag-y' : 'swipe-x';
      }
      if (mode !== 'drag-y') return;
      e.preventDefault();
      moved = true;
      notificationState.dragging = true;
      notificationState.moved = true;
      center.classList.add('dragging');
      notificationState.y = clampNotificationY(startCenterY + dy, center);
      center.style.top = `${notificationState.y}px`;
    }, {passive:false});

    const finish = () => {
      if (notificationState.dragging) {
        center.classList.remove('dragging');
        saveNotificationPosition();
      }
      notificationState.dragging = false;
      mode = null;
      if (moved) setTimeout(() => { notificationState.moved = false; }, 160);
    };

    center.addEventListener('touchend', finish, {passive:true});
    center.addEventListener('touchcancel', finish, {passive:true});
  }

  function installNoticeSwipe(card) {
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let mode = null;

    card.addEventListener('touchstart', e => {
      const t = e.touches?.[0];
      if (!t) return;
      startX = t.clientX;
      startY = t.clientY;
      dx = 0;
      mode = null;
      card.dataset.justSwiped = '0';
    }, {passive:true});

    card.addEventListener('touchmove', e => {
      const t = e.touches?.[0];
      if (!t) return;
      const rawDx = t.clientX - startX;
      const rawDy = t.clientY - startY;
      if (!mode && (Math.abs(rawDx) > 6 || Math.abs(rawDy) > 6)) {
        mode = Math.abs(rawDx) > Math.abs(rawDy) ? 'horizontal' : 'vertical';
      }
      if (mode !== 'horizontal') return;
      dx = Math.max(0, rawDx);
      if (dx <= 0) return;
      e.preventDefault();
      card.classList.add('swiping');
      card.style.transform = `translateX(${dx}px)`;
      card.style.opacity = String(Math.max(.18, 1 - dx / 280));
    }, {passive:false});

    card.addEventListener('touchend', () => {
      card.classList.remove('swiping');
      if (mode === 'horizontal' && dx > 86) {
        card.dataset.justSwiped = '1';
        const id = card.dataset.noticeId;
        card.style.transform = 'translateX(120%)';
        card.style.opacity = '0';
        setTimeout(() => removePopupNotification(id), 160);
      } else {
        card.style.transform = '';
        card.style.opacity = '';
        setTimeout(() => { card.dataset.justSwiped = '0'; }, 100);
      }
      mode = null;
      dx = 0;
    }, {passive:true});
  }

  function removePopupNotification(id) {
    notificationState.popupItems = notificationState.popupItems.filter(x => x.id !== id);
    if (notificationState.freshPopupId === id) notificationState.freshPopupId = null;
    if (notificationState.popupItems.length <= 1) notificationState.expanded = false;
    renderNotificationCenter();
  }

  function resolveNotificationPerson(item) {
    if (!item) return null;
    return state.people.find(p => item.participantId && p.participantId === item.participantId)
      || state.people.find(p => item.linkId && p.linkId === item.linkId)
      || state.people.find(p => p.name === item.name && p.phone === item.phone)
      || state.people.find(p => p.name === item.name)
      || null;
  }

  function navigateToNotificationParticipant(item) {
    if (!item) return;
    const person = resolveNotificationPerson(item);

    state.rosterSelectMode = false;
    state.rosterSelectedIds = [];
    state.filter = 'all';
    state.search = '';
    $$('.chip').forEach(chip => chip.classList.toggle('active', chip.dataset.filter === 'all'));
    if ($('#searchInput')) $('#searchInput').value = '';

    go('roster');
    renderPeople();

    if (!person) {
      toast('현재 행사 명단에서 참가자를 찾을 수 없습니다.');
      return;
    }

    requestAnimationFrame(() => {
      const card = $$('.person-card', $('#peopleList')).find(el =>
        el.dataset.participantId === person.participantId || el.dataset.linkId === person.linkId
      );
      if (!card) {
        toast(`${person.name} 참가자를 현재 명단에서 찾을 수 없습니다.`);
        return;
      }
      card.classList.add('notification-focus');
      card.scrollIntoView({behavior:'smooth', block:'center'});
      setTimeout(() => card.classList.remove('notification-focus'), 2600);
    });
  }

  function openPopupNotificationParticipant(item) {
    if (!item) return;
    removePopupNotification(item.id);
    navigateToNotificationParticipant(item);
  }

  function isQrNotificationLog(log) {
    return Boolean(log && log.source === 'qr' && (log.action === 'check_in' || log.action === 'arrival'));
  }

  function notificationItemFromLog(log) {
    if (!isQrNotificationLog(log)) return null;
    const person = state.people.find(p => p.participantId === log.participantId) || {};
    const id = log.id || `${log.participantId || 'qr'}-${log.createdAt || Date.now()}`;
    return {
      id,
      logId: log.id || id,
      eventId: state.event?.id || '',
      name: person.name || log.name || '이름 없음',
      phone: person.phone || '----',
      org: person.org || log.org || '소속 없음',
      participantId: log.participantId || person.participantId || '',
      linkId: person.linkId || '',
      status: log.action === 'arrival' ? 'arrived' : 'present',
      createdAt: log.createdAt || new Date().toISOString()
    };
  }

  function addBellNotification(item) {
    if (!item) return;
    syncNotificationEventScope();
    const id = item.logId || item.id;
    if (!notificationState.bellItems.some(x => (x.logId || x.id) === id)) {
      notificationState.bellItems.push(item);
    }
    markNotificationSeen(id);
    saveBellNotificationState();
    updateNotificationBellState();
    if ($('#notificationHistoryDialog')?.open) renderNotificationHistory();
  }

  function showLiveQrNotification(item) {
    if (!item) return;
    syncNotificationEventScope();
    addBellNotification(item);

    const toggle = $('#popupToggle');
    if (toggle && !toggle.checked) return;

    const id = item.logId || item.id;
    if (!notificationState.popupItems.some(x => (x.logId || x.id) === id)) {
      notificationState.popupItems.push(item);
      notificationState.popupItems = notificationState.popupItems.slice(-30);
    }
    notificationState.freshPopupId = item.id;
    notificationState.y = defaultNotificationY();
    saveNotificationPosition();
    renderNotificationCenter();
    schedulePopupEmphasisEnd();
  }

  function saveNotificationBaseline() {
    try {
      localStorage.setItem(notificationState.baselineKey, '1');
      notificationState.baselineReady = true;
    } catch {}
  }

  function recoverMissedQrNotifications() {
    syncNotificationEventScope();
    if (!state.event || state.event.status === 'ended') return;

    const qrLogs = state.logs
      .filter(isQrNotificationLog)
      .slice()
      .sort((a,b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));

    if (!notificationState.baselineReady) {
      markNotificationsSeen(qrLogs.map(log => ({logId:log.id})));
      saveNotificationBaseline();
      return;
    }

    const bellIds = new Set(notificationState.bellItems.map(x => x.logId || x.id));
    const unseen = qrLogs.filter(log =>
      log.id && !notificationState.seenIds.includes(log.id) && !bellIds.has(log.id)
    );
    if (!unseen.length) return;

    const items = unseen.map(notificationItemFromLog).filter(Boolean);
    if (!items.length) return;

    items.forEach(item => {
      notificationState.bellItems.push(item);
      markNotificationSeen(item.logId || item.id);
    });
    saveBellNotificationState();
    updateNotificationBellState();
    if ($('#notificationHistoryDialog')?.open) renderNotificationHistory();
  }

  function updateNotificationBellState() {
    const dot = $('#notificationButton .notice-dot');
    if (!dot) return;
    dot.hidden = notificationState.bellItems.length === 0;
  }

  function ensureNotificationHistoryUI() {
    if ($('#notificationHistoryDialog')) return;

    const style = document.createElement('style');
    style.textContent = `
      #notificationHistoryDialog{width:min(calc(100% - 28px),460px);border:0;border-radius:26px;padding:0;background:#fff;box-shadow:0 22px 70px rgba(20,39,45,.24)}
      #notificationHistoryDialog::backdrop{background:rgba(18,26,30,.38);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}
      .notice-history-body{box-sizing:border-box;padding:22px 18px 20px;max-height:84dvh;overflow-y:auto;-webkit-overflow-scrolling:touch}
      .notice-history-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}.notice-history-head h2{font-size:22px;margin:0 0 4px}.notice-history-head p{margin:0;color:#7f8a90;font-size:12px;line-height:1.45}
      .notice-history-close{border:0;background:#f1f3f4;width:38px;height:38px;border-radius:50%;font-size:23px;color:#596267;flex:0 0 auto}
      .notice-history-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 2px;border-top:1px solid #edf1f2}.notice-history-row:first-child{border-top:0}
      .notice-history-main{min-width:0;flex:1}.notice-history-main strong{display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.notice-history-main small{display:block;color:#7d898f;font-size:11px;margin-top:4px}
      .notice-history-type{flex:0 0 auto;border-radius:999px;padding:7px 9px;background:#e8faf6;color:#159f93;font-size:10px;font-weight:900}
      .notice-history-delete{flex:0 0 auto;width:34px;height:34px;border:0;border-radius:50%;background:#f1f3f4;color:#6b7479;font-size:20px;line-height:1}
      .notice-history-empty{padding:26px 8px;text-align:center;color:#879399;font-size:13px}
      .notice-history-clear{width:100%;height:44px;border:1px solid #ffd6d9;background:#fff6f6;color:#d94d55;border-radius:13px;font-weight:850;margin-top:12px}
    `;
    document.head.appendChild(style);

    const dialog = document.createElement('dialog');
    dialog.id = 'notificationHistoryDialog';
    dialog.innerHTML = `
      <div class="notice-history-body">
        <div class="notice-history-head">
          <div><h2>출석 알림</h2><p>현재 행사에서 QR로 발생한 변화를 관리자가 삭제할 때까지 보관합니다.</p></div>
          <button type="button" class="notice-history-close" id="notificationHistoryClose" aria-label="닫기">×</button>
        </div>
        <div id="notificationHistoryList"></div>
        <button type="button" class="notice-history-clear" id="notificationHistoryClear">전체 삭제</button>
      </div>`;
    document.body.appendChild(dialog);

    $('#notificationHistoryClose')?.addEventListener('click', () => dialog.close());
    $('#notificationHistoryClear')?.addEventListener('click', () => {
      notificationState.bellItems = [];
      saveBellNotificationState();
      renderNotificationHistory();
      updateNotificationBellState();
    });

    $('#notificationHistoryList')?.addEventListener('click', e => {
      const button = e.target.closest('[data-bell-delete]');
      if (!button) return;
      e.stopPropagation();
      removeBellNotification(button.dataset.bellDelete);
    });
  }

  function removeBellNotification(id) {
    notificationState.bellItems = notificationState.bellItems.filter(x => x.id !== id);
    saveBellNotificationState();
    renderNotificationHistory();
    updateNotificationBellState();
  }

  function renderNotificationHistory() {
    ensureNotificationHistoryUI();
    const list = $('#notificationHistoryList');
    if (!list) return;
    const items = notificationState.bellItems.slice().sort((a,b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const clear = $('#notificationHistoryClear');
    if (clear) clear.hidden = items.length === 0;
    list.innerHTML = items.length ? items.map(item => `
      <div class="notice-history-row">
        <div class="notice-history-main">
          <strong>${escapeHtml(item.name || '참가자')}${item.org ? ` · ${escapeHtml(item.org)}` : ''}</strong>
          <small>${escapeHtml(formatLogDateTime(item.createdAt))}</small>
        </div>
        <span class="notice-history-type">${item.status === 'arrived' ? '현장도착' : 'QR 출석'}</span>
        <button type="button" class="notice-history-delete" data-bell-delete="${escapeHtml(item.id)}" aria-label="이 알림 삭제">×</button>
      </div>
    `).join('') : '<div class="notice-history-empty">현재 행사에 저장된 QR 알림이 없습니다.</div>';
  }

  async function openNotificationHistory() {
    syncNotificationEventScope();
    ensureNotificationHistoryUI();
    renderNotificationHistory();
    updateNotificationBellState();
    $('#notificationHistoryDialog')?.showModal();
  }

  function ensureParticipantEditUI() {
    if ($('#participantEditDialog')) return;

    const dialog = document.createElement('dialog');
    dialog.id = 'participantEditDialog';
    dialog.style.cssText = 'width:min(calc(100% - 34px),420px);border:0;border-radius:26px;padding:0;box-shadow:0 22px 70px rgba(20,39,45,.22);background:#fff;';
    dialog.innerHTML = `
      <form id="participantEditForm" style="padding:24px 20px 20px;background:#fff;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
          <strong style="font-size:22px;">참가자 수정</strong>
          <button type="button" id="participantEditClose" aria-label="닫기"
            style="border:0;background:#f1f3f4;width:38px;height:38px;border-radius:50%;font-size:23px;color:#596267;">×</button>
        </div>

        <input id="participantEditLinkId" type="hidden">
        <input id="participantEditParticipantId" type="hidden">

        <label style="display:block;font-size:13px;font-weight:850;margin:13px 0 6px;">이름</label>
        <input id="participantEditName" maxlength="30" required
          style="box-sizing:border-box;width:100%;height:50px;border:1px solid #dfe7e9;border-radius:15px;padding:0 14px;font-size:16px;">

        <label style="display:block;font-size:13px;font-weight:850;margin:13px 0 6px;">소속</label>
        <input id="participantEditOrg" maxlength="50"
          style="box-sizing:border-box;width:100%;height:50px;border:1px solid #dfe7e9;border-radius:15px;padding:0 14px;font-size:16px;">

        <label style="display:block;font-size:13px;font-weight:850;margin:13px 0 6px;">전화번호 뒤 4자리</label>
        <input id="participantEditPhone" inputmode="numeric" maxlength="4" pattern="[0-9]{4}"
          style="box-sizing:border-box;width:100%;height:50px;border:1px solid #dfe7e9;border-radius:15px;padding:0 14px;font-size:16px;">

        <div id="participantEditMessage" style="min-height:20px;margin:10px 0 4px;color:#d94d55;font-size:13px;font-weight:750;"></div>

        <button type="submit" class="primary-button" id="participantEditSave" style="width:100%;">저장</button>
        <button type="button" id="participantEditDelete"
          style="width:100%;height:50px;border:1px solid #ffd6d9;background:#fff6f6;color:#d94d55;border-radius:15px;font-weight:850;margin-top:10px;">
          현재 행사에서 삭제
        </button>
      </form>
    `;
    document.body.appendChild(dialog);

    $('#participantEditClose')?.addEventListener('click', () => {
      $('#participantEditForm')?.reset();
      dialog.close();
    });

    $('#participantEditPhone')?.addEventListener('input', e => {
      e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
    });

    $('#participantEditForm')?.addEventListener('submit', saveParticipantEdit);
    $('#participantEditDelete')?.addEventListener('click', deleteParticipantFromEvent);
  }

  function openParticipantEdit(linkId) {
    ensureParticipantEditUI();
    const person = state.people.find(p => p.linkId === linkId);
    if (!person) return;

    $('#participantEditLinkId').value = person.linkId || '';
    $('#participantEditParticipantId').value = person.participantId || '';
    $('#participantEditName').value = person.name || '';
    $('#participantEditOrg').value = person.org || '';
    $('#participantEditPhone').value = person.phone || '';
    $('#participantEditMessage').textContent = '';
    $('#participantEditDialog')?.showModal();
  }

  async function saveParticipantEdit(e) {
    e.preventDefault();

    const participantId = $('#participantEditParticipantId').value;
    const name = $('#participantEditName').value.trim();
    const affiliation = $('#participantEditOrg').value.trim();
    const phone_last4 = $('#participantEditPhone').value.trim();
    const message = $('#participantEditMessage');
    const save = $('#participantEditSave');

    if (!participantId || !name) {
      message.textContent = '이름을 입력해주세요.';
      return;
    }
    if (phone_last4 && !/^\d{4}$/.test(phone_last4)) {
      message.textContent = '전화번호 뒤 4자리는 숫자 4자리로 입력해주세요.';
      return;
    }

    save.disabled = true;
    save.textContent = '저장 중…';
    message.textContent = '';

    const { error } = await sb
      .from('participants')
      .update({
        name,
        affiliation: affiliation || null,
        phone_last4: phone_last4 || null
      })
      .eq('id', participantId)
      .eq('organization_id', state.member.organization_id);

    save.disabled = false;
    save.textContent = '저장';

    if (error) {
      console.error('participant edit error:', error);
      message.textContent = `수정 실패 · ${error.message || '확인 필요'}`;
      return;
    }

    await loadPeople();
    renderAll();
    queueGoogleSheetsCurrentSync();
    $('#participantEditDialog')?.close();
    toast(`${name} 수정 완료`);
  }

  async function deleteParticipantFromEvent() {
    const linkId = $('#participantEditLinkId').value;
    const name = $('#participantEditName').value.trim() || '참가자';
    if (!linkId || !state.event) return;

    const ok = window.confirm(`${name}님을 현재 행사 명단에서 삭제하시겠습니까?\n이전 행사 기록에는 영향을 주지 않습니다.`);
    if (!ok) return;

    const button = $('#participantEditDelete');
    button.disabled = true;
    button.textContent = '삭제 중…';

    const { error } = await sb
      .from('event_participants')
      .delete()
      .eq('id', linkId)
      .eq('event_id', state.event.id);

    button.disabled = false;
    button.textContent = '현재 행사에서 삭제';

    if (error) {
      console.error('participant unlink error:', error);
      $('#participantEditMessage').textContent = `삭제 실패 · ${error.message || '확인 필요'}`;
      return;
    }

    await loadPeople();
    renderAll();
    queueGoogleSheetsCurrentSync();
    $('#participantEditDialog')?.close();
    toast(`${name} 명단에서 삭제 완료`);
  }

  function ensureRosterBulkUI() {
    const screen = $('[data-screen="roster"]');
    const add = $('#addPersonButton');
    if (!screen || !add) return;

    if (!$('#rosterSelectButton')) {
      const select = document.createElement('button');
      select.id = 'rosterSelectButton';
      select.type = 'button';
      select.className = 'small-add';
      select.textContent = '선택';
      select.style.cssText = 'margin-right:8px;background:#f2f7f7;color:#65747b;';
      select.addEventListener('click', () => setRosterSelectMode(!state.rosterSelectMode));
      add.insertAdjacentElement('beforebegin', select);
    }

    if (!$('#rosterBulkBar')) {
      const style = document.createElement('style');
      style.textContent = `
        .roster-pick{flex:0 0 auto;width:30px;height:30px;border:2px solid #cbd7d9;border-radius:50%;background:#fff;display:grid;place-items:center;color:#fff;font-size:16px;font-weight:900;padding:0}
        .roster-pick.selected{background:#20c4b4;border-color:#20c4b4}.person-card.roster-selected{outline:2px solid rgba(32,196,180,.32);background:#fbfffe}
        .person-card.notification-focus{outline:3px solid rgba(32,196,180,.56);box-shadow:0 0 0 7px rgba(32,196,180,.10),0 10px 28px rgba(24,96,88,.14);transition:outline-color .25s ease,box-shadow .25s ease}
        #rosterBulkBar{position:fixed;left:16px;right:16px;bottom:calc(82px + env(safe-area-inset-bottom));z-index:1200;display:grid;grid-template-columns:1fr 1.25fr .8fr;gap:8px;padding:10px;border-radius:18px;background:rgba(255,255,255,.95);border:1px solid #e0e8e9;box-shadow:0 12px 34px rgba(27,51,58,.18);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)}
        #rosterBulkBar[hidden]{display:none}#rosterBulkBar button{min-height:44px;border-radius:13px;border:1px solid #dfe7e8;background:#fff;font-weight:900;color:#617178}#rosterBulkDelete{background:#fff3f4!important;border-color:#ffd5d8!important;color:#d94d55!important}#rosterBulkDelete:disabled{opacity:.45}
        @media(min-width:700px){#rosterBulkBar{left:50%;right:auto;width:min(760px,calc(100% - 40px));transform:translateX(-50%)}}
      `;
      document.head.appendChild(style);
      const bar = document.createElement('div');
      bar.id = 'rosterBulkBar';
      bar.hidden = true;
      bar.innerHTML = `<button type="button" id="rosterSelectAll">전체선택</button><button type="button" id="rosterBulkDelete" disabled>선택삭제 (0)</button><button type="button" id="rosterBulkCancel">취소</button>`;
      document.body.appendChild(bar);
      $('#rosterSelectAll')?.addEventListener('click', selectAllRosterPeople);
      $('#rosterBulkDelete')?.addEventListener('click', deleteSelectedRosterPeople);
      $('#rosterBulkCancel')?.addEventListener('click', () => setRosterSelectMode(false));
    }
    updateRosterBulkUI();
  }

  function setRosterSelectMode(enabled) {
    state.rosterSelectMode = Boolean(enabled);
    if (!state.rosterSelectMode) state.rosterSelectedIds = [];
    ensureRosterBulkUI();
    renderPeople();
    updateRosterBulkUI();
  }

  function updateRosterBulkUI() {
    const bar = $('#rosterBulkBar');
    const selectButton = $('#rosterSelectButton');
    const del = $('#rosterBulkDelete');
    const all = $('#rosterSelectAll');
    const count = state.rosterSelectedIds.length;
    if (bar) bar.hidden = !state.rosterSelectMode;
    if (selectButton) selectButton.textContent = state.rosterSelectMode ? '선택 중' : '선택';
    if (del) { del.textContent = `선택삭제 (${count})`; del.disabled = count === 0; }
    if (all) all.textContent = state.people.length > 0 && count === state.people.length ? '전체해제' : '전체선택';
  }

  function toggleRosterSelection(linkId) {
    const set = new Set(state.rosterSelectedIds);
    if (set.has(linkId)) set.delete(linkId); else set.add(linkId);
    state.rosterSelectedIds = [...set];
    renderPeople();
    updateRosterBulkUI();
  }

  function selectAllRosterPeople() {
    if (state.rosterSelectedIds.length === state.people.length) state.rosterSelectedIds = [];
    else state.rosterSelectedIds = state.people.map(p => p.linkId);
    renderPeople();
    updateRosterBulkUI();
  }

  async function deleteSelectedRosterPeople() {
    if (!state.event || !state.rosterSelectedIds.length) return;
    const ids = [...state.rosterSelectedIds];
    if (!window.confirm(`선택한 ${ids.length}명을 현재 행사 명단에서 삭제하시겠습니까?\n지난 행사 기록에는 영향을 주지 않습니다.`)) return;

    const button = $('#rosterBulkDelete');
    if (button) { button.disabled = true; button.textContent = '삭제 중…'; }
    try {
      for (let i = 0; i < ids.length; i += 100) {
        const { error } = await sb
          .from('event_participants')
          .delete()
          .eq('event_id', state.event.id)
          .in('id', ids.slice(i, i + 100));
        if (error) throw error;
      }
      state.rosterSelectedIds = [];
      state.rosterSelectMode = false;
      await loadPeople();
      renderAll();
      queueGoogleSheetsCurrentSync();
      updateRosterBulkUI();
      toast(`${ids.length}명 현재 행사 명단에서 삭제 완료`);
    } catch (error) {
      console.error('bulk roster delete error:', error);
      toast(`선택 삭제 실패 · ${error.message || '확인 필요'}`);
      updateRosterBulkUI();
    }
  }

  function renderPeople() {
    ensureRosterBulkUI();
    const list = $('#peopleList');
    if (!list) return;

    const rows = filteredPeople();
    const selected = new Set(state.rosterSelectedIds);

    if (!state.event) {
      list.innerHTML = '<div class="empty-state">먼저 행사를 등록해주세요.</div>';
      return;
    }

    if (!rows.length) {
      list.innerHTML = '<div class="empty-state">등록된 참가자가 없습니다.</div>';
      return;
    }

    list.innerHTML = rows.map(p => `
      <div class="person-card ${selected.has(p.linkId) ? 'roster-selected' : ''}" data-link-id="${escapeHtml(p.linkId || '')}" data-participant-id="${escapeHtml(p.participantId || '')}">
        ${state.rosterSelectMode ? `<button type="button" class="roster-pick ${selected.has(p.linkId) ? 'selected' : ''}" data-roster-pick="${p.linkId}" aria-label="${escapeHtml(p.name)} 선택">${selected.has(p.linkId) ? '✓' : ''}</button>` : ''}
        <div class="avatar">${escapeHtml(p.name.slice(0,1))}</div>
        <div class="person-main">
          <strong>${escapeHtml(p.name)}</strong>
          <small>${escapeHtml(p.org || '소속 없음')}${p.phone ? ` · •••• ${escapeHtml(p.phone)}` : ''}</small>
          ${p.arrivedAt
            ? `<small style="color:#0b9184;font-weight:850;">현장 도착 ${escapeHtml(formatCheckTime(p.arrivedAt))}</small>`
            : ''}
        </div>
        ${state.rosterSelectMode ? '' : `
          <button type="button" data-edit-person="${p.linkId}" aria-label="${escapeHtml(p.name)} 수정"
            style="flex:0 0 auto;width:34px;height:34px;border:0;border-radius:11px;background:#f1f6f6;color:#65747b;font-size:18px;font-weight:900;display:grid;place-items:center;">✎</button>
          <div style="display:flex;align-items:center;gap:6px;flex:0 0 auto;">
            ${p.status === 'present' && p.checkedAt
              ? `<span class="status-button present" style="width:58px;height:32px;padding:0;display:inline-flex;align-items:center;justify-content:center;">${escapeHtml(formatCheckTime(p.checkedAt))}</span>`
              : ''}
            <button class="status-button ${p.status}" data-person="${p.linkId}"${state.event?.status === 'ended' ? ' disabled aria-disabled="true"' : ''}${p.status === 'present' ? ' style="width:58px;height:32px;padding:0;display:inline-flex;align-items:center;justify-content:center;"' : ''}>
              ${personStatusLabel(p)}
            </button>
          </div>`}
      </div>
    `).join('');

    $$('[data-roster-pick]', list).forEach(b => b.addEventListener('click', () => toggleRosterSelection(b.dataset.rosterPick)));
    $$('[data-person]', list).forEach(b => b.addEventListener('click', () => cycleStatus(b.dataset.person)));
    $$('[data-edit-person]', list).forEach(b => b.addEventListener('click', () => openParticipantEdit(b.dataset.editPerson)));
    updateRosterBulkUI();
  }

  function ensureStatusDashboardUI() {
    const screen = $('[data-screen="status"]');
    if (!screen || $('#statusDetailStats')) return;

    const style = document.createElement('style');
    style.textContent = `
      #statusScopeBar{display:flex;gap:7px;overflow-x:auto;padding:0 0 10px;scrollbar-width:none}#statusScopeBar::-webkit-scrollbar{display:none}
      .status-scope-button{flex:0 0 auto;min-height:38px;border:1px solid #e0e7e8;border-radius:999px;background:#fff;color:#7a868c;padding:0 13px;font-size:12px;font-weight:900}.status-scope-button.active{background:#141a1f;color:#fff;border-color:#141a1f}.status-scope-reset{margin-left:auto;background:#f4f8f8;color:#159f93;border-color:#dcebea}
      #statusScopeCaption{color:#7f8b90;font-size:11px;font-weight:800;margin:-2px 0 10px}
      #statusDetailStats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:12px 0 14px}
      .status-detail-stat{background:#fff;border:1px solid #e8edef;border-radius:18px;padding:14px 15px;box-shadow:0 5px 16px rgba(27,51,58,.04)}
      .status-detail-stat span{display:block;color:#7c878d;font-size:12px;font-weight:800;margin-bottom:5px}.status-detail-stat strong{font-size:24px;line-height:1;font-weight:900;color:#20292d}
      .status-history-card{margin-top:14px;background:#fff;border:1px solid #e8edef;border-radius:20px;padding:17px 15px 8px}.status-history-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}.status-history-head strong{font-size:17px}.status-history-head small{color:#8a959b;font-size:12px;font-weight:750}
      .status-log-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 2px;border-top:1px solid #eef2f3}.status-log-row:first-child{border-top:0}.status-log-main{min-width:0}.status-log-main strong{display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.status-log-main small{display:block;color:#7d888e;font-size:12px;margin-top:3px}.status-log-side{flex:0 0 auto;text-align:right}.status-log-side b{display:block;color:#159f93;font-size:13px}.status-log-side small{display:block;color:#929ca1;font-size:11px;margin-top:3px}.status-log-empty{padding:20px 4px;color:#8a959b;text-align:center;font-size:13px}
      .status-event-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 2px;border-top:1px solid #eef2f3}.status-event-row:first-child{border-top:0}.status-event-row strong{display:block;font-size:14px}.status-event-row small{display:block;color:#7f8b91;font-size:11px;margin-top:4px}.status-event-counts{flex:0 0 auto;text-align:right;font-size:10px;color:#738087;line-height:1.5}.status-event-counts b{color:#159f93;font-size:12px}
      @media(min-width:700px){#statusDetailStats{grid-template-columns:repeat(5,minmax(0,1fr))}}
    `;
    document.head.appendChild(style);

    const summary = $('.summary-card', screen);
    const scope = document.createElement('div');
    scope.innerHTML = `
      <div id="statusScopeBar">
        <button type="button" class="status-scope-button active" data-status-scope="current">현재행사</button>
        <button type="button" class="status-scope-button" data-status-scope="day">일별</button>
        <button type="button" class="status-scope-button" data-status-scope="week">주별</button>
        <button type="button" class="status-scope-button" data-status-scope="month">월별</button>
        <button type="button" class="status-scope-button" data-status-scope="all">전체</button>
        <button type="button" class="status-scope-button status-scope-reset" id="statusScopeReset">초기화</button>
      </div>
      <div id="statusScopeCaption">현재 진행 행사 기준</div>`;
    summary?.insertAdjacentElement('beforebegin', scope);

    $$('[data-status-scope]', scope).forEach(button => button.addEventListener('click', () => changeStatusScope(button.dataset.statusScope)));
    $('#statusScopeReset')?.addEventListener('click', () => changeStatusScope('current'));

    const detail = document.createElement('div');
    detail.id = 'statusDetailStats';
    detail.innerHTML = `
      <div class="status-detail-stat"><span>전체</span><strong id="statusTotal">0</strong></div>
      <div class="status-detail-stat"><span>출석</span><strong id="statusPresent">0</strong></div>
      <div class="status-detail-stat"><span>현장도착</span><strong id="statusArrived">0</strong></div>
      <div class="status-detail-stat"><span>개인출발</span><strong id="statusIndividual">0</strong></div>
      <div class="status-detail-stat"><span>미확인</span><strong id="statusUnknown">0</strong></div>`;
    summary?.insertAdjacentElement('afterend', detail);

    const statusList = $('#statusList');
    const history = document.createElement('div');
    history.className = 'status-history-card';
    history.innerHTML = `<div class="status-history-head"><strong id="statusHistoryTitle">출석 기록</strong><small id="statusLogCount">0건</small></div><div id="statusHistoryList"></div>`;
    statusList?.insertAdjacentElement('afterend', history);
  }

  function attendanceActionLabel(action) {
    return ({check_in:'QR 출석',manual_check_in:'수동 출석',arrival:'현장 도착',set_individual:'개인출발',set_bus:'버스출발',manual_uncheck:'미확인 변경',mark_absent:'결석',correction:'정정'})[action] || '상태 변경';
  }

  function attendanceSourceLabel(source) {
    return source === 'qr' ? 'QR' : source === 'manual' ? '수동' : (source || '시스템');
  }

  function formatLogDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('ko-KR', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
  }

  function localDateKey(date=new Date()) {
    const d = new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }

  function statusScopeRange(scope) {
    const now = state.event?.event_date ? new Date(`${state.event.event_date}T12:00:00`) : new Date();
    if (scope === 'day') {
      const key = localDateKey(now); return { start:key, end:key, caption:`오늘 ${key}` };
    }
    if (scope === 'week') {
      const start = new Date(now); const dow = (start.getDay()+6)%7; start.setDate(start.getDate()-dow);
      const end = new Date(start); end.setDate(end.getDate()+6);
      return { start:localDateKey(start), end:localDateKey(end), caption:`이번 주 ${localDateKey(start)} ~ ${localDateKey(end)}` };
    }
    if (scope === 'month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1); const end = new Date(now.getFullYear(), now.getMonth()+1, 0);
      return { start:localDateKey(start), end:localDateKey(end), caption:`이번 달 ${now.getFullYear()}년 ${now.getMonth()+1}월` };
    }
    return { start:null, end:null, caption:'모든 행사 누적' };
  }

  async function changeStatusScope(scope='current') {
    state.statusScope = ['current','day','week','month','all'].includes(scope) ? scope : 'current';
    ensureStatusDashboardUI();
    $$('[data-status-scope]').forEach(b => b.classList.toggle('active', b.dataset.statusScope === state.statusScope));
    if (state.statusScope === 'current') {
      state.statusAggregate = null;
      await loadAttendanceLogs();
      renderStatus();
      return;
    }
    await loadStatusAggregate(state.statusScope);
    renderStatus();
  }

  async function loadStatusAggregate(scope) {
    if (!state.member?.organization_id) return;
    state.statusLoading = true;
    state.statusAggregate = null;
    renderStatus();
    try {
      const range = statusScopeRange(scope);
      let q = sb.from('events').select('id,title,event_date,location,status').eq('organization_id', state.member.organization_id).order('event_date',{ascending:false}).limit(300);
      if (range.start) q = q.gte('event_date', range.start);
      if (range.end) q = q.lte('event_date', range.end);
      const { data:events, error:eventError } = await q;
      if (eventError) throw eventError;
      const eventList = events || [];
      const ids = eventList.map(e => e.id);
      if (!ids.length) {
        state.statusAggregate = { events:[], rows:[], logs:[], counts:{total:0,present:0,arrived:0,individual:0,unknown:0}, caption:range.caption };
        return;
      }

      const rows = [];
      const logs = [];
      for (let i=0;i<ids.length;i+=80) {
        const batch = ids.slice(i,i+80);
        const [{data:partData,error:partError},{data:logData,error:logError}] = await Promise.all([
          sb.from('event_participants').select('event_id,participant_id,travel_mode,attendance_status,checked_at,arrived_at,participants(name,affiliation,phone_last4)').in('event_id',batch),
          sb.from('attendance_logs').select('id,event_id,participant_id,action,source,created_at,participants(name,affiliation)').in('event_id',batch).order('created_at',{ascending:false}).limit(500)
        ]);
        if (partError) throw partError;
        if (logError) throw logError;
        rows.push(...(partData||[])); logs.push(...(logData||[]));
      }

      const eventMap = new Map(eventList.map(e => [e.id,e]));
      const mappedLogs = logs.map(row => ({id:row.id,eventId:row.event_id,eventTitle:eventMap.get(row.event_id)?.title||'행사',eventDate:eventMap.get(row.event_id)?.event_date||'',participantId:row.participant_id,name:row.participants?.name||'참가자',org:row.participants?.affiliation||'',action:row.action||'',source:row.source||'',createdAt:row.created_at})).sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0)).slice(0,500);
      const classify = row => {
        const individual = row.travel_mode === 'individual';
        const present = !individual && (row.attendance_status === 'checked_in' || row.attendance_status === 'arrived' || Boolean(row.checked_at));
        return {individual,present,arrived:Boolean(row.arrived_at)};
      };
      const counts = {total:rows.length,present:0,arrived:0,individual:0,unknown:0};
      rows.forEach(row => { const c=classify(row); if(c.present) counts.present++; if(c.arrived) counts.arrived++; if(c.individual) counts.individual++; });
      counts.unknown = Math.max(0, counts.total-counts.present-counts.individual);
      const summaries = eventList.map(event => {
        const erows = rows.filter(r => r.event_id === event.id); let present=0,arrived=0,individual=0;
        erows.forEach(row => { const c=classify(row); if(c.present) present++; if(c.arrived) arrived++; if(c.individual) individual++; });
        return {...event,total:erows.length,present,arrived,individual,unknown:Math.max(0,erows.length-present-individual)};
      });
      state.statusAggregate = {events:summaries,rows,logs:mappedLogs,counts,caption:range.caption};
    } catch (error) {
      console.error('status aggregate error:', error);
      toast(`출석 현황 불러오기 실패 · ${error.message || '확인 필요'}`);
      state.statusAggregate = {events:[],rows:[],logs:[],counts:{total:0,present:0,arrived:0,individual:0,unknown:0},caption:'불러오기 실패'};
    } finally {
      state.statusLoading = false;
    }
  }

  function renderStatus() {
    ensureStatusDashboardUI();
    const list = $('#statusList'); const history = $('#statusHistoryList'); if (!list || !history) return;
    $$('[data-status-scope]').forEach(b => b.classList.toggle('active', b.dataset.statusScope === state.statusScope));

    if (state.statusScope !== 'current') {
      const caption = $('#statusScopeCaption'); if (caption) caption.textContent = state.statusLoading ? '기간별 현황 불러오는 중…' : (state.statusAggregate?.caption || statusScopeRange(state.statusScope).caption);
      if (state.statusLoading) {
        list.innerHTML = '<div class="empty-state">기간별 출석 현황을 불러오는 중입니다.</div>'; history.innerHTML = ''; return;
      }
      const data = state.statusAggregate || {events:[],logs:[],counts:{total:0,present:0,arrived:0,individual:0,unknown:0}};
      const c = data.counts;
      if ($('#statusTotal')) $('#statusTotal').textContent=c.total;
      if ($('#statusPresent')) $('#statusPresent').textContent=c.present;
      if ($('#statusArrived')) $('#statusArrived').textContent=c.arrived;
      if ($('#statusIndividual')) $('#statusIndividual').textContent=c.individual;
      if ($('#statusUnknown')) $('#statusUnknown').textContent=c.unknown;
      const denom=Math.max(1,c.total-c.individual); const rate=c.total?Math.round(c.present/denom*100):0; if($('#rateText')) $('#rateText').textContent=`${rate}%`; if($('#progressBar')) $('#progressBar').style.width=`${rate}%`;
      list.innerHTML = data.events.length ? data.events.map(e=>`<div class="status-event-row"><div><strong>${escapeHtml(e.event_date||'')} · ${escapeHtml(e.title||'행사')}</strong><small>${escapeHtml(e.location||'장소 없음')}</small></div><div class="status-event-counts"><b>${e.present}/${e.total}</b> 출석<br>현장 ${e.arrived} · 개인 ${e.individual} · 미확인 ${e.unknown}</div></div>`).join('') : '<div class="empty-state">선택한 기간에 행사가 없습니다.</div>';
      const title=$('#statusHistoryTitle'); if(title) title.textContent='기간 출석 기록'; const count=$('#statusLogCount'); if(count) count.textContent=`${data.logs.length}건`;
      history.innerHTML=data.logs.length?data.logs.map(log=>`<div class="status-log-row"><div class="status-log-main"><strong>${escapeHtml(log.name)}${log.org?` · ${escapeHtml(log.org)}`:''}</strong><small>${escapeHtml(log.eventDate)} · ${escapeHtml(log.eventTitle)} · ${escapeHtml(formatLogDateTime(log.createdAt))}</small></div><div class="status-log-side"><b>${escapeHtml(attendanceActionLabel(log.action))}</b><small>${escapeHtml(attendanceSourceLabel(log.source))}</small></div></div>`).join(''):'<div class="status-log-empty">선택한 기간에 출석 변경 기록이 없습니다.</div>';
      return;
    }

    const caption=$('#statusScopeCaption'); if(caption) caption.textContent=state.event?`${state.event.event_date||''} · ${state.event.title||'현재 행사'}`:'현재 진행 행사 기준';
    const total=state.people.length; const present=state.people.filter(p=>p.status==='present').length; const individual=state.people.filter(p=>p.status==='individual').length; const unknown=Math.max(0,total-present-individual); const arrived=state.people.filter(p=>Boolean(p.arrivedAt)).length;
    if($('#statusTotal')) $('#statusTotal').textContent=total; if($('#statusPresent')) $('#statusPresent').textContent=present; if($('#statusArrived')) $('#statusArrived').textContent=arrived; if($('#statusIndividual')) $('#statusIndividual').textContent=individual; if($('#statusUnknown')) $('#statusUnknown').textContent=unknown;
    const denom=Math.max(1,total-individual); const rate=total?Math.round(present/denom*100):0; if($('#rateText')) $('#rateText').textContent=`${rate}%`; if($('#progressBar')) $('#progressBar').style.width=`${rate}%`;
    list.innerHTML=state.people.length?state.people.map(p=>`<div class="status-row"><div><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.org||'소속 없음')}</small>${p.arrivedAt?`<small style="display:block;color:#0b9184;font-weight:850;margin-top:3px;">현장 도착 ${escapeHtml(formatCheckTime(p.arrivedAt))}</small>`:''}</div><div style="display:flex;align-items:center;gap:6px;flex:0 0 auto;">${p.status==='present'&&p.checkedAt?`<span class="badge present" style="width:58px;height:32px;padding:0;display:inline-flex;align-items:center;justify-content:center;">${escapeHtml(formatCheckTime(p.checkedAt))}</span>`:''}<span class="badge ${p.status}"${p.status==='present'?' style="width:58px;height:32px;padding:0;display:inline-flex;align-items:center;justify-content:center;"':''}>${personStatusLabel(p)}</span></div></div>`).join(''):'<div class="empty-state">출석 현황이 없습니다.</div>';
    const title=$('#statusHistoryTitle'); if(title) title.textContent='출석 기록'; const count=$('#statusLogCount'); if(count) count.textContent=`${state.logs.length}건`;
    history.innerHTML=state.logs.length?state.logs.map(log=>`<div class="status-log-row"><div class="status-log-main"><strong>${escapeHtml(log.name)}${log.org?` · ${escapeHtml(log.org)}`:''}</strong><small>${escapeHtml(formatLogDateTime(log.createdAt))}</small></div><div class="status-log-side"><b>${escapeHtml(attendanceActionLabel(log.action))}</b><small>${escapeHtml(attendanceSourceLabel(log.source))}</small></div></div>`).join(''):'<div class="status-log-empty">아직 출석 변경 기록이 없습니다.</div>';
  }


  const labelFor = s =>
    ({present:'출석', individual:'개인출발', unknown:'미확인'})[s] || '미확인';

  function personStatusLabel(person) {
    if (person?.status === 'individual' && person?.arrivedAt) {
      return '개인출발 · 현장도착';
    }
    return labelFor(person?.status);
  }

  function ensureManualStatusConfirmUI() {
    if ($('#manualStatusConfirmDialog')) return;

    const dialog = document.createElement('dialog');
    dialog.id = 'manualStatusConfirmDialog';
    dialog.style.cssText = 'width:min(calc(100% - 40px),360px);border:0;border-radius:24px;padding:0;background:#fff;box-shadow:0 22px 70px rgba(20,39,45,.24);';
    dialog.innerHTML = `
      <div style="padding:24px 20px 18px;text-align:center;">
        <strong style="display:block;font-size:20px;margin-bottom:8px;">상태를 변경하시겠습니까?</strong>
        <p style="margin:0;color:#7d898f;font-size:13px;line-height:1.5;">QR 자동 체크가 아닌 관리자 수동 변경입니다.</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:22px;">
          <button type="button" id="manualStatusCancel" style="height:48px;border:0;border-radius:14px;background:#f1f3f4;color:#5e686d;font-size:16px;font-weight:850;">취소</button>
          <button type="button" id="manualStatusApply" style="height:48px;border:0;border-radius:14px;background:#20b9aa;color:#fff;font-size:16px;font-weight:900;">변경</button>
        </div>
      </div>`;
    document.body.appendChild(dialog);
  }

  function confirmManualStatusChange() {
    ensureManualStatusConfirmUI();
    const dialog = $('#manualStatusConfirmDialog');
    return new Promise(resolve => {
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        $('#manualStatusCancel')?.removeEventListener('click', onCancel);
        $('#manualStatusApply')?.removeEventListener('click', onApply);
        dialog?.removeEventListener('cancel', onDialogCancel);
        if (dialog?.open) dialog.close();
        resolve(value);
      };
      const onCancel = () => finish(false);
      const onApply = () => finish(true);
      const onDialogCancel = e => { e.preventDefault(); finish(false); };
      $('#manualStatusCancel')?.addEventListener('click', onCancel, {once:true});
      $('#manualStatusApply')?.addEventListener('click', onApply, {once:true});
      dialog?.addEventListener('cancel', onDialogCancel, {once:true});
      dialog?.showModal();
    });
  }

  const MANUAL_STATUS_GRACE_MS = 3000;
  const manualStatusGraceUntil = new Map();
  const manualStatusChangeInFlight = new Set();

  function hasManualStatusGrace(linkId) {
    const until = manualStatusGraceUntil.get(linkId) || 0;
    if (Date.now() < until) return true;
    manualStatusGraceUntil.delete(linkId);
    return false;
  }

  function armManualStatusGrace(linkId) {
    manualStatusGraceUntil.set(linkId, Date.now() + MANUAL_STATUS_GRACE_MS);
  }

  async function cycleStatus(linkId) {
    const p = state.people.find(x => x.linkId === linkId);
    if (!p || !state.event) return;
    if (state.event.status === 'ended') {
      toast('종료된 행사는 출석 상태를 변경할 수 없습니다.');
      return;
    }
    if (manualStatusChangeInFlight.has(linkId)) return;

    manualStatusChangeInFlight.add(linkId);
    try {
      if (!hasManualStatusGrace(linkId)) {
        const approved = await confirmManualStatusChange();
        if (!approved) return;
      }

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
            arrived_at:null,
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

    const logAction = ({
      present:'manual_check_in',
      individual:'set_individual',
      unknown:'manual_uncheck'
    })[next] || 'correction';

    const { error: logError } = await sb.from('attendance_logs').insert({
      event_id: state.event.id,
      participant_id: p.participantId,
      action: logAction,
      source: 'manual',
      actor_user_id: state.user.id
    });
    if (logError) console.error('attendance log error:', logError);

      await loadPeople();
      await loadAttendanceLogs();
      renderAll();

      // 마지막으로 정상 변경된 시점부터 3초 동안 같은 참가자는
      // 추가 확인창 없이 연속 상태 변경을 허용합니다.
      armManualStatusGrace(linkId);
      queueGoogleSheetsCurrentSync();
    } finally {
      manualStatusChangeInFlight.delete(linkId);
    }
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
    queueGoogleSheetsCurrentSync();
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
        async () => {
          await loadPeople();
          renderAll();
          queueGoogleSheetsCurrentSync();
        }
      )
      .on(
        'postgres_changes',
        {
          event:'INSERT',
          schema:'public',
          table:'attendance_logs',
          filter:`event_id=eq.${state.event.id}`
        },
        async (payload) => {
          await loadAttendanceLogs();
          await loadPeople();
          renderAll();

          const row = payload?.new || {};
          const log = {
            id: row.id || '',
            participantId: row.participant_id || '',
            action: row.action || '',
            source: row.source || '',
            createdAt: row.created_at || new Date().toISOString()
          };

          if (isQrNotificationLog(log) && document.visibilityState === 'visible') {
            showLiveQrNotification(notificationItemFromLog(log));
          }
        }
      )
      .subscribe();
  }

  let resumeRefreshBusy = false;

  async function refreshAfterAppResume() {
    if (resumeRefreshBusy || !sb || !state.user) return;
    resumeRefreshBusy = true;

    try {
      await loadLatestEvent();
      await loadPeople();
      await loadAttendanceLogs();
      await ensureManualEndQrValidity();
      await loadGatheringQr();
      subscribeRealtime();
      renderAll();
      recoverMissedQrNotifications();
      queueGoogleSheetsCurrentSync(250);
    } catch (error) {
      console.error('resume refresh error:', error);
    } finally {
      resumeRefreshBusy = false;
    }
  }

  function ensureResponsiveLayout() {
    if ($('#responsiveLayoutV35')) return;

    const style = document.createElement('style');
    style.id = 'responsiveLayoutV35';
    style.textContent = `
      /* iPhone landscape: use the available width instead of keeping a portrait column. */
      @media (orientation:landscape) and (max-height:600px) {
        body{padding-top:0!important}
        .app-shell{
          width:100%!important;
          max-width:none!important;
          min-height:100dvh;
          padding-bottom:66px!important;
          border-radius:0!important;
          box-shadow:none!important;
          overflow:visible!important;
        }
        .topbar{
          padding:calc(7px + env(safe-area-inset-top)) max(18px,env(safe-area-inset-right)) 6px max(18px,env(safe-area-inset-left))!important;
        }
        .app-icon{width:46px!important;height:46px!important;border-radius:13px!important}
        .brand-row{gap:11px!important}
        .brand-copy h1{font-size:22px!important}
        .brand-copy p{font-size:12px!important;margin-top:3px!important}
        .icon-button{width:40px!important;height:40px!important}
        main{
          padding:4px max(18px,env(safe-area-inset-right)) 18px max(18px,env(safe-area-inset-left))!important;
        }
        .section-title{margin:3px 2px 10px!important}
        .section-title h2{font-size:23px!important}
        .welcome-card{padding:14px!important;margin-bottom:0!important}
        .event-card{padding:14px!important;margin-bottom:0!important}
        .stats-grid{grid-template-columns:repeat(4,minmax(0,1fr))!important;margin-top:12px!important}
        .stat{padding:9px 5px!important}
        .stat b{font-size:20px!important}
        [data-screen="home"].active{
          display:grid!important;
          grid-template-columns:minmax(0,1fr) minmax(0,1fr);
          gap:12px;
          align-items:stretch;
        }
        [data-screen="home"] .welcome-card{grid-column:1/-1}
        [data-screen="home"] .event-card{grid-column:1}
        [data-screen="home"] .qr-hero{grid-column:2;margin-bottom:0!important;height:100%;min-height:126px}
        [data-screen="home"] .feature-grid,
        [data-screen="home"] .compact-actions{grid-column:1/-1;margin-bottom:0!important}
        .feature-grid{grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:9px!important}
        .feature-card{min-height:98px!important;padding:12px!important}
        .feature-card strong{font-size:13px!important;margin-top:7px!important}
        .feature-card small{font-size:10px!important}
        .feature-icon{width:36px!important;height:36px!important}
        .people-list{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px!important}
        .person-card{min-width:0}
        [data-screen="qr"].active .qr-panel{
          display:grid;
          grid-template-columns:minmax(165px,210px) minmax(0,1fr);
          grid-template-rows:auto auto auto auto;
          column-gap:22px;
          row-gap:6px;
          text-align:left;
          padding:16px 20px!important;
          align-items:center;
        }
        [data-screen="qr"] .fake-qr{
          grid-column:1;
          grid-row:1/5;
          width:min(31vw,195px)!important;
          margin:0 auto!important;
        }
        [data-screen="qr"] .qr-panel h3,
        [data-screen="qr"] .qr-panel p,
        [data-screen="qr"] .qr-panel button{grid-column:2;margin-top:5px!important}
        [data-screen="qr"] .qr-panel h3{margin-bottom:2px!important}
        [data-screen="qr"] .qr-panel p{margin-bottom:1px!important}
        .tabbar{
          width:100%!important;
          padding:4px max(14px,env(safe-area-inset-right)) calc(4px + env(safe-area-inset-bottom)) max(14px,env(safe-area-inset-left))!important;
        }
        .tab{gap:1px!important;font-size:9px!important;padding:2px!important}
        .tab svg{width:19px!important;height:19px!important}
        #attendanceNoticeCenter{
          left:50%!important;
          right:auto!important;
          width:min(calc(100% - 40px),680px)!important;
          transform:translate(-50%,-50%)!important;
        }
      }

      /* iPad / large screens: expand naturally while keeping the phone layout unchanged. */
      @media (min-width:700px) and (min-height:601px) {
        body{padding-top:0!important}
        .app-shell{
          width:min(100%,1100px)!important;
          max-width:1100px!important;
          min-height:100dvh;
          border-radius:0!important;
          overflow:visible!important;
        }
        .topbar{padding-left:32px!important;padding-right:32px!important}
        main{padding-left:30px!important;padding-right:30px!important}
        .tabbar{width:min(100%,1100px)!important}
        [data-screen="home"].active{
          display:grid!important;
          grid-template-columns:minmax(0,1fr) minmax(0,1fr);
          gap:16px;
          align-items:stretch;
        }
        [data-screen="home"] .welcome-card{grid-column:1/-1;margin-bottom:0!important}
        [data-screen="home"] .event-card{grid-column:1;margin-bottom:0!important}
        [data-screen="home"] .qr-hero{grid-column:2;margin-bottom:0!important;height:100%}
        [data-screen="home"] .feature-grid,
        [data-screen="home"] .compact-actions{grid-column:1/-1;margin-bottom:0!important}
        .feature-grid{grid-template-columns:repeat(4,minmax(0,1fr))!important}
        .people-list{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px!important}
        #statusDetailStats{grid-template-columns:repeat(5,minmax(0,1fr))!important}
        [data-screen="qr"] .qr-panel{max-width:820px;margin-left:auto;margin-right:auto}
        [data-screen="settings"] .form-card{max-width:760px;margin-left:auto;margin-right:auto}
        #attendanceNoticeCenter{
          left:50%!important;
          right:auto!important;
          width:min(calc(100% - 56px),680px)!important;
          transform:translate(-50%,-50%)!important;
        }
      }
    `;
    document.head.appendChild(style);
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

    $('#personDialogClose')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      $('#personForm')?.reset();
      $('#personDialog')?.close();
    });

    $('#manualButton')?.addEventListener('click', () => go('roster'));
    $('#saveSettings')?.addEventListener('click', () => toast('설정 저장 완료'));
    $('#notificationButton')?.addEventListener('click', openNotificationHistory);
    $('#ocrButton')?.addEventListener('click', openOcrDialog);
    $('#sheetButton')?.addEventListener('click', openSpreadsheetDialog);
    $('#proxyButton')?.addEventListener('click', () => {
      go('qr');
      ensureProxyManagerUI();
      toast('집결지 QR 또는 현장 QR을 선택해 공유하거나, 대리 QR 관리에서 폐기할 수 있습니다.');
    });
    $('#demoShare')?.addEventListener('click', shareProxyQr);
    $('#demoStart')?.addEventListener('click', startEventQr);
  }

  function go(screen) {
    $$('.screen').forEach(x =>
      x.classList.toggle('active', x.dataset.screen === screen)
    );
    $$('.tab').forEach(x =>
      x.classList.toggle('active', x.dataset.go === screen)
    );
    if (screen === 'status') {
      if (state.statusScope === 'current') loadAttendanceLogs().then(renderStatus).catch(console.error);
      else loadStatusAggregate(state.statusScope).then(renderStatus).catch(console.error);
    }
    if (screen === 'history') {
      loadPastEvents(true).catch(console.error);
    }
    window.scrollTo({top:0, behavior:'smooth'});
  }

  async function invokeGoogleSheets(action, payload={}) {
    if (!sb || !state.user) throw new Error('로그인이 필요합니다.');

    const { data, error } = await sb.functions.invoke('google-sheets-bridge', {
      body: { action, ...payload }
    });

    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || 'Google Sheets 연결 실패');
    return data;
  }

  function googleSheetsEventPayload() {
    return state.event ? {
      id: state.event.id || '',
      title: state.event.title || '',
      event_date: state.event.event_date || '',
      location: state.event.location || ''
    } : {};
  }

  function googleSheetsPeoplePayload() {
    return state.people.map(p => ({
      name: p.name || '',
      org: p.org || '',
      phone: p.phone || '',
      status: spreadsheetStatusLabel(p),
      checkedAt: p.checkedAt || '',
      arrivedAt: p.arrivedAt || ''
    }));
  }

  async function syncGoogleSheetsCurrent(showToast=true) {
    if (!state.event) {
      if (showToast) toast('현재 행사가 없습니다.');
      return false;
    }

    try {
      await invokeGoogleSheets('syncCurrent', {
        event: googleSheetsEventPayload(),
        people: googleSheetsPeoplePayload()
      });
      if (showToast) toast('Google Sheets 현재행사 동기화 완료');
      return true;
    } catch (error) {
      console.error('google sheets current sync error:', error);
      if (showToast) toast(`Google Sheets 동기화 실패 · ${error.message || '확인 필요'}`);
      return false;
    }
  }

  function queueGoogleSheetsCurrentSync(delay=900) {
    if (!state.event) return;
    clearTimeout(googleSheetsSyncTimer);
    googleSheetsSyncTimer = setTimeout(() => {
      syncGoogleSheetsCurrent(false).catch(console.error);
    }, delay);
  }

  async function archiveGoogleSheetsEvent(showToast=false) {
    if (!state.event) return false;

    try {
      await invokeGoogleSheets('archiveEvent', {
        event: googleSheetsEventPayload(),
        people: googleSheetsPeoplePayload()
      });
      if (showToast) toast('Google Sheets 행사기록 보관 완료');
      return true;
    } catch (error) {
      console.error('google sheets archive error:', error);
      if (showToast) toast(`Google Sheets 행사기록 보관 실패 · ${error.message || '확인 필요'}`);
      return false;
    }
  }

  function buildGoogleRosterPreview(rows) {
    const currentKeys = new Set(
      state.people.map(p => importPersonKey(p.name, p.phone))
    );
    const fileKeys = new Set();
    const parsed = [];

    (rows || []).forEach((row, index) => {
      const name = String(row?.name ?? '').trim();
      const org = String(row?.affiliation ?? '').trim();
      const phone = normalizeImportPhone(row?.phone_last4 ?? '');

      if (!name && !org && !phone) return;

      let stateLabel = 'ok';
      let reason = '등록 가능';

      if (!name) {
        stateLabel = 'bad';
        reason = '이름 없음';
      } else if (!/^\d{4}$/.test(phone)) {
        stateLabel = 'bad';
        reason = '전화 4자리 오류';
      } else {
        const key = importPersonKey(name, phone);
        if (currentKeys.has(key)) {
          stateLabel = 'skip';
          reason = '현재 명단 중복';
        } else if (fileKeys.has(key)) {
          stateLabel = 'skip';
          reason = '시트 내 중복';
        } else {
          fileKeys.add(key);
        }
      }

      parsed.push({
        rowNumber: index + 2,
        name,
        org,
        phone,
        state: stateLabel,
        reason
      });
    });

    return parsed;
  }

  async function previewGoogleSheetsRoster() {
    if (!state.event) {
      toast('먼저 행사를 등록해주세요.');
      return;
    }

    const button = $('#googleSheetsImportButton');
    if (button) button.disabled = true;

    try {
      const data = await invokeGoogleSheets('roster');
      state.spreadsheetRows = buildGoogleRosterPreview(data.rows || []);
      state.spreadsheetFileName = 'Google Sheets · 명단입력';
      renderSpreadsheetPreview();

      if (!state.spreadsheetRows.length) {
        $('#sheetPreview').innerHTML =
          '<div class="sheet-preview-message" style="background:#f5fbfa;color:#567078;border-color:#d8efeb;">Google Sheets의 명단입력 탭에 등록된 사람이 없습니다.</div>';
        $('#spreadsheetImportConfirm').hidden = true;
      }
    } catch (error) {
      console.error('google sheets roster error:', error);
      state.spreadsheetRows = [];
      $('#sheetPreview').innerHTML =
        `<div class="sheet-preview-message">Google Sheets 명단을 불러오지 못했습니다.<br>${escapeHtml(error.message || '연결 상태를 확인해주세요.')}</div>`;
      $('#spreadsheetImportConfirm').hidden = true;
    } finally {
      if (button) button.disabled = false;
    }
  }

  function ensureOcrUI() {
    if ($('#ocrRosterDialog')) return;

    const style = document.createElement('style');
    style.textContent = `
      #ocrRosterDialog{
        width:min(calc(100% - 24px),470px);
        border:0;
        border-radius:26px;
        padding:0;
        background:#fff;
        box-shadow:0 22px 70px rgba(20,39,45,.24);
      }
      #ocrRosterDialog::backdrop{
        background:rgba(18,26,30,.38);
        backdrop-filter:blur(3px);
        -webkit-backdrop-filter:blur(3px);
      }
      .ocr-body{
        box-sizing:border-box;
        padding:22px 18px 20px;
        max-height:86dvh;
        overflow-y:auto;
        -webkit-overflow-scrolling:touch;
      }
      .ocr-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:14px}
      .ocr-head h2{font-size:22px;margin:0 0 4px}
      .ocr-head p{margin:0;color:#7f8a90;font-size:12px;line-height:1.45}
      .ocr-close{border:0;background:#f1f3f4;width:38px;height:38px;border-radius:50%;font-size:23px;color:#596267;flex:0 0 auto}
      .ocr-source-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}
      .ocr-source-button{
        min-height:62px;border:1px solid #dfe9eb;border-radius:17px;background:#fff;
        color:#159f93;font-size:13px;font-weight:900;padding:10px;
      }
      .ocr-source-button small{display:block;color:#879399;font-size:10px;font-weight:700;margin-top:4px}
      .ocr-privacy{
        margin:11px 0 0;padding:11px 12px;border-radius:14px;background:#f4fbfa;
        color:#61747a;font-size:10px;line-height:1.5;
      }
      .ocr-preview-image{
        width:100%;max-height:220px;object-fit:contain;background:#f5f7f8;border-radius:15px;
        margin-top:13px;border:1px solid #e6ecee;
      }
      .ocr-progress-wrap{margin-top:13px}
      .ocr-progress-label{display:flex;justify-content:space-between;gap:10px;color:#67777d;font-size:11px;font-weight:800}
      .ocr-progress{height:9px;background:#edf2f3;border-radius:999px;overflow:hidden;margin-top:7px}
      .ocr-progress span{display:block;height:100%;width:0;background:#24c7b7;border-radius:999px;transition:width .2s ease}
      .ocr-raw-box{margin-top:14px}
      .ocr-raw-box summary{cursor:pointer;color:#6c7a80;font-size:11px;font-weight:850}
      .ocr-raw-text{
        width:100%;box-sizing:border-box;min-height:110px;margin-top:8px;border:1px solid #e1e9eb;
        border-radius:13px;padding:10px;font-size:12px;line-height:1.45;resize:vertical;background:#fafcfc;
      }
      .ocr-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:14px 0 10px}
      .ocr-summary div{background:#f7fafb;border-radius:13px;padding:10px 5px;text-align:center}
      .ocr-summary span{display:block;color:#89949a;font-size:9px;font-weight:800}
      .ocr-summary b{display:block;font-size:18px;margin-top:3px}
      .ocr-row{
        display:grid;grid-template-columns:28px minmax(0,1.15fr) minmax(0,1fr) 76px;gap:7px;
        align-items:center;padding:8px 0;border-top:1px solid #edf1f2;
      }
      .ocr-select{width:22px!important;height:22px!important;accent-color:#20c4b4;padding:0!important}
      .ocr-row:first-child{border-top:0}
      .ocr-row input{
        box-sizing:border-box;width:100%;height:40px;border:1px solid #dfe7e9;border-radius:11px;
        padding:0 9px;font-size:13px;background:#fff;min-width:0;
      }
      .ocr-row input.ocr-phone{text-align:center}
      .ocr-row-state{font-size:9px;font-weight:900;text-align:right;line-height:1.25}
      .ocr-row-state.ok{color:#159f93}.ocr-row-state.skip{color:#a66f15}.ocr-row-state.bad{color:#d94d55}
      .ocr-add-row{width:100%;height:42px;border:1px dashed #bfe4df;background:#f5fcfb;color:#159f93;border-radius:13px;font-weight:900;margin-top:8px}
      .ocr-import{width:100%;height:50px;border:0;border-radius:15px;background:#22c7b7;color:#fff;font-weight:900;font-size:15px;margin-top:12px}
      .ocr-import[hidden]{display:none}
      .ocr-message{margin-top:13px;padding:13px;border-radius:14px;background:#fff5f6;color:#bf4049;border:1px solid #ffd7da;font-size:12px;line-height:1.5}
    `;
    document.head.appendChild(style);

    const dialog = document.createElement('dialog');
    dialog.id = 'ocrRosterDialog';
    dialog.innerHTML = `
      <div class="ocr-body">
        <div class="ocr-head">
          <div>
            <h2>종이 명단 촬영</h2>
            <p>사진의 이름 · 소속 · 전화번호를 읽고, 확인 후 현재 행사 명단에 등록합니다.</p>
          </div>
          <button type="button" class="ocr-close" id="ocrClose" aria-label="닫기">×</button>
        </div>

        <div class="ocr-source-grid">
          <button type="button" class="ocr-source-button" id="ocrCameraButton">카메라 촬영<small>지금 종이 명단 촬영</small></button>
          <button type="button" class="ocr-source-button" id="ocrPhotoButton">사진 선택<small>사진 보관함 · 파일</small></button>
        </div>
        <div class="ocr-privacy">사진은 Supabase나 Google Sheets에 저장하지 않고, 이 기기에서 글자를 읽은 뒤 명단 데이터만 등록합니다.</div>

        <div id="ocrWorkArea"></div>
        <button type="button" id="ocrImportButton" class="ocr-import" hidden>선택한 명단 불러오기</button>
      </div>
    `;
    document.body.appendChild(dialog);

    $('#ocrClose')?.addEventListener('click', () => {
      resetOcrDialog();
      dialog.close();
    });
    $('#ocrCameraButton')?.addEventListener('click', () => openOcrFilePicker(true));
    $('#ocrPhotoButton')?.addEventListener('click', () => openOcrFilePicker(false));
    $('#ocrImportButton')?.addEventListener('click', importOcrRows);
  }

  function openOcrDialog() {
    if (!state.event) {
      toast('먼저 행사를 등록해주세요.');
      return;
    }
    ensureOcrUI();
    resetOcrDialog();
    $('#ocrRosterDialog')?.showModal();
  }

  function resetOcrDialog() {
    state.ocrRows = [];
    state.ocrRawText = '';
    state.ocrFileName = '';
    const area = $('#ocrWorkArea');
    const importButton = $('#ocrImportButton');
    if (area) area.innerHTML = '';
    if (importButton) {
      importButton.hidden = true;
      importButton.disabled = false;
      importButton.textContent = '선택한 명단 불러오기';
    }
  }

  function openOcrFilePicker(useCamera=false) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (useCamera) input.setAttribute('capture', 'environment');

    input.style.position = 'fixed';
    input.style.left = '-10000px';
    input.style.top = '-10000px';
    input.style.width = '1px';
    input.style.height = '1px';
    input.style.opacity = '0';
    input.style.pointerEvents = 'none';

    input.addEventListener('change', async event => {
      try {
        await handleOcrImageFile(event);
      } finally {
        input.remove();
      }
    }, { once:true });

    document.body.appendChild(input);
    input.click();

    window.setTimeout(() => {
      if (document.body.contains(input) && !input.files?.length) input.remove();
    }, 120000);
  }

  async function ensureTesseractLoaded() {
    if (window.Tesseract?.createWorker) return;

    await new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-qr-ocr="tesseract"]');
      if (existing) {
        existing.addEventListener('load', resolve, { once:true });
        existing.addEventListener('error', reject, { once:true });
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
      script.async = true;
      script.dataset.qrOcr = 'tesseract';
      script.onload = resolve;
      script.onerror = () => reject(new Error('OCR 모듈 다운로드 실패'));
      document.head.appendChild(script);
    });

    if (!window.Tesseract?.createWorker) throw new Error('OCR 모듈 초기화 실패');
  }

  function setOcrProgress(statusText='분석 준비', progress=0) {
    const label = $('#ocrProgressText');
    const pct = $('#ocrProgressPercent');
    const bar = $('#ocrProgressBar');
    const n = Math.max(0, Math.min(1, Number(progress) || 0));
    if (label) label.textContent = statusText;
    if (pct) pct.textContent = `${Math.round(n * 100)}%`;
    if (bar) bar.style.width = `${Math.round(n * 100)}%`;
  }

  function ocrLogger(message) {
    const progress = Number(message?.progress) || 0;
    const map = {
      'loading tesseract core':'OCR 엔진 불러오는 중',
      'initializing tesseract':'OCR 엔진 준비 중',
      'loading language traineddata':'한국어 글자 데이터 불러오는 중',
      'initializing api':'문자 인식 준비 중',
      'recognizing text':'명단 글자 읽는 중'
    };
    setOcrProgress(map[message?.status] || '명단 분석 중', progress);
  }

  function loadOcrImage(file) {
    return new Promise((resolve,reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('사진을 열지 못했습니다.')); };
      img.src = url;
    });
  }

  function makeOrientedOcrCanvas(img, angle=0, maxSide=1100) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const baseScale = Math.min(1, maxSide / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * baseScale));
    const h = Math.max(1, Math.round(ih * baseScale));
    const swap = Math.abs(angle) % 180 === 90;
    const canvas = document.createElement('canvas');
    canvas.width = swap ? h : w;
    canvas.height = swap ? w : h;
    const ctx = canvas.getContext('2d', { willReadFrequently:true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(angle * Math.PI / 180);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
    return canvas;
  }

  function ocrOtsuThreshold(gray=[]) {
    const hist = new Array(256).fill(0);
    gray.forEach(v => { hist[Math.max(0, Math.min(255, v|0))]++; });
    const total = gray.length || 1;
    let sum = 0;
    for (let i=0;i<256;i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 170, bestVar = -1;
    for (let t=0;t<256;t++) {
      wB += hist[t];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > bestVar) { bestVar = between; best = t; }
    }
    return Math.max(95, Math.min(220, best));
  }

  function enhanceOcrCanvas(source, mode='document') {
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext('2d', { willReadFrequently:true });
    ctx.drawImage(source, 0, 0);

    const src = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const gray = new Uint8ClampedArray(canvas.width * canvas.height);
    for (let i=0,j=0;i<src.data.length;i+=4,j++) {
      gray[j] = Math.round(src.data[i]*.299 + src.data[i+1]*.587 + src.data[i+2]*.114);
    }

    // 큰 블러를 조명/그림자 배경으로 보고 빼서 종이 구김·그림자 영향을 줄입니다.
    const grayCanvas = document.createElement('canvas');
    grayCanvas.width = canvas.width;
    grayCanvas.height = canvas.height;
    const gctx = grayCanvas.getContext('2d', { willReadFrequently:true });
    const gimg = gctx.createImageData(canvas.width, canvas.height);
    for (let j=0,i=0;j<gray.length;j++,i+=4) {
      const v = gray[j];
      gimg.data[i]=gimg.data[i+1]=gimg.data[i+2]=v; gimg.data[i+3]=255;
    }
    gctx.putImageData(gimg,0,0);

    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = canvas.width;
    bgCanvas.height = canvas.height;
    const bctx = bgCanvas.getContext('2d', { willReadFrequently:true });
    bctx.fillStyle='#fff'; bctx.fillRect(0,0,bgCanvas.width,bgCanvas.height);
    bctx.filter = `blur(${Math.max(8, Math.round(Math.min(canvas.width,canvas.height)/55))}px)`;
    bctx.drawImage(grayCanvas,0,0);
    bctx.filter = 'none';
    const bg = bctx.getImageData(0,0,bgCanvas.width,bgCanvas.height).data;

    const normalized = new Uint8ClampedArray(gray.length);
    for (let j=0,i=0;j<gray.length;j++,i+=4) {
      const local = bg[i] || 230;
      // 배경은 밝게, 배경보다 어두운 잉크는 강하게 어둡게.
      normalized[j] = Math.max(0, Math.min(255, Math.round(238 + (gray[j]-local)*3.15)));
    }

    const out = ctx.createImageData(canvas.width, canvas.height);
    if (mode === 'binary') {
      const threshold = ocrOtsuThreshold(normalized);
      for (let j=0,i=0;j<normalized.length;j++,i+=4) {
        const v = normalized[j] < Math.min(220, threshold+8) ? 0 : 255;
        out.data[i]=out.data[i+1]=out.data[i+2]=v; out.data[i+3]=255;
      }
    } else {
      for (let j=0,i=0;j<normalized.length;j++,i+=4) {
        let v = normalized[j];
        // 약한 글씨는 더 진하게, 종이 바탕은 거의 흰색으로 정리합니다.
        v = v < 205 ? Math.max(0, Math.round((v-25)*.94)) : Math.min(255, Math.round(238 + (v-205)*.7));
        out.data[i]=out.data[i+1]=out.data[i+2]=v; out.data[i+3]=255;
      }
    }
    ctx.putImageData(out,0,0);
    return canvas;
  }

  function scaleOcrCanvas(source, maxSide=2300) {
    const scale = Math.min(3.2, Math.max(1, maxSide / Math.max(source.width, source.height)));
    if (scale <= 1.01) return source;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently:true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle='#fff'; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(source,0,0,canvas.width,canvas.height);
    return canvas;
  }

  function cropOcrCanvasNormalized(source, rect) {
    if (!rect) return source;
    const x = Math.max(0, Math.floor(rect.x * source.width));
    const y = Math.max(0, Math.floor(rect.y * source.height));
    const right = Math.min(source.width, Math.ceil((rect.x + rect.w) * source.width));
    const bottom = Math.min(source.height, Math.ceil((rect.y + rect.h) * source.height));
    const w = Math.max(1, right-x), h = Math.max(1, bottom-y);
    const canvas = document.createElement('canvas');
    canvas.width=w; canvas.height=h;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);
    ctx.drawImage(source,x,y,w,h,0,0,w,h);
    return canvas;
  }

  function rotateOcrCanvas(source, degrees=0) {
    if (Math.abs(degrees) < .25) return source;
    const rad=degrees*Math.PI/180;
    const sin=Math.abs(Math.sin(rad)), cos=Math.abs(Math.cos(rad));
    const canvas=document.createElement('canvas');
    canvas.width=Math.ceil(source.width*cos+source.height*sin);
    canvas.height=Math.ceil(source.width*sin+source.height*cos);
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(rad);
    ctx.drawImage(source,-source.width/2,-source.height/2);
    return canvas;
  }

  function parseTsvWords(tsv='') {
    const lines=String(tsv||'').split('\n'); const words=[];
    for(let i=1;i<lines.length;i++){
      const cols=lines[i].split('\t'); if(cols.length<12 || cols[0]!=='5') continue;
      const text=cleanOcrToken(cols.slice(11).join('\t')); const conf=Number(cols[10]); if(!text || conf<8) continue;
      const left=Number(cols[6])||0, top=Number(cols[7])||0, width=Number(cols[8])||0, height=Number(cols[9])||0;
      words.push({text,conf,left,top,width,height,right:left+width,bottom:top+height,cx:left+width/2,cy:top+height/2});
    }
    return words;
  }

  function clusterOcrRows(words=[]) {
    if(!words.length) return [];
    const heights=words.map(w=>w.height).filter(Boolean).sort((a,b)=>a-b); const median=heights[Math.floor(heights.length/2)]||18; const threshold=Math.max(10,median*.85);
    const rows=[];
    [...words].sort((a,b)=>a.cy-b.cy||a.left-b.left).forEach(word=>{
      let row=rows.find(r=>Math.abs(r.cy-word.cy)<=threshold);
      if(!row){ row={cy:word.cy,words:[]}; rows.push(row); }
      row.words.push(word); row.cy=row.words.reduce((sum,w)=>sum+w.cy,0)/row.words.length;
    });
    return rows.sort((a,b)=>a.cy-b.cy).map(r=>r.words.sort((a,b)=>a.left-b.left));
  }

  function plausibleOcrName(name='') {
    const n=String(name).trim();
    return /^[가-힣]{2,6}$/.test(n) || /^[A-Za-z][A-Za-z.'-]{1,24}$/.test(n);
  }

  function ocrContentRect(words=[], width=1, height=1) {
    const usable=words.filter(w=>w.conf>=12 && w.width>1 && w.height>1);
    if(usable.length<3) return {x:.03,y:.03,w:.94,h:.94};
    let l=Math.min(...usable.map(w=>w.left)), t=Math.min(...usable.map(w=>w.top));
    let r=Math.max(...usable.map(w=>w.right)), b=Math.max(...usable.map(w=>w.bottom));
    const bw=Math.max(1,r-l), bh=Math.max(1,b-t);
    const padX=Math.max(width*.055,bw*.18), padY=Math.max(height*.045,bh*.22);
    l=Math.max(0,l-padX); t=Math.max(0,t-padY); r=Math.min(width,r+padX); b=Math.min(height,b+padY);
    return {x:l/width,y:t/height,w:(r-l)/width,h:(b-t)/height};
  }

  function estimateOcrDeskew(words=[]) {
    const slopes=[];
    clusterOcrRows(words).forEach(row=>{
      if(row.length<2) return;
      const first=row[0], last=row[row.length-1];
      const dx=last.cx-first.cx; if(Math.abs(dx)<80) return;
      const angle=Math.atan2(last.cy-first.cy,dx)*180/Math.PI;
      if(Number.isFinite(angle) && Math.abs(angle)<=8) slopes.push(angle);
    });
    if(!slopes.length) return 0;
    slopes.sort((a,b)=>a-b);
    return slopes[Math.floor(slopes.length/2)] || 0;
  }

  function extractPhoneAnchors(tsv='') {
    const digitWords=parseTsvWords(tsv).map(w=>({...w,text:String(w.text).replace(/\D/g,'')})).filter(w=>w.text);
    const anchors=[];
    clusterOcrRows(digitWords).forEach(row=>{
      const heights=row.map(w=>w.height).filter(Boolean).sort((a,b)=>a-b); const mh=heights[Math.floor(heights.length/2)]||20;
      const segments=[]; let seg=[];
      row.forEach(word=>{
        if(!seg.length){seg=[word];return;}
        const gap=word.left-seg[seg.length-1].right;
        if(gap<=Math.max(18,mh*1.7)) seg.push(word); else {segments.push(seg);seg=[word];}
      });
      if(seg.length)segments.push(seg);
      const candidates=[];
      segments.forEach(words=>{
        const digits=words.map(w=>w.text).join('');
        if(digits.length!==4) return;
        const left=Math.min(...words.map(w=>w.left)), top=Math.min(...words.map(w=>w.top));
        const right=Math.max(...words.map(w=>w.right)), bottom=Math.max(...words.map(w=>w.bottom));
        candidates.push({phone:digits,left,top,right,bottom,width:right-left,height:bottom-top,cx:(left+right)/2,cy:(top+bottom)/2,conf:words.reduce((s,w)=>s+(w.conf||0),0)/words.length});
      });
      if(candidates.length) anchors.push(candidates.sort((a,b)=>b.right-a.right)[0]);
    });
    const out=[];
    anchors.sort((a,b)=>a.cy-b.cy).forEach(a=>{
      if(!out.some(x=>Math.abs(x.cy-a.cy)<Math.max(10,a.height*.65) && x.phone===a.phone)) out.push(a);
    });
    return out;
  }

  function ocrMedian(values=[], fallback=0) {
    const list=values.map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
    return list.length ? list[Math.floor(list.length/2)] : fallback;
  }

  function compactOcrNameWords(words=[]) {
    const raw=words.map(w=>cleanOcrToken(w.text)).filter(Boolean).join(' ').trim();
    const korean=(raw.match(/[가-힣]+/g)||[]).join('');
    if(korean.length>=2 && korean.length<=6) return korean;

    const latin=raw
      .replace(/[^A-Za-z.' -]+/g,' ')
      .replace(/\s+/g,' ')
      .trim();
    return latin.slice(0,30);
  }

  function splitOcrNameOrgWords(words=[]) {
    const before=[...words]
      .filter(w=>!looksLikeOcrHeader(w.text))
      .filter(w=>!/^\d{4}$/.test(String(w.text).replace(/\D/g,'')))
      .filter(w=>String(w.text||'').length<=40)
      .sort((a,b)=>a.left-b.left);
    if(!before.length) return {nameWords:[],orgWords:[]};
    if(before.length===1) return {nameWords:before,orgWords:[]};

    const mh=ocrMedian(before.map(w=>w.height),18);
    let split=-1, largest=-Infinity;
    for(let i=0;i<before.length-1;i++){
      const gap=before[i+1].left-before[i].right;
      if(gap>largest){ largest=gap; split=i+1; }
    }

    // 표의 이름/소속 칸 사이 간격은 같은 이름 안의 글자 간격보다 훨씬 큽니다.
    // 가장 큰 가로 간격을 우선 열 경계로 사용합니다.
    if(!(largest>=Math.max(15,mh*1.18))) split=-1;

    // 소속이 숫자 한 자리처럼 명확하면 그 위치를 열 경계로 우선합니다.
    const numericIndex=before.findIndex((w,i)=>i>0 && /^\d{1,3}$/.test(String(w.text).replace(/\D/g,'')));
    if(numericIndex>0) split=numericIndex;

    let nameWords=split>0?before.slice(0,split):before.slice(0,1);
    let orgWords=split>0?before.slice(split):before.slice(1);

    // OCR이 '신 이' / '준'처럼 한글 이름의 마지막 한 글자만 다음 칸으로 밀어낸 경우 복원합니다.
    const leftName=compactOcrNameWords(nameWords);
    const rightKorean=(orgWords.map(w=>w.text).join('').match(/[가-힣]+/g)||[]).join('');
    const combined=`${leftName}${rightKorean}`;
    const orgHasDigits=orgWords.some(w=>/\d/.test(String(w.text)));
    if(!orgHasDigits && rightKorean.length===1 && /^[가-힣]{2,4}$/.test(combined)) {
      nameWords=[...nameWords,...orgWords];
      orgWords=[];
    }

    // 첫 그룹이 한 글자뿐이고 다음 그룹까지 합치면 정상 이름이 되는 경우도 합칩니다.
    const nowName=compactOcrNameWords(nameWords);
    if(nowName.length<2 && orgWords.length){
      const firstOrg=orgWords[0];
      const merged=compactOcrNameWords([...nameWords,firstOrg]);
      if(plausibleOcrName(merged) && !/^\d+$/.test(String(firstOrg.text).replace(/\D/g,''))){
        nameWords=[...nameWords,firstOrg];
        orgWords=orgWords.slice(1);
      }
    }

    return {nameWords,orgWords};
  }

  function rowTextFromWords(words=[], anchor=null) {
    if(!words.length) return {name:'',org:'',confidence:0};
    const {nameWords,orgWords}=splitOcrNameOrgWords(words);
    if(!nameWords.length) return {name:'',org:'',confidence:0};

    let name=compactOcrNameWords(nameWords);
    let org=orgWords.map(w=>cleanOcrToken(w.text)).filter(Boolean).join(' ').trim();

    name=name.replace(/^[^가-힣A-Za-z]+|[^가-힣A-Za-z.' -]+$/g,'').trim().slice(0,30);
    org=org.replace(/^[|｜]+|[|｜]+$/g,'').trim().slice(0,50);
    const used=[...nameWords,...orgWords];
    const conf=used.length?used.reduce((sum,w)=>sum+(Number(w.conf)||0),0)/used.length:0;
    return {name,org,confidence:conf};
  }

  function rowsFromPhoneAnchors(generalTsv='', phoneAnchors=[]) {
    const words=parseTsvWords(generalTsv); if(!phoneAnchors.length) return [];
    const heights=words.map(w=>w.height).filter(Boolean).sort((a,b)=>a-b); const mh=heights[Math.floor(heights.length/2)]||22;
    const clustered=clusterOcrRows(words);
    const result=[];
    phoneAnchors.forEach((anchor,index)=>{
      let rowWords=words.filter(w=>w.cx<anchor.left+4 && Math.abs(w.cy-anchor.cy)<=Math.max(mh*1.25,anchor.height*1.05));
      if(!rowWords.length && clustered.length){
        const nearest=clustered.map(row=>({row,dy:Math.abs((row.reduce((s,w)=>s+w.cy,0)/row.length)-anchor.cy)})).sort((a,b)=>a.dy-b.dy)[0];
        if(nearest?.dy<=Math.max(mh*1.8,anchor.height*1.4)) rowWords=nearest.row.filter(w=>w.cx<anchor.left+4);
      }
      rowWords.sort((a,b)=>a.left-b.left);
      const parsed=rowTextFromWords(rowWords,anchor);
      const confidence=((parsed.confidence||0)+(anchor.conf||0))/2;
      result.push({rowNumber:index+1,name:parsed.name,org:parsed.org,phone:anchor.phone,confidence,selected:Boolean(plausibleOcrName(parsed.name)&&confidence>=24),state:'bad',reason:'확인 필요'});
    });
    const seen=new Set();
    return result.filter(row=>{const k=`${row.phone}|${row.name}`;if(seen.has(k))return false;seen.add(k);return true;});
  }

  function isOcrNameStopword(value='') {
    const token=String(value||'').replace(/\s+/g,'').trim();
    return new Set([
      '이름','성명','소속','기관','부서','전화','전화번호','연락처','휴대폰','핸드폰','번호',
      '명단','참가자','참석자','출석','비고','서명','직책','직위','팀','조'
    ]).has(token);
  }

  function looseRowsFromPhoneAnchors(generalTsv='', phoneAnchors=[]) {
    const words=parseTsvWords(generalTsv);
    if(!phoneAnchors.length || !words.length) return [];

    const heights=words.map(w=>w.height).filter(Boolean);
    const mh=ocrMedian(heights,22);
    const usable=words.filter(w=>{
      const t=cleanOcrToken(w.text);
      if(!t || looksLikeOcrHeader(t) || isOcrNameStopword(t)) return false;
      if(/^\d{4}$/.test(String(t).replace(/\D/g,''))) return false;
      return true;
    });

    const usedNameWords=new Set();
    const result=[];

    phoneAnchors.slice().sort((a,b)=>a.cy-b.cy).forEach((anchor,index)=>{
      const yTol=Math.max(34,mh*2.45,anchor.height*2.15);
      const leftLimit=anchor.left+Math.max(28,anchor.width*.75);

      let near=usable.filter(w=>
        w.cx < leftLimit &&
        Math.abs(w.cy-anchor.cy) <= yTol
      );

      // 표 선이나 행 경계가 없어 OCR이 줄을 나누지 못했을 때,
      // 전화번호 주변에서 가장 가까운 이름 후보를 찾아 같은 사람으로 묶습니다.
      const plausibleNear=near.filter(w=>
        plausibleOcrName(cleanOcrToken(w.text)) &&
        !usedNameWords.has(w)
      );

      let seed=plausibleNear
        .map(w=>({
          word:w,
          score:Math.abs(w.cy-anchor.cy)*2 + Math.max(0,anchor.left-w.right)*.06
        }))
        .sort((a,b)=>a.score-b.score)[0]?.word || null;

      if(!seed){
        seed=usable
          .filter(w=>
            !usedNameWords.has(w) &&
            plausibleOcrName(cleanOcrToken(w.text)) &&
            w.cx < anchor.cx + Math.max(35,anchor.width)
          )
          .map(w=>({
            word:w,
            dy:Math.abs(w.cy-anchor.cy),
            dx:Math.abs(anchor.left-w.right)
          }))
          .filter(x=>x.dy<=Math.max(90,mh*4.2,anchor.height*4))
          .sort((a,b)=>(a.dy*2+a.dx*.08)-(b.dy*2+b.dx*.08))[0]?.word || null;
      }

      if(seed){
        const seedTol=Math.max(24,mh*1.55,seed.height*1.5);
        const rowCy=seed.cy;
        const seedBand=usable.filter(w=>
          w.cx < leftLimit &&
          Math.abs(w.cy-rowCy)<=seedTol
        );
        if(seedBand.length) near=seedBand;
      }

      near=near
        .filter(w=>!usedNameWords.has(w) || w===seed)
        .sort((a,b)=>a.left-b.left);

      let parsed=rowTextFromWords(near,anchor);

      // 행 구분이 없는 문서에서 이름이 한 단어만 또렷하게 잡힌 경우를 보강합니다.
      if(!plausibleOcrName(parsed.name) && seed){
        parsed={
          ...parsed,
          name:cleanOcrToken(seed.text).replace(/[^가-힣A-Za-z.' -]/g,'').trim().slice(0,30),
          confidence:Math.max(Number(parsed.confidence)||0,Number(seed.conf)||0)
        };
      }

      if(seed) usedNameWords.add(seed);

      result.push({
        rowNumber:index+1,
        name:parsed.name||'',
        org:parsed.org||'',
        phone:anchor.phone,
        confidence:((Number(parsed.confidence)||0)+(Number(anchor.conf)||0))/2,
        selected:Boolean(plausibleOcrName(parsed.name)),
        state:'bad',
        reason:'확인 필요',
        looseLayout:true
      });
    });

    const seen=new Set();
    return result.filter(row=>{
      const key=`${row.phone}|${ocrComparableName(row.name)}`;
      if(seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function mergeLooseOcrRows(primaryRows=[], looseRows=[]) {
    const result=primaryRows.map(row=>({...row}));
    looseRows.forEach(loose=>{
      const index=result.findIndex(row=>row.phone===loose.phone);
      if(index<0){
        result.push({...loose});
        return;
      }

      const current=result[index];
      const currentName=ocrComparableName(current.name);
      const looseName=ocrComparableName(loose.name);

      if(!plausibleOcrName(current.name) && plausibleOcrName(loose.name)){
        current.name=loose.name;
      } else if(
        plausibleOcrName(current.name) &&
        plausibleOcrName(loose.name) &&
        currentName!==looseName &&
        (Number(loose.confidence)||0)>(Number(current.confidence)||0)+9
      ){
        current.name=loose.name;
      }

      if(!String(current.org||'').trim() && String(loose.org||'').trim()){
        current.org=loose.org;
      }
      current.confidence=Math.max(Number(current.confidence)||0,Number(loose.confidence)||0);
    });
    return result;
  }

  async function recognizeOcrLooseLayout(worker, canvas, mode='document') {
    const scaled=scaleOcrCanvas(canvas,1900);
    const prepared=enhanceOcrCanvas(scaled,mode);

    try{
      await worker.setParameters({
        tessedit_pageseg_mode:'11',
        tessedit_char_whitelist:'',
        preserve_interword_spaces:'1',
        user_defined_dpi:'300'
      });
    }catch{}
    const general=await worker.recognize(prepared, {}, {text:true,tsv:true});

    try{
      await worker.setParameters({
        tessedit_pageseg_mode:'11',
        tessedit_char_whitelist:'0123456789',
        preserve_interword_spaces:'1',
        user_defined_dpi:'300'
      });
    }catch{}
    const digits=await worker.recognize(prepared, {}, {text:true,tsv:true});

    const anchors=extractPhoneAnchors(String(digits?.data?.tsv||''));
    const rows=looseRowsFromPhoneAnchors(String(general?.data?.tsv||''),anchors);
    return {
      text:String(general?.data?.text||'').trim(),
      rows,
      anchors,
      score:scoreOcrRows(rows)
    };
  }

  function tableRowsFromTsv(tsv='') {
    const rows=clusterOcrRows(parseTsvWords(tsv)); const result=[];
    rows.forEach((words,rowIndex)=>{
      let phoneWord=words.find(w=>/^\d{4}$/.test(w.text.replace(/\D/g,'')));
      if(!phoneWord) return;
      const phone=phoneWord.text.replace(/\D/g,'');
      const parsed=rowTextFromWords(words.filter(w=>w!==phoneWord && w.cx<phoneWord.cx),phoneWord);
      if(!parsed.name) return;
      result.push({rowNumber:rowIndex+1,name:parsed.name,org:parsed.org,phone,confidence:(parsed.confidence+(phoneWord.conf||0))/2,selected:true,state:'bad',reason:'확인 필요'});
    });
    const seen=new Set(); return result.filter(row=>{const k=`${row.name}|${row.phone}`;if(seen.has(k))return false;seen.add(k);return true;});
  }

  function strictRowsFromText(text='') {
    const rows=[];
    String(text).replace(/\r/g,'').split('\n').map(x=>x.replace(/[｜|]/g,' ').replace(/\s+/g,' ').trim()).filter(Boolean).forEach((line,i)=>{
      if(looksLikeOcrHeader(line)) return;
      const m=line.match(/(?:^|\s)(\d{4})(?:\s|$)/); if(!m) return;
      const phone=m[1]; const left=line.replace(m[0],' ').trim(); const tokens=left.split(' ').map(cleanOcrToken).filter(Boolean); if(!tokens.length)return;
      const nameIndex=tokens.findIndex(plausibleOcrName); const idx=nameIndex>=0?nameIndex:0; const name=tokens[idx]||''; const org=tokens.filter((_,x)=>x!==idx).join(' ');
      rows.push({rowNumber:i+1,name:name.slice(0,30),org:org.slice(0,50),phone,confidence:35,selected:Boolean(plausibleOcrName(name)),state:'bad',reason:'확인 필요'});
    });
    return rows;
  }

  function scoreOcrRows(rows=[]) {
    return rows.reduce((score,row)=>score+15+(plausibleOcrName(row.name)?(/^[가-힣]/.test(row.name)?12:5):0)+(row.org?2:0)+Math.min(5,(Number(row.confidence)||0)/20),0);
  }


  function mergeOcrRowCandidates(primaryRows=[], alternateRows=[]) {
    if(!alternateRows.length) return primaryRows;
    const byPhone=new Map();
    alternateRows.forEach(row=>{
      if(!byPhone.has(row.phone)) byPhone.set(row.phone,[]);
      byPhone.get(row.phone).push(row);
    });

    return primaryRows.map(primary=>{
      const options=byPhone.get(primary.phone)||[];
      if(!options.length) return primary;
      const alternate=options.sort((a,b)=>(Number(b.confidence)||0)-(Number(a.confidence)||0))[0];
      const out={...primary};
      const pName=ocrComparableName(primary.name), aName=ocrComparableName(alternate.name);

      if(!plausibleOcrName(primary.name) && plausibleOcrName(alternate.name)) out.name=alternate.name;
      else if(plausibleOcrName(primary.name) && plausibleOcrName(alternate.name) && pName!==aName){
        if((aName.startsWith(pName)||pName.startsWith(aName)) && aName.length>pName.length && aName.length<=6) out.name=alternate.name;
        else if((Number(alternate.confidence)||0)>(Number(primary.confidence)||0)+7) out.name=alternate.name;
      }

      const pOrg=String(primary.org||'').trim(), aOrg=String(alternate.org||'').trim();
      if(!pOrg && aOrg) out.org=aOrg;
      else if(!/^\d{1,4}$/.test(pOrg.replace(/\D/g,'')) && /^\d{1,4}$/.test(aOrg.replace(/\D/g,''))) out.org=aOrg;
      out.confidence=Math.max(Number(primary.confidence)||0,Number(alternate.confidence)||0);
      return out;
    });
  }

  function scoreOcrOrientation(words=[], text='') {
    const four=words.filter(w=>/^\d{4}$/.test(w.text.replace(/\D/g,''))).length;
    const near=words.filter(w=>/^\d{3,5}$/.test(w.text.replace(/\D/g,''))).length;
    const korean=words.filter(w=>/[가-힣]{2,}/.test(w.text)).length;
    const plausible=words.filter(w=>plausibleOcrName(w.text)).length;
    const compact=String(text||'').replace(/\s/g,'');
    const headers=['이름','성명','소속','전화','연락처'].filter(x=>compact.includes(x)).length;
    return four*35+near*8+korean*5+plausible*2+headers*14+Math.min(20,words.length*.18);
  }

  async function recognizeOcrOrientation(worker, canvas, label, index, total, angle) {
    setOcrProgress(`${label} 방향 분석 ${index}/${total}`, Math.max(.06,(index-1)/total*.48));
    try{ await worker.setParameters({tessedit_pageseg_mode:'11',tessedit_char_whitelist:'',preserve_interword_spaces:'1',user_defined_dpi:'300'}); }catch{}
    const result=await worker.recognize(enhanceOcrCanvas(canvas,'document'), {}, { text:true, tsv:true });
    const text=String(result?.data?.text||'').trim(); const tsv=String(result?.data?.tsv||'');
    const words=parseTsvWords(tsv);
    return {angle,text,tsv,words,score:scoreOcrOrientation(words,text),width:canvas.width,height:canvas.height};
  }

  async function recognizeOcrFinal(worker, canvas, mode='document') {
    const scaled=scaleOcrCanvas(canvas,1900);
    const prepared=enhanceOcrCanvas(scaled,mode);
    try{ await worker.setParameters({tessedit_pageseg_mode:'6',tessedit_char_whitelist:'',preserve_interword_spaces:'1',user_defined_dpi:'300'}); }catch{}
    const general=await worker.recognize(prepared, {}, {text:true,tsv:true});

    try{ await worker.setParameters({tessedit_pageseg_mode:'6',tessedit_char_whitelist:'0123456789',preserve_interword_spaces:'1',user_defined_dpi:'300'}); }catch{}
    const digits=await worker.recognize(prepared, {}, {text:true,tsv:true});
    const anchors=extractPhoneAnchors(String(digits?.data?.tsv||''));
    let rows=rowsFromPhoneAnchors(String(general?.data?.tsv||''),anchors);
    if(!rows.length) rows=tableRowsFromTsv(String(general?.data?.tsv||''));
    if(!rows.length) rows=strictRowsFromText(String(general?.data?.text||''));

    // 같은 사진을 명암 이진화 방식으로 한 번 더 읽어 한글 이름/소속 후보를 교차 비교합니다.
    if(mode==='document' && anchors.length){
      try{
        const binaryPrepared=enhanceOcrCanvas(scaled,'binary');
        await worker.setParameters({tessedit_pageseg_mode:'6',tessedit_char_whitelist:'',preserve_interword_spaces:'1',user_defined_dpi:'300'});
        const alternate=await worker.recognize(binaryPrepared, {}, {text:true,tsv:true});
        const alternateRows=rowsFromPhoneAnchors(String(alternate?.data?.tsv||''),anchors);
        rows=mergeOcrRowCandidates(rows,alternateRows);
      }catch(error){
        console.warn('OCR alternate name pass skipped:',error);
      }
    }

    return {text:String(general?.data?.text||'').trim(),rows,anchors,score:scoreOcrRows(rows)};
  }

  function countUsableOcrRows(attempt=null) {
    return (attempt?.rows||[]).filter(row=>
      /^\d{4}$/.test(String(row.phone||'')) && plausibleOcrName(row.name)
    ).length;
  }

  function chooseBetterOcrAttempt(current, candidate) {
    if(!candidate) return current;
    const currentUsable=countUsableOcrRows(current);
    const candidateUsable=countUsableOcrRows(candidate);
    if(candidateUsable>currentUsable) return candidate;
    if(candidateUsable<currentUsable) return current;

    const currentPhones=(current?.anchors||[]).length;
    const candidatePhones=(candidate?.anchors||[]).length;
    if(candidatePhones>currentPhones) return candidate;
    if(candidatePhones<currentPhones) return current;

    return (Number(candidate?.score)||0)>(Number(current?.score)||0) ? candidate : current;
  }

  async function recognizeOcrRescue(worker, canvas, mode='document') {
    let best=null;

    // 기존 V36.2의 표/행 인식 방식을 먼저 그대로 재시도합니다.
    try{
      best=await recognizeOcrFinal(worker,canvas,mode);
    }catch(error){
      console.warn('OCR rescue structured pass skipped:',error);
    }

    // 표선·행·칸이 없는 문서에서만 Sparse Text를 보조 후보로 사용합니다.
    try{
      const loose=await recognizeOcrLooseLayout(worker,canvas,mode);
      best=chooseBetterOcrAttempt(best,loose);
    }catch(error){
      console.warn('OCR rescue loose-layout pass skipped:',error);
    }

    return best;
  }

  async function handleOcrImageFile(e) {
    const file=e.target.files?.[0]; if(!file)return;
    const area=$('#ocrWorkArea'), importButton=$('#ocrImportButton'); if(!area||!importButton)return;
    state.ocrFileName=file.name||'촬영 사진'; state.ocrRows=[]; state.ocrRawText=''; importButton.hidden=true;
    const imageUrl=URL.createObjectURL(file);
    area.innerHTML=`<img class="ocr-preview-image" id="ocrPreviewImage" alt="종이 명단 미리보기"><div class="ocr-progress-wrap"><div class="ocr-progress-label"><span id="ocrProgressText">OCR 준비 중</span><span id="ocrProgressPercent">0%</span></div><div class="ocr-progress"><span id="ocrProgressBar"></span></div></div>`;
    $('#ocrPreviewImage').src=imageUrl;

    try{
      await ensureTesseractLoaded();
      const img=await loadOcrImage(file);
      setOcrProgress('사진 방향·조명 확인 중',.03);
      const worker=await Tesseract.createWorker(['kor','eng'],1,{logger:ocrLogger});

      // 1단계: 축소본으로 0/90/270/180도를 비교해 카메라 방향을 자동 선택합니다.
      const angles=[0,90,270,180], labels=['원본','오른쪽 90°','왼쪽 90°','180°'];
      let best={score:-1,angle:0,text:'',tsv:'',words:[],width:1,height:1};
      for(let i=0;i<angles.length;i++){
        const raw=makeOrientedOcrCanvas(img,angles[i],900);
        const attempt=await recognizeOcrOrientation(worker,raw,labels[i],i+1,angles.length,angles[i]);
        if(attempt.score>best.score) best=attempt;
      }

      // 2단계: 방향 분석에서 찾은 글자 영역을 원본 고해상도에서 다시 잘라 크게 확대합니다.
      setOcrProgress('명단 영역 확대·그림자 보정 중',.56);
      const full=makeOrientedOcrCanvas(img,best.angle,2200);
      const rect=ocrContentRect(best.words,best.width,best.height);
      let focused=cropOcrCanvasNormalized(full,rect);
      const skew=estimateOcrDeskew(best.words);
      if(Math.abs(skew)>=.25) focused=rotateOcrCanvas(focused,-skew);

      // 3단계: 일반 글자 OCR + 숫자 전용 OCR을 별도로 실행합니다.
      setOcrProgress('이름·소속·전화번호 정밀 분석 중',.64);
      let finalAttempt=await recognizeOcrFinal(worker,focused,'document');
      if(finalAttempt.anchors.length===0 || finalAttempt.rows.length===0){
        setOcrProgress('흐린 글자 대비 강화 재분석 중',.82);
        const binaryAttempt=await recognizeOcrFinal(worker,focused,'binary');
        finalAttempt=chooseBetterOcrAttempt(finalAttempt,binaryAttempt);
      }

      // 중요: 기존 방식이 한 명이라도 정상 인식했다면 여기서 끝냅니다.
      // 유연 인식은 기존 결과가 0명일 때만 별도의 구조로 실행하며 기존 결과를 덮어쓰지 않습니다.
      if(countUsableOcrRows(finalAttempt)===0){
        setOcrProgress('표선 없는 명단 보조 분석 중',.88);

        const rescueCanvases=[focused,full];
        // 먼 거리 촬영에서 글자가 상단에 작게 모인 경우를 위한 상단 확대 후보.
        if(full.height>full.width*.9){
          rescueCanvases.push(cropOcrCanvasNormalized(full,{x:0,y:0,w:1,h:.72}));
        }

        let rescueBest=null;
        for(const candidateCanvas of rescueCanvases){
          const candidate=await recognizeOcrRescue(worker,candidateCanvas,'document');
          rescueBest=chooseBetterOcrAttempt(rescueBest,candidate);
          if(countUsableOcrRows(rescueBest)>=4) break;
        }

        // 보조 분석이 실제로 더 많은 정상 행을 찾았을 때만 채택합니다.
        finalAttempt=chooseBetterOcrAttempt(finalAttempt,rescueBest);
      }

      await worker.terminate();
      state.ocrRawText=finalAttempt.text;
      state.ocrRows=finalAttempt.rows;
      setOcrProgress('기존 명단과 전화번호 대조 중',.96);
      await applyKnownParticipantHints(state.ocrRows);
      refreshOcrRowStates();
      setOcrProgress('분석 완료',1);
      renderOcrRows(imageUrl);
    }catch(error){
      console.error('ocr recognize error:',error);
      area.innerHTML+=`<div class="ocr-message">사진 글자 읽기에 실패했습니다.<br>${escapeHtml(error.message||'인터넷 연결 또는 사진 품질을 확인해주세요.')}</div>`;
    } finally{
      setTimeout(()=>URL.revokeObjectURL(imageUrl),60000);
    }
  }

  function cleanOcrToken(value='') {
    return String(value).replace(/[|｜]/g,' ').replace(/[,:;]+$/g,'').trim();
  }

  function looksLikeOcrHeader(line='') {
    const compact=String(line).replace(/\s/g,''); const hits=['이름','성명','소속','전화','연락처','핸드폰','휴대폰','번호'].filter(x=>compact.includes(x)).length; return hits>=2;
  }

  function parseOcrRosterText(text='') {
    state.ocrRows=strictRowsFromText(text); refreshOcrRowStates(); return state.ocrRows;
  }


  function ocrComparableName(value='') {
    return String(value||'').toLowerCase().replace(/[^가-힣a-z]/g,'');
  }

  function ocrEditDistance(a='',b='') {
    const x=[...ocrComparableName(a)], y=[...ocrComparableName(b)];
    if(!x.length) return y.length;
    if(!y.length) return x.length;
    const prev=Array.from({length:y.length+1},(_,i)=>i);
    for(let i=1;i<=x.length;i++){
      let last=prev[0]; prev[0]=i;
      for(let j=1;j<=y.length;j++){
        const old=prev[j];
        prev[j]=Math.min(prev[j]+1,prev[j-1]+1,last+(x[i-1]===y[j-1]?0:1));
        last=old;
      }
    }
    return prev[y.length];
  }

  function scoreKnownParticipantMatch(row, participant) {
    const scanned=ocrComparableName(row?.name);
    const known=ocrComparableName(participant?.name);
    if(!known) return -1;
    if(!scanned) return 58;
    if(scanned===known) return 120;
    if((known.startsWith(scanned)||scanned.startsWith(known)) && Math.abs(known.length-scanned.length)<=1) return 102;
    const dist=ocrEditDistance(scanned,known);
    if(dist===1) return 96;
    if(dist===2 && Math.max(scanned.length,known.length)>=4) return 72;
    return -1;
  }

  async function applyKnownParticipantHints(rows=[]) {
    if(!sb || !state.member?.organization_id || !rows.length) return;
    const phones=[...new Set(rows.map(r=>normalizeImportPhone(r.phone||'')).filter(p=>/^\d{4}$/.test(p)))];
    if(!phones.length) return;

    const known=[];
    for(let i=0;i<phones.length;i+=80){
      const batch=phones.slice(i,i+80);
      const {data,error}=await sb
        .from('participants')
        .select('id,name,affiliation,phone_last4')
        .eq('organization_id',state.member.organization_id)
        .in('phone_last4',batch)
        .limit(1000);
      if(error){ console.warn('OCR participant hint load error:',error); return; }
      known.push(...(data||[]));
    }

    const byPhone=new Map();
    known.forEach(p=>{
      const key=normalizeImportPhone(p.phone_last4||'');
      if(!byPhone.has(key)) byPhone.set(key,[]);
      byPhone.get(key).push(p);
    });

    rows.forEach(row=>{
      const matches=byPhone.get(normalizeImportPhone(row.phone||''))||[];
      if(!matches.length) return;
      const ranked=matches
        .map(p=>({p,score:scoreKnownParticipantMatch(row,p)}))
        .filter(x=>x.score>=0)
        .sort((a,b)=>b.score-a.score);
      const best=ranked[0];
      if(!best) return;
      const second=ranked[1];
      const safe=best.score>=90 && (!second || best.score-second.score>=12);
      if(!safe) return;

      if(row.name && row.name!==best.p.name) row.ocrOriginalName=row.name;
      row.name=String(best.p.name||row.name||'').trim();
      if(best.p.affiliation!==null && best.p.affiliation!==undefined && String(best.p.affiliation).trim()) {
        row.org=String(best.p.affiliation).trim();
      }
      row.knownMatch=true;
    });
  }

  function refreshOcrRowStates() {
    const currentKeys = new Set(state.people.map(p => importPersonKey(p.name, p.phone)));
    const scannedKeys = new Set();

    state.ocrRows.forEach(row => {
      row.name = String(row.name || '').trim();
      row.org = String(row.org || '').trim();
      row.phone = normalizeImportPhone(row.phone || '');
      if (typeof row.selected !== 'boolean') row.selected = true;

      if (!row.name) {
        row.state = 'bad';
        row.reason = '이름 확인';
        return;
      }
      if (!/^\d{4}$/.test(row.phone)) {
        row.state = 'bad';
        row.reason = '전화 4자리';
        return;
      }

      const key = importPersonKey(row.name, row.phone);
      if (currentKeys.has(key)) {
        row.state = 'skip';
        row.reason = '현재 명단 중복';
      } else if (scannedKeys.has(key)) {
        row.state = 'skip';
        row.reason = '사진 내 중복';
      } else {
        row.state = 'ok';
        row.reason = row.knownMatch ? '기존 명단 일치' : '등록 가능';
        scannedKeys.add(key);
      }
    });
  }

  function updateOcrEditorState(area=$('#ocrWorkArea'), importButton=$('#ocrImportButton')) {
    if(!area||!importButton) return;
    refreshOcrRowStates();

    const ok=state.ocrRows.filter(r=>r.state==='ok').length;
    const skip=state.ocrRows.filter(r=>r.state==='skip').length;
    const bad=state.ocrRows.filter(r=>r.state==='bad').length;
    const selectedOk=state.ocrRows.filter(r=>r.state==='ok'&&r.selected).length;

    const okEl=$('#ocrOkCount',area), skipEl=$('#ocrSkipCount',area), badEl=$('#ocrBadCount',area);
    if(okEl) okEl.textContent=String(ok);
    if(skipEl) skipEl.textContent=String(skip);
    if(badEl) badEl.textContent=String(bad);

    $$('.ocr-row',area).forEach(rowEl=>{
      const index=Number(rowEl.dataset.ocrIndex);
      const row=state.ocrRows[index]; if(!row)return;
      const stateEl=$('.ocr-row-state',rowEl);
      if(stateEl){
        stateEl.className=`ocr-row-state ${row.state}`;
        stateEl.textContent=row.reason;
      }
    });

    importButton.hidden=selectedOk===0;
    importButton.textContent=`선택한 ${selectedOk}명 불러오기`;
  }

  function focusNextOcrEditorInput(current, area=$('#ocrWorkArea')) {
    if(!current||!area)return;
    const inputs=$$('.ocr-row .ocr-name, .ocr-row .ocr-org, .ocr-row .ocr-phone',area).filter(el=>!el.disabled);
    const index=inputs.indexOf(current);
    if(index<0)return;
    const next=inputs[index+1];
    if(next){ next.focus({preventScroll:true}); try{next.select?.();}catch{} }
    else current.blur();
  }

  function renderOcrRows(imageUrl='') {
    const area=$('#ocrWorkArea'), importButton=$('#ocrImportButton'); if(!area||!importButton)return;
    refreshOcrRowStates();
    const ok=state.ocrRows.filter(r=>r.state==='ok').length, skip=state.ocrRows.filter(r=>r.state==='skip').length, bad=state.ocrRows.filter(r=>r.state==='bad').length;
    const selectedOk=state.ocrRows.filter(r=>r.state==='ok'&&r.selected).length;
    const oldImage=$('#ocrPreviewImage')?.src||imageUrl;
    area.innerHTML=`
      ${oldImage?`<img class="ocr-preview-image" id="ocrPreviewImage" alt="종이 명단 미리보기" src="${escapeHtml(oldImage)}">`:''}
      <div class="ocr-summary"><div><span>등록 가능</span><b id="ocrOkCount">${ok}</b></div><div><span>중복 제외</span><b id="ocrSkipCount">${skip}</b></div><div><span>확인 필요</span><b id="ocrBadCount">${bad}</b></div></div>
      <div class="ocr-privacy" style="margin:0 0 8px;">기존 표·행 인식을 우선 사용하고, 정상 행이 0명일 때만 표선 없는 명단 보조 인식을 추가로 실행합니다. 기존 참가자와 전화번호가 일치하면 이름·소속도 교차 확인합니다. 칸을 연속으로 눌러도 키보드가 내려가지 않습니다.</div>
      <div id="ocrEditableRows">
        ${state.ocrRows.length?state.ocrRows.map((row,index)=>`<div class="ocr-row" data-ocr-index="${index}"><input type="checkbox" class="ocr-select" ${row.selected?'checked':''} aria-label="등록 선택"><input class="ocr-name" value="${escapeHtml(row.name)}" maxlength="30" placeholder="이름" enterkeyhint="next" autocomplete="off"><input class="ocr-org" value="${escapeHtml(row.org)}" maxlength="50" placeholder="소속" enterkeyhint="next" autocomplete="off"><div><input class="ocr-phone" value="${escapeHtml(row.phone)}" inputmode="numeric" maxlength="4" placeholder="뒤4자리" enterkeyhint="next" autocomplete="off"><div class="ocr-row-state ${row.state}">${escapeHtml(row.reason)}</div></div></div>`).join(''):'<div class="ocr-message">전화번호 4자리를 확실하게 읽은 명단 행을 찾지 못했습니다. 자동 보정으로도 복구되지 않는 흔들림·심한 초점 흐림은 글자 정보가 사라질 수 있습니다. 조금 더 가까이 촬영하거나 아래 `+ 행 추가`로 직접 입력해주세요.</div>'}
      </div>
      <button type="button" class="ocr-add-row" id="ocrAddRow">+ 행 추가</button>
      <details class="ocr-raw-box"><summary>OCR 원문 확인</summary><textarea class="ocr-raw-text" id="ocrRawText">${escapeHtml(state.ocrRawText)}</textarea></details>`;

    $$('.ocr-row',area).forEach(rowEl=>{
      const index=Number(rowEl.dataset.ocrIndex);
      const name=$('.ocr-name',rowEl), org=$('.ocr-org',rowEl), phone=$('.ocr-phone',rowEl), pick=$('.ocr-select',rowEl);
      const row=state.ocrRows[index]; if(!row)return;

      pick?.addEventListener('change',()=>{
        row.selected=pick.checked;
        updateOcrEditorState(area,importButton);
      });

      const sync=()=>{
        row.name=name?.value||'';
        row.org=org?.value||'';
        if(phone){
          const digits=String(phone.value||'').replace(/\D/g,'').slice(0,4);
          if(phone.value!==digits) phone.value=digits;
          row.phone=digits;
        }
        row.knownMatch=false;
        updateOcrEditorState(area,importButton);
      };

      [name,org,phone].forEach(input=>{
        input?.addEventListener('input',sync);
        input?.addEventListener('keydown',e=>{
          if(e.key==='Enter'){
            e.preventDefault();
            sync();
            focusNextOcrEditorInput(input,area);
          }
        });
      });
    });

    $('#ocrAddRow')?.addEventListener('click',()=>{
      state.ocrRows.push({rowNumber:state.ocrRows.length+1,name:'',org:'',phone:'',selected:true,state:'bad',reason:'이름 확인'});
      renderOcrRows($('#ocrPreviewImage')?.src||oldImage);
      requestAnimationFrame(()=>$$('.ocr-row',area).at(-1)?.querySelector('.ocr-name')?.focus());
    });
    $('#ocrRawText')?.addEventListener('change',e=>{state.ocrRawText=e.target.value||'';});
    importButton.hidden=selectedOk===0;
    importButton.textContent=`선택한 ${selectedOk}명 불러오기`;
  }

  async function importOcrRows() {
    if (!state.event) {
      toast('먼저 행사를 등록해주세요.');
      return;
    }

    refreshOcrRowStates();
    const rows = state.ocrRows.filter(r => r.state === 'ok' && r.selected);
    if (!rows.length) {
      toast('등록 가능한 명단이 없습니다.');
      return;
    }

    const button = $('#ocrImportButton');
    if (button) {
      button.disabled = true;
      button.textContent = 'OCR 명단 등록 중…';
    }

    try {
      const reusable = await findReusableParticipants(rows);
      const participantIdByKey = new Map();

      for (const p of reusable) {
        participantIdByKey.set(importPersonKey(p.name, p.phone_last4), p.id);
      }

      const needCreate = rows.filter(r => !participantIdByKey.has(importPersonKey(r.name, r.phone)));

      for (let i = 0; i < needCreate.length; i += 100) {
        const batch = needCreate.slice(i, i + 100);
        const { data, error } = await sb
          .from('participants')
          .insert(batch.map(r => ({
            organization_id: state.member.organization_id,
            name: r.name,
            affiliation: r.org || null,
            phone_last4: r.phone
          })))
          .select('id,name,affiliation,phone_last4');
        if (error) throw error;

        for (const p of data || []) {
          participantIdByKey.set(importPersonKey(p.name, p.phone_last4), p.id);
        }
      }

      const links = rows
        .map(r => ({
          event_id: state.event.id,
          participant_id: participantIdByKey.get(importPersonKey(r.name, r.phone))
        }))
        .filter(x => x.participant_id);

      for (let i = 0; i < links.length; i += 100) {
        const { error } = await sb
          .from('event_participants')
          .insert(links.slice(i, i + 100));
        if (error) throw error;
      }

      await loadPeople();
      renderAll();
      queueGoogleSheetsCurrentSync();
      resetOcrDialog();
      $('#ocrRosterDialog')?.close();
      toast(`OCR 명단 ${links.length}명 등록 완료`);
    } catch (error) {
      console.error('ocr import error:', error);
      toast(`OCR 명단 등록 실패 · ${error.message || '확인 필요'}`);
      if (button) {
        button.disabled = false;
        button.textContent = `등록 가능한 ${rows.length}명 불러오기`;
      }
    }
  }

  function ensureSpreadsheetUI() {
    if ($('#spreadsheetDialog')) return;

    const style = document.createElement('style');
    style.textContent = `
      #spreadsheetDialog{
        width:min(calc(100% - 28px),460px);
        border:0;
        border-radius:26px;
        padding:0;
        background:#fff;
        box-shadow:0 22px 70px rgba(20,39,45,.24);
      }
      #spreadsheetDialog::backdrop{
        background:rgba(18,26,30,.36);
        backdrop-filter:blur(3px);
        -webkit-backdrop-filter:blur(3px);
      }
      .sheet-dialog-body{
        box-sizing:border-box;
        padding:22px 18px 20px;
        max-height:84dvh;
        overflow-y:auto;
        -webkit-overflow-scrolling:touch;
      }
      .sheet-dialog-head{
        display:flex;
        align-items:flex-start;
        justify-content:space-between;
        gap:12px;
        margin-bottom:16px;
      }
      .sheet-dialog-head h2{font-size:22px;margin:0 0 4px}
      .sheet-dialog-head p{margin:0;color:#7f8a90;font-size:12px;line-height:1.45}
      .sheet-dialog-close{
        border:0;
        background:#f1f3f4;
        width:38px;
        height:38px;
        border-radius:50%;
        font-size:23px;
        color:#596267;
        flex:0 0 auto;
      }
      .sheet-direct-box{
        margin:0 0 14px;
        padding:13px;
        border:1px solid #cfeee9;
        border-radius:18px;
        background:#f4fffd;
      }
      .sheet-direct-head{
        display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;
      }
      .sheet-direct-head strong{font-size:14px;color:#176e68}
      .sheet-connected{
        color:#159f93;background:#e6f8f5;border-radius:999px;padding:5px 8px;font-size:10px;font-weight:900;
      }
      .sheet-direct-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .sheet-direct-actions button{
        min-height:48px;border:0;border-radius:14px;background:#fff;color:#159f93;
        font-size:12px;font-weight:900;padding:9px;border:1px solid #d8efeb;
      }
      .sheet-direct-note{margin-top:9px;color:#64777c;font-size:10px;line-height:1.45}
      .sheet-action-grid{display:grid;gap:10px}
      .sheet-action{
        width:100%;
        min-height:68px;
        border:1px solid #e3ebed;
        border-radius:18px;
        background:#fff;
        padding:12px 14px;
        text-align:left;
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:12px;
      }
      .sheet-action strong{display:block;font-size:15px;color:#243036}
      .sheet-action small{display:block;font-size:11px;color:#839096;margin-top:3px;line-height:1.4}
      .sheet-action .sheet-icon{
        width:38px;height:38px;border-radius:12px;background:#eff9f7;color:#159f93;
        display:grid;place-items:center;font-size:18px;font-weight:900;flex:0 0 auto;
      }
      .sheet-compat{
        margin:12px 0 0;
        padding:12px 13px;
        background:#f6faf9;
        border-radius:14px;
        color:#65747b;
        font-size:11px;
        line-height:1.55;
      }
      #sheetPreview{margin-top:14px}
      .sheet-preview-summary{
        display:grid;
        grid-template-columns:repeat(3,minmax(0,1fr));
        gap:7px;
        margin-bottom:10px;
      }
      .sheet-preview-summary div{
        background:#f7fafb;border-radius:13px;padding:10px 5px;text-align:center;
      }
      .sheet-preview-summary span{display:block;color:#89949a;font-size:9px;font-weight:800}
      .sheet-preview-summary b{display:block;font-size:18px;margin-top:3px}
      .sheet-preview-table{
        border:1px solid #e7edef;
        border-radius:15px;
        overflow:hidden;
      }
      .sheet-preview-row{
        display:grid;
        grid-template-columns:minmax(0,1.2fr) minmax(0,1fr) 68px;
        gap:8px;
        padding:9px 10px;
        border-top:1px solid #edf1f2;
        align-items:center;
        font-size:12px;
      }
      .sheet-preview-row:first-child{border-top:0}
      .sheet-preview-row.header{
        background:#f7fafb;color:#7d898f;font-size:10px;font-weight:850;
      }
      .sheet-preview-row strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .sheet-preview-row small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#7f8c92}
      .sheet-row-state{font-size:10px;font-weight:900;text-align:right}
      .sheet-row-state.ok{color:#159f93}
      .sheet-row-state.skip{color:#a66f15}
      .sheet-row-state.bad{color:#d94d55}
      .sheet-import-confirm{
        width:100%;height:50px;border:0;border-radius:15px;
        background:#22c7b7;color:#fff;font-weight:900;font-size:15px;margin-top:12px;
      }
      .sheet-import-confirm[hidden]{display:none}
      .sheet-preview-message{
        padding:13px;border-radius:14px;background:#fff5f6;color:#bf4049;
        border:1px solid #ffd7da;font-size:12px;line-height:1.5;
      }
    `;
    document.head.appendChild(style);

    const dialog = document.createElement('dialog');
    dialog.id = 'spreadsheetDialog';
    dialog.innerHTML = `
      <div class="sheet-dialog-body">
        <div class="sheet-dialog-head">
          <div>
            <h2>명단 불러오기 · 내보내기</h2>
            <p>Excel · Apple Numbers · Google Sheets에서 같은 파일을 사용할 수 있습니다.</p>
          </div>
          <button type="button" class="sheet-dialog-close" id="spreadsheetClose" aria-label="닫기">×</button>
        </div>

        <div class="sheet-direct-box">
          <div class="sheet-direct-head">
            <strong>Google Sheets 직접 연동</strong>
            <span class="sheet-connected">연결됨</span>
          </div>
          <div class="sheet-direct-actions">
            <button type="button" id="googleSheetsImportButton">명단입력 가져오기</button>
            <button type="button" id="googleSheetsSyncButton">현재행사 지금 동기화</button>
          </div>
          <div class="sheet-direct-note">
            출석·개인출발·현장도착·명단 변경은 Google Sheets의 <strong>현재행사</strong> 탭에 자동 반영되고,
            행사 종료 시 <strong>행사기록</strong> 탭에 보관됩니다.
          </div>
        </div>

        <div class="sheet-action-grid">
          <button type="button" class="sheet-action" id="spreadsheetImportButton">
            <div>
              <strong>명단 파일 불러오기</strong>
              <small>.xlsx · .xls · .csv / 이름 + 전화 뒤 4자리 필수</small>
            </div>
            <span class="sheet-icon">↑</span>
          </button>

          <button type="button" class="sheet-action" id="spreadsheetExportButton">
            <div>
              <strong>현재 행사 명단 내보내기</strong>
              <small>출석상태 · 출석시간 · 현장도착시간까지 .xlsx로 저장</small>
            </div>
            <span class="sheet-icon">↓</span>
          </button>

          <button type="button" class="sheet-action" id="spreadsheetTemplateButton">
            <div>
              <strong>빈 명단 양식 받기</strong>
              <small>이름 · 소속 · 전화번호 뒤 4자리 기본 양식</small>
            </div>
            <span class="sheet-icon">＋</span>
          </button>
        </div>

        <input id="spreadsheetFileInput" type="file" accept=".xlsx,.xls,.csv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>

        <div class="sheet-compat">
          Google Sheets는 시트를 <strong>Excel(.xlsx)</strong> 또는 <strong>CSV</strong>로 내려받아 불러올 수 있고,
          내보낸 .xlsx 파일은 Excel · Numbers · Google Sheets에서 그대로 열 수 있습니다.
        </div>

        <div id="sheetPreview"></div>
        <button type="button" id="spreadsheetImportConfirm" class="sheet-import-confirm" hidden>등록 가능한 명단 불러오기</button>
      </div>
    `;
    document.body.appendChild(dialog);

    $('#spreadsheetClose')?.addEventListener('click', () => {
      resetSpreadsheetPreview();
      dialog.close();
    });
    $('#spreadsheetImportButton')?.addEventListener('click', () => {
      if (!state.event) {
        toast('먼저 행사를 등록해주세요.');
        return;
      }
      const input = $('#spreadsheetFileInput');
      if (input) {
        input.value = '';
        input.click();
      }
    });
    $('#googleSheetsImportButton')?.addEventListener('click', previewGoogleSheetsRoster);
    $('#googleSheetsSyncButton')?.addEventListener('click', () => syncGoogleSheetsCurrent(true));
    $('#spreadsheetFileInput')?.addEventListener('change', handleSpreadsheetFile);
    $('#spreadsheetImportConfirm')?.addEventListener('click', importSpreadsheetRows);
    $('#spreadsheetExportButton')?.addEventListener('click', exportCurrentEventSpreadsheet);
    $('#spreadsheetTemplateButton')?.addEventListener('click', exportSpreadsheetTemplate);
  }

  function openSpreadsheetDialog() {
    ensureSpreadsheetUI();
    resetSpreadsheetPreview();
    $('#spreadsheetDialog')?.showModal();
  }

  function resetSpreadsheetPreview() {
    state.spreadsheetRows = [];
    state.spreadsheetFileName = '';
    const preview = $('#sheetPreview');
    const confirm = $('#spreadsheetImportConfirm');
    if (preview) preview.innerHTML = '';
    if (confirm) {
      confirm.hidden = true;
      confirm.disabled = false;
      confirm.textContent = '등록 가능한 명단 불러오기';
    }
  }

  function normalizeSheetHeader(value) {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[\s._\-()/]/g, '');
  }

  function findSheetColumn(headers, aliases) {
    const normalized = headers.map(normalizeSheetHeader);
    for (const alias of aliases) {
      const idx = normalized.indexOf(normalizeSheetHeader(alias));
      if (idx >= 0) return idx;
    }
    return -1;
  }

  function normalizeImportPhone(value) {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length >= 4) return digits.slice(-4);
    return digits;
  }

  function importPersonKey(name, phone) {
    return `${String(name || '').trim().toLowerCase()}|${String(phone || '').trim()}`;
  }

  async function handleSpreadsheetFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!window.XLSX) {
      $('#sheetPreview').innerHTML = '<div class="sheet-preview-message">Excel 처리 모듈을 불러오지 못했습니다. 인터넷 연결 후 다시 시도해주세요.</div>';
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type:'array', cellDates:false });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!firstSheet) throw new Error('첫 번째 시트를 찾지 못했습니다.');

      const rows = XLSX.utils.sheet_to_json(firstSheet, {
        header:1,
        defval:'',
        raw:false,
        blankrows:false
      });

      if (!rows.length) throw new Error('파일에 데이터가 없습니다.');

      const headers = rows[0].map(v => String(v ?? '').trim());
      const nameCol = findSheetColumn(headers, ['이름','성명','name']);
      const orgCol = findSheetColumn(headers, ['소속','기관','회사','단체','affiliation','organization','org']);
      const phoneCol = findSheetColumn(headers, [
        '전화번호 뒤 4자리','전화번호뒤4자리','전화 뒤 4자리','전화뒤4자리',
        '뒤4자리','핸드폰뒤4자리','휴대폰뒤4자리','전화번호','연락처','phone','mobile','last4'
      ]);

      if (nameCol < 0 || phoneCol < 0) {
        state.spreadsheetRows = [];
        $('#sheetPreview').innerHTML = `
          <div class="sheet-preview-message">
            첫 줄에서 <strong>이름</strong>과 <strong>전화번호 뒤 4자리</strong> 열을 찾지 못했습니다.<br>
            빈 명단 양식을 받아 같은 제목으로 작성해주세요.
          </div>`;
        $('#spreadsheetImportConfirm').hidden = true;
        return;
      }

      const currentKeys = new Set(
        state.people.map(p => importPersonKey(p.name, p.phone))
      );
      const fileKeys = new Set();
      const parsed = [];

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i] || [];
        const name = String(row[nameCol] ?? '').trim();
        const org = orgCol >= 0 ? String(row[orgCol] ?? '').trim() : '';
        const phone = normalizeImportPhone(row[phoneCol]);

        if (!name && !org && !phone) continue;

        let stateLabel = 'ok';
        let reason = '등록 가능';

        if (!name) {
          stateLabel = 'bad';
          reason = '이름 없음';
        } else if (!/^\d{4}$/.test(phone)) {
          stateLabel = 'bad';
          reason = '전화 4자리 오류';
        } else {
          const key = importPersonKey(name, phone);
          if (currentKeys.has(key)) {
            stateLabel = 'skip';
            reason = '현재 명단 중복';
          } else if (fileKeys.has(key)) {
            stateLabel = 'skip';
            reason = '파일 내 중복';
          } else {
            fileKeys.add(key);
          }
        }

        parsed.push({
          rowNumber: i + 1,
          name,
          org,
          phone,
          state: stateLabel,
          reason
        });
      }

      state.spreadsheetRows = parsed;
      state.spreadsheetFileName = file.name || '';
      renderSpreadsheetPreview();
    } catch (error) {
      console.error('spreadsheet parse error:', error);
      state.spreadsheetRows = [];
      $('#sheetPreview').innerHTML = `<div class="sheet-preview-message">파일을 읽지 못했습니다. .xlsx, .xls, .csv 파일인지 확인해주세요.</div>`;
      $('#spreadsheetImportConfirm').hidden = true;
    }
  }

  function renderSpreadsheetPreview() {
    const preview = $('#sheetPreview');
    const confirm = $('#spreadsheetImportConfirm');
    if (!preview || !confirm) return;

    const rows = state.spreadsheetRows;
    const ok = rows.filter(r => r.state === 'ok').length;
    const skip = rows.filter(r => r.state === 'skip').length;
    const bad = rows.filter(r => r.state === 'bad').length;
    const sample = rows.slice(0, 8);

    preview.innerHTML = `
      <div style="font-size:13px;font-weight:900;margin-bottom:8px;">${escapeHtml(state.spreadsheetFileName || '선택 파일')}</div>
      <div class="sheet-preview-summary">
        <div><span>등록 가능</span><b>${ok}</b></div>
        <div><span>중복 제외</span><b>${skip}</b></div>
        <div><span>오류 제외</span><b>${bad}</b></div>
      </div>
      <div class="sheet-preview-table">
        <div class="sheet-preview-row header"><strong>이름</strong><small>소속</small><span>상태</span></div>
        ${sample.map(r => `
          <div class="sheet-preview-row">
            <strong>${escapeHtml(r.name || `(${r.rowNumber}행)`)}</strong>
            <small>${escapeHtml(r.org || '소속 없음')}</small>
            <span class="sheet-row-state ${r.state}">${escapeHtml(r.reason)}</span>
          </div>
        `).join('')}
      </div>
      ${rows.length > sample.length ? `<div style="margin-top:7px;color:#8a959b;font-size:10px;">외 ${rows.length - sample.length}행</div>` : ''}
    `;

    confirm.hidden = ok === 0;
    confirm.textContent = `등록 가능한 ${ok}명 불러오기`;
  }

  async function findReusableParticipants(rows) {
    const uniqueNames = [...new Set(rows.map(r => r.name).filter(Boolean))];
    const result = [];
    for (let i = 0; i < uniqueNames.length; i += 80) {
      const batch = uniqueNames.slice(i, i + 80);
      const { data, error } = await sb
        .from('participants')
        .select('id,name,affiliation,phone_last4')
        .eq('organization_id', state.member.organization_id)
        .in('name', batch)
        .limit(1000);
      if (error) throw error;
      result.push(...(data || []));
    }
    return result;
  }

  async function importSpreadsheetRows() {
    if (!state.event) {
      toast('먼저 행사를 등록해주세요.');
      return;
    }

    const rows = state.spreadsheetRows.filter(r => r.state === 'ok');
    if (!rows.length) {
      toast('등록 가능한 명단이 없습니다.');
      return;
    }

    const button = $('#spreadsheetImportConfirm');
    if (button) {
      button.disabled = true;
      button.textContent = '명단 등록 중…';
    }

    try {
      const reusable = await findReusableParticipants(rows);
      const participantIdByKey = new Map();

      for (const p of reusable) {
        participantIdByKey.set(importPersonKey(p.name, p.phone_last4), p.id);
      }

      const needCreate = rows.filter(r => !participantIdByKey.has(importPersonKey(r.name, r.phone)));

      if (needCreate.length) {
        for (let i = 0; i < needCreate.length; i += 100) {
          const batch = needCreate.slice(i, i + 100);
          const { data, error } = await sb
            .from('participants')
            .insert(batch.map(r => ({
              organization_id: state.member.organization_id,
              name: r.name,
              affiliation: r.org || null,
              phone_last4: r.phone
            })))
            .select('id,name,affiliation,phone_last4');

          if (error) throw error;
          for (const p of data || []) {
            participantIdByKey.set(importPersonKey(p.name, p.phone_last4), p.id);
          }
        }
      }

      const links = rows
        .map(r => ({
          event_id: state.event.id,
          participant_id: participantIdByKey.get(importPersonKey(r.name, r.phone))
        }))
        .filter(x => x.participant_id);

      for (let i = 0; i < links.length; i += 100) {
        const { error } = await sb
          .from('event_participants')
          .insert(links.slice(i, i + 100));
        if (error) throw error;
      }

      await loadPeople();
      renderAll();
      queueGoogleSheetsCurrentSync();
      resetSpreadsheetPreview();
      $('#spreadsheetDialog')?.close();
      toast(`명단 ${links.length}명 불러오기 완료`);
    } catch (error) {
      console.error('spreadsheet import error:', error);
      toast(`명단 불러오기 실패 · ${error.message || '확인 필요'}`);
      if (button) {
        button.disabled = false;
        button.textContent = `등록 가능한 ${rows.length}명 불러오기`;
      }
    }
  }

  function safeSpreadsheetFilename(text) {
    return String(text || '행사')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 60);
  }

  function spreadsheetStatusLabel(person) {
    if (person.status === 'individual') {
      return person.arrivedAt ? '개인출발 · 현장도착' : '개인출발';
    }
    if (person.arrivedAt) return '현장도착';
    if (person.status === 'present') return '출석';
    return '미확인';
  }

  function spreadsheetIsoTime(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('ko-KR', {
      year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', hour12:false
    });
  }

  async function shareOrDownloadXlsx(workbook, filename) {
    const data = XLSX.write(workbook, { bookType:'xlsx', type:'array' });
    const file = new File(
      [data],
      filename,
      { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
    );

    try {
      if (navigator.canShare && navigator.canShare({ files:[file] }) && navigator.share) {
        await navigator.share({
          title: filename,
          text: 'QR 자동 출석부 명단 파일',
          files: [file]
        });
        return;
      }
    } catch (error) {
      if (error?.name === 'AbortError') return;
      console.warn('file share fallback:', error);
    }

    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function exportCurrentEventSpreadsheet() {
    if (!state.event) {
      toast('먼저 행사를 등록해주세요.');
      return;
    }
    if (!window.XLSX) {
      toast('Excel 처리 모듈을 불러오지 못했습니다.');
      return;
    }

    const rosterRows = state.people.map(p => ({
      '이름': p.name || '',
      '소속': p.org || '',
      '전화번호 뒤 4자리': p.phone || '',
      '출석상태': spreadsheetStatusLabel(p),
      '출석시간': spreadsheetIsoTime(p.checkedAt),
      '현장도착시간': spreadsheetIsoTime(p.arrivedAt)
    }));

    const total = state.people.length;
    const individual = state.people.filter(p => p.status === 'individual').length;
    const present = state.people.filter(p => p.status === 'present').length;
    const arrived = state.people.filter(p => Boolean(p.arrivedAt)).length;
    const unknown = Math.max(0, total - individual - present);

    const eventRows = [
      ['항목','내용'],
      ['행사명', state.event.title || ''],
      ['행사 날짜', state.event.event_date || ''],
      ['장소', state.event.location || ''],
      ['상태', statusLabel(state.event.status)],
      ['전체', total],
      ['출석', present],
      ['현장도착', arrived],
      ['개인출발', individual],
      ['미확인', unknown]
    ];

    const wb = XLSX.utils.book_new();
    const rosterSheet = XLSX.utils.json_to_sheet(rosterRows.length ? rosterRows : [{
      '이름':'',
      '소속':'',
      '전화번호 뒤 4자리':'',
      '출석상태':'',
      '출석시간':'',
      '현장도착시간':''
    }]);
    const eventSheet = XLSX.utils.aoa_to_sheet(eventRows);

    rosterSheet['!cols'] = [
      {wch:16},{wch:18},{wch:18},{wch:12},{wch:20},{wch:20}
    ];
    eventSheet['!cols'] = [{wch:16},{wch:30}];

    XLSX.utils.book_append_sheet(wb, rosterSheet, '명단');
    XLSX.utils.book_append_sheet(wb, eventSheet, '행사정보');

    const filename = `${safeSpreadsheetFilename(state.event.event_date)}_${safeSpreadsheetFilename(state.event.title)}_출석명단.xlsx`;
    await shareOrDownloadXlsx(wb, filename);
  }

  async function exportSpreadsheetTemplate() {
    if (!window.XLSX) {
      toast('Excel 처리 모듈을 불러오지 못했습니다.');
      return;
    }

    const rows = [
      ['이름','소속','전화번호 뒤 4자리'],
      ['홍길동','예시 소속','1234']
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{wch:18},{wch:24},{wch:20}];
    XLSX.utils.book_append_sheet(wb, ws, '명단');
    await shareOrDownloadXlsx(wb, 'QR출석부_명단_양식.xlsx');
  }

  function ensureHistoryUI() {
    if ($('#historyButton')) return;

    const homeActions = $('.list-card.compact-actions');
    if (homeActions) {
      const button = document.createElement('button');
      button.id = 'historyButton';
      button.type = 'button';
      button.dataset.go = 'history';
      button.innerHTML = `
        <span class="row-icon mint" style="font-weight:900;">≡</span>
        <div><strong>지난 행사 기록</strong><small>종료된 행사 · 명단 · 출석 기록</small></div>
        <span class="chev">›</span>
      `;
      homeActions.appendChild(button);
    }

    const style = document.createElement('style');
    style.textContent = `
      .history-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 12px}
      .history-danger-button{border:1px solid #ffd7da;background:#fff6f6;color:#d94d55;border-radius:13px;padding:10px 12px;font-size:13px;font-weight:850}
      .history-list{display:grid;gap:10px}
      .history-card{background:#fff;border:1px solid #e6ecee;border-radius:20px;padding:16px;box-shadow:0 5px 18px rgba(28,54,61,.05)}
      .history-card-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
      .history-card-date{color:#159f93;font-size:12px;font-weight:900;margin-bottom:4px}
      .history-card h3{font-size:17px;margin:0 0 4px;line-height:1.25}
      .history-card-location{color:#7c888e;font-size:12px}
      .history-card-open{border:0;background:#f0faf8;color:#159f93;border-radius:12px;padding:8px 10px;font-weight:850;flex:0 0 auto}
      .history-stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;margin-top:13px}
      .history-stat{background:#f8fafb;border-radius:12px;padding:8px 4px;text-align:center}
      .history-stat span{display:block;color:#899399;font-size:9px;font-weight:800;white-space:nowrap}
      .history-stat b{display:block;margin-top:3px;font-size:16px;color:#253036}
      .history-more{width:100%;height:46px;margin-top:12px;border:1px solid #dce7e8;background:#fff;color:#159f93;border-radius:14px;font-weight:850}
      #historyDetailDialog,#historyDeleteDialog{width:min(calc(100% - 28px),460px);border:0;border-radius:26px;padding:0;background:#fff;box-shadow:0 22px 70px rgba(20,39,45,.24)}
      #historyDetailDialog::backdrop,#historyDeleteDialog::backdrop{background:rgba(18,26,30,.36);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}
      .history-dialog-body{box-sizing:border-box;padding:22px 18px 20px;max-height:82dvh;overflow-y:auto;-webkit-overflow-scrolling:touch}
      .history-dialog-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px}
      .history-dialog-head h2{font-size:21px;margin:0 0 4px}
      .history-dialog-head p{margin:0;color:#7f8a90;font-size:12px}
      .history-close{border:0;background:#f1f3f4;width:38px;height:38px;border-radius:50%;font-size:23px;color:#596267;flex:0 0 auto}
      .history-detail-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:12px 0}
      .history-detail-summary div{background:#f7fafb;border-radius:14px;padding:11px 6px;text-align:center}
      .history-detail-summary span{display:block;color:#879197;font-size:10px;font-weight:800}
      .history-detail-summary b{display:block;font-size:18px;margin-top:3px}
      .history-section-title{font-size:15px;font-weight:900;margin:18px 0 7px}
      .history-person-row,.history-log-row{display:flex;align-items:center;justify-content:space-between;gap:10px;border-top:1px solid #edf1f2;padding:11px 2px}
      .history-person-row:first-child,.history-log-row:first-child{border-top:0}
      .history-person-row strong,.history-log-row strong{display:block;font-size:13px}
      .history-person-row small,.history-log-row small{display:block;color:#859096;font-size:11px;margin-top:2px}
      .history-status{font-size:11px;font-weight:900;color:#159f93;white-space:nowrap}
      .history-empty{padding:18px 4px;text-align:center;color:#879197;font-size:13px}
      .history-delete-event{width:100%;height:48px;border:1px solid #ffcfd3;background:#fff5f6;color:#d94d55;border-radius:15px;font-weight:900;margin-top:18px}
      .history-delete-form label{display:block;font-size:12px;font-weight:850;margin:13px 0 6px}
      .history-delete-form select,.history-delete-form input{box-sizing:border-box;width:100%;height:48px;border:1px solid #dfe7e9;border-radius:14px;padding:0 12px;background:#fff;font-size:15px}
      .history-preview-button{width:100%;height:48px;border:0;background:#eff9f7;color:#159f93;border-radius:14px;font-weight:900;margin-top:14px}
      .history-delete-warning{margin-top:14px;padding:14px;border-radius:15px;background:#fff4f5;border:1px solid #ffd7da;color:#b53c45;font-size:13px;line-height:1.5;font-weight:750}
      .history-final-delete{width:100%;height:50px;border:0;background:#d94d55;color:#fff;border-radius:15px;font-weight:900;margin-top:12px}
      .history-final-delete[hidden]{display:none}
      .history-delete-note{color:#8b959a;font-size:11px;line-height:1.45;margin-top:10px}
    `;
    document.head.appendChild(style);

    const screen = document.createElement('section');
    screen.className = 'screen';
    screen.dataset.screen = 'history';
    screen.innerHTML = `
      <div class="section-title">
        <div><span class="eyebrow">기록 보관</span><h2>지난 행사 기록</h2></div>
      </div>
      <div class="history-toolbar">
        <span id="historyCountText" style="color:#7f8b91;font-size:12px;font-weight:800;">종료 행사 불러오는 중</span>
        <button type="button" class="history-danger-button" id="historyPeriodDelete">기간별 완전 삭제</button>
      </div>
      <div id="historyList" class="history-list"></div>
      <button type="button" id="historyMore" class="history-more" hidden>20개 더 보기</button>
    `;
    $('#appMain')?.appendChild(screen);

    const detail = document.createElement('dialog');
    detail.id = 'historyDetailDialog';
    detail.innerHTML = `
      <div class="history-dialog-body">
        <div class="history-dialog-head">
          <div><h2 id="historyDetailTitle">행사 기록</h2><p id="historyDetailMeta"></p></div>
          <button type="button" class="history-close" id="historyDetailClose" aria-label="닫기">×</button>
        </div>
        <div id="historyDetailContent"></div>
        <button type="button" class="history-delete-event" id="historyDeleteEventButton">이 행사 완전 삭제</button>
      </div>
    `;
    document.body.appendChild(detail);

    const del = document.createElement('dialog');
    del.id = 'historyDeleteDialog';
    del.innerHTML = `
      <div class="history-dialog-body history-delete-form">
        <div class="history-dialog-head">
          <div><h2>완전 삭제</h2><p>삭제한 자료는 복구할 수 없습니다.</p></div>
          <button type="button" class="history-close" id="historyDeleteClose" aria-label="닫기">×</button>
        </div>
        <div id="historyDeleteRangeFields">
          <label>삭제 범위</label>
          <select id="historyDeleteScope">
            <option value="day">일별</option>
            <option value="month">월별</option>
            <option value="year">년별</option>
          </select>
          <label id="historyDeleteValueLabel">날짜</label>
          <input id="historyDeleteValue" type="date">
          <button type="button" class="history-preview-button" id="historyDeletePreview">삭제 대상 확인</button>
        </div>
        <div id="historyDeleteWarning" class="history-delete-warning" hidden></div>
        <button type="button" id="historyFinalDelete" class="history-final-delete" hidden>완전 삭제</button>
        <div class="history-delete-note">종료된 행사만 삭제합니다. 진행 중인 행사는 기간 삭제 대상에서 제외됩니다.</div>
      </div>
    `;
    document.body.appendChild(del);

    $('#historyMore')?.addEventListener('click', () => loadPastEvents(false));
    $('#historyPeriodDelete')?.addEventListener('click', openPeriodDeleteDialog);
    $('#historyDetailClose')?.addEventListener('click', () => detail.close());
    $('#historyDeleteClose')?.addEventListener('click', () => del.close());
    $('#historyDeleteEventButton')?.addEventListener('click', () => {
      const id = state.historySelectedEvent?.id;
      if (id) openEventDeleteDialog(id);
    });
    $('#historyDeleteScope')?.addEventListener('change', syncHistoryDeleteInput);
    $('#historyDeletePreview')?.addEventListener('click', previewHistoryDelete);
    $('#historyFinalDelete')?.addEventListener('click', executeHistoryDelete);
    syncHistoryDeleteInput();
  }

  function historyStatusLabel(person) {
    const arrived = person.attendance_status === 'arrived' || Boolean(person.arrived_at);
    if (person.travel_mode === 'individual') {
      return arrived ? '개인출발 · 현장도착' : '개인출발';
    }
    if (arrived) return '현장도착';
    if (person.attendance_status === 'checked_in' || person.checked_at) return '출석';
    if (person.attendance_status === 'absent') return '결석';
    if (person.attendance_status === 'cancelled') return '취소';
    return '미확인';
  }

  async function loadPastEvents(reset=true) {
    if (!state.member?.organization_id) return;
    if (reset) {
      state.historyOffset = 0;
      state.historyEvents = [];
    }

    const from = state.historyOffset;
    const to = from + 19;
    const { data, error, count } = await sb
      .from('events')
      .select('id,title,event_date,location,status,created_at', { count:'exact' })
      .eq('organization_id', state.member.organization_id)
      .eq('status', 'ended')
      .order('event_date', { ascending:false })
      .order('created_at', { ascending:false })
      .range(from, to);

    if (error) {
      console.error('history events error:', error);
      toast('지난 행사 기록을 불러오지 못했습니다.');
      return;
    }

    const rows = data || [];
    const ids = rows.map(x => x.id);
    const stats = new Map();

    if (ids.length) {
      const { data: links, error: linkError } = await sb
        .from('event_participants')
        .select('event_id,attendance_status,travel_mode,checked_at,arrived_at')
        .in('event_id', ids);

      if (linkError) {
        console.error('history stats error:', linkError);
      } else {
        for (const row of links || []) {
          if (!stats.has(row.event_id)) {
            stats.set(row.event_id, { total:0,present:0,individual:0,unknown:0,arrived:0 });
          }
          const s = stats.get(row.event_id);
          s.total += 1;
          const individual = row.travel_mode === 'individual';
          const present = !individual && (row.attendance_status === 'checked_in' || row.attendance_status === 'arrived' || Boolean(row.checked_at));
          if (individual) s.individual += 1;
          else if (present) s.present += 1;
          else s.unknown += 1;
          if (row.attendance_status === 'arrived' || row.arrived_at) s.arrived += 1;
        }
      }
    }

    const mapped = rows.map(e => ({
      ...e,
      stats: stats.get(e.id) || { total:0,present:0,individual:0,unknown:0,arrived:0 }
    }));

    state.historyEvents = reset ? mapped : [...state.historyEvents, ...mapped];
    state.historyOffset = state.historyEvents.length;
    state.historyHasMore = rows.length === 20;
    renderPastEvents(count ?? state.historyEvents.length);
  }

  function renderPastEvents(totalCount=state.historyEvents.length) {
    const list = $('#historyList');
    if (!list) return;

    const countText = $('#historyCountText');
    if (countText) countText.textContent = `종료 행사 ${totalCount}건`;

    if (!state.historyEvents.length) {
      list.innerHTML = '<div class="empty-state">보관된 종료 행사가 없습니다.</div>';
    } else {
      list.innerHTML = state.historyEvents.map(e => `
        <article class="history-card">
          <div class="history-card-top">
            <div style="min-width:0;">
              <div class="history-card-date">${escapeHtml((e.event_date || '').replaceAll('-','.'))}</div>
              <h3>${escapeHtml(e.title || '행사')}</h3>
              <div class="history-card-location">${escapeHtml(e.location || '장소 없음')}</div>
            </div>
            <button type="button" class="history-card-open" data-history-open="${e.id}">보기</button>
          </div>
          <div class="history-stats">
            <div class="history-stat"><span>전체</span><b>${e.stats.total}</b></div>
            <div class="history-stat"><span>출석</span><b>${e.stats.present}</b></div>
            <div class="history-stat"><span>도착</span><b>${e.stats.arrived}</b></div>
            <div class="history-stat"><span>개인</span><b>${e.stats.individual}</b></div>
            <div class="history-stat"><span>미확인</span><b>${e.stats.unknown}</b></div>
          </div>
        </article>
      `).join('');
    }

    $$('[data-history-open]', list).forEach(btn => {
      btn.addEventListener('click', () => openPastEventDetail(btn.dataset.historyOpen));
    });

    const more = $('#historyMore');
    if (more) more.hidden = !state.historyHasMore;
  }

  async function openPastEventDetail(eventId) {
    const event = state.historyEvents.find(x => x.id === eventId);
    if (!event) return;

    const [{ data: links, error: linkError }, { data: logs, error: logError }] = await Promise.all([
      sb.from('event_participants')
        .select('id,participant_id,attendance_status,travel_mode,checked_at,arrived_at,participants(name,affiliation,phone_last4)')
        .eq('event_id', eventId)
        .order('created_at', { ascending:true })
        .limit(1000),
      sb.from('attendance_logs')
        .select('id,participant_id,action,source,created_at,participants(name,affiliation)')
        .eq('event_id', eventId)
        .order('created_at', { ascending:false })
        .limit(1000)
    ]);

    if (linkError || logError) {
      console.error('history detail error:', linkError || logError);
      toast('행사 상세 기록을 불러오지 못했습니다.');
      return;
    }

    const people = links || [];
    const historyLogs = logs || [];
    const total = people.length;
    const individual = people.filter(p => p.travel_mode === 'individual').length;
    const present = people.filter(p => p.travel_mode !== 'individual' && (p.attendance_status === 'checked_in' || p.attendance_status === 'arrived' || p.checked_at)).length;
    const arrived = people.filter(p => p.attendance_status === 'arrived' || p.arrived_at).length;
    const unknown = Math.max(0, total - individual - present);

    state.historySelectedEvent = event;
    $('#historyDetailTitle').textContent = event.title || '행사 기록';
    $('#historyDetailMeta').textContent = `${event.event_date || ''}${event.location ? ` · ${event.location}` : ''}`;

    const peopleHtml = people.length ? people.map(p => `
      <div class="history-person-row">
        <div style="min-width:0;">
          <strong>${escapeHtml(p.participants?.name || '이름 없음')}</strong>
          <small>${escapeHtml(p.participants?.affiliation || '소속 없음')}${p.participants?.phone_last4 ? ` · •••• ${escapeHtml(p.participants.phone_last4)}` : ''}</small>
        </div>
        <span class="history-status">${escapeHtml(historyStatusLabel(p))}</span>
      </div>
    `).join('') : '<div class="history-empty">저장된 명단이 없습니다.</div>';

    const logsHtml = historyLogs.length ? historyLogs.map(log => `
      <div class="history-log-row">
        <div style="min-width:0;">
          <strong>${escapeHtml(log.participants?.name || '참가자')}</strong>
          <small>${escapeHtml(formatLogDateTime(log.created_at))}</small>
        </div>
        <div style="text-align:right;flex:0 0 auto;">
          <span class="history-status">${escapeHtml(attendanceActionLabel(log.action))}</span>
          <small>${escapeHtml(attendanceSourceLabel(log.source))}</small>
        </div>
      </div>
    `).join('') : '<div class="history-empty">저장된 출석 변경 기록이 없습니다.</div>';

    $('#historyDetailContent').innerHTML = `
      <div class="history-detail-summary">
        <div><span>전체</span><b>${total}</b></div>
        <div><span>출석</span><b>${present}</b></div>
        <div><span>현장도착</span><b>${arrived}</b></div>
        <div><span>개인출발</span><b>${individual}</b></div>
        <div><span>미확인</span><b>${unknown}</b></div>
        <div><span>변경기록</span><b>${historyLogs.length}</b></div>
      </div>
      <div class="history-section-title">참가자 명단</div>
      <div>${peopleHtml}</div>
      <div class="history-section-title">출석 변경 기록</div>
      <div>${logsHtml}</div>
    `;

    $('#historyDetailDialog')?.showModal();
  }

  function syncHistoryDeleteInput() {
    const scope = $('#historyDeleteScope')?.value || 'day';
    const input = $('#historyDeleteValue');
    const label = $('#historyDeleteValueLabel');
    if (!input || !label) return;

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');

    if (scope === 'day') {
      label.textContent = '날짜';
      input.type = 'date';
      input.value = `${yyyy}-${mm}-${dd}`;
    } else if (scope === 'month') {
      label.textContent = '월';
      input.type = 'month';
      input.value = `${yyyy}-${mm}`;
    } else {
      label.textContent = '연도';
      input.type = 'number';
      input.min = '2000';
      input.max = '2100';
      input.step = '1';
      input.value = String(yyyy);
    }
    clearHistoryDeletePreview();
  }

  function clearHistoryDeletePreview() {
    const warning = $('#historyDeleteWarning');
    const finalButton = $('#historyFinalDelete');
    if (warning) {
      warning.hidden = true;
      warning.textContent = '';
    }
    if (finalButton) finalButton.hidden = true;
  }

  function openPeriodDeleteDialog() {
    state.historyDeleteContext = { type:'range' };
    $('#historyDeleteRangeFields').hidden = false;
    clearHistoryDeletePreview();
    syncHistoryDeleteInput();
    $('#historyDeleteDialog')?.showModal();
  }

  async function openEventDeleteDialog(eventId) {
    const event = state.historyEvents.find(x => x.id === eventId) || state.historySelectedEvent;
    if (!event || event.status !== 'ended') return;
    state.historyDeleteContext = { type:'event', eventId:event.id };
    $('#historyDeleteRangeFields').hidden = true;
    clearHistoryDeletePreview();
    $('#historyDeleteDialog')?.showModal();
    await previewHistoryDelete();
  }

  function monthRange(value) {
    const match = /^(\d{4})-(\d{2})$/.exec(value || '');
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const last = new Date(year, month, 0).getDate();
    return [`${match[1]}-${match[2]}-01`, `${match[1]}-${match[2]}-${String(last).padStart(2,'0')}`];
  }

  async function getHistoryDeleteTargets() {
    if (!state.member?.organization_id || !state.historyDeleteContext) return [];

    let query = sb
      .from('events')
      .select('id,title,event_date,status')
      .eq('organization_id', state.member.organization_id)
      .eq('status', 'ended')
      .order('event_date', { ascending:true });

    if (state.historyDeleteContext.type === 'event') {
      query = query.eq('id', state.historyDeleteContext.eventId);
    } else {
      const scope = $('#historyDeleteScope')?.value || 'day';
      const value = $('#historyDeleteValue')?.value || '';
      state.historyDeleteContext.scope = scope;
      state.historyDeleteContext.value = value;

      if (scope === 'day') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return [];
        query = query.eq('event_date', value);
      } else if (scope === 'month') {
        const range = monthRange(value);
        if (!range) return [];
        query = query.gte('event_date', range[0]).lte('event_date', range[1]);
      } else {
        if (!/^\d{4}$/.test(value)) return [];
        query = query.gte('event_date', `${value}-01-01`).lte('event_date', `${value}-12-31`);
      }
    }

    const { data, error } = await query.limit(1000);
    if (error) throw error;
    return data || [];
  }

  async function countRowsForEvents(table, eventIds) {
    if (!eventIds.length) return 0;
    let total = 0;
    for (let i = 0; i < eventIds.length; i += 80) {
      const batch = eventIds.slice(i, i + 80);
      const { count, error } = await sb
        .from(table)
        .select('*', { count:'exact', head:true })
        .in('event_id', batch);
      if (error) throw error;
      total += count || 0;
    }
    return total;
  }

  function historyDeleteScopeLabel(context, targets) {
    if (context.type === 'event') {
      const e = targets[0];
      return e ? `${e.event_date} · ${e.title}` : '선택 행사';
    }
    if (context.scope === 'day') return `${context.value} 하루`;
    if (context.scope === 'month') return `${context.value} 한 달`;
    return `${context.value}년`;
  }

  async function previewHistoryDelete() {
    try {
      const targets = await getHistoryDeleteTargets();
      const warning = $('#historyDeleteWarning');
      const finalButton = $('#historyFinalDelete');
      if (!warning || !finalButton) return;

      if (!targets.length) {
        warning.hidden = false;
        warning.textContent = '선택한 범위에 삭제할 종료 행사가 없습니다.';
        finalButton.hidden = true;
        return;
      }

      const ids = targets.map(x => x.id);
      const [participantsCount, logsCount, qrCount] = await Promise.all([
        countRowsForEvents('event_participants', ids),
        countRowsForEvents('attendance_logs', ids),
        countRowsForEvents('qr_tokens', ids)
      ]);

      state.historyDeleteContext.targets = targets;
      const scopeLabel = historyDeleteScopeLabel(state.historyDeleteContext, targets);
      warning.hidden = false;
      warning.innerHTML = `
        <strong>${escapeHtml(scopeLabel)}</strong><br>
        종료 행사 <strong>${targets.length}건</strong>과 참가 명단 연결 <strong>${participantsCount}건</strong>,
        출석 기록 <strong>${logsCount}건</strong>, QR 기록 <strong>${qrCount}건</strong>을 완전히 삭제합니다.<br>
        <strong>삭제 후 복구할 수 없습니다.</strong>
      `;
      finalButton.hidden = false;
    } catch (error) {
      console.error('history delete preview error:', error);
      toast('삭제 대상을 확인하지 못했습니다.');
    }
  }

  async function fetchCandidateParticipantIds(eventIds) {
    const ids = new Set();
    for (let start = 0; ; start += 1000) {
      const { data, error } = await sb
        .from('event_participants')
        .select('participant_id')
        .in('event_id', eventIds)
        .range(start, start + 999);
      if (error) throw error;
      for (const row of data || []) {
        if (row.participant_id) ids.add(row.participant_id);
      }
      if (!data || data.length < 1000) break;
    }
    return [...ids];
  }

  async function deleteEventsInBatches(eventIds) {
    for (let i = 0; i < eventIds.length; i += 80) {
      const batch = eventIds.slice(i, i + 80);
      const { error } = await sb
        .from('events')
        .delete()
        .eq('organization_id', state.member.organization_id)
        .eq('status', 'ended')
        .in('id', batch);
      if (error) throw error;
    }
  }

  async function cleanupOrphanParticipants(candidateIds) {
    if (!candidateIds.length) return 0;
    let deleted = 0;

    for (let i = 0; i < candidateIds.length; i += 80) {
      const batch = candidateIds.slice(i, i + 80);
      const { data: remainingLinks, error: linkError } = await sb
        .from('event_participants')
        .select('participant_id')
        .in('participant_id', batch)
        .limit(1000);
      if (linkError) throw linkError;

      const used = new Set((remainingLinks || []).map(x => x.participant_id));
      const orphanIds = batch.filter(id => !used.has(id));
      if (!orphanIds.length) continue;

      const { error: deleteError } = await sb
        .from('participants')
        .delete()
        .eq('organization_id', state.member.organization_id)
        .in('id', orphanIds);
      if (deleteError) throw deleteError;
      deleted += orphanIds.length;
    }
    return deleted;
  }

  async function executeHistoryDelete() {
    const button = $('#historyFinalDelete');
    if (!button || !state.historyDeleteContext) return;

    button.disabled = true;
    button.textContent = '완전 삭제 중…';

    try {
      const targets = await getHistoryDeleteTargets();
      if (!targets.length) {
        toast('삭제할 종료 행사가 없습니다.');
        clearHistoryDeletePreview();
        return;
      }

      const eventIds = targets.map(x => x.id);
      const candidateIds = await fetchCandidateParticipantIds(eventIds);
      const deletedCurrent = Boolean(state.event && eventIds.includes(state.event.id));

      await deleteEventsInBatches(eventIds);
      const orphanCount = await cleanupOrphanParticipants(candidateIds);

      if (deletedCurrent) {
        state.event = null;
        state.previousEvent = null;
        state.people = [];
        state.logs = [];
        state.qrToken = null;
        state.arrivalQrToken = null;
        state.awaitingNewEvent = true;
        try { localStorage.removeItem(QR_NEXT_EVENT_KEY); } catch {}
        renderAll();
      }

      $('#historyDeleteDialog')?.close();
      $('#historyDetailDialog')?.close();
      state.historySelectedEvent = null;
      state.historyDeleteContext = null;
      await loadPastEvents(true);
      toast(`행사 ${targets.length}건 완전 삭제 · 미사용 참가자 ${orphanCount}명 정리`);
    } catch (error) {
      console.error('history delete error:', error);
      toast(`완전 삭제 실패 · ${error.message || '권한 또는 연결 확인'}`);
    } finally {
      button.disabled = false;
      button.textContent = '완전 삭제';
    }
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
    ensureEventRegistrationUI();
    ensureParticipantEditUI();
    ensureStatusDashboardUI();
    ensureHistoryUI();
    ensureSpreadsheetUI();
    ensureOcrUI();
    loadNotificationState();
    ensureNotificationCenter();
    ensureResponsiveLayout();
    renderNotificationCenter();
    wireUI();

    window.addEventListener('resize', () => {
      if (!notificationState.expanded) {
        requestAnimationFrame(applyNotificationPosition);
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        refreshAfterAppResume();
      } else {
        // 팝업은 화면에서만 쓰는 실시간 알림이므로 앱이 가려지면 비웁니다.
        // 종 보관함은 그대로 유지되며, 놓친 QR 변화는 복귀 시 recoverMissedQrNotifications()가 채웁니다.
        clearPopupTimer();
        notificationState.popupItems = [];
        notificationState.expanded = false;
        renderNotificationCenter();
      }
    });

    window.addEventListener('pageshow', () => {
      if (document.visibilityState === 'visible') refreshAfterAppResume();
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