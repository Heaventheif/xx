import mqtt from "mqtt";
import { EventEmitter } from "events";
import { getGUID } from "../utils.js";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";

export default (defaultFuncs, api, ctx) => (cb) => {
  const emitter = new EventEmitter();
  if (typeof cb === "function") { emitter.on("event", d => cb(null, d)); emitter.on("error", e => cb(e)); }
  let client, stopped = false;
  const region = ctx.globalOptions?.mqttRegion || ctx.region || "PRN";
  const cookies = (ctx.jar.getCookiesSync?.("https://www.facebook.com")||[]).map(c=>`${c.key}=${c.value}`).join("; ");
  const ua = ctx.globalOptions?.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
  const params = new URLSearchParams({
    "x-dgw-appid":"2220391788200892","x-dgw-appversion":"0","x-dgw-authtype":"1:0",
    "x-dgw-version":"5","x-dgw-uuid":ctx.userID,"x-dgw-tier":"prod",
    "x-dgw-loggingid":getGUID(),"x-dgw-regionhint":region,"x-dgw-deviceid":ctx.clientID||ctx.userID,
  });
  const host = `wss://gateway.facebook.com/ws/lightspeed?${params}`;
  const mqttOpts = {
    clientId:"mqttwsclient", protocolId:"MQIsdp", protocolVersion:3,
    username: JSON.stringify({ u:ctx.userID, s:Math.floor(Math.random()*Number.MAX_SAFE_INTEGER)+1,
      chat_on:ctx.globalOptions?.online!==false, fg:false, d:ctx.clientID||ctx.userID,
      ct:"websocket", aid:"2220391788200892", mqtt_sid:"", cp:3, ecp:10,
      st:[], pm:[], dc:"", no_auto_fg:true, gas:null, pack:[], a:ua }),
    clean:true, keepalive:10, reconnectPeriod:0,
    wsOptions:{ headers:{ Cookie:cookies, Origin:"https://www.facebook.com", "User-Agent":ua, Referer:"https://www.facebook.com/", Host:"gateway.facebook.com" }, protocolVersion:13 },
  };
  const proxy = ctx.globalOptions?.proxy;
  if (proxy) { try { mqttOpts.wsOptions.agent = new HttpsProxyAgent(proxy); } catch (_) {} }
  const socksProxy = ctx.globalOptions?.socksProxy;
  if (socksProxy) { try { mqttOpts.wsOptions.agent = new SocksProxyAgent(socksProxy); } catch (_) {} }

  function start(retry=0) {
    if (stopped) return;
    client = mqtt.connect(host, mqttOpts);
    client.on("connect", () => { client.subscribe(["/ls_req","/ls_resp","/t_ms","/orca_presence"],{qos:1}); emitter.emit("connected"); });
    client.on("message", (topic, msg) => { try { const data=JSON.parse(msg.toString()); emitter.emit("event",{type:topic,data}); } catch(_){} });
    client.on("error", e => emitter.emit("error", e));
    client.on("close", () => { if(!stopped) setTimeout(()=>start(retry+1), Math.min(30000, 1000*Math.pow(2,Math.min(retry,5)))); });
  }
  start();
  emitter.stop = () => { stopped=true; if(client) client.end(true); };
  return emitter;
};
