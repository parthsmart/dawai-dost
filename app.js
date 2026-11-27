/* Dawai Dost — voice-first medicine reminder prototype.
   All data lives in localStorage. Speech: Wispr Flow API (if key) -> browser SpeechRecognition.
   Understanding: Claude API (if key + online) -> built-in multilingual keyword parser. */
'use strict';

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */
const KEY = 'dawaiDost.v1';
const DEFAULT_STATE = () => ({
  lang: null, setupDone: false, meds: [], log: [], alerts: [], alertsSeen: 0,
  family: { name: '', phone: '' }, userName: '', famCalls: '',
  clockOffset: 0, wisprKey: '', claudeKey: ''
});
let S;
try { S = Object.assign(DEFAULT_STATE(), JSON.parse(localStorage.getItem(KEY) || '{}')); }
catch (e) { S = DEFAULT_STATE(); }
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

const MIN = 60000;
const now = () => Date.now() + (S.clockOffset || 0);
const uid = () => Math.random().toString(36).slice(2, 10);
const pad = n => String(n).padStart(2, '0');
const dateKey = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const atTime = (dk, hhmm) => { const [y, m, d] = dk.split('-').map(Number); const [h, mi] = hhmm.split(':').map(Number); return new Date(y, m - 1, d, h, mi, 0, 0).getTime(); };
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ------------------------------------------------------------------ */
/* Language packs                                                      */
/* ------------------------------------------------------------------ */
const LOCALE = { hi: 'hi-IN', ta: 'ta-IN', mr: 'mr-IN', en: 'en-IN' };

const PURPOSE = {
  hi: { bp: 'BP', sugar: 'शुगर', thyroid: 'थायराइड', heart: 'दिल', cholesterol: 'कोलेस्ट्रॉल', pain: 'दर्द', gas: 'गैस', vitamin: 'विटामिन', sleep: 'नींद' },
  mr: { bp: 'BP', sugar: 'शुगर', thyroid: 'थायरॉईड', heart: 'हृदय', cholesterol: 'कोलेस्टेरॉल', pain: 'दुखण्या', gas: 'ॲसिडिटी', vitamin: 'व्हिटॅमिन', sleep: 'झोपे' },
  ta: { bp: 'BP', sugar: 'சுகர்', thyroid: 'தைராய்டு', heart: 'இதய', cholesterol: 'கொலஸ்ட்ரால்', pain: 'வலி', gas: 'கேஸ்', vitamin: 'வைட்டமின்', sleep: 'தூக்க' },
  en: { bp: 'BP', sugar: 'sugar', thyroid: 'thyroid', heart: 'heart', cholesterol: 'cholesterol', pain: 'pain', gas: 'acidity', vitamin: 'vitamin', sleep: 'sleep' }
};
const COLOUR = {
  hi: { white: 'सफ़ेद', yellow: 'पीली', pink: 'गुलाबी', red: 'लाल', blue: 'नीली', green: 'हरी', orange: 'नारंगी', brown: 'भूरी' },
  mr: { white: 'पांढरी', yellow: 'पिवळी', pink: 'गुलाबी', red: 'लाल', blue: 'निळी', green: 'हिरवी', orange: 'नारंगी', brown: 'तपकिरी' },
  ta: { white: 'வெள்ளை', yellow: 'மஞ்சள்', pink: 'பிங்க்', red: 'சிவப்பு', blue: 'நீல', green: 'பச்சை', orange: 'ஆரஞ்சு', brown: 'பிரவுன்' },
  en: { white: 'white', yellow: 'yellow', pink: 'pink', red: 'red', blue: 'blue', green: 'green', orange: 'orange', brown: 'brown' }
};
const CSS_COLOUR = { white: '#FFFFFF', yellow: '#F7D533', pink: '#F59AC2', red: '#D6332F', blue: '#3F7FE0', green: '#3DAA55', orange: '#F28B1E', brown: '#8B5A2B' };

const NUMW = {
  hi: { 0.5: 'आधी', 1: 'एक', 2: 'दो', 3: 'तीन', 4: 'चार' },
  mr: { 0.5: 'अर्धी', 1: 'एक', 2: 'दोन', 3: 'तीन', 4: 'चार' },
  ta: { 0.5: 'அரை', 1: 'ஒரு', 2: 'இரண்டு', 3: 'மூன்று', 4: 'நான்கு' },
  en: { 0.5: 'half a', 1: 'one', 2: 'two', 3: 'three', 4: 'four' }
};

function slotOf(hhmm) { const h = +hhmm.split(':')[0]; return h >= 4 && h < 12 ? 'm' : h < 16 ? 'a' : h < 20 ? 'e' : 'n'; }
function h12(hhmm) { let [h, m] = hhmm.split(':').map(Number); const hh = h % 12 === 0 ? 12 : h % 12; return m ? `${hh}:${pad(m)}` : `${hh}`; }

