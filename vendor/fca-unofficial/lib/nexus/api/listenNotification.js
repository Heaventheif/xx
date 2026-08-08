import listenRealtimeFactory from "./listenRealtime.js";
export default (defaultFuncs, api, ctx) => {
  const rt = listenRealtimeFactory(defaultFuncs, api, ctx);
  return () => { let em = null; return { start(cb){ em = rt(cb); }, stop(){ if(em){em.stop();em=null;} } }; };
};
