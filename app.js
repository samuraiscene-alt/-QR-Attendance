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
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
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

  const authScreen = $('#auth-screen');
  const loginForm = $('#admin-login-form');
  const loginEmail = $('#login-email');
  const loginPassword = $('#login-password');
  const loginError = $('#login-error');

  const showLogin = () => { if (authScreen) authScreen.style.display = 'flex'; };
  const hideLogin = () => { if (authScreen) authScreen.style.display = 'none'; };

  // Password recovery UI is created dynamically so index.html does not need changing.
  const recovery = document.createElement('div');
  recovery.id = 'password-recovery-screen';
  recovery.style.cssText = 'display:none;position:fixed;inset:0;z-index:10001;background:linear-gradient(180deg,#fff 0%,#f4fbfa 100%);align-items:center;justify-content:center;padding:28px;';
  recovery.innerHTML = `
    <div style="width:min(100%,560px);background:#fff;border:1px solid #e4ecec;border-radius:28px;padding:34px 28px;box-shadow:0 18px 50px rgba(20,80,80,.12);">
      <div style="text-align:center;margin-bottom:28px;">
        <img src="icons/apple-touch-icon.png" alt="" style="width:88px;height:88px;border-radius:22px;box-shadow:0 10px 25px rgba(20,180,165,.18)">
        <h1 style="font-size:30px;margin:20px 0 8px;color:#111;">새 비밀번호 설정</h1>
        <p style="margin:0;color:#7b8793;font-size:16px;line-height:1.5;">관리자 계정에서 사용할 새 비밀번호를 입력하세요.</p>
      </div>
      <form id="password-recovery-form">
        <label style="display:block;font-weight:800;margin:0 0 9px;">새 비밀번호</label>
        <input id="new-password" type="password" autocomplete="new-password" minlength="8" required
          style="box-sizing:border-box;width:100%;height:62px;border:1px solid #dbe3e5;border-radius:18px;padding:0 18px;font-size:18px;background:#fff;">
        <label style="display:block;font-weight:800;margin:20px 0 9px;">새 비밀번호 확인</label>
        <input id="new-password-confirm" type="password" autocomplete="new-password" minlength="8" required
          style="box-sizing:border-box;width:100%;height:62px;border:1px solid #dbe3e5;border-radius:18px;padding:0 18px;font-size:18px;background:#fff;">
        <div id="password-recovery-error" style="min-height:24px;margin:12px 2px 4px;color:#e34d59;font-weight:700;"></div>
        <button type="submit"
          style="width:100%;height:64px;border:0;border-radius:18px;background:#25c5b5;color:#fff;font-size:20px;font-weight:800;">비밀번호 변경</button>
      </form>
    </div>`;
  document.body.appendChild(recovery);

  const showRecovery = () => {
    if (authScreen) authScreen.style.display = 'none';
    recovery.style.display = 'flex';
  };
  const hideRecovery = () => { recovery.style.display = 'none'; };

  $('#password-recovery-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const p1 = $('#new-password')?.value || '';
    const p2 = $('#new-password-confirm')?.value || '';
    const err = $('#password-recovery-error');
    if (err) err.textContent = '';
    if (p1.length < 8) {
      if (err) err.textContent = '비밀번호는 8자 이상으로 입력해주세요.';
      return;
    }
    if (p1 !== p2) {
      if (err) err.textContent = '두 비밀번호가 서로 다릅니다.';
      return;
    }
    const btn = e.currentTarget.querySelector('button');
    btn.disabled = true;
    btn.textContent = '변경 중…';
    const { error } = await sb.auth.updateUser({ password: p1 });
    btn.disabled = false;
    btn.textContent = '비밀번호 변경';
    if (error) {
      if (err) err.textContent = '비밀번호 변경에 실패했습니다. 복구 메일을 다시 열어주세요.';
      return;
    }
    hideRecovery();
    toast('비밀번호가 변경되었습니다.');
    setTimeout(() => alert('비밀번호 변경 완료!\n앞으로 새 비밀번호로 로그인하면 됩니다.'), 100);
    hideLogin();
  });

  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!sb) return;
    if (loginError) loginError.textContent = '';
    const email = loginEmail?.value.trim() || '';
    const password = loginPassword?.value || '';
    const btn = loginForm.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = '로그인 중…'; }
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (btn) { btn.disabled = false; btn.textContent = '로그인'; }
    if (error) {
      if (loginError) loginError.textContent = '이메일 또는 비밀번호를 확인해주세요.';
      return;
    }
    hideLogin();
  });

  // Existing V1 demo data/UI
  const STORAGE_KEY = 'qr-attendance-v1-demo';
  const defaultPeople = [
    {id:crypto.randomUUID(), name:'김민수', affiliation:'A팀', phoneLast4:'1234', status:'present'},
    {id:crypto.randomUUID(), name:'이서연', affiliation:'B팀', phoneLast4:'4821', status:'present'},
    {id:crypto.randomUUID(), name:'박지훈', affiliation:'A팀', phoneLast4:'7712', status:'individual'},
    {id:crypto.randomUUID(), name:'최유진', affiliation:'C팀', phoneLast4:'9033', status:'unknown'},
    {id:crypto.randomUUID(), name:'정현우', affiliation:'B팀', phoneLast4:'2258', status:'present'},
    {id:crypto.randomUUID(), name:'한지민', affiliation:'C팀', phoneLast4:'6640', status:'unknown'},
    {id:crypto.randomUUID(), name:'오세훈', affiliation:'A팀', phoneLast4:'3105', status:'individual'},
    {id:crypto.randomUUID(), name:'윤하늘', affiliation:'B팀', phoneLast4:'8182', status:'unknown'}
  ];
  const load = () => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {people:defaultPeople}; }
    catch { return {people:defaultPeople}; }
  };
  let state = load();
  const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

  const statusLabel = {present:'출석', individual:'개인출발', unknown:'미확인'};
  const render = () => {
    const people = state.people || [];
    const counts = {
      total: people.length,
      present: people.filter(p=>p.status==='present').length,
      individual: people.filter(p=>p.status==='individual').length,
      unknown: people.filter(p=>p.status==='unknown').length
    };
    $$('[data-stat="total"]').forEach(x=>x.textContent=counts.total);
    $$('[data-stat="present"]').forEach(x=>x.textContent=counts.present);
    $$('[data-stat="individual"]').forEach(x=>x.textContent=counts.individual);
    $$('[data-stat="unknown"]').forEach(x=>x.textContent=counts.unknown);

    const list = $('#roster-list');
    if (list) {
      const q = ($('#roster-search')?.value || '').toLowerCase();
      list.innerHTML = '';
      people.filter(p => `${p.name} ${p.affiliation} ${p.phoneLast4}`.toLowerCase().includes(q)).forEach(p => {
        const el = document.createElement('div');
        el.className = 'person-card';
        el.innerHTML = `<div><strong>${p.name}</strong><div class="muted">${p.affiliation || ''} · ****${p.phoneLast4 || ''}</div></div>
          <button class="status-btn ${p.status}" data-id="${p.id}">${statusLabel[p.status] || '미확인'}</button>`;
        list.appendChild(el);
      });
    }
  };

  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-tab]');
    if (nav) {
      const tab = nav.dataset.tab;
      $$('.tab-page').forEach(p=>p.classList.toggle('active', p.dataset.page===tab));
      $$('[data-tab]').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
      render();
    }
    const statusBtn = e.target.closest('.status-btn[data-id]');
    if (statusBtn) {
      const p = state.people.find(x=>x.id===statusBtn.dataset.id);
      if (p) {
        p.status = p.status==='unknown' ? 'present' : p.status==='present' ? 'individual' : 'unknown';
        save(); render();
      }
    }
  });

  $('#roster-search')?.addEventListener('input', render);

  $('#add-person-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get('name') || '').trim();
    if (!name) return;
    state.people.push({
      id:crypto.randomUUID(), name,
      affiliation:String(fd.get('affiliation') || '').trim(),
      phoneLast4:String(fd.get('phoneLast4') || '').trim().slice(-4),
      status:'unknown'
    });
    save(); e.currentTarget.reset(); render(); toast('명단에 추가했습니다.');
  });

  $$('[data-placeholder]').forEach(el => el.addEventListener('click', () => toast(el.dataset.placeholder)));

  // Settings: keep existing fields and add account/logout block once.
  const addAccountSettings = async (session) => {
    const settingsPage = $('[data-page="settings"]');
    if (!settingsPage || $('#account-settings-card')) return;
    const card = document.createElement('div');
    card.id = 'account-settings-card';
    card.className = 'settings-card card';
    card.style.marginTop = '18px';
    card.innerHTML = `<h3>관리자 계정</h3>
      <p class="muted" style="word-break:break-all">${session?.user?.email || ''}</p>
      <button id="logout-btn" type="button" class="primary-btn" style="background:#fff;color:#e34d59;border:1px solid #f1c9cd;">로그아웃</button>`;
    settingsPage.appendChild(card);
    $('#logout-btn')?.addEventListener('click', async () => {
      await sb.auth.signOut();
      showLogin();
    });
  };

  const initAuth = async () => {
    if (!sb) { showLogin(); return; }

    // Supabase recovery links can arrive with hash/query parameters.
    const href = location.href;
    const looksLikeRecovery =
      href.includes('type=recovery') ||
      new URLSearchParams(location.search).get('type') === 'recovery';

    const { data } = await sb.auth.getSession();
    if (looksLikeRecovery && data.session) {
      showRecovery();
      return;
    }
    if (data.session) {
      hideLogin();
      addAccountSettings(data.session);
    } else {
      showLogin();
    }

    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        showRecovery();
        return;
      }
      if (event === 'SIGNED_OUT') {
        hideRecovery();
        showLogin();
        return;
      }
      if (session) {
        hideLogin();
        addAccountSettings(session);
      }
    });
  };

  render();
  initAuth();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(console.error));
  }
})();