const T = {
  hi: {
    tabs: ['होम', 'दवाइयाँ', 'परिवार', 'सेटिंग'],
    slot: { m: 'सुबह', a: 'दोपहर', e: 'शाम', n: 'रात' },
    at: (s, h) => `${s} ${h} बजे`, hourOnly: h => `${h} बजे`, and: ' और ',
    tablet: 'गोली', capsule: 'कैप्सूल', medicine: 'दवाई',
    label: (p, c, unit) => p && c ? `${p} की ${c} ${unit}` : p ? `${p} की ${unit}` : c ? `${c} ${unit}` : '',
    dose: n => n === 1 ? 'एक गोली' : n === 0.5 ? 'आधी गोली' : `${NUMW.hi[n] || n} गोलियाँ (${n})`,
    foodRb: { after: ', खाने के बाद', before: ', खाने से पहले', any: '' },
    foodSay: { after: 'खाने के बाद लेना।', before: 'खाने से पहले लेना।', any: '' },
    greet: 'नमस्ते! मैं आपका दवाई दोस्त हूँ। अपनी पहली दवाई के बारे में बताइये।',
    askNew: 'नई दवाई के बारे में बताइये। जैसे: BP की सफ़ेद गोली, सुबह एक, खाने के बाद।',
    askNext: 'अगली दवाई के बारे में बताइये।',
    readback: (l, t, d, f) => `समझ गया: ${l}, रोज़ ${t}, ${d}${f}। सही है?`,
    whatChange: 'क्या बदलना है?',
    doseCheck: n => `एक बार में ${NUMW.hi[n] || n} — यानी ${n} — गोलियाँ। पक्का?`,
    askStock: 'कितनी गोलियाँ बची हैं?',
    stockCheck: n => `${n} गोलियाँ बची हैं। सही है?`,
    askMore: 'और कोई दवाई?',
    saved: 'ठीक है, लिख ली।',
    setupDone: 'बहुत अच्छा! सब दवाइयाँ याद रख ली हैं। समय पर याद दिलाऊँगा।',
    notMed: 'माफ़ कीजिये, दवाई समझ नहीं आई। गोली का रंग, किस बीमारी की, और कब लेते हैं — बताइये।',
    sorry: 'माफ़ कीजिये, ठीक से सुनाई नहीं दिया। फिर से बोलिये।',
    needNet: 'नई दवाई जोड़ने के लिए इंटरनेट चाहिए। याद दिलाना बिना इंटरनेट के भी चलेगा।',
    offline: 'इंटरनेट नहीं है। याद दिलाना और बटन चालू हैं।',
    reminder: (n, l, f) => `${n}, अब ${l} खाने का समय है। ${f}`,
    repeat: 'फिर से याद दिला रहा हूँ। ',
    taken: 'बहुत अच्छा!', later: 'ठीक है, 15 मिनट बाद याद दिलाऊँगा।',
    already: 'यह गोली आप आज ले चुके हैं। दोबारा मत लीजिये।',
    doctor: 'यह डॉक्टर से पूछिये। क्या मैं परिवार को बता दूँ?',
    told: 'ठीक है, परिवार को बता दिया।', notTold: 'ठीक है।',
    missedAlert: (f, h, l) => `${f} ने ${h} की ${l} नहीं ली।`,
    missedSay: (h, l) => `आपकी ${h} की ${l} छूट गई। परिवार को बता दिया है।`,
    lowSay: (l, d) => `${l} सिर्फ़ ${d} दिन की बची है। परिवार को बता दिया है।`,
    lowAlert: (f, l, d, n) => `${f} की ${l} सिर्फ़ ${d} दिन की बची है (${n} गोलियाँ)। नई ले आइये।`,
    qAlert: (f, q) => `${f} ने दवाई के बारे में पूछा: "${q}"। कृपया उनसे बात कर लीजिये।`,
    stTaken: 'ले ली', stLeft: 'अभी बाकी है', stMissed: 'छूट गई', stLater: 'बाद में',
    statusIntro: 'आज: ', allDone: 'आज की सब दवाई हो गई। बहुत अच्छा!', noneToday: 'आज कोई दवाई नहीं है।',
    next: (l, day, t) => `अगली दवाई: ${l}, ${day}${t}।`, tomorrow: 'कल ', noMeds: 'अभी कोई दवाई नहीं जुड़ी है।',
    stockItem: (l, d) => `${l} — ${d} दिन की बची है।`, stockOk: 'सब दवाइयाँ काफ़ी हैं। कोई ख़त्म नहीं हो रही।',
    help: 'आप पूछ सकते हैं: आज की दवाई हो गई? अगली दवाई कब है? कौनसी गोली ख़त्म होने वाली है?',
    nothingDue: 'अभी कोई दवाई का समय नहीं है।',
    tapMic: 'बोलने के लिए दबाइये', listening: 'सुन रहा हूँ…', thinking: 'समझ रहा हूँ…', micOff: 'माइक बंद है — बटन दबाइये',
    micDenied: 'माइक की इजाज़त नहीं मिली। बटन से जवाब दीजिये। याद दिलाना बोलकर ही होगा।',
    yes: 'हाँ', no: 'नहीं', bas: 'बस', takenBtn: 'खा ली', laterBtn: 'बाद में',
    today: 'आज की दवाई', medsTitle: 'मेरी दवाइयाँ', addMed: '＋ नई दवाई जोड़ें', startSetup: 'दवाई जोड़ना शुरू करें',
    left: n => `${n} गोलियाँ बचीं`, days: d => `${d} दिन`, del: 'हटाएँ', refill: 'गोलियाँ बदलें',
    confirmDel: 'यह दवाई हटा दें?', refillAsk: 'अब कितनी गोलियाँ हैं?',
    qStatus: 'आज की दवाई हो गई?', qNext: 'अगली दवाई कब है?', qStock: 'कौनसी गोली ख़त्म होने वाली है?',
    setTitle: 'सेटिंग', setLang: 'भाषा', setNames: 'नाम', userName: 'ऐप आपको क्या बुलाए', famCalls: 'परिवार आपको क्या कहता है',
    setFam: 'परिवार का संपर्क', famName: 'नाम', famPhone: 'फ़ोन (WhatsApp)',
    setClock: 'टेस्ट घड़ी (डेमो के लिए)', setClockBtn: 'समय सेट करें', nextDose: 'अगली दवाई के समय पर जाएँ', realTime: 'असली समय',
    setVoice: 'आवाज़ और समझ (वैकल्पिक)', reset: 'सारा डेटा मिटाएँ', confirmReset: 'सारी दवाइयाँ और रिकॉर्ड मिट जाएँगे। पक्का?',
    talkTitle: 'दवाई जोड़ना', typeInstead: 'लिखकर बताएँ', noAlerts: 'अभी कोई अलर्ट नहीं।', simNote: 'यह WhatsApp संदेशों का नमूना है — असली संदेश नहीं भेजा जाता।',
    noFam: 'परिवार का संपर्क सेटिंग में जोड़ें', heardPrefix: 'आपने कहा: ',
    tapToHear: '🔊 सुनने के लिए दबाइये'
  },
  mr: {
    tabs: ['होम', 'औषधं', 'कुटुंब', 'सेटिंग'],
    slot: { m: 'सकाळी', a: 'दुपारी', e: 'संध्याकाळी', n: 'रात्री' },
    at: (s, h) => `${s} ${h} वाजता`, hourOnly: h => `${h} वाजता`, and: ' आणि ',
    tablet: 'गोळी', capsule: 'कॅप्सूल', medicine: 'औषध',
    label: (p, c, unit) => p && c ? `${p}ची ${c} ${unit}` : p ? `${p}ची ${unit}` : c ? `${c} ${unit}` : '',
    dose: n => n === 1 ? 'एक गोळी' : n === 0.5 ? 'अर्धी गोळी' : `${NUMW.mr[n] || n} गोळ्या (${n})`,
    foodRb: { after: ', जेवणानंतर', before: ', जेवणाआधी', any: '' },
    foodSay: { after: 'जेवणानंतर घ्या.', before: 'जेवणाआधी घ्या.', any: '' },
    greet: 'नमस्कार! मी तुमचा दवाई दोस्त आहे. तुमच्या पहिल्या औषधाबद्दल सांगा.',
    askNew: 'नवीन औषधाबद्दल सांगा. उदा: BPची पांढरी गोळी, सकाळी एक, जेवणानंतर.',
    askNext: 'पुढच्या औषधाबद्दल सांगा.',
    readback: (l, t, d, f) => `समजलं: ${l}, रोज ${t}, ${d}${f}. बरोबर आहे का?`,
    whatChange: 'काय बदलायचं आहे?',
    doseCheck: n => `एका वेळी ${NUMW.mr[n] || n} — म्हणजे ${n} — गोळ्या. नक्की?`,
    askStock: 'किती गोळ्या शिल्लक आहेत?',
    stockCheck: n => `${n} गोळ्या शिल्लक. बरोबर?`,
    askMore: 'अजून काही औषध आहे का?',
    saved: 'ठीक आहे, लिहून घेतलं.',
    setupDone: 'छान! सगळी औषधं लक्षात ठेवली. वेळेवर आठवण करून देईन.',
    notMed: 'माफ करा, औषध समजलं नाही. गोळीचा रंग, कशासाठी, आणि कधी घेता ते सांगा.',
    sorry: 'माफ करा, नीट ऐकू आलं नाही. पुन्हा बोला.',
    needNet: 'नवीन औषध जोडण्यासाठी इंटरनेट हवं. आठवण इंटरनेटशिवायही चालेल.',
    offline: 'इंटरनेट नाही. आठवण आणि बटणं चालू आहेत.',
    reminder: (n, l, f) => `${n}, आता ${l} घ्यायची वेळ झाली. ${f}`,
    repeat: 'पुन्हा आठवण करून देतो. ',
    taken: 'खूप छान!', later: 'ठीक आहे, १५ मिनिटांनी आठवण करून देईन.',
    already: 'ही गोळी तुम्ही आज घेतली आहे. पुन्हा घेऊ नका.',
    doctor: 'हे डॉक्टरांना विचारा. कुटुंबाला कळवू का?',
    told: 'ठीक आहे, कुटुंबाला कळवलं.', notTold: 'ठीक आहे.',
    missedAlert: (f, h, l) => `${f}ने ${h}ची ${l} घेतली नाही.`,
    missedSay: (h, l) => `तुमची ${h}ची ${l} राहिली. कुटुंबाला कळवलं आहे.`,
    lowSay: (l, d) => `${l} फक्त ${d} दिवसांची शिल्लक आहे. कुटुंबाला कळवलं आहे.`,
    lowAlert: (f, l, d, n) => `${f}ची ${l} फक्त ${d} दिवसांची शिल्लक आहे (${n} गोळ्या). नवीन आणा.`,
    qAlert: (f, q) => `${f}ने औषधाबद्दल विचारलं: "${q}". कृपया बोलून घ्या.`,
    stTaken: 'घेतली', stLeft: 'बाकी आहे', stMissed: 'राहिली', stLater: 'नंतर',
    statusIntro: 'आज: ', allDone: 'आजची सगळी औषधं झाली. छान!', noneToday: 'आज कोणतं औषध नाही.',
    next: (l, day, t) => `पुढचं औषध: ${l}, ${day}${t}.`, tomorrow: 'उद्या ', noMeds: 'अजून कोणतं औषध जोडलं नाही.',
    stockItem: (l, d) => `${l} — ${d} दिवसांची शिल्लक.`, stockOk: 'सगळी औषधं पुरेशी आहेत.',
    help: 'तुम्ही विचारू शकता: आजची औषधं झाली का? पुढचं औषध कधी? कोणती गोळी संपणार आहे?',
    nothingDue: 'आत्ता कोणत्याही औषधाची वेळ नाही.',
    tapMic: 'बोलण्यासाठी दाबा', listening: 'ऐकतोय…', thinking: 'समजून घेतोय…', micOff: 'माइक बंद आहे — बटण दाबा',
    micDenied: 'माइकची परवानगी नाही. बटणाने उत्तर द्या. आठवण बोलूनच होईल.',
    yes: 'हो', no: 'नाही', bas: 'बस', takenBtn: 'घेतली', laterBtn: 'नंतर',
    today: 'आजची औषधं', medsTitle: 'माझी औषधं', addMed: '＋ नवीन औषध जोडा', startSetup: 'औषध जोडायला सुरुवात करा',
    left: n => `${n} गोळ्या शिल्लक`, days: d => `${d} दिवस`, del: 'काढा', refill: 'गोळ्या बदला',
    confirmDel: 'हे औषध काढायचं?', refillAsk: 'आता किती गोळ्या आहेत?',
    qStatus: 'आजची औषधं झाली का?', qNext: 'पुढचं औषध कधी?', qStock: 'कोणती गोळी संपणार आहे?',
    setTitle: 'सेटिंग', setLang: 'भाषा', setNames: 'नाव', userName: 'ॲपने तुम्हाला काय म्हणावं', famCalls: 'कुटुंब तुम्हाला काय म्हणतं',
    setFam: 'कुटुंबाचा संपर्क', famName: 'नाव', famPhone: 'फोन (WhatsApp)',
    setClock: 'टेस्ट घड्याळ (डेमोसाठी)', setClockBtn: 'वेळ सेट करा', nextDose: 'पुढच्या औषधाच्या वेळेवर जा', realTime: 'खरी वेळ',
    setVoice: 'आवाज आणि समज (ऐच्छिक)', reset: 'सगळा डेटा पुसा', confirmReset: 'सगळी औषधं आणि नोंदी पुसल्या जातील. नक्की?',
    talkTitle: 'औषध जोडणे', typeInstead: 'लिहून सांगा', noAlerts: 'अजून कोणताही अलर्ट नाही.', simNote: 'हा WhatsApp संदेशांचा नमुना आहे — खरा संदेश पाठवला जात नाही.',
    noFam: 'सेटिंगमध्ये कुटुंबाचा संपर्क जोडा', heardPrefix: 'तुम्ही म्हणालात: ',
    tapToHear: '🔊 ऐकण्यासाठी दाबा'
  },
  ta: {
    tabs: ['முகப்பு', 'மாத்திரை', 'குடும்பம்', 'அமைப்பு'],
    slot: { m: 'காலை', a: 'மதியம்', e: 'மாலை', n: 'இரவு' },
    at: (s, h) => `${s} ${h} மணி`, hourOnly: h => `${h} மணி`, and: ' மற்றும் ',
    tablet: 'மாத்திரை', capsule: 'கேப்சூல்', medicine: 'மாத்திரை',
    label: (p, c, unit) => p && c ? `${p} ${c} ${unit}` : p ? `${p} ${unit}` : c ? `${c} ${unit}` : '',
    dose: n => n === 1 ? 'ஒரு மாத்திரை' : n === 0.5 ? 'அரை மாத்திரை' : `${NUMW.ta[n] || n} மாத்திரை (${n})`,
    foodRb: { after: ', சாப்பாட்டுக்குப் பிறகு', before: ', சாப்பாட்டுக்கு முன்', any: '' },
    foodSay: { after: 'சாப்பாட்டுக்குப் பிறகு எடுங்கள்.', before: 'சாப்பாட்டுக்கு முன் எடுங்கள்.', any: '' },
    greet: 'வணக்கம்! நான் உங்கள் தவா தோஸ்த். உங்கள் முதல் மாத்திரை பற்றி சொல்லுங்கள்.',
    askNew: 'புதிய மாத்திரை பற்றி சொல்லுங்கள். உதாரணம்: BP வெள்ளை மாத்திரை, காலை ஒன்று, சாப்பாட்டுக்குப் பிறகு.',
    askNext: 'அடுத்த மாத்திரை பற்றி சொல்லுங்கள்.',
    readback: (l, t, d, f) => `புரிந்தது: ${l}, தினமும் ${t}, ${d}${f}. சரியா?`,
    whatChange: 'என்ன மாற்ற வேண்டும்?',
    doseCheck: n => `ஒரு நேரத்தில் ${NUMW.ta[n] || n} — அதாவது ${n} — மாத்திரை. உறுதியா?`,
    askStock: 'எத்தனை மாத்திரை மீதி இருக்கு?',
    stockCheck: n => `${n} மாத்திரை மீதி. சரியா?`,
    askMore: 'வேற ஏதாவது மாத்திரை இருக்கா?',
    saved: 'சரி, குறித்துக்கொண்டேன்.',
    setupDone: 'நல்லது! எல்லா மாத்திரையும் நினைவில் வைத்தேன். நேரத்துக்கு நினைவூட்டுவேன்.',
    notMed: 'மன்னிக்கவும், மாத்திரை புரியவில்லை. நிறம், எதற்கு, எப்போது என்று சொல்லுங்கள்.',
    sorry: 'மன்னிக்கவும், சரியாக கேட்கவில்லை. மறுபடி சொல்லுங்கள்.',
    needNet: 'புதிய மாத்திரை சேர்க்க இணையம் தேவை. நினைவூட்டல் இணையம் இல்லாமலும் வேலை செய்யும்.',
    offline: 'இணையம் இல்லை. நினைவூட்டலும் பொத்தான்களும் வேலை செய்யும்.',
    reminder: (n, l, f) => `${n}, இப்போது ${l} சாப்பிடும் நேரம். ${f}`,
    repeat: 'மறுபடி நினைவூட்டுகிறேன். ',
    taken: 'ரொம்ப நல்லது!', later: 'சரி, 15 நிமிடம் கழித்து நினைவூட்டுகிறேன்.',
    already: 'இந்த மாத்திரையை இன்று ஏற்கனவே எடுத்துவிட்டீர்கள். மறுபடி எடுக்க வேண்டாம்.',
    doctor: 'இதை டாக்டரிடம் கேளுங்கள். குடும்பத்துக்கு சொல்லட்டுமா?',
    told: 'சரி, குடும்பத்துக்கு சொல்லிவிட்டேன்.', notTold: 'சரி.',
    missedAlert: (f, h, l) => `${f} ${h} ${l} எடுக்கவில்லை.`,
    missedSay: (h, l) => `உங்கள் ${h} ${l} தவறிவிட்டது. குடும்பத்துக்கு சொல்லிவிட்டேன்.`,
    lowSay: (l, d) => `${l} இன்னும் ${d} நாளுக்கு மட்டுமே இருக்கு. குடும்பத்துக்கு சொல்லிவிட்டேன்.`,
    lowAlert: (f, l, d, n) => `${f}: ${l} இன்னும் ${d} நாளுக்கு மட்டுமே (${n} மாத்திரை). புதிதாக வாங்கவும்.`,
    qAlert: (f, q) => `${f} மாத்திரை பற்றி கேட்டார்: "${q}". தயவுசெய்து பேசுங்கள்.`,
    stTaken: 'எடுத்தாச்சு', stLeft: 'இன்னும் இல்லை', stMissed: 'தவறியது', stLater: 'அப்புறம்',
    statusIntro: 'இன்று: ', allDone: 'இன்றைய எல்லா மாத்திரையும் ஆச்சு. நல்லது!', noneToday: 'இன்று மாத்திரை இல்லை.',
    next: (l, day, t) => `அடுத்த மாத்திரை: ${l}, ${day}${t}.`, tomorrow: 'நாளை ', noMeds: 'இன்னும் மாத்திரை சேர்க்கவில்லை.',
    stockItem: (l, d) => `${l} — ${d} நாள் மீதி.`, stockOk: 'எல்லா மாத்திரையும் போதுமான அளவு இருக்கு.',
    help: 'நீங்கள் கேட்கலாம்: இன்றைய மாத்திரை ஆச்சா? அடுத்த மாத்திரை எப்போ? எந்த மாத்திரை தீரப்போகுது?',
    nothingDue: 'இப்போது எந்த மாத்திரைக்கும் நேரம் இல்லை.',
    tapMic: 'பேச அழுத்துங்கள்', listening: 'கேட்கிறேன்…', thinking: 'புரிந்துகொள்கிறேன்…', micOff: 'மைக் இல்லை — பொத்தானை அழுத்துங்கள்',
    micDenied: 'மைக் அனுமதி இல்லை. பொத்தானில் பதில் சொல்லுங்கள். நினைவூட்டல் பேசியே வரும்.',
    yes: 'ஆமாம்', no: 'இல்லை', bas: 'போதும்', takenBtn: 'சாப்பிட்டேன்', laterBtn: 'அப்புறம்',
    today: 'இன்றைய மாத்திரை', medsTitle: 'என் மாத்திரைகள்', addMed: '＋ புதிய மாத்திரை', startSetup: 'மாத்திரை சேர்க்கத் தொடங்கு',
    left: n => `${n} மாத்திரை மீதி`, days: d => `${d} நாள்`, del: 'நீக்கு', refill: 'எண்ணிக்கை மாற்று',
    confirmDel: 'இந்த மாத்திரையை நீக்கவா?', refillAsk: 'இப்போது எத்தனை மாத்திரை உள்ளது?',
    qStatus: 'இன்றைய மாத்திரை ஆச்சா?', qNext: 'அடுத்த மாத்திரை எப்போ?', qStock: 'எந்த மாத்திரை தீரப்போகுது?',
    setTitle: 'அமைப்பு', setLang: 'மொழி', setNames: 'பெயர்', userName: 'ஆப் உங்களை எப்படி அழைக்கணும்', famCalls: 'குடும்பம் உங்களை எப்படி அழைக்கும்',
    setFam: 'குடும்பத் தொடர்பு', famName: 'பெயர்', famPhone: 'போன் (WhatsApp)',
    setClock: 'சோதனை கடிகாரம் (டெமோ)', setClockBtn: 'நேரம் அமை', nextDose: 'அடுத்த மாத்திரை நேரத்துக்கு செல்', realTime: 'உண்மை நேரம்',
    setVoice: 'குரல் மற்றும் புரிதல் (விருப்பம்)', reset: 'எல்லா தரவையும் அழி', confirmReset: 'எல்லா மாத்திரையும் பதிவும் அழியும். உறுதியா?',
    talkTitle: 'மாத்திரை சேர்த்தல்', typeInstead: 'எழுதிச் சொல்லுங்கள்', noAlerts: 'இன்னும் எச்சரிக்கை இல்லை.', simNote: 'இது WhatsApp செய்திகளின் மாதிரி — உண்மையான செய்தி அனுப்பப்படாது.',
    noFam: 'அமைப்பில் குடும்பத் தொடர்பைச் சேர்க்கவும்', heardPrefix: 'நீங்கள் சொன்னது: ',
    tapToHear: '🔊 கேட்க அழுத்துங்கள்'
  },
  en: {
    tabs: ['Home', 'Pills', 'Family', 'Settings'],
    slot: { m: 'morning', a: 'afternoon', e: 'evening', n: 'night' },
    at: (s, h) => `${h} in the ${s}`.replace('in the night', 'at night'), hourOnly: h => `${h} o'clock`, and: ' and ',
    tablet: 'tablet', capsule: 'capsule', medicine: 'medicine',
    label: (p, c, unit) => [c, p, unit].filter(Boolean).length > 1 ? [c, p, unit].filter(Boolean).join(' ') : '',
    dose: n => n === 1 ? 'one tablet' : n === 0.5 ? 'half a tablet' : `${NUMW.en[n] || n} tablets (${n})`,
    foodRb: { after: ', after food', before: ', before food', any: '' },
    foodSay: { after: 'Take it after food.', before: 'Take it before food.', any: '' },
    greet: 'Namaste! I am your Dawai Dost. Tell me about your first medicine.',
    askNew: 'Tell me about the new medicine. For example: white BP tablet, one in the morning, after food.',
    askNext: 'Tell me about the next medicine.',
    readback: (l, t, d, f) => `Got it: ${l}, every day at ${t}, ${d}${f}. Is that right?`,
    whatChange: 'What should I change?',
    doseCheck: n => `${NUMW.en[n] || n} — that is ${n} — tablets at a time. Sure?`,
    askStock: 'How many tablets are left?',
    stockCheck: n => `${n} tablets left. Is that right?`,
    askMore: 'Any other medicine?',
    saved: 'Okay, noted.',
    setupDone: 'Very good! I have noted all your medicines. I will remind you on time.',
    notMed: 'Sorry, I did not understand the medicine. Tell me the colour, what it is for, and when you take it.',
    sorry: 'Sorry, I could not hear you properly. Please say it again.',
    needNet: 'Adding a new medicine needs internet. Reminders work without internet.',
    offline: 'No internet. Reminders and buttons still work.',
    reminder: (n, l, f) => `${n}, it is time for your ${l}. ${f}`,
    repeat: 'Reminding you again. ',
    taken: 'Very good!', later: 'Okay, I will remind you in 15 minutes.',
    already: 'You have already taken this tablet today. Do not take it again.',
    doctor: 'Please ask your doctor about this. Shall I tell your family?',
    told: 'Okay, I have told your family.', notTold: 'Okay.',
    missedAlert: (f, h, l) => `${f} did not take the ${h} ${l}.`,
    missedSay: (h, l) => `You missed the ${h} ${l}. I have told your family.`,
    lowSay: (l, d) => `Only ${d} days of ${l} left. I have told your family.`,
    lowAlert: (f, l, d, n) => `${f}'s ${l} will last only ${d} more days (${n} tablets). Please buy more.`,
    qAlert: (f, q) => `${f} asked about medicine: "${q}". Please talk to them.`,
    stTaken: 'taken', stLeft: 'not yet', stMissed: 'missed', stLater: 'later',
    statusIntro: 'Today: ', allDone: 'All of today’s medicines are done. Very good!', noneToday: 'No medicines today.',
    next: (l, day, t) => `Next medicine: ${l}, ${day}${t}.`, tomorrow: 'tomorrow ', noMeds: 'No medicines added yet.',
    stockItem: (l, d) => `${l} — ${d} days left.`, stockOk: 'All medicines have enough stock.',
    help: 'You can ask: Are today’s medicines done? When is the next medicine? Which tablet is running out?',
    nothingDue: 'No medicine is due right now.',
    tapMic: 'Tap to speak', listening: 'Listening…', thinking: 'Understanding…', micOff: 'Mic is off — use the buttons',
    micDenied: 'Microphone not allowed. Answer with the buttons. Reminders will still speak.',
    yes: 'Yes', no: 'No', bas: 'That’s all', takenBtn: 'Taken', laterBtn: 'Later',
    today: 'Today’s medicines', medsTitle: 'My medicines', addMed: '＋ Add medicine', startSetup: 'Start adding medicines',
    left: n => `${n} tablets left`, days: d => `${d} days`, del: 'Remove', refill: 'Update count',
    confirmDel: 'Remove this medicine?', refillAsk: 'How many tablets now?',
    qStatus: 'Are today’s medicines done?', qNext: 'When is the next medicine?', qStock: 'Which tablet is running out?',
    setTitle: 'Settings', setLang: 'Language', setNames: 'Names', userName: 'What the app calls you', famCalls: 'What family calls you',
    setFam: 'Family contact', famName: 'Name', famPhone: 'Phone (WhatsApp)',
    setClock: 'Test clock (for demo)', setClockBtn: 'Set time', nextDose: 'Jump to next dose time', realTime: 'Real time',
    setVoice: 'Voice & understanding (optional)', reset: 'Erase all data', confirmReset: 'All medicines and records will be erased. Sure?',
    talkTitle: 'Adding medicine', typeInstead: 'Type instead', noAlerts: 'No alerts yet.', simNote: 'Simulated WhatsApp messages — nothing is actually sent.',
    noFam: 'Add a family contact in Settings', heardPrefix: 'You said: ',
    tapToHear: '🔊 Tap to hear'
  }
};
const DEFAULT_NAMES = { hi: ['अम्मा जी', 'मम्मी'], mr: ['आजी', 'आई'], ta: ['அம்மா', 'அம்மா'], en: ['Amma ji', 'Mummy'] };
const t = () => T[S.lang || 'hi'];
const userName = () => S.userName || DEFAULT_NAMES[S.lang || 'hi'][0];
const famCalls = () => S.famCalls || DEFAULT_NAMES[S.lang || 'hi'][1];

