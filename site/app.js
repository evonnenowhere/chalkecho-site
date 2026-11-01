import {store,safeURL,api,meId} from './store.js';
import {categories} from './data.js';
import {esc,date,icon,markdown} from './render.js';
import {initAnnotations} from './annotations.js';

let route={path:'articles',id:null,params:new URLSearchParams()};
let toastTimer,saveTimer,replyTo=null,composer=null,pendingMemberAction=null,annotations=null,composerTarget=null,commentEdit=null;
const app=document.querySelector('#app');
const dialog=document.querySelector('#dialog');
const href=(path,id)=>`#/${path}${id?'/'+encodeURIComponent(id):''}`;
const sourceLabels={original:'站内原创',licensed:'授权全文',external:'外部导读',translation:'中文译文'};
const sourceLabel=p=>sourceLabels[p.sourceMode]||'站内原创';
const empty=(title,body='',action='')=>`<div class="empty-state"><h2>${esc(title)}</h2>${body?`<p>${esc(body)}</p>`:''}${action}</div>`;
const avatar=(id,large=false)=>{const m=store.member(id);return `<span class="avatar ${m.color} ${large?'large':''}" aria-hidden="true">${esc(m.initial)}</span>`;};
const authorLink=id=>`<a class="author" href="${href('people',id)}">${avatar(id)}<span>${esc(store.member(id).name)}</span></a>`;
const followButton=id=>id===meId?'':`<button class="btn small ${store.state.following.includes(id)?'following':'secondary'}" data-action="follow" data-id="${esc(id)}" aria-pressed="${store.state.following.includes(id)}">${icon(store.state.following.includes(id)?'check':'plus')}${store.state.following.includes(id)?'已关注':'关注'}</button>`;

function readRoute(){
  const raw=location.hash.startsWith('#/')?location.hash.slice(2):'articles';
  const [path,query='']=raw.split('?');
  const parts=path.split('/');
  let id=null;try{id=parts[1]?decodeURIComponent(parts[1]):null;}catch{}
  return {path:parts[0]||'articles',id,params:new URLSearchParams(query)};
}
function queryLink(params,path='articles'){const q=new URLSearchParams(params);return '#/'+path+(q.size?'?'+q:'');}
function accountMenu(){
  return `<details class="account-menu"><summary class="role-button" aria-label="打开账号菜单" title="我的账号">
  ${avatar(meId)}<span class="account-menu-name">${esc(store.state.me.name)}</span>${icon('chevron')}</summary>
  <nav class="account-menu-panel" aria-label="账号菜单"><a href="#/me">${icon('people')}我的主页</a>
  <a href="#/account?section=profile-form">${icon('pen')}编辑资料</a><a href="#/bookmarks">${icon('bookmark')}我的收藏</a>
  <a href="#/account">${icon('settings')}账号设置</a>${store.state.me.role==='admin'?'<a href="#/admin">'+icon('people')+'管理社区</a>':''}</nav></details>`;
}
function header(){
  const nav=store.state.me?[['articles','文章'],['translations','译文'],['feed','动态'],['topics','专题']]:[['about','关于社区']];
  return `<header class="site-header"><a class="brand" href="#/articles" aria-label="ChalkEcho 中文数学社区首页"><img src="./assets/mark.svg" alt="" width="36" height="36"><span>ChalkEcho</span></a>
  <nav class="main-nav" aria-label="主导航">${nav.map(([p,t])=>`<a href="${href(p)}" ${(route.path===p||(p==='translations'&&route.path==='post'&&store.post(route.id)?.kind==='translation'))?'aria-current="page"':''}>${t}</a>`).join('')}</nav>
  <div class="header-actions">${store.state.me?`<button class="icon-button refresh-button" data-action="refresh" aria-label="刷新内容" title="刷新内容">${icon('reset')}</button>${accountMenu()}<button class="btn write-button" data-action="write">${icon('pen')}<span>写一点</span></button>`:'<a class="btn secondary" href="#/login">邮箱登录</a>'}</div></header><p id="sync-status" class="sync-status" role="status" hidden></p>`;
}
function footer(){return `<footer class="site-footer"><nav aria-label="页脚导航"><a href="#/about">社区约定</a><a href="#/about?section=sources" data-action="source-info">内容与来源</a></nav></footer>`;}
const editedMark=p=>p.updatedAt?`<span class="edited-mark" title="${esc(p.updatedAt)}">已编辑</span>`:'';
const editLink=p=>p.authorId===meId?`<a class="quiet-action" href="${href('edit',p.id)}">${icon('pen')}编辑</a>`:'';
const editorRoute=path=>path==='write'||path==='edit';
const authRoute=path=>['login','join','forgot','recover'].includes(path);
function postMeta(p){return `<div class="post-meta">${p.kind==='translation'?'<span>分享</span>':''}${authorLink(p.authorId)}<span class="meta-dot">·</span><time datetime="${esc(p.createdAt)}">${date(p.createdAt)}</time>${p.minutes?`<span class="meta-dot">·</span><span>${p.minutes} 分钟阅读</span>`:''}${editedMark(p)}</div>`;}
function actions(p){const marked=store.state.bookmarks.includes(p.id);return `<div class="post-actions"><a class="quiet-action" href="${href('post',p.id)}?section=discussion">${icon('comment')}<span>${store.commentCount(p.id)||'参与'}${store.commentCount(p.id)?' 条讨论':'讨论'}</span></a><button class="quiet-action ${marked?'selected':''}" data-action="bookmark" data-id="${esc(p.id)}" aria-pressed="${marked}" aria-label="${marked?'取消收藏':'收藏'}：${esc(p.title||'这条动态')}">${icon('bookmark')}<span>${marked?'已收藏':'收藏'}</span></button>${editLink(p)}${(p.authorId===meId||store.state.me?.role==='admin')?`<button class="quiet-action" data-action="hide-post" data-id="${esc(p.id)}">隐藏</button>`:''}</div>`;}
function articleRow(p,index){return `<article class="article-row"><div class="row-content"><div class="eyebrow"><span>${esc(p.category)}</span><span class="source-chip ${p.sourceMode==='external'?'external':''}">${sourceLabel(p)}</span></div><h3><a href="${href('post',p.id)}">${esc(p.title)}</a></h3><p class="article-summary">${esc(p.summary)}</p>${p.kind==='translation'?`<p class="translation-credit">原作：${esc(p.originalAuthor)}<span>·</span>译者：${esc(p.translator)}</p>`:''}${postMeta(p)}${actions(p)}</div><a href="${href('post',p.id)}" class="row-number" aria-label="阅读：${esc(p.title)}">${String((index??0)+1).padStart(2,'0')}${icon(p.kind==='link'?'external':'arrow')}</a></article>`;}
function featured(p){return `<article class="featured"><div class="featured-content"><div class="eyebrow"><span class="featured-kicker">编辑精选</span><span>${esc(p.category)}</span></div><h2><a href="${href('post',p.id)}">${esc(p.title)}</a></h2><p>${esc(p.summary)}</p><div class="featured-bottom">${postMeta(p)}<a class="read-link" href="${href('post',p.id)}">开始阅读 ${icon('arrow')}</a></div></div></article>`;}
function sidebar(){
  const people=store.members.filter(m=>m.id!==meId).slice(0,3);
  if(!store.topics.length&&!people.length)return '';
  return `<aside class="sidebar">
  ${store.topics.length?`<section class="side-section"><div class="section-label"><h2>专题</h2><a href="#/topics" aria-label="查看全部专题">${icon('arrow')}</a></div>
  ${store.topics.slice(0,3).map(t=>`<a class="topic-mini" href="${href('topics',t.id)}"><span class="topic-number ${t.color}">${t.number}</span><span><strong>${esc(t.title)}</strong><small>${t.ids.length} 篇内容 · 编辑整理</small></span>${icon('arrow')}</a>`).join('')}</section>`:''}
  ${people.length?`<section class="side-section"><div class="section-label"><h2>成员</h2></div>
  ${people.map(m=>`<div class="person-mini"><a href="${href('people',m.id)}">${avatar(m.id)}<span><strong>${esc(m.name)}</strong><small>${esc(m.field)}</small></span></a>${followButton(m.id)}</div>`).join('')}</section>`:''}
  </aside>`;
}

