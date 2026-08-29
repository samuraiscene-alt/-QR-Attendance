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
      await ensureManualEndQrValidity();
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
      subscribeRealtime();
      renderAll();
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
    toast('행사 종료 · 현재 QR 폐기 완료');
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
          const person = state.people.find(p => p.participantId === participantId);
          if (isQrCheckIn) {
            showAttendancePopup(person, checkedAt);
          } else if (isQrArrival) {
            showArrivalPopup(person, arrivedAt);
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

    $('#personDialogClose')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      $('#personForm')?.reset();
      $('#personDialog')?.close();
    });

    $('#manualButton')?.addEventListener('click', () => go('roster'));
    $('#saveSettings')?.addEventListener('click', () => toast('설정 저장 완료'));
    $('#notificationButton')?.addEventListener('click', () => toast('실시간 출석 알림 연결 준비 완료'));
    $('#ocrButton')?.addEventListener('click', () => toast('OCR 명단 등록은 다음 단계에서 연결합니다.'));
    $('#sheetButton')?.addEventListener('click', () => toast('Excel · Numbers · Sheets 연결은 다음 단계입니다.'));
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
    ensureEventRegistrationUI();
    ensureParticipantEditUI();
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