/* ------------------------------------------------------------------ */
/* Medicine helpers                                                    */
/* ------------------------------------------------------------------ */
function medLabel(m, lang = S.lang) {
  const L = T[lang];
  const unit = m.shape === 'capsule' ? L.capsule : L.tablet;
  const p = m.purpose ? (PURPOSE[lang][m.purpose] || m.purpose) : (m.purposeOther || '');
  const c = m.colour ? COLOUR[lang][m.colour] : '';
  return L.label(p, c, unit) || m.name || m.spoken || L.medicine;
}
function timesText(m) { return m.times.map(x => t().at(t().slot[slotOf(x)], h12(x))).join(t().and); }
function readback(m) { return t().readback(medLabel(m), timesText(m), t().dose(m.dose), t().foodRb[m.food || 'any']); }
function perDay(m) { return (m.dose || 1) * (m.times.length || 1); }
function daysLeft(m) { return Math.floor((m.stock || 0) / perDay(m)); }
const medById = id => S.meds.find(m => m.id === id);
function pillHTML(m) {
  const shape = m.shape || 'round';
  return `<span class="pill ${shape}" style="background:${CSS_COLOUR[m.colour] || '#E9E2D4'}"></span>`;
}

/* ------------------------------------------------------------------ */
/* Local multilingual understanding (offline fallback)                 */
/* ------------------------------------------------------------------ */
const TAMIL = /[஀-௿]/;
function norm(s) {
  return String(s || '').normalize('NFC').toLowerCase()
    .replace(/[क़-य़]/g, c => 'कखगजडढफय'[c.charCodeAt(0) - 0x958])
    .replace(/़/g, '').replace(/ँ/g, 'ं')
    .replace(/[०-९]/g, d => String(d.charCodeAt(0) - 0x966))
    .replace(/[.,!?।॥"“”‘’'`…;:()\-–—]/g, ' ').replace(/\s+/g, ' ').trim();
}
const _nc = new Map();
const nk = w => { if (!_nc.has(w)) _nc.set(w, norm(w)); return _nc.get(w); };
/* phrase match: Tamil → substring (agglutinative); else whole words; "stem*" → prefix */
function hit(text, w) {
  const star = w.endsWith('*'); const k = nk(star ? w.slice(0, -1) : w);
  if (!k) return false;
  if (TAMIL.test(k)) return text.includes(k);
  const p = ' ' + text + ' ';
  return star ? p.includes(' ' + k) : p.includes(' ' + k + ' ');
}
const has = (text, list) => list.some(w => hit(text, w));
function findKey(text, map) { for (const [k, list] of Object.entries(map)) if (has(text, list)) return k; return null; }

const V = {
  yes: ['haan', 'han', 'haa', 'ha', 'haanji', 'ji', 'ji haan', 'sahi', 'sahi hai', 'theek', 'thik', 'theek hai', 'ok', 'okay', 'yes', 'yeah', 'yep', 'correct', 'right', 'bilkul', 'ho', 'hoy', 'barobar',
    'हाँ', 'हां', 'हा', 'हाँजी', 'हांजी', 'जी', 'जी हाँ', 'सही', 'ठीक', 'बिल्कुल', 'बिलकुल', 'हो', 'होय', 'बरोबर', 'ओके', 'पक्का',
    'ஆமா', 'ஆமாம்', 'ஆம்', 'சரி', 'aamaa', 'aama', 'seri', 'sari'],
  no: ['nahi', 'nahin', 'nai', 'na', 'naa', 'no', 'nope', 'galat', 'nako', 'nahi hai', 'wrong', 'illa', 'illai',
    'नहीं', 'नही', 'ना', 'गलत', 'नको', 'नाही', 'चूक',
    'இல்லை', 'இல்ல', 'வேண்டாம்', 'தப்பு'],
  done: ['bas', 'bus', 'bas itna', 'itna hi', 'that s all', 'thats all', 'that is all', 'no more', 'nothing else', 'enough', 'khatam', 'aur nahi', 'aur koi nahi', 'koi nahi',
    'बस', 'इतना ही', 'इतनी ही', 'और नहीं', 'और कोई नहीं', 'कोई नहीं', 'बास', 'पुरे', 'झालं', 'अजून नाही', 'आणखी नाही', 'अजून काही नाही',
    'போதும்', 'அவ்வளவுதான்', 'அவ்வளவு தான்', 'வேற இல்லை', 'வேறு இல்லை'],
  later: ['baad mein', 'baad me', 'baadme', 'baad', 'later', 'ruko', 'ruk jao', 'thodi der', 'abhi nahi', 'nahi li', 'nahi khayi', 'nahi khai', 'not yet', 'not now', 'in a while', 'snooze', 'nantar', 'apparam', 'appuram', 'aprom',
    'बाद में', 'बाद मे', 'बाद', 'रुको', 'थोड़ी देर', 'थोडी देर', 'अभी नहीं', 'नहीं ली', 'नहीं खाई', 'नहीं खायी',
    'नंतर', 'थोड्या वेळाने', 'आत्ता नाही', 'अजून नाही', 'घेतली नाही',
    'அப்புறம்', 'அப்பறம்', 'பிறகு', 'கொஞ்ச நேரம்', 'இன்னும் இல்லை', 'சாப்பிடலை', 'சாப்பிடவில்லை'],
  taken: ['kha li', 'khaa li', 'kha liya', 'khaa liya', 'kha li hai', 'le li', 'le liya', 'le li hai', 'li', 'liya', 'ho gaya', 'ho gayi', 'ho gai', 'hogaya', 'done', 'taken', 'took', 'took it', 'i took', 'have taken', 'kha chuki', 'le chuki', 'kha chuka', 'le chuka',
    'ghetli', 'ghetla', 'ghetle', 'ghetla', 'khalli', 'jhali', 'zali', 'saapten', 'sapten', 'saaptan', 'saapitten', 'sappitten', 'potten', 'pottachu', 'saaptachu',
    'खा ली', 'खा लिया', 'खा ली है', 'ले ली', 'ले लिया', 'ले ली है', 'ली', 'लिया', 'हो गया', 'हो गई', 'हो गयी', 'खा चुकी', 'ले चुकी', 'खा चुका', 'ले चुका', 'डन',
    'घेतली', 'घेतले', 'घेतलं', 'घेतला', 'खाल्ली', 'खाल्ले', 'झाली', 'झालं',
    'சாப்டேன்', 'சாப்பிட்டேன்', 'சாப்பிட்டாச்சு', 'சாப்டாச்சு', 'போட்டேன்', 'போட்டாச்சு', 'எடுத்தேன்', 'எடுத்தாச்சு', 'முடிஞ்சது'],
  medical: ['do goli', '2 goli', 'do goliyan', 'do tablet', 'two tablets', '2 tablets', 'extra', 'zyada', 'jyada', 'jada', 'double', 'ek aur', 'aur ek', 'dobara le', 'dose badha', 'dose kam', 'kam kar', 'band kar', 'chhod', 'chod du', 'side effect', 'overdose', 'another tablet', 'stop taking', 'skip',
    'दो गोली', 'दो गोलियां', '2 गोली', '2 गोलियां', 'ज्यादा', 'जादा', 'डबल', 'एक और', 'और एक', 'दोबारा ले', 'खुराक', 'कम कर', 'बंद कर', 'छोड़ दूं', 'छोड दूं', 'छोड़ दूँ', 'साइड इफेक्ट', 'साइड इफ़ेक्ट',
    'दोन गोळ्या', 'जास्त', 'आणखी एक', 'बंद करू', 'सोडू का',
    'ரெண்டு மாத்திரை', 'இரண்டு மாத்திரை', 'இன்னொரு', 'அதிகமா', 'நிறுத்தலாமா', 'நிறுத்த'],
  shouldTake: ['le loon', 'le lu', 'le lun', 'le loo', 'kha loon', 'kha lu', 'kha lun', 'can i take', 'should i take', 'shall i take', 'may i take',
    'ले लूं', 'ले लू', 'ले लूँ', 'खा लूं', 'खा लू', 'खा लूँ', 'लूं क्या', 'लूँ क्या', 'घेऊ का', 'घेऊ', 'खाऊ का',
    'சாப்பிடலாமா', 'எடுக்கலாமா', 'போடலாமா'],
  status: ['aaj', 'today', 'aaj ki', 'sab', 'saari', 'dawai ho gayi', 'dawa ho gayi', 'baaki', 'baki', 'all done',
    'आज', 'आज की', 'सब', 'सारी', 'दवाई हो गई', 'दवा हो गई', 'दवाई हो गयी', 'बाकी', 'बाक़ी',
    'आजची', 'आजचे', 'सगळी', 'औषधं झाली', 'औषध झालं',
    'இன்னைக்கு', 'இன்று', 'இன்றைய', 'எல்லா மாத்திரை', 'மாத்திரை ஆச்சா'],
  next: ['agli', 'agla', 'next', 'kab hai', 'kab', 'kitne baje', 'when', 'agli dawai', 'pudhcha', 'kadhi',
    'अगली', 'अगला', 'कब', 'कितने बजे', 'पुढचं', 'पुढची', 'पुढचे', 'पुढील', 'कधी',
    'அடுத்த', 'எப்போ', 'எப்ப', 'எப்போது', 'எத்தனை மணிக்கு'],
  stock: ['khatam', 'khatm', 'khatham', 'running out', 'run out', 'finish', 'finishing', 'refill', 'stock', 'kam hai', 'bachi', 'bache', 'sampnar',
    'खत्म', 'खतम', 'ख़त्म', 'बची', 'बचे', 'कम है', 'संपणार', 'संपत', 'संपली', 'शिल्लक', 'संपत आली',
    'தீர', 'தீரப்போகுது', 'தீர்ந்து', 'முடியப்போகுது', 'மிச்சம்', 'ஸ்டாக்'],
  add: ['nayi dawai', 'nai dawai', 'naya', 'add', 'jodo', 'jod do', 'new medicine', 'new tablet',
    'नई दवाई', 'नयी दवाई', 'नई दवा', 'जोड़', 'जोड', 'नवीन औषध', 'नवं औषध', 'जोडा',
    'புது மாத்திரை', 'புதிய மாத்திரை', 'சேர்'],
  firstPerson: ['maine', 'mai ne', 'main ne', 'i', 'i have', 'मैंने', 'मैने', 'मी', 'நான்']
};

const PURPOSE_KW = {
  bp: ['bp', 'b p', 'bipi', 'bp ki', 'blood pressure', 'pressure', 'pressure ki', 'बीपी', 'बी पी', 'बी.पी', 'ब्लड प्रेशर', 'प्रेशर', 'रक्तदाब', 'பிபி', 'பி பி', 'பிரஷர்', 'ரத்த அழுத்த'],
  sugar: ['sugar', 'shugar', 'diabetes', 'madhumeh', 'शुगर', 'सुगर', 'शक्कर', 'डायबिटीज', 'डायबिटीस', 'मधुमेह', 'शुगरची', 'சுகர்', 'சர்க்கரை', 'நீரிழிவு'],
  thyroid: ['thyroid', 'थायराइड', 'थाइराइड', 'थायरॉईड', 'थायरॉइड', 'தைராய்டு'],
  heart: ['heart', 'dil', 'दिल', 'हार्ट', 'हृदय', 'इदय', 'இதய', 'ஹார்ட்'],
  cholesterol: ['cholesterol', 'कोलेस्ट्रॉल', 'कोलेस्ट्राल', 'कोलेस्टेरॉल', 'கொலஸ்ட்ரால்', 'கொழுப்பு'],
  pain: ['pain', 'dard', 'दर्द', 'दुखणे', 'दुखी', 'वेदना', 'வலி'],
  gas: ['gas', 'acidity', 'gastric', 'गैस', 'एसिडिटी', 'ॲसिडिटी', 'अॅसिडिटी', 'கேஸ்', 'அசிடிட்டி', 'வாயு'],
  vitamin: ['vitamin', 'calcium', 'विटामिन', 'कैल्शियम', 'कॅल्शियम', 'व्हिटॅमिन', 'கால்சியம்', 'வைட்டமின்'],
  sleep: ['neend', 'sleep', 'नींद', 'झोप', 'झोपेची', 'தூக்க']
};
const COLOUR_KW = {
  white: ['safed', 'safaid', 'sufed', 'safeed', 'white', 'सफेद', 'सफ़ेद', 'सुफेद', 'व्हाइट', 'पांढरी', 'पांढरा', 'पांढर*', 'pandhri', 'வெள்ளை', 'vellai', 'வெள்ள'],
  yellow: ['peeli', 'pili', 'peela', 'yellow', 'पीली', 'पीला', 'पिली', 'पिवळी', 'पिवळा', 'மஞ்சள்'],
  pink: ['gulabi', 'pink', 'गुलाबी', 'पिंक', 'பிங்க்', 'ரோஸ்'],
  red: ['lal', 'laal', 'red', 'लाल', 'சிவப்பு', 'சிகப்பு'],
  blue: ['neeli', 'nili', 'blue', 'नीली', 'नीला', 'निळी', 'निळा', 'ब्लू', 'நீல'],
  green: ['hari', 'green', 'हरी', 'हरा', 'हिरवी', 'हिरवा', 'ग्रीन', 'பச்சை'],
  orange: ['narangi', 'orange', 'नारंगी', 'ऑरेंज', 'केशरी', 'ஆரஞ்சு'],
  brown: ['bhuri', 'brown', 'भूरी', 'भूरा', 'ब्राउन', 'तपकिरी', 'பிரவுன்']
};
const SHAPE_KW = {
  capsule: ['capsule', 'kaipsul', 'कैप्सूल', 'कॅप्सूल', 'கேப்சூல்'],
  oval: ['lambi', 'oval', 'long', 'लंबी', 'लम्बी', 'லம்பா', 'நீளமான'],
  small: ['chhoti', 'choti', 'small', 'tiny', 'छोटी', 'लहान', 'बारीक', 'சின்ன', 'சிறிய'],
  big: ['badi', 'bigger', 'big', 'बड़ी', 'बडी', 'मोठी', 'பெரிய'],
  round: ['gol', 'round', 'गोल', 'உருண்டை']
};
const BRANDS = {
  telma: 'bp', telmisartan: 'bp', amlodipine: 'bp', amlong: 'bp', losar: 'bp', losartan: 'bp', 'टेल्मा': 'bp', 'एमलोडिपिन': 'bp', 'अमलोडिपिन': 'bp',
  metformin: 'sugar', glycomet: 'sugar', januvia: 'sugar', glimepiride: 'sugar', 'मेटफॉर्मिन': 'sugar', 'ग्लाइकोमेट': 'sugar',
  thyronorm: 'thyroid', eltroxin: 'thyroid', 'थायरोनॉर्म': 'thyroid',
  ecosprin: 'heart', aspirin: 'heart', 'इकोस्प्रिन': 'heart',
  atorva: 'cholesterol', atorvastatin: 'cholesterol', rosuvas: 'cholesterol',
  dolo: 'pain', crocin: 'pain', paracetamol: 'pain', 'डोलो': 'pain', 'क्रोसिन': 'pain',
  pan: 'gas', pantop: 'gas', pantoprazole: 'gas', omez: 'gas', 'पैन': 'gas',
  shelcal: 'vitamin', 'शेलकाल': 'vitamin'
};
const SLOT_KW = {
  m: ['subah', 'subha', 'savere', 'sawere', 'morning', 'nashta', 'breakfast', 'सुबह', 'सवेरे', 'सकाळी', 'सकाळ', 'नाश्ते', 'காலை', 'kaalai', 'kalai'],
  a: ['dopahar', 'dopeher', 'dupahar', 'afternoon', 'lunch', 'noon', 'दोपहर', 'दुपहर', 'दुपारी', 'दुपार', 'மதியம்', 'madhiyam'],
  e: ['shaam', 'sham', 'evening', 'शाम', 'संध्याकाळी', 'सायंकाळी', 'மாலை', 'maalai'],
  n: ['raat', 'rat', 'night', 'dinner', 'sone se pehle', 'bedtime', 'रात', 'रात्री', 'रात्रि', 'रात को', 'सोने से पहले', 'झोपण्यापूर्वी', 'இரவு', 'ராத்திரி', 'iravu']
};
const SLOT_TIME = { m: '08:00', a: '13:00', e: '18:00', n: '21:00' };
const FOOD_KW = {
  before: ['khane se pehle', 'khaane se pehle', 'khane se pahle', 'khana khane se pehle', 'khali pet', 'before food', 'before meal', 'before eating', 'before breakfast', 'empty stomach', 'jevnaadhi', 'jevnapurvi',
    'खाने से पहले', 'खाना खाने से पहले', 'खाली पेट', 'भोजन से पहले', 'नाश्ते से पहले', 'जेवणाआधी', 'जेवणापूर्वी', 'जेवणाच्या आधी', 'उपाशीपोटी', 'रिकाम्या पोटी',
    'சாப்பாட்டுக்கு முன்', 'சாப்பிடும் முன்', 'சாப்பிடுவதற்கு முன்', 'வெறும் வயிற்றில்'],
  after: ['khane ke baad', 'khaane ke baad', 'khane ke bad', 'khana khane ke baad', 'after food', 'after meal', 'after meals', 'after eating', 'after breakfast', 'after lunch', 'after dinner', 'nashte ke baad', 'jevnanantar',
    'खाने के बाद', 'खाना खाने के बाद', 'भोजन के बाद', 'नाश्ते के बाद', 'जेवणानंतर', 'जेवण झाल्यावर', 'जेवल्यानंतर', 'नाश्त्यानंतर', 'जेवणाच्या नंतर',
    'சாப்பிட்ட பிறகு', 'சாப்பாட்டுக்குப் பிறகு', 'சாப்பாட்டுக்கு பிறகு', 'சாப்பாட்டுக்கு அப்புறம்', 'சாப்பிட்டு அப்புறம்']
};
const NUMBER_WORDS = {
  'ek': 1, 'एक': 1, 'one': 1, 'ஒன்று': 1, 'ஒன்னு': 1, 'ஒரு': 1,
  'do': 2, 'दो': 2, 'two': 2, 'दोन': 2, 'இரண்டு': 2, 'ரெண்டு': 2,
  'teen': 3, 'तीन': 3, 'three': 3, 'மூன்று': 3, 'மூணு': 3,
  'char': 4, 'chaar': 4, 'चार': 4, 'four': 4, 'நான்கு': 4, 'நாலு': 4,
  'paanch': 5, 'panch': 5, 'पांच': 5, 'पाच': 5, 'five': 5, 'ஐந்து': 5, 'அஞ்சு': 5,
  'chhe': 6, 'chhah': 6, 'छह': 6, 'छः': 6, 'सहा': 6, 'six': 6, 'ஆறு': 6,
  'saat': 7, 'सात': 7, 'seven': 7, 'ஏழு': 7,
  'aath': 8, 'आठ': 8, 'eight': 8, 'எட்டு': 8,
  'nau': 9, 'नौ': 9, 'नऊ': 9, 'nine': 9, 'ஒன்பது': 9,
  'das': 10, 'दस': 10, 'दहा': 10, 'ten': 10, 'பத்து': 10,
  'gyarah': 11, 'ग्यारह': 11, 'eleven': 11, 'barah': 12, 'बारह': 12, 'twelve': 12,
  'pandrah': 15, 'पंद्रह': 15, 'पंधरा': 15, 'fifteen': 15, 'பதினைந்து': 15,
  'bees': 20, 'बीस': 20, 'वीस': 20, 'twenty': 20, 'இருபது': 20,
  'pachchis': 25, 'पच्चीस': 25, 'पंचवीस': 25, 'twenty five': 25, 'இருபத்தைந்து': 25,
  'tees': 30, 'तीस': 30, 'thirty': 30, 'முப்பது': 30,
  'chalis': 40, 'chaalis': 40, 'चालीस': 40, 'चाळीस': 40, 'forty': 40, 'நாற்பது': 40,
  'pachas': 50, 'pachaas': 50, 'पचास': 50, 'पन्नास': 50, 'fifty': 50, 'ஐம்பது': 50,
  'saath': 60, 'साठ': 60, 'sixty': 60, 'அறுபது': 60,
  'sau': 100, 'सौ': 100, 'शंभर': 100, 'hundred': 100, 'நூறு': 100
};
const HALF_WORDS = ['aadhi', 'adhi', 'half', 'आधी', 'आधा', 'अर्धी', 'அரை'];
const TABLET_WORDS = ['goli*', 'golī', 'tablet*', 'capsule*', 'गोली*', 'गोलि*', 'गोळी*', 'गोळ्या', 'टैबलेट', 'टेबलेट', 'கேப்சூல்', 'மாத்திரை'];
const HOUR_MARK = ['baje', 'bje', 'बजे', 'वाजता', 'वाजे', 'மணி', 'மணிக்கு', 'mani', 'o clock', 'oclock', 'am', 'pm', 'a m', 'p m'];
const NOT_NAME = new Set(['tablet', 'tablets', 'capsule', 'morning', 'afternoon', 'evening', 'night', 'after', 'before', 'food', 'meal', 'white', 'yellow', 'pink', 'blue', 'green', 'orange', 'brown', 'sugar', 'pressure', 'blood', 'take', 'daily', 'every', 'with', 'goli', 'golī', 'subah', 'raat', 'shaam', 'dopahar', 'khane', 'khaane', 'baad', 'pehle', 'safed', 'peeli', 'gulabi', 'medicine', 'dawai', 'dawa', 'thyroid', 'heart', 'vitamin', 'calcium', 'acidity', 'tablet', 'once', 'twice', 'times', 'this', 'that', 'have', 'there', 'mera', 'meri', 'wali', 'wala', 'roj', 'roz', 'that', 'also', 'and', 'the']);

function numFromToken(tok) {
  if (/^\d+(\.\d+)?$/.test(tok)) return parseFloat(tok);
  const k = nk(tok);
  for (const [w, v] of Object.entries(NUMBER_WORDS)) if (nk(w) === k) return v;
  if (TAMIL.test(k)) for (const [w, v] of Object.entries(NUMBER_WORDS)) if (TAMIL.test(w) && k.startsWith(nk(w))) return v;
  return null;
}

function parseMedLocal(raw, lang) {
  let text = norm(raw);
  const out = {};
  // brand names
  for (const [b, p] of Object.entries(BRANDS)) if (hit(text, b)) { out.name = b.replace(/^\w/, c => c.toUpperCase()); out.purpose = p; break; }
  const purpose = findKey(text, PURPOSE_KW); if (purpose) out.purpose = purpose;
  const colour = findKey(text, COLOUR_KW); if (colour) out.colour = colour;
  const shape = findKey(text, SHAPE_KW); if (shape) out.shape = shape;
  const food = findKey(text, FOOD_KW);
  if (food) out.food = food;
  else if (lang === 'mr' && has(text, ['आधी', 'पूर्वी'])) out.food = 'before';
  else if (has(text, ['baad', 'बाद', 'नंतर', 'பிறகு', 'after'])) out.food = 'after';
  else if (has(text, ['pehle', 'पहले', 'முன்', 'before'])) out.food = 'before';

  // tokens
  const toks = text.split(' ');
  const isSlotTok = i => Object.entries(SLOT_KW).find(([, l]) => l.some(w => { const k = nk(w); return !k.includes(' ') && (TAMIL.test(k) ? toks[i].includes(k) : toks[i] === k); }));
  const isTabletTok = i => toks[i] && TABLET_WORDS.some(w => { const st = w.endsWith('*'); const k = nk(st ? w.slice(0, -1) : w); return st ? toks[i].startsWith(k) : (TAMIL.test(k) ? toks[i].includes(k) : toks[i] === k); });
  const isHourMark = i => toks[i] && HOUR_MARK.some(w => { const k = nk(w); return TAMIL.test(k) ? toks[i].includes(k) : toks[i] === k; });

  // explicit hours: <num> baje / 8:30 / saade 8
  const hours = []; const usedNum = new Set();
  for (let i = 0; i < toks.length; i++) {
    const tm = toks[i].match(/^(\d{1,2})(?:[:.](\d{2}))?(am|pm)?$/);
    const n = tm ? +tm[1] : numFromToken(toks[i]);
    if (n == null || n > 12 || n < 1 && !tm) continue;
    const mins = tm && tm[2] ? +tm[2] : 0;
    const explicitAP = tm && tm[3];
    if (!(isHourMark(i + 1) || explicitAP || (tm && tm[2]))) continue;
    let mm = mins; if (i > 0 && /^(saade|sade|साढ़े|साढे|साडे)$/.test(toks[i - 1])) mm = 30;
    // nearest slot word before (up to 3 tokens)
    let slot = null; for (let j = i - 1; j >= Math.max(0, i - 3); j--) { const s = isSlotTok(j); if (s) { slot = s[0]; break; } }
    const ap = explicitAP || (toks[i + 1] === 'pm' || toks[i + 1] === 'am' ? toks[i + 1] : null);
    let h = n;
    if (ap === 'pm' && h < 12) h += 12;
    else if (ap === 'am' && h === 12) h = 0;
    else if (!ap) {
      if (slot === 'a' || slot === 'e' || slot === 'n') { if (h < 12) h += 12; if (slot === 'n' && h === 24) h = 0; }
      else if (!slot && h >= 1 && h <= 6) h += 12;
    }
    hours.push({ hhmm: `${pad(h % 24)}:${pad(mm)}`, slotIdx: slot });
    usedNum.add(i);
  }
  // slot words
  const slots = [];
  for (const [s, l] of Object.entries(SLOT_KW)) if (has(text, l)) slots.push(s);
  let times = hours.map(h => h.hhmm);
  for (const s of slots) if (!hours.some(h => h.slotIdx === s)) times.push(SLOT_TIME[s]);
  if (!times.length) {
    if (has(text, ['teeno', 'teen baar', 'three times', 'तीनों', 'तीन बार', 'तीनदा', 'தினமும் மூன்று', 'மூன்று வேளை', 'மூணு வேளை'])) times = ['08:00', '13:00', '21:00'];
    else if (has(text, ['do baar', 'twice', 'two times', 'दो बार', 'दोनदा', 'दोन वेळा', 'இரண்டு வேளை', 'ரெண்டு வேளை'])) times = ['08:00', '21:00'];
    else if (has(text, ['ek baar', 'once', 'एक बार', 'एकदा', 'ஒரு வேளை'])) times = ['08:00'];
  }
  if (times.length) out.times = [...new Set(times)].sort();

  // dose: number next to tablet word or slot word, not an hour
  for (let i = 0; i < toks.length; i++) {
    if (usedNum.has(i)) continue;
    let n = null;
    if (HALF_WORDS.some(w => nk(w) === toks[i]) && !(lang === 'mr' && toks[i] === nk('आधी') && !isTabletTok(i + 1))) n = 0.5;
    else n = numFromToken(toks[i]);
    if (n == null || n > 4) continue;
    const ambiguous = toks[i] === 'do' || toks[i] === nk('दो');
    const nearTablet = isTabletTok(i + 1) || isTabletTok(i + 2);
    const nearSlot = isSlotTok(i - 1) || isSlotTok(i + 1);
    if (nearTablet || (!ambiguous && nearSlot) || (ambiguous && nearSlot && isTabletTok(i + 1))) { out.dose = n; break; }
    if (!ambiguous && n <= 2 && /^\d$/.test(toks[i]) === false && nearSlot) { out.dose = n; break; }
  }
  if (out.dose == null) { // "subah do" — "do" right after a slot word with nothing after
    for (let i = 1; i < toks.length; i++) if ((toks[i] === 'do' || toks[i] === nk('दो') || toks[i] === nk('दोन')) && isSlotTok(i - 1) && !isHourMark(i + 1)) { out.dose = 2; break; }
  }

  // unknown Latin word → possible brand name, saved as spoken
  if (!out.name) {
    const vocab = new Set(Object.values(Object.assign({}, PURPOSE_KW, COLOUR_KW, SHAPE_KW, SLOT_KW, FOOD_KW, V)).flat().flatMap(w => nk(w.replace('*', '')).split(' ')));
    const cand = raw.split(/[\s,.]+/).find(w => /^[A-Za-z][A-Za-z-]{3,}$/.test(w) && !NOT_NAME.has(w.toLowerCase()) && !vocab.has(w.toLowerCase()));
    if (cand) out.name = cand.replace(/^\w/, c => c.toUpperCase());
  }
  return out;
}
const medHasInfo = m => !!(m && (m.purpose || m.colour || m.name || (m.times && m.times.length) || m.purposeOther));

function parseNumberLocal(raw) {
  const text = norm(raw); const toks = text.split(' ');
  for (let i = 0; i < toks.length; i++) {
    let n = numFromToken(toks[i]);
    if (n == null) continue;
    // "bees" + "paanch" style compounds are rare; "twenty five" handled; tens + units in digits come as digits
    const nxt = toks[i + 1] && numFromToken(toks[i + 1]);
    if (n >= 20 && n % 10 === 0 && nxt && nxt < 10) n += nxt;
    if (toks[i + 1] && /^(patta|patte|पत्ता|पत्ते|strip|strips|पत्ती|स्ट्रिप)$/.test(toks[i + 1])) n *= 10;
    return n;
  }
  if (has(text, ['khatam', 'खत्म', 'कुछ नहीं', 'none', 'zero', 'शून्य', 'இல்லை'])) return 0;
  return null;
}

function localUnderstand(ctx, text, extra = {}) {
  const n = norm(text);
  const lang = S.lang;
  const med = () => parseMedLocal(text, lang);
  const r = (intent, more = {}) => Object.assign({ intent, number: null, medicine: null, source: 'local' }, more);
  switch (ctx) {
    case 'medicine': {
      const m = med();
      if (medHasInfo(m)) return r('medicine', { medicine: m });
      if (has(n, V.done) || (has(n, V.no) && n.split(' ').length <= 2)) return r('done');
      return r('unclear');
    }
    case 'edit': {
      const m = med(); if (medHasInfo(m) || m.dose != null || m.food || m.shape) return r('medicine', { medicine: m });
      const num = parseNumberLocal(text); if (num != null && num <= 4) return r('medicine', { medicine: { dose: num } });
      if (has(n, V.yes)) return r('yes');
      return r('unclear');
    }
    case 'yesno': {
      const m = med(); const info = medHasInfo(m) || m.dose != null || m.food;
      if (has(n, V.no)) return r('no', { medicine: info ? m : null });
      if (has(n, V.yes)) return r('yes');
      if (info) return r('no', { medicine: m });
      return r('unclear');
    }
    case 'more': {
      const m = med();
      if (medHasInfo(m)) return r('medicine', { medicine: m });
      if (has(n, V.done) || has(n, V.no)) return r('done');
      if (has(n, V.yes)) return r('yes');
      return r('unclear');
    }
    case 'number': {
      const num = parseNumberLocal(text); return num != null ? r('number', { number: num }) : r('unclear');
    }
    case 'reminder': {
      if (has(n, V.medical)) return r('medical_question');
      if (has(n, V.shouldTake)) return r('should_take');
      if (has(n, V.later)) return r('later');
      if (has(n, V.taken)) return r('taken');
      if (has(n, V.yes) && n.split(' ').length <= 3) return r('taken');
      return r('unclear');
    }
    case 'home': {
      if (has(n, V.medical)) return r('medical_question');
      if (has(n, V.shouldTake)) return r('should_take', { medicine: med() });
      if (has(n, V.stock)) return r('stock');
      if (has(n, V.next)) return r('next');
      if (has(n, V.firstPerson) && has(n, V.taken)) return r('taken', { medicine: med() });
      if (has(n, V.status)) return r('status');
      if (has(n, V.add)) return r('add');
      if (has(n, V.taken)) return r('taken', { medicine: med() });
      return r('unclear');
    }
    case 'lang': {
      if (has(n, ['tamil', 'தமிழ்', 'तमिल', 'tamizh'])) return r('ta');
      if (has(n, ['marathi', 'मराठी'])) return r('mr');
      if (has(n, ['english', 'इंग्लिश', 'अंग्रेजी', 'अंग्रेज़ी', 'ஆங்கிலம்', 'इंग्रजी'])) return r('en');
      if (has(n, ['hindi', 'हिंदी', 'हिन्दी', 'ஹிந்தி'])) return r('hi');
      return r('unclear');
    }
  }
  return r('unclear');
}

/* ------------------------------------------------------------------ */
/* Claude understanding (when key + online)                            */
/* ------------------------------------------------------------------ */
const COLOUR_KEYS = Object.keys(CSS_COLOUR);
const PURPOSE_KEYS = Object.keys(PURPOSE.en);
const NUL = s => ({ anyOf: [{ type: 'null' }, s] });
const NLU_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['intent', 'number', 'medicine'],
  properties: {
    intent: { type: 'string', enum: ['medicine', 'yes', 'no', 'done', 'number', 'taken', 'later', 'should_take', 'medical_question', 'status', 'next', 'stock', 'add', 'unclear'] },
    number: NUL({ type: 'number' }),
    medicine: NUL({
      type: 'object', additionalProperties: false,
      required: ['name', 'colour', 'shape', 'purpose', 'purpose_other', 'dose', 'times', 'food'],
      properties: {
        name: NUL({ type: 'string' }),
        colour: NUL({ type: 'string', enum: COLOUR_KEYS }),
        shape: NUL({ type: 'string', enum: ['round', 'oval', 'capsule', 'small', 'big'] }),
        purpose: NUL({ type: 'string', enum: PURPOSE_KEYS }),
        purpose_other: NUL({ type: 'string' }),
        dose: NUL({ type: 'number' }),
        times: NUL({ type: 'array', items: { type: 'string' } }),
        food: NUL({ type: 'string', enum: ['after', 'before', 'any'] })
      }
    })
  }
};
const NLU_SYSTEM = `You are the language-understanding module of "Dawai Dost", a voice medicine-reminder for elderly people in India.
Input is JSON: {task, language, utterance, existing_medicine?}. The utterance is a speech transcript in Hindi, Tamil, Marathi or English, often mixed (Hinglish, Tamil-English, Marathi-Hindi), possibly in Devanagari, Tamil or Latin script, with transcription errors. Match meaning, not exact words.
Return ONLY the JSON object required by the schema. You classify and extract; you never give medical advice.

Tasks:
- "medicine": the user describes a medicine. intent="medicine" and fill medicine fields that were actually said; null for anything not said. If they say that's all (bas, that's all, போதும், पुरे) intent="done". If nothing usable, "unclear".
- "edit": a correction to existing_medicine. intent="medicine" with ONLY the changed fields set, all others null. If they say it's fine, intent="yes".
- "yesno": a confirmation answer. intent "yes" or "no". If they say no AND state a correction ("nahi, shaam ko"), intent="no" with the corrected fields in medicine.
- "more": answer to "any other medicine?". "done" for no/bas/that's all; "yes" for yes without details; "medicine" with fields if they directly describe one.
- "number": how many tablets; put it in number. "do"=2, "teen"=3, "bees"=20, "tees"=30, "ek patta"=10 tablets per strip. Else "unclear".
- "reminder": reply to a dose reminder. "taken" (kha li, le li, ho gaya, done, saapten, ghetli, potten...), "later" (baad mein, nantar, apparam, not yet), "should_take" (asking if they should take it), "medical_question" (asking about extra/double dose, skipping, stopping, side effects, changing dose), else "unclear".
- "home": a question at any time. "status" (are today's medicines done?), "next" (when is the next dose?), "stock" (which tablet is running out?), "add" (add a new medicine), "taken" (user reports they just took a tablet; fill medicine.purpose/colour if named), "should_take", "medical_question", else "unclear".

Medicine fields: colour one of ${COLOUR_KEYS.join(',')} (safed=white, peeli=yellow, laal=red, neeli=blue, hari=green, pandhri=white, vellai=white, manjal=yellow).
purpose one of ${PURPOSE_KEYS.join(',')} (BP/pressure=bp, sugar/diabetes=sugar); otherwise purpose=null and purpose_other a short word.
name: brand/generic name only if one was said (e.g. Telma, Glycomet), as spoken; else null.
dose: tablets per time (ek=1, do=2, aadhi=0.5). "do" means 2 only when it refers to tablets.
times: 24h "HH:MM". Defaults: morning/subah/kaalai/sakali=08:00, afternoon/dopahar/madhiyam/dupari=13:00, evening/shaam/maalai=18:00, night/raat/iravu/ratri=21:00. Use explicit clock times when said ("raat 10 baje"=22:00). "din mein do baar"=["08:00","21:00"].
food: after (khane ke baad, jevnanantar, saapitta piragu), before (khane se pehle, khali pet, jevnaadhi), any.`;

let _sdk = null;
async function claudeClient() {
  if (!_sdk) {
    const mod = await import('https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.8.0/+esm');
    _sdk = mod.default || mod.Anthropic;
  }
  return new _sdk({ apiKey: S.claudeKey, dangerouslyAllowBrowser: true, maxRetries: 0 });
}
async function claudeUnderstand(task, utterance, extra) {
  const client = await claudeClient();
  const resp = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: NLU_SCHEMA } },
    system: NLU_SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify({ task, language: S.lang, utterance, existing_medicine: extra.existing || undefined }) }]
  });
  if (resp.stop_reason === 'refusal') throw new Error('refusal');
  const txt = resp.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const j = JSON.parse(txt);
  if (j.medicine) {
    const m = {};
    for (const [k, v] of Object.entries(j.medicine)) if (v !== null && !(Array.isArray(v) && !v.length)) m[k === 'purpose_other' ? 'purposeOther' : k] = v;
    j.medicine = m;
  }
  j.source = 'claude';
  return j;
}
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

