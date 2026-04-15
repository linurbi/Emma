'use strict';

/* ═══════════════════════════════════════════════════
   CONFIG
═══════════════════════════════════════════════════ */
const CONFIG = {
  maxQuestions: 21,
  maxGuesses:   3,
  // Calls our own serverless function (/api/chat) — the OpenAI key
  // lives there as an environment variable, never exposed to the browser.
  apiEndpoint:  '/api/chat',
};

/** System prompt sent to the AI on every request. */
const SYSTEM_PROMPT = `אתה משחק "נחש מי הדמות" עם ילדים ומבוגרים בעברית.
המשתמש חשב על דמות — יכול להיות אדם אמיתי, דמות מצוירת, חיה מפורסמת, גיבור על, דמות מסרט או סדרה.

━━━ סדר השאלות המומלץ (מהכלל לפרט) ━━━
התחל תמיד עם השאלות הבסיסיות האלה לפי הסדר:
1. האם הדמות זכר?
2. האם הדמות מצוירת (קומיקס / אנימציה)?
3. האם הדמות אדם אמיתי שחי בעולם האמיתי?
4. האם הדמות עדיין חיה היום?
5. האם הדמות חיה (בעל חיים)?
6. האם הדמות מפורסמת מאוד ברחבי העולם?
7. האם הדמות מופיעה בסרטים או בטלוויזיה?
8. האם הדמות ישראלית?
9. המשך עם שאלות ספציפיות יותר לפי התשובות שקיבלת.

━━━ כללים חשובים ━━━
- שאל שאלות פשוטות שגם ילד בן 6 יבין. אסור להשתמש במילים כמו: פנטזיה, ז'אנר, פיקטיבי, אנטגוניסט, פרוטגוניסט.
- שאל שאלה אחת בלבד בכל פעם.
- אל תחזור על שאלה שכבר שאלת.
- אחרי 5-7 שאלות אתה כבר אמור לדעת לאיזה קטגוריה שייכת הדמות ולהתחיל לנחש.
- אם הדמות מצוירת — חשוב על דמויות כמו: באגס באני, דאפי דאק, טום, ג'רי, מיקי מאוס, ספוגבוב, פיקאצ'ו, שרק, סימבה, ניל הצב, אריאל, אלזה, הארי פוטר, בן 10 וכו'.
- אם הדמות חיה אמיתית — חשוב על: כלב, חתול, אריה, פיל, כרישה, דולפין וכו'.
- אם האדם אמיתי ומפורסם — חשוב על: זמרים, ספורטאים, שחקנים, מדענים, מנהיגים.
- נחש בביטחון גם דמויות ישנות ומוכרות — אל תפחד לנחש.

━━━ פורמט ניחוש ━━━
כשאתה רוצה לנחש, כתוב בדיוק (ורק) בפורמט הזה:
GUESS|||[שם בעברית]|||[English name]|||[emoji מתאים]|||[רמז פשוט 1]|||[רמז פשוט 2]|||[רמז פשוט 3]

דוגמה:
GUESS|||באגס באני|||Bugs Bunny|||🐰|||ארנב מצויר ישן ומפורסם|||אוהב לאכול גזר|||אומר "מה יש, דוקטור?"

כשאתה שואל שאלה — כתוב רק את השאלה, בלי הסברים נוספים.
התחל עכשיו עם השאלה הראשונה.`;

/* ═══════════════════════════════════════════════════
   STATE  (single source of truth)
═══════════════════════════════════════════════════ */
let state = buildInitialState();

function buildInitialState() {
  return {
    history:    [],   // conversation messages (excluding system prompt)
    qCount:     0,
    guessCount: 0,
    lastGuess:  null,
  };
}

