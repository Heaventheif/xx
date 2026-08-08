import * as client_1 from "./client.js";
export function setProxy(proxyUrl) {
  (0, client_1.setClientProxy)(proxyUrl || null);
  // نبقي هالحقول موجودة بـ defaults حفاظًا على التوافق مع أي كود قديم
  // بيقرأها مباشرة (مثلاً تشخيص/لوغ)، بس هي مش مستخدمة فعليًا بالطلب.
  client_1.client.defaults.proxy = proxyUrl ? proxyUrl : false;
}
export default {
  setProxy
};