async function understand(ctx, text, extra = {}) {
  const local = localUnderstand(ctx, text, extra);
  if (ctx === 'lang' || !S.claudeKey || !navigator.onLine) return local;
  try {
    const j = await withTimeout(claudeUnderstand(ctx, text, extra), 9000);
    if (!j || !j.intent) return local;
    // safety: if either parser sees a medical question, treat it as one
    if ((ctx === 'reminder' || ctx === 'home') && local.intent === 'medical_question') j.intent = 'medical_question';
    if (j.intent === 'unclear' && local.intent !== 'unclear') return local;
    return j;
  } catch (e) { console.warn('Claude NLU fallback to local:', e.message); return local; }
}

/* ------------------------------------------------------------------ */
/* Audio: chime + speech synthesis                                     */
/* ------------------------------------------------------------------ */
let actx = null;
function audioCtx() { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (actx && actx.state === 'suspended') actx.resume(); return actx; }
function chime(loud) {
  const c = audioCtx(); if (!c) return Promise.resolve();
  const notes = loud ? [880, 1175, 880, 1175] : [784, 1047];
  notes.forEach((f, i) => {
    const o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.value = f;
    const t0 = c.currentTime + i * 0.35; g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(loud ? 0.6 : 0.35, t0 + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.9);
    o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + 1);
  });
  return new Promise(r => setTimeout(r, notes.length * 350 + 400));
}

