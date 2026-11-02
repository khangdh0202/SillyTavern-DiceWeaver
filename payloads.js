/* Dice Weaver — Copyright (C) 2026 kdturtle — GPL-3.0, see LICENSE. */
/* Roll payload factory + stored-payload normalization (pure, node-testable).
   The payload in mes.extra.diceRolls is the single source of truth for cards,
   the Hub, the results feed and the public API. New payloads carry ts +
   payload_version; stored payloads from ANY version are normalized so display
   code never sees NaN / undefined fields. */
import { OUTCOMES, computeOutcome } from './dice.js';

export const PAYLOAD_VERSION = 2;

const VALID_ADV = ['adv', 'dis', 'advp', 'disp'];
const VALID_OUTCOMES = new Set(Object.values(OUTCOMES));

function int(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? Math.round(num) : fallback;
}

export function createRollPayload({ character = '', action = '', note = '', stat_label = '', stat_value = 0, adv = '', dc = null, kind = 'check', roll_type = 'd20', formula_text = '', source = 'manual', ...result }) {
    const payload = {
        id: result.id ?? '',
        character: String(character),
        action: String(action),
        note: String(note),
        stat_label: String(stat_label),
        stat_value: int(stat_value),
        adv: VALID_ADV.includes(adv) ? adv : '',
        dc,
        kind: kind === 'damage' ? 'damage' : 'check',
        roll_type: String(roll_type || 'd20'),
        formula_text: String(formula_text),
        source: String(source),
        ...result,
    };
    /* Factory invariants — re-asserted AFTER the result spread so caller data
       can never override the stamp (payload_version 99 / ts 0 regression). */
    payload.ts = Date.now();
    payload.payload_version = PAYLOAD_VERSION;
    return payload;
}

export function normalizeStoredRoll(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const roll = { ...raw };
    roll.character = String(roll.character ?? '');
    roll.action = String(roll.action ?? '');
    roll.note = String(roll.note ?? '');
    roll.stat_label = String(roll.stat_label ?? '');
    roll.stat_value = int(roll.stat_value);
    roll.natural = int(roll.natural);
    roll.modifier = int(roll.modifier);
    roll.bonus = int(roll.bonus);
    roll.total = int(roll.total);
    roll.dc = roll.dc == null ? null : Math.min(99, Math.max(0, int(roll.dc, 0)));
    roll.adv = VALID_ADV.includes(roll.adv) ? roll.adv : '';
    roll.kind = roll.kind === 'damage' ? 'damage' : 'check';
    roll.roll_type = String(roll.roll_type ?? 'd20') || 'd20';
    roll.formula_text = String(roll.formula_text ?? '');
    roll.source = String(roll.source ?? 'legacy');
    roll.rolls = Array.isArray(roll.rolls)
        ? roll.rolls.map(value => int(value)).filter(value => value > 0)
        : [];
    if (!roll.rolls.length) roll.rolls = [Math.max(1, roll.natural)];
    if (!VALID_OUTCOMES.has(roll.outcome)) {
        roll.outcome = computeOutcome(roll.natural, roll.total, roll.dc);
    }
    roll.ts = Number.isFinite(Number(roll.ts)) ? Number(roll.ts) : null;
    roll.payload_version = int(roll.payload_version, 1);
    return roll;
}