function articlesPage(){
  const q=route.params.get('q')||'',category=route.params.get('category')||'',mode=route.params.get('view')||'latest';
  const all=store.posts.filter(p=>p.kind!=='note');
  const featuredPost=!q&&!category&&mode==='latest'?all.find(p=>p.featured):null;
  const list=all.filter(p=>(!category||p.category===category)&&(mode!=='featured'||p.featured)&&(!q||[p.title,p.summary,store.member(p.authorId).name,p.originalAuthor].join(' ').toLowerCase().includes(q.toLowerCase()))&&(!featuredPost||p.id!==featuredPost.id));
  return `<section class="page-intro"><h1>文章</h1><form class="search-form" role="search" id="search-form">${icon('search')}<input type="search" name="q" value="${esc(q)}" placeholder="搜索标题或作者" aria-label="搜索文章标题、简介和作者"><button type="submit" aria-label="搜索">${icon('arrow')}</button></form></section>
  ${featuredPost?featured(featuredPost):''}
  <div class="content-grid"><section class="articles-section"><div class="list-heading"><div class="tabs" aria-label="文章排序"><a href="${queryLink({...(q?{q}:{}),...(category?{category}:{}),view:'latest'})}" ${mode==='latest'?'aria-current="page"':''}>最新文章</a><a href="${queryLink({...(q?{q}:{}),...(category?{category}:{}),view:'featured'})}" ${mode==='featured'?'aria-current="page"':''}>编辑精选</a></div><span class="small-note">${list.length} 篇${q?'搜索结果':'内容'}</span></div><div class="filter-list"><a class="filter ${!category?'active':''}" href="${queryLink({...(q?{q}:{}),view:mode})}">全部</a>${categories.map(c=>`<a class="filter ${category===c?'active':''}" href="${queryLink({category:c,...(q?{q}:{}),view:mode})}">${esc(c)}</a>`).join('')}</div>${q?`<p class="search-result-label">关于“${esc(q)}”的文章 <a href="#/articles">清除搜索</a></p>`:''}${list.length?list.map(articleRow).join(''):(q||category?empty('暂无匹配的文章','换个关键词或主题试试。','<a class="btn secondary" href="#/articles">浏览全部文章</a>'):mode==='featured'?empty('编辑还没圈重点','','<a class="btn secondary" href="#/articles">阅读最新文章</a>'):empty('此处空白，不是留作习题','','<button class="btn" data-action="write">写第一篇文章</button>'))}${loadMore()}</section>${sidebar()}</div>`;
}
function translationsPage(){
  const q=route.params.get('q')||'',category=route.params.get('category')||'';
  const {posts:list,total,hasMore}=store.translations;
  const link=params=>queryLink(params,'translations');
  return `<section class="page-intro translation-intro"><h1>译文</h1>
  <button class="btn" data-action="write-translation">${icon('pen')}发布译文</button></section>
  <div class="content-grid"><section class="articles-section">
  <div class="translation-toolbar"><h2>最新译文 <span class="small-note">${total} 篇${q||category?'结果':'译文'}</span></h2>
  <form class="search-form" role="search" id="translation-search-form">${icon('search')}
  <input type="search" name="q" maxlength="200" value="${esc(q)}" placeholder="搜索标题、作者或译者" aria-label="搜索译文标题、作者和译者">
  <button type="submit" aria-label="搜索译文">${icon('arrow')}</button></form></div>
  <div class="filter-list"><a class="filter ${!category?'active':''}" href="${link(q?{q}:{})}">全部</a>
  ${categories.map(c=>`<a class="filter ${category===c?'active':''}" href="${link({category:c,...(q?{q}:{})})}">${esc(c)}</a>`).join('')}</div>
  ${q?`<p class="search-result-label">关于“${esc(q)}”的译文 <a href="${link(category?{category}:{})}">清除搜索</a></p>`:''}
  ${list.length?list.map(articleRow).join(''):(q||category?empty('暂无匹配的译文','换个关键词或主题试试。','<a class="btn secondary" href="#/translations">浏览全部译文</a>'):empty('暂无译文'))}
  ${hasMore?'<div class="load-more"><button class="btn secondary" data-action="load-translations">加载更早的译文</button></div>':''}</section>
  </div>`;
}
function feedItem(p){const m=store.member(p.authorId);return `<article class="feed-item"><a href="${href('people',p.authorId)}" class="feed-avatar" aria-label="${esc(m.name)}的主页">${avatar(p.authorId)}</a><div class="feed-item-body"><div class="feed-top"><div><a href="${href('people',p.authorId)}" class="person-name">${esc(m.name)}</a><span class="small-note">社区成员</span><span class="feed-date">${date(p.createdAt)}</span></div>${followButton(p.authorId)}</div>${p.kind==='note'?`<div class="prose note-prose">${markdown(p.body,p.id).html}</div>`:`<p class="feed-published">${p.kind==='translation'?'分享了一篇中文译文':p.kind==='link'?'推荐了一篇外部内容':'发表了一篇文章'}</p><a class="feed-article" href="${href('post',p.id)}"><span class="eyebrow">${esc(p.category)} <span class="source-chip">${sourceLabel(p)}</span></span><h2>${esc(p.title)}</h2><p>${esc(p.summary)}</p><span class="read-link">${p.kind==='link'?'阅读导读':'阅读全文'} ${icon('arrow')}</span></a>`}${actions(p)}</div></article>`;}
function feedPage(){const followed=route.params.get('view')==='following';const list=store.posts.filter(p=>!followed||store.state.following.includes(p.authorId));return `<section class="page-intro compact"><h1>动态</h1></section><div class="content-grid"><section class="feed-section"><button class="composer-prompt" data-action="write-note">${avatar(meId)}<span>今天有什么进展，或者新卡点？</span>${icon('pen')}</button><div class="list-heading"><div class="tabs"><a href="#/feed" ${!followed?'aria-current="page"':''}>全部动态</a><a href="#/feed?view=following" ${followed?'aria-current="page"':''}>我的关注</a></div><span class="small-note">按时间排列</span></div>${list.length?list.map(feedItem).join(''):(followed?empty('暂无关注动态','','<a href="#/articles" class="btn secondary">发现作者</a>'):empty('暂无动态'))}${loadMore()}</section>${sidebar()}</div>`;}
function topicsPage(){
  if(!route.id&&!store.topics.length)return `<section class="page-intro"><h1>专题</h1></section>${empty('暂无专题','','<a class="btn secondary" href="#/articles">阅读文章</a>')}`;
  if(route.id){const t=store.topics.find(t=>t.id===route.id);if(!t)return notFound();return `<a class="back-link" href="#/topics">${icon('back')}全部专题</a><section class="topic-banner ${t.color}"><span class="overline">专题 ${t.number} · 编辑整理</span><h1>${esc(t.title)}</h1><p>${esc(t.description)}</p><small>${t.ids.length} 篇内容 · 按以下顺序阅读</small></section><div class="topic-reading-list">${t.ids.map((id,i)=>articleRow(store.post(id),i)).join('')}</div>`;}
  return `<section class="page-intro"><h1>专题</h1></section><div class="topic-grid">${store.topics.map(t=>`<a class="topic-card ${t.color}" href="${href('topics',t.id)}"><div class="topic-card-top"><span class="overline">专题 ${t.number}</span>${icon('arrow')}</div><div class="topic-symbol" aria-hidden="true">${({sage:'∫',blue:'∴',clay:'∂',plum:'∞'})[t.color]}</div><h2>${esc(t.title)}</h2><p>${esc(t.description)}</p><div class="topic-card-bottom"><span>${t.ids.length} 篇内容</span><span>${esc(t.subtitle)}</span></div></a>`).join('')}</div>`;
}
function sourceBox(p){
  if(p.kind==='note')return '';
  const source=safeURL(p.sourceUrl),translation=p.kind==='translation';
  return `<section class="source-box ${p.sourceMode==='external'||translation?'external-source':''}" aria-label="${translation?'译文来源':'文章来源'}">
  <div class="eyebrow">${icon(p.sourceMode==='external'||translation?'external':'book')}${sourceLabel(p)}</div>
  ${translation?`${p.originalTitle?`<strong>${esc(p.originalTitle)}</strong>`:''}
  <p>原作：${esc(p.originalAuthor)}${p.sourceName?` · ${esc(p.sourceName)}`:''}</p>
  <p>译者：${esc(p.translator)}</p><p class="permission-note"><strong>授权／转载说明：</strong>${esc(p.permission)}</p>`:
  p.sourceMode==='external'?`<strong>${esc(p.sourceName)}</strong><p>原作者／来源：${esc(p.originalAuthor||p.sourceName)}。本站提供导读，全文请前往原始网站阅读。</p>`:
  p.sourceMode==='licensed'?`<strong>${esc(p.sourceName)}</strong><p>${esc(p.permission)}</p>`:''}
  ${source&&(translation||p.sourceMode==='external')?`<a class="btn secondary small" href="${esc(source)}" target="_blank" rel="noopener noreferrer">前往原文 ${icon('external')}</a>`:''}
  ${p.aiDisclosure?`<p><strong>AI 使用说明：</strong>${esc(p.aiDisclosure)}</p>`:''}</section>`;
}
function discussion(p){const list=store.commentsFor(p.id).filter(c=>!c.anchor);const target=replyTo?list.find(c=>c.id===replyTo):null;return `<section class="discussion" id="discussion"><div class="section-label"><h2>一起讨论 <span>${list.length}</span></h2></div>${list.length?`<div class="comments-list">${list.map(c=>{const parent=c.replyTo?list.find(x=>x.id===c.replyTo):null;return `<article class="comment" id="${esc(c.id)}">${avatar(c.authorId)}<div class="comment-body"><div class="comment-meta"><a class="person-name" href="${href('people',c.authorId)}">${esc(store.member(c.authorId).name)}</a><time datetime="${esc(c.createdAt)}">${date(c.createdAt)}</time>${editedMark(c)}</div>${parent?`<a href="#${esc(parent.id)}" class="reply-context" data-scroll="${esc(parent.id)}">回复 ${esc(store.member(parent.authorId).name)}：${esc(parent.body.slice(0,70))}${parent.body.length>70?'…':''}</a>`:''}<div class="prose comment-prose">${markdown(c.body,c.id).html}</div><button class="text-button" data-action="reply" data-id="${esc(c.id)}">回复</button>${c.authorId===meId?` <button class="text-button" data-action="edit-comment" data-id="${esc(c.id)}">编辑</button>`:''}${(c.authorId===meId||store.state.me?.role==='admin')?` <button class="text-button" data-action="hide-comment" data-id="${esc(c.id)}">隐藏</button>`:''}</div></article>`;}).join('')}</div>`:'<p class="discussion-empty">暂无回复。</p>'}${store.state.role==='member'?`<form id="comment-form" class="comment-form"><label for="comment-body">${target?`回复 ${esc(store.member(target.authorId).name)}`:'写下你的想法'}</label>${target?'<button type="button" class="text-button" data-action="cancel-reply">取消回复</button>':''}<textarea id="comment-body" name="body" rows="4" maxlength="5000" required placeholder="写下回复…"></textarea><div class="form-bottom"><span class="small-note">以 ${esc(store.state.me?.name)} 的身份回复 · 成员可见</span><button class="btn" type="submit">发表回复 ${icon('arrow')}</button></div><p class="form-error" role="alert"></p></form>`:`<div class="join-discussion"><div><h3>给这个想法一个回应。</h3><p>受邀成员登录后，可以参与成员讨论。</p></div><button class="btn secondary" data-action="join">邮箱登录 ${icon('arrow')}</button></div>`}</section>`;}
function postPage(){const p=store.post(route.id);if(!p)return notFound();const rendered=markdown(p.body,p.id,{annotations:p.kind!=='note'});const a=store.member(p.authorId);return `<a class="back-link" href="${p.kind==='translation'?'#/translations':p.kind==='note'?'#/feed':'#/articles'}">${icon('back')}${p.kind==='translation'?'返回译文':p.kind==='note'?'返回动态':'返回文章'}</a><div class="reading-layout"><article class="reading-main"><header class="article-header"><div class="eyebrow"><a href="${queryLink({category:p.category},p.kind==='translation'?'translations':'articles')}">${esc(p.category)}</a><span class="source-chip">${p.kind==='note'?'短动态':sourceLabel(p)}</span></div><h1>${esc(p.title||'一则研究动态')}</h1>${p.summary?`<p class="article-deck">${esc(p.summary)}</p>`:''}<div class="article-byline">${postMeta(p)}${followButton(p.authorId)}</div>${p.kind!=='note'||p.authorId===meId?'<div class="annotation-toolbar">'+(p.kind!=='note'?'<button class="quiet-action" type="button" data-annotation-open>'+icon('pen')+'批注</button>':'')+editLink(p)+'</div>':''}</header>${rendered.headings.length?`<details class="mobile-toc"><summary>文章目录 <span>${rendered.headings.length} 个小节</span></summary><nav aria-label="手机文章目录">${rendered.headings.map(h=>`<a href="#${esc(h.id)}" data-scroll="${esc(h.id)}">${esc(h.title)}</a>`).join('')}<a href="#discussion" data-scroll="discussion">参与讨论</a></nav></details>`:''}${p.sourceMode==='external'||p.kind==='translation'?sourceBox(p):''}<div class="prose article-prose">${rendered.html}</div>${p.sourceMode!=='external'&&p.kind!=='translation'?sourceBox(p):''}<div class="article-end-actions">${actions(p)}${p.kind!=='note'?'<button class="quiet-action" type="button" data-annotation-open>'+icon('pen')+'批注</button>':''}<button class="quiet-action" data-action="share">${icon('copy')}复制链接</button></div><div class="author-box">${avatar(a.id,true)}<div><a href="${href('people',a.id)}">${esc(a.name)}</a><span>${p.kind==='translation'?'译文分享者':'社区成员'}</span><p>${esc(a.bio)}</p></div>${followButton(a.id)}</div>${discussion(p)}</article>${rendered.headings.length?`<aside class="reading-aside"><nav class="toc" aria-label="文章目录"><h2>这篇文章</h2>${rendered.headings.map(h=>`<a href="#${esc(h.id)}" data-scroll="${esc(h.id)}">${esc(h.title)}</a>`).join('')}<a href="#discussion" data-scroll="discussion">参与讨论</a></nav></aside>`:''}</div>`;}
function profileTab(){const tab=route.params.get('tab')||'all';return ['all','articles','translations','notes','links'].includes(tab)?tab:'all';}
function profileId(){return route.path==='me'?meId:route.id;}
function profilePage(){
  const data=store.profile,id=profileId();if(!data||data.member.id!==id)return notFound();
  const {member:m,stats,posts:list,hasMore}=data,own=id===meId,tab=profileTab();
  const base=own?'#/me':href('people',m.id);
  const tabs=[['all','全部'],['articles','文章'],['translations','译文'],['notes','动态'],['links','推荐']];
  const joined=m.joinedAt?new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'long',timeZone:'Asia/Shanghai'}).format(new Date(m.joinedAt)):'';
  const writeAction=tab==='notes'?'write-note':tab==='translations'?'write-translation':tab==='links'?'write-link':'write';
  return `<section class="member-profile"><header class="member-profile-head"><div class="member-identity">${avatar(m.id,true)}
  <div class="member-intro"><h1>${esc(m.name)}</h1>
  ${m.field?`<p class="profile-field">${esc(m.field)}</p>`:''}${m.bio?`<p class="member-bio">${esc(m.bio)}</p>`:''}
  ${joined?`<p class="member-joined">${esc(joined)}加入</p>`:''}</div></div>
  <div class="member-profile-actions">${own?'<a class="btn" href="#/account?section=profile-form">'+icon('pen')+'编辑资料</a>':followButton(m.id)}
  <button class="btn secondary" data-action="share-profile">${icon('copy')}复制主页链接</button>${own?'<a class="text-button" href="#/account">账号设置 '+icon('arrow')+'</a>':''}</div></header>
  <dl class="member-stats"><div><dt>已发布</dt><dd>${stats.all}</dd></div><div><dt>关注</dt><dd>${stats.following}</dd></div><div><dt>关注者</dt><dd>${stats.followers}</dd></div></dl>
  <div class="member-profile-layout"><section class="member-publications" aria-label="成员发布的内容"><div class="list-heading"><nav class="tabs profile-tabs" aria-label="主页内容分类">
  ${tabs.map(([key,label])=>`<a href="${base}${key==='all'?'':'?tab='+key}" ${tab===key?'aria-current="page"':''}>${label}<span>${stats[key]}</span></a>`).join('')}</nav></div>
  ${list.length?list.map((p,i)=>p.kind==='note'?feedItem(p):articleRow(p,i)).join(''):empty('暂无内容','',own?`<button class="btn secondary" data-action="${writeAction}">写一点 ${icon('pen')}</button>`:'')}
  ${hasMore?'<div class="load-more"><button class="btn secondary" data-action="load-profile">加载更早的内容</button></div>':''}</section>
</div></section>`;
}
function bookmarksPage(){const list=store.posts.filter(p=>store.state.bookmarks.includes(p.id));return `<section class="page-intro"><h1>收藏</h1><span class="small-note">${list.length} 篇内容</span></section><div class="profile-content">${list.length?list.map((p,i)=>p.kind==='note'?feedItem(p):articleRow(p,i)).join(''):empty('给“下次一定”留个位置','','<a class="btn secondary" href="#/articles">去读一篇文章</a>')}</div>`;}

