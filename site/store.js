import runtimeConfig from './runtime-config.js';
import {createAPITransport} from './transport.js';
import {contentLicense} from './license-policy.js';
const transport=createAPITransport(runtimeConfig);
export let meId='visitor';
let state={role:'visitor',me:null,following:[],bookmarks:[],draft:null};
let posts=[],people=[],replies=[],topics=[],counts={},storageAvailable=true,hasMore=false,page=0,sessionVersion=0;
let translations={posts:[],hasMore:false,total:0,page:0},translationVersion=0;
let profile=null,profileVersion=0;
const postRequests=new Map();
const editDrafts=new Map();
const draftKey=()=>`math-commonroom.draft.${meId}`;
const editDraftKey=id=>`math-commonroom.edit.${meId}.${id}`;
const freshestPost=p=>{const current=posts.find(x=>x.id===p.id);return current&&(current.revision||1)>(p.revision||1)?current:p;};
export const safeURL=value=>{try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}};

function clearSession(expired=false){
  if(expired)transport.clearToken();
  const wasMember=!!state.me;
  if(wasMember)globalThis.dispatchEvent?.(new Event('community-session-ending'));
  sessionVersion++;postRequests.clear();editDrafts.clear();
  state={role:'visitor',me:null,following:[],bookmarks:[],draft:null};
  meId='visitor';posts=[];people=[];replies=[];topics=[];counts={};hasMore=false;page=0;
  translations={posts:[],hasMore:false,total:0,page:0};translationVersion++;
  profile=null;profileVersion++;
  if(wasMember)globalThis.dispatchEvent?.(new Event(expired?'community-session-expired':'community-session-cleared'));
}
export async function api(path,body,method='POST'){
  const version=sessionVersion;
  let response;try{response=await transport.request(path,body,method);}catch{throw new Error('暂时连接不上服务器，请检查网络。草稿仍保留在本机。');}
  let data;try{data=await response.json();}catch{throw new Error('服务器暂时无法响应，请稍后重试。');}
  if(!response.ok){
    if(data.code==='MEMBER_REQUIRED'&&version===sessionVersion)clearSession(true);
    const error=new Error(data.error||data.message||'操作未完成，请重试。');
    error.status=response.status;error.code=data.code;throw error;
  }
  return data;
}
function restoreDraft(){try{state.draft=JSON.parse(localStorage.getItem(draftKey())||'null');}catch{state.draft=null;storageAvailable=false;}}
function requireMember(){if(!state.me)throw new Error('请先登录受邀成员账号。');}
export const store={
  get state(){return state;},get persistent(){return storageAvailable;},get hasMore(){return hasMore;},get loadedMore(){return page>0||translations.page>0||(profile?.page||0)>0;},
  get translations(){return translations;},
  get profile(){return profile;},
  get members(){return people;},get topics(){return topics;},
  get posts(){return [...posts].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));},
  get comments(){return [...replies].sort((a,b)=>a.createdAt.localeCompare(b.createdAt));},
  member(id){return people.find(m=>m.id===id)||{id,name:'访客',initial:'访',color:'sage',field:'',bio:''};},
  post(id){return posts.find(p=>p.id===id);},commentsFor(id){return this.comments.filter(c=>c.publicationId===id);},
  commentCount(id){return counts[id]||0;},
  async refresh(){
    const version=sessionVersion;
    let data;try{data=await api('/community');}catch(error){if(error.code==='MEMBER_REQUIRED')return {me:null};throw error;}
    if(version!==sessionVersion)return {me:state.me};
    const previous=meId;if(state.me&&data.me.id!==previous)clearSession();state.me=data.me;state.role='member';meId=data.me.id;
    state.following=data.following;state.bookmarks=data.bookmarks;people=data.members;posts=data.posts.map(freshestPost);topics=data.topics||[];counts=data.counts;hasMore=data.hasMore;page=0;
    if(meId!==previous){replies=[];restoreDraft();}return data;
  },
  async more(){requireMember();const version=sessionVersion;const data=await api('/community?page='+(page+1));if(version!==sessionVersion||!state.me)return;posts=[...new Map([...posts,...data.posts.map(freshestPost)].map(p=>[p.id,p])).values()];page++;hasMore=data.hasMore;},
  async loadTranslations(params={},append=false){
    requireMember();const version=sessionVersion,request=++translationVersion,nextPage=append?translations.page+1:0;
    const query=new URLSearchParams({q:params.q||'',category:params.category||'',page:String(nextPage)});
    const data=await api('/translations?'+query);
    if(version!==sessionVersion||request!==translationVersion||!state.me)return;
    translations={...data,page:nextPage,posts:append?[...new Map([...translations.posts,...data.posts.map(freshestPost)].map(p=>[p.id,p])).values()]:data.posts.map(freshestPost)};
    posts=[...new Map([...posts,...data.posts.map(freshestPost)].map(p=>[p.id,p])).values()];
  },
  async loadPost(id){requireMember();const version=sessionVersion,request=(postRequests.get(id)||0)+1;postRequests.set(id,request);const data=await api('/posts/'+encodeURIComponent(id));if(version!==sessionVersion||request!==postRequests.get(id)||!state.me)return;if(data.post)posts=[...posts.filter(p=>p.id!==id),freshestPost(data.post)];replies=[...replies.filter(c=>c.publicationId!==id),...data.comments];counts[id]=data.comments.filter(c=>!c.anchor).length;},
  async loadProfile(id,tab='all',append=false){
    requireMember();const version=sessionVersion,request=++profileVersion;
    const previous=append&&profile?.member.id===id&&profile.tab===tab?profile:null;
    const nextPage=previous?previous.page+1:0;
    const data=await api('/members/'+encodeURIComponent(id)+'?'+new URLSearchParams({tab,page:String(nextPage)}));
    if(version!==sessionVersion||request!==profileVersion||!state.me)return;
    profile={...data,page:nextPage,posts:previous?[...new Map([...previous.posts,...data.posts.map(freshestPost)].map(p=>[p.id,p])).values()]:data.posts.map(freshestPost)};
    people=[...people.filter(m=>m.id!==id),data.member];
    posts=[...new Map([...posts,...data.posts.map(freshestPost)].map(p=>[p.id,p])).values()];counts={...counts,...data.counts};
  },
  async loadBookmarks(){await Promise.all(state.bookmarks.filter(id=>!this.post(id)).map(id=>this.loadPost(id).catch(()=>{})));},
  async login(input){await api('/auth/sign-in/email',input);sessionVersion++;await this.refresh();if(!state.me)throw new Error('登录已失效，请重新登录。');},
  async register(input){await api('/session/register',input);sessionVersion++;await this.refresh();if(!state.me)throw new Error('请重新登录受邀成员账号。');},
  async logout(){await api('/auth/sign-out',{});clearSession();},
  async follow(id){requireMember();const version=sessionVersion,active=!state.following.includes(id);await api('/follow',{id,active});if(version!==sessionVersion||!state.me)return;state.following=active?[...state.following,id]:state.following.filter(x=>x!==id);if(profile?.member.id===id)profile.stats.followers=Math.max(0,profile.stats.followers+(active?1:-1));if(profile?.member.id===meId)profile.stats.following=Math.max(0,profile.stats.following+(active?1:-1));},
  async bookmark(id){requireMember();const active=!state.bookmarks.includes(id);await api('/bookmark',{id,active});state.bookmarks=active?[...state.bookmarks,id]:state.bookmarks.filter(x=>x!==id);},
  saveDraft(draft){requireMember();state.draft=draft;try{if(draft)localStorage.setItem(draftKey(),JSON.stringify(draft));else localStorage.removeItem(draftKey());storageAvailable=true;}catch{storageAvailable=false;}},
  editDraft(id){requireMember();if(editDrafts.has(id))return editDrafts.get(id);try{const draft=JSON.parse(localStorage.getItem(editDraftKey(id))||'null');editDrafts.set(id,draft);return draft;}catch{storageAvailable=false;return null;}},
  saveEditDraft(id,draft){requireMember();editDrafts.set(id,draft);try{if(draft)localStorage.setItem(editDraftKey(id),JSON.stringify(draft));else localStorage.removeItem(editDraftKey(id));storageAvailable=true;}catch{storageAvailable=false;}},
  async publish(input){requireMember();const version=sessionVersion,savedDraft=JSON.stringify(state.draft);const {post}=await api('/posts',input);if(version!==sessionVersion||!state.me)return null;posts.unshift(post);if(JSON.stringify(state.draft)===savedDraft)this.saveDraft(null);return post;},
  async updatePost(id,input,expectedRevision){requireMember();const version=sessionVersion,savedDraft=JSON.stringify(this.editDraft(id));const {post}=await api('/posts/'+encodeURIComponent(id),{...input,expectedRevision},'PATCH');if(version!==sessionVersion||!state.me)return null;postRequests.set(id,(postRequests.get(id)||0)+1);const updated=freshestPost(post);posts=[...posts.filter(p=>p.id!==id),updated];translations.posts=translations.posts.map(p=>p.id===id?updated:p);if(profile)profile.posts=profile.posts.map(p=>p.id===id?updated:p);if(JSON.stringify(this.editDraft(id))===savedDraft)this.saveEditDraft(id,null);return updated;},
  async updateComment(id,body,expectedRevision){requireMember();const version=sessionVersion;const {comment}=await api('/comments/'+encodeURIComponent(id),{body,expectedRevision},'PATCH');if(version!==sessionVersion||!state.me)return null;postRequests.set(comment.publicationId,(postRequests.get(comment.publicationId)||0)+1);replies=replies.map(c=>c.id===id&&(c.revision||1)<=(comment.revision||1)?comment:c);return comment;},
  async comment(publicationId,body,replyTo,anchor,licenseConfirmed=false){requireMember();const version=sessionVersion;const {comment}=await api('/comments',{publicationId,body,replyTo,license:contentLicense,licenseConfirmed,...(anchor?{anchor}:{})});if(version!==sessionVersion||!state.me)return;postRequests.set(publicationId,(postRequests.get(publicationId)||0)+1);replies.push(comment);if(!comment.anchor)counts[publicationId]=(counts[publicationId]||0)+1;return comment;},
  async moderate(type,id,active=false){await api('/moderate',{type,id,active});if(!active){if(type==='comment')replies=replies.filter(c=>c.id!==id);else {posts=posts.filter(p=>p.id!==id);translations.posts=translations.posts.filter(p=>p.id!==id);}}}
};
