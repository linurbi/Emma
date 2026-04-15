'use strict';

/* ═══════════════════════════════════════════════════
   CONFIG
═══════════════════════════════════════════════════ */
const CONFIG = {
  maxQuestions: 21,
  maxGuesses:   3,
  apiEndpoint:  '/api/chat',
};

/* ═══════════════════════════════════════════════════
   FIXED QUESTIONS
   These 5 questions are ALWAYS asked first, instantly,
   with no AI delay. They give the AI a solid foundation.
═══════════════════════════════════════════════════ */
const FIXED_QUESTIONS = [
  { id: 'isMale',    text: 'האם הדמות זכר?' },
  { id: 'isCartoon', text: 'האם הדמות מצוירת (אנימציה / קומיקס)?' },
  { id: 'isReal',    text: 'האם הדמות אדם אמיתי שחי בעולם האמיתי?' },
  { id: 'isFamous',  text: 'האם הדמות מפורסמת מאוד?' },
  { id: 'isAnimal',  text: 'האם הדמות חיה (בעל חיים)?' },
];

/* ═══════════════════════════════════════════════════
   AI SYSTEM PROMPT
   The AI only takes over AFTER the 5 fixed questions,
   so it already knows: sex / cartoon / real / famous / animal.
═══════════════════════════════════════════════════ */
const SYSTEM_PROMPT = `אתה משחק "נחש מי הדמות" עם ילדים ומבוגרים.
כבר נשאלו 5 שאלות בסיסיות — קיבלת עובדות ראשוניות על הדמות.

━━━ חשוב מאוד — שני מסלולים שונים ━━━

מסלול א׳ — הדמות לא מפורסמת (isFamous=לא):
  זו דמות אישית שרק המשתמש מכיר! אל תשאל כלל על תחומי פרסום.
  שאל שאלות אישיות כמו:
  • האם זה מישהו ממשפחתך?
  • האם זה חבר/ה קרוב/ה?
  • האם אתם גרים באותו בית?
  • האם הדמות מבוגרת ממך?
  • האם הדמות עובדת?
  • האם פגשת אותה היום?
  אחרי 4-5 שאלות — נחש בצורה חמודה לפי ההקשר (בן/בת זוג, הורה, חבר, מורה וכו׳).

מסלול ב׳ — הדמות מפורסמת (isFamous=כן):
  שאל: זמר/ת? שחקן/ית? ספורטאי/ת? ישראלי/ת? עדיין חי/ה?
  אם מצויר — חשוב על: באגס באני, דאפי דאק, מיקי מאוס, ספוגבוב, שרק, פיקאצ'ו, סימבה, אריאל, אלזה, בן10, דורה, הארי פוטר, טום, ג'רי, וודי, באז לייטייר.
  נחש אחרי 4-6 שאלות.

━━━ כללים לכולם ━━━
• שאלה אחת קצרה בלבד — כן/לא.
• שפה פשוטה שגם ילד בן 6 יבין.
• אל תחזור על שאלה שכבר נשאלה.
• אסור לשאול שוב "האם מפורסם?" — כבר נשאל ונענה!

פורמט ניחוש (ורק בפורמט הזה):
GUESS|||[שם/תיאור]|||[English/description]|||[emoji]|||[רמז 1]|||[רמז 2]|||[רמז 3]

דוגמה לדמות לא מפורסמת:
GUESS|||בן/בת הזוג שלך|||Your partner|||💑|||גר/ה איתך|||אתם זוג|||מכיר/ה אותו/ה טוב מאוד

דוגמה לדמות מפורסמת:
GUESS|||באגס באני|||Bugs Bunny|||🐰|||ארנב מצויר|||אוהב גזר|||אומר "מה יש, דוקטור?"`;

/* ═══════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════ */
let state = buildInitialState();

function buildInitialState() {
  return {
    phase:        'fixed',  // 'fixed' | 'ai'
    fixedIdx:     0,        // current index in FIXED_QUESTIONS
    fixedAnswers: {},       // { isMale: true, isCartoon: false, ... }
    history:      [],       // messages for OpenAI (only used in 'ai' phase)
    qCount:       0,
    guessCount:   0,
    lastGuess:    null,
  };
}

