pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";

/* ============ מצב גלובלי ============ */
const state = {
  files: [],          // {id,name,ext,file, text, workbook, rows, images:[]}
  findings: [],       // {id,type,value,label,fileId,checked}
  mode: 'token',
  pdfMode: 'image',
  ctxNames: 'off',
  detectors: {},      // key -> bool
  pdfScale: 2,        // רזולוציית רינדור עמודי PDF
  anonName: false,    // שם קובץ אנונימי לחלוטין
  stripMedia: true,   // הסרת תמונות ואובייקטים מוטמעים מ-Office
  allPages: false,    // מלבן ידני מוחל על כל עמודי המסמך
  pseudo: {map:{}, counters:{}},   // ערך מנורמל -> תווית ממוספרת יציבה
};

/* ============ מזהים (regex ישראלי) ============ */
const DETECTORS = {
  firstname:{label:'זיהוי שמות (פרטי + משפחה)', tag:'[שם]', on:true},
  company: {label:'שם חברה אוטומטי', tag:'[חברה]', on:false},
  id:      {label:'ת.ז', tag:'[ת"ז]', on:true},
  hp:      {label:'ח.פ / ע.מ', tag:'[ח.פ]', on:true},
  phone:   {label:'טלפון', tag:'[טלפון]', on:true},
  email:   {label:'אימייל', tag:'[אימייל]', on:true},
  cc:      {label:'כרטיס אשראי', tag:'[כרטיס]', on:true},
  bank:    {label:'חשבון בנק', tag:'[חשבון]', on:true},
  iban:    {label:'IBAN', tag:'[IBAN]', on:true},
  taxfile: {label:'תיק ניכויים / תיק מס', tag:'[תיק]', on:true},
  birth:   {label:'תאריך לידה', tag:'[ת.לידה]', on:true},
  addr:    {label:'כתובת', tag:'[כתובת]', on:true},
  date:    {label:'כל תאריך', tag:'[תאריך]', on:false},
  zip:     {label:'מיקוד', tag:'[מיקוד]', on:false},
};

/* מילון שמות פרטיים ישראליים נפוצים (זכר + נקבה) - זיהוי אוטומטי אופליין */
const FIRST_NAMES = new Set((`
אבי אבנר אביב אביתר אבישי אברהם אדם אהרון אודי אור אורי אורן אייל איל איתי איתמר איתן אלון אלי
אליהו אליאב אליעזר אלכס אמיר אסף ארז אריאל אריה אשר בן בני בניה ברוך ברק גד גדי גיא גיל גלעד גל
דב דביר דוד דור דורון דן דני דניאל הראל הלל זאב זוהר חגי חובב חיים חן טל טוביה יאיר יגאל יהודה
יהונתן יהושע יואב יואל יובל יוסי יוסף יורם יותם יחיאל ינון יניב יעקב יפתח יצחק ירון ישי ישראל
כפיר לביא לוי ליאור ליאם מאיר מוטי מיכאל מנחם מרדכי משה מתן נדב נהוראי נועם נחום נחמן ניב ניר
נמרוד נתן נתנאל סהר סטב עברי עדי עוז עומר עידו עידן עמוס עמית ערן פנחס צבי צח קובי רועי רז רן רני
רפאל רפי שאול שגיא שחר שי שלום שלמה שמואל שמעון שקד תום תומר תמיר עוזי אלעד רותם רן שמאי בועז
אביגיל אביה אבישג אדוה אודליה אורית אורלי אושרת איילת איילה אילנה אירית אלה אלונה אליה אלינור
אמונה אמילי אנאל אסתר אפרת אתי בר בת-שבע גאיה גולן גלי גלית דיאנה דנה דפנה הדס הדר הודיה הילה
ורד זהבה זיו חגית חנה טליה טובה יעל יערה יסמין יפית יפעת ירדן כרמל ליאל ליבי ליהי לימור לינוי
מאיה מור מורן מיה מיכל מירב מרים נגה נוה נועה נוי נורית נטע נילי נעה נעמה נעמי סיון סיגל סמדר
ספיר עדן עינב עינת ענבל ענבר עפרה פנינה צליל קורל קרן רבקה רונה רוני רונית רות רחל ריטה ריקי
רננה שגית שולמית שיר שירה שירן שלומית שני שרה תהילה תמר גילה זיוה חדוה יהודית לאה מלכה נחמה
`).split(/\s+/).filter(Boolean));

/* שמות שהם גם מילים נפוצות בעברית - לא לזהות אוטומטית לבד */
const AMBIGUOUS_NAMES = new Set((`
אלה אשר שי מתן אביב אור גל בר חן טל נגה עדי רן דור נוי ורד זיו עוז רז שקד תום קרן סיון ניב ניר
מור מיה יעל תמר בת הדס הדר לביא רות שיר עדן צח סהר עמית גילה נוה חדוה זהבה
`).split(/\s+/).filter(Boolean));

/* אימות ת.ז ישראלית */
function validIsraeliID(s){
  const d = s.replace(/\D/g,'');
  // רק 8-9 ספרות. סף של 5 ספרות הציף דוחות כספיים בסכומים שעברו את ספרת הביקורת במקרה.
  if(d.length<8 || d.length>9) return false;
  const p = d.padStart(9,'0');
  let sum=0;
  for(let i=0;i<9;i++){
    let n = +p[i] * ((i%2)+1);
    if(n>9) n-=9;
    sum+=n;
  }
  return sum%10===0;
}
/* אימות Luhn לכרטיס אשראי */
function validLuhn(s){
  const d=s.replace(/\D/g,'');
  if(d.length<13||d.length>19) return false;
  let sum=0, alt=false;
  for(let i=d.length-1;i>=0;i--){
    let n=+d[i];
    if(alt){n*=2; if(n>9)n-=9;}
    sum+=n; alt=!alt;
  }
  return sum%10===0;
}

/* אימות IBAN ישראלי לפי mod-97 */
function validIban(str){
  const v=(str||'').replace(/[\s-]/g,'').toUpperCase();
  if(!/^IL[0-9]{21}$/.test(v)) return false;
  const re=v.slice(4)+v.slice(0,4);
  let rem=0;
  for(const ch of re){
    const d = /[0-9]/.test(ch) ? ch : String(ch.charCodeAt(0)-55);
    for(const x of d) rem=(rem*10 + (+x))%97;
  }
  return rem===1;
}

/* ============ פסאודונימיזציה עקבית ============
   אותו ערך מקבל את אותה תווית ממוספרת בכל הקבצים ובכל העמודים, כך שהמודל
   יכול לעקוב אחרי אותו אדם או אותה חברה לאורך הניתוח. */
function pseudoInner(type){ return typeTag(type).replace(/^\[/,'').replace(/\]$/,''); }
function pseudoToken(value, type){
  const key = type+'|'+normSpaceless(value);
  const reg = state.pseudo;
  if(reg.map[key]) return reg.map[key];
  const inner = pseudoInner(type);
  reg.counters[inner] = (reg.counters[inner]||0)+1;
  const tok = '['+inner+'-'+reg.counters[inner]+']';
  reg.map[key] = tok;
  return tok;
}
/* בונה את קובץ המפתח מהממצאים המאושרים בפועל */
function buildKeyFile(){
  const rows=[];
  const seen=new Set();
  state.files.forEach(f=>{
    activeFor(f).forEach(a=>{
      const k=a.type+'|'+normSpaceless(a.value);
      if(seen.has(k)) return; seen.add(k);
      rows.push({tok: pseudoToken(a.value,a.type), type: typeLabel(a.type), value: a.value});
    });
  });
  if(!rows.length) return null;
  rows.sort((x,y)=>x.tok.localeCompare(y.tok,'he'));
  const w=Math.max(...rows.map(r=>r.tok.length));
  const lines=[
    'מפתח פענוח - קובץ פרטי',
    'אין להעלות את הקובץ הזה למודל שפה או לשלוח אותו יחד עם הקבצים הנקיים.',
    'נוצר על ידי מנקה נתונים אישיים, עיבוד מקומי בדפדפן.',
    '',
    'תווית'.padEnd(w+3)+'סוג'.padEnd(22)+'הערך המקורי',
    '-'.repeat(w+3+22+30)
  ];
  rows.forEach(r=>lines.push(r.tok.padEnd(w+3)+r.type.padEnd(22)+r.value));
  return new Blob(['\uFEFF'+lines.join('\r\n')+'\r\n'], {type:'text/plain;charset=utf-8'});
}

