const STORAGE_KEY = 'qr-attendance-v1-demo';
const defaultState = {
  eventTitle: '2026.08.28 · 샘플 관광 행사',
  settings: { org: '샘플 관광 모임', manager: '관리자', popup: true, phoneLast4: true },
  people: [
    {id:1,name:'김철수',org:'성북지회',phone:'1234',status:'present',time:'09:02'},
    {id:2,name:'이영희',org:'강북지회',phone:'4321',status:'individual',time:''},
    {id:3,name:'박민수',org:'본부',phone:'7788',status:'unknown',time:''},
    {id:4,name:'최서연',org:'송파지회',phone:'9051',status:'present',time:'09:08'},
    {id:5,name:'정우진',org:'노원지회',phone:'2244',status:'unknown',time:''},
    {id:6,name:'한지민',org:'본부',phone:'0317',status:'present',time:'09:11'},
    {id:7,name:'오성호',org:'강남지회',phone:'6610',status:'individual',time:''},
    {id:8,name:'문수진',org:'서초지회',phone:'4402',status:'unknown',time:''}
  ]
};
let state = loadState();
let currentFilter = 'all';

function loadState(){ try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || structuredClone(defaultState); } catch { return structuredClone(defaultState); } }
function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function toast(message){ const t=document.getElementById('toast'); t.textContent=message; t.classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>t.classList.remove('show'),1900); }
function labelFor(status){ return status==='present'?'출석':status==='individual'?'개인출발':'미확인'; }
function nextStatus(status){ return status==='unknown'?'present':status==='present'?'individual':'unknown'; }
function nowTime(){ return new Intl.DateTimeFormat('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date()); }

function go(screen){
  document.querySelectorAll('.screen').forEach(el=>el.classList.toggle('active',el.dataset.screen===screen));
  document.querySelectorAll('.tab').forEach(el=>el.classList.toggle('active',el.dataset.go===screen));
  if(screen==='roster') renderPeople();
  if(screen==='status') renderStatus();
  window.scrollTo({top:0,behavior:'smooth'});
}

document.querySelectorAll('[data-go]').forEach(btn=>btn.addEventListener('click',()=>go(btn.dataset.go)));

document.getElementById('notificationButton').addEventListener('click',()=>toast('출석 실시간 알림은 Supabase 연결 단계에서 활성화합니다.'));
document.getElementById('ocrButton').addEventListener('click',()=>toast('OCR 촬영 기능은 다음 단계에서 연결합니다.'));
document.getElementById('sheetButton').addEventListener('click',()=>toast('Excel · Numbers · Google Sheets 연동 예정입니다.'));
document.getElementById('proxyButton').addEventListener('click',()=>toast('행사별 대리 QR 공유 기능을 연결할 예정입니다.'));
document.getElementById('manualButton').addEventListener('click',()=>{ go('roster'); toast('명단에서 상태 버튼을 눌러 수동 정정할 수 있습니다.'); });
document.getElementById('demoStart').addEventListener('click',()=>toast('데모: 행사 시작 상태로 전환했습니다.'));
document.getElementById('demoShare').addEventListener('click',()=>toast('데모: 대리 QR 공유 화면은 다음 단계에서 연결합니다.'));

function counts(){
  const total=state.people.length;
  const present=state.people.filter(p=>p.status==='present').length;
  const individual=state.people.filter(p=>p.status==='individual').length;
  const unknown=state.people.filter(p=>p.status==='unknown').length;
  return {total,present,individual,unknown};
}
function renderCounts(){
  const c=counts();
  document.getElementById('statTotal').textContent=c.total;
  document.getElementById('statPresent').textContent=c.present;
  document.getElementById('statIndividual').textContent=c.individual;
  document.getElementById('statUnknown').textContent=c.unknown;
}
function safeText(value){ return String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function renderPeople(){
  const list=document.getElementById('peopleList');
  const q=document.getElementById('searchInput').value.trim().toLowerCase();
  const filtered=state.people.filter(p => (currentFilter==='all'||p.status===currentFilter) && (!q||p.name.toLowerCase().includes(q)||p.org.toLowerCase().includes(q)));
  list.innerHTML = filtered.length ? filtered.map(p=>`<article class="person-card"><div class="avatar">${safeText(p.name.slice(0,1))}</div><div class="person-main"><strong>${safeText(p.name)}</strong><small>${safeText(p.org)} · ****${safeText(p.phone)}</small></div><button class="status-button ${p.status}" data-person-status="${p.id}">${labelFor(p.status)}</button></article>`).join('') : '<div class="info-card"><strong>검색 결과가 없습니다.</strong><p>필터나 검색어를 바꿔보세요.</p></div>';
  list.querySelectorAll('[data-person-status]').forEach(btn=>btn.addEventListener('click',()=>cyclePerson(Number(btn.dataset.personStatus))));
}
function cyclePerson(id){
  const p=state.people.find(x=>x.id===id); if(!p) return;
  p.status=nextStatus(p.status); p.time=p.status==='present'?nowTime():'';
  saveState(); renderCounts(); renderPeople(); renderStatus();
  toast(`${p.name} → ${labelFor(p.status)}`);
}

document.getElementById('searchInput').addEventListener('input',renderPeople);
document.querySelectorAll('[data-filter]').forEach(btn=>btn.addEventListener('click',()=>{currentFilter=btn.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active',b===btn));renderPeople();}));

function renderStatus(){
  const c=counts(); const rate=c.total?Math.round(c.present/c.total*100):0;
  document.getElementById('rateText').textContent=rate+'%'; document.getElementById('progressBar').style.width=rate+'%';
  const order={present:0,individual:1,unknown:2};
  const sorted=[...state.people].sort((a,b)=>(order[a.status]??9)-(order[b.status]??9));
  document.getElementById('statusList').innerHTML=sorted.map(p=>`<div class="status-row"><div><strong>${safeText(p.name)}</strong><small>${safeText(p.org)}${p.time?' · '+safeText(p.time):''}</small></div><span class="badge ${p.status}">${labelFor(p.status)}</span></div>`).join('');
}

const dialog=document.getElementById('personDialog');
document.getElementById('addPersonButton').addEventListener('click',()=>{document.getElementById('personForm').reset();dialog.showModal();});
document.getElementById('personSave').addEventListener('click',(e)=>{
  e.preventDefault(); const name=document.getElementById('personName').value.trim(); const org=document.getElementById('personOrg').value.trim(); const phone=document.getElementById('personPhone').value.trim();
  if(!name){toast('이름을 입력해주세요.');return;} if(phone && !/^\d{4}$/.test(phone)){toast('전화번호 뒤 4자리를 숫자로 입력해주세요.');return;}
  state.people.push({id:Date.now(),name,org:org||'소속 미입력',phone:phone||'----',status:'unknown',time:''}); saveState(); dialog.close(); renderCounts(); renderPeople(); toast(`${name}님을 명단에 추가했습니다.`);
});

function renderSettings(){ document.getElementById('orgInput').value=state.settings.org; document.getElementById('managerInput').value=state.settings.manager; document.getElementById('popupToggle').checked=state.settings.popup; document.getElementById('phoneToggle').checked=state.settings.phoneLast4; }
document.getElementById('saveSettings').addEventListener('click',()=>{state.settings.org=document.getElementById('orgInput').value.trim();state.settings.manager=document.getElementById('managerInput').value.trim();state.settings.popup=document.getElementById('popupToggle').checked;state.settings.phoneLast4=document.getElementById('phoneToggle').checked;saveState();toast('설정을 저장했습니다.');});

renderCounts(); renderPeople(); renderStatus(); renderSettings();
if('serviceWorker' in navigator){ window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(()=>{})); }