/* ═══════════════════════════════════════════════════
   API CALL
═══════════════════════════════════════════════════ */
async function callAI(messages) {
  const res = await fetch(CONFIG.apiEndpoint, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${res.status}`);
  }

  const data = await res.json();
  return data.choices[0].message.content.trim();
}

/* ═══════════════════════════════════════════════════
   RESPONSE PARSING
═══════════════════════════════════════════════════ */
function parseResponse(text) {
  if (text.includes('GUESS|||')) {
    const parts = text.split('GUESS|||')[1].split('|||').map(s => s.trim());
    return {
      type:   'guess',
      nameHe: parts[0] || '???',
      nameEn: parts[1] || '',
      emoji:  parts[2] || '🤔',
      clues:  [parts[3], parts[4], parts[5]].filter(Boolean),
    };
  }
  return { type: 'question', text: text.replace(/^"(.*)"$/, '$1') };
}

/* ═══════════════════════════════════════════════════
   GAME FLOW
═══════════════════════════════════════════════════ */
function goThinking() { show('thinking'); }

function startAsking() {
  state = buildInitialState();
  clearProgressUI();
  show('asking');
  askNextQuestion();
}

/** Central dispatcher — decides fixed vs AI turn */
function askNextQuestion() {
  if (state.phase === 'fixed') {
    askFixedQuestion();
  } else {
    fetchAIQuestion();
  }
}

/* ── Fixed phase (instant, no API) ── */
function askFixedQuestion() {
  if (state.fixedIdx >= FIXED_QUESTIONS.length) {
    switchToAIPhase();
    return;
  }

  const q = FIXED_QUESTIONS[state.fixedIdx];
  state.qCount++;
  updateProgressUI();
  setText('qBadge', `שאלה #${state.qCount}`);
  setText('qText',  q.text);
  setAskingUILocked(false);
}

/** Called after all fixed questions are answered — hands off to AI */
function switchToAIPhase() {
  state.phase = 'ai';

  // Build a context summary so the AI knows what was already answered
  const a = state.fixedAnswers;
  const facts = [
    `מין: ${a.isMale    ? 'זכר' : 'נקבה'}`,
    `מצויר: ${a.isCartoon ? 'כן'  : 'לא'}`,
    `אדם אמיתי: ${a.isReal    ? 'כן'  : 'לא'}`,
    `מפורסם מאוד: ${a.isFamous  ? 'כן'  : 'לא'}`,
    `חיה (בע"ח): ${a.isAnimal  ? 'כן'  : 'לא'}`,
  ].join(' | ');

  state.history = [{
    role:    'user',
    content: `תשובות לשאלות הראשונות: ${facts}. המשך לשאול שאלות ספציפיות יותר.`,
  }];

  fetchAIQuestion();
}

/* ── AI phase ── */
async function fetchAIQuestion() {
  setAskingUILocked(true);

  try {
    const raw    = await callAI(state.history);
    const parsed = parseResponse(raw);

    state.history.push({ role: 'assistant', content: raw });

    if (parsed.type === 'guess') {
      handleGuess(parsed);
    } else {
      showAIQuestion(parsed.text);
    }
  } catch (err) {
    showInlineError(`שגיאה: ${err.message}`);
    setAskingUILocked(false);
  }
}

function showAIQuestion(text) {
  state.qCount++;
  updateProgressUI();
  setText('qBadge', `שאלה #${state.qCount}`);
  setText('qText',  text);
  setAskingUILocked(false);

  if (state.qCount >= CONFIG.maxQuestions) {
    // Force a final guess
    state.history.push({ role: 'user', content: 'נגמרו השאלות שלי, נחש עכשיו!' });
    fetchAIQuestion();
  }
}

function handleGuess(guess) {
  state.guessCount++;
  state.lastGuess = guess;

  updateGuessDots();
  setText('guessNumLabel', state.guessCount);
  setText('gEmoji',  guess.emoji);
  setText('gName',   guess.nameHe);
  setText('gNameEn', guess.nameEn);
  setHTML('gClues',  guess.clues.map(c => `<span class="clue">💡 ${c}</span>`).join(''));

  show('guessing');
}

/* ── User answers yes/no ── */
function giveAnswer(isYes) {
  addAnswerDot(isYes);

  if (state.phase === 'fixed') {
    // Record the fixed answer
    const q = FIXED_QUESTIONS[state.fixedIdx];
    state.fixedAnswers[q.id] = isYes;
    state.fixedIdx++;
    askNextQuestion();
  } else {
    // Add answer to AI conversation history
    state.history.push({ role: 'user', content: isYes ? 'כן' : 'לא' });

    if (state.qCount >= CONFIG.maxQuestions) {
      show('lose');
      return;
    }

    show('asking');
    fetchAIQuestion();
  }
}

function onGuessResult(correct) {
  if (correct) {
    showWin();
    return;
  }

  state.history.push({
    role:    'user',
    content: `לא, זה לא ${state.lastGuess.nameHe}. שאל עוד שאלות ספציפיות.`,
  });

  if (state.guessCount >= CONFIG.maxGuesses) {
    show('lose');
    return;
  }

  show('asking');
  fetchAIQuestion();
}

/* ═══════════════════════════════════════════════════
   WIN / LOSE
═══════════════════════════════════════════════════ */
function showWin() {
  show('win');
  setHTML('winStats', buildStatsHTML());
  setHTML('winCard',  buildWinCardHTML(state.lastGuess));
  launchConfetti();
}

function buildStatsHTML() {
  return `
    <div class="stat"><div class="stat-n">${state.qCount}</div><div class="stat-l">שאלות</div></div>
    <div class="stat"><div class="stat-n">${state.guessCount}</div><div class="stat-l">ניחושים</div></div>
  `;
}

function buildWinCardHTML(g) {
  const clues = g.clues.map(c => `<span class="clue">💡 ${c}</span>`).join('');
  return `
    <span style="font-size:4rem;display:block;margin-bottom:10px;">${g.emoji}</span>
    <div style="font-size:1.7rem;font-weight:900;
      background:linear-gradient(135deg,#ffdd00,#ff6b35);
      -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">
      ${g.nameHe}
    </div>
    <div style="color:rgba(255,255,255,.35);font-size:.85rem;margin-top:3px;">${g.nameEn}</div>
    <div style="margin-top:13px;">${clues}</div>
  `;
}

function resetGame() {
  clearConfetti();
  state = buildInitialState();
  show('intro');
}

/* ═══════════════════════════════════════════════════
   UI HELPERS
═══════════════════════════════════════════════════ */
const SCREEN_IDS = ['intro', 'thinking', 'asking', 'guessing', 'win', 'lose'];

function show(name) {
  SCREEN_IDS.forEach(id => {
    const el = document.getElementById(`s-${id}`);
    if (!el) return;
    const isTarget = id === name;
    el.classList.toggle('hidden', !isTarget);
    if (isTarget) triggerAnimation(el);
  });
}

function triggerAnimation(el) {
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
}

function showEl(id, visible) {
  document.getElementById(id).classList.toggle('hidden', !visible);
}

function setText(id, value) { document.getElementById(id).textContent = value; }
function setHTML(id, html)  { document.getElementById(id).innerHTML   = html;  }

function setAskingUILocked(locked) {
  const btns  = document.getElementById('yesNoBtns');
  const anim  = document.getElementById('thinkingAnim');
  const block = document.getElementById('qBlock');

  btns.style.display  = locked ? 'none' : 'flex';
  anim.classList.toggle('hidden', !locked);
  block.style.opacity = locked ? '0.3' : '1';
}

function showInlineError(msg) {
  const el = document.getElementById('apiErrInline');
  el.textContent = msg;
  showEl('apiErrInline', true);
}

function updateProgressUI() {
  setText('qLabel', `שאלה ${state.qCount} מתוך ${CONFIG.maxQuestions}`);
  document.getElementById('pBar').style.width = `${(state.qCount / CONFIG.maxQuestions) * 100}%`;
  setText('remainLabel', remainLabel());
}

function remainLabel() {
  if (state.phase === 'fixed') return '🔍 שאלות בסיסיות...';
  if (state.qCount < 10)       return '🤔 מצמצם אפשרויות...';
  if (state.qCount < 16)       return '🔥 מתקרב!';
  return '😏 כמעט ניחשתי!';
}

function clearProgressUI() {
  document.getElementById('dotHistory').innerHTML = '';
  document.getElementById('pBar').style.width     = '0%';
  setText('qLabel',    `שאלה 1 מתוך ${CONFIG.maxQuestions}`);
  setText('remainLabel', '');
  showEl('apiErrInline', false);
}

function addAnswerDot(isYes) {
  const dot = document.createElement('div');
  dot.className = `adot ${isYes ? 'yes' : 'no'}`;
  document.getElementById('dotHistory').appendChild(dot);
}

function updateGuessDots() {
  for (let i = 1; i <= CONFIG.maxGuesses; i++) {
    const dot = document.getElementById(`gd${i}`);
    dot.className = 'gdot';
    if (i < state.guessCount)   dot.classList.add('used');
    if (i === state.guessCount) dot.classList.add('current');
  }
}

/* ═══════════════════════════════════════════════════
   CONFETTI
═══════════════════════════════════════════════════ */
const CONFETTI_COLORS = ['#f72fed','#7b2ff7','#00f5d4','#ffdd00','#ff6b35','#00e676','#ffffff'];

function launchConfetti() {
  const wrap = document.getElementById('confetti');
  for (let i = 0; i < 90; i++) {
    setTimeout(() => addConfettiPiece(wrap), i * 28);
  }
}

function addConfettiPiece(wrap) {
  const p = document.createElement('div');
  p.className = 'cp';
  Object.assign(p.style, {
    left:              `${Math.random() * 100}vw`,
    width:             `${Math.random() * 12 + 5}px`,
    height:            `${Math.random() * 12 + 5}px`,
    borderRadius:      Math.random() > 0.5 ? '50%' : '3px',
    background:        CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    animationDuration: `${Math.random() * 2 + 2}s`,
  });
  wrap.appendChild(p);
  setTimeout(() => p.remove(), 4500);
}

function clearConfetti() {
  document.getElementById('confetti').innerHTML = '';
}

/* ═══════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════ */
(function init() {
  show('intro');
})();
