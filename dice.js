export const OUTCOMES = {
    CRIT: 'crit',
    CRITFAIL: 'critfail',
    SUCCESS: 'success',
    FAIL: 'fail',
};

export const MARKER_RE = /\[dice:#([0-9a-f]{6,12})(?:[ \t]+(crit|critfail|success|fail)(?:[ \t]+(-?\d+)(?:[ \t]+vs[ \t]*(\d+))?)?)?\]/gi;
/* Cheap non-global gate for hot paths (per-text-node checks, per-message
   sweeps): same prefix every marker starts with, no lastIndex state. */
export const MARKER_GATE_RE = /\[dice:#[0-9a-f]{6,12}/i;
/* Wrapper form: canonical `<roll ...>...</roll>` plus the tool-call ALIAS
   `<roll_dice ...>...</roll_dice>` — models sometimes write the stealth
   `roll_dice` tool as XML text instead of calling it. Cross-form closers
   (`<roll ...>...</roll_dice>`) are accepted. */
export const ROLL_TAG_RE = /<roll(?:[ _]?dice)?\b([^>]*)>([\s\S]*?)<\/roll(?:[ _]?dice)?\s*>/gi;
/* Gate used by callers for cheap "does this text contain a roll tag" checks.
   Intentionally NOT global: `.test()` on a /g regex is stateful (lastIndex). */
export const ROLL_TAG_GATE_RE = /<roll(?:[ _]?dice)?\b/i;
/* Body-less form: `<roll_dice character="..." ... />` (Claude-style XML tool
   call), `<roll ... />`, or an opening tag whose closer never arrived. Only
   converted when at least one real attribute is present, so a stray `<roll>`
   in prose is left untouched. */
const ROLL_SELF_TAG_RE = /<roll(?:[ _]?dice)?\b([^>]*?)\/?>/gi;
const ROLL_SELF_ATTR_GUARD = /(^|\s)(char|character|action|stat|stat_label|dc|note)\s*=/i;
/* Debris left over when the model wrote both a self-closing call and a
   closer (`</roll_dice>` / the truncated `</roll_` a streaming cut leaves at
   the very end). Removed AFTER the real tags were converted. */
const ROLL_STRAY_CLOSER_RE = /<\/roll(?:[ _]?dice)?\s*>/gi;
const ROLL_STRAY_STUB_RE = /<\/roll(?:[ _]?dice)?[\w_-]*\s*$/i;

export function makeId() {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === 'function') {
        return c.randomUUID().replaceAll('-', '').slice(0, 8);
    }
    return Math.random().toString(16).slice(2, 10);
}

export function hasMarker(text) {
    return MARKER_GATE_RE.test(String(text ?? ''));
}

function randomBelow(maxExclusive) {
    if (!Number.isFinite(maxExclusive) || maxExclusive <= 1) return 0;
    const cryptoObj = globalThis.crypto;
    if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
        const range = 0x100000000;
        const limit = range - (range % maxExclusive);
        const buf = new Uint32Array(1);
        do {
            cryptoObj.getRandomValues(buf);
        } while (buf[0] >= limit);
        return buf[0] % maxExclusive;
    }
    return Math.floor(Math.random() * maxExclusive);
}

export function rollDie(sides = 20) {
    return randomBelow(sides) + 1;
}

export function parseRollType(rollType) {
    const match = String(rollType ?? '').trim().toLowerCase().match(/^(\d*)d(\d+)$/);
    if (!match) {
        return { count: 1, sides: 20 };
    }
    const count = Math.max(1, Math.min(10, Number(match[1] || 1)));
    const sides = Math.max(2, Math.min(1000, Number(match[2])));
    return { count, sides };
}

/* Single-term (legacy shape, preserved exactly) or multi-term: `2d6+1d4+3`,
   `2d6-1d4`, `1d20+3`. Terms keep their sign; numeric terms fold into `bonus`.
   `rollType` stays a display string ('2d6+1d4'); `terms` is what performRoll
   actually rolls. */
