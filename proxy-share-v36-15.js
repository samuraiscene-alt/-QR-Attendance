(() => {
  'use strict';
  // V36.15 · 대리 QR 공유 미리보기
  // 기존 app.js의 대리 QR 공유 클릭을 캡처 단계에서 가로채며, 다른 기능은 건드리지 않습니다.

  const $ = (s, root=document) => root.querySelector(s);
  const escapeHtml = (v='') => String(v).replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));

  let client = null;
  let currentShare = null;

  function getClient() {
    if (client) return client;
    if (!window.supabase || !window.SUPABASE_URL || !window.SUPABASE_PUBLISHABLE_KEY) return null;
    client = window.supabase.createClient(
      window.SUPABASE_URL,
      window.SUPABASE_PUBLISHABLE_KEY,
      { auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true } }
    );
    return client;
  }

  function toast(message) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  function appBaseUrl() {
    return new URL('.', location.href);
  }

  function checkinProxyUrl(proxyToken) {
    const url = new URL('checkin.html', appBaseUrl());
    url.searchParams.set('p', proxyToken);
    return url.toString();
  }

  function proxyDisplayUrl(proxyToken) {
    const url = new URL('proxy.html', appBaseUrl());
    url.searchParams.set('p', proxyToken);
    return url.toString();
  }

  function quickQrUrl(target) {
    return 'https://quickchart.io/qr?size=520&margin=2&text=' + encodeURIComponent(target);
  }

  function selectedKind() {
    return $('#qrKindSelector [data-qr-kind].active')?.dataset.qrKind === 'arrival'
      ? 'arrival'
      : 'gathering';
  }

  function currentDirectToken() {
    const img = $('.fake-qr img');
    if (!img?.src) return null;
    try {
      const qr = new URL(img.src);
      const encodedTarget = qr.searchParams.get('text');
      if (!encodedTarget) return null;
      const target = new URL(encodedTarget);
      return target.searchParams.get('t');
    } catch {
      return null;
    }
  }

  function ensureDialog() {
    if ($('#proxySharePreviewDialog')) return;

    const style = document.createElement('style');
    style.textContent = `
      #proxySharePreviewDialog{
        width:min(calc(100% - 24px),480px);border:0;border-radius:30px;padding:0;
        background:#fff;box-shadow:0 24px 80px rgba(16,35,41,.27);overflow:hidden
      }
      #proxySharePreviewDialog::backdrop{
        background:rgba(19,28,32,.38);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px)
      }
      .proxy-share-sheet{padding:20px 18px 18px;text-align:center}
      .proxy-share-head{display:grid;grid-template-columns:42px 1fr 42px;align-items:start;gap:10px}
      .proxy-share-head-copy{min-width:0}
      .proxy-share-head h2{margin:3px 0 4px;font-size:22px;letter-spacing:-.5px}
      .proxy-share-sub{margin:0;color:#13a99a;font-size:12px;font-weight:900;line-height:1.4}
      .proxy-share-close{
        width:42px;height:42px;border:0;border-radius:50%;background:#f1f3f4;
        color:#596267;font-size:27px;line-height:1
      }
      .proxy-share-qr-card{
        width:min(66vw,270px);aspect-ratio:1;margin:18px auto 10px;padding:14px;
        border-radius:24px;background:#fff;box-shadow:0 10px 34px rgba(17,45,50,.10);
        display:grid;place-items:center
      }
      .proxy-share-qr-card img{width:100%;height:100%;display:block;object-fit:contain}
      .proxy-share-badge{
        display:inline-flex;align-items:center;gap:6px;min-height:32px;padding:0 13px;
        border-radius:999px;background:#e5faf6;color:#139c90;font-size:12px;font-weight:900
      }
      .proxy-share-desc{margin:12px auto 14px;color:#6f7d83;font-size:13px;line-height:1.55;max-width:330px}
      .proxy-share-info{
        display:grid;grid-template-columns:1fr 1fr;border:1px solid #edf1f2;
        border-radius:16px;margin:0 0 14px;overflow:hidden;background:#fbfdfd
      }
      .proxy-share-info div{padding:11px 8px;text-align:left}
      .proxy-share-info div+div{border-left:1px solid #edf1f2}
      .proxy-share-info span{display:block;color:#8b969b;font-size:10px;font-weight:800}
      .proxy-share-info b{display:block;margin-top:3px;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .proxy-share-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px}
      .proxy-share-actions button{
        min-height:52px;border-radius:16px;font-size:14px;font-weight:900
      }
      #proxyShareNative{
        border:0;background:#20bfae;color:#fff;grid-column:1/-1;font-size:15px
      }
      #proxyShareCopy{
        border:1px solid #dfe8e9;background:#fff;color:#172126
      }
      #proxyShareOpen{
        border:1px solid #dfe8e9;background:#fff;color:#172126
      }
      .proxy-share-foot{margin:12px 0 0;color:#9aa4a8;font-size:10px;line-height:1.45}
      @media (max-width:360px){
        #proxySharePreviewDialog{width:calc(100% - 16px)}
        .proxy-share-sheet{padding:18px 14px 15px}
        .proxy-share-qr-card{width:min(70vw,245px)}
      }
    `;
    document.head.appendChild(style);

    const dialog = document.createElement('dialog');
    dialog.id = 'proxySharePreviewDialog';
    dialog.innerHTML = `
      <div class="proxy-share-sheet">
        <div class="proxy-share-head">
          <span></span>
          <div class="proxy-share-head-copy">
            <h2 id="proxyShareTitle">대리 QR 공유</h2>
            <p class="proxy-share-sub">공유용 대리 QR · 원본 QR 아님</p>
          </div>
          <button type="button" class="proxy-share-close" id="proxyShareClose" aria-label="닫기">×</button>
        </div>

        <div class="proxy-share-qr-card">
          <img id="proxyShareQrImage" alt="대리 QR">
        </div>

        <span class="proxy-share-badge">✓ 사용 가능</span>
        <p class="proxy-share-desc">
          이 QR을 캡처해 사진으로 사용할 수 있습니다.<br>
          대리 QR 관리에서 폐기하면 캡처본도 즉시 사용할 수 없습니다.
        </p>

        <div class="proxy-share-info">
          <div><span>행사</span><b id="proxyShareEvent">-</b></div>
          <div><span>발급</span><b id="proxyShareIssued">-</b></div>
        </div>

        <div class="proxy-share-actions">
          <button type="button" id="proxyShareNative">메시지 · 카카오톡 · AirDrop 등으로 공유</button>
          <button type="button" id="proxyShareCopy">링크 복사</button>
          <button type="button" id="proxyShareOpen">대리 QR 크게 보기</button>
        </div>
        <p class="proxy-share-foot">공유되는 링크와 위 QR은 같은 대리 토큰을 사용하며, 행사 종료 또는 개별 폐기 시 함께 무효화됩니다.</p>
      </div>
    `;
    document.body.appendChild(dialog);

    $('#proxyShareClose')?.addEventListener('click', () => dialog.close());
    $('#proxyShareCopy')?.addEventListener('click', copyCurrentLink);
    $('#proxyShareNative')?.addEventListener('click', nativeShareCurrent);
    $('#proxyShareOpen')?.addEventListener('click', () => {
      if (currentShare?.displayUrl) window.open(currentShare.displayUrl, '_blank', 'noopener');
    });
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }

  async function copyCurrentLink() {
    if (!currentShare?.displayUrl) return;
    try {
      await copyText(currentShare.displayUrl);
      toast('대리 QR 링크를 복사했습니다.');
    } catch (err) {
      console.error(err);
      window.prompt('대리 QR 링크를 복사해주세요.', currentShare.displayUrl);
    }
  }

  async function nativeShareCurrent() {
    if (!currentShare?.displayUrl) return;
    const data = {
      title: `${currentShare.eventTitle} · ${currentShare.label} 대리 QR`,
      text: `${currentShare.eventTitle} ${currentShare.label} 대리 공유입니다. 행사 종료 또는 관리자가 폐기하면 즉시 만료됩니다.`,
      url: currentShare.displayUrl
    };

    if (navigator.share) {
      try {
        await navigator.share(data);
        toast('대리 QR 공유 완료');
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;
        console.error('native share error:', err);
      }
    }
    await copyCurrentLink();
  }

  async function createProxyAndOpen(button) {
    const sb = getClient();
    if (!sb) {
      toast('출석 시스템 연결을 확인해주세요.');
      return;
    }

    const kind = selectedKind();
    const directToken = currentDirectToken();
    const label = kind === 'arrival' ? '현장 QR' : '집결지 QR';

    if (!directToken) {
      toast('먼저 사용할 QR을 선택해주세요.');
      return;
    }

    button.disabled = true;
    button.textContent = '대리 QR 준비 중…';

    try {
      const { data: direct, error: directError } = await sb
        .from('qr_tokens')
        .select('event_id,kind,is_active,revoked_at,valid_until')
        .eq('token', directToken)
        .eq('kind', kind)
        .limit(1)
        .maybeSingle();

      if (directError) throw directError;
      if (!direct?.event_id || direct.is_active === false || direct.revoked_at) {
        throw new Error('현재 QR을 사용할 수 없습니다.');
      }

      const { data: event, error: eventError } = await sb
        .from('events')
        .select('id,title,location,status,event_date')
        .eq('id', direct.event_id)
        .single();

      if (eventError) throw eventError;
      if (event?.status !== 'active') {
        throw new Error('진행 중인 행사에서만 대리 QR을 발급할 수 있습니다.');
      }

      const { data: authData } = await sb.auth.getUser();
      const createdBy = authData?.user?.id || null;

      const { data: proxy, error: proxyError } = await sb
        .from('qr_tokens')
        .insert({
          event_id: event.id,
          kind: 'proxy',
          proxy_target_kind: kind,
          valid_until: null,
          created_by: createdBy
        })
        .select('id,token,created_at,valid_until')
        .single();

      if (proxyError) throw proxyError;

      const attendeeUrl = checkinProxyUrl(proxy.token);
      const displayUrl = proxyDisplayUrl(proxy.token);

      currentShare = {
        id: proxy.id,
        token: proxy.token,
        eventTitle: event.title || '현재 행사',
        label,
        attendeeUrl,
        displayUrl,
        qrImageUrl: quickQrUrl(attendeeUrl),
        createdAt: proxy.created_at || new Date().toISOString()
      };

      ensureDialog();
      $('#proxyShareTitle').textContent = `${label} 대리 QR`;
      $('#proxyShareEvent').textContent = currentShare.eventTitle;
      $('#proxyShareIssued').textContent = new Date(currentShare.createdAt).toLocaleString('ko-KR', {
        month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'
      });
      const img = $('#proxyShareQrImage');
      img.src = currentShare.qrImageUrl;
      img.alt = `${label} 대리 QR`;

      $('#proxySharePreviewDialog')?.showModal();
    } catch (err) {
      console.error('V36.15 proxy share error:', err);
      toast(`대리 QR 생성 실패 · ${err.message || '확인 필요'}`);
    } finally {
      button.disabled = false;
      button.textContent = '대리 QR 공유';
    }
  }

  // 기존 app.js의 #demoShare 버블 리스너보다 먼저 실행되어 중복 발급/중복 공유를 방지합니다.
  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('#demoShare');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    createProxyAndOpen(button);
  }, true);

  ensureDialog();
})();