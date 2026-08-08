import WebSocket from "ws";
import { EventEmitter } from "events";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";

const SUBSCRIPTIONS = [
  '{"x-dgw-app-XRSS-method":"Falco","x-dgw-app-xrs-body":"true","x-dgw-app-XRS-Accept-Ack":"RSAck","x-dgw-app-XRSS-http_referer":"https://www.facebook.com/"}',
  null, // filled dynamically with userID
  '{"x-dgw-app-XRSS-method":"FBGQLS:FRIEND_REQUEST_RECEIVE_SUBSCRIBE","x-dgw-app-XRSS-doc_id":"24047008371656912","x-dgw-app-xrs-body":"true","x-dgw-app-XRS-Accept-Ack":"RSAck","x-dgw-app-XRSS-http_referer":"https://www.facebook.com/"}',
];

export default (defaultFuncs, api, ctx) => (cb) => {
  const emitter = new EventEmitter();
  if (typeof cb === "function") { emitter.on("notification", d => cb(null, d)); emitter.on("error", e => cb(e)); }

  SUBSCRIPTIONS[1] = JSON.stringify({
    "x-dgw-app-XRSS-method":"FBLQ:comet_notifications_live_query_experimental",
    "x-dgw-app-XRSS-doc_id":"9784489068321501",
    "x-dgw-app-XRSS-actor_id":ctx.userID, "x-dgw-app-XRSS-page_id":ctx.userID,
    "x-dgw-app-xrs-body":"true","x-dgw-app-XRS-Accept-Ack":"RSAck",
    "x-dgw-app-XRSS-http_referer":"https://www.facebook.com/",
  });

  let ws, pingInterval, reconnectTimer;
  const isStopped = { v: false };

  function formatNotif(data) {
    if (!data?.data?.viewer) return null;
    const edge = data.data.viewer?.notifications_page?.edges?.[1]?.node?.notif;
    if (!edge) return null;
    return { type:"notification", notifID:edge.notif_id, body:edge.body?.text,
      senderID:Object.keys(edge.tracking?.from_uids||{})[0], url:edge.url,
      timestamp:edge.creation_time?.timestamp, seenState:edge.seen_state };
  }

  async function handleMessage(raw) {
    try {
      const text = raw.toString("utf8");
      const i = text.indexOf("{"); if (i < 0) return;
      const json = JSON.parse(text.slice(i));
      if (json.code === 200) return;
      const notif = formatNotif(json);
      emitter.emit(notif ? "notification" : "payload", notif || json);
    } catch (_) {}
  }

  function connect() {
    if (isStopped.v) return;
    try {
      const params = new URLSearchParams({
        "x-dgw-appid":"2220391788200892","x-dgw-appversion":"0","x-dgw-authtype":"1:0",
        "x-dgw-version":"5","x-dgw-uuid":ctx.userID,"x-dgw-tier":"prod",
        "x-dgw-deviceid":ctx.clientID||ctx.userID,"x-dgw-app-stream-group":"group1",
      });
      const cookies = (ctx.jar.getCookiesSync?.("https://www.facebook.com")||[]).map(c=>`${c.key}=${c.value}`).join("; ");
      const ua = ctx.globalOptions?.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
      const wsOpts = { headers:{ Cookie:cookies, Origin:"https://www.facebook.com", "User-Agent":ua, Referer:"https://www.facebook.com", Host:"gateway.facebook.com" } };

      if (ctx.globalOptions?.proxy) {
        try { wsOpts.agent = new HttpsProxyAgent(ctx.globalOptions.proxy); } catch (_) {}
      }
      if (ctx.globalOptions?.socksProxy) {
        try { wsOpts.agent = new SocksProxyAgent(ctx.globalOptions.socksProxy); } catch (_) {}
      }

      ws = new WebSocket(`wss://gateway.facebook.com/ws/realtime?${params}`, wsOpts);
      ws.on("open", () => {
        SUBSCRIPTIONS.forEach((payload, idx) => {
          const pb = Buffer.from(payload); const hdr = Buffer.from([14, idx, 0, pb.length]);
          ws.send(Buffer.concat([hdr, pb, Buffer.from([0,0])]));
        });
        pingInterval = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send("ping"); }, 10000);
      });
      ws.on("message", handleMessage);
      ws.on("error", e => emitter.emit("error", e));
      ws.on("close", () => { clearInterval(pingInterval); if (!isStopped.v) reconnectTimer = setTimeout(connect, 3000); });
    } catch (e) { emitter.emit("error", e); if (!isStopped.v) reconnectTimer = setTimeout(connect, 5000); }
  }

  connect();
  emitter.stop = () => { isStopped.v = true; clearInterval(pingInterval); clearTimeout(reconnectTimer); if (ws) ws.close(); };
  return emitter;
};