export function parseFormulaLine(text) {
    const trimmed = String(text ?? '').trim().toLowerCase();
    if (!trimmed) return null;
    const single = trimmed.match(/^\s*(\d*)d(\d+)\s*(?:([+-])\s*(\d+))?\s*$/);
    if (single) {
        const count = Math.max(1, Math.min(10, Number(single[1] || 1)));
        const sides = Math.max(2, Math.min(1000, Number(single[2])));
        const bonus = (single[3] === '-' ? -1 : 1) * (Number(single[4]) || 0);
        return {
            count,
            sides,
            bonus,
            rollType: `${count}d${sides}`,
            text: `${count}d${sides}${bonus > 0 ? `+${bonus}` : bonus < 0 ? String(bonus) : ''}`,
            terms: [{ count, sides, sign: 1 }],
        };
    }
    const src = trimmed.replace(/\s+/g, '');
    if (!src) return null;
    const terms = [];
    let bonus = 0;
    let index = 0;
    let sign = 1;
    while (index < src.length) {
        if (src[index] === '+') {
            sign = 1;
            index++;
        } else if (src[index] === '-') {
            sign = -1;
            index++;
        } else {
            sign = 1;
        }
        const dice = /^(\d*)d(\d+)/.exec(src.slice(index));
        if (dice) {
            const count = Math.max(1, Math.min(10, Number(dice[1] || 1)));
            const sides = Math.max(2, Math.min(1000, Number(dice[2])));
            terms.push({ count, sides, sign });
            index += dice[0].length;
            continue;
        }
        const flat = /^(\d+)/.exec(src.slice(index));
        if (flat) {
            bonus += sign * Number(flat[1]);
            index += flat[1].length;
            continue;
        }
        return null;
    }
    /* A formula MUST contain at least one dice term — "3" or "-5" alone are
       not rolls. Accepting them produced rollType:'' which parseRollType
       silently upgraded to an unintended d20+bonus. */
    if (!terms.length) return null;
    const diceText = terms.map((term, i) => `${i === 0 ? (term.sign < 0 ? '-' : '') : term.sign < 0 ? '-' : '+'}${term.count}d${term.sides}`).join('');
    const textOut = bonus !== 0 ? `${diceText}${bonus > 0 ? '+' : '-'}${Math.abs(bonus)}` : diceText;
    return {
        count: terms.length === 1 ? terms[0].count : undefined,
        sides: terms.length === 1 ? terms[0].sides : undefined,
        bonus,
        rollType: diceText,
        text: textOut,
        terms,
    };
}

export function rollDice(rollType = 'd20', mode = '') {
    const { count, sides } = parseRollType(rollType);
    let rolled = count;
    let kept = count;
    let keepHighest = true;
    if (mode === 'adv' || mode === 'dis') {
        rolled = count * 2;
        kept = count;
        keepHighest = mode === 'adv';
    } else if (mode === 'advp' || mode === 'disp') {
        /* Penalty dice: roll one extra on top of double (d20 → roll 3 keep 2),
           sum the KEPT dice instead of taking a single max/min. */
        kept = count + 1;
        rolled = kept + 1;
        keepHighest = mode === 'advp';
    }
    const rolls = [];
    for (let i = 0; i < rolled; i++) {
        rolls.push(rollDie(sides));
    }
    let natural;
    if (kept === count && rolled === count) {
        natural = rolls.reduce((sum, value) => sum + value, 0);
    } else {
        const sorted = [...rolls].sort((a, b) => (keepHighest ? b - a : a - b));
        natural = sorted.slice(0, kept).reduce((sum, value) => sum + value, 0);
    }
    return { rolls, natural, kept };
}

const ARITH_FUNCS = {
    round: Math.round,
    floor: Math.floor,
    ceil: Math.ceil,
    abs: Math.abs,
    min: Math.min,
    max: Math.max,
};

function scanArithmeticTokens(input) {
    const tokens = [];
    let index = 0;
    while (index < input.length) {
        const ch = input[index];
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
            index++;
            continue;
        }
        if ((ch >= '0' && ch <= '9') || ch === '.') {
            const match = /^[0-9]*\.?[0-9]+/.exec(input.slice(index));
            if (!match) return null;
            tokens.push(Number(match[0]));
            index += match[0].length;
            continue;
        }
        if (/[A-Za-z_]/.test(ch)) {
            const match = /^[A-Za-z_][A-Za-z_0-9]*/.exec(input.slice(index));
            tokens.push(match[0]);
            index += match[0].length;
            continue;
        }
        if ('()+-*/%,'.includes(ch)) {
            tokens.push(ch);
            index++;
            continue;
        }
        return null;
    }
    return tokens;
}