/* מאתר ממצאים בטקסט. מחזיר [{type,value}] */
function scanText(text){
  const out=[];
  const push=(type,value)=>{ const v=(value||'').trim(); if(v.length>=2 && !STOP_WORDS.has(v)) out.push({type,value:v}); };

  // אימייל
  if(state.detectors.email)
    (text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g)||[]).forEach(m=>push('email',m));

  // טלפון ישראלי (נייד/נייח, עם או בלי מקף/רווח).
  // חובה לחסום התאמה בתוך רצף ספרות ארוך: בלי זה IBAN או מספר חשבון
  // מייצרים "טלפון" מדומה מתוך הספרות שבתוכם.
  if(state.detectors.phone){
    const rePh=/(?:^|[^\d+])((?:\+972[-\s]?|0)(?:5\d|[2-489])[-\s]?\d{3}[-\s]?\d{4})(?!\d)/g;
    let mp; while((mp=rePh.exec(text))!==null) push('phone', mp[1]);
  }

  // כרטיס אשראי (16 ספרות בקבוצות) - עם אימות Luhn
  if(state.detectors.cc)
    (text.match(/\b(?:\d[ \-]?){13,19}\b/g)||[]).forEach(m=>{ if(validLuhn(m)) push('cc',m); });

  // ת.ז / ח.פ: רק 8-9 ספרות ורק עם ספרת ביקורת תקינה. ח.פ ישראלי מתחיל ב-5.
  const nine = text.match(/\b\d{8,9}\b/g)||[];
  nine.forEach(m=>{
    const clean=m.replace(/\D/g,'');
    if(clean.length===9 && clean[0]==='5'){
      if(state.detectors.hp && validIsraeliID(clean)) push('hp',m);
      return;
    }
    if(state.detectors.id && validIsraeliID(clean)) push('id',m);
  });
  // מזהה שמופיע אחרי תווית מפורשת: נתפס גם באורך חריג או בלי ספרת ביקורת תקינה
  if(state.detectors.id || state.detectors.hp){
    const reLbl=/(?:ת\.?\s*ז\.?|ת["׳]ז|מס['׳]?\s*זהות|מספר\s*זהות|ח\.?\s*פ\.?|ח["׳]פ|ע\.?\s*מ\.?|עוסק\s*מורשה)[:\s]{0,4}(\d[\d\-/]{4,12}\d)/g;
    let mL; while((mL=reLbl.exec(text))!==null) push('id', mL[1]);
  }

  // חשבון בנק: סניף-חשבון תבנית כללית
  if(state.detectors.bank)
    (text.match(/\b\d{2,3}[-]\d{3,6}[-]\d{4,9}\b/g)||[]).forEach(m=>push('bank',m));

  // IBAN ישראלי, עם אימות mod-97
  if(state.detectors.iban)
    (text.match(/\bIL\s?\d{2}(?:\s?\d{4}){4}\s?\d{3}\b/gi)||[]).forEach(m=>{ if(validIban(m)) push('iban',m); });

  // תיק ניכויים / תיק מס: רק לפי תווית מפורשת, אחרת זה רעש בדוח כספי
  if(state.detectors.taxfile){
    const reTax=/(?:תיק\s*ניכויים|תיק\s*מס|מס['׳]?\s*תיק|מספר\s*תיק)[:\s]{0,4}(\d[\d\-/]{3,12}\d)/g;
    let mT; while((mT=reTax.exec(text))!==null) push('taxfile', mT[1]);
  }

  // מיקוד 7 ספרות
  if(state.detectors.zip)
    (text.match(/\b\d{7}\b/g)||[]).forEach(m=>{ if(!validIsraeliID(m)) push('zip',m); });

  // תאריך לידה: תאריך הסמוך למילות הקשר
  if(state.detectors.birth){
    const re=/(?:תארי?ך\s*לידה|ת\.?\s*לידה|נולדה?|יליד(?:ת)?|ילידי?)\D{0,8}(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4})/g;
    let m; while((m=re.exec(text))!==null) push('birth', m[1]);
    const re2=/(?:תארי?ך\s*לידה|ת\.?\s*לידה|נולדה?|יליד(?:ת)?)\D{0,8}(\d{1,2}\s+ב?(?:ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)\s+\d{4})/g;
    while((m=re2.exec(text))!==null) push('birth', m[1]);
  }

  // כתובת: רחוב/שדרות/דרך + מילים + מספר, וגם ת.ד
  if(state.detectors.addr){
    const re=/((?:רחוב|רח['׳]?|שדרות|שד['׳]?|דרך|שכונת|סמטת|מבוא)\s+[א-ת"'\-]+(?:\s+[א-ת"'\-]+){0,3}\s+\d{1,4})/g;
    let m; while((m=re.exec(text))!==null) push('addr', m[1].trim());
    (text.match(/ת\.?\s*ד\.?\s*\d{1,6}/g)||[]).forEach(m2=>push('addr', m2));
  }

  // כל תאריך (כבוי כברירת מחדל - עלול לתפוס תאריכי דוח)
  if(state.detectors.date){
    (text.match(/\b\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}\b/g)||[]).forEach(m=>push('date',m));
    (text.match(/\b\d{1,2}\s+ב?(?:ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)\s+\d{4}\b/g)||[]).forEach(m=>push('date',m));
  }

  // שמות מרשימה ידנית, התאמה מנורמלת (ניקוד/רווחים/גרשיים), כולל סדר תווים הפוך (RTL ב-PDF)
  const bigNorm = normSpaceless(text);
  namesList().forEach(name=>{
    const n=normSpaceless(name);
    const nr=n.split('').reverse().join('');
    if(n.length>=2 && (bigNorm.includes(n) || bigNorm.includes(nr))) push('name', name);
  });

  // זיהוי שמות (אופציונלי): צמד "פרטי + משפחה" גם כשהפרטי לא במילון
  if(state.detectors.firstname){
    const parts = text.split(/([^א-ת"']+)/);   // אינדקסים זוגיים = טוקנים עבריים
    for(let i=0;i<parts.length;i+=2){
      const w    = (parts[i]||'').replace(/["']/g,'');
      const next = (parts[i+2]||'').replace(/["']/g,'');
      const prev = (parts[i-2]||'').replace(/["']/g,'');
      if(FIRST_NAMES.has(w) && !AMBIGUOUS_NAMES.has(w)){
        if(next && next.length>=2 && !STOP_WORDS.has(next) && !FIRST_NAMES.has(next))
          push('name', w+' '+next);
        else
          push('name', w);
      } else if(SURNAMES.has(w)){
        // שם משפחה מוכר: צרף את המילה שלפניו כשם פרטי אם היא סבירה
        if(prev && prev.length>=2 && !STOP_WORDS.has(prev) && !SURNAMES.has(prev))
          push('name', prev+' '+w);
        else if(FIRST_NAMES.has(prev))
          push('name', prev+' '+w);
      }
    }
  }

  // שם חברה אוטומטי (אופציונלי): רק "X בע\"מ" או "חברת X" עם ערך משמעותי
  if(state.detectors.company){
    let m;
    const beforeBaam = /([א-ת][א-ת"']+(?:\s+[א-ת][א-ת"']+){0,3})\s+בע["']?מ/g;
    while((m=beforeBaam.exec(text))!==null){ const v=m[1].trim(); if(v.length>=3) push('company', v+' בע"מ'); }
    const afterHevrat = /חברת\s+([א-ת][א-ת"']+(?:\s+[א-ת][א-ת"']+){0,2})/g;
    while((m=afterHevrat.exec(text))!==null){ const v=m[1].trim(); if(v.length>=3 && !STOP_WORDS.has(v)) push('company', v); }
  }

  // זיהוי שמות לפי הקשר עברי (אופציונלי, כבוי כברירת מחדל)
  if(state.ctxNames==='on'){
    const ctx = /(?:מר|מרת|גב'|גברת|גבירת|ד"ר|דר'|עו"ד|רו"ח|ה"ה|בעל השליטה|בעלת השליטה|המנכ"ל|מנכ"ל|יו"ר|סמנכ"ל|החתום מטה|שם:|לכבוד)\s+([א-ת]{2,}(?:\s+[א-ת]{2,}){0,2})/g;
    let mm;
    while((mm=ctx.exec(text))!==null){ push('name', mm[1].trim()); }
  }

  // הסרת כפילויות
  const seen=new Set(), uniq=[];
  out.forEach(o=>{ const k=o.type+'|'+o.value; if(!seen.has(k)){seen.add(k);uniq.push(o);} });
  return uniq;
}

/* מילות קישור שלא נצרף כשם משפחה */
const STOP_WORDS = new Set('של את על עם אל כי גם או אם כן לא זה זו הוא היא הם הן אני אתה כמו אחרי לפני בין תחת מעל ליד עבור בגין בעל בעלת מר גברת אשר היה הייתה יהיה בעמ בעלים חברה קרן סניף חשבון מספר תאריך שם כתובת רחוב עיר ואת וכן וכי אבל אזי לכן כדי מנת בלבד יותר פחות הכל חלק סך סכום דוח דוחות כספיים ליום נכסים התחייבות הון עודף גירעון הכנסות הוצאות ביאור ביאורים סעיף שנה שנת ינואר בדצמבר בינואר מזומנים שווי רכוש קבוע'.split(/\s+/).filter(Boolean));

/* מילון שמות משפחה ישראליים נפוצים ומובחנים (לא מילים שגורות) */
const SURNAMES = new Set((`
אבוקסיס אביטן אברהמי אברמוביץ אדלר אדרי אוחיון אוחנה אוחנונה אזולאי אלבז אלוני אלמוג אלקיים
אמסלם אסולין אפללו אשכנזי בוזגלו בורנשטיין ביטון בן-דוד בן-חמו בנימיני ברזילי ברוש ברקוביץ
גבאי גולדברג גולדשטיין גרוס גרין גרינברג דהן דיין הורוביץ הלוי הרשקוביץ ובר וייס ועקנין זילברמן
זקן חדד חזן חסון טולדנו טל יעקובי ישראלי כהן כץ לביב לוי לרנר מזרחי מימון מלכה מרגלית משולם
נחמיאס סבן סגל סויסה סולומון עטיה פורת פישר פלד פרידמן פרלמן צור קליין קפלן רבינוביץ רוזן
רוזנברג רוזנטל שוורץ שטרן שמואלי שפירא שרעבי ששון
`).split(/\s+/).filter(Boolean));

/* נירמול עברי: הסרת ניקוד, איחוד גרשיים, הסרת סימוני כיוון */
/* תיקון אותיות סופיות משובשות ב-PDF ישראליים: הפונט ממפה ך/ם/ן/ף/ץ דרך windows-1255
   ו-pdf.js מפענח אותן כ-Latin-1 (ê/í/ï/ó/õ). ההחלפה רק כשהתו צמוד לאות עברית, בטוח לטקסט לועזי. */
function fixHebFinals(s){
  if(!s) return s;
  const map={'ê':'ך','í':'ם','ï':'ן','ó':'ף','õ':'ץ'};
  return s
    .replace(/([\u0590-\u05FF])([êíïóõ])/g, (m,h,l)=>h+map[l])
    .replace(/([êíïóõ])([\u0590-\u05FF])/g, (m,l,h)=>map[l]+h);
}

function normHeb(s){
  return (s||'')
    .replace(/[\u0591-\u05C7]/g,'')
    .replace(/[״”“]/g,'"').replace(/[׳’‘]/g,"'")
    .replace(/[\u200e\u200f\u202a-\u202e]/g,'')
    .replace(/ך/g,'כ').replace(/ם/g,'מ').replace(/ן/g,'נ').replace(/ף/g,'פ').replace(/ץ/g,'צ')
    .trim();
}
function normSpaceless(s){ return normHeb(s).replace(/\s+/g,''); }

function typeLabel(t){
  if(t==='name') return 'שם / מונח';
  if(t==='company') return 'שם חברה';
  if(t==='birth') return 'תאריך לידה';
  if(t==='addr') return 'כתובת';
  if(t==='date') return 'תאריך';
  return (DETECTORS[t]||{}).label || t;
}
function typeTag(t){
  if(t==='name') return '[שם]';
  if(t==='company') return '[חברה]';
  if(t==='birth') return '[ת.לידה]';
  if(t==='addr') return '[כתובת]';
  if(t==='date') return '[תאריך]';
  return (DETECTORS[t]||{}).tag || '[מוסתר]';
}

/* מחליף ערך בטקסט לפי המצב הנבחר */
function applyMode(value, type){
  if(state.mode==='delete') return '';
  if(state.mode==='token')  return pseudoToken(value, type);
  if(state.mode==='label')  return typeTag(type);
  // mask
  const d=value.replace(/\D/g,'');
  if(d.length>=4){
    const keepStart = value.slice(0, Math.min(2, value.length));
    const last4 = d.slice(-4);
    return keepStart + 'X'.repeat(Math.max(1,value.length-6)) + last4;
  }
  return 'X'.repeat(value.length);
}

/* מבצע החלפה של כל הממצאים המסומנים בטקסט */
function redactText(text, fileId){
  let t=text;
  const active = state.findings.filter(f=>f.fileId===fileId && f.checked);
  // מיון לפי אורך יורד כדי להחליף קודם ערכים ארוכים
  active.sort((a,b)=>b.value.length-a.value.length);
  active.forEach(f=>{
    const rep = applyMode(f.value, f.type);
    t = t.split(f.value).join(rep);
  });
  return t;
}

/* ============ ניהול קבצים ============ */
let fid=0;
function addFiles(fileList){
  let addedImg=false;
  [...fileList].forEach(f=>{
    const ext=f.name.split('.').pop().toLowerCase();
    const isImage=['png','jpg','jpeg','webp'].includes(ext);
    if(isImage) addedImg=true;
    state.files.push({id:++fid, name:f.name, ext, file:f, text:'', images:[], isImage});
  });
  renderFiles();
  if(addedImg) renderVisual();
  document.getElementById('scan').disabled = state.files.length===0;
  document.getElementById('download').disabled = state.files.length===0;
}
function renderFiles(){
  const el=document.getElementById('files');
  if(!state.files.length){el.innerHTML='';return;}
  el.innerHTML = state.files.map(f=>
    `<span class="filepill">${escapeHtml(f.name)}<span class="x" data-id="${f.id}">✕</span></span>`).join('');
  el.querySelectorAll('.x').forEach(x=>x.onclick=()=>{
    state.files=state.files.filter(f=>f.id!=x.dataset.id);
    state.findings=state.findings.filter(f=>f.fileId!=x.dataset.id);
    renderFiles(); renderFindings(); renderVisual();
    const empty=state.files.length===0;
    document.getElementById('scan').disabled = empty;
    document.getElementById('download').disabled = empty;
  });
}

function namesList(){
  return document.getElementById('names').value.split('\n').map(s=>s.trim()).filter(Boolean);
}

/* ============ קריאת תוכן קבצים ============ */
async function readFileContent(f){
  const buf = await f.file.arrayBuffer();
  if(f.ext==='xlsx'||f.ext==='xls'||f.ext==='csv'){
    let wb;
    if(f.ext==='csv'){
      // CSV: פענוח מפורש כ-UTF-8 (עם נפילה ל-windows-1255 לקבצים ישנים), מונע ג'יבריש בעברית
      let txt8 = new TextDecoder('utf-8',{fatal:false}).decode(buf);
      if(txt8.includes('\uFFFD')){ try{ txt8 = new TextDecoder('windows-1255').decode(buf); }catch(e){} }
      wb = XLSX.read(txt8,{type:'string'});
    } else {
      wb = XLSX.read(buf,{type:'array'});
    }
    f.workbook = wb;
    let txt='';
    wb.SheetNames.forEach(sn=>{
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,defval:''});
      rows.forEach(r=> txt += r.join(' | ')+'\n');
    });
    f.text=txt;
  } else if(f.ext==='docx'){
    const res = await mammoth.extractRawText({arrayBuffer:buf});
    f.text=res.value;
  } else if(f.ext==='pdf'){
    const pdf = await pdfjsLib.getDocument({data:buf}).promise;
    let txt=''; const perPage=[];
    for(let p=1;p<=pdf.numPages;p++){
      const page=await pdf.getPage(p);
      const tc=await page.getTextContent();
      const ptxt=tc.items.map(i=>fixHebFinals(i.str)).join(' ');
      perPage.push(normSpaceless(ptxt).length);
      txt += ptxt+'\n';
    }
    f.text=txt;
    f.numPages=pdf.numPages;
    f.isPdf=true;
    // סף לכל עמוד בנפרד: בספר דוחות חלק מהעמודים סרוקים וחלק טקסטואליים,
    // וסף גלובלי אחד סיווג את כולם לא נכון.
    f.pageScanned = perPage.map(n=>n<15);
    f.scannedCount = f.pageScanned.filter(Boolean).length;
    f.scanned = f.scannedCount > 0;
    await renderPdfPreview(f);   // כל PDF מקבל תצוגה מקדימה עם מלבנים
  } else if(['png','jpg','jpeg','webp'].includes(f.ext)){
    f.text=''; f.isImage=true;
  }
}

/* מרנדר עמודי PDF לקנבסים + שומר מיקום כל מקטע טקסט (לסימון אוטומטי) */
async function renderPdfPreview(f){
  const src=await pdfjsLib.getDocument({data:await f.file.arrayBuffer()}).promise;
  f.pages=[]; const scale=state.pdfScale||2;
  for(let p=1;p<=src.numPages;p++){
    const page=await src.getPage(p);
    const vp=page.getViewport({scale});
    const canvas=document.createElement('canvas');
    canvas.width=vp.width; canvas.height=vp.height;
    const ctx=canvas.getContext('2d');
    await page.render({canvasContext:ctx, viewport:vp}).promise;
    // מיקום כל מקטע טקסט בקואורדינטות הקנבס
    const tc=await page.getTextContent();
    const items=tc.items.map(it=>{
      const m=pdfjsLib.Util.transform(vp.transform, it.transform);
      const fh=Math.hypot(m[2],m[3])||12*scale;
      const w=(it.width||(it.str||'').length*fh*0.5)*scale;
      return {str:fixHebFinals(it.str||''), rect:{x:m[4]-2, y:m[5]-fh-1, w:w+4, h:fh+4}};
    });
    // עותק בסיס כקנבס ולא כ-ImageData: ImageData מחזיק 4 בתים לפיקסל ב-JS heap,
    // וספר של עשרות עמודים בסקייל 2 היה מפיל את הכרטיסייה.
    const baseCv=document.createElement('canvas');
    baseCv.width=canvas.width; baseCv.height=canvas.height;
    baseCv.getContext('2d').drawImage(canvas,0,0);
    f.pages.push({canvas, baseCv, items, autoBoxes:[], manualBoxes:[],
      pageNum:p, label:f.name+', עמוד '+(p)+'/'+src.numPages});
  }
  f.pages.forEach(e=>{ e.__file=f; });
  computeAutoBoxes(f);
}

/* מלבן משנה צמוד: חותך את rect הפריט רק לטווח התווים pos..pos+len מתוך count תווים.
   מכבד כיוון RTL (הטקסט העברי זורם מימין לשמאל בתוך הפריט). */
function subRect(rect, count, pos, len, rtl){
  if(!rect || count<=0){ return rect; }
  const cw = rect.w / count;
  let x;
  if(rtl){ x = rect.x + rect.w - (pos+len)*cw; }  // RTL: תו 0 בקצה הימני
  else   { x = rect.x + pos*cw; }
  return { x: x-2, y: rect.y, w: len*cw+4, h: rect.h };
}

/* מחשב מלבנים אוטומטיים לפי הממצאים המאושרים (לכל עמודי ה-PDF).
   בונה זרם תווים מנורמל *על פני כל הפריטים* בעמוד, כך שערך מפוצל בין פריטים עדיין נתפס,
   ומצייר מלבן צמוד לכל *מופע* בנפרד, בכל העמודים ולכל אורך המסמך. */
function computeAutoBoxes(f){
  const base=activeFor(f).map(a=>normSpaceless(a.value)).filter(t=>t.length>=2);
  const targets=[];
  base.forEach(t=>{ targets.push(t); targets.push(t.split('').reverse().join('')); }); // גם סדר הפוך (ארטיפקט RTL של pdf.js)
  (f.pages||[]).forEach(entry=>{
    entry.autoBoxes=[];
    // זרם תווים מנורמל ללא רווחים, כל תו יודע לאיזה פריט הוא שייך ומה מיקומו היחסי בתוכו
    const stream=[]; // {itemIdx, cpos, ccount}
    entry.items.forEach((it,idx)=>{
      const chars = normHeb(it.str).replace(/\s+/g,'');
      const n = chars.length;
      for(let j=0;j<n;j++){ stream.push({itemIdx:idx, cpos:j, ccount:n}); }
    });
    const bigStr = entry.items.map(it=>normHeb(it.str).replace(/\s+/g,'')).join('');
    // חיפוש כל מופע של כל יעד
    targets.forEach(T=>{
      let from=0,pos;
      while((pos=bigStr.indexOf(T,from))!==-1){
        // אוסף את התווים pos..pos+T.length ומקבץ אותם לפי פריט
        const byItem={};
        for(let k=pos;k<pos+T.length;k++){
          const s=stream[k]; if(!s) continue;
          (byItem[s.itemIdx]=byItem[s.itemIdx]||[]).push(s);
        }
        Object.keys(byItem).forEach(iidx=>{
          const arr=byItem[iidx];
          const it=entry.items[iidx];
          if(!it||!it.rect) return;
          const first=arr[0].cpos, last=arr[arr.length-1].cpos;
          const rtl=/[\u0590-\u05FF]/.test(it.str||''); // פריט עברי => RTL
          entry.autoBoxes.push(subRect(it.rect, arr[0].ccount, first, (last-first+1), rtl));
        });
        from=pos+T.length;
      }
    });
  });
}

/* ============ סריקה ============ */
async function scan(){
  const status=document.getElementById('status');
  status.textContent='קורא וסורק...';
  state.findings=[];
  syncDetectors();
  let visual=false;
  for(const f of state.files){
    try{
      await readFileContent(f);
      if(f.text) scanText(f.text).forEach(h=>addFinding(f,h));
      if(f.isImage || f.isPdf){ visual=true; }
    }catch(e){ console.error(e); status.textContent='שגיאה בקריאת '+f.name+': '+e.message; }
  }
  // אחרי שכל הממצאים נאספו, מחשבים מלבנים אוטומטיים לכל PDF
  state.files.forEach(f=>{ if(f.isPdf) computeAutoBoxes(f); });
  renderFindings();
  renderVisual();
  const scannedPages=state.files.reduce((n,f)=>n+(f.scannedCount||0),0);
  status.textContent = `נמצאו ${state.findings.length} ממצאים ב-${state.files.length} קבצים.` +
    (visual ? ' עברו על התצוגה המקדימה למטה וערכו את ההשחרות לפני הפקה.' : '') +
    (scannedPages ? ` זוהו ${scannedPages} עמודים סרוקים ללא שכבת טקסט: הפעילו OCR או סמנו אותם ידנית.` : '');
  document.getElementById('download').disabled = false;
}
function addFinding(f,h){
  if(state.findings.some(x=>x.fileId===f.id && x.value===h.value && x.type===h.type)) return;
  state.findings.push({id:'fnd'+(state.findings.length)+'_'+Math.floor(Math.random()*1e5),
    type:h.type, value:h.value, fileId:f.id, checked:true});
}

/* ============ תצוגת ממצאים ============ */
function renderFindings(){
  const el=document.getElementById('findings');
  document.getElementById('findcount').textContent=state.findings.filter(f=>f.checked).length;
  if(!state.findings.length){
    el.innerHTML='<div class="empty">לא נמצאו נתונים אישיים בקבצים הטקסטואליים (או שטרם נסרקו).</div>';
    return;
  }
  const fname=id=>{const f=state.files.find(x=>x.id==id);return f?f.name:'';};
  el.innerHTML=`<table><thead><tr>
      <th style="width:44px"></th><th style="width:110px">סוג</th>
      <th>ערך שזוהה</th><th>קובץ</th></tr></thead><tbody>
    ${state.findings.map(f=>`<tr>
      <td><input type="checkbox" class="chk" data-id="${f.id}" ${f.checked?'checked':''}></td>
      <td><span class="type-tag">${typeLabel(f.type)}</span></td>
      <td class="val">${escapeHtml(f.value)}</td>
      <td class="file-tag">${escapeHtml(fname(f.fileId))}</td>
    </tr>`).join('')}
    </tbody></table>`;
  el.querySelectorAll('.chk').forEach(c=>c.onchange=()=>{
    const f=state.findings.find(x=>x.id==c.dataset.id); f.checked=c.checked;
    document.getElementById('findcount').textContent=state.findings.filter(f=>f.checked).length;
    // עדכון התצוגה המקדימה של ה-PDF בהתאם לסימון
    state.files.forEach(ff=>{ if(ff.isPdf){ computeAutoBoxes(ff); (ff.pages||[]).forEach(e=>e.redraw&&e.redraw()); } });
  });
}
function escapeHtml(s){return s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}

/* ============ תצוגה מקדימה: סימון אוטומטי + ידני + OCR ============ */
function setupCanvas(entry){
  const canvas=entry.canvas, ctx=canvas.getContext('2d');
  entry.autoBoxes=entry.autoBoxes||[]; entry.manualBoxes=entry.manualBoxes||[];
  entry.suppressed=entry.suppressed||new Set();
  const key=b=>Math.round(b.x)+','+Math.round(b.y)+','+Math.round(b.w)+','+Math.round(b.h);
  entry.effective=()=> [
    ...entry.autoBoxes.filter(b=>!entry.suppressed.has(key(b))),
    ...entry.manualBoxes.filter(b=>!entry.suppressed.has(key(b)))
  ];
  const redraw=()=>{
    if(entry.img){ ctx.drawImage(entry.img,0,0); }
    else if(entry.baseCv){ ctx.drawImage(entry.baseCv,0,0); }
    ctx.fillStyle='#000';
    entry.effective().forEach(b=>ctx.fillRect(b.x,b.y,b.w,b.h));
  };
  if(!entry.img && !entry.baseCv){
    try{
      const bc=document.createElement('canvas');
      bc.width=canvas.width; bc.height=canvas.height;
      bc.getContext('2d').drawImage(canvas,0,0);
      entry.baseCv=bc;
    }catch(e){}
  }
  const hitBox=(px,py)=>{ // מחזיר את המלבן העליון שמכיל את הנקודה
    const eff=entry.effective();
    for(let i=eff.length-1;i>=0;i--){ const b=eff[i]; if(px>=b.x&&px<=b.x+b.w&&py>=b.y&&py<=b.y+b.h) return b; }
    return null;
  };
  let drawing=false,sx=0,sy=0;
  const scale=()=>canvas.width/canvas.getBoundingClientRect().width;
  canvas.onmousedown=e=>{const s=scale();drawing=true;sx=e.offsetX*s;sy=e.offsetY*s;};
  canvas.onmousemove=e=>{ if(!drawing)return;const s=scale();redraw();
    ctx.fillStyle='rgba(0,0,0,.45)'; ctx.fillRect(sx,sy,e.offsetX*s-sx,e.offsetY*s-sy); };
  canvas.onmouseup=e=>{ if(!drawing)return;drawing=false;const s=scale();
    const w=e.offsetX*s-sx,h=e.offsetY*s-sy;
    if(Math.abs(w)>5&&Math.abs(h)>5){
      const box={x:Math.min(sx,sx+w),y:Math.min(sy,sy+h),w:Math.abs(w),h:Math.abs(h)};
      entry.manualBoxes.push(box);
      // החלה על כל העמודים: שם לקוח בכותתרת חוזרת לא מחייב 40 גרירות.
      // ההעתקה יחסית למידות העמוד, כדי לעבוד גם כשגדלי העמודים שונים.
      if(state.allPages && entry.__file && (entry.__file.pages||[]).length>1){
        const rx=box.x/canvas.width, ry=box.y/canvas.height,
              rw=box.w/canvas.width, rh=box.h/canvas.height;
        entry.__file.pages.forEach(e2=>{
          if(e2===entry || !e2.canvas || !e2.canvas.width) return;
          e2.manualBoxes=e2.manualBoxes||[];
          e2.manualBoxes.push({x:rx*e2.canvas.width, y:ry*e2.canvas.height,
                               w:rw*e2.canvas.width, h:rh*e2.canvas.height});
          e2.redraw&&e2.redraw();
        });
      }
    } else {
      // לחיצה (בלי גרירה) על מלבן = ביטול המלבן הספציפי
      const b=hitBox(sx,sy);
      if(b){
        const mi=entry.manualBoxes.indexOf(b);
        if(mi>=0) entry.manualBoxes.splice(mi,1);   // מלבן ידני -> הסרה
        else entry.suppressed.add(key(b));          // מלבן אוטומטי -> דיכוי
      }
    }
    redraw(); };
  entry.redraw=redraw; redraw();
}

async function ocrEntry(f, entry, btn){
  if(typeof Tesseract==='undefined'){ btn.textContent='OCR לא זמין (אין רשת?)'; return; }
  btn.disabled=true; btn.textContent='מריץ OCR... (עשוי לקחת זמן)';
  try{
    const worker=await Tesseract.createWorker({
      workerPath: 'vendor/tesseract-worker.min.js',
      corePath:   'vendor/',
      langPath:   'vendor/lang/',
      gzip: true
    });
    await worker.loadLanguage('heb+eng');
    await worker.initialize('heb+eng');
    const {data}=await worker.recognize(entry.canvas);
    await worker.terminate();
    const words=(data.words||[]);
    const fullText=words.map(w=>w.text).join(' ');
    syncDetectors();
    scanText(fullText).forEach(h=>addFinding(f,h));
    renderFindings();
    const targets=activeFor(f).map(a=>normSpaceless(a.value)).filter(t=>t.length>=2);
    let boxed=0;
    words.forEach(w=>{
      const nw=normSpaceless(w.text); if(nw.length<3) return;
      // התאמה דו-כיוונית עם סף של 3 תווים לכל צד. בגרסה הקודמת מילה בת שני
      // תווים הכילה חצי מהיעדים והשחירה אזורים שלמים בלי סיבה.
      if(targets.some(t=> t.length>=3 && (t===nw || t.includes(nw) || nw.includes(t)))){
        const b=w.bbox||{}; if(b.x1>b.x0){ entry.manualBoxes.push({x:b.x0,y:b.y0,w:b.x1-b.x0,h:b.y1-b.y0}); boxed++; }
      }
    });
    entry.redraw();
    btn.textContent=`OCR הושלם, ${boxed} אזורים סומנו. ניתן להוסיף ידנית.`;
  }catch(e){ console.error(e); btn.textContent='שגיאת OCR: '+e.message; }
  btn.disabled=false;
}

async function forceTextMode(f){
  const status=document.getElementById('status');
  try{
    // קריאה מחדש של הטקסט מהקובץ (למקרה של שכבת OCR מ-ABBYY)
    const buf=await f.file.arrayBuffer();
    const pdf=await pdfjsLib.getDocument({data:buf}).promise;
    let txt='';
    for(let p=1;p<=pdf.numPages;p++){
      const page=await pdf.getPage(p);
      const tc=await page.getTextContent();
      txt+=tc.items.map(i=>fixHebFinals(i.str)).join(' ')+'\n';
    }
    f.text=txt;
    if(normSpaceless(txt).length<5){
      status.textContent='לא נמצאה שכבת טקסט בקובץ '+f.name+', כנראה עדיין סרוק. יש להמיר ב-ABBYY ל-searchable PDF.';
      return;
    }
    f.scanned=false; f.pages=null;
    syncDetectors();
    state.findings=state.findings.filter(x=>x.fileId!==f.id);
    scanText(f.text).forEach(h=>addFinding(f,h));
    renderFindings(); renderVisual();
    status.textContent='הקובץ '+f.name+' טופל כטקסט, הזיהוי רץ אוטומטית.';
  }catch(e){ console.error(e); status.textContent='שגיאה: '+e.message; }
}

function renderVisual(){
  const card=document.getElementById('imgcard'), area=document.getElementById('imgarea');
  const files=state.files.filter(f=>f.isImage||f.isPdf);
  if(!files.length){ card.style.display='none'; return; }
  card.style.display='block'; area.innerHTML='';
  // כפתור לביטול כל ההשחרות (אוטומטיות + ידניות)
  const clearBar=document.createElement('div');
  clearBar.style.cssText='display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:6px';
  const allLbl=document.createElement('label');
  allLbl.style.cssText='display:flex;align-items:center;gap:7px;font-size:12.5px;cursor:pointer';
  const allCb=document.createElement('input');
  allCb.type='checkbox'; allCb.className='chk'; allCb.checked=state.allPages;
  allCb.onchange=()=>{ state.allPages=allCb.checked; };
  allLbl.appendChild(allCb);
  allLbl.appendChild(document.createTextNode('החל מלבן חדש על כל העמודים'));
  const clearBtn=document.createElement('button'); clearBtn.className='mini';
  clearBtn.textContent='בטל את כל ההשחרות (כולל אוטומטיות)';
  clearBtn.onclick=clearAllRedactions;
  clearBar.appendChild(allLbl); clearBar.appendChild(clearBtn); area.appendChild(clearBar);
  files.forEach(f=>{
    // בונים קנבס מתמונה (אם עדיין לא)
    if(f.isImage && !f.pages){
      const canvas=document.createElement('canvas');
      const img=new Image();
      const entry={canvas, autoBoxes:[], manualBoxes:[], label:f.name, img, __file:f};
      f.pages=[entry];
      img.onload=()=>{ canvas.width=img.width; canvas.height=img.height; setupCanvas(entry); };
      img.src=URL.createObjectURL(f.file);
    }
    // כותרת הקובץ + בקרות ברמת המסמך
    const head=document.createElement('div'); head.className='hint';
    head.style.cssText='display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:14px 0 4px;font-weight:500;color:var(--ink)';
    const title=document.createElement('span'); title.textContent='📄 '+f.name; head.appendChild(title);
    if(f.scanned){
      const abbyy=document.createElement('button'); abbyy.className='mini';
      abbyy.textContent='עבר OCR ב-ABBYY? טפל כטקסט'; abbyy.onclick=()=>forceTextMode(f);
      head.appendChild(abbyy);
    }
    // שדה: השחר טקסט נוסף בכל המסמך
    const term=document.createElement('input'); term.type='text'; term.placeholder='הקלד מילה/שם והקש Enter, יושחר בכל המסמך';
    term.style.cssText='flex:1;min-width:220px;font-size:12.5px;padding:7px 10px';
    term.onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); addRedactionTerm(f, term.value.trim()); term.value=''; } };
    head.appendChild(term);
    area.appendChild(head);

    (f.pages||[]).forEach(entry=>{
      const wrap=document.createElement('div'); wrap.className='imgcanvaswrap';
      const bar=document.createElement('div'); bar.className='imgtitle';
      const name=document.createElement('span'); name.textContent=entry.label||f.name;
      const btns=document.createElement('span'); btns.style.display='flex'; btns.style.gap='8px';
      const pageIsScanned = f.isImage ||
        (f.pageScanned ? !!f.pageScanned[(entry.pageNum||1)-1] : !!f.scanned);
      if(pageIsScanned){
        const ocr=document.createElement('button'); ocr.className='mini'; ocr.textContent='OCR, זהה וסמן';
        ocr.onclick=()=>ocrEntry(f, entry, ocr); btns.appendChild(ocr);
      }
      const undo=document.createElement('button'); undo.className='mini'; undo.textContent='בטל מלבן ידני אחרון';
      undo.onclick=()=>{ entry.manualBoxes.pop(); entry.redraw&&entry.redraw(); };
      btns.appendChild(undo);
      bar.appendChild(name); bar.appendChild(btns);
      wrap.appendChild(bar); wrap.appendChild(entry.canvas); area.appendChild(wrap);
      if(entry.canvas.width && !entry.img) setupCanvas(entry);   // עמוד PDF כבר מרונדר
    });
  });
}

/* מבטל את כל ההשחרות: מבטל סימון כל הממצאים ומנקה מלבנים אוטומטיים+ידניים */
function clearAllRedactions(){
  state.findings.forEach(fd=>fd.checked=false);
  state.files.forEach(f=>{ (f.pages||[]).forEach(e=>{ e.autoBoxes=[]; e.manualBoxes=[]; e.redraw&&e.redraw(); }); });
  renderFindings();
  const st=document.getElementById('status'); if(st) st.textContent='כל ההשחרות בוטלו. אפשר לסמן מחדש בטבלת הממצאים או לצייר ידנית.';
}

/* מוסיף מונח להשחרה בכל המסמך: מוסיף לרשימה, מעדכן ממצאים ומלבנים */
function addRedactionTerm(f, term){
  if(!term) return;
  // מוסיפים לרשימת השמות (כדי שיחול גם על Word/Excel) ולממצאים
  const ta=document.getElementById('names');
  if(normSpaceless(ta.value).indexOf(normSpaceless(term))===-1) ta.value=(ta.value?ta.value+'\n':'')+term;
  addFinding(f,{type:'name', value:term});
  computeAutoBoxes(f);
  (f.pages||[]).forEach(e=>e.redraw&&e.redraw());
  renderFindings();
}

/* ============ הפקת קבצים נקיים ============ */
/* שלב 4: יצוא Markdown נקי ל-LLM, טקסט אחרי החלפת נתונים אישיים בתוויות ([שם], [ת"ז]...) */
function buildRedactedMarkdown(){
  const parts=[];
  const skipped=[];
  for(const f of state.files){
    if(!f.text || !f.text.trim()){ skipped.push(f.name); continue; }
    const clean=redactPlain(f.text, buildTargets(f));
    parts.push('# '+f.name+'\n\n'+clean.trim()+'\n');
  }
  if(!parts.length) return null;
  let md=parts.join('\n---\n\n');
  if(skipped.length){
    md+='\n---\n\n> הערה: הקבצים הבאים הם תמונות/סריקות ללא שכבת טקסט ולכן אינם כלולים כאן: '+skipped.join(', ')+'. עבורם יש להשתמש בקובץ המושחר (PDF תמונה / תמונה).\n';
  }
  return new Blob([md], {type:'text/markdown;charset=utf-8'});
}

async function downloadClean(){
  const dl=document.getElementById('dlstatus'); dl.textContent='מפיק...';
  resetDownloads();
  const outputs=[];
  for(const f of state.files){
    try{
      let r=null;
      if(f.ext==='xlsx'||f.ext==='xls'){ r=await exportExcel(f,'xlsx'); }
      else if(f.ext==='csv'){ r=await exportExcel(f,'csv'); }
      else if(f.ext==='docx'){ dl.textContent='מפיק Word...'; r=await exportDocx(f); }
      else if(f.ext==='pdf'){ dl.textContent='מפיק PDF...'; r=await exportPdf(f); }
      else if(f.isImage){ r=await exportImage(f); }
      if(r) outputs.push(r);
    }catch(e){console.error(e); dl.textContent='שגיאה ב-'+f.name+': '+e.message;}
  }
  if(document.getElementById('mdout')?.checked){
    const mdBlob=buildRedactedMarkdown();
    if(mdBlob) outputs.push({blob:mdBlob, name:'redacted.md'});
  }
  if(!outputs.length){ dl.textContent='לא הופקו קבצים.'; return; }
  if(outputs.length===1){
    dl.textContent='מוכן:';
    offerDownload(outputs[0].blob, outputs[0].name);
  } else {
    dl.textContent='אורז ל-ZIP...';
    const zip=new JSZip();
    outputs.forEach(o=>zip.file(o.name, o.blob));
    const zb=await zip.generateAsync({type:'blob'});
    dl.textContent=`${outputs.length} קבצים מוכנים בקובץ ZIP אחד:`;
    offerDownload(zb, 'קבצים_נקיים.zip');
  }
  // קובץ המפתח מוצע בנפרד ובכוונה, ולא נכנס ל-ZIP, כדי שלא יועלה למודל בטעות
  if(state.mode==='token'){
    const kb=buildKeyFile();
    if(kb) offerDownload(kb, 'מפתח פענוח - לא להעלות למודל.txt', true);
  }
  const stripped=state.files.reduce((n,f)=>n+(f.strippedMedia||0),0);
  if(stripped) dl.textContent+=` הוסרו ${stripped} תמונות/אובייקטים מוטמעים.`;
  await verifyOutputs(outputs);
}
/* מציג כפתור הורדה שהמשתמש לוחץ עליו. לחיצה יזומה לא נחסמת ע"י הדפדפן */
let _urls=[];
function resetDownloads(){
  _urls.forEach(u=>{ try{URL.revokeObjectURL(u);}catch(e){} });
  _urls=[];
  const links=document.getElementById('dllinks'); if(links) links.innerHTML='';
  const v=document.getElementById('verify'); if(v) v.innerHTML='';
}
function offerDownload(blob, name, ghost){
  const links=document.getElementById('dllinks');
  const url=URL.createObjectURL(blob); _urls.push(url);
  const a=document.createElement('a');
  a.href=url; a.download=name;
  a.className='btn'+(ghost?' ghost':'');
  a.style.cssText='text-decoration:none;margin-top:12px;margin-left:10px;display:inline-flex';
  a.textContent='⬇ הורד: '+name;
  links.appendChild(a);
}

/* ============ אימות הפלט ============
   ערכו של כלי השחרה נמדד ביכולת להוכיח שההשחרה עבדה. לכן אחרי ההפקה מחלצים
   טקסט מהקובץ שנוצר ובודקים שאף ערך מאושר לא שרד בו, וגם לא בשם הקובץ. */
async function extractOutputText(name, blob){
  const ext=(name.split('.').pop()||'').toLowerCase();
  try{
    if(ext==='xlsx'||ext==='xls'||ext==='csv'){
      const wb=XLSX.read(new Uint8Array(await blob.arrayBuffer()),{type:'array'});
      let t='';
      wb.SheetNames.forEach(sn=>{
        t+=sn+'\n';
        const ws=wb.Sheets[sn];
        XLSX.utils.sheet_to_json(ws,{header:1,defval:''}).forEach(r=>t+=r.join(' ')+'\n');
        Object.keys(ws).forEach(k=>{ const c=ws[k]; if(c&&c.f) t+=' '+c.f; if(c&&c.l&&c.l.Target) t+=' '+c.l.Target; });
      });
      return t;
    }
    if(ext==='docx'){
      const zip=await JSZip.loadAsync(await blob.arrayBuffer());
      let t='';
      for(const n of Object.keys(zip.files)){
        const ent=zip.files[n];
        if(!ent || ent.dir) continue;           // רשומת תיקייה: zip.file() מחזיר null
        if(/^word\/.*\.xml$/.test(n) || /^docProps\/.*\.xml$/.test(n))
          t+=' '+(await ent.async('string')).replace(/<[^>]+>/g,' ');
      }
      return unescapeXml(t);
    }
    if(ext==='pdf'){
      const pdf=await pdfjsLib.getDocument({data:new Uint8Array(await blob.arrayBuffer())}).promise;
      let t='';
      for(let p=1;p<=pdf.numPages;p++){
        const tc=await (await pdf.getPage(p)).getTextContent();
        t+=tc.items.map(i=>fixHebFinals(i.str)).join(' ')+'\n';
      }
      return t;
    }
    if(ext==='md'||ext==='txt') return await blob.text();
  }catch(e){ console.error(e); return null; }
  return '';   // תמונה: אין שכבת טקסט לחלץ
}

async function verifyOutputs(outputs){
  const box=document.getElementById('verify'); if(!box) return;
  box.innerHTML='<div class="hint">מאמת את הקבצים שהופקו...</div>';
  const rows=[];
  for(const o of outputs){
    const src = o.srcId ? state.files.find(x=>x.id===o.srcId) : null;
    const act = src ? activeFor(src) : state.files.reduce((acc,x)=>acc.concat(activeFor(x)),[]);
    const vals = [...new Set(act.map(a=>normSpaceless(a.value)).filter(v=>v.length>=2))];
    const txt = await extractOutputText(o.name, o.blob);
    const nameHits = vals.filter(v=>normSpaceless(o.name).includes(v));
    if(txt===null){ rows.push({name:o.name, ok:null, checked:vals.length, hits:[], nameHits}); continue; }
    const big = normSpaceless(txt);
    const hits = vals.filter(v=>big.includes(v));
    rows.push({name:o.name, ok:(hits.length===0 && nameHits.length===0), checked:vals.length,
               hits:hits.slice(0,6), hitCount:hits.length, nameHits, noText:big.length<3});
  }
  const bad=rows.filter(r=>r.ok===false);
  const head = bad.length
    ? '<b style="color:#b42318">אימות: נמצאו שרידים ב-'+bad.length+' קבצים</b>'
    : '<b style="color:#067647">אימות עבר: לא נמצא אף ערך מאושר בקבצים שהופקו</b>';
  box.innerHTML =
    '<div class="hint" style="margin-top:14px;line-height:1.7">'+head+
    '<table style="margin-top:10px"><thead><tr><th>קובץ</th><th>ערכים שנבדקו</th><th>תוצאה</th></tr></thead><tbody>'+
    rows.map(r=>{
      let cell;
      if(r.ok===null) cell='<span style="color:#b54708">לא ניתן לחלץ טקסט לבדיקה</span>';
      else if(r.ok)   cell='<span style="color:#067647">נקי'+(r.noText?', אין שכבת טקסט כלל':'')+'</span>';
      else cell='<span style="color:#b42318">'+r.hitCount+' שרידים'+
                (r.hits.length?': '+r.hits.map(escapeHtml).join(', '):'')+
                (r.nameHits.length?' (גם בשם הקובץ)':'')+'</span>';
      return '<tr><td>'+escapeHtml(r.name)+'</td><td>'+r.checked+'</td><td>'+cell+'</td></tr>';
    }).join('')+
    '</tbody></table>'+
    (bad.length && state.pdfMode==='text'
      ? '<div style="margin-top:10px">שרידים ב-PDF הם התוצאה הצפויה של מצב "טקסטואלי", שמצייר מלבן מעל טקסט שנשאר קיים. להעלאה למודל יש להפיק שוב במצב "תמונה".</div>'
      : (bad.length ? '<div style="margin-top:10px">בדקו את הממצאים המסומנים ואת מצב ההפקה, והפיקו שוב לפני העברת הקבצים.</div>' : ''))+
    '</div>';
}

/* עזר: אילו ממצאים פעילים לקובץ, וכל הטוקנים שלהם */
function activeFor(f){ return state.findings.filter(x=>x.fileId===f.id && x.checked)
  .sort((a,b)=>b.value.length-a.value.length); }

/* יעדי החלפה מנורמלים (ללא רווחים/ניקוד) + מחרוזת חלופה */
function buildTargets(f){
  return activeFor(f).map(a=>({tz:normSpaceless(a.value), rep:applyMode(a.value,a.type)}))
    .filter(t=>t.tz.length>=2);
}

/* ליבת הסתרה על פני מקטעי טקסט (runs), תופס גם ערך מפוצל בין מקטעים */
function redactCore(runs, targets){
  // תא לכל תו בכל המקטעים
  const cells=[];               // {ri, ch}
  runs.forEach((t,ri)=>{ for(const ch of t) cells.push({ri, ch}); });
  // רצף מנורמל ללא רווחים -> מיפוי לאינדקס התא
  const nzIdx=[], nzChar=[];
  cells.forEach((c,idx)=>{ const n=normHeb(c.ch); if(n && !/\s/.test(n)){ nzChar.push(n); nzIdx.push(idx); } });
  const NZ=nzChar.join('');
  const del=new Array(cells.length).fill(false);
  const ins={};
  targets.forEach(t=>{
    let from=0,pos;
    while((pos=NZ.indexOf(t.tz, from))!==-1){
      const start=nzIdx[pos], end=nzIdx[pos+t.tz.length-1];
      ins[start]=(ins[start]||'')+t.rep;
      for(let k=start;k<=end;k++) del[k]=true;
      from=pos+t.tz.length;
    }
  });
  const buf=runs.map(()=>[]);
  cells.forEach((c,idx)=>{ if(ins[idx]) buf[c.ri].push(ins[idx]); if(!del[idx]) buf[c.ri].push(c.ch); });
  return buf.map(a=>a.join(''));
}
function redactPlain(text, targets){ return redactCore([text||''], targets)[0]; }
function unescapeXml(s){ return (s||'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&'); }
function escapeXml(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* Excel: מחליף תא-תא, שומר RTL */
async function exportExcel(f, kind){
  const wb=f.workbook, targets=buildTargets(f);
  wb.SheetNames.forEach(sn=>{
    const ws=wb.Sheets[sn];
    ws['!sheetViews']=[{RTL:true}];
    Object.keys(ws).forEach(cell=>{
      if(cell[0]==='!')return;
      const c=ws[cell];
      if(!c) return;
      if(typeof c.v==='string'){
        const v=redactPlain(c.v, targets);
        c.v=v; if(c.w)c.w=v;
      } else if(typeof c.v==='number'){
        // תא מספרי: ת"ז, טלפון וחשבון עלולים להישמר כמספר, חובה לבדוק גם אותם
        const sv=String(c.v);
        const v=redactPlain(sv, targets);
        if(v!==sv){ c.t='s'; c.v=v; c.w=v; delete c.z; }
      }
      // נוסחה, הערת תא וקישור: שלושה מקומות שלא נגעו בהם קודם וערך יכול לשרוד בכל אחד
      if(c.f){ const nf=redactPlain(String(c.f), targets); if(nf!==c.f) c.f=nf; }
      if(Array.isArray(c.c)) c.c.forEach(cm=>{ if(!cm) return; if(cm.t) cm.t=redactPlain(String(cm.t),targets); cm.a=''; });
      if(c.l){
        if(c.l.Target)  c.l.Target =redactPlain(String(c.l.Target), targets);
        if(c.l.Tooltip) c.l.Tooltip=redactPlain(String(c.l.Tooltip), targets);
      }
    });
  });
  // שם גיליון כמו "כרטסת לקוח X" הוא דליפה בפני עצמה
  const usedNames=new Set();
  [...wb.SheetNames].forEach((sn,i)=>{
    let nn=redactPlain(sn, targets).replace(/[\[\]:*?\/\\]/g,'').trim().slice(0,31);
    if(!nn) nn='גיליון '+(i+1);
    const base=nn; let k=2;
    while(usedNames.has(nn) || (nn!==sn && wb.Sheets[nn])){ nn=(base+' '+k).slice(0,31); k++; }
    usedNames.add(nn);
    if(nn!==sn){ wb.Sheets[nn]=wb.Sheets[sn]; delete wb.Sheets[sn]; wb.SheetNames[i]=nn; }
  });
  wb.Workbook={...(wb.Workbook||{}), Views:[{RTL:true}]};
  wb.Props={...(wb.Props||{}), Author:'', LastAuthor:'', Company:'', Manager:'', Title:'', Subject:''};
  const out=XLSX.write(wb,{bookType:kind,type:'array'});
  return {name:cleanName(f, kind), blob:new Blob([out]), srcId:f.id};
}

/* Word: עריכה בתוך ה-docx עצמו, מקטע-מודע (כולל כותרות/תחתונות) */
async function exportDocx(f){
  const buf=await f.file.arrayBuffer();
  const zip=await JSZip.loadAsync(buf);
  const targets=buildTargets(f);
  // comments ו-commentsExtended לא נכללו קודם, ולכן הערות סוקר עם שמות שרדו
  const parts=Object.keys(zip.files).filter(n=>
    /word\/(document|header\d*|footer\d*|footnotes|endnotes|comments|commentsExtended)\.xml$/.test(n));
  for(const name of parts){
    let xml=await zip.file(name).async('string');
    // מעבד כל פסקה בנפרד: אוסף את מקטעי ה-<w:t>, מסתיר על פניהם, ומחזיר
    xml=xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, para=>{
      // גם delText: טקסט שנמחק במעקב שינויים אינו יושב ב-w:t, ולכן שרד קודם
      const re=/(<w:(?:t|delText)\b[^>]*>)([\s\S]*?)(<\/w:(?:t|delText)>)/g;
      const inners=[]; let m;
      while((m=re.exec(para))!==null) inners.push(unescapeXml(m[2]));
      if(!inners.length) return para;
      const out=redactCore(inners, targets);
      let i=0;
      return para.replace(re,(mm,open,txt,close)=> open+escapeXml(out[i++])+close);
    });
    // שמות מגיבים ועורכים בתוך התגיות עצמן
    xml=xml.replace(/w:author="[^"]*"/g,'w:author=""')
           .replace(/w:initials="[^"]*"/g,'w:initials=""');
    zip.file(name, xml);
  }
  if(zip.file('word/people.xml')){
    let pp=await zip.file('word/people.xml').async('string');
    pp=pp.replace(/w15:author="[^"]*"/g,'w15:author=""');
    zip.file('word/people.xml', pp);
  }
  // תמונות ואובייקטים מוטמעים אינם נסרקים על ידי הכלי. צילום מסך של דף בנק או
  // עמוד סרוק שהודבק למסמך היה שורד במלואו, ולכן מחליפים אותם בתמונה ריקה.
  f.strippedMedia=0;
  if(state.stripMedia){
    const px=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='), ch=>ch.charCodeAt(0));
    const isFile=n=>zip.files[n] && !zip.files[n].dir;
    Object.keys(zip.files).filter(n=>/^word\/media\//i.test(n) && isFile(n))
      .forEach(n=>{ zip.file(n, px); f.strippedMedia++; });
    const emb=Object.keys(zip.files).filter(n=>/^word\/embeddings\//i.test(n) && isFile(n));
    emb.forEach(n=>{ zip.remove(n); f.strippedMedia++; });
    if(emb.length && zip.file('word/_rels/document.xml.rels')){
      let r=await zip.file('word/_rels/document.xml.rels').async('string');
      r=r.replace(/<Relationship\b[^>]*embeddings\/[^>]*\/>/g,'');
      zip.file('word/_rels/document.xml.rels', r);
    }
  }
  // ניקוי מטא-דאטה של המסמך (יוצר, כותרת וכו')
  if(zip.file('docProps/core.xml')){
    let c=await zip.file('docProps/core.xml').async('string');
    ['dc:creator','cp:lastModifiedBy','dc:title','dc:subject','cp:keywords','dc:description'].forEach(tag=>{
      c=c.replace(new RegExp('(<'+tag+'[^>]*>)[\\s\\S]*?(</'+tag+'>)'),'$1$2');
    });
    zip.file('docProps/core.xml', c);
  }
  if(zip.file('docProps/app.xml')){
    let a=await zip.file('docProps/app.xml').async('string');
    ['Company','Manager'].forEach(tag=>{ a=a.replace(new RegExp('(<'+tag+'[^>]*>)[\\s\\S]*?(</'+tag+'>)'),'$1$2'); });
    zip.file('docProps/app.xml', a);
  }
  const out=await zip.generateAsync({type:'blob',
    mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
  return {name:cleanName(f,'docx'), blob:out, srcId:f.id};
}

/* מנקה מטא-דאטה מ-PDF (מסיר Producer/Author/Title וכו') */
function scrubPdfMeta(doc){
  try{
    doc.setTitle(''); doc.setAuthor(''); doc.setSubject('');
    doc.setKeywords([]); doc.setProducer(''); doc.setCreator('');
    const z=new Date(0); doc.setCreationDate(z); doc.setModificationDate(z);
  }catch(e){}
}

/* PDF: מפיק מעמודי התצוגה המקדימה (עם כל המלבנים האוטומטיים והידניים) */
async function exportPdf(f){
  computeAutoBoxes(f);                 // רענון לפי הממצאים המאושרים העדכניים
  if(state.pdfMode==='text') return await exportPdfTextual(f);
  const outDoc=await PDFLib.PDFDocument.create();
  for(const entry of (f.pages||[])){
    if(entry.redraw) entry.redraw();   // מצייר base + מלבנים לתוך הקנבס
    // JPEG ברזולוציה נמוכה ובינונית, PNG רק במצב איכות גבוהה. ספר של 40 עמודים
    // ב-PNG יצא כבד מדי להעלאה למודל.
    const sc=state.pdfScale||2;
    const useJpg = sc<3;
    const durl = useJpg ? entry.canvas.toDataURL('image/jpeg', sc<=1.5?0.82:0.9)
                        : entry.canvas.toDataURL('image/png');
    const bytes=dataURLtoBytes(durl);
    const img = useJpg ? await outDoc.embedJpg(bytes) : await outDoc.embedPng(bytes);
    const pg=outDoc.addPage([entry.canvas.width, entry.canvas.height]);
    pg.drawImage(img,{x:0,y:0,width:entry.canvas.width,height:entry.canvas.height});
  }
  scrubPdfMeta(outDoc);
  // updateMetadata:false, אחרת pdf-lib כותב מחדש Producer ותאריכים ומבטל את הניקוי
  const out=await outDoc.save({updateMetadata:false});
  return {name:cleanName(f,'pdf'), blob:new Blob([out],{type:'application/pdf'}), srcId:f.id};
}

/* PDF טקסטואלי: שומר את הקובץ המקורי ומצייר מלבנים שחורים מעל האזורים.
   שים לב: הטקסט המקורי נשאר מתחת למלבן (הסתרה ויזואלית בלבד). */
async function exportPdfTextual(f){
  const orig=await PDFLib.PDFDocument.load(await f.file.arrayBuffer());
  const pages=orig.getPages();
  (f.pages||[]).forEach((entry,i)=>{
    const page=pages[i]; if(!page) return;
    const W=page.getWidth(), H=page.getHeight();
    const sx=W/entry.canvas.width, sy=H/entry.canvas.height;
    const boxes = entry.effective ? entry.effective() : [...(entry.autoBoxes||[]), ...(entry.manualBoxes||[])];
    boxes.forEach(b=>{
      page.drawRectangle({ x:b.x*sx, y:H-(b.y+b.h)*sy, width:b.w*sx, height:b.h*sy, color:PDFLib.rgb(0,0,0) });
    });
  });
  scrubPdfMeta(orig);
  // מצב טקסטואלי שומר את המסמך המקורי, ולכן חייבים לנקות גם את מה ש-Info לא מכסה:
  // מטא-דאטה מסוג XMP, שמות ויעדים, וכן הערות ושדות טופס שהערכים שלהם חשופים.
  try{ orig.catalog.delete(PDFLib.PDFName.of('Metadata')); }catch(e){}
  try{ orig.catalog.delete(PDFLib.PDFName.of('Names')); }catch(e){}
  try{ orig.catalog.delete(PDFLib.PDFName.of('AcroForm')); }catch(e){}
  pages.forEach(pg=>{ try{ pg.node.set(PDFLib.PDFName.of('Annots'), orig.context.obj([])); }catch(e){} });
  const out=await orig.save({updateMetadata:false});
  return {name:cleanName(f,'pdf'), blob:new Blob([out],{type:'application/pdf'}), srcId:f.id};
}
function dataURLtoBytes(d){
  const b=atob(d.split(',')[1]); const a=new Uint8Array(b.length);
  for(let i=0;i<b.length;i++) a[i]=b.charCodeAt(i); return a;
}

/* תמונה נקייה (מצייר את המלבנים לתוך הקנבס) */
async function exportImage(f){
  const entry=(f.pages||[])[0]; if(!entry||!entry.canvas)return null;
  entry.redraw&&entry.redraw();
  const blob=await new Promise(res=>entry.canvas.toBlob(res,'image/png'));
  return {name:cleanName(f,'png'), blob, srcId:f.id};
}

/* שם הקובץ הוא נתיב דליפה קלאסי: שם הלקוח יושב בו כמעט תמיד.
   לכן כל מונח מאושר מוסר גם ממנו, ואופציונלית השם מוחלף לגמרי. */
function cleanName(f, newExt){
  const idx = state.files.indexOf(f)+1;
  if(state.anonName) return 'מסמך_'+(idx||1)+'_נקי.'+newExt;
  const base=(f.name||'').replace(/\.[^.]+$/,'');
  let clean=redactPlain(base, buildTargets(f))
              .replace(/[\\/:*?"<>|]+/g,'_')
              .replace(/\s{2,}/g,' ')
              .trim();
  if(!clean) clean='מסמך_'+(idx||1);
  return clean+'_נקי.'+newExt;
}
/* ============ UI wiring ============ */
const drop=document.getElementById('drop'), fileInput=document.getElementById('file');
drop.onclick=()=>fileInput.click();
fileInput.onchange=e=>addFiles(e.target.files);
['dragover','dragenter'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('over');}));
['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('over');}));
drop.addEventListener('drop',e=>addFiles(e.dataTransfer.files));

// הדבקת תמונה מהלוח (Ctrl+V)
window.addEventListener('paste', e=>{
  const items=(e.clipboardData||{}).items||[];
  const imgs=[];
  for(const it of items){
    if(it.type && it.type.startsWith('image/')){
      const blob=it.getAsFile();
      if(blob) imgs.push(new File([blob], 'הדבקה_'+Date.now()+'.png', {type:blob.type||'image/png'}));
    }
  }
  if(imgs.length){ e.preventDefault(); addFiles(imgs); }
});

// מתג תצוגה בהירה/כהה
const themeBtn=document.getElementById('themeBtn');
const sunIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const moonIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>';
function applyTheme(t){
  document.documentElement.setAttribute('data-theme', t);
  themeBtn.innerHTML = t==='dark' ? sunIcon : moonIcon;
}
let theme = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
applyTheme(theme);
themeBtn.onclick=()=>{ theme = theme==='dark' ? 'light' : 'dark'; applyTheme(theme); };

// detectors UI
function buildDetectors(){
  const el=document.getElementById('detectors');
  el.innerHTML=Object.entries(DETECTORS).map(([k,d])=>
    `<button data-k="${k}" class="${d.on?'on':''}">${d.label}</button>`).join('');
  el.querySelectorAll('button').forEach(b=>b.onclick=()=>{b.classList.toggle('on');});
}
function syncDetectors(){
  document.querySelectorAll('#detectors button').forEach(b=>{
    state.detectors[b.dataset.k]=b.classList.contains('on');
  });
}
buildDetectors(); syncDetectors();
document.getElementById('detAll').onclick=()=>{ document.querySelectorAll('#detectors button').forEach(b=>b.classList.add('on')); };
document.getElementById('detNone').onclick=()=>{ document.querySelectorAll('#detectors button').forEach(b=>b.classList.remove('on')); };

// אופן הפקת PDF
document.querySelectorAll('#pdfmode button').forEach(b=>b.onclick=()=>{
  // מצב טקסטואלי מייצר קובץ שנראה מושחר אבל הטקסט קיים מתחת למלבן.
  // לכן הוא דורש אישור מפורש ולא רק אזהרה בטקסט.
  if(b.dataset.p==='text'){
    const okText=window.confirm(
      'אישור מצב "טקסטואלי"\n\n'+
      'במצב זה הטקסט המקורי נשאר בקובץ מתחת למלבן השחור, וניתן לחלץ אותו בהעתקה או בכלי אוטומטי.\n\n'+
      'אין להעלות קובץ כזה למודל שפה ואין להעביר אותו לגורם חיצוני.\n\n'+
      'להמשיך במצב טקסטואלי?');
    if(!okText) return;
  }
  document.querySelectorAll('#pdfmode button').forEach(x=>x.classList.remove('on'));
  b.classList.add('on'); state.pdfMode=b.dataset.p;
  document.getElementById('pdfmodehint').innerHTML = state.pdfMode==='text'
    ? '⚠️ מצב "טקסטואלי" שומר את הטקסט המקורי ומצייר מלבן שחור מעליו, <b>הטקסט המוסתר עדיין קיים מתחת למלבן וניתן לחילוץ</b>. מתאים להצגה ויזואלית, לא להעלאה בטוחה למודל.'
    : 'מצב "תמונה" ממיר כל עמוד לתמונה ומוחק את שכבת הטקסט, הנתון המוסתר לא ניתן לחילוץ. מומלץ להעלאה למודל.';
});

// רשימת שמות, סריקה מחדש אוטומטית אחרי עריכה
document.getElementById('names').addEventListener('change', ()=>{ if(state.files.length && state.findings.length) scan(); });

// mode
document.querySelectorAll('#mode button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('#mode button').forEach(x=>x.classList.remove('on'));
  b.classList.add('on'); state.mode=b.dataset.m;
});
// context names
document.querySelectorAll('.ctxbtn').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('.ctxbtn').forEach(x=>x.classList.remove('on'));
  b.classList.add('on'); state.ctxNames=b.dataset.v;
});

// רזולוציית ומשקל הפלט
document.querySelectorAll('#pdfres button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('#pdfres button').forEach(x=>x.classList.remove('on'));
  b.classList.add('on'); state.pdfScale=parseFloat(b.dataset.r)||2;
  const st=document.getElementById('status');
  if(st && state.files.some(f=>f.isPdf)) st.textContent='הרזולוציה שונתה. לחצו "סרוק קבצים" כדי לרנדר מחדש.';
});
const anonEl=document.getElementById('anonname');
if(anonEl) anonEl.onchange=e=>{ state.anonName=e.target.checked; };
const stripEl=document.getElementById('stripmedia');
if(stripEl){ state.stripMedia=stripEl.checked; stripEl.onchange=e=>{ state.stripMedia=e.target.checked; }; }

document.getElementById('scan').onclick=scan;
document.getElementById('download').onclick=downloadClean;
document.getElementById('selall').onclick=()=>{state.findings.forEach(f=>f.checked=true);renderFindings();};
document.getElementById('selnone').onclick=()=>{state.findings.forEach(f=>f.checked=false);renderFindings();};