let voices = [];
function loadVoices() { try { voices = speechSynthesis.getVoices(); } catch (e) {} }
if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
let sayTarget = null; // element showing the current spoken text
function speak(text, { volume = 0.9, target } = {}) {
  const el = target || sayTarget; if (el) el.textContent = text;
  if (!('speechSynthesis' in window) || !text) return Promise.resolve();
  return new Promise(resolve => {
    let done = false; const fin = () => { if (!done) { done = true; clearTimeout(tm); resolve(); } };
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const code = LOCALE[S.lang || 'hi']; u.lang = code; u.rate = 0.9; u.volume = volume;
      const v = voices.find(v => v.lang.replace('_', '-').toLowerCase() === code.toLowerCase()) || voices.find(v => v.lang.toLowerCase().startsWith(code.slice(0, 2)));
      if (v) u.voice = v;
      u.onend = fin; u.onerror = fin;
      speechSynthesis.speak(u);
    } catch (e) { fin(); }
    const tm = setTimeout(fin, 2500 + text.length * 110);
  });
}
function stopSpeaking() { try { speechSynthesis.cancel(); } catch (e) {} }

/* ------------------------------------------------------------------ */
/* Listening: Wispr Flow API → browser SpeechRecognition → buttons     */
/* ------------------------------------------------------------------ */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const voiceState = { denied: false, srBroken: false };
const micAvailable = () => !voiceState.denied && (useWispr() || (SR && !voiceState.srBroken));
const useWispr = () => !!S.wisprKey && navigator.onLine && !!(navigator.mediaDevices && window.MediaRecorder);
let pending = null;      // current listen() {finish}
let queued = null;       // input given while not listening (button/typed)
let heardTarget = null;
let listenUI = () => {};  // callback(state) 'on'|'off'|'think'