function safeEvalArithmetic(input) {
    const tokens = scanArithmeticTokens(input);
    if (!tokens) return NaN;
    let pos = 0;
    const peek = () => tokens[pos];
    const next = () => tokens[pos++];
    const parseExpr = () => {
        let value = parseTerm();
        while (peek() === '+' || peek() === '-') {
            const op = next();
            const rhs = parseTerm();
            value = op === '+' ? value + rhs : value - rhs;
        }
        return value;
    };
    const parseTerm = () => {
        let value = parseFactor();
        while (peek() === '*' || peek() === '/' || peek() === '%') {
            const op = next();
            const rhs = parseFactor();
            value = op === '*' ? value * rhs : op === '/' ? value / rhs : value % rhs;
        }
        return value;
    };
    const parseFactor = () => {
        if (peek() === '-') {
            next();
            return -parseFactor();
        }
        if (peek() === '+') {
            next();
            return parseFactor();
        }
        return parsePrimary();
    };
    const parsePrimary = () => {
        const token = next();
        if (typeof token === 'number') return token;
        if (typeof token === 'string') {
            if (token === '(') {
                const value = parseExpr();
                if (peek() !== ')') return NaN;
                next();
                return value;
            }
            const fn = ARITH_FUNCS[token];
            if (fn && peek() === '(') {
                next();
                const args = [parseExpr()];
                while (peek() === ',') {
                    next();
                    args.push(parseExpr());
                }
                if (peek() !== ')') return NaN;
                next();
                return fn(...args);
            }
        }
        return NaN;
    };
    const value = parseExpr();
    return pos === tokens.length ? value : NaN;
}

/* Settings UI validation: a formula that does not evaluate to a finite
   number silently yields modifier 0 at roll time — surface it instead. */
export function isValidModifierFormula(template) {
    const source = String(template ?? '').trim() || '0';
    return Number.isFinite(safeEvalArithmetic(source.replaceAll('{stat}', '50')));
}

export function evalModifierFormula(template, statValue) {
    const source = String(template ?? '').trim() || '0';
    const substituted = source.replaceAll('{stat}', String(Number(statValue) || 0));
    const value = safeEvalArithmetic(substituted);
    return Number.isFinite(value) ? Math.round(value) : 0;
}

/* Nat-20 / nat-1 rules are d20 rules: they only mean something when the
   kept result is ONE d20 (plain 1d20 or adv/dis of it). A d100 showing 20, a
   2d20 sum of 20 or a penalty-dice (advp/disp) sum of 20 is just a number —
   treating those as crits fired ~1-3% false CRITs. */
export function isCritEligible(rollType = 'd20', adv = '', terms = null) {
    if (Array.isArray(terms) && terms.length > 1) return false;
    if (adv === 'advp' || adv === 'disp') return false;
    const { count, sides } = parseRollType(rollType);
    return count === 1 && sides === 20;
}

export function computeOutcome(natural, total, dc, { crit20 = true, crit1 = true, critEligible = true } = {}) {
    if (critEligible && natural === 20 && crit20) {
        return OUTCOMES.CRIT;
    }
    if (critEligible && natural === 1 && crit1) {
        return OUTCOMES.CRITFAIL;
    }
    /* No DC = unopposed roll (e.g. damage): always succeeds. The old
       `total >= 0` comparison was a dead distinction — totals go negative with
       negative modifiers and "fail" for a damage roll made no sense. */
    if (dc == null) {
        return OUTCOMES.SUCCESS;
    }
    return total >= dc ? OUTCOMES.SUCCESS : OUTCOMES.FAIL;
}

/* DC must round-trip through the marker regex (integer group): a raw 12.5
   or negative value from a tag attr / tool arg produced `vs12.5` — a marker
   MARKER_RE can never parse back (raw text stays visible, no card renders,
   stripMarkers misses it). Normalize at the payload boundary. */
export function normalizeDc(dc) {
    if (dc == null || dc === '') return null;
    const num = Number(dc);
    if (!Number.isFinite(num)) return null;
    /* Single clamp for every DC entry point (tag attr / tool arg / UI):
       0 = trivially easy is valid; >99 is a typo, not a wall. */
    return Math.min(99, Math.max(0, Math.round(num)));
}

export const DEFAULT_DC_LADDER = { easy: 5, normal: 10, hard: 15, extreme: 20 };

/* DC entry resolution: a number (or numeric string) wins as-is; anything else
   is looked up in the ladder ("easy"/"normal"/"hard"/"extreme", case- and
   space-insensitive). Unknown words fall back to the default DC. */
export function resolveDc(raw, ladder, fallback = 10) {
    if (raw == null || raw === '') return normalizeDc(fallback) ?? 10;
    if (typeof raw === 'number' || /^-?\d+(\.\d+)?$/.test(String(raw).trim())) {
        return normalizeDc(raw) ?? 10;
    }
    const key = String(raw).trim().toLowerCase();
    const source = (ladder && typeof ladder === 'object') ? ladder : DEFAULT_DC_LADDER;
    for (const [name, value] of Object.entries(source)) {
        if (String(name).trim().toLowerCase() === key) {
            return normalizeDc(value) ?? 10;
        }
    }
    return normalizeDc(fallback) ?? 10;
}

