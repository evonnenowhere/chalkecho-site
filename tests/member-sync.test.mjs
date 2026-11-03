import {test} from 'node:test';
import assert from 'node:assert/strict';

let instance=0;
const person=id=>({id,name:`Member ${id}`,initial:id,color:'blue',field:'Geometry',bio:''});
const post=(id,authorId='a')=>({id,authorId,body:id,createdAt:'2026-11-03T08:00:00Z'});
const community=(ids=['a'],overrides={})=>({me:{...person('a'),role:'member'},members:ids.map(person),posts:[],following:[],bookmarks:[],topics:[],counts:{},hasMore:false,...overrides});
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const memoryStorage=()=>{const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};};

async function fixture(t,data=community()){
  const original={fetch:globalThis.fetch,localStorage:globalThis.localStorage,sessionStorage:globalThis.sessionStorage};
  t.after(()=>{for(const [name,value] of Object.entries(original)){if(value===undefined)delete globalThis[name];else globalThis[name]=value;}});
  let handler=async path=>{assert.equal(path,'/community');return response(data);};
  const paths=[];
  globalThis.localStorage=memoryStorage();globalThis.sessionStorage=memoryStorage();
  globalThis.fetch=(url,options)=>{const parsed=new URL(url),path=parsed.pathname.replace(/^\/api/,'')+parsed.search;paths.push(path);return handler(path,options);};
  const {store}=await import(new URL(`../site/store.js?member-sync=${++instance}`,import.meta.url));
  await store.refresh();
  return {store,paths,respond:data=>{handler=async()=>response(data);},handle:fn=>{handler=fn;}};
}

test('loading more synchronizes new members and resolves their article bylines',async t=>{
  const f=await fixture(t,community(['a'],{posts:[post('first')],hasMore:true}));
  f.handle(async path=>{assert.equal(path,'/community?page=1');return response(community(['a','b'],{posts:[post('second','b')],following:['b']}));});
  await f.store.more();
  assert.deepEqual(f.store.members.map(m=>m.id),['a','b']);
  assert.equal(f.store.member(f.store.post('second').authorId).name,'Member b');
  assert.deepEqual(f.store.state.following,['b']);
  assert.equal(f.store.loadedMore,true);
  assert.deepEqual(f.store.posts.map(p=>p.id),['first','second']);
});

test('an older full refresh cannot replace a newer roster or feed',async t=>{
  const f=await fixture(t);let release;
  f.handle(()=>new Promise(resolve=>{release=resolve;}));
  const older=f.store.refresh();
  f.respond(community(['a','b','c'],{posts:[post('fresh')]}));
  await f.store.refresh();
  release(response(community(['a'],{posts:[post('old')]})));await older;
  assert.deepEqual(f.store.members.map(m=>m.id),['a','b','c']);
  assert.deepEqual(f.store.posts.map(p=>p.id),['fresh']);
});

test('an older full refresh cannot discard a newer loaded page or roster',async t=>{
  const f=await fixture(t,community(['a'],{posts:[post('first')],hasMore:true}));let release;
  f.handle(()=>new Promise(resolve=>{release=resolve;}));const older=f.store.refresh();
  f.respond(community(['a','b','c'],{posts:[post('second','c')],following:['c'],hasMore:true}));
  await f.store.more();
  release(response(community(['a','b'],{posts:[post('old-first')],following:['b']})));await older;
  assert.deepEqual(f.store.members.map(m=>m.id),['a','b','c']);assert.deepEqual(f.store.state.following,['c']);
  assert.deepEqual(f.store.posts.map(p=>p.id),['first','second']);assert.equal(f.store.hasMore,true);assert.equal(f.store.loadedMore,true);
  f.handle(async path=>{assert.equal(path,'/community?page=2');return response(community(['a','b','c'],{posts:[post('third')]}));});
  await f.store.more();assert.ok(f.store.post('third'));assert.ok(f.store.post('second'));
});

test('an older page response cannot overwrite a newer full refresh',async t=>{
  const f=await fixture(t,community(['a'],{posts:[post('first')],hasMore:true}));let release;
  f.handle(()=>new Promise(resolve=>{release=resolve;}));const older=f.store.more();
  f.respond(community(['a','b','c'],{posts:[post('fresh')],following:['c']}));
  await f.store.refresh();
  release(response(community(['a','b'],{posts:[post('old-page')],following:['b'],hasMore:true})));await older;
  assert.deepEqual(f.store.members.map(m=>m.id),['a','b','c']);assert.deepEqual(f.store.state.following,['c']);
  assert.deepEqual(f.store.posts.map(p=>p.id),['fresh']);assert.equal(f.store.hasMore,false);assert.equal(f.store.loadedMore,false);
});

for(const method of ['refresh','more']){
  test(`a pending ${method} cannot repopulate members after logout and another login`,async t=>{
    const f=await fixture(t);let release;
    f.handle(()=>new Promise(resolve=>{release=resolve;}));const pending=f.store[method]();
    f.respond({ok:true});await f.store.logout();assert.deepEqual(f.store.members,[]);
    f.handle(async path=>response(path==='/auth/sign-in/email'?{ok:true}:community(['z'],{me:{...person('z'),role:'member'},posts:[post('private-z','z')]})));
    await f.store.login({email:'z@example.test',password:'test-only-password'});
    release(response(community(['a','b'],{posts:[post('private-a')]})));await pending;
    assert.equal(f.store.state.me.id,'z');assert.deepEqual(f.store.members.map(m=>m.id),['z']);assert.deepEqual(f.store.posts.map(p=>p.id),['private-z']);
  });
}

test('full refresh clears private state if the server reports an expired membership',async t=>{
  const f=await fixture(t,community(['a'],{posts:[post('private')]}));f.store.saveDraft({body:'Private draft'});
  f.handle(async()=>response({error:'Expired',code:'MEMBER_REQUIRED'},401));
  await f.store.refresh();
  assert.equal(f.store.state.me,null);assert.equal(f.store.state.draft,null);assert.deepEqual(f.store.members,[]);assert.deepEqual(f.store.posts,[]);
});

test('loading more detects an account switch before retaining private views',async t=>{
  const f=await fixture(t,community(['a'],{posts:[post('private-a')]}));f.store.saveDraft({body:'Private draft'});
  f.respond(community(['z'],{me:{...person('z'),role:'member'},posts:[post('private-z','z')]}));
  await f.store.more();
  assert.equal(f.store.state.me.id,'z');assert.equal(f.store.state.draft,null);assert.deepEqual(f.store.members.map(m=>m.id),['z']);assert.deepEqual(f.store.posts.map(p=>p.id),['private-z']);
});
