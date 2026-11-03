// Small DOM test double for exercising the actual app's rendering and events.
// It keeps element identity, form values and subtree replacement semantics;
// layout and browser rendering are verified separately in the preview.
const voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const decode=value=>String(value).replace(/&(amp|lt|gt|quot|#39);/g,(_,name)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[name]));
class Element {
  constructor(tag,attrs={},document=null){this.tagName=tag;this.attrs=attrs;this.document=document;this.parentNode=null;this.children=[];this.listeners=new Map();this.value=decode(attrs.value||'');this.hidden='hidden' in attrs;this.disabled='disabled' in attrs;this.open='open' in attrs;this.dataset=Object.fromEntries(Object.entries(attrs).filter(([key])=>key.startsWith('data-')).map(([key,value])=>[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase()),value]));}
  get id(){return this.attrs.id||'';}
  get className(){return this.attrs.class||'';}
  get isConnected(){let node=this;while(node.parentNode)node=node.parentNode;return node===this.document;}
  get textContent(){return this.tagName==='#text'?decode(this.text):this.children.map(node=>node.textContent).join('');}
  set textContent(value){const node=new Element('#text',{},this.document);node.text=String(value);node.parentNode=this;this.children=[node];}
  get innerHTML(){return this.children.map(node=>node.outerHTML).join('');}
  set innerHTML(value){this.children=parseHTML(String(value),this.document,this);this.writes=(this.writes||0)+1;}
  get outerHTML(){if(this.tagName==='#text')return this.text;const attrs=Object.entries(this.attrs).map(([key,value])=>` ${key}="${value}"`).join('');return `<${this.tagName}${attrs}>`+(voidTags.has(this.tagName)?'':this.innerHTML+`</${this.tagName}>`);}
  set outerHTML(value){if(!this.parentNode)return;const parent=this.parentNode,index=parent.children.indexOf(this);parent.children.splice(index,1,...parseHTML(String(value),this.document,parent));this.parentNode=null;}
  get classList(){return {contains:name=>this.className.split(/\s+/).includes(name)};}
  getAttribute(name){return this.attrs[name]??null;}
  setAttribute(name,value){this.attrs[name]=String(value);}
  removeAttribute(name){delete this.attrs[name];}
  contains(node){while(node){if(node===this)return true;node=node.parentNode;}return false;}
  matches(selector){
    if(this.tagName==='#text')return false;
    let rest=selector.trim();
    if(rest.includes(':focus')){if(this.document.activeElement!==this)return false;rest=rest.replaceAll(':focus','');}
    if(rest.includes(':disabled')){if(!this.disabled)return false;rest=rest.replaceAll(':disabled','');}
    const attrs=[...rest.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)];
    for(const [,name,value]of attrs){if(name==='open'){if(!this.open)return false;}else if(!(name in this.attrs)&&!(name==='data-busy'&&this.dataset.busy))return false;if(value!==undefined&&this.attrs[name]!==value)return false;}
    rest=rest.replace(/\[[^\]]+\]/g,'');
    const id=rest.match(/#([\w-]+)/)?.[1];if(id&&this.id!==id)return false;
    for(const match of rest.matchAll(/\.([\w-]+)/g))if(!this.classList.contains(match[1]))return false;
    const tag=rest.match(/^[a-z][\w-]*/i)?.[0];return !tag||tag===this.tagName;
  }
  closest(selector){let node=this;while(node){if(node.matches(selector))return node;node=node.parentNode;}return null;}
  querySelectorAll(selector){
    const options=selector.split(',').map(part=>part.trim().split(/\s+/));
    const matches=node=>options.some(parts=>{if(!node.matches(parts.at(-1)))return false;let parent=node.parentNode;for(let i=parts.length-2;i>=0;i--){while(parent&&!parent.matches(parts[i]))parent=parent.parentNode;if(!parent)return false;parent=parent.parentNode;}return true;});
    const found=[];const visit=node=>{for(const child of node.children){if(matches(child))found.push(child);visit(child);}};visit(this);return found;
  }
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  addEventListener(name,handler){if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push(handler);}
  async emit(name,event={}){for(const handler of this.listeners.get(name)||[])await handler({...event,type:name,target:event.target||this});}
  focus(){this.document.activeElement=this;}
  blur(){if(this.document.activeElement===this)this.document.activeElement=null;}
  close(){this.open=false;}
  showModal(){this.open=true;}
  scrollIntoView(){}
}
function parseHTML(html,document,parent){
  const holder=new Element('fragment',{},document),stack=[holder];
  for(const [token]of html.matchAll(/<!--[\s\S]*?-->|<[^>]*>|[^<]+/g)){
    if(token.startsWith('<!--'))continue;
    if(token.startsWith('</')){const tag=token.slice(2,-1).trim();for(let i=stack.length-1;i>0;i--)if(stack[i].tagName===tag){stack.length=i;break;}continue;}
    let node;
    if(token.startsWith('<')){const tag=token.match(/^<([\w-]+)/)?.[1];if(!tag)continue;const attrs={};for(const [,name,double,single,bare]of token.slice(tag.length+1,-1).matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))attrs[name]=double??single??bare??'';node=new Element(tag,attrs,document);}
    else {node=new Element('#text',{},document);node.text=token;}
    const current=stack.at(-1);node.parentNode=current;current.children.push(node);
    if(node.tagName!=='#text'&&!voidTags.has(node.tagName)&&!token.endsWith('/>'))stack.push(node);
  }
  for(const node of holder.children)node.parentNode=parent;return holder.children;
}
export function createDocument(){const document=new Element('document');document.document=document;document.activeElement=null;document.visibilityState='visible';document.title='';document.getElementById=id=>document.querySelector('#'+id);document.innerHTML='<div id="app"></div><div id="toast" hidden></div><dialog id="dialog"></dialog>';return document;}