/* modifier: a number reuses a fixed modifier (re-rolls keep the ORIGINAL
   modifier instead of re-evaluating a formula that may have changed since).
   hasStat=false: no stat was given (manual /roll, Hub quick roll) — the stat
   formula must NOT run: the default `round(({stat}-50)/15)` turns stat 0 into
   a silent -3 on every manual roll. */
export function performRoll({ statValue = 0, dc = null, adv = '', rollType = 'd20', formula = '0', crit20 = true, crit1 = true, bonus = 0, terms = null, modifier: fixedModifier = null, hasStat = true } = {}) {
    const stat = Number(statValue) || 0;
    const modifier = (typeof fixedModifier === 'number' && Number.isFinite(fixedModifier))
        ? Math.round(fixedModifier)
        : (hasStat ? evalModifierFormula(formula, stat) : 0);
    const extra = Number(bonus) || 0;
    let rolls;
    let natural;
    if (Array.isArray(terms) && terms.length > 1) {
        /* Multi-term formula: roll each term (advantage applies within every
           term), sum the term naturals. */
        rolls = [];
        natural = 0;
        for (const term of terms) {
            const { rolls: termRolls, natural: termNatural } = rollDice(`${term.count}d${term.sides}`, adv);
            rolls.push(...termRolls);
            natural += termNatural * (term.sign < 0 ? -1 : 1);
        }
    } else {
        ({ rolls, natural } = rollDice(rollType, adv));
    }
    const total = natural + modifier + extra;
    const critEligible = isCritEligible(rollType, adv, terms);
    const outcome = computeOutcome(natural, total, dc, { crit20, crit1, critEligible });
    return { rolls, natural, modifier, bonus: extra, total, outcome };
}

