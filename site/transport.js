export function createAPITransport(config,options={}){
  const bearer=config.authTransport==='bearer',origin=config.apiOrigin||'';
  const key=`math-commonroom.session.${origin}`;
  let token='',generation=0;
  const storage=()=>options.storage||globalThis.sessionStorage;
  if(bearer){try{token=storage()?.getItem(key)||'';}catch{}}
  const fetcher=(...args)=>(options.fetch||globalThis.fetch)(...args);
  function saveToken(value){token=value;try{if(value)storage()?.setItem(key,value);else storage()?.removeItem(key);}catch{}}
  function clearToken(){generation++;saveToken('');}
  async function request(path,body,method='POST'){
    if(!path.startsWith('/')||path.startsWith('//'))throw new Error('Invalid API path');
    const signIn=['/auth/sign-in/email','/session/register'].includes(path),signOut=path==='/auth/sign-out';
    const version=signIn||signOut?++generation:generation;
    const headers=body===undefined?{}:{'Content-Type':'application/json'};
    if(bearer&&token)headers.Authorization=`Bearer ${token}`;
    const response=await fetcher(origin+'/api'+path,{method:body===undefined?'GET':method,credentials:bearer?'omit':'same-origin',cache:'no-store',headers,...(body===undefined?{}:{body:JSON.stringify(body)})});
    if(bearer&&response.ok&&version===generation){
      if(signOut)clearToken();
      else if(signIn){const value=response.headers.get('set-auth-token');if(value)saveToken(value);}
    }
    return response;
  }
  return {request,clearToken};
}