function giveInput(v) { if (pending) pending.finish(v); else queued = v; }
function cancelListen() { if (pending) pending.finish({ cancel: true }); queued = null; }

/* listen(ms) → {text, conf} | {button} | {typed} | {error} | {cancel} | null (silence) */
function listen(ms = 9000, { waitForever = false } = {}) {
  if (queued) { const q = queued; queued = null; return Promise.resolve(q); }
  return new Promise(resolve => {
    let done = false, timer = null, rec = null, wrec = null;
    const finish = v => {
      if (done) return; done = true; clearTimeout(timer);
      try { rec && rec.abort(); } catch (e) {}
      try { wrec && wrec.stop(true); } catch (e) {}
      pending = null; listenUI('off'); resolve(v);
    };
    pending = { finish };
    if (!micAvailable()) { listenUI('off'); if (!waitForever) timer = setTimeout(() => finish(null), ms); return; }
    timer = setTimeout(() => finish(null), ms + 400);
    listenUI('on');
    if (useWispr()) {
      wrec = wisprListen(ms, { onText: (txt) => finish(txt ? { text: txt, conf: 1, engine: 'wispr' } : null), onThinking: () => listenUI('think'),
        onError: (err) => { console.warn('Wispr Flow failed, using browser recogniser:', err); if (err === 'denied') { voiceState.denied = true; finish({ error: 'denied' }); } else { S._wisprFailed = true; startBrowser(); } } });
    } else startBrowser();

    function startBrowser() {
      if (!SR || voiceState.srBroken) { listenUI('off'); return; }
      const end = Date.now() + ms;
      const go = () => {
        if (done) return;
        rec = new SR(); rec.lang = LOCALE[S.lang || 'hi']; rec.interimResults = true; rec.maxAlternatives = 3; rec.continuous = false;
        let got = false;
        rec.onresult = e => {
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const res = e.results[i];
            if (res.isFinal) { got = true; finish({ text: res[0].transcript, conf: res[0].confidence, engine: 'browser' }); return; }
            if (heardTarget) heardTarget.textContent = '… ' + res[0].transcript;
          }
        };
        rec.onerror = e => {
          if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { voiceState.denied = true; finish({ error: 'denied' }); }
          else if (e.error === 'network' || e.error === 'language-not-supported') { voiceState.srBroken = true; finish({ error: e.error }); }
        };
        rec.onend = () => { if (!done && !got) { if (Date.now() < end - 700) setTimeout(go, 150); else finish(null); } };
        try { rec.start(); } catch (e) { voiceState.srBroken = true; finish({ error: 'start' }); }
      };
      go();
    }
  });
}

/* Wispr Flow: record with simple voice-activity detection, send 16 kHz WAV.
   Docs: https://api-docs.wisprflow.ai — POST /api/v1/dash/api, Bearer API key. */