export function parseAttrs(input) {
    const attrs = {};
    const re = /([a-zA-Z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
    let match;
    while ((match = re.exec(String(input ?? ''))) !== null) {
        attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
    }
    return attrs;
}

/* Unclosed leading tag: models (esp. reasoning models) sometimes truncate the
   reply mid-tag, leaving `<roll ...` with no `>` at all. Recover the intent
   without inventing anything: only an opening fragment still at the very END
   of the text (ROLL_TAG_RE already consumed every well-formed tag) is
   salvaged, and its action is marked truncated. */
const UNCLOSED_ROLL_TAG_RE = /<roll(?:[ _]?dice)?\b([^>]*)[ \t]*$/;

const VALID_ADV_MODES = ['adv', 'dis', 'advp', 'disp'];

function makeRollFromAttrs(attrsInput, action, opts = {}, forcedAction = '') {
    const a = parseAttrs(attrsInput);
    /* `stat_label` is the tool-schema name for the label ("STR 5"): accept it
       wherever the canonical `stat` attr is used, both for display and as the
       stat_value fallback when only the label carries the number. */
    const statLabel = String(a.stat ?? a.stat_label ?? '').trim();
    const statMatch = statLabel.match(/-?\d+/);
    const statValue = Number(a.stat_value ?? (statMatch ? statMatch[0] : 0)) || 0;
    const hasStat = (a.stat_value != null && String(a.stat_value).trim() !== '') || !!statMatch;
    /* kind="damage": an unopposed roll — no DC, nat-1 (when the crit rule is
       on) is the only way to fail. */
    const kind = String(a.kind ?? '').trim().toLowerCase() === 'damage' ? 'damage' : 'check';
    let dc;
    if (kind === 'damage') {
        dc = null;
    } else {
        const dcRaw = a.dc;
        dc = resolveDc(dcRaw, opts.dcLadder ?? opts.dc_ladder, opts.dcDefault ?? 10);
    }
    const advRaw = String(a.adv ?? '').trim().toLowerCase();
    const adv = VALID_ADV_MODES.includes(advRaw) ? advRaw : '';
    const formulaLine = String(a.formula ?? '').trim();
    const parsedFormula = parseFormulaLine(formulaLine);
    const rollType = parsedFormula ? parsedFormula.rollType : (a.type || a.dice || 'd20');
    const result = performRoll({
        statValue,
        dc,
        adv,
        rollType,
        formula: opts.formula,
        crit20: opts.crit20,
        crit1: opts.crit1,
        bonus: parsedFormula ? parsedFormula.bonus : 0,
        terms: parsedFormula && parsedFormula.terms.length > 1 ? parsedFormula.terms : null,
        hasStat,
    });
    /* Body text wins; then the `action` ATTRIBUTE (body-less tool-call form).
       A salvaged (cut-off) tag often still carries a `note` that describes
       the attempt — show THAT as the action instead of an English
       placeholder the story never mentioned. The placeholder is the last
       resort only. */
    let actionText = String(action ?? '').trim() || String(a.action ?? '').trim();
    let noteText = String(a.note ?? '').trim();
    if (!actionText && forcedAction) {
        if (noteText) {
            actionText = noteText;
            noteText = '';
        } else {
            actionText = forcedAction;
        }
    }
    return {
        id: makeId(),
        character: String(a.char ?? a.character ?? '').trim(),
        action: actionText,
        note: noteText,
        stat_label: statLabel,
        stat_value: statValue,
        adv,
        dc,
        kind,
        roll_type: rollType,
        formula_text: parsedFormula ? parsedFormula.text : '',
        source: 'tag',
        ...result,
    };
}

export function makeRollFromTag({ attrs, action }, opts = {}) {
    return makeRollFromAttrs(attrs, action, opts);
}

export function extractRollTags(text, opts = {}) {
    const source = String(text ?? '');
    const rolls = [];
    const provided = Array.isArray(opts.rolls) ? opts.rolls : null;
    const resolve = typeof opts.resolveSettings === 'function' ? opts.resolveSettings : null;
    const build = (attrs, action, forcedAction) => {
        const overrides = resolve ? resolve(attrs) : null;
        const merged = overrides ? { ...opts, ...overrides } : opts;
        if (provided && index < provided.length) {
            const roll = provided[index++];
            rolls.push(roll);
            return formatMarker(roll);
        }
        const roll = makeRollFromAttrs(attrs, action, merged, forcedAction);
        rolls.push(roll);
        return formatMarker(roll);
    };
    let index = 0;
    const replaceTag = (full, attrs, action) => {
        try {
            return build(attrs, action, '');
        } catch {
            return full;
        }
    };
    /* Pass 1: wrapper tags (canonical + `roll_dice` alias, cross closers). */
    let replaced = source.replace(ROLL_TAG_RE, replaceTag);
    /* Pass 2: body-less tool-call form (`<roll_dice ... />`, `<roll ... />`,
       or an opening tag whose closer never arrived). Guard: at least one real
       attribute must be present, otherwise a stray `<roll ...>` word in prose
       would roll. */
    replaced = replaced.replace(ROLL_SELF_TAG_RE, (full, attrs) => {
        if (!ROLL_SELF_ATTR_GUARD.test(attrs ?? '')) return full;
        return replaceTag(full, attrs, '');
    });
    /* Pass 3 (Unclosed-tag salvage): an opening fragment still at the very
       end (the model stopped writing) rolls anyway. Guards: only short
       fragments that look like a real tag (contain char/character/action=)
       are salvaged; a stray `<roll` in prose is left alone. */
    const unclosed = replaced.match(UNCLOSED_ROLL_TAG_RE);
    if (unclosed && unclosed[0].length <= 400 && /(^|\s)(char|character|action)\s*=/i.test(unclosed[1] ?? '')) {
        const fragment = unclosed[0];
        const attrsPart = unclosed[1] ?? '';
        try {
            const marker = build(attrsPart, '', '[the reply was cut off before the action was written]');
            replaced = replaced.slice(0, replaced.length - fragment.length) + marker;
        } catch {
            /* leave the fragment untouched */
        }
    }
    /* Debris cleanup: closers whose opener was already converted above and
       the truncated `</roll_` stub a streaming cut leaves at the end. */
    replaced = replaced.replace(ROLL_STRAY_CLOSER_RE, '').replace(ROLL_STRAY_STUB_RE, '');
    return { text: replaced, rolls };
}

/* Slim marker: id ONLY. Outcome/total/dc live in mes.extra.diceRolls (the
   payload is the single source of truth) — a verbose marker leaked the roll
   result into prompt history (the model reads message text). MARKER_RE still
   accepts the legacy verbose form, so old chats keep rendering. */
export function formatMarker(roll) {
    return `[dice:#${roll.id}]`;
}

export function formatRollLine(roll) {
    const sign = roll.modifier >= 0 ? '+' : '\u2212';
    const magnitude = Math.abs(roll.modifier);
    const dcPart = roll.dc == null ? '' : ` vs DC ${roll.dc}`;
    return `${roll.natural} ${sign} ${magnitude} = ${roll.total}${dcPart}`;
}

/* Removes dice markers from a text (used by external bridges to keep roll
   outcomes out of prompt history). Prefers no mutation: returns a new string. */
export function stripMarkers(text) {
    const re = new RegExp(MARKER_RE.source, MARKER_RE.flags);
    return String(text ?? '')
        .replace(re, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trimEnd();
}
