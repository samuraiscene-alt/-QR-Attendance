(() => {
  'use strict';

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
    awaitingNewEvent: false
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

  function checkinUrl(token, kind='gathering') {
    const url = new URL('checkin.html', location.href);
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
    const url = new URL('proxy.html', location.href);
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
    items: [],
    expanded: false,
    y: null,
    dragging: false,
    moved: false,
    scrolling: false,
    storageKey: 'qr-attendance-notification-stack-v21',
    positionKey: 'qr-attendance-notification-position-v21'
  };

  function defaultNotificationY() {
    return Math.round(window.innerHeight * 0.52);
  }

  function loadNotificationState() {
    try {
      const saved = JSON.parse(localStorage.getItem(notificationState.storageKey) || '[]');
      notificationState.items = Array.isArray(saved) ? saved.slice(-30) : [];
    } catch {
      notificationState.items = [];
    }

    try {
      const savedY = Number(localStorage.getItem(notificationState.positionKey));
      notificationState.y = Number.isFinite(savedY) ? savedY : defaultNotificationY();
    } catch {
      notificationState.y = defaultNotificationY();
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

  function saveNotificationPosition() {
    try {
      if (Number.isFinite(notificationState.y)) {
        localStorage.setItem(notificationState.positionKey, String(notificationState.y));
      }
    } catch {}
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
        display:flex;
        flex-direction:column;
        gap:10px;
        max-height:min(68dvh,620px);
        overflow-y:auto;
        -webkit-overflow-scrolling:touch;
        overscroll-behavior:contain;
        scroll-behavior:smooth;
        padding:4px 0 8px;
        touch-action:pan-y;
      }
      .attendance-notice{
        position:relative;
        box-sizing:border-box;
        width:100%;
        min-height:72px;
        border-radius:22px;
        background:rgba(232,232,237,.88);
        border:1px solid rgba(255,255,255,.78);
        box-shadow:0 10px 28px rgba(28,34,40,.18);
        backdrop-filter:blur(24px) saturate(1.18);
        -webkit-backdrop-filter:blur(24px) saturate(1.18);
        display:flex;
        align-items:center;
        padding:0 58px 0 18px;
        color:#12181f;
        font-size:15px;
        font-weight:800;
        letter-spacing:-.25px;
        user-select:none;
        -webkit-user-select:none;
        touch-action:pan-y;
        overflow:hidden;
        transition:transform .2s ease,opacity .18s ease;
      }
      .attendance-notice-line{
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
        width:100%;
      }
      .attendance-notice .notice-status{color:#0b9184;font-weight:900}
      .attendance-notice[data-status="individual"] .notice-status{color:#7348c7}
      .attendance-notice[data-status="unknown"] .notice-status{color:#d4444b}

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
        z-index:5;transform:translateY(-9px) scale(.965);opacity:.90;
      }
      #attendanceNoticeStack.collapsed .attendance-notice:nth-last-child(3){
        z-index:4;transform:translateY(-17px) scale(.93);opacity:.72;
      }
      #attendanceNoticeStack.collapsed .attendance-notice:nth-last-child(n+4){
        opacity:0;transform:translateY(-23px) scale(.91);pointer-events:none;
      }

      #attendanceNoticeStack.expanded .attendance-notice{
        position:relative;
        flex:0 0 auto;
        transform:none;
        opacity:1;
      }

      #attendanceNoticeClear{
        position:absolute;
        right:10px;
        top:17px;
        width:40px;
        height:40px;
        border:0;
        border-radius:50%;
        background:rgba(120,120,128,.22);
        color:#444a50;
        font-size:24px;
        line-height:1;
        display:grid;
        place-items:center;
        z-index:30;
        pointer-events:auto;
        backdrop-filter:blur(12px);
        -webkit-backdrop-filter:blur(12px);
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

    const stack = $('#attendanceNoticeStack');

    let tapStartX = 0;
    let tapStartY = 0;
    let tapMoved = false;

    stack.addEventListener('touchstart', e => {
      const t = e.touches?.[0];
      if (!t) return;
      tapStartX = t.clientX;
      tapStartY = t.clientY;
      tapMoved = false;
      notificationState.scrolling = false;
    }, {passive:true});

    stack.addEventListener('touchmove', e => {
      const t = e.touches?.[0];
      if (!t) return;
      if (Math.abs(t.clientX - tapStartX) > 8 || Math.abs(t.clientY - tapStartY) > 8) {
        tapMoved = true;
        if (notificationState.expanded) notificationState.scrolling = true;
      }
    }, {passive:true});

    stack.addEventListener('touchend', () => {
      if (notificationState.scrolling) {
        setTimeout(() => { notificationState.scrolling = false; }, 140);
      }
    }, {passive:true});

    stack.addEventListener('click', e => {
      if (notificationState.dragging || notificationState.moved || notificationState.scrolling || tapMoved) return;
      if (e.target.closest('.attendance-notice')?.dataset.justSwiped === '1') return;
      if (notificationState.items.length <= 1) return;

      notificationState.expanded = !notificationState.expanded;
      renderNotificationCenter();
    });
  }

  function noticeStatusText(status) {
    return ({
      present:'출석✓',
      arrived:'현장도착✓',
      individual:'개인출발',
      unknown:'미확인'
    })[status] || '미확인';
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
    if (!center || notificationState.items.length === 0) return;

    if (!Number.isFinite(notificationState.y)) {
      notificationState.y = defaultNotificationY();
    }

    requestAnimationFrame(() => {
      notificationState.y = clampNotificationY(notificationState.y, center);
      center.style.top = `${notificationState.y}px`;
    });
  }

  function renderNotificationCenter() {
    ensureNotificationCenter();

    const center = $('#attendanceNoticeCenter');
    const stack = $('#attendanceNoticeStack');
    if (!center || !stack) return;

    const items = notificationState.items;
    center.classList.toggle('is-empty', items.length === 0);
    stack.className = notificationState.expanded ? 'expanded' : 'collapsed';

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

      if (moved) {
        setTimeout(() => {
          notificationState.moved = false;
        }, 160);
      }
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
        setTimeout(() => removeNotification(id), 160);
      } else {
        card.style.transform = '';
        card.style.opacity = '';
        setTimeout(() => { card.dataset.justSwiped = '0'; }, 100);
      }

      mode = null;
      dx = 0;
    }, {passive:true});
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

    notificationState.items.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: person?.name || '이름 없음',
      phone: person?.phone || '----',
      org: person?.org || '소속 없음',
      status,
      createdAt: new Date().toISOString()
    });

    notificationState.items = notificationState.items.slice(-30);
    notificationState.expanded = false;

    // New alerts always appear in the center, as requested.
    notificationState.y = defaultNotificationY();
    saveNotificationPosition();
    saveNotificationState();
    renderNotificationCenter();
  }

  function showAttendancePopup(person, checkedAt) {
    pushAttendanceNotification(person, 'present');
  }

  function showArrivalPopup(person, arrivedAt) {
    pushAttendanceNotification(person, 'arrived');
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
          ${p.arrivedAt
            ? `<small style="color:#0b9184;font-weight:850;">현장 도착 ${escapeHtml(formatCheckTime(p.arrivedAt))}</small>`
            : ''}
        </div>
        <button type="button" data-edit-person="${p.linkId}" aria-label="${escapeHtml(p.name)} 수정"
          style="flex:0 0 auto;width:34px;height:34px;border:0;border-radius:11px;background:#f1f6f6;color:#65747b;font-size:18px;font-weight:900;display:grid;place-items:center;">✎</button>
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

    $$('[data-edit-person]', list).forEach(b => {
      b.addEventListener('click', () => openParticipantEdit(b.dataset.editPerson));
    });
  }

  function ensureStatusDashboardUI() {
    const screen = $('[data-screen="status"]');
    if (!screen || $('#statusDetailStats')) return;

    const style = document.createElement('style');
    style.textContent = `
      #statusDetailStats{
        display:grid;
        grid-template-columns:repeat(2,minmax(0,1fr));
        gap:10px;
        margin:12px 0 14px;
      }
      .status-detail-stat{
        background:#fff;
        border:1px solid #e8edef;
        border-radius:18px;
        padding:14px 15px;
        box-shadow:0 5px 16px rgba(27,51,58,.04);
      }
      .status-detail-stat span{
        display:block;
        color:#7c878d;
        font-size:12px;
        font-weight:800;
        margin-bottom:5px;
      }
      .status-detail-stat strong{
        font-size:24px;
        line-height:1;
        font-weight:900;
        color:#20292d;
      }
      .status-history-card{
        margin-top:14px;
        background:#fff;
        border:1px solid #e8edef;
        border-radius:20px;
        padding:17px 15px 8px;
      }
      .status-history-head{
        display:flex;
        align-items:center;
        justify-content:space-between;
        margin-bottom:8px;
      }
      .status-history-head strong{font-size:17px}
      .status-history-head small{
        color:#8a959b;
        font-size:12px;
        font-weight:750;
      }
      .status-log-row{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:12px;
        padding:13px 2px;
        border-top:1px solid #eef2f3;
      }
      .status-log-row:first-child{border-top:0}
      .status-log-main{min-width:0}
      .status-log-main strong{
        display:block;
        font-size:14px;
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
      }
      .status-log-main small{
        display:block;
        color:#7d888e;
        font-size:12px;
        margin-top:3px;
      }
      .status-log-side{
        flex:0 0 auto;
        text-align:right;
      }
      .status-log-side b{
        display:block;
        color:#159f93;
        font-size:13px;
      }
      .status-log-side small{
        display:block;
        color:#929ca1;
        font-size:11px;
        margin-top:3px;
      }
      .status-log-empty{
        padding:20px 4px;
        color:#8a959b;
        text-align:center;
        font-size:13px;
      }
    `;
    document.head.appendChild(style);

    const summary = $('.summary-card', screen);
    const detail = document.createElement('div');
    detail.id = 'statusDetailStats';
    detail.innerHTML = `
      <div class="status-detail-stat"><span>전체</span><strong id="statusTotal">0</strong></div>
      <div class="status-detail-stat"><span>출석</span><strong id="statusPresent">0</strong></div>
      <div class="status-detail-stat"><span>현장도착</span><strong id="statusArrived">0</strong></div>
      <div class="status-detail-stat"><span>개인출발</span><strong id="statusIndividual">0</strong></div>
      <div class="status-detail-stat"><span>미확인</span><strong id="statusUnknown">0</strong></div>
    `;
    summary?.insertAdjacentElement('afterend', detail);

    const statusList = $('#statusList');
    const history = document.createElement('div');
    history.className = 'status-history-card';
    history.innerHTML = `
      <div class="status-history-head">
        <strong>출석 기록</strong>
        <small id="statusLogCount">0건</small>
      </div>
      <div id="statusHistoryList"></div>
    `;
    statusList?.insertAdjacentElement('afterend', history);
  }

  function attendanceActionLabel(action) {
    return ({
      check_in:'QR 출석',
      manual_check_in:'수동 출석',
      arrival:'현장 도착',
      set_individual:'개인출발',
      set_bus:'버스출발',
      manual_uncheck:'미확인 변경',
      mark_absent:'결석',
      correction:'정정'
    })[action] || '상태 변경';
  }

  function attendanceSourceLabel(source) {
    return source === 'qr' ? 'QR' : source === 'manual' ? '수동' : (source || '시스템');
  }

  function formatLogDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('ko-KR', {
      month:'numeric',
      day:'numeric',
      hour:'2-digit',
      minute:'2-digit',
      hour12:false
    });
  }

  function renderStatus() {
    ensureStatusDashboardUI();

    const list = $('#statusList');
    if (!list) return;

    const total = state.people.length;
    const present = state.people.filter(p => p.status === 'present').length;
    const individual = state.people.filter(p => p.status === 'individual').length;
    const unknown = Math.max(0, total - present - individual);
    const arrived = state.people.filter(p => Boolean(p.arrivedAt)).length;

    if ($('#statusTotal')) $('#statusTotal').textContent = total;
    if ($('#statusPresent')) $('#statusPresent').textContent = present;
    if ($('#statusArrived')) $('#statusArrived').textContent = arrived;
    if ($('#statusIndividual')) $('#statusIndividual').textContent = individual;
    if ($('#statusUnknown')) $('#statusUnknown').textContent = unknown;

    if (!state.people.length) {
      list.innerHTML = '<div class="empty-state">출석 현황이 없습니다.</div>';
    } else {
      list.innerHTML = state.people.map(p => `
        <div class="status-row">
          <div>
            <strong>${escapeHtml(p.name)}</strong>
            <small>${escapeHtml(p.org || '소속 없음')}</small>
            ${p.arrivedAt
              ? `<small style="display:block;color:#0b9184;font-weight:850;margin-top:3px;">현장 도착 ${escapeHtml(formatCheckTime(p.arrivedAt))}</small>`
              : ''}
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

    const history = $('#statusHistoryList');
    const count = $('#statusLogCount');
    if (count) count.textContent = `${state.logs.length}건`;
    if (!history) return;

    if (!state.logs.length) {
      history.innerHTML = '<div class="status-log-empty">아직 출석 변경 기록이 없습니다.</div>';
      return;
    }

    history.innerHTML = state.logs.map(log => `
      <div class="status-log-row">
        <div class="status-log-main">
          <strong>${escapeHtml(log.name)}${log.org ? ` · ${escapeHtml(log.org)}` : ''}</strong>
          <small>${escapeHtml(formatLogDateTime(log.createdAt))}</small>
        </div>
        <div class="status-log-side">
          <b>${escapeHtml(attendanceActionLabel(log.action))}</b>
          <small>${escapeHtml(attendanceSourceLabel(log.source))}</small>
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
    queueGoogleSheetsCurrentSync();
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
        async (payload) => {
          const isQrCheckIn =
            payload?.eventType === 'UPDATE' &&
            payload?.new?.attendance_status === 'checked_in' &&
            payload?.new?.check_source === 'qr';
          const isQrArrival =
            payload?.eventType === 'UPDATE' &&
            payload?.new?.attendance_status === 'arrived' &&
            payload?.new?.check_source === 'qr' &&
            Boolean(payload?.new?.arrived_at);
          const participantId = payload?.new?.participant_id || null;
          const checkedAt = payload?.new?.checked_at || null;
          const arrivedAt = payload?.new?.arrived_at || null;
          await loadPeople();
          renderAll();
          queueGoogleSheetsCurrentSync();
          const person = state.people.find(p => p.participantId === participantId);
          if (isQrCheckIn) {
            showAttendancePopup(person, checkedAt);
          } else if (isQrArrival) {
            showArrivalPopup(person, arrivedAt);
          }
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
        async () => {
          await loadAttendanceLogs();
          renderStatus();
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

    $('#personDialogClose')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      $('#personForm')?.reset();
      $('#personDialog')?.close();
    });

    $('#manualButton')?.addEventListener('click', () => go('roster'));
    $('#saveSettings')?.addEventListener('click', () => toast('설정 저장 완료'));
    $('#notificationButton')?.addEventListener('click', () => toast('실시간 출석 알림 연결 준비 완료'));
    $('#ocrButton')?.addEventListener('click', openOcrDialog);
    $('#sheetButton')?.addEventListener('click', openSpreadsheetDialog);
    $('#proxyButton')?.addEventListener('click', () => {
      go('qr');
      toast('집결지 QR 또는 현장 QR을 선택한 뒤 대리 QR 공유를 눌러주세요.');
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
      loadAttendanceLogs().then(renderStatus).catch(console.error);
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
      .ocr-hidden-file-input{
        position:fixed!important;
        left:-9999px!important;
        top:-9999px!important;
        width:1px!important;
        height:1px!important;
        opacity:0!important;
        overflow:hidden!important;
        clip-path:inset(50%)!important;
        pointer-events:none!important;
      }
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
        display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr) 76px;gap:7px;
        align-items:center;padding:8px 0;border-top:1px solid #edf1f2;
      }
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
        <input id="ocrCameraInput" class="ocr-hidden-file-input" type="file" accept="image/*" capture="environment" aria-hidden="true" tabindex="-1">
        <input id="ocrPhotoInput" class="ocr-hidden-file-input" type="file" accept="image/*" aria-hidden="true" tabindex="-1">

        <div class="ocr-privacy">사진은 Supabase나 Google Sheets에 저장하지 않고, 이 기기에서 글자를 읽은 뒤 명단 데이터만 등록합니다.</div>

        <div id="ocrWorkArea"></div>
        <button type="button" id="ocrImportButton" class="ocr-import" hidden>등록 가능한 명단 불러오기</button>
      </div>
    `;
    document.body.appendChild(dialog);

    $('#ocrClose')?.addEventListener('click', () => {
      resetOcrDialog();
      dialog.close();
    });
    $('#ocrCameraButton')?.addEventListener('click', () => $('#ocrCameraInput')?.click());
    $('#ocrPhotoButton')?.addEventListener('click', () => $('#ocrPhotoInput')?.click());
    $('#ocrCameraInput')?.addEventListener('change', handleOcrImageFile);
    $('#ocrPhotoInput')?.addEventListener('change', handleOcrImageFile);
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
      importButton.textContent = '등록 가능한 명단 불러오기';
    }
    const camera = $('#ocrCameraInput');
    const photo = $('#ocrPhotoInput');
    if (camera) camera.value = '';
    if (photo) photo.value = '';
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

  async function handleOcrImageFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const area = $('#ocrWorkArea');
    const importButton = $('#ocrImportButton');
    if (!area || !importButton) return;

    state.ocrFileName = file.name || '촬영 사진';
    state.ocrRows = [];
    state.ocrRawText = '';
    importButton.hidden = true;

    const imageUrl = URL.createObjectURL(file);
    area.innerHTML = `
      <img class="ocr-preview-image" id="ocrPreviewImage" alt="종이 명단 미리보기">
      <div class="ocr-progress-wrap">
        <div class="ocr-progress-label"><span id="ocrProgressText">OCR 준비 중</span><span id="ocrProgressPercent">0%</span></div>
        <div class="ocr-progress"><span id="ocrProgressBar"></span></div>
      </div>
    `;
    $('#ocrPreviewImage').src = imageUrl;

    try {
      await ensureTesseractLoaded();
      setOcrProgress('한국어 OCR 시작', 0.02);

      const worker = await Tesseract.createWorker(['kor','eng'], 1, {
        logger: ocrLogger
      });

      const result = await worker.recognize(file);
      await worker.terminate();

      state.ocrRawText = String(result?.data?.text || '').trim();
      state.ocrRows = parseOcrRosterText(state.ocrRawText);
      setOcrProgress('분석 완료', 1);
      renderOcrRows(imageUrl);
    } catch (error) {
      console.error('ocr recognize error:', error);
      area.innerHTML += `<div class="ocr-message">사진 글자 읽기에 실패했습니다.<br>${escapeHtml(error.message || '인터넷 연결 또는 사진 품질을 확인해주세요.')}</div>`;
    } finally {
      setTimeout(() => URL.revokeObjectURL(imageUrl), 30000);
    }
  }

  function cleanOcrToken(value='') {
    return String(value)
      .replace(/[|｜]/g, ' ')
      .replace(/[,:;]+$/g, '')
      .trim();
  }

  function looksLikeOcrHeader(line='') {
    const compact = line.replace(/\s/g, '');
    const hits = ['이름','성명','소속','전화','연락처','핸드폰','휴대폰','번호'].filter(x => compact.includes(x)).length;
    return hits >= 2;
  }

  function parseOcrRosterText(text='') {
    const lines = String(text)
      .replace(/\r/g, '')
      .split('\n')
      .map(line => line.replace(/[｜|]/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    const parsed = [];

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      if (!line || looksLikeOcrHeader(line)) continue;

      line = line.replace(/^\s*\d{1,3}[.)번]?\s+/, '');
      const phoneMatches = line.match(/\d[\d\s-]{2,}\d/g) || [];
      const phoneSource = phoneMatches.length ? phoneMatches[phoneMatches.length - 1] : '';
      const phoneDigits = phoneSource.replace(/\D/g, '');
      const phone = phoneDigits.length >= 4 ? phoneDigits.slice(-4) : '';

      let withoutPhone = phoneSource ? line.replace(phoneSource, ' ').replace(/\s+/g, ' ').trim() : line;
      let tokens = withoutPhone.split(' ').map(cleanOcrToken).filter(Boolean);

      while (tokens.length && /^\d+$/.test(tokens[0])) tokens.shift();
      if (!tokens.length && !phone) continue;

      let name = '';
      let nameIndex = -1;
      for (let t = 0; t < tokens.length; t++) {
        const token = tokens[t];
        if (/^[가-힣]{2,5}$/.test(token) || /^[A-Za-z][A-Za-z.'-]{1,24}$/.test(token)) {
          name = token;
          nameIndex = t;
          break;
        }
      }

      if (!name && tokens.length) {
        name = tokens[0].slice(0, 30);
        nameIndex = 0;
      }

      const orgTokens = tokens.filter((_, idx) => idx !== nameIndex);
      const org = orgTokens.join(' ').slice(0, 50);

      parsed.push({
        rowNumber: i + 1,
        name,
        org,
        phone,
        state:'bad',
        reason:'확인 필요'
      });
    }

    const deduped = [];
    const seen = new Set();
    for (const row of parsed) {
      const signature = `${row.name}|${row.org}|${row.phone}`;
      if (!row.name && !row.phone) continue;
      if (seen.has(signature)) continue;
      seen.add(signature);
      deduped.push(row);
    }

    state.ocrRows = deduped;
    refreshOcrRowStates();
    return state.ocrRows;
  }

  function refreshOcrRowStates() {
    const currentKeys = new Set(state.people.map(p => importPersonKey(p.name, p.phone)));
    const scannedKeys = new Set();

    state.ocrRows.forEach(row => {
      row.name = String(row.name || '').trim();
      row.org = String(row.org || '').trim();
      row.phone = normalizeImportPhone(row.phone || '');

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
        row.reason = '등록 가능';
        scannedKeys.add(key);
      }
    });
  }

  function renderOcrRows(imageUrl='') {
    const area = $('#ocrWorkArea');
    const importButton = $('#ocrImportButton');
    if (!area || !importButton) return;

    refreshOcrRowStates();
    const ok = state.ocrRows.filter(r => r.state === 'ok').length;
    const skip = state.ocrRows.filter(r => r.state === 'skip').length;
    const bad = state.ocrRows.filter(r => r.state === 'bad').length;

    const oldImage = $('#ocrPreviewImage')?.src || imageUrl;
    area.innerHTML = `
      ${oldImage ? `<img class="ocr-preview-image" id="ocrPreviewImage" alt="종이 명단 미리보기" src="${escapeHtml(oldImage)}">` : ''}
      <div class="ocr-summary">
        <div><span>등록 가능</span><b>${ok}</b></div>
        <div><span>중복 제외</span><b>${skip}</b></div>
        <div><span>확인 필요</span><b>${bad}</b></div>
      </div>
      <div id="ocrEditableRows">
        ${state.ocrRows.length ? state.ocrRows.map((row, index) => `
          <div class="ocr-row" data-ocr-index="${index}">
            <input class="ocr-name" value="${escapeHtml(row.name)}" maxlength="30" placeholder="이름">
            <input class="ocr-org" value="${escapeHtml(row.org)}" maxlength="50" placeholder="소속">
            <div>
              <input class="ocr-phone" value="${escapeHtml(row.phone)}" inputmode="numeric" maxlength="4" placeholder="뒤4자리">
              <div class="ocr-row-state ${row.state}">${escapeHtml(row.reason)}</div>
            </div>
          </div>
        `).join('') : '<div class="ocr-message">자동으로 분리된 명단이 없습니다. 아래 `+ 행 추가`로 직접 보정할 수 있습니다.</div>'}
      </div>
      <button type="button" class="ocr-add-row" id="ocrAddRow">+ 행 추가</button>
      <details class="ocr-raw-box">
        <summary>OCR 원문 확인</summary>
        <textarea class="ocr-raw-text" id="ocrRawText">${escapeHtml(state.ocrRawText)}</textarea>
      </details>
    `;

    $$('.ocr-row', area).forEach(rowEl => {
      const index = Number(rowEl.dataset.ocrIndex);
      const name = $('.ocr-name', rowEl);
      const org = $('.ocr-org', rowEl);
      const phone = $('.ocr-phone', rowEl);
      [name, org, phone].forEach(input => input?.addEventListener('input', () => {
        const row = state.ocrRows[index];
        if (!row) return;
        row.name = name?.value || '';
        row.org = org?.value || '';
        row.phone = phone?.value || '';
        renderOcrRows($('#ocrPreviewImage')?.src || oldImage);
      }));
    });

    $('#ocrAddRow')?.addEventListener('click', () => {
      state.ocrRows.push({ rowNumber:state.ocrRows.length + 1, name:'', org:'', phone:'', state:'bad', reason:'이름 확인' });
      renderOcrRows($('#ocrPreviewImage')?.src || oldImage);
      requestAnimationFrame(() => {
        const rows = $$('.ocr-row', area);
        rows.at(-1)?.querySelector('.ocr-name')?.focus();
      });
    });

    $('#ocrRawText')?.addEventListener('change', e => {
      state.ocrRawText = e.target.value || '';
    });

    importButton.hidden = ok === 0;
    importButton.textContent = `등록 가능한 ${ok}명 불러오기`;
  }

  async function importOcrRows() {
    if (!state.event) {
      toast('먼저 행사를 등록해주세요.');
      return;
    }

    refreshOcrRowStates();
    const rows = state.ocrRows.filter(r => r.state === 'ok');
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
    if (person.status === 'individual') return '개인출발';
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
    if (person.travel_mode === 'individual') return '개인출발';
    if (person.attendance_status === 'arrived' || person.arrived_at) return '현장도착';
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