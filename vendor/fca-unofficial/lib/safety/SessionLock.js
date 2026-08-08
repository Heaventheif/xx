export default class SessionLock {
  constructor(){this._q=[];this._locked=false;}
  acquire(){return new Promise(res=>{if(!this._locked){this._locked=true;res(()=>this._release());}else this._q.push(res);});}
  _release(){if(this._q.length){const next=this._q.shift();next(()=>this._release());}else this._locked=false;}
  async withLock(fn){const r=await this.acquire();try{return await fn();}finally{r();}}
}