let micStream = null;
function wisprListen(maxMs, { onText, onThinking, onError }) {
  let stopped = false, mr = null, chunks = [], raf = 0, ctx = null;
  const ctl = { stop(silent) { stopped = true; cancelAnimationFrame(raf); try { if (mr && mr.state !== 'inactive') { if (silent) mr.onstop = null; mr.stop(); } } catch (e) {} try { ctx && ctx.close(); } catch (e) {} } };
  (async () => {
    try {
      if (!micStream || micStream.getTracks().some(tr => tr.readyState === 'ended')) micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) { onError(e.name === 'NotAllowedError' ? 'denied' : 'mic'); return; }
    if (stopped) return;
    mr = new MediaRecorder(micStream); chunks = [];
    mr.ondataavailable = e => e.data.size && chunks.push(e.data);
    let spoke = false, lastVoice = 0; const t0 = Date.now();
    mr.onstop = async () => {
      if (!spoke) { onText(null); return; }
      onThinking();
      try {
        const wav = await toWav16k(new Blob(chunks, { type: mr.mimeType }));
        const b64 = await blobToB64(wav);
        const res = await withTimeout(fetch('https://platform-api.wisprflow.ai/api/v1/dash/api', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + S.wisprKey },
          body: JSON.stringify({
            audio: b64, language: [S.lang || 'hi'],
            context: { app: { name: 'Dawai Dost', type: 'other' }, dictionary_context: wisprDictionary() }
          })
        }), 15000);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const j = await res.json(); onText((j.text || '').trim() || null);
      } catch (e) { onError(e.message); }
    };
    mr.start(250);
    ctx = new AudioContext(); const src = ctx.createMediaStreamSource(micStream); const an = ctx.createAnalyser(); an.fftSize = 1024; src.connect(an);
    const buf = new Float32Array(an.fftSize);
    const loop = () => {
      if (stopped) return;
      an.getFloatTimeDomainData(buf); let s = 0; for (const x of buf) s += x * x; const rms = Math.sqrt(s / buf.length);
      const nowT = Date.now();
      if (rms > 0.025) { spoke = true; lastVoice = nowT; if (heardTarget) heardTarget.textContent = '🎙️ …'; }
      if ((spoke && nowT - lastVoice > 1300) || nowT - t0 > maxMs) { stopped = true; try { ctx.close(); } catch (e) {} mr.stop(); return; }
      raf = requestAnimationFrame(loop);
    };
    loop();
  })();
  return ctl;
}
function wisprDictionary() {
  const words = ['BP', 'sugar', 'tablet', 'goli', 'dawai', 'Dawai Dost', 'kha li', 'le li', 'baad mein', 'bas', 'haan', 'nahi', 'saapten', 'ghetli'];
  S.meds.forEach(m => { if (m.name) words.push(m.name); });
  return words;
}
const blobToB64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onloadend = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
async function toWav16k(blob) {
  const ac = new AudioContext(); const ab = await ac.decodeAudioData(await blob.arrayBuffer()); ac.close();
  const rate = 16000, len = Math.floor(ab.duration * rate);
  const off = new OfflineAudioContext(1, len, rate); const s = off.createBufferSource(); s.buffer = ab; s.connect(off.destination); s.start(0);
  const pcm = (await off.startRendering()).getChannelData(0);
  const buf = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(buf);
  const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) { const x = Math.max(-1, Math.min(1, pcm[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
  return new Blob([buf], { type: 'audio/wav' });
}

/* hear(ctx): listen once and understand. Returns intent object or {silence}|{cancel}|{error}. */
async function hear(ctx, ms, extra = {}) {
  const r = await listen(ms, extra);
  if (!r) return { silence: true };
  if (r.cancel) return { cancel: true };
  if (r.error) return { error: r.error };
  if (r.button) return Object.assign({ intent: r.button, number: r.number ?? null, medicine: null, text: '' }, r.payload || {});
  const text = r.typed ?? r.text;
  if (heardTarget) heardTarget.textContent = t().heardPrefix + '“' + text + '”';
  if (!r.typed && r.conf > 0 && r.conf < 0.3) return { intent: 'unclear', lowConf: true, text };
  listenUI('think');
  const u = await understand(ctx, text, extra);
  listenUI('off');
  u.text = text;
  return u;
}

/* ------------------------------------------------------------------ */
/* Dose log + scheduler                                                */
/* ------------------------------------------------------------------ */
function ensureLog() {
  const dk = dateKey(now());
  let changed = false;
  for (const m of S.meds) for (const tm of m.times) {
    if (S.log.some(e => e.medId === m.id && e.date === dk && e.time === tm)) continue;
    if (atTime(dk, tm) < (m.createdAt || 0) - 60 * MIN) continue; // don't create doses from before the medicine existed
    S.log.push({ id: uid(), medId: m.id, date: dk, time: tm, status: 'pending', reply: null, remindedAt: null, repeated: false, snoozeUntil: null });
    changed = true;
  }
  if (changed) save();
}
const todayEntries = () => { const dk = dateKey(now()); return S.log.filter(e => e.date === dk && medById(e.medId)).sort((a, b) => a.time.localeCompare(b.time)); };

let busy = false;            // a conversation is running (setup / home question)
let active = null;           // {id, failures}
let reminderRunning = false;

function tick() {
  ensureLog();
  const tNow = now();
  for (const e of todayEntries()) {
    if (e.status !== 'pending' && e.status !== 'later') continue;
    const sched = atTime(e.date, e.time);
    if (tNow >= sched + 30 * MIN) { markMissed(e); continue; }
    const due = e.snoozeUntil || sched;
    if (tNow < due) continue;
    const needsFirst = !e.remindedAt || e.remindedAt < due;
    const needsRepeat = !needsFirst && !e.repeated && tNow >= e.remindedAt + 2 * MIN;
    if (!needsFirst && !needsRepeat) continue;
    if (busy) break;                                   // wait for conversation to end
    if (active && active.id !== e.id) break;           // one reminder at a time
    if (reminderRunning && !needsRepeat) break;
    runReminder(e, needsRepeat);
    break;
  }
  renderClock();
  if (!$('scr-home').hidden) renderToday();
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */
function addAlert(type, text) {
  S.alerts.push({ id: uid(), at: now(), type, text, to: S.family.name || '' });
  save(); renderBadge();
  if (!$('scr-family').hidden) renderFamily();
}
function markTaken(e, { speakIt = true } = {}) {
  const m = medById(e.medId);
  if (e.status === 'taken') return speak(t().already);
  e.status = 'taken'; e.reply = now(); e.snoozeUntil = null;
  m.stock = Math.max(0, (m.stock || 0) - (m.dose || 1));
  save();
  if (active && active.id === e.id) closeReminder();
  renderAll();
  return (speakIt ? speak(t().taken, { target: sayTarget }) : Promise.resolve()).then(() => checkLowStock(m));
}
function snooze(e) {
  e.status = 'later'; e.reply = now(); e.snoozeUntil = now() + 15 * MIN; e.repeated = false; save();
  if (active && active.id === e.id) closeReminder();
  renderAll();
  return speak(t().later);
}
function markMissed(e) {
  if (e.status === 'missed' || e.status === 'taken') return;
  e.status = 'missed'; save();
  const m = medById(e.medId);
  addAlert('missed', t().missedAlert(famCalls(), t().hourOnly(h12(e.time)), medLabel(m)));
  if (active && active.id === e.id) closeReminder();
  renderAll();
  if (!busy) { const msg = t().missedSay(t().hourOnly(h12(e.time)), medLabel(m)); toast(msg); speak(msg, { target: $('homeSay') }); }
}
async function checkLowStock(m) {
  const d = daysLeft(m);
  if (d <= 5 && !m.lowAlerted) {
    m.lowAlerted = true; save();
    addAlert('stock', t().lowAlert(famCalls(), medLabel(m), d, m.stock));
    await speak(t().lowSay(medLabel(m), d));
  } else if (d > 5 && m.lowAlerted) { m.lowAlerted = false; save(); }
}
async function doctorFlow(question) {
  await speak(t().doctor);
  showYesNoButtons(true);
  let a = await hear('yesno', 12000);
  if (a.intent !== 'yes' && a.intent !== 'no' && !a.cancel) { await speak(t().sorry); a = await hear('yesno', 12000); }
  showYesNoButtons(false);
  if (a.intent === 'yes') { addAlert('question', t().qAlert(famCalls(), question || '…')); await speak(t().told); }
  else if (!a.cancel) await speak(t().notTold);
}
/* the dose a "taken"/"should I take" statement refers to */
function targetDose(medHint) {
  const tNow = now();
  let list = todayEntries().filter(e => atTime(e.date, e.time) <= tNow + 60 * MIN);
  if (medHint && (medHint.purpose || medHint.colour)) {
    const f = list.filter(e => { const m = medById(e.medId); return (!medHint.purpose || m.purpose === medHint.purpose) && (!medHint.colour || m.colour === medHint.colour); });
    if (f.length) list = f;
  }
  if (!list.length) return null;
  const open = list.filter(e => e.status === 'pending' || e.status === 'later');
  return (open.length ? open[0] : list[list.length - 1]);
}

/* ------------------------------------------------------------------ */
/* Reminder flow                                                       */
/* ------------------------------------------------------------------ */
let remSession = 0;
async function runReminder(e, isRepeat) {
  const sess = ++remSession;
  cancelListen(); stopSpeaking();
  reminderRunning = true;
  if (!active || active.id !== e.id) active = { id: e.id, failures: 0 };
  e.remindedAt = now(); if (isRepeat) e.repeated = true; save();
  const m = medById(e.medId);
  openReminder(e, m, isRepeat);
  await chime(isRepeat);
  if (sess !== remSession) return;
  const msg = (isRepeat ? t().repeat : '') + t().reminder(userName(), medLabel(m), t().foodSay[m.food || 'any']);
  await speak(msg, { volume: isRepeat ? 1 : 0.85, target: $('remSay') });
  if (sess !== remSession) return;
  if (!micAvailable()) { showRemButtons(true); }
  const end = Date.now() + 30000;
  while (sess === remSession && active && active.id === e.id && Date.now() < end) {
    const r = await hear('reminder', end - Date.now());
    if (sess !== remSession) return;
    if (r.cancel) return;
    if (r.silence) break;
    if (r.error) { if (r.error === 'denied') await speak(t().micDenied, { target: $('remSay') }); showRemButtons(true); break; }
    if (r.intent === 'taken' || r.intent === 'yes') { reminderRunning = false; return markTaken(e); }
    if (r.intent === 'later' || r.intent === 'no') { reminderRunning = false; return snooze(e); }
    if (r.intent === 'medical_question') { await doctorFlow(r.text); if (sess !== remSession) return; await speak(t().reminder(userName(), medLabel(m), t().foodSay[m.food || 'any']), { target: $('remSay') }); continue; }
    if (r.intent === 'should_take') { await speak(t().reminder(userName(), medLabel(m), t().foodSay[m.food || 'any']), { target: $('remSay') }); continue; }
    active.failures++;
    if (active.failures >= 2) showRemButtons(true);
    await speak(t().sorry, { target: $('remSay') });
  }
  if (sess === remSession && active && active.id === e.id) {
    active.failures++;
    if (active.failures >= 2 || !micAvailable()) showRemButtons(true);
    $('remListen').textContent = '';
  }
  reminderRunning = false;
}
function openReminder(e, m, loud) {
  sayTarget = $('remSay'); heardTarget = $('remHeard');
  listenUI = s => { $('remListen').textContent = s === 'on' ? '🎙️ ' + t().listening : s === 'think' ? t().thinking : ''; };
  $('remTime').textContent = t().at(t().slot[slotOf(e.time)], h12(e.time));
  $('remPill').innerHTML = pillHTML(m);
  $('remLabel').textContent = medLabel(m);
  $('remFood').textContent = t().foodSay[m.food || 'any'];
  $('remHeard').textContent = '';
  $('reminder').classList.toggle('loud', !!loud);
  $('remTakenTxt').textContent = t().takenBtn; $('remLaterTxt').textContent = t().laterBtn;
  const activated = navigator.userActivation ? navigator.userActivation.hasBeenActive : true;
  $('remHearAgain').hidden = activated; $('remHearAgain').textContent = t().tapToHear;
  showRemButtons(active.failures >= 2 || !micAvailable());
  $('reminder').hidden = false;
}
function showRemButtons(on) { $('remButtons').hidden = !on; }
function closeReminder() {
  remSession++; active = null; reminderRunning = false; cancelListen();
  $('reminder').hidden = true; restoreHomeTargets();
}

/* ------------------------------------------------------------------ */
/* Home: ask anything                                                  */
/* ------------------------------------------------------------------ */
function restoreHomeTargets() {
  sayTarget = $('homeSay'); heardTarget = $('homeHeard');
  listenUI = s => {
    const b = $('homeMic'); b.classList.toggle('listening', s === 'on');
    $('homeMicLabel').textContent = s === 'on' ? t().listening : s === 'think' ? t().thinking : (micAvailable() ? t().tapMic : t().micOff);
    b.classList.toggle('off', !micAvailable());
  };
  listenUI('off');
}
async function homeAsk(preset) {
  if (busy) { if (pending) cancelListen(); return; }
  busy = true; stopSpeaking(); audioCtx();
  try {
    let r, fails = 0;
    if (preset) r = { intent: preset, text: '' };
    while (!r) {
      if (!micAvailable()) { showHomeQ(true); break; }
      const x = await hear('home', 9000);
      if (x.cancel) break;
      if (x.error) { if (x.error === 'denied') await speak(t().micDenied); showHomeQ(true); break; }
      if (x.silence || x.intent === 'unclear') {
        fails++;
        if (fails >= 2) { showHomeQ(true); await speak(t().sorry + ' ' + t().help); break; }
        await speak(t().sorry); continue;
      }
      r = x;
    }
    if (r) await answerHome(r);
  } finally { busy = false; restoreHomeTargets(); renderAll(); }
}
async function answerHome(r) {
  const L = t();
  switch (r.intent) {
    case 'status': return speak(statusText());
    case 'next': return speak(nextText());
    case 'stock': {
      const low = S.meds.filter(m => daysLeft(m) <= 5);
      return speak(low.length ? low.map(m => L.stockItem(medLabel(m), daysLeft(m))).join('\n') : L.stockOk);
    }
    case 'add': busy = false; return setupFlow(false);
    case 'taken': {
      const e = targetDose(r.medicine);
      if (!e) return speak(L.nothingDue);
      if (e.status === 'taken') return speak(L.already);
      if (e.status === 'missed') return doctorFlow(r.text);
      return markTaken(e);
    }
    case 'should_take': {
      const e = targetDose(r.medicine);
      if (e && e.status === 'taken') return speak(L.already);
      if (e && (e.status === 'pending' || e.status === 'later')) { busy = false; return runReminder(e, false); }
      return doctorFlow(r.text);
    }
    case 'medical_question': {
      const e = targetDose(r.medicine);
      if (e && e.status === 'taken' && has(norm(r.text), V.shouldTake)) await speak(L.already);
      return doctorFlow(r.text);
    }
    default: return speak(L.help);
  }
}
function statusText() {
  const L = t(); const list = todayEntries();
  if (!S.meds.length) return L.noMeds;
  if (!list.length) return L.noneToday;
  if (list.every(e => e.status === 'taken')) return L.allDone;
  return L.statusIntro + '\n' + list.map(e => {
    const st = e.status === 'taken' ? L.stTaken : e.status === 'missed' ? L.stMissed : e.status === 'later' ? L.stLater : L.stLeft;
    return `${medLabel(medById(e.medId))}, ${L.at(L.slot[slotOf(e.time)], h12(e.time))} — ${st}`;
  }).join('\n');
}
function nextDose() {
  const tNow = now();
  const open = todayEntries().filter(e => (e.status === 'pending' || e.status === 'later'));
  const fut = open.map(e => ({ e, at: e.snoozeUntil || atTime(e.date, e.time) })).sort((a, b) => a.at - b.at);
  if (fut.length) return { med: medById(fut[0].e.medId), at: Math.max(fut[0].at, tNow), time: fut[0].e.snoozeUntil ? `${pad(new Date(fut[0].e.snoozeUntil).getHours())}:${pad(new Date(fut[0].e.snoozeUntil).getMinutes())}` : fut[0].e.time, tomorrow: false };
  let best = null;
  for (const m of S.meds) for (const tm of m.times) if (!best || tm < best.time) best = { med: m, time: tm, tomorrow: true };
  return best;
}
function nextText() {
  const n = nextDose(); const L = t();
  if (!n) return L.noMeds;
  return L.next(medLabel(n.med), n.tomorrow ? L.tomorrow : '', L.at(L.slot[slotOf(n.time)], h12(n.time)));
}

/* ------------------------------------------------------------------ */
/* Setup conversation                                                  */
/* ------------------------------------------------------------------ */
function openTalk() {
  $('talk').hidden = false; $('talkTitle').textContent = t().talkTitle;
  $('talkTypeToggle').textContent = '⌨ ' + t().typeInstead;
  $('talkCard').innerHTML = ''; $('talkHeard').textContent = ''; $('talkSay').textContent = '';
  sayTarget = $('talkSay'); heardTarget = $('talkHeard');
  listenUI = s => { $('talkMic').classList.toggle('listening', s === 'on'); $('talkMic').classList.toggle('off', !micAvailable()); if (s === 'think') $('talkHeard').textContent = $('talkHeard').textContent || t().thinking; };
  listenUI('off');
}
let talkAbort = false;
function closeTalk() { $('talk').hidden = true; $('talkButtons').innerHTML = ''; $('talkTypeForm').hidden = true; restoreHomeTargets(); }

/* kind: 'yesno' | 'yesdone' | 'number' | 'text' */
function talkButtons(kind, failures) {
  const L = t(), box = $('talkButtons'); box.innerHTML = '';
  const add = (label, cls, val) => { const b = document.createElement('button'); b.className = cls; b.textContent = label; b.onclick = () => giveInput(val); box.appendChild(b); };
  if (kind === 'yesno') { add('✓ ' + L.yes, 'btn-yes', { button: 'yes' }); add('✕ ' + L.no, 'btn-no', { button: 'no' }); }
  if (kind === 'yesdone') { add('✓ ' + L.yes, 'btn-yes', { button: 'yes' }); add('■ ' + L.bas, 'btn-no', { button: 'done' }); }
  if (kind === 'medicine' && failures >= 1) { add('■ ' + L.bas, 'btn-no', { button: 'done' }); }
  const needType = (kind === 'text' || kind === 'number' || kind === 'medicine') && (failures >= 2 || !micAvailable());
  if (needType) showType(kind === 'number');
}
function showType(numeric) {
  $('talkTypeForm').hidden = false;
  const inp = $('talkType'); inp.value = ''; inp.inputMode = numeric ? 'numeric' : 'text'; inp.type = numeric ? 'number' : 'text';
  setTimeout(() => inp.focus(), 50);
}

async function ask(prompt, ctx, kind, extra = {}) {
  let failures = 0;
  if (prompt) await speak(prompt);
  for (;;) {
    if (talkAbort) return { cancel: true };
    talkButtons(kind, failures);
    const r = await hear(ctx, 10000, Object.assign({ waitForever: !micAvailable() }, extra));
    if (talkAbort || r.cancel) return { cancel: true };
    if (r.error === 'denied') { await speak(t().micDenied); failures = 2; continue; }
    if (r.error) { failures = 2; continue; }
    if (r.silence || r.intent === 'unclear') {
      failures++;
      await speak(ctx === 'medicine' && !r.silence && !r.lowConf ? t().notMed : t().sorry);
      continue;
    }
    $('talkTypeForm').hidden = true;
    return r;
  }
}

function showMedCard(m, stock) {
  const L = t();
  $('talkCard').innerHTML = `<div class="med-preview">
    <div class="top">${pillHTML(m)}<div class="lbl">${esc(medLabel(m))}</div></div>
    <dl>
      ${m.name ? `<dt>💊</dt><dd>${esc(m.name)}</dd>` : ''}
      <dt>⏰</dt><dd>${esc(timesText(m))}</dd>
      <dt>#</dt><dd><span class="num">${m.dose}</span> · ${esc(L.dose(m.dose))}</dd>
      ${m.food && m.food !== 'any' ? `<dt>🍽️</dt><dd>${esc(L.foodSay[m.food])}</dd>` : ''}
      ${stock != null ? `<dt>📦</dt><dd><span class="num">${stock}</span> · ${esc(L.left(stock))}</dd>` : ''}
    </dl></div>`;
}
function finalizeMed(p, spoken) {
  return {
    id: uid(), spoken, name: p.name || '', colour: p.colour || null, shape: p.shape || null,
    purpose: p.purpose || null, purposeOther: p.purposeOther || '',
    dose: p.dose != null ? p.dose : 1,
    times: p.times && p.times.length ? [...new Set(p.times)].sort() : ['08:00'],
    food: p.food || 'any', stock: 0
  };
}
function mergeMed(m, p) {
  if (!p) return m;
  for (const k of ['name', 'colour', 'shape', 'purpose', 'purposeOther', 'dose', 'food']) if (p[k] != null && p[k] !== '') m[k] = p[k];
  if (p.times && p.times.length) m.times = [...new Set(p.times)].sort();
  if (p.purpose) m.purposeOther = '';
  return m;
}

async function setupFlow(first) {
  if (busy) return;
  busy = true; talkAbort = false; cancelListen(); stopSpeaking(); audioCtx();
  openTalk();
  try {
    if (!navigator.onLine) { await speak(t().needNet); await new Promise(r => setTimeout(r, 1200)); return; }
    let prompt = first ? t().greet : t().askNew;
    let carry = null;
    for (;;) {
      $('talkCard').innerHTML = '';
      const r = carry || await ask(prompt, 'medicine', 'medicine');
      carry = null;
      if (r.cancel) return;
      if (r.intent === 'done' || r.intent === 'no') break;
      if (!medHasInfo(r.medicine)) { prompt = t().notMed; continue; }
      const m = finalizeMed(r.medicine, r.text);
      // confirm — never save without "yes"
      let doseOk = m.dose === 1;
      for (;;) {
        showMedCard(m);
        const a = await ask(readback(m), 'yesno', 'yesno');
        if (a.cancel) return;
        if (a.intent === 'yes') {
          if (!doseOk) {
            const d = await ask(t().doseCheck(m.dose), 'yesno', 'yesno');
            if (d.cancel) return;
            if (d.intent === 'yes') { doseOk = true; break; }
            const c = await ask(t().whatChange, 'edit', 'text', { existing: m });
            if (c.cancel) return;
            mergeMed(m, c.medicine); doseOk = m.dose === 1; continue;
          }
          break;
        }
        if (a.medicine && (medHasInfo(a.medicine) || a.medicine.dose != null || a.medicine.food)) { mergeMed(m, a.medicine); doseOk = m.dose === 1; continue; }
        const c = await ask(t().whatChange, 'edit', 'text', { existing: m });
        if (c.cancel) return;
        if (c.intent === 'yes') continue;
        mergeMed(m, c.medicine); doseOk = m.dose === 1;
      }
      // stock — double-check the number
      let stock = null;
      for (;;) {
        const n = await ask(t().askStock, 'number', 'number');
        if (n.cancel) return;
        if (n.number == null) continue;
        showMedCard(m, n.number);
        const y = await ask(t().stockCheck(n.number), 'yesno', 'yesno');
        if (y.cancel) return;
        if (y.intent === 'yes') { stock = n.number; break; }
      }
      m.stock = stock; m.createdAt = now();
      S.meds.push(m); save(); ensureLog(); renderAll();
      await speak(t().saved);
      await checkLowStock(m);
      const more = await ask(t().askMore, 'more', 'yesdone');
      if (more.cancel) return;
      if (more.intent === 'medicine' && medHasInfo(more.medicine)) { carry = more; continue; }
      if (more.intent === 'yes') { prompt = t().askNext; continue; }
      break;
    }
    if (S.meds.length) { S.setupDone = true; save(); await speak(t().setupDone); }
  } finally {
    busy = false; closeTalk(); renderAll();
  }
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */
function renderClock() {
  const d = new Date(now());
  const txt = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  $('clockChip').textContent = (S.clockOffset ? '⏱ ' : '') + txt;
  $('clockChip').classList.toggle('test', !!S.clockOffset);
  const cn = $('clockNow'); if (cn) cn.textContent = `${d.toLocaleDateString()} · ${txt}:${pad(d.getSeconds())}`;
}
function renderBadge() {
  const n = S.alerts.length - (S.alertsSeen || 0);
  $('famBadge').hidden = n <= 0; $('famBadge').textContent = n;
}
function renderToday() {
  const L = t(), list = todayEntries(), tNow = now();
  $('todayTitle').textContent = L.today;
  $('homeSetup').hidden = S.meds.length > 0; $('homeSetup').textContent = L.startSetup;
  const html = list.map(e => {
    const m = medById(e.medId);
    let cls = e.status;
    if (e.status === 'pending' && atTime(e.date, e.time) <= tNow) cls = 'due';
    const st = cls === 'taken' ? L.stTaken : cls === 'missed' ? L.stMissed : cls === 'later' ? L.stLater : L.stLeft;
    const mark = cls === 'taken' ? '✓' : cls === 'missed' ? '✕' : (cls === 'due' || cls === 'later') ? '!' : '';
    return `<button class="dose ${cls}" data-entry="${e.id}">
      <span class="pocket ${cls}">${pillHTML(m)}<span class="mark" aria-hidden="true">${mark}</span></span>
      <span class="info"><span class="tm">${esc(L.at(L.slot[slotOf(e.time)], h12(e.time)))}</span>
      <span class="lbl">${esc(medLabel(m))} · ${esc(L.dose(m.dose))}</span>
      <span class="st">${esc(st)}</span></span></button>`;
  }).join('');
  const key = html + L.today;
  if ($('todayList')._k !== key) { $('todayList').innerHTML = html || (S.meds.length ? `<div class="empty">${esc(L.noneToday)}</div>` : ''); $('todayList')._k = key; }
}
function showHomeQ(on) {
  const box = $('homeQButtons'); box.hidden = !on; if (!on) return;
  const L = t();
  box.innerHTML = `<button data-q="status">❓ ${esc(L.qStatus)}</button><button data-q="next">⏰ ${esc(L.qNext)}</button><button data-q="stock">📦 ${esc(L.qStock)}</button>`;
}
function renderMeds() {
  const L = t();
  $('medsTitle').textContent = L.medsTitle; $('addMedBtn').textContent = L.addMed;
  $('medList').innerHTML = S.meds.length ? S.meds.map(m => {
    const d = daysLeft(m);
    return `<div class="med">
      <div class="top">${pillHTML(m)}<div><div class="lbl">${esc(medLabel(m))}</div>${m.name ? `<div class="nm">${esc(m.name)}</div>` : ''}</div></div>
      <div class="row2">⏰ ${esc(timesText(m))}</div>
      <div class="row2"># ${esc(L.dose(m.dose))}${m.food !== 'any' ? ' · ' + esc(L.foodSay[m.food]) : ''}</div>
      <div class="row2 stock ${d <= 5 ? 'low' : ''}">📦 ${esc(L.left(m.stock))} · ${esc(L.days(d))}</div>
      <div class="acts"><button class="btn-mid" data-refill="${m.id}">${esc(L.refill)}</button><button class="btn-mid" data-del="${m.id}">${esc(L.del)}</button></div>
    </div>`;
  }).join('') : `<div class="empty">${esc(L.noMeds)}</div>`;
}
function renderFamily() {
  const L = t();
  $('waName').textContent = S.family.name || L.noFam;
  $('waSub').textContent = S.family.phone ? S.family.phone : 'WhatsApp';
  $('waNote').textContent = L.simNote;
  let lastDay = '';
  $('waBody').innerHTML = S.alerts.length ? S.alerts.map(a => {
    const d = new Date(a.at); const day = d.toLocaleDateString();
    const head = day !== lastDay ? `<div class="wa-day">${esc(day)}</div>` : ''; lastDay = day;
    const icon = a.type === 'missed' ? '❌ ' : a.type === 'stock' ? '📦 ' : '❓ ';
    return `${head}<div class="wa-msg ${a.type}">${icon}<b>Dawai Dost:</b> ${esc(a.text)}<span class="meta">${pad(d.getHours())}:${pad(d.getMinutes())} ✓✓</span></div>`;
  }).join('') : `<div class="wa-day">${esc(L.noAlerts)}</div>`;
  S.alertsSeen = S.alerts.length; save(); renderBadge();
  const b = $('waBody'); b.scrollTop = b.scrollHeight;
}
function renderSettings() {
  const L = t();
  $('setTitle').textContent = L.setTitle; $('setLangH').textContent = L.setLang;
  document.querySelectorAll('#setLangGrid .lang-btn').forEach(b => b.classList.toggle('on', b.dataset.lang === S.lang));
  $('setNamesH').textContent = L.setNames; $('lblUserName').textContent = L.userName; $('lblFamCalls').textContent = L.famCalls;
  $('inUserName').placeholder = DEFAULT_NAMES[S.lang][0]; $('inFamCalls').placeholder = DEFAULT_NAMES[S.lang][1];
  $('inUserName').value = S.userName; $('inFamCalls').value = S.famCalls;
  $('setFamH').textContent = L.setFam; $('lblFamName').textContent = L.famName; $('lblFamPhone').textContent = L.famPhone;
  $('inFamName').value = S.family.name; $('inFamPhone').value = S.family.phone;
  $('setClockH').textContent = L.setClock; $('btnSetClock').textContent = L.setClockBtn; $('btnNextDose').textContent = L.nextDose; $('btnRealTime').textContent = L.realTime;
  $('setVoiceH').textContent = L.setVoice;
  $('voiceHint').textContent = 'Wispr Flow: speech-to-text for accents & mixed languages (key from platform.wisprflow.ai). Claude: understands free-form replies. Both are optional and stored only on this device; without them the browser recogniser and built-in parser are used.';
  $('inWispr').value = S.wisprKey; $('inClaude').value = S.claudeKey;
  renderEngine();
  $('btnReset').textContent = L.reset;
  renderClock();
}
function renderEngine() {
  const stt = useWispr() ? 'Wispr Flow' : (SR ? 'Browser (' + LOCALE[S.lang] + ')' : 'Buttons only');
  const nlu = S.claudeKey ? (navigator.onLine ? 'Claude (claude-opus-5-5) + built-in fallback' : 'Built-in (offline)') : 'Built-in';
  $('engineStatus').textContent = `🎙️ ${stt}   🧠 ${nlu}`;
}
function renderStatic() {
  const L = t();
  document.documentElement.lang = S.lang;
  ['tabHome', 'tabMeds', 'tabFamily', 'tabSettings'].forEach((id, i) => $(id).textContent = L.tabs[i]);
  $('homeMicLabel').textContent = micAvailable() ? L.tapMic : L.micOff;
  $('offlineBar').textContent = L.offline; $('offlineBar').hidden = navigator.onLine;
  $('homeHello').textContent = ({ hi: 'नमस्ते', mr: 'नमस्कार', ta: 'வணக்கம்', en: 'Namaste' })[S.lang] + ', ' + userName();
  if (!micAvailable() && $('homeQButtons').hidden) showHomeQ(true);
}
function renderAll() {
  if (!S.lang) return;
  renderStatic(); renderToday(); renderBadge();
  if (!$('scr-meds').hidden) renderMeds();
  if (!$('scr-family').hidden) renderFamily();
  if (!$('scr-settings').hidden) renderSettings();
  renderClock();
}
function showTab(name) {
  ['home', 'meds', 'family', 'settings'].forEach(n => { $('scr-' + n).hidden = n !== name; });
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  if (name === 'meds') renderMeds();
  if (name === 'family') renderFamily();
  if (name === 'settings') renderSettings();
  if (name === 'home') renderToday();
  window.scrollTo(0, 0); $('deviceScreen').scrollTop = 0;
}
let toastT = 0;
function toast(msg) { const el = $('toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, 6000); }

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */
function chooseLang(l) {
  const firstTime = !S.lang;
  S.lang = l; save();
  $('langScreen').hidden = true; $('app').hidden = false;
  restoreHomeTargets(); renderAll(); showTab('home');
  if (firstTime && !S.meds.length) setupFlow(true);
}
document.querySelectorAll('#langScreen .lang-btn').forEach(b => b.onclick = () => { audioCtx(); chooseLang(b.dataset.lang); });
$('langMic').onclick = async () => {
  audioCtx();
  const prev = S.lang; S.lang = 'hi';
  heardTarget = $('langHeard'); sayTarget = $('langHeard');
  listenUI = s => $('langMic').classList.toggle('listening', s === 'on');
  for (let i = 0; i < 2; i++) {
    const r = await hear('lang', 7000);
    if (r.intent && T[r.intent]) { S.lang = prev; return chooseLang(r.intent); }
    if (r.error) break;
  }
  S.lang = prev;
  $('langHeard').textContent = 'हिंदी चुनने के लिए ऊपर दबाइये · Tap a language above';
};

document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => showTab(b.dataset.tab));
$('homeMic').onclick = () => homeAsk();
$('homeSetup').onclick = () => setupFlow(!S.meds.length);
$('homeQButtons').onclick = e => { const q = e.target.closest('[data-q]'); if (q) homeAsk(q.dataset.q); };
$('todayList').onclick = e => {
  const b = e.target.closest('[data-entry]'); if (!b || busy) return;
  const en = S.log.find(x => x.id === b.dataset.entry); const m = medById(en.medId);
  audioCtx(); restoreHomeTargets();
  if (en.status === 'taken') return speak(t().already);
  if (en.status === 'missed') return speak(t().missedSay(t().hourOnly(h12(en.time)), medLabel(m)));
  if (atTime(en.date, en.time) <= now() + 60 * MIN) return runReminder(en, false);
  speak(`${medLabel(m)}: ${t().at(t().slot[slotOf(en.time)], h12(en.time))}, ${t().dose(m.dose)}${t().foodRb[m.food || 'any']}`);
};
$('addMedBtn').onclick = () => setupFlow(!S.meds.length);
$('medList').onclick = e => {
  const d = e.target.closest('[data-del]'), r = e.target.closest('[data-refill]');
  if (d && confirm(t().confirmDel)) { S.meds = S.meds.filter(m => m.id !== d.dataset.del); S.log = S.log.filter(x => x.medId !== d.dataset.del || x.status !== 'pending'); save(); renderAll(); renderMeds(); }
  if (r) { const m = medById(r.dataset.refill); const v = prompt(t().refillAsk, m.stock); if (v != null && !isNaN(+v)) { m.stock = Math.max(0, Math.round(+v)); if (daysLeft(m) > 5) m.lowAlerted = false; save(); renderMeds(); checkLowStock(m); } }
};

// talk panel
$('talkMic').onclick = () => { stopSpeaking(); audioCtx(); };
$('talkClose').onclick = () => { talkAbort = true; cancelListen(); stopSpeaking(); };
$('talkTypeToggle').onclick = () => showType(false);
$('talkTypeForm').onsubmit = e => { e.preventDefault(); const v = $('talkType').value.trim(); if (!v) return; $('talkType').value = ''; giveInput({ typed: v }); };

// reminder
$('remTaken').onclick = () => { const e = active && S.log.find(x => x.id === active.id); if (e) { cancelListen(); markTaken(e); } };
$('remLater').onclick = () => { const e = active && S.log.find(x => x.id === active.id); if (e) { cancelListen(); snooze(e); } };
$('remHearAgain').onclick = () => { audioCtx(); $('remHearAgain').hidden = true; const e = active && S.log.find(x => x.id === active.id); if (e) runReminder(e, false); };

// settings
document.querySelectorAll('#setLangGrid .lang-btn').forEach(b => b.onclick = () => { S.lang = b.dataset.lang; save(); renderAll(); renderSettings(); speak(T[S.lang].tapMic, { target: $('homeSay') }); });
const bindInput = (id, fn) => $(id).addEventListener('change', e => { fn(e.target.value.trim()); save(); renderAll(); });
bindInput('inUserName', v => S.userName = v);
bindInput('inFamCalls', v => S.famCalls = v);
bindInput('inFamName', v => S.family.name = v);
bindInput('inFamPhone', v => S.family.phone = v);
bindInput('inWispr', v => { S.wisprKey = v; renderEngine(); });
bindInput('inClaude', v => { S.claudeKey = v; renderEngine(); });
function addMinutes(n) { S.clockOffset += n * MIN; save(); tick(); }
document.querySelectorAll('[data-add]').forEach(b => b.onclick = () => addMinutes(+b.dataset.add));
$('btnSetClock').onclick = () => {
  const v = $('inClock').value; if (!v) return;
  let target = atTime(dateKey(now()), v);
  S.clockOffset = target - Date.now(); save(); tick();
};
$('btnNextDose').onclick = () => {
  const n = nextDose(); if (!n) return toast(t().noMeds);
  let target = n.tomorrow ? atTime(dateKey(now() + 24 * 60 * MIN), n.time) : atTime(dateKey(now()), n.time);
  S.clockOffset = target - Date.now() + 1000; save(); tick(); showTab('home');
};
$('btnRealTime').onclick = () => { S.clockOffset = 0; save(); tick(); };
$('btnReset').onclick = () => { if (confirm(t().confirmReset)) { localStorage.removeItem(KEY); location.reload(); } };

window.addEventListener('online', () => { renderAll(); });
window.addEventListener('offline', () => { renderAll(); });

/* test/debug hooks (used for automated checks; harmless in production) */
window.DD = { S, hear: text => giveInput({ typed: text }), now, tick, localUnderstand, parseMedLocal, statusText, nextText };

/* boot */
if (!S.lang) { $('langScreen').hidden = false; }
else { $('app').hidden = false; restoreHomeTargets(); renderAll(); showTab('home'); }
setInterval(tick, 1000); tick();