function draftDefaults(kind='article'){return {kind,title:'',summary:'',body:'',category:'研究手记',sourceUrl:'',sourceName:'',originalAuthor:'',originalTitle:'',translator:store.state.me?.name||'',permission:'',aiDisclosure:''};}
function sourceFields(c){
  if(!['link','translation'].includes(c.kind))return '';
  const t=c.kind==='translation';
  return `<div class="source-fields"><h2>${t?'原文与译者':'原始出处'}</h2>
  <label for="source-url">原文链接</label><input id="source-url" name="sourceUrl" type="url" value="${esc(c.sourceUrl)}" maxlength="2000" placeholder="https://" required>
  ${t?`<label for="original-title">原文标题 <span class="optional">选填</span></label><input id="original-title" name="originalTitle" maxlength="240" value="${esc(c.originalTitle)}" placeholder="保留原文标题，方便对照查找">`:''}
  <div class="two-fields"><div><label for="source-name">博客／网站名称 <span class="optional">选填</span></label><input id="source-name" name="sourceName" maxlength="100" value="${esc(c.sourceName)}" placeholder="来源名称"></div>
  <div><label for="original-author">原作者 ${t?'':'<span class="optional">选填</span>'}</label><input id="original-author" name="originalAuthor" maxlength="100" value="${esc(c.originalAuthor)}" placeholder="保留原作者署名" ${t?'required':''}></div></div>
  ${t?`<label for="translator">译者署名</label><input id="translator" name="translator" maxlength="100" value="${esc(c.translator)}" placeholder="自己翻译时填你的名字；转载时保留译者署名" required>
  <label for="translation-permission">授权／转载说明</label><textarea id="translation-permission" name="permission" rows="2" maxlength="1000" required placeholder="说明翻译或转载的许可与出处，例如已获原作者及译者授权，或适用的开放许可。">${esc(c.permission)}</textarea>
  <p class="small-note">可分享自己的翻译，也可转载已获许可的译文。节译请在正文说明范围，译者补充可标注为“译注”。</p>`:'<p class="small-note">这里只发表你的导读与推荐理由，全文由读者前往原站阅读。</p>'}</div>`;
}
function draftPreview(c){
  const title=c.kind!=='note'?`<h2>${esc(c.title||'未命名文章')}</h2>`:'';
  return title+(c.kind==='translation'?sourceBox({...c,sourceMode:'translation'}):'')+markdown(c.body||'先写两行，看看它们在纸上是什么样。','preview').html;
}
function composePage(){
  if(store.state.role!=='member')return empty('这里欢迎你的经验与思考','受邀成员登录邮箱账号后，即可发表文章与短动态。','<button class="btn" data-action="join">邮箱登录</button>');
  const editing=route.path==='edit',original=editing?store.post(route.id):null,target=editing?route.id:'new';
  if(editing&&(!original||original.authorId!==meId))return empty('只能编辑自己发布的内容','','<a class="btn secondary" href="#/articles">返回文章</a>');
  const requested=route.params.get('kind'),kinds=['article','translation','note','link'];
  if(composerTarget!==target){composer=null;composerTarget=target;}
  if(editing&&!composer){const saved=store.editDraft(route.id);composer={...draftDefaults(original.kind),...original,...(saved||{}),kind:original.kind,expectedRevision:saved?.expectedRevision??original.revision??1};}
  if(!composer){
    const saved=store.state.draft,hasContent=saved&&Object.entries(saved).some(([key,value])=>!['kind','category','translator'].includes(key)&&String(value||'').trim());
    composer={...draftDefaults(),...(saved||{})};
    if(!hasContent&&kinds.includes(requested))composer.kind=requested;
  }
  if(!kinds.includes(composer.kind))composer.kind='article';
  const c=composer,t=c.kind==='translation',stale=editing&&c.expectedRevision!==(original.revision||1);
  return `<div class="editor-heading"><a class="back-link" href="${editing?href('post',route.id):t?'#/translations':'#/articles'}">${icon('back')}${editing?'返回原文':t?'返回译文':'返回阅读'}</a>
  <span class="small-note">${avatar(meId)}${esc(store.state.me?.name)}</span></div>
  <section class="editor"><div class="editor-title"><h1>${editing?({article:'编辑文章',translation:'编辑译文',note:'编辑动态',link:'编辑导读'}[c.kind]):t?'分享译文':'写一点'}</h1></div>
  ${!editing&&requested==='translation'&&requested!==c.kind&&store.state.draft?'<p class="notice">已恢复你尚未发布的草稿。若要把它作为译文发布，可在下方切换到“发译文”，已有文字会保留。</p>':''}
  ${editing?'':`<div class="editor-kind" aria-label="内容类型">${[['article','写长文','book'],['translation','发译文','translate'],['note','发动态','comment'],['link','推荐文章','external']].map(([k,l,i])=>`<button class="${c.kind===k?'active':''}" data-action="kind" data-id="${k}" aria-pressed="${c.kind===k}">${icon(i)}${l}</button>`).join('')}</div>`}
  ${editing?`<div class="notice edit-conflict" ${stale?'':'hidden'}><p>这篇内容已有新版本。你的修改已保留，请先复制需要的内容，再载入最新版本。</p><button type="button" class="text-button" data-action="reload-edit">载入最新内容</button></div>`:''}
  <form id="publish-form" data-editor-target="${esc(target)}"><div class="editor-form-body">
  ${c.kind!=='note'?`<label for="post-title">${t?'中文标题':'标题'}</label><input class="title-input" id="post-title" name="title" placeholder="${t?'这篇文章的中文标题':c.kind==='link'?'给这篇导读起一个名字':'这次想聊哪件事？'}" value="${esc(c.title)}" maxlength="120" required>
  <label for="post-summary">简介 <span class="optional">选填</span></label><textarea id="post-summary" name="summary" rows="2" maxlength="220" placeholder="${t?'它为什么值得翻译？适合什么背景的读者？':'用两句话，说说这篇在琢磨什么。'}">${esc(c.summary)}</textarea>`:''}
  ${sourceFields(c)}
  <div class="body-label"><label for="post-body">${t?'中文译文':c.kind==='note'?'今天的想法':c.kind==='link'?'推荐理由与导读':'正文'}</label><button type="button" class="text-button" data-action="writing-help">Markdown 与公式帮助</button></div>
  <textarea class="body-input" id="post-body" name="body" rows="${c.kind==='note'?9:14}" maxlength="${c.kind==='note'?5000:60000}" required placeholder="${t?'在这里写下或粘贴中文译文。支持 Markdown、数学公式和脚注。':c.kind==='link'?'它适合什么背景的读者？为什么值得读？':'比如：这个证明卡在第三行。前两行也欢迎讨论。'}">${esc(c.body)}</textarea>
  <div class="editor-options"><div><label for="post-category">主题</label><select id="post-category" name="category">${categories.map(cat=>`<option ${c.category===cat?'selected':''}>${esc(cat)}</option>`).join('')}</select></div>
  <div><label for="ai-disclosure">AI 使用说明 <span class="optional">如有实质性使用请说明</span></label><input id="ai-disclosure" name="aiDisclosure" maxlength="500" value="${esc(c.aiDisclosure)}" placeholder="${t?'例如：AI 辅助初译，由本人逐段核对原文与术语':'例如：辅助整理结构，论证由本人核查'}"></div></div>
  <div class="preview-panel" hidden id="write-preview"><h2>阅读预览</h2><div class="prose"></div></div><p class="form-error" role="alert"></p></div>
  <div class="editor-bottom"><span id="draft-status" class="small-note">${editing?(store.editDraft(route.id)?'已恢复上次未保存的修改':'修改将自动保存在本机'):(store.state.draft?'已恢复本机草稿':'草稿将自动保存在本机')}</span><div><button type="button" class="btn secondary" data-action="preview">预览</button>${editing?'<button type="button" class="btn secondary" data-action="cancel-edit">取消编辑</button>':'<button type="button" class="btn secondary save-button" data-action="save-draft">存草稿</button>'}<button class="btn" type="submit">${editing?'保存修改':'发布给成员'} ${icon('arrow')}</button></div></div>
  <p class="editor-disclaimer">${editing?'保存后对受邀成员可见。未保存的修改仅留在当前浏览器。':'发布内容对受邀成员可见。草稿仅保存在当前浏览器。'}${editing&&store.commentsFor(route.id).some(c=>c.anchor)?' 无法定位的旧批注会保留引用与讨论。':''}</p></form></section>`;
}
function aboutPage(){return `<div class="about-page"><a class="back-link" href="#/articles">${icon('back')}返回阅读</a><h1>关于社区</h1><p class="about-lede">供中文数学研究者分享文章、译文和研究日常的受邀社区。</p><div class="prose"><h2>内测社区的约定</h2><ul><li>文章、动态、评论和成员资料仅对已登录的受邀成员开放。请勿未经作者同意向外转发。</li><li>使用邮箱账号与持续的社区身份，不强制使用真实姓名。</li><li>成员直接发表，编辑另行挑选精选、整理专题。</li><li>讨论观点和论证，尊重不同的经验，保护他人的私人信息。</li><li>允许 AI 辅助编辑与翻译；实质性使用需要说明，作者对内容负责。不接受自动化批量发帖。</li><li>译文集中在“译文”区，保留原作者、译者与来源，并注明翻译或转载授权。仅推荐原文时，可以使用“推荐文章”发表自己的导读和链接。</li></ul><h2 id="sources">关于受邀内测</h2><p>社区使用邮箱和密码登录。管理员通过邀请链接邀请成员，账号、文章、回复、关注和收藏保存到共享数据库；未发布的草稿仅保存在当前浏览器。邮箱只对本人和管理员可见，不显示在成员主页。多人邀请链接允许受邀者自行填写邮箱，也可限定邀请某个邮箱。注册时暂不验证邮箱。忘记密码时，可在登录页查看找回方式；无法使用邮件找回时，请联系管理员核实身份并获取恢复链接。</p><p>网站界面由 AI 协助制作。成员发布的内容由各自作者署名并负责。</p><h2>三个参考方向</h2><p><a href="https://proofsandprompts.com/" target="_blank" rel="noopener noreferrer">Proofs and Prompts</a> 的研究者写作，<a href="https://www.bananaspace.org/" target="_blank" rel="noopener noreferrer">香蕉空间</a> 的数学资料积累，以及 <a href="https://joinmastodon.org/" target="_blank" rel="noopener noreferrer">Mastodon</a> 的关注、短动态与回复体验。在这个社区中，它们通过文章、动态和专题连接在一起。</p></div><a class="btn" href="#/articles">开始阅读 ${icon('arrow')}</a></div>`;}
function notFound(){return empty('这一页暂时找不到','链接可能有误，或内容已经被作者／管理员隐藏。','<a class="btn secondary" href="#/articles">回到文章首页</a>');}

