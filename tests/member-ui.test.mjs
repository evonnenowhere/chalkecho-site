import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createDocument} from './fixtures/member-dom.mjs';

const source=await readFile(new URL('../site/app.js',import.meta.url),'utf8');
const rendering=await readFile(new URL('../site/render.js',import.meta.url),'utf8');
const withoutImports=value=>value.replace(/^import .*;\s*$/gm,'');
const members=Array.from({length:6},(_,i)=>({id:'member-'+i,name:'Member '+i,initial:String(i),color:'blue',field:'Geometry',bio:'Researcher '+i,email:'private-'+i+'@example.test',role:i?'member':'admin',status:'active'}));
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}

async function harness(hash='#/admin',{role='admin'}={}){
  const document=createDocument(),events=new Map(),intervals=[];
  const server={members:members.map(member=>({...member})),admin:null};
  const calls={refresh:0,admin:0,memberChanges:0};
  const state={role:'member',me:{...members[role==='admin'?0:1],role},following:[],bookmarks:[],draft:null};
  const store={state,members:[],posts:[],comments:[],topics:[],translations:{posts:[],total:0,hasMore:false},profile:null,hasMore:false,loadedMore:false,
    member(id){return this.members.find(member=>member.id===id)||{id,name:'访客',initial:'访',field:'',bio:''};},
    post(id){return this.posts.find(post=>post.id===id);},commentsFor(){return [];},commentCount(){return 0;},
    async refresh(){calls.refresh++;this.members=server.members.map(member=>({...member}));this.loadedMore=false;return {me:state.me};},
    async loadBookmarks(){},async loadTranslations(){},async loadProfile(){},async loadPost(){},saveDraft(){},editDraft(){return null;},
  };
  const adminSnapshot=()=>({users:server.members.map(member=>({...member})),invites:[],hiddenPosts:[],hiddenComments:[]});
  const window={addEventListener(name,callback){if(!events.has(name))events.set(name,[]);events.get(name).push(callback);},scrollTo(){}};
  const context=vm.createContext({document,window,store,URL,URLSearchParams,Intl,Date,console,scrollY:0,
    location:{hash,pathname:'/chalkecho-site/',href:'https://example.test/chalkecho-site/'+hash},
    history:{replaceState(){}},navigator:{},categories:[],safeURL:value=>value,
    contentLicense:'CC-BY-NC-SA-4.0',licenseConsent:()=>'',licenseBadge:()=>'',licenseNotice:()=>'',initAnnotations:()=>null,
    setInterval:callback=>{intervals.push(callback);return intervals.length;},clearInterval(){},setTimeout:()=>0,clearTimeout(){},requestAnimationFrame:callback=>callback(),matchMedia:()=>({matches:true}),
    api:async(path,body)=>{
      if(path==='/admin/member'){
        calls.memberChanges++;
        const member=server.members.find(member=>member.id===body.id);assert.ok(member);
        member.status=body.active?'active':'suspended';return {ok:true};
      }
      assert.equal(path,'/admin');calls.admin++;return server.admin?server.admin():adminSnapshot();
    },
  });
  Object.defineProperty(context,'meId',{get:()=>state.me?.id||'visitor'});
  vm.runInContext(withoutImports(rendering).replace(/^export /gm,''),context,{filename:'render.js'});
  vm.runInContext(withoutImports(source).replace(/^await start\(\);\s*$/m,''),context,{filename:'app.js'});
  const run=code=>vm.runInContext(code,context);
  const flush=()=>new Promise(setImmediate);
  const emit=async(name,event={})=>{for(const callback of events.get(name)||[])await callback(event);await flush();};
  await run('start()');
  return {context,document,server,store,state,calls,run,flush,emit,intervals,
    get main(){return document.querySelector('#main');},get app(){return document.querySelector('#app');},
    async tick(){for(const callback of intervals)await callback();await flush();},
  };
}

test('neither the main navigation nor the sidebar exposes a full member directory',async()=>{
  for(const role of ['member','admin']){
    const view=await harness('#/articles',{role});
    assert.equal(view.document.querySelector('.main-nav a[href="#/people"]'),null);
    assert.equal(view.document.querySelector('.sidebar a[href="#/people"]'),null);
    assert.equal(view.document.querySelector('#member-list'),null);
    assert.ok(!view.main.textContent.includes('@example.test'));
  }
});

test('ordinary members cannot open a complete member directory or request the admin roster',async()=>{
  const directory=await harness('#/people',{role:'member'});
  assert.equal(directory.document.querySelector('#member-list'),null);
  assert.equal(directory.document.querySelector('#admin-member-list'),null);
  assert.ok(directory.main.textContent.includes('这一页暂时找不到'));
  assert.equal(directory.calls.admin,0);
  const management=await harness('#/admin',{role:'member'});
  assert.equal(management.calls.admin,0);
  assert.equal(management.document.querySelector('#admin-member-list'),null);
  assert.ok(management.main.textContent.includes('仅管理员可使用'));
  assert.ok(!management.main.textContent.includes('@example.test'));
});