/* ═══════════════════════════════════════════════════
   API CALL  (to our serverless proxy at /api/chat)
═══════════════════════════════════════════════════ */
async function callAI(messages) {
  const res = await fetch(CONFIG.apiEndpoint, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    // We send only the messages; the server adds the API key and model
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
/**
 * Parses AI text into { type: 'question'|'guess', ... }.
 * Guess format: GUESS|||name|||nameEn|||emoji|||clue1|||clue2|||clue3
 */
function parseResponse(text) {
  if (text.includes('GUESS|||')) {
    const parts = text.split('GUESS|||')[1].split('|||').map(s => s.trim());
    return {
      type:    'guess',
      nameHe:  parts[0] || '???',
      nameEn:  parts[1] || '',
      emoji:   parts[2] || '🤔',
      clues:   [parts[3], parts[4], parts[5]].filter(Boolean),
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

  // Seed the conversation — AI will reply with first question
  state.history = [{ role: 'user', content: 'מוכן! חשבתי על דמות. תתחיל לשאול שאלות.' }];

  clearProgressUI();
  show('asking');
  fetchNextMove();
}

async function fetchNextMove() {
  setAskingUILocked(true);

  try {
    const raw    = await callAI(state.history);
    const parsed = parseResponse(raw);

    // Add assistant message to history
    state.history.push({ role: 'assistant', content: raw });

    if (parsed.type === 'guess') {
      handleGuess(parsed);
    } else {
      handleQuestion(parsed.text);
    }
  } catch (err) {
    showInlineError(`שגיאה: ${err.message}. בדוק את מפתח ה-API ונסה שוב.`);
    setAskingUILocked(false);
  }
}

function handleQuestion(text) {
  state.qCount++;
  updateProgressUI();

  setText('qBadge', `שאלה #${state.qCount}`);
  setText('qText',  text);

  setAskingUILocked(false);

  if (state.qCount >= CONFIG.maxQuestions) {
    // Force a guess on the next turn
    state.history.push({ role: 'user', content: 'כן' }); // dummy to keep history valid
    fetchNextMove();
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

function giveAnswer(isYes) {
  if (state.qCount >= CONFIG.maxQuestions && !isYes) {
    // Out of questions, still wrong → lose
    show('lose');
    return;
  }

  addAnswerDot(isYes);

  // Push user answer into history
  state.history.push({ role: 'user', content: isYes ? 'כן' : 'לא' });

  show('asking');
  fetchNextMove();
}

function onGuessResult(correct) {
  if (correct) {
    showWin();
    return;
  }

  // Tell AI the guess was wrong
  state.history.push({
    role:    'user',
    content: `לא, זה לא ${state.lastGuess.nameHe}. המשך לשאול שאלות כדי לצמצם.`,
  });

  if (state.guessCount >= CONFIG.maxGuesses) {
    show('lose');
    return;
  }

  show('asking');
  fetchNextMove();
}

/* ═══════════════════════════════════════════════════
   WIN / LOSE
═══════════════════════════════════════════════════ */
function showWin() {
  show('win');

  const g = state.lastGuess;
  setHTML('winStats', buildStatsHTML());
  setHTML('winCard',  buildWinCardHTML(g));
  launchConfetti();
}

function buildStatsHTML() {
  return `
    <div class="stat"><div class="stat-n">${state.qCount}</div><div class="stat-l">שאלות</div></div>
    <div class="stat"><div class="stat-n">${state.guessCount}</div><div class="stat-l">ניחושים</div></div>
  `;
}

function buildWinCardHTML(g) {
  const cluesHTML = g.clues.map(c => `<span class="clue">💡 ${c}</span>`).join('');
  return `
    <span style="font-size:4rem;display:block;margin-bottom:10px;">${g.emoji}</span>
    <div style="font-size:1.7rem;font-weight:900;
      background:linear-gradient(135deg,#ffdd00,#ff6b35);
      -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">
      ${g.nameHe}
    </div>
    <div style="color:rgba(255,255,255,.35);font-size:.85rem;margin-top:3px;">${g.nameEn}</div>
    <div style="margin-top:13px;">${cluesHTML}</div>
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
  void el.offsetWidth;          // reflow to restart animation
  el.style.animation = '';
}

/** Show/hide an element by id */
function showEl(id, visible) {
  document.getElementById(id).classList.toggle('hidden', !visible);
}

function setText(id, value) { document.getElementById(id).textContent = value; }
function setHTML(id, html)  { document.getElementById(id).innerHTML   = html;  }

function setAskingUILocked(locked) {
  const btns  = document.getElementById('yesNoBtns');
  const anim  = document.getElementById('thinkingAnim');
  const block = document.getElementById('qBlock');

  btns.style.display         = locked ? 'none'  : 'flex';
  anim.classList.toggle('hidden', !locked);
  block.style.opacity        = locked ? '0.3'   : '1';
}

function showInlineError(msg) {
  const el = document.getElementById('apiErrInline');
  el.textContent = msg;
  showEl('apiErrInline', true);
}

/* ── Progress ── */
function updateProgressUI() {
  setText('qLabel',    `שאלה ${state.qCount} מתוך ${CONFIG.maxQuestions}`);
  document.getElementById('pBar').style.width = `${(state.qCount / CONFIG.maxQuestions) * 100}%`;
  setText('remainLabel', remainLabel());
}

function remainLabel() {
  if (state.qCount < 5)  return '🌐 מאגר דמויות אינסופי';
  if (state.qCount < 10) return '🔍 מצמצם אפשרויות...';
  if (state.qCount < 16) return '🔥 מתקרב...';
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

/* ── Guess dots ── */
function updateGuessDots() {
  for (let i = 1; i <= CONFIG.maxGuesses; i++) {
    const dot = document.getElementById(`gd${i}`);
    dot.className = 'gdot';
    if (i < state.guessCount)  dot.classList.add('used');
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
   INIT  (runs on page load)
═══════════════════════════════════════════════════ */
(function init() {
  show('intro');
})();
