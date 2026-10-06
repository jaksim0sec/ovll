(function(global){
"use strict";

const Store =
  global.OvllWorkspaceStore;

const Navigation =
  global.OvllNavigation;

const appStage =
  document.querySelector(
    "#app-stage"
  );

if(
  !appStage ||
  !Store ||
  !Navigation
){
  return;
}

const state = {
  open:false,
  searchOpen:false,
  query:"",
  editing:null,
  destroyed:false,
  renderFrame:null,
  suppressClick:false,
  conversationMenu:null,
  longPress:{
    timer:null,
    pointerId:null,
    startX:0,
    startY:0,
    conversationId:null,
    target:null
  },
  gesture:{
    active:false,
    horizontal:false,
    pointerId:null,
    startX:0,
    startY:0,
    lastX:0,
    lastTime:0,
    velocityX:0,
    dragX:0
  }
};

const desktopSidebarMedia =
  global.matchMedia?.(
    "(min-width: 43.76rem) and (hover: hover) and (pointer: fine)"
  ) || null;

function usesDockedSidebar(){
  return desktopSidebarMedia
    ?.matches === true;
}

const listeners=[];
const events=new Map();

function listen(
  node,
  type,
  handler,
  options
){
  node.addEventListener(
    type,
    handler,
    options
  );

  listeners.push(
    ()=>node.removeEventListener(
      type,
      handler,
      options
    )
  );
}

function on(name,handler){
  if(typeof handler!=="function"){
    return()=>{};
  }

  if(!events.has(name)){
    events.set(
      name,
      new Set()
    );
  }

  events.get(name).add(
    handler
  );

  return()=>{
    events.get(name)?.delete(
      handler
    );
  };
}

function emit(name,payload){
  for(
    const handler
    of events.get(name)||[]
  ){
    try{
      handler(
        payload,
        api
      );
    }catch(error){
      console.error(error);
    }
  }
}

function icon(name){
  const icons={
    sidebar:`
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <rect x="3.2" y="3.5" width="13.6" height="13" rx="4.7" stroke="currentColor" stroke-width="1.55"/>
        <path d="M7.55 4v12" stroke="currentColor" stroke-width="1.55" stroke-linecap="round"/>
      </svg>
    `,
    close:`
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="m6.35 6.35 7.3 7.3M13.65 6.35l-7.3 7.3" stroke="currentColor" stroke-width="1.65" stroke-linecap="round"/>
      </svg>
    `,
    plus:`
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M10 4.5v11M4.5 10h11" stroke="currentColor" stroke-width="1.65" stroke-linecap="round"/>
      </svg>
    `,
    search:`
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="8.65" cy="8.65" r="4.7" stroke="currentColor" stroke-width="1.55"/>
        <path d="m12.25 12.25 3.35 3.35" stroke="currentColor" stroke-width="1.55" stroke-linecap="round"/>
      </svg>
    `,
    chevron:`
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="m6.9 7.8 3.1 3.1 3.1-3.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `,
    chat:`
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M4 5.1A2.1 2.1 0 0 1 6.1 3h7.8A2.1 2.1 0 0 1 16 5.1v6.1a2.1 2.1 0 0 1-2.1 2.1H8.2L4.35 16v-2.7A2.08 2.08 0 0 1 4 12.15V5.1Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
      </svg>
    `,
    library:`
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path
          d="M4.1 7.15V6.3a1.8 1.8 0 0 1 1.8-1.8h2.15c.58 0 1.02.2 1.38.65l.7.85h3.97a1.8 1.8 0 0 1 1.8 1.8v5.9a1.8 1.8 0 0 1-1.8 1.8H5.9a1.8 1.8 0 0 1-1.8-1.8V7.15Z"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    `,
    build:`
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <rect x="3.6" y="4.1" width="5" height="5" rx="1.55" stroke="currentColor" stroke-width="1.5"/>
        <rect x="11.4" y="10.9" width="5" height="5" rx="1.55" stroke="currentColor" stroke-width="1.5"/>
        <path d="M8.6 6.6h2a2.1 2.1 0 0 1 2.1 2.1v2.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    `,
    user:`
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="10" cy="7.05" r="3" stroke="currentColor" stroke-width="1.5"/>
        <path d="M4.8 16c.45-2.8 2.2-4.2 5.2-4.2s4.75 1.4 5.2 4.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    `,
    moon:`
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M14.95 12.85A6.35 6.35 0 0 1 7.15 5.05 6.55 6.55 0 1 0 14.95 12.85Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `,
    dots:`
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="5.2" cy="10" r="1.2" fill="currentColor"/>
        <circle cx="10" cy="10" r="1.2" fill="currentColor"/>
        <circle cx="14.8" cy="10" r="1.2" fill="currentColor"/>
      </svg>
    `,
    pin:`
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M7.1 4.4h5.8M8 4.4l.4 4-2.45 2.3h8.1L11.6 8.4l.4-4M10 10.7v5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `,
    trash:`
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M6 6.1h8M8 6.1V4.8h4v1.3M7.2 8.2l.5 6h4.6l.5-6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `,
  };

  return icons[name]||"";
}

const root=
  document.createElement(
    "div"
  );

root.id=
  "ovll-shell-menu";

root.innerHTML=`
  <button
    id="ovll-shell-menu-trigger"
    type="button"
    aria-label="사이드바 열기"
    aria-expanded="false"
    aria-controls="ovll-shell-menu-panel"
  >
    ${icon("sidebar")}
  </button>

  <div
    id="ovll-shell-menu-backdrop"
    aria-hidden="true"
  ></div>

  <aside
    id="ovll-shell-menu-panel"
    aria-hidden="true"
    aria-label="워크스페이스"
  >
    <div class="ovll-sidebar-inner">
      <header class="ovll-sidebar-header">
        <div class="ovll-sidebar-brand">
          <span class="ovll-sidebar-brand-orb" aria-hidden="true">
            <i></i>
          </span>
          <span class="ovll-sidebar-brand-name">ovll</span>
        </div>

        <button
          type="button"
          class="ovll-sidebar-dock-toggle"
          data-sidebar-action="close"
          aria-label="사이드바 닫기"
        >
          ${icon("sidebar")}
        </button>
      </header>

      <div class="ovll-sidebar-primary">
        <button
          class="ovll-sidebar-primary-action"
          data-sidebar-action="new-chat"
          type="button"
        >
          <span class="ovll-sidebar-primary-icon">
            ${icon("plus")}
          </span>
          <span>새 대화</span>
        </button>

        <button
          class="ovll-sidebar-primary-action"
          data-sidebar-action="search"
          type="button"
          aria-expanded="false"
        >
          <span class="ovll-sidebar-primary-icon">
            ${icon("search")}
          </span>
          <span>검색</span>
          <span class="ovll-sidebar-keyhint">⌘ K</span>
        </button>

        <button
          class="ovll-sidebar-primary-action"
          data-sidebar-action="library"
          type="button"
        >
          <span class="ovll-sidebar-primary-icon">
            ${icon("library")}
          </span>
          <span>라이브러리</span>
        </button>

        <button
          class="ovll-sidebar-primary-action"
          data-sidebar-action="custom-nodes"
          type="button"
        >
          <span class="ovll-sidebar-primary-icon">
            ${icon("build")}
          </span>
          <span>만들기</span>
        </button>

        <div
          class="ovll-sidebar-search"
          data-sidebar-search
          hidden
        >
          <span class="ovll-sidebar-search-icon">
            ${icon("search")}
          </span>
          <input
            type="text"
            inputmode="search"
            placeholder="대화 검색"
            autocomplete="off"
            spellcheck="false"
            aria-label="대화 검색"
          >
          <button
            type="button"
            data-sidebar-action="search-close"
            aria-label="검색 닫기"
          >
            ${icon("close")}
          </button>
        </div>
      </div>

      <div
        class="ovll-sidebar-scroll"
        data-sidebar-scroll
      >
        <div
          class="ovll-sidebar-sections"
          data-sidebar-sections
        ></div>
      </div>

      <footer class="ovll-sidebar-footer">
        <label class="ovll-sidebar-theme">
          <span class="ovll-sidebar-theme-icon" aria-hidden="true">
            ${icon("moon")}
          </span>
          <span class="ovll-sidebar-theme-copy">
            <strong>다크 모드</strong>
          </span>
          <span class="ovll-sidebar-theme-switch">
            <input
              type="checkbox"
              data-sidebar-theme-toggle
              aria-label="다크 모드"
            >
            <span
              class="ovll-sidebar-theme-track"
              aria-hidden="true"
            ></span>
          </span>
        </label>

        <button
          type="button"
          class="ovll-sidebar-account"
          data-sidebar-action="login"
        >
          <span class="ovll-sidebar-account-avatar">
            ${icon("user")}
          </span>
          <span class="ovll-sidebar-account-copy">
            <strong>로그인</strong>
          </span>
        </button>
      </footer>
    </div>
  </aside>

`;

appStage.appendChild(
  root
);

const trigger=
  root.querySelector(
    "#ovll-shell-menu-trigger"
  );

const backdrop=
  root.querySelector(
    "#ovll-shell-menu-backdrop"
  );

const panel=
  root.querySelector(
    "#ovll-shell-menu-panel"
  );

const sectionsRoot=
  root.querySelector(
    "[data-sidebar-sections]"
  );

const searchBox=
  root.querySelector(
    "[data-sidebar-search]"
  );

const searchInput=
  searchBox?.querySelector(
    "input"
  );

const themeToggle=
  root.querySelector(
    "[data-sidebar-theme-toggle]"
  );

function syncThemeToggle(){
  if(!themeToggle){
    return;
  }

  themeToggle.checked=
    document.documentElement
      .classList
      .contains(
        "dark"
      );
}

syncThemeToggle();

const themeObserver=
  new MutationObserver(
    syncThemeToggle
  );

themeObserver.observe(
  document.documentElement,
  {
    attributes:true,
    attributeFilter:[
      "class",
      "data-theme"
    ]
  }
);

listeners.push(
  ()=>themeObserver.disconnect()
);

function activeConversation(){
  return Store
    .getActiveConversation?.();
}

function hideStandalonePages(){
  global.OvllLibraryPage
    ?.hide?.();

  global.OvllCustomNodePage
    ?.hide?.();
}

function closeOnSmallScreen(){
  if(usesDockedSidebar()){
    return;
  }

  if(
    !global.matchMedia?.(
      "(max-width: 60rem)"
    ).matches
  ){
    return;
  }

  const marker=
    Navigation.current();

  const mode=
    global.AstraUI
      ?.getMode?.()||
    "chat";

  if(
    marker.layer===
      "sidebar" &&
    mode==="canvas" &&
    marker.parentLayer!==
      "canvas"
  ){
    Navigation.replace(
      "canvas"
    );

    close({
      history:false
    });

    return;
  }

  if(
    marker.layer===
      "sidebar" &&
    mode==="chat" &&
    marker.parentLayer===
      "canvas" &&
    marker.depth>=2
  ){
    Navigation.goToDepth(
      marker.depth-2,
      ()=>close({
        history:false
      })
    );

    return;
  }

  close();
}

function currentSectionId(){
  const active =
    activeConversation();

  if(active?.sectionId){
    return active.sectionId;
  }

  return Store
    .getSnapshot()
    .sections
    .slice()
    .sort(
      (a,b)=>a.order-b.order
    )[0]
    ?.id ||
    "";
}

async function saveCurrentConversation(){
  try{
    await global.AstraApp
      ?.saveActiveConversation?.();
  }catch(error){
    console.warn(
      "ovll sidebar save before switch failed:",
      error
    );
  }
}

async function openConversation(
  conversationId
){
  const id =
    String(
      conversationId || ""
    );

  if(!id) return;

  await global.AstraApp
    ?.openConversation?.(
      id
    );

  closeOnSmallScreen();
}
async function createConversation(
  sectionId=currentSectionId()
){
  await saveCurrentConversation();

  const conversation =
    Store.createConversation({
      sectionId,
      title:"새 대화",
      activate:true
    });

  await global.AstraApp
    ?.openConversation?.(
      conversation.id,
      {
        skipSave:true
      }
    );

  closeOnSmallScreen();
}

function setSearchOpen(
  open,
  focus=true
){
  state.searchOpen=
    !!open;

  searchBox.hidden=
    !state.searchOpen;

  root.classList.toggle(
    "is-searching",
    state.searchOpen
  );

  root.querySelector(
    '[data-sidebar-action="search"]'
  )
    ?.setAttribute(
      "aria-expanded",
      String(
        state.searchOpen
      )
    );

  if(
    state.searchOpen &&
    focus
  ){
    requestAnimationFrame(
      ()=>{
        searchInput?.focus({
          preventScroll:true
        });
        searchInput?.select();
      }
    );
  }

  if(!state.searchOpen){
    state.query="";
    if(searchInput){
      searchInput.value="";
    }
  }

  scheduleRender();
}

function renderInlineEditor(
  parent
){
  const row =
    document.createElement(
      "form"
    );

  row.className=
    "ovll-sidebar-inline-editor";

  const input =
    document.createElement(
      "input"
    );

  input.type="text";
  input.maxLength=60;
  input.placeholder="섹션 이름";
  input.autocomplete="off";

  row.appendChild(input);
  parent.appendChild(row);

  const finish=
    commit=>{
      const value=
        input.value.trim();

      if(
        commit &&
        value
      ){
        Store.createSection(
          value
        );
      }

      state.editing=null;
      row.remove();
      scheduleRender();
    };

  row.addEventListener(
    "submit",
    event=>{
      event.preventDefault();
      finish(true);
    }
  );

  input.addEventListener(
    "keydown",
    event=>{
      if(event.key==="Escape"){
        event.preventDefault();
        finish(false);
      }
    }
  );

  input.addEventListener(
    "blur",
    ()=>{
      setTimeout(
        ()=>{
          if(row.isConnected){
            finish(
              !!input.value.trim()
            );
          }
        },
        0
      );
    },
    {once:true}
  );

  requestAnimationFrame(
    ()=>input.focus({
      preventScroll:true
    })
  );
}

function startEditor(){
  if(state.editing){
    return;
  }

  state.editing=
    "section";

  renderInlineEditor(
    sectionsRoot
  );
}

function conversationItem(
  conversation,
  activeId
){
  const item =
    document.createElement(
      "div"
    );

  item.className=
    "ovll-sidebar-chat-item";
  item.dataset.conversationId=
    conversation.id;

  const button =
    document.createElement(
      "button"
    );

  button.type="button";
  button.className=
    "ovll-sidebar-chat";
  button.dataset.conversationOpen=
    conversation.id;

  const active =
    conversation.id===activeId;

  button.classList.toggle(
    "is-active",
    active
  );

  button.setAttribute(
    "aria-current",
    active
      ?"page"
      :"false"
  );

  const iconNode =
    document.createElement(
      "span"
    );

  iconNode.className=
    "ovll-sidebar-chat-icon";
  iconNode.innerHTML=
    icon("chat");

  const copy =
    document.createElement(
      "span"
    );

  copy.className=
    "ovll-sidebar-chat-copy";

  const title =
    document.createElement(
      "span"
    );

  title.className=
    "ovll-sidebar-chat-title";
  title.textContent=
    conversation.title ||
    "새 대화";

  copy.appendChild(
    title
  );

  if(conversation.pinned){
    const pinned =
      document.createElement(
        "span"
      );

    pinned.className=
      "ovll-sidebar-chat-pin";
    pinned.setAttribute(
      "aria-label",
      "고정됨"
    );
    pinned.innerHTML=
      icon("pin");

    copy.appendChild(
      pinned
    );
  }

  button.append(
    iconNode,
    copy
  );

  item.appendChild(
    button
  );

  return item;
}
function compareConversations(
  a,
  b
){
  if(
    !!a.pinned !==
    !!b.pinned
  ){
    return a.pinned
      ?-1
      :1;
  }

  return (
    Number(b.updatedAt)-
    Number(a.updatedAt)
  );
}

function closeConversationMenu(){
  state.conversationMenu
    ?.remove?.();

  state.conversationMenu=
    null;
}

function openConversationMenu(
  conversationId,
  anchor
){
  const conversation=
    Store.getConversation(
      conversationId
    );

  if(
    !conversation ||
    !anchor
  ){
    return;
  }

  closeConversationMenu();

  const menu=
    document.createElement(
      "div"
    );

  menu.className=
    "ovll-sidebar-chat-menu";
  menu.dataset.conversationMenu=
    conversation.id;

  const pin=
    document.createElement(
      "button"
    );

  pin.type="button";
  pin.dataset.sidebarAction=
    "conversation-pin";
  pin.dataset.conversationId=
    conversation.id;
  pin.innerHTML=
    icon("pin") +
    "<span>" +
    (conversation.pinned
      ?"고정 해제"
      :"고정") +
    "</span>";

  const remove=
    document.createElement(
      "button"
    );

  remove.type="button";
  remove.className=
    "is-danger";
  remove.dataset.sidebarAction=
    "conversation-delete";
  remove.dataset.conversationId=
    conversation.id;
  remove.innerHTML=
    icon("trash") +
    "<span>삭제</span>";

  menu.append(
    pin,
    remove
  );

  panel.appendChild(
    menu
  );

  const rect=
    anchor.getBoundingClientRect();

  const panelRect=
    panel.getBoundingClientRect();

  const menuRect=
    menu.getBoundingClientRect();

  const top=
    Math.max(
      panelRect.top+.5,
      Math.min(
        rect.bottom+.2,
        panelRect.bottom-
          menuRect.height-
          .5
      )
    );

  const left=
    Math.max(
      panelRect.left+.5,
      Math.min(
        rect.right-
          menuRect.width,
        panelRect.right-
          menuRect.width-
          .5
      )
    );

  menu.style.top=
    (top-panelRect.top) + "px";
  menu.style.left=
    (left-panelRect.left) + "px";

  state.conversationMenu=
    menu;
}

function clearLongPress(){
  clearTimeout(
    state.longPress.timer
  );

  state.longPress.timer=null;
  state.longPress.pointerId=null;
  state.longPress.conversationId=null;
  state.longPress.target=null;
}

async function deleteConversationFromSidebar(
  conversationId
){
  const id=
    String(
      conversationId ||
      ""
    );

  if(!id){
    return;
  }

  const wasActive=
    Store.getActiveConversation?.()
      ?.id===id;

  Store.deleteConversation(
    id
  );

  closeConversationMenu();

  if(wasActive){
    const next=
      Store.getActiveConversation?.();

    if(next){
      await global.AstraApp
        ?.openConversation?.(
          next.id,
          {
            skipSave:true
          }
        );
    }
  }

  scheduleRender();
}

function renderSearchResults(
  snapshot
){
  sectionsRoot
    .replaceChildren();

  const title =
    document.createElement(
      "div"
    );

  title.className=
    "ovll-sidebar-group-head";

  title.innerHTML=`
    <span>검색 결과</span>
    <small>${Store.search(state.query).length}</small>
  `;

  sectionsRoot.appendChild(
    title
  );

  const results=
    Store.search(
      state.query
    );

  const activeId=
    snapshot.workspace
      .activeConversationId;

  if(!results.length){
    const empty=
      document.createElement(
        "div"
      );
    empty.className=
      "ovll-sidebar-empty";
    empty.textContent=
      "찾는 대화가 없음";
    sectionsRoot.appendChild(
      empty
    );
    return;
  }

  for(const conversation of results){
    sectionsRoot.appendChild(
      conversationItem(
        conversation,
        activeId
      )
    );
  }
}

function sectionElement(
  section,
  conversations,
  activeId
){
  const sectionNode =
    document.createElement(
      "section"
    );

  sectionNode.className=
    "ovll-sidebar-section";
  sectionNode.dataset.sectionId=
    section.id;

  const header =
    document.createElement(
      "div"
    );

  header.className=
    "ovll-sidebar-section-head";

  const toggle =
    document.createElement(
      "button"
    );

  toggle.type="button";
  toggle.className=
    "ovll-sidebar-section-toggle";
  toggle.dataset.sidebarAction=
    "toggle-section";
  toggle.dataset.sectionId=
    section.id;
  toggle.setAttribute(
    "aria-expanded",
    String(!section.collapsed)
  );

  toggle.innerHTML=`
    <span class="ovll-sidebar-section-chevron">
      ${icon("chevron")}
    </span>
    <span class="ovll-sidebar-section-title"></span>
    <span class="ovll-sidebar-section-count">
      ${conversations.length}
    </span>
  `;

  toggle.querySelector(
    ".ovll-sidebar-section-title"
  ).textContent=
    section.title;

  const add =
    document.createElement(
      "button"
    );

  add.type="button";
  add.className=
    "ovll-sidebar-section-add";
  add.dataset.sidebarAction=
    "new-chat-section";
  add.dataset.sectionId=
    section.id;
  add.setAttribute(
    "aria-label",
    `${section.title}에 새 대화`
  );
  add.innerHTML=
    icon("plus");

  header.append(
    toggle,
    add
  );

  sectionNode.appendChild(
    header
  );

  if(!section.collapsed){
    const list=
      document.createElement(
        "div"
      );
    list.className=
      "ovll-sidebar-chat-list";

    const sorted=
      conversations
        .slice()
        .sort(
          compareConversations
        );

    for(const conversation of sorted){
      list.appendChild(
        conversationItem(
          conversation,
          activeId
        )
      );
    }

    sectionNode.appendChild(
      list
    );
  }

  return sectionNode;
}

function renderSections(
  snapshot
){
  sectionsRoot
    .replaceChildren();

  const heading =
    document.createElement(
      "div"
    );

  heading.className=
    "ovll-sidebar-group-head";

  const label =
    document.createElement(
      "span"
    );
  label.textContent=
    "대화";

  const add =
    document.createElement(
      "button"
    );

  add.type="button";
  add.dataset.sidebarAction=
    "new-section";
  add.setAttribute(
    "aria-label",
    "새 섹션"
  );
  add.innerHTML=
    icon("plus");

  heading.append(
    label,
    add
  );

  sectionsRoot.appendChild(
    heading
  );

  const sections=
    snapshot.sections
      .slice()
      .sort(
        (a,b)=>
          Number(a.order)-
          Number(b.order)
      );

  const activeId=
    snapshot.workspace
      .activeConversationId;

  const useFlatDefault =
    sections.length === 1 &&
    String(
      sections[0]?.title || ""
    ).trim() === "대화";

  if(useFlatDefault){
    const list =
      document.createElement(
        "div"
      );

    list.className =
      "ovll-sidebar-chat-list ovll-sidebar-chat-list-flat";

    const conversations =
      snapshot.conversations
        .filter(
          item =>
            item.sectionId ===
            sections[0].id
        )
        .slice()
        .sort(
          compareConversations
        );

    for(const conversation of conversations){
      list.appendChild(
        conversationItem(
          conversation,
          activeId
        )
      );
    }

    sectionsRoot.appendChild(
      list
    );

    return;
  }

  for(const section of sections){
    const conversations=
      snapshot.conversations
        .filter(
          item =>
            item.sectionId===
            section.id
        );

    sectionsRoot.appendChild(
      sectionElement(
        section,
        conversations,
        activeId
      )
    );
  }
}

function render(){
  state.renderFrame=null;

  if(state.destroyed){
    return;
  }

  const snapshot=
    Store.getSnapshot();

  if(
    state.searchOpen &&
    state.query
  ){
    renderSearchResults(
      snapshot
    );
  }else{
    renderSections(
      snapshot
    );
  }
}

function scheduleRender(){
  if(
    state.renderFrame!==null
  ){
    return;
  }

  state.renderFrame=
    requestAnimationFrame(
      render
    );
}

function setOpen(open){
  const next=
    !!open;

  if(
    state.destroyed ||
    state.open===next
  ){
    return api;
  }

  state.open=
    next;

  state.gesture.dragX=0;
  root.style.removeProperty(
    "--sidebar-drag-x"
  );
  root.style.removeProperty(
    "--sidebar-drag-progress"
  );

  root.classList.toggle(
    "is-open",
    next
  );

  trigger.setAttribute(
    "aria-expanded",
    String(next)
  );

  panel.setAttribute(
    "aria-hidden",
    String(!next)
  );

  backdrop.setAttribute(
    "aria-hidden",
    String(
      usesDockedSidebar() ||
      !next
    )
  );

  document.documentElement
    .classList.toggle(
      "shell-menu-open",
      next
    );

  if(next){
    scheduleRender();
  }

  emit(
    "change",
    {
      open:next
    }
  );

  return api;
}

function open(options={}){
  if(
    !state.open &&
    options.history !==
      false &&
    !usesDockedSidebar()
  ){
    Navigation.open(
      "sidebar"
    );
  }

  return setOpen(true);
}

function close(options={}){
  setSearchOpen(false,false);

  if(
    state.open &&
    options.history !==
      false &&
    !usesDockedSidebar() &&
    Navigation.isCurrent(
      "sidebar"
    )
  ){
    Navigation.close(
      "sidebar",
      ()=>setOpen(false)
    );

    return api;
  }

  return setOpen(false);
}

function toggle(){
  return state.open
    ?close()
    :open();
}

function handleClick(event){
  if(
    state.conversationMenu &&
    !event.target.closest(
      "[data-conversation-menu]"
    ) &&
    !event.target.closest(
      '[data-sidebar-action="conversation-menu"]'
    )
  ){
    closeConversationMenu();
  }

  if(state.suppressClick){
    event.preventDefault();
    event.stopPropagation();
    state.suppressClick=false;
    return;
  }

  const conversationOpen=
    event.target.closest(
      "[data-conversation-open]"
    );

  if(
    conversationOpen &&
    root.contains(
      conversationOpen
    )
  ){
    event.preventDefault();

    hideStandalonePages();

    void openConversation(
      conversationOpen
        .dataset
        .conversationOpen
    );
    return;
  }

  const actionNode=
    event.target.closest(
      "[data-sidebar-action]"
    );

  const action=
    actionNode
      ?.dataset
      ?.sidebarAction;

  if(!action){
    return;
  }

  event.preventDefault();

  if(action==="close"){
    close();
    return;
  }


  if(action==="conversation-pin"){
    const conversation=
      Store.getConversation(
        actionNode.dataset.conversationId
      );

    if(conversation){
      Store.setConversationPinned(
        conversation.id,
        !conversation.pinned
      );
    }

    closeConversationMenu();
    return;
  }

  if(action==="conversation-delete"){
    void deleteConversationFromSidebar(
      actionNode.dataset.conversationId
    );
    return;
  }

  if(action==="new-chat"){
    hideStandalonePages();

    void createConversation();
    return;
  }

  if(action==="new-chat-section"){
    hideStandalonePages();

    void createConversation(
      actionNode.dataset.sectionId
    );
    return;
  }

  if(action==="library"){
    global.OvllCustomNodePage
      ?.hide?.({
        history:false
      });

    global.OvllLibraryPage
      ?.show?.({
        history:
          usesDockedSidebar()
            ?true
            :"replace"
      });

    if(!usesDockedSidebar()){
      close({
        history:false
      });
    }
    return;
  }

  if(action==="custom-nodes"){
    global.OvllLibraryPage
      ?.hide?.({
        history:false
      });

    global.OvllCustomNodePage
      ?.show?.({
        history:
          usesDockedSidebar()
            ?true
            :"replace"
      });

    if(!usesDockedSidebar()){
      close({
        history:false
      });
    }
    return;
  }

  if(action==="search"){
    setSearchOpen(
      !state.searchOpen
    );
    return;
  }

  if(action==="search-close"){
    setSearchOpen(false);
    return;
  }

  if(action==="new-section"){
    startEditor();
    return;
  }

  if(action==="toggle-section"){
    const section=
      Store.getSection(
        actionNode.dataset.sectionId
      );

    if(section){
      Store.setSectionCollapsed(
        section.id,
        !section.collapsed
      );
    }
    return;
  }



  if(action==="login"){
    emit(
      "login",
      {
        source:"sidebar"
      }
    );
  }
}

function clearGestureVisuals(){
  root.classList.remove(
    "is-dragging"
  );

  root.style.removeProperty(
    "--sidebar-drag-x"
  );

  root.style.removeProperty(
    "--sidebar-drag-progress"
  );
}

function beginGesturePoint(
  x,
  y,
  id,
  source,
  target
){
  if(
    usesDockedSidebar() ||
    !state.open ||
    state.destroyed
  ){
    return false;
  }

  if(
    target?.closest?.(
      "input,textarea"
    )
  ){
    return false;
  }

  const gesture=
    state.gesture;

  gesture.active=true;
  gesture.horizontal=false;
  gesture.pointerId=
    source==="pointer"
      ?id
      :null;
  gesture.touchId=
    source==="touch"
      ?id
      :null;
  gesture.source=source;
  gesture.startX=x;
  gesture.startY=y;
  gesture.lastX=x;
  gesture.lastTime=
    performance.now();
  gesture.velocityX=0;
  gesture.dragX=0;

  return true;
}

function updateGesturePoint(
  x,
  y,
  preventDefault,
  capture
){
  const gesture=
    state.gesture;

  if(!gesture.active){
    return;
  }

  const dx=
    x-
    gesture.startX;

  const dy=
    y-
    gesture.startY;

  if(
    !gesture.horizontal
  ){
    if(
      Math.max(
        Math.abs(dx),
        Math.abs(dy)
      )<6
    ){
      return;
    }

    if(
      Math.abs(dy)>
        Math.abs(dx)*.92 ||
      dx>=0
    ){
      gesture.active=false;
      gesture.pointerId=null;
      gesture.touchId=null;
      gesture.source=null;
      return;
    }

    gesture.horizontal=true;

    root.classList.add(
      "is-dragging"
    );

    try{
      capture?.();
    }catch{}
  }

  preventDefault?.();

  const width=
    Math.max(
      1,
      panel
        .getBoundingClientRect()
        .width
    );

  gesture.dragX=
    Math.max(
      -width,
      Math.min(
        0,
        dx
      )
    );

  const progress=
    Math.max(
      0,
      Math.min(
        1,
        1+
        gesture.dragX/
        width
      )
    );

  root.style.setProperty(
    "--sidebar-drag-x",
    `${gesture.dragX}px`
  );

  root.style.setProperty(
    "--sidebar-drag-progress",
    String(progress)
  );

  const current=
    performance.now();

  const dt=
    Math.max(
      1,
      current-
      gesture.lastTime
    );

  const velocity=
    (
      x-
      gesture.lastX
    )/
    dt;

  gesture.velocityX=
    gesture.velocityX*.68+
    velocity*.32;

  gesture.lastX=x;
  gesture.lastTime=current;
}

function finishGestureState(
  release
){
  const gesture=
    state.gesture;

  const wasHorizontal=
    gesture.horizontal;

  if(
    !gesture.active &&
    !wasHorizontal
  ){
    gesture.pointerId=null;
    gesture.touchId=null;
    gesture.source=null;
    clearGestureVisuals();
    return;
  }

  const width=
    Math.max(
      1,
      panel
        .getBoundingClientRect()
        .width
    );

  const shouldClose=
    wasHorizontal &&
    (
      Math.abs(
        gesture.dragX
      )>
        width*.22 ||
      gesture.velocityX<
        -.34
    );

  gesture.active=false;
  gesture.horizontal=false;
  gesture.pointerId=null;
  gesture.touchId=null;
  gesture.source=null;

  clearGestureVisuals();

  try{
    release?.();
  }catch{}

  if(wasHorizontal){
    state.suppressClick=true;

    setTimeout(
      ()=>{
        state.suppressClick=false;
      },
      360
    );
  }

  if(shouldClose){
    close();
  }
}

function beginGesture(event){
  if(
    event.pointerType==="touch" ||
    (
      event.button!==undefined &&
      event.button!==0
    )
  ){
    return;
  }

  beginGesturePoint(
    event.clientX,
    event.clientY,
    event.pointerId,
    "pointer",
    event.target
  );
}

function moveGesture(event){
  const gesture=
    state.gesture;

  if(
    event.pointerType==="touch" ||
    gesture.source!=="pointer" ||
    gesture.pointerId!==
      event.pointerId
  ){
    return;
  }

  updateGesturePoint(
    event.clientX,
    event.clientY,
    ()=>event.preventDefault(),
    ()=>panel.setPointerCapture(
      event.pointerId
    )
  );
}

function endGesture(event){
  const gesture=
    state.gesture;

  if(
    event.pointerType==="touch" ||
    gesture.source!=="pointer" ||
    gesture.pointerId!==
      event.pointerId
  ){
    return;
  }

  finishGestureState(
    ()=>panel.releasePointerCapture(
      event.pointerId
    )
  );
}

function touchById(
  list,
  id
){
  for(
    let index=0;
    index<list.length;
    index++
  ){
    if(
      list[index].identifier===
      id
    ){
      return list[index];
    }
  }

  return null;
}

function beginTouchGesture(event){
  if(
    !event.touches ||
    event.touches.length!==1
  ){
    return;
  }

  const touch=
    event.touches[0];

  beginGesturePoint(
    touch.clientX,
    touch.clientY,
    touch.identifier,
    "touch",
    event.target
  );
}

function moveTouchGesture(event){
  const gesture=
    state.gesture;

  if(
    gesture.source!=="touch" ||
    gesture.touchId===null
  ){
    return;
  }

  const touch=
    touchById(
      event.touches,
      gesture.touchId
    );

  if(!touch){
    return;
  }

  updateGesturePoint(
    touch.clientX,
    touch.clientY,
    ()=>event.preventDefault()
  );
}

function endTouchGesture(event){
  const gesture=
    state.gesture;

  if(
    gesture.source!=="touch"
  ){
    return;
  }

  finishGestureState();
}

listen(
  themeToggle,
  "change",
  ()=>{
    const enabled=
      !!themeToggle.checked;

    if(
      typeof global.AstraUI
        ?.setDarkMode ===
        "function"
    ){
      global.AstraUI
        .setDarkMode(
          enabled
        );
    }

    syncThemeToggle();

    emit(
      "themechange",
      {
        theme:
          enabled
            ?"dark"
            :"light"
      }
    );
  }
);

listen(
  trigger,
  "click",
  toggle
);

listen(
  backdrop,
  "click",
  ()=>{
    if(!usesDockedSidebar()){
      close();
    }
  }
);

listen(
  root,
  "click",
  handleClick
);
listen(
  root,
  "pointerdown",
  event=>{
    if(
      event.pointerType!=="touch"
    ){
      return;
    }

    const item=
      event.target.closest(
        ".ovll-sidebar-chat-item"
      );

    if(!item){
      return;
    }

    clearLongPress();

    state.longPress.pointerId=
      event.pointerId;
    state.longPress.startX=
      event.clientX;
    state.longPress.startY=
      event.clientY;
    state.longPress.conversationId=
      item.dataset.conversationId;
    state.longPress.target=
      item;

    state.longPress.timer=
      setTimeout(
        ()=>{
          state.suppressClick=
            true;

          setTimeout(
            ()=>{
              state.suppressClick=
                false;
            },
            360
          );

          openConversationMenu(
            state.longPress.conversationId,
            state.longPress.target
          );

          navigator.vibrate?.(
            12
          );

          clearLongPress();
        },
        480
      );
  },
  {
    passive:true
  }
);

listen(
  root,
  "pointermove",
  event=>{
    if(
      event.pointerId!==
      state.longPress.pointerId
    ){
      return;
    }

    if(
      Math.hypot(
        event.clientX-
          state.longPress.startX,
        event.clientY-
          state.longPress.startY
      )>9
    ){
      clearLongPress();
    }
  },
  {
    passive:true
  }
);

listen(
  root,
  "pointerup",
  clearLongPress,
  {
    passive:true
  }
);

listen(
  root,
  "pointercancel",
  clearLongPress,
  {
    passive:true
  }
);

listen(
  root,
  "contextmenu",
  event=>{
    const item=
      event.target.closest(
        ".ovll-sidebar-chat-item"
      );

    if(!item){
      return;
    }

    event.preventDefault();

    openConversationMenu(
      item.dataset.conversationId,
      item
    );
  }
);

listen(
  searchInput,
  "input",
  event=>{
    state.query=
      event.target.value
        .trim();
    scheduleRender();
  }
);

listen(
  panel,
  "pointerdown",
  beginGesture,
  {
    passive:true
  }
);

listen(
  panel,
  "pointermove",
  moveGesture,
  {
    passive:false
  }
);

listen(
  panel,
  "pointerup",
  endGesture,
  {
    passive:true
  }
);

listen(
  panel,
  "pointercancel",
  endGesture,
  {
    passive:true
  }
);

listen(
  panel,
  "touchstart",
  beginTouchGesture,
  {
    passive:true
  }
);

listen(
  panel,
  "touchmove",
  moveTouchGesture,
  {
    passive:false
  }
);

listen(
  panel,
  "touchend",
  endTouchGesture,
  {
    passive:true
  }
);

listen(
  panel,
  "touchcancel",
  endTouchGesture,
  {
    passive:true
  }
);

listen(
  document,
  "keydown",
  event=>{
    if(
      event.key==="Escape" &&
      state.open
    ){
      if(state.searchOpen){
        setSearchOpen(false);
        return;
      }

      if(!usesDockedSidebar()){
        close();
        return;
      }
    }

    if(
      (
        event.metaKey ||
        event.ctrlKey
      ) &&
      event.key.toLowerCase()==="k"
    ){
      event.preventDefault();

      if(
        usesDockedSidebar() &&
        !state.open
      ){
        return;
      }

      open();
      setSearchOpen(true);
    }
  }
);

const offStore=
  Store.on(
    "change",
    scheduleRender
  );

listeners.push(
  ()=>{
    try{
      offStore?.();
    }catch{}
  }
);

if(desktopSidebarMedia){
  listen(
    desktopSidebarMedia,
    "change",
    event=>{
      setSearchOpen(false,false);
      setOpen(event.matches);
    }
  );
}

scheduleRender();

listen(
  global,
  "ovll:navigation-back",
  event=>{
    if(
      event.detail?.layer===
        "sidebar" &&
      state.open &&
      !usesDockedSidebar()
    ){
      close({
        history:false
      });
    }
  }
);

const api={
  open,
  close,
  toggle,
  on,
  isOpen(){
    return state.open;
  },
  refresh(){
    scheduleRender();
  },
  destroy(){
    if(state.destroyed){
      return;
    }

    state.destroyed=true;

    if(
      state.renderFrame!==null
    ){
      cancelAnimationFrame(
        state.renderFrame
      );
    }

    document.documentElement
      .classList.remove(
        "shell-menu-open"
      );

    listeners
      .splice(0)
      .forEach(cleanup=>{
        try{
          cleanup();
        }catch{}
      });

    events.clear();
    root.remove();
  }
};

if(usesDockedSidebar()){
  setOpen(true);
}

global.OvllShellMenu=
  Object.freeze(api);

})(window);
