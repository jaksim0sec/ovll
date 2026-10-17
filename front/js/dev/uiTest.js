/** TEMPORARY visual gesture/viewport fixture; no Chat or Canvas domain logic. */
export function mountUiTest({workspace,theme}) {
  const lifetime=new AbortController();const {signal}=lifetime;
  const chat=document.createElement('section');chat.className='fixture-slide fixture-chat';
  const canvas=document.createElement('section');canvas.className='fixture-slide fixture-canvas';
  const third=document.createElement('section');third.className='fixture-slide fixture-third';
  const composer=document.createElement('footer');composer.className='fixture-composer';
  // Fixed developer-owned static fixture markup, not a runtime rendering protocol.
  chat.innerHTML=`<div class="fixture-chat-scroll"><div class="fixture-chat-inner">
    <span class="demo-eyebrow">OVLL BETA · 임시 CHAT</span>
    <h1>채팅</h1><p>왼쪽으로 스와이프하면 캔버스로 이동합니다. 이 화면은 실제 채팅 기능 없이 전환 동작만 테스트합니다.</p>
    <div class="fixture-speech">이 영역은 스와이프 가능한 화면입니다. 👋</div>
    <div class="fixture-speech fixture-answer">Canvas에서는 본문 스와이프가 비활성화되고, 상단 알약으로 돌아올 수 있어요.</div>
    <div class="fixture-control-panel" data-swipe-block>
      <strong>임시 인터랙션 실험</strong>
      <p>스택 모드와 알약 표시, 세 번째 슬라이드를 실시간 변경해보세요.</p>
      <div class="fixture-buttons">
        <button type="button" data-demo-layout>Stacked로 변경</button>
        <button type="button" data-demo-pill>알약 숨기기</button>
        <button type="button" data-demo-third>세 번째 슬라이드 추가</button>
      </div>
      <label class="fixture-theme-field">화면 테마
        <select data-demo-theme aria-label="임시 테마 변경">
          <option value="system">기기 설정</option><option value="dark">다크</option><option value="light">라이트</option>
        </select>
      </label>
    </div>
    <div class="fixture-notice">입력창은 화면 전환에 참여하지 않습니다. 키보드 실행과 회전, 데스크톱 창 크기 변경을 시험할 수 있습니다.</div>
  </div></div>`;
  canvas.innerHTML=`<div class="fixture-canvas-grid">
    <div class="fixture-canvas-badge"><span class="demo-eyebrow">OVLL BETA · 임시 CANVAS</span><h1>캔버스</h1><p>화면 전체 스와이프는 이곳에서 비활성화됩니다.<br>상단 알약을 이용하세요.</p></div>
    <div class="fixture-node node-left"><span class="fixture-node-icon">✦</span><strong>Chat</strong><small>임시 노드</small></div>
    <div class="fixture-node node-right"><span class="fixture-node-icon">◇</span><strong>Canvas</strong><small>내부 기능 없음</small></div>
    <svg class="fixture-connector" viewBox="0 0 320 140" preserveAspectRatio="none" aria-hidden="true"><path d="M86 95 C145 95 166 38 235 38"/></svg>
    <p class="fixture-canvas-foot">Canvas 제스처 영역 · 실제 확대/이동 기능 없음</p>
  </div>`;
  third.innerHTML=`<div class="fixture-third-inner"><span class="demo-eyebrow">OVLL BETA · 임시 세 번째 슬라이드</span><h1>확장 테스트</h1><p>슬라이드가 3개일 때도 알약 생성과 화면 이동이 가능한지 테스트하는 임시 화면입니다.</p></div>`;
  composer.innerHTML=`<div class="fixture-composer-veil"></div><div class="fixture-composer-box"><span class="fixture-composer-label">임시 Composer · 고정 요소</span><div class="fixture-composer-row"><textarea data-mock-composer rows="1" placeholder="입력해보세요 · 전송/저장 없음" aria-label="임시 입력기"></textarea><button type="button" data-mock-send aria-label="임시 전송 버튼">↗</button></div></div>`;
  const slides=[{id:'chat',label:'채팅',element:chat,allowContentSwipe:true},{id:'canvas',label:'캔버스',element:canvas,allowContentSwipe:false}];
  const withThird={id:'experiment',label:'실험',element:third,allowContentSwipe:true};
  let controller=null;let stacked=false,pillVisible=true,thirdVisible=false;
  function configure(){
    controller?.update({layout:stacked?'stacked':'immersive',pill:{visible:pillVisible},slides:thirdVisible?[...slides,withThird]:slides});
    chat.querySelector('[data-demo-layout]').textContent=stacked?'Immersive로 변경':'Stacked로 변경';
    chat.querySelector('[data-demo-pill]').textContent=pillVisible?'알약 숨기기':'알약 표시';
    chat.querySelector('[data-demo-third]').textContent=thirdVisible?'세 번째 슬라이드 제거':'세 번째 슬라이드 추가';
  }
  chat.querySelector('[data-demo-layout]').addEventListener('click',()=>{stacked=!stacked;configure();},{signal});
  chat.querySelector('[data-demo-pill]').addEventListener('click',()=>{pillVisible=!pillVisible;configure();},{signal});
  chat.querySelector('[data-demo-third]').addEventListener('click',()=>{thirdVisible=!thirdVisible;configure();},{signal});
  const testTheme=chat.querySelector('[data-demo-theme]');
  if(theme){
    testTheme.value=theme.getTheme();
    const unsubscribe=theme.subscribe(next=>{testTheme.value=next;});
    signal.addEventListener('abort',unsubscribe,{once:true});
    testTheme.addEventListener('change',()=>theme.setTheme(testTheme.value),{signal});
  }
  composer.querySelector('[data-mock-send]').addEventListener('click',()=>{composer.querySelector('textarea').focus();},{signal});
  return {
    getPresentation:()=>({root:workspace,layout:stacked?'stacked':'immersive',pill:{visible:pillVisible},slides:thirdVisible?[...slides,withThird]:slides,stationary:[{id:'composer',slot:'bottom',element:composer}]}),
    setController(value){controller=value;},
    destroy(){lifetime.abort();controller=null;}
  };
}