function render(preserve=false){
  annotations?.destroy();annotations=null;
  const y=scrollY;route=readRoute();
  const locked=!store.state.me&&!['login','join','forgot','recover','about'].includes(route.path);
  const pages={login:loginPage,join:joinPage,forgot:forgotPage,recover:recoverPage,account:accountPage,admin:adminPage,articles:articlesPage,translations:translationsPage,feed:feedPage,topics:topicsPage,post:postPage,people:profilePage,me:profilePage,bookmarks:bookmarksPage,write:composePage,edit:composePage,about:aboutPage};
  app.innerHTML=header()+`<main id="main" class="page ${route.path==='post'?'reading-page':''}" tabindex="-1">${routeError?empty('暂时无法打开',routeError,'<button class="btn secondary" data-action="refresh">重新连接</button>'):(locked?loginPage:(pages[route.path]||notFound))()}</main>`+footer();
  document.title=locked?'受邀内测 · ChalkEcho':route.path==='articles'?'ChalkEcho · 中文数学社区':(route.path==='post'?(store.post(route.id)?(store.post(route.id).title||'一则研究动态'):'内容未找到'):({login:'邮箱登录',join:'受邀加入',forgot:'找回密码',recover:'设置新密码',account:'我的账号',admin:'管理社区',articles:'文章',translations:'译文',feed:'同行动态',topics:'共同阅读',write:'写一点',edit:'编辑内容',bookmarks:'我的收藏',people:store.member(route.id).name,me:'我的主页',about:'关于社区'}[route.path]||'页面未找到'))+' · ChalkEcho';
  const prose=document.querySelector('.article-prose'),post=store.post(route.id);
  if(prose&&post&&post.kind!=='note'&&store.state.me)annotations=initAnnotations({
    root:prose,post,comments:store.commentsFor(post.id),me:store.state.me,member:id=>store.member(id),notify,
    onSubmit:async({body,replyTo,anchor})=>{await store.comment(post.id,body,replyTo,anchor);return store.commentsFor(post.id);},
    onEdit:async({id,body,expectedRevision})=>{await store.updateComment(id,body,expectedRevision);return store.commentsFor(post.id);},
    onHide:async(id)=>{await store.moderate('comment',id);await store.loadPost(post.id);return store.commentsFor(post.id);},
  });
  if(route.path==='forgot')updateForgotCountdown();
  if(preserve)window.scrollTo(0,y);
  else if(route.params.get('section'))requestAnimationFrame(()=>scrollToId(route.params.get('section')));
  else window.scrollTo(0,0);
}
function notify(message){const el=document.querySelector('#toast');clearTimeout(toastTimer);el.textContent=message;el.hidden=false;toastTimer=setTimeout(()=>el.hidden=true,4500);}
function scrollToId(id){const el=document.getElementById(id);if(el)el.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});}
function modal(title,body,buttons){dialog.innerHTML=`<button class="dialog-close icon-button" data-action="close-dialog" aria-label="关闭">${icon('close')}</button><h2 id="dialog-title">${esc(title)}</h2>${body}<div class="dialog-buttons">${buttons}</div>`;dialog.showModal();}
function memberAction(action){if(store.state.me){Promise.resolve().then(action).catch(error=>notify(error.message));return;}pendingMemberAction=action;location.hash='#/login';}
function goWrite(kind){memberAction(()=>{if(route.path==='write'&&kind){composer={...(composer||draftDefaults()),kind};render(true);}else location.hash='#/write'+(kind?'?kind='+kind:'');});}
function collectDraft(){const f=document.querySelector('#publish-form');if(!f||f.dataset.editorTarget!==composerTarget)return composer;const data=Object.fromEntries(new FormData(f));composer={...composer,...data};return composer;}
function saveDraft(){const form=document.querySelector('#publish-form');if(!composer||!form||form.dataset.editorTarget!==composerTarget||composerTarget!==(route.path==='edit'?route.id:'new')||store.state.role!=='member')return;const value={...collectDraft()};if(route.path==='edit')store.saveEditDraft(route.id,value);else store.saveDraft(value);const el=document.querySelector('#draft-status');if(el)el.textContent=store.persistent?(route.path==='edit'?'修改已暂存本机，尚未更新原文':'草稿已保存在本机'):'当前浏览器无法保存，请复制保留修改';}
function formError(form,error){form.querySelector('.form-error').textContent=error.message||String(error);}

