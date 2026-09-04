var _=Object.defineProperty;
var I=(l,
h)=>_(l,
"name",
 {value:h,
  configurable:!0
});
const D=20;
var T= {
  config: {
    name:"grouplist",
    aliases:["قائمة_المجموعات"],
    version:"1.0.0",
    role:4,
    countDown:10,
    category:"أدوات المطور",
    description:"عرض جميع المجموعات التي يوجد فيها البوت حالياً",
    hidden:!0,
    usage:["{pn}grouplist — عرض أول 50 مجموعة",
    "{pn}grouplist <رقم_الصفحة> — التنقل بين الصفحات",
    "{pn}grouplist all — جلب جميع المجموعات (قد يستغرق وقتاً)"]
  },onStart:I(async( {
    api:l,
    event:h,
    args:p,
    message:i
  })=> {
    const {
      threadID:y,
      messageID:k
    }=h,
    o=p[0]?.toLowerCase()==="all"||p[0]==="الكل",
    P=o?1:parseInt(p[0])||1;
    try {
      let t=[],
      u=null;
      const d=100,
      S=o?20:3;
      let c=null;
      for(let n=0;
      n<S;
      n++) {
        let e;
        try {
          e=await l.getThreadList(d,
          u,
          [])
        }catch(s) {
          c=s;
          break
        }if(!Array.isArray(e)||e.length===0)break;
        const r=e.filter(s=>s.isGroup===!0||s.threadType==="GROUP");
        if(t=t.concat(r),
        e.length<d||(u=e[e.length-1]?.timestamp||null,
        !u)||!o&&t.length>=60)break
      }if(t.length===0)return c?i.reply(`❌ تعذّر جلب المجموعات من فيسبوك:
${String(c?.message||c).slice(0,300)}
قد يكون الحساب مقيدًا مؤقتًا من طلبات GraphQL أو جلسة الدخول تحتاج إعادة تحميل.`):i.reply("ℹ️ لم يتم العثور على أي مجموعات.");
      if(o) {
        let n=`📋 إجمالي المجموعات: ${t.length}
${"━".repeat(28)}
`;
        const e=[];
        let r=n;
        t.forEach((a,
        s)=> {
          const b=a.name||a.threadName||"[بدون اسم]",
          A=a.participantIDs?.length??a.participants?.length??"?",
          $=`${s+1}. 👥 ${b}
    🆔 ${a.threadID}
    👤 عدد الأعضاء: ${A}
`;
          (r+$).length>1800?(e.push(r),
          r=$):r+=$
        }),
        r.trim()&&e.push(r);
        for(const a of e)await new Promise(s=> {
          global.safeSend(l,
          a,
          y,
          s,
          null)
        }),
        await new Promise(s=>setTimeout(s,
        500));
        return
      }const g=Math.ceil(t.length/20),
      E=Math.min(Math.max(P,
      1),
      g),
      f=(E-1)*20,
      G=t.slice(f,
      f+20);
      let m=`📋 المجموعات (صفحة ${E}/${g}) — الإجمالي: ${t.length}
${"━".repeat(28)}
`;
      return G.forEach((n,
      e)=> {
        const r=n.name||n.threadName||"[بدون اسم]",
        a=n.participantIDs?.length??n.participants?.length??"?";
        m+=`${f+e+1}. 👥 ${r}
    🆔 ${n.threadID}
    👤 أعضاء: ${a}
`
      }),
      g>1&&(m+=`
ـ grouplist <رقم_الصفحة> للتنقل`),
      i.reply(m.trim())
    }catch(t) {
      return console.error("[grouplist] خطأ:",
      t),
      i.reply(`❌ خطأ أثناء جلب المجموعات:
${t?.message||String(t)}`)
    }},"onStart")
};export {
  T as default
};
