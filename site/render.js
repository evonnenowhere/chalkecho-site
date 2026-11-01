import {safeURL} from './store.js';
import {blockIdFor} from './annotation-anchor.js';
export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const date=value=>new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',timeZone:'Asia/Shanghai'}).format(new Date(value));

const paths={
  search:'<circle cx="10.8" cy="10.8" r="6.2"/><path d="m16 16 4.5 4.5"/>',
  translate:'<path d="M3 5h11M8 2v3M5 5c1 5 3 7 7 9M12 5c-1 5-4 9-9 11m10 5 4-11 4 11m-6.5-4h5"/>',
  chevron:'<path d="m7 10 5 5 5-5"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="m9 3-1 3-3 1-2 3 2 2-1 3 2 3 3-1 3 2 3-2 3 1 2-3-1-3 2-2-2-3-3-1-1-3z"/>',
  arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',
  external:'<path d="M14 4h6v6m0-6L10 14M10 5H5v14h14v-5"/>',
  bookmark:'<path d="M6 4h12v17l-6-4-6 4z"/>',
  comment:'<path d="M20 11.5a8 8 0 0 1-8 8H5l-3 2 1.7-5A8 8 0 1 1 20 11.5Z"/>',
  pen:'<path d="m15 4 5 5M4 20l5-1L20 8a2.2 2.2 0 0 0-5-5L4 15z"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  back:'<path d="M19 12H5m5-5-5 5 5 5"/>',
  book:'<path d="M12 5v16M3 3l9 3 9-3v15l-9 3-9-3z"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  reset:'<path d="M4 4v5h5M4.5 9a8 8 0 1 1 0 7"/>',
  copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/>',
  people:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2"/>',
};
export const icon=(name,cls='')=>`<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.arrow}</svg>`;
let parser;
function getParser(){
  if(parser)return parser;
  parser=globalThis.markdownit({html:false,linkify:false,breaks:false,typographer:true})
    .use(globalThis.markdownitFootnote)
    .use(globalThis.texmath,{engine:globalThis.katex,delimiters:['dollars','brackets'],katexOptions:{trust:false,throwOnError:false,maxSize:12,maxExpand:1000,strict:'ignore',errorColor:'#a33d39'}});
  parser.validateLink=url=>!!safeURL(url)||/^#[A-Za-z0-9_-]+$/.test(url);
  const defaultLink=parser.renderer.rules.link_open||((tokens,idx,opts,env,self)=>self.renderToken(tokens,idx,opts));
  parser.renderer.rules.link_open=(tokens,idx,opts,env,self)=>{
    if(safeURL(tokens[idx].attrGet('href'))){tokens[idx].attrSet('target','_blank');tokens[idx].attrSet('rel','noopener noreferrer');}
    return defaultLink(tokens,idx,opts,env,self);
  };
  parser.renderer.rules.image=(tokens,idx)=>`<span class="image-placeholder">[图片：${esc(tokens[idx].content)}]</span>`;
  parser.renderer.rules.heading_open=(tokens,idx,opts,env,self)=>{
    const id=`${env.docId}-section-${env.headings.length+1}`;
    tokens[idx].attrSet('id',id);
    env.headings.push({id,title:tokens[idx+1]?.content||'',level:tokens[idx].tag});
    return self.renderToken(tokens,idx,opts);
  };
  for (const type of ['math_block', 'math_block_eqno']) {
    const renderMath = parser.renderer.rules[type];
    if (!renderMath) continue;
    parser.renderer.rules[type] = (tokens, index, options, env, renderer) => {
      const html = renderMath(tokens, index, options, env, renderer);
      const blockId = tokens[index].attrGet('data-annotation-block');
      return blockId ? `<div class="annotation-math-block" data-annotation-block="${blockId}">${html}</div>` : html;
    };
  }
  parser.core.ruler.push('annotation_blocks', state => {
    if (!state.env.annotations) return;
    for (let index = 0; index < state.tokens.length; index++) {
      const token = state.tokens[index];
      if (!['paragraph_open', 'heading_open', 'math_block', 'math_block_eqno'].includes(token.type) || !token.map) continue;
      const id = blockIdFor(state.src, token.map[0], token.map[1]);
      if (!id) continue;
      token.attrSet('data-annotation-block', id);
      // Tight lists suppress paragraph tags. Retain their semantic wrapper so
      // each list paragraph has an independent selectable annotation target.
      if (token.hidden) {
        token.hidden = false;
        for (let close = index + 1; close < state.tokens.length; close++) {
          if (state.tokens[close].type === 'paragraph_close') { state.tokens[close].hidden = false; break; }
        }
      }
    }
  });
  return parser;
}
export function markdown(body,prefix='content',options={}){
  const env={docId:prefix.replace(/[^a-zA-Z0-9_-]/g,''),headings:[],annotations:options.annotations===true};
  try{return {html:getParser().render(String(body??''),env),headings:env.headings};}
  catch{return {html:`<p class="notice">这段内容暂时无法排版，以下保留原文。</p><pre>${esc(body)}</pre>`,headings:[]};}
}