document.addEventListener('click',async e=>{
  const menu=document.querySelector('.account-menu');
  if(menu?.open&&(!e.target.closest('.account-menu')||e.target.closest('.account-menu a')))menu.open=false;
  const anchor=e.target.closest('a');
  if(anchor?.hasAttribute('data-scroll')){e.preventDefault();scrollToId(anchor.dataset.scroll);return;}
  const fragment=anchor?.getAttribute('href');
  if(fragment?.startsWith('#')&&!fragment.startsWith('#/')&&document.getElementById(fragment.slice(1))){e.preventDefault();scrollToId(fragment.slice(1));return;}
  if(e.target.closest('[data-annotation-open]')){annotations?.open(e.target.closest('[data-annotation-open]'));return;}
  const control=e.target.closest('[data-action]');if(!control)return;
  const {action,id}=control.dataset;
  if(action==='source-info'){e.preventDefault();location.hash='#/about?section=sources';return;}
  if(action==='close-dialog'){if(dialog.querySelector('form[data-busy]'))return;pendingMemberAction=null;commentEdit=null;dialog.close();return;}
  if(action==='join')return memberAction(()=>{render(true);document.querySelector('#comment-body')?.focus();});
  if(action==='role'){location.hash=store.state.me?'#/account':'#/login';return;}
  if(action==='write')return goWrite();
  if(action==='write-note')return goWrite('note');
  if(action==='write-link')return goWrite('link');
  if(action==='write-translation')return goWrite('translation');
  if(action==='follow'||action==='bookmark')return memberAction(async()=>{await store[action](id);render(true);const same=Array.from(document.querySelectorAll(`[data-action="${action}"]`)).find(el=>el.dataset.id===id);same?.focus({preventScroll:true});notify(action==='follow'?(store.state.following.includes(id)?'已关注，可在“我的关注”查看动态。':'已取消关注。'):(store.state.bookmarks.includes(id)?'已收藏。下次不用翻遍浏览记录了。':'已取消收藏。'));});
  if(action==='reply')return memberAction(()=>{replyTo=id;render(true);document.querySelector('#comment-body')?.focus();});
  if(action==='cancel-reply'){replyTo=null;render(true);return;}
  if(action==='cancel-edit'&&route.path==='edit'){clearTimeout(saveTimer);store.saveEditDraft(route.id,null);composer=null;composerTarget=null;location.hash=href('post',route.id);return;}
  if(action==='reload-edit'){modal('载入最新内容？','<p>编辑框中的修改将被替换。请先复制需要保留的文字。</p>','<button class="btn secondary" data-action="close-dialog">继续编辑</button><button class="btn" data-action="confirm-reload-edit">载入最新内容</button>');return;}
  if(action==='confirm-reload-edit'&&route.path==='edit'){const target=route.id,account=meId;control.disabled=true;try{await store.loadPost(target);if(route.path!=='edit'||route.id!==target||meId!==account||!dialog.open||!control.isConnected)return;store.saveEditDraft(target,null);composer=null;dialog.close();render(true);}catch(error){notify(error.message);control.disabled=false;}return;}
  if(action==='edit-comment'){const c=store.comments.find(c=>c.id===id);if(!c||c.authorId!==meId)return;commentEdit={id,publicationId:c.publicationId,expectedRevision:c.revision||1};modal('编辑评论',`<form id="edit-comment-form" class="comment-form"><label for="edit-comment-body">评论内容</label><textarea id="edit-comment-body" name="body" rows="5" maxlength="5000" required>${esc(c.body)}</textarea><p class="form-error" role="alert"></p><div class="dialog-buttons"><button type="button" class="btn secondary" data-action="close-dialog">取消</button><button class="btn" type="submit">保存修改</button></div></form>`,'');document.querySelector('#edit-comment-body')?.focus();return;}
  if(action==='kind'){saveDraft();composer.kind=id;store.saveDraft({...composer});render(true);return;}
  if(action==='save-draft'){saveDraft();notify(store.persistent?'草稿已保存在当前浏览器。可以放心去倒杯水。':'浏览器存储不可用，请先复制内容保留。');return;}
  if(action==='preview'){const c=collectDraft();const panel=document.querySelector('#write-preview');panel.hidden=!panel.hidden;control.textContent=panel.hidden?'预览':'收起预览';if(!panel.hidden){panel.querySelector('.prose').innerHTML=draftPreview(c);panel.scrollIntoView({behavior:'smooth',block:'start'});}return;}
  if(action==='writing-help'){modal('让文字与公式一起表达',`<div class="prose"><p>使用 Markdown 写小标题、列表、链接和脚注。</p><pre>## 一个小标题\n\n- 一个想法\n- 另一个问题\n\n[原文](https://example.org)\n\n这里有一条脚注。[^1]\n[^1]: 脚注内容。</pre><p>行内公式用 <code>$...$</code>，独立公式用 <code>$$...$$</code>。代码块中的内容保持原样。</p><pre>$a^2+b^2=c^2$\n\n$$\n\\int_M f\\,dV\n$$</pre><p class="small-note">图片上传暂未开放；可以用链接推荐外部图文内容。</p></div>`,'<button class="btn" data-action="close-dialog">开始写作</button>');return;}
  if(action==='share-profile'){
    const m=store.profile?.member;if(!m)return;
    const url=new URL(location.href);url.search='';url.hash=href('people',m.id);
    try{await navigator.clipboard.writeText(url.href);notify('主页链接已复制，受邀成员登录后可查看。');}
    catch{modal('复制个人主页链接',`<label for="profile-share-url">选中下方链接复制</label><input id="profile-share-url" readonly value="${esc(url.href)}"><p class="small-note">仅受邀成员登录后可以查看主页。</p>`,'<button class="btn" data-action="close-dialog">完成</button>');document.querySelector('#profile-share-url').select();}return;
  }
  if(action==='share'){try{await navigator.clipboard.writeText(location.href.split('?')[0]);notify('链接已复制，受邀成员登录后可阅读。');}catch{modal('复制这篇内容的链接',`<label for="share-url">选中下方链接复制</label><input id="share-url" readonly value="${esc(location.href.split('?')[0])}"><p class="small-note">仅受邀成员登录后才能阅读这条内容。</p>`,'<button class="btn" data-action="close-dialog">完成</button>');document.querySelector('#share-url').select();}return;}
});
document.addEventListener('submit',async e=>{
  const f=e.target;if(!['search-form','translation-search-form','publish-form','comment-form','edit-comment-form'].includes(f.id))return;e.preventDefault();
  if(f.id==='translation-search-form'){const q=new FormData(f).get('q').trim(),category=route.params.get('category');location.hash=queryLink({...(q?{q}:{}),...(category?{category}:{})},'translations');return;}
  if(f.id==='search-form'){const q=new FormData(f).get('q').trim();location.hash=queryLink(q?{q}:{});return;}
  if(f.dataset.busy)return;const startRoute=location.hash;const submission=f.id==='publish-form'?{...collectDraft()}:Object.fromEntries(new FormData(f));if(f.id==='publish-form')saveDraft();f.dataset.busy='true';const fields=[...f.querySelectorAll('input,textarea,select,button')].map(el=>[el,el.disabled]);fields.forEach(([el])=>el.disabled=true);
  try{
    if(f.id==='publish-form'){clearTimeout(saveTimer);const editing=route.path==='edit',input=submission;const p=editing?await store.updatePost(route.id,input,input.expectedRevision):await store.publish(input);if(!p)return;if(!f.isConnected||location.hash!==startRoute){notify(editing?'修改已保存。':'内容已发布。');return;}composer=null;composerTarget=null;location.hash=href('post',p.id);notify(editing?'修改已保存。':'已发布，其他受邀成员登录后可以看到。');}
    if(f.id==='edit-comment-form'){const context=commentEdit;if(!context)return;const c=await store.updateComment(context.id,submission.body,context.expectedRevision);if(!c||commentEdit!==context)return;commentEdit=null;dialog.close();render(true);notify('评论已更新。');}
    if(f.id==='comment-form'){await store.comment(route.id,submission.body,replyTo);replyTo=null;render(true);notify('回复已发表，其他受邀成员可以看到。');}
  }catch(error){formError(f,error);if(f.id==='publish-form'&&route.path==='edit'&&f.isConnected&&error.status===409){const notice=document.querySelector('.edit-conflict');if(notice)notice.hidden=false;}}finally{delete f.dataset.busy;fields.forEach(([el,disabled])=>el.disabled=disabled);}
});
document.addEventListener('input',e=>{if(e.target.id==='recovery-email'){forgotState.email=e.target.value;forgotState.sent=false;const status=document.querySelector('#forgot-form .recovery-status');if(status)status.textContent='';updateForgotCountdown();}if(e.target.closest('#publish-form')){collectDraft();clearTimeout(saveTimer);saveTimer=setTimeout(saveDraft,500);const status=document.querySelector('#draft-status');if(status)status.textContent='正在保存草稿…';const preview=document.querySelector('#write-preview');if(preview&&!preview.hidden)preview.querySelector('.prose').innerHTML=draftPreview(composer);}});
document.addEventListener('change',e=>{if(e.target.closest('#publish-form'))saveDraft();});
window.addEventListener('hashchange',async()=>{clearTimeout(saveTimer);if(editorRoute(route.path)){saveDraft();document.querySelector('#publish-form')?.setAttribute('inert','');}commentEdit=null;dialog.close();const next=readRoute();if(route.path==='join')document.querySelector('#join-form')?.setAttribute('inert','');if(next.path!=='join'||next.params.get('invite')!==joinState.token){joinLoad++;joinState={token:'',data:null,error:'',retry:false};}if(next.path!=='forgot'){clearTimeout(forgotTimer);recoveryLoad++;forgotState={email:'',sent:false,retryAt:0};}if(next.path!==route.path||next.id!==route.id){composer=null;composerTarget=null;}if(next.path!=='post'||next.id!==route.id)replyTo=null;await loadRoute();render();document.querySelector('#main')?.focus({preventScroll:true});});
document.addEventListener('keydown',e=>{const menu=document.querySelector('.account-menu');if(e.key==='Escape'&&menu?.open){menu.open=false;menu.querySelector('summary').focus();}});
window.addEventListener('pagehide',saveDraft);
dialog.addEventListener('cancel',event=>{if(dialog.querySelector('form[data-busy]')){event.preventDefault();return;}pendingMemberAction=null;commentEdit=null;});
let adminData=null,latestInvite=null,latestRecovery='',routeError='',syncing=false;
let joinState={token:'',data:null,error:'',retry:false},joinLoad=0;
const loadMore=()=>store.hasMore?'<div class="load-more"><button class="btn secondary" data-action="load-more">加载更早的内容</button></div>':'';
function accountFrame(title,lede,body){return `<section class="account-panel"><h1>${title}</h1><p class="account-lede">${lede}</p>${body}</section>`;}
const passwordFields=(confirm=false)=>`<label for="account-password">${confirm?'设置密码':'密码'}</label><input id="account-password" name="password" type="password" minlength="12" maxlength="128" autocomplete="${confirm?'new-password':'current-password'}" required>${confirm?'<p class="small-note">至少 12 个字符，建议使用密码管理器生成。</p>':''}${confirm?'<label for="account-confirm">再次输入密码</label><input id="account-confirm" name="confirm" type="password" minlength="12" maxlength="128" autocomplete="new-password" required>':''}`;
function loginPage(){if(store.state.me)return accountPage();return accountFrame('邮箱登录','受邀成员登录后可阅读与发布。',`<form id="login-form" class="account-form"><label for="account-email">邮箱</label><input id="account-email" name="email" type="email" autocomplete="email" maxlength="254" required>${passwordFields()}<p class="form-error" role="alert"></p><button class="btn" type="submit">登录并进入</button></form><div class="account-note"><p>注册请向管理员索取邀请链接。</p><p><a href="#/forgot">忘记密码？</a></p></div>`);}
function joinPage(){
  if(store.state.me)return accountFrame('你已经登录','需要使用其他账号接受邀请时，请先退出当前账号。','<a class="btn secondary" href="#/account">管理当前账号</a>');
  const invite=route.params.get('invite')||'';
  if(!invite)return accountFrame('受邀加入','请通过管理员提供的邀请链接打开本页。','<a class="btn secondary" href="#/login">已有账号，去登录</a>');
  if(joinState.token!==invite||(!joinState.data&&!joinState.error))return accountFrame('受邀加入','正在验证邀请链接…','');
  if(joinState.error)return accountFrame('邀请链接不可用',esc(joinState.error),`<div class="account-note recovery-links"><a href="#/login">返回登录</a>${joinState.retry?'<button type="button" class="text-button" data-action="retry-join">重新检查</button>':''}</div>`);
  const email=joinState.data.email||'',bound=joinState.data.kind==='member'||!!email;
  return accountFrame('创建账号',bound?'邮箱不会显示在成员主页。':'填写自己的邮箱，加入社区。邮箱不会显示在成员主页。',`<form id="join-form" class="account-form" data-invite="${esc(invite)}"><label for="account-name">成员昵称</label><input id="account-name" name="name" autocomplete="nickname" maxlength="40" required><label for="account-email">${bound?'受邀邮箱':'邮箱'}</label><input id="account-email" name="email" type="email" autocomplete="email" maxlength="254" value="${esc(email)}" ${bound?'readonly':''} required>${passwordFields(true)}<p class="small-note">请使用独立密码，不要填写邮箱本身的密码。</p><p class="form-error" role="alert"></p><button class="btn" type="submit">创建账号并加入</button></form><p class="account-note">请阅读<a href="#/about">社区约定</a>。发布的文章与讨论成员可见。</p>`);
}
let recoveryStatus=null,recoveryStatusError='',recoveryLoad=0,forgotTimer;
let forgotState={email:'',sent:false,retryAt:0};
const recoveryMessage='申请已提交。如果该邮箱对应可用的社区账号，你会收到重置密码邮件。请检查收件箱或垃圾邮件。';
function forgotPage(){
  const available=recoveryStatus===true;
  const unavailable=recoveryStatusError||(recoveryStatus===false?'邮件找回暂不可用，请联系管理员获取恢复链接。':'正在连接邮件服务…');
  if(!available)return accountFrame('找回密码',esc(unavailable),'<div class="account-note recovery-links"><a href="#/login">返回登录</a><button type="button" class="text-button" data-action="retry-recovery-status">重新检查</button></div>');
  return accountFrame('找回密码','输入注册时使用的邮箱。',`<form id="forgot-form" class="account-form"><label for="recovery-email">邮箱</label><input id="recovery-email" name="email" type="email" autocomplete="email" maxlength="254" value="${esc(forgotState.email)}" required><p class="recovery-status" role="status">${forgotState.sent?recoveryMessage:''}</p><p class="form-error" role="alert"></p><button class="btn" type="submit">发送重置邮件</button></form><div class="account-note"><a href="#/login">返回登录</a></div>`);
}
function updateForgotCountdown(){
  clearTimeout(forgotTimer);const form=document.querySelector('#forgot-form'),button=form?.querySelector('[type=submit]');if(!button||form.dataset.busy)return;
  const remaining=Math.max(0,Math.ceil((forgotState.retryAt-Date.now())/1000));button.disabled=recoveryStatus!==true||remaining>0;button.textContent=remaining?`${remaining} 秒后可重发`:forgotState.sent?'重新发送':'发送重置邮件';
  if(remaining)forgotTimer=setTimeout(updateForgotCountdown,1000);
}
function recoverPage(){const token=route.params.get('token');if(!token||token.length>200||route.params.has('error'))return accountFrame('重置链接不可用','请重新申请重置邮件，或联系管理员获取恢复链接。','<a class="btn" href="#/forgot">重新获取链接</a><p class="account-note"><a href="#/login">返回登录</a></p>');return accountFrame('设置新密码','完成后，原有登录会话会失效。',`<form id="recover-form" class="account-form">${passwordFields(true)}<p class="form-error" role="alert"></p><button class="btn" type="submit">设置新密码</button></form><p class="account-note">链接已过期？<a href="#/forgot">重新获取链接</a></p>`);}
function accountPage(){const m=store.state.me;if(!m)return loginPage();const profile=store.member(m.id);return accountFrame('我的账号',`登录邮箱：${esc(m.email)}`,`<div class="account-toolbar"><a class="btn secondary" href="#/me">我的主页</a>${m.role==='admin'?'<a class="btn" href="#/admin">管理社区</a>':''}<button class="text-button" data-action="logout">退出登录</button></div><form id="profile-form" class="account-form"><h2>个人主页资料</h2><p class="small-note">昵称、研究领域与个人简介会展示在你的主页上，邮箱不会展示。</p><label for="account-name">昵称</label><input id="account-name" name="name" value="${esc(m.name)}" maxlength="40" required><label for="account-field">研究领域</label><input id="account-field" name="field" value="${esc(profile.field)}" maxlength="100"><label for="account-bio">个人简介 <span class="optional">最多 500 字</span></label><textarea id="account-bio" name="bio" rows="3" maxlength="500">${esc(profile.bio)}</textarea><p class="form-error" role="alert"></p><button class="btn" type="submit">保存资料</button></form><details class="account-security"><summary>修改密码</summary><form id="password-form" class="account-form"><label for="current-password">当前密码</label><input id="current-password" name="currentPassword" type="password" autocomplete="current-password" required>${passwordFields(true)}<p class="form-error" role="alert"></p><button class="btn secondary" type="submit">更新密码</button></form></details>`);}
function generatedLink(url,kind,title,note){return `<div class="invite-result" id="generated-${kind}" role="status"><label for="generated-link-${kind}">${title}</label><input id="generated-link-${kind}" aria-label="${title}" readonly value="${esc(url)}"><button class="btn secondary small" data-action="copy-invite" data-link-kind="${kind}">复制链接</button><p class="small-note">${note}</p></div>`;}
function inviteResult(kind){return latestInvite?.kind===kind?generatedLink(latestInvite.url,kind,kind==='shared'?'多人邀请链接':'指定邮箱邀请链接','以后也可在邀请记录中复制。'):'';}
function invitationRow(invite){
  const shared=invite.kind==='shared',used=Number(invite.useCount||0),consumed=!shared&&!!invite.usedBy;
  const expired=invite.expiresAt<=Date.now();
  const status=invite.revokedAt?'已停用':expired?'已过期':consumed?'已使用':'有效';
  const until=new Date(invite.expiresAt).toLocaleDateString('zh-CN',{year:'numeric',month:'numeric',day:'numeric'});
  return `<div class="admin-row"><div><strong>${esc(shared?(invite.label||'多人邀请'):invite.email)}</strong><small>${shared?`已注册 ${used} 人`:'指定邮箱 · 单次使用'} · ${status} · ${esc(until)} 到期</small></div>${!invite.revokedAt&&!expired&&!consumed?`<div class="admin-actions"><button class="btn secondary small" data-action="${invite.url?'copy-history-invite':'reissue-invite'}" data-id="${esc(invite.id)}">${invite.url?'复制链接':'重新生成链接'}</button><button class="text-button" data-action="revoke-invite" data-id="${esc(invite.id)}">停用</button></div>`:''}</div>`;
}
function adminPage(){
  if(!store.state.me)return loginPage();
  if(store.state.me.role!=='admin')return empty('仅管理员可使用','你的成员账号仍然可以发表文章和回复。');
  if(!adminData)return empty('正在读取管理信息','请稍候。');
  return `<section class="admin-panel"><div class="page-intro compact"><div><h1>管理社区</h1></div><a href="#/account" class="btn secondary">我的账号</a></div>
  <section class="admin-section"><h2>多人邀请链接</h2><p>收到链接的人可自行填写邮箱注册。</p>
  <form id="shared-invite-form" class="account-form"><label for="invite-label">备注 <span class="optional">选填，仅管理员可见</span></label><input id="invite-label" name="label" maxlength="60" placeholder="例如：读书小组"><label for="invite-days">有效天数</label><input id="invite-days" name="expiresInDays" type="number" min="1" max="365" step="1" value="7" required><p class="form-error" role="alert"></p><button class="btn" type="submit">生成多人邀请链接</button></form>${inviteResult('shared')}
  <details class="specific-invite" ${latestInvite?.kind==='member'?'open':''}><summary>指定邮箱邀请</summary><p class="small-note">只允许指定邮箱注册，7 天内有效，使用一次后失效。</p><form id="invite-form" class="account-form invite-form"><label for="invite-email">受邀者邮箱</label><div class="invite-input"><input id="invite-email" name="email" type="email" maxlength="254" required placeholder="colleague@example.com"><button class="btn secondary" type="submit">生成邀请链接</button></div><p class="form-error" role="alert"></p></form>${inviteResult('member')}</details></section>
  <section class="admin-section"><h2>邀请记录</h2>${adminData.invites.length?adminData.invites.map(invitationRow).join(''):'<p class="small-note">还没有邀请记录。</p>'}</section>
  <section class="admin-section"><h2>社区成员</h2>${latestRecovery?generatedLink(latestRecovery,'recovery','密码恢复链接','1 小时内有效。请核实身份后私下转交给本人。'):''}${adminData.users.map(u=>`<div class="admin-row"><div><strong>${esc(u.name)}</strong><small>${esc(u.email)} · ${u.role==='admin'?'管理员':u.status==='active'?'成员':'已暂停'}</small></div><div class="admin-actions">${u.status==='active'?`<button class="btn secondary small" data-action="recovery-link" data-id="${esc(u.id)}">密码恢复链接</button>`:''}${u.role!=='admin'?`<button class="text-button" data-action="${u.status==='active'?'suspend-member':'restore-member'}" data-id="${esc(u.id)}">${u.status==='active'?'暂停参与':'恢复参与'}</button>`:''}</div></div>`).join('')}</section>
  <section class="admin-section"><h2>已隐藏的内容</h2><p class="small-note">隐藏后不向成员展示，可以在这里恢复。</p>${[...adminData.hiddenPosts.map(p=>({...p,type:'post'})),...adminData.hiddenComments.map(c=>({...c,type:'comment'}))].map(p=>`<div class="admin-row"><div><strong>${esc(p.title||p.body.slice(0,80))}</strong><small>${p.type==='comment'?'回复':'文章／动态'}</small></div><button class="btn secondary small" data-action="restore-${p.type}" data-id="${esc(p.id)}">恢复展示</button></div>`).join('')||'<p class="small-note">没有隐藏的内容。</p>'}</section></section>`;
}
async function loadRoute(){route=readRoute();routeError='';if(route.path==='join'&&!store.state.me){const invite=route.params.get('invite')||'',request=++joinLoad;joinState={token:invite,data:null,error:'',retry:false};if(!invite)return;try{const info=await api('/session/invite',{invite});const current=readRoute();if(request===joinLoad&&current.path==='join'&&current.params.get('invite')===invite)joinState={token:invite,data:info,error:'',retry:false};}catch(error){const current=readRoute();if(request===joinLoad&&current.path==='join'&&current.params.get('invite')===invite)joinState={token:invite,data:null,error:error.message,retry:!error.status||error.status>=500};}return;}if(route.path==='forgot'){const request=++recoveryLoad;try{const status=await api('/session/recovery-status');if(request===recoveryLoad&&readRoute().path==='forgot'){recoveryStatus=status.enabled===true;recoveryStatusError='';}}catch(error){if(request===recoveryLoad&&readRoute().path==='forgot'){recoveryStatus=null;recoveryStatusError='暂时无法连接，请稍后重试，或联系管理员获取恢复链接。';}}return;}if(!store.state.me)return;try{if((route.path==='post'||route.path==='edit')&&route.id)await store.loadPost(route.id);if((route.path==='people'&&route.id)||route.path==='me')await store.loadProfile(profileId(),profileTab());if(route.path==='translations')await store.loadTranslations(Object.fromEntries(route.params));if(route.path==='bookmarks'&&store.state.me)await store.loadBookmarks();if(route.path==='admin'&&store.state.me?.role==='admin')adminData=await api('/admin');}catch(error){routeError=error.message;}}
async function sync(manual=false){if(syncing)return;syncing=true;try{await store.refresh();await loadRoute();if(manual||!annotations?.isBusy())render(true);if(manual)notify('已同步最新内容。');}catch(error){const el=document.querySelector('#sync-status');if(el){el.hidden=false;el.textContent='连接中断，请刷新重试。';}if(manual)notify(error.message);}finally{syncing=false;}}
async function start(){app.innerHTML='<main class="page"><div class="empty-state"><h1>正在加载…</h1></div></main>';try{await store.refresh();await loadRoute();render();}catch(error){routeError=error.message;render();}}
function formValues(form){const b=Object.fromEntries(new FormData(form));if('confirm' in b&&b.confirm!==b.password)throw new Error('两次输入的密码不一致。');return b;}