test('the admin roster loads on entry but never refreshes on a timer, focus or visibility change',async()=>{
  const view=await harness('#/admin');
  assert.equal(view.calls.admin,1);
  const list=view.document.querySelector('#admin-member-list');
  for(const member of members)assert.ok(list.textContent.includes(member.name));
  assert.equal(view.document.querySelector('#admin-member-count').textContent,'6 位成员');
  const refreshes=view.calls.refresh;
  view.server.members.push({...members[1],id:'not-yet-refreshed',name:'Wait For Manual Refresh'});
  await view.tick();
  await view.emit('focus');
  view.document.visibilityState='hidden';await view.document.emit('visibilitychange');
  view.document.visibilityState='visible';await view.document.emit('visibilitychange');
  await view.flush();
  assert.equal(view.calls.admin,1);
  assert.equal(view.calls.refresh,refreshes);
  assert.ok(!list.textContent.includes('Wait For Manual Refresh'));
  assert.equal(view.document.querySelector('#admin-member-count').textContent,'6 位成员');
});

test('the admin refresh button updates members while preserving invitation input and keyboard focus',async()=>{
  const view=await harness('#/admin');
  const input=view.document.querySelector('#invite-label');input.value='Unfinished reading-group invitation';input.focus();
  view.document.querySelector('#invite-days').value='19';
  const originalForm=view.document.querySelector('#shared-invite-form');
  const newMember={...members[1],id:'new-member',name:'New Member',email:'new-member@example.test'};
  view.server.members.push(newMember);
  const refresh=view.document.querySelector('[data-action="refresh-members"]');refresh.focus();
  await view.document.emit('click',{target:refresh,preventDefault(){}});
  assert.equal(view.calls.admin,2);
  assert.ok(view.document.querySelector('#admin-member-list').textContent.includes('New Member'));
  assert.match(view.document.querySelector('#admin-member-count').textContent,/7/);
  assert.equal(view.document.querySelector('#shared-invite-form'),originalForm,'refreshing the roster must preserve form identity');
  assert.equal(view.document.querySelector('#invite-label').value,input.value);
  assert.equal(view.document.querySelector('#invite-days').value,'19');
  assert.equal(view.document.activeElement,refresh);
  assert.equal(refresh.disabled,false);
});

test('a late management response cannot restore private members after logout',async()=>{
  const view=await harness('#/admin'),response=deferred();
  view.server.admin=()=>response.promise;
  const refresh=view.document.querySelector('[data-action="refresh-members"]');
  const pending=view.document.emit('click',{target:refresh,preventDefault(){}});
  for(let i=0;i<8&&view.calls.admin<2;i++)await Promise.resolve();
  assert.equal(view.calls.admin,2,'the manual admin request should be in flight');
  view.state.me=null;view.state.role='visitor';view.store.members=[];
  // Session clearing is emitted by the store after it removes the private data.
  await view.emit('community-session-cleared');
  response.resolve({users:members,invites:[],hiddenPosts:[],hiddenComments:[]});
  await pending;
  assert.equal(view.run('adminData'),null);
  assert.equal(view.document.querySelector('#admin-member-list'),null);
  assert.ok(!view.app.textContent.includes('@example.test'));
  assert.ok(view.app.textContent.includes('邮箱登录'));
});

test('an older manual refresh cannot undo a completed member suspension or erase invitation input',async()=>{
  const view=await harness('#/admin'),stale=deferred();
  const initial={users:view.server.members.map(member=>({...member})),invites:[],hiddenPosts:[],hiddenComments:[]};
  const form=view.document.querySelector('#shared-invite-form');
  view.document.querySelector('#invite-label').value='Keep this unfinished invitation';
  view.document.querySelector('#invite-days').value='23';
  let requests=0;
  view.server.admin=()=>++requests===1?stale.promise:{...initial,users:view.server.members.map(member=>({...member}))};
  const refresh=view.document.querySelector('[data-action="refresh-members"]');
  const pending=view.document.emit('click',{target:refresh,preventDefault(){}});
  for(let i=0;i<8&&view.calls.admin<2;i++)await Promise.resolve();
  assert.equal(view.calls.admin,2);
  const suspend=view.document.querySelector('[data-action="suspend-member"][data-id="member-1"]');suspend.focus();
  await view.document.emit('click',{target:suspend,preventDefault(){}});
  assert.equal(view.calls.memberChanges,1);
  assert.equal(view.calls.admin,3);
  let restore=view.document.querySelector('[data-action="restore-member"][data-id="member-1"]');
  assert.ok(restore,'the completed suspension should show the restore control');
  assert.equal(view.document.activeElement,restore);
  stale.resolve(initial);await pending;
  restore=view.document.querySelector('[data-action="restore-member"][data-id="member-1"]');
  assert.ok(restore,'the late active snapshot must not undo the suspended state');
  assert.equal(view.document.querySelector('[data-action="suspend-member"][data-id="member-1"]'),null);
  assert.equal(view.run('adminData.users.find(member=>member.id==="member-1").status'),'suspended');
  assert.equal(view.document.querySelector('#shared-invite-form'),form);
  assert.equal(view.document.querySelector('#invite-label').value,'Keep this unfinished invitation');
  assert.equal(view.document.querySelector('#invite-days').value,'23');
});