document.addEventListener('submit',async e=>{
  const f=e.target;if(!['login-form','join-form','forgot-form','recover-form','profile-form','password-form','invite-form','shared-invite-form'].includes(f.id))return;e.preventDefault();if(f.dataset.busy)return;f.dataset.busy='true';const submit=f.querySelector('[type=submit]');submit.disabled=true;f.querySelector('.form-error').textContent='';
  try{
    const b=formValues(f),startHash=location.hash;
    if(f.id==='forgot-form'){if(recoveryStatus!==true||forgotState.retryAt>Date.now())return;const input=f.querySelector('[name=email]');input.readOnly=true;try{await api('/session/forgot',{email:b.email});if(!f.isConnected||location.hash!==startHash)return;forgotState={email:b.email,sent:true,retryAt:Date.now()+60000};render(true);}finally{input.readOnly=false;}}
    if(f.id==='login-form'||f.id==='join-form'){
      const destination=!authRoute(route.path)?location.hash:'#/articles';
      if(f.id==='join-form'){const invite=f.dataset.invite;if(!invite||joinState.token!==invite||!joinState.data||route.params.get('invite')!==invite)throw new Error('邀请状态已变化，请重新打开邀请链接。');await store.register({...b,invite});}else await store.login(b);
      if(!f.isConnected||location.hash!==startHash){await loadRoute();render();return;}
      composer=null;const next=pendingMemberAction;pendingMemberAction=null;history.replaceState(null,'',location.pathname+destination);await loadRoute();render();if(next)await next();notify(f.id==='join-form'?'账号建好了，欢迎加入讨论。':'已登录。欢迎回来，接着聊。');
    }
    if(f.id==='recover-form'){const token=route.params.get('token');await api('/session/reset',{token,password:b.password});if(!f.isConnected||location.hash!==startHash)return;history.replaceState(null,'',location.pathname+'#/login');await store.refresh();render();notify('密码已更新，请使用新密码登录。');}
    if(f.id==='profile-form'){await api('/profile',b,'PATCH');await store.refresh();render(true);notify('资料已更新，同行更容易认识你了。');}
    if(f.id==='password-form'){await api('/auth/change-password',{currentPassword:b.currentPassword,newPassword:b.password,revokeOtherSessions:true});f.reset();notify('密码已更新，其他设备已退出登录。');}
    if(f.id==='invite-form'||f.id==='shared-invite-form'){
      const account=meId,kind=f.id==='shared-invite-form'?'shared':'member';
      const input=kind==='shared'?{kind,label:b.label,expiresInDays:Number(b.expiresInDays)}:{email:b.email};
      const data=await api('/admin/invites',input);if(account!==meId||store.state.me?.role!=='admin')return;
      latestInvite={...data,kind};if(readRoute().path==='admin'){render(true);scrollToId('generated-'+kind);notify('邀请链接已生成，请复制保存。');}
      let fresh;try{fresh=await api('/admin');}catch{if(account===meId&&readRoute().path==='admin')notify('邀请链接已生成，请复制保存。邀请记录暂时未刷新。');return;}
      if(account!==meId||store.state.me?.role!=='admin')return;adminData=fresh;if(readRoute().path==='admin')render(true);
    }
  }catch(error){if(f.isConnected)formError(f,error);}finally{delete f.dataset.busy;submit.disabled=false;if(f.id==='forgot-form')updateForgotCountdown();}
});
document.addEventListener('click',async e=>{
  const el=e.target.closest('[data-action]');if(!el)return;const {action,id}=el.dataset;
  const known=['retry-join','retry-recovery-status','refresh','load-more','load-translations','load-profile','logout','copy-invite','copy-history-invite','reissue-invite','confirm-reissue-invite','hide-post','hide-comment','confirm-hide','revoke-invite','recovery-link','suspend-member','restore-member','restore-post','restore-comment'];if(!known.includes(action))return;if(el.disabled)return;
  el.disabled=true;
  try{
    if(action==='retry-join'){await loadRoute();if(readRoute().path==='join')render(true);}
    if(action==='retry-recovery-status'){await loadRoute();if(readRoute().path==='forgot')render(true);}
    if(action==='refresh')await sync(true);
    if(action==='load-more'){await store.more();render(true);}
    if(action==='load-translations'){await store.loadTranslations(Object.fromEntries(route.params),true);render(true);}
    if(action==='load-profile'){await store.loadProfile(profileId(),profileTab(),true);render(true);}
    if(action==='logout'){saveDraft();await store.logout();composer=null;latestInvite=null;latestRecovery='';adminData=null;location.hash='#/articles';render();notify('已退出登录。');}
    if(action==='copy-invite'){const kind=el.dataset.linkKind,url=kind==='recovery'?latestRecovery:latestInvite?.kind===kind?latestInvite.url:'';if(!url)return;try{await navigator.clipboard.writeText(url);notify('链接已复制。');}catch{document.querySelector('#generated-link-'+kind)?.select();notify('请选中链接后复制。');}}
    if(action==='copy-history-invite'){const invite=adminData?.invites.find(item=>item.id===id);if(!invite?.url)return;try{await navigator.clipboard.writeText(invite.url);notify('链接已复制。');}catch{modal('邀请链接',`<div class="invite-result"><input id="history-invite-link" aria-label="邀请链接" readonly value="${esc(invite.url)}"><p class="small-note">请选中链接后复制。</p></div>`,`<button class="btn secondary" data-action="close-dialog">关闭</button>`);document.querySelector('#history-invite-link')?.select();}}
    if(action==='reissue-invite'){modal('重新生成邀请链接？','<p>旧链接会立即失效，已加入的成员不受影响。注册人数和原到期时间保留。</p>',`<button class="btn secondary" data-action="close-dialog">取消</button><button class="btn" data-action="confirm-reissue-invite" data-id="${esc(id)}">重新生成</button>`);}
    if(action==='confirm-reissue-invite'){const account=meId,data=await api('/admin/reissue-invite',{id});if(account!==meId||store.state.me?.role!=='admin')return;dialog.close();latestInvite=data;adminData.invites=adminData.invites.map(invite=>invite.id===id?{...invite,url:data.url}:invite);if(readRoute().path==='admin'){render(true);scrollToId('generated-'+data.kind);notify('新链接已生成，旧链接已失效。');}const fresh=await api('/admin');if(account!==meId||store.state.me?.role!=='admin')return;adminData=fresh;if(readRoute().path==='admin')render(true);}
    if(action==='hide-post'||action==='hide-comment'){modal('隐藏这条内容？','<p>隐藏后，其他成员将无法看到。管理员可以恢复内容。</p>',`<button class="btn secondary" data-action="close-dialog">保留</button><button class="btn danger" data-action="confirm-hide" data-id="${esc(id)}" data-type="${action==='hide-post'?'post':'comment'}">隐藏内容</button>`);}
    if(action==='confirm-hide'){await store.moderate(el.dataset.type,id);dialog.close();if(el.dataset.type==='post')location.hash='#/articles';await loadRoute();render(true);notify('内容已隐藏。');}
    if(action==='revoke-invite'){const account=meId;await api('/admin/revoke',{id});if(account!==meId||store.state.me?.role!=='admin')return;if(latestInvite?.id===id)latestInvite=null;const fresh=await api('/admin');if(account!==meId||store.state.me?.role!=='admin')return;adminData=fresh;if(readRoute().path==='admin'){render(true);notify('邀请链接已停用，已加入的成员不受影响。');}}
    if(action==='recovery-link'){const account=meId;const data=await api('/admin/recovery',{id});if(account!==meId||store.state.me?.role!=='admin')return;latestRecovery=data.url;if(readRoute().path==='admin'){render(true);scrollToId('generated-recovery');notify('恢复链接已生成，1 小时内有效。请核实身份后私下转交。');}}
    if(action==='suspend-member'||action==='restore-member'){await api('/admin/member',{id,active:action==='restore-member'});adminData=await api('/admin');render(true);notify(action==='restore-member'?'已恢复成员权限。':'已暂停成员权限并退出其登录会话。');}
    if(action==='restore-post'||action==='restore-comment'){await store.moderate(action==='restore-post'?'post':'comment',id,true);adminData=await api('/admin');render(true);notify('内容已恢复展示。');}
  }catch(error){notify(error.message);}finally{el.disabled=false;}
});
setInterval(()=>{if(document.visibilityState==='visible'&&!annotations?.isBusy()&&!store.loadedMore&&!dialog.open&&!document.querySelector('.account-menu[open]')&&readRoute().path!=='admin'&&!editorRoute(readRoute().path)&&!authRoute(readRoute().path)&&!document.querySelector('input:focus,textarea:focus,select:focus')&&!document.querySelector('#comment-body')?.value)sync();},30000);
window.addEventListener('focus',()=>{if(!annotations?.isBusy()&&readRoute().path!=='admin'&&!editorRoute(readRoute().path)&&!authRoute(readRoute().path)&&!document.querySelector('input:focus,textarea:focus')&&!document.querySelector('#comment-body')?.value)sync();});

window.addEventListener('community-session-ending',saveDraft);
function clearPrivateUI(){clearTimeout(saveTimer);composer=null;composerTarget=null;commentEdit=null;adminData=null;latestInvite=null;latestRecovery='';joinLoad++;joinState={token:'',data:null,error:'',retry:false};replyTo=null;pendingMemberAction=null;routeError='';dialog.close();dialog.innerHTML='';render();}
window.addEventListener('community-session-cleared',clearPrivateUI);
window.addEventListener('community-session-expired',()=>{clearPrivateUI();notify('登录已失效，请重新登录。写作草稿仍保存在本机。');});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
await start();
