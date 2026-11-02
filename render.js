/* Dice Weaver — Copyright (C) 2026 kdturtle — GPL-3.0, see LICENSE. */
/* Marker → DOM rendering engine (dependency-injected, node-testable).
   createRenderEngine({ getContext, updateMessageBlock, document?, NodeFilter? })
   No SillyTavern imports at top level; dice.js helpers are pure. */
import { MARKER_GATE_RE, MARKER_RE, ROLL_TAG_GATE_RE, hasMarker, parseRollType } from './dice.js';
import { normalizeStoredRoll } from './payloads.js';

export function createRenderEngine(deps) {
    const getContext = deps.getContext;
    const updateMessageBlock = deps.updateMessageBlock;
    const getT = typeof deps.getT === 'function' ? deps.getT : (() => (key, params) => {
        let value = String(key);
        if (params) for (const [name, replacement] of Object.entries(params)) value = value.replaceAll(`{${name}}`, String(replacement));
        return value;
    });
    let parseMessageRollTags = typeof deps.parseMessageRollTags === 'function' ? deps.parseMessageRollTags : null;

    const doc = () => deps.document ?? globalThis.document;
    const nodeFilter = () => deps.NodeFilter ?? globalThis.NodeFilter;

    /* P0-1 gate: keyed by message OBJECT (WeakMap, never persisted). Stores the
       last processed text state so an ORPHAN marker (marker in text, payload
       gone — e.g. the user edited it away) is re-rendered at most once instead
       of churnig updateMessageBlock on every sweep/event. The entry
       self-invalidates whenever the text or the payload list changes. */
    const seenTextState = new WeakMap();
    let avatarCache = new Map();

    function textStateKey(mes) {
        const rolls = Array.isArray(mes.extra?.diceRolls) ? mes.extra.diceRolls : [];
        return `${String(mes.mes ?? '')}|${rolls.length}|${rolls.map(roll => String(roll?.id ?? '')).join(',')}`;
    }

    function reducedMotion() {
        try {
            return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
        } catch {
            return false;
        }
    }

    function findAvatarUrl(name) {
        if (!name) return null;
        /* Perf: /thumbnail URL is pure (name → avatar file) — cache it so a
           500-message sweep builds N Map lookups, not N getContext scans. */
        if (avatarCache.has(name)) return avatarCache.get(name);
        const context = getContext();
        const character = (context.characters ?? []).find(entry => String(entry?.name ?? '') === name);
        let url = (!character || !character.avatar || character.avatar === 'none')
            ? null
            : `/thumbnail?type=avatar&file=${encodeURIComponent(character.avatar)}`;
        /* The user's persona rolls too (`/roll name=<persona>`, the AI rolling
           for {{user}}) — it is not in context.characters. */
        if (!url && name === context.name1) {
            const personaFile = typeof deps.getUserAvatar === 'function' ? deps.getUserAvatar() : '';
            if (personaFile) url = `/thumbnail?type=persona&file=${encodeURIComponent(personaFile)}`;
        }
        avatarCache.set(name, url);
        return url;
    }

    /* Character list changed (chat/character switch) — drop cached URLs. */
    function invalidateAvatarCache() {
        avatarCache = new Map();
    }

    /* One rAF per element: a re-roll while the previous count-up is still
       running must cancel it, or the two animations fight over textContent. */
    const rafHandles = new WeakMap();

    function animateNumber(element, target) {
        if (reducedMotion()) {
            element.textContent = String(target);
            return;
        }
        const raf = globalThis.requestAnimationFrame;
        const caf = globalThis.cancelAnimationFrame;
        if (!raf || !caf) {
            element.textContent = String(target);
            return;
        }
        const previous = rafHandles.get(element);
        if (previous) caf(previous);
        if (!element.isConnected) return;
        const duration = 450;
        const start = performance.now();
        const frame = now => {
            if (!element.isConnected) return;
            const t = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            element.textContent = String(Math.max(0, Math.round(target * eased)));
            if (t < 1) rafHandles.set(element, raf(frame));
            else element.textContent = String(target);
        };
        rafHandles.set(element, raf(frame));
    }

    function el(tag, className = '', text = null) {
        const node = doc().createElement(tag);
        if (className) node.className = className;
        if (text !== null && text !== undefined) node.textContent = String(text);
        return node;
    }

    function initials(name) {
        const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
        if (!words.length) return '?';
        const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0].slice(0, 2);
        return letters.toUpperCase();
    }

    function signed(value) {
        return `${value >= 0 ? '+' : '−'}${Math.abs(value)}`;
    }

    /* Which rolled dice count toward `natural` (adv/dis/penalty keep a subset).
       Mirrors dice.js rollDice; multi-term rolls are not marked (each term
       keeps its own subset — showing all dice is the honest fallback). */
    function keptMask(roll) {
        const values = Array.isArray(roll.rolls) ? roll.rolls : [];
        const mask = values.map(() => true);
        const { count } = parseRollType(roll.roll_type);
        if (/[+-]/.test(String(roll.roll_type ?? ''))) return mask;
        let kept = count;
        let keepHighest = true;
        if (roll.adv === 'adv' || roll.adv === 'dis') keepHighest = roll.adv === 'adv';
        else if (roll.adv === 'advp' || roll.adv === 'disp') {
            kept = count + 1;
            keepHighest = roll.adv === 'advp';
        } else return mask;
        if (values.length <= kept) return mask;
        const order = values.map((value, index) => ({ value, index }))
            .sort((a, b) => (keepHighest ? b.value - a.value : a.value - b.value));
        mask.fill(false);
        for (const { index } of order.slice(0, kept)) mask[index] = true;
        return mask;
    }

    function outcomeLabel(roll, t) {
        if (roll.kind === 'damage' && (roll.outcome === 'success' || roll.outcome === 'crit')) return t('cardDamage');
        switch (roll.outcome) {
            case 'crit': return t('cardCrit');
            case 'critfail': return t('cardCritfail');
            case 'success': return t('cardSuccess');
            default: return t('cardFail');
        }
    }

    /* Card layout (v0.6.0, local/DESIGN-v0.6.md §3.1): grid of avatar ·
       text · result block, plus a full-width "dice strip" (each die, kept vs
       dropped, modifiers, DC, adv tag, formula, undo/re-roll). Text only via
       textContent; icons are <i> elements with static FA classes. */
    function buildRollCard(roll, { fresh = false } = {}) {
        const t = getT();
        const card = el('div', `dw-roll dw-${roll.outcome}`);
        card.dataset.dwId = roll.id;
        if (roll.kind === 'damage') card.classList.add('dw-damage');

        const avatar = el('div', 'dw-avatar');
        const avatarUrl = findAvatarUrl(roll.character);
        if (avatarUrl) {
            const img = el('img');
            img.src = avatarUrl;
            img.alt = '';
            img.loading = 'lazy';
            avatar.appendChild(img);
        } else {
            avatar.textContent = initials(roll.character);
        }
        card.appendChild(avatar);

        const body = el('div', 'dw-body');
        if (roll.character) body.appendChild(el('div', 'dw-char', roll.character));
        if (roll.action) body.appendChild(el('div', 'dw-action', roll.action));
        if (roll.note || roll.stat_label) {
            const statPart = roll.stat_label ? `${roll.stat_label} → ${signed(roll.modifier)}` : '';
            const text = [statPart, String(roll.note ?? '').trim()].filter(Boolean).join(' · ');
            if (text) body.appendChild(el('div', 'dw-note', text));
        }
        card.appendChild(body);

        const result = el('div', 'dw-result');
        const total = el('div', 'dw-total');
        const number = el('span', 'dw-number', roll.total);
        total.appendChild(number);
        result.appendChild(total);
        result.appendChild(el('div', 'dw-outcome', outcomeLabel(roll, t)));
        card.appendChild(result);

        const strip = el('div', 'dw-strip');
        strip.appendChild(el('span', 'dw-type', roll.roll_type ?? 'd20'));
        const values = Array.isArray(roll.rolls) ? roll.rolls : [];
        const mask = keptMask(roll);
        const d20 = parseRollType(roll.roll_type).sides === 20 && !/[+-]/.test(String(roll.roll_type ?? ''));
        values.forEach((value, index) => {
            const die = el('span', 'dw-die', value);
            if (!mask[index]) {
                die.classList.add('dw-die-drop');
                die.title = t('cardDropped');
            } else if (d20 && value === 20) die.classList.add('dw-die-max');
            else if (d20 && value === 1) die.classList.add('dw-die-min');
            strip.appendChild(die);
        });
        if (roll.modifier) strip.appendChild(el('span', 'dw-mod', signed(roll.modifier)));
        if (roll.bonus) strip.appendChild(el('span', 'dw-mod', signed(roll.bonus)));
        strip.appendChild(el('span', 'dw-eq', `= ${roll.total}`));
        if (roll.kind !== 'damage' && roll.dc != null) strip.appendChild(el('span', 'dw-dc', t('cardVsDc', { dc: roll.dc })));
        if (roll.adv) {
            const advKey = { adv: 'cardAdv', dis: 'cardDis', advp: 'cardAdvp', disp: 'cardDisp' }[roll.adv];
            strip.appendChild(el('span', `dw-tag dw-tag-${roll.adv}`, t(advKey)));
        }
        if (roll.formula_text && roll.formula_text !== roll.roll_type) strip.appendChild(el('span', 'dw-formula', roll.formula_text));

        const actions = el('span', 'dw-actions');
        if (roll.prev && typeof roll.prev === 'object') {
            const undo = el('button', 'dw-undo');
            undo.type = 'button';
            undo.title = t('cardUndoTitle');
            undo.setAttribute('aria-label', t('cardUndoTitle'));
            undo.appendChild(el('i', 'fa-solid fa-rotate-left'));
            actions.appendChild(undo);
        }
        const reroll = el('button', 'dw-reroll');
        reroll.type = 'button';
        reroll.title = t('rerollTitle');
        reroll.setAttribute('aria-label', t('rerollAria'));
        reroll.appendChild(el('i', 'fa-solid fa-arrows-rotate'));
        actions.appendChild(reroll);
        strip.appendChild(actions);
        card.appendChild(strip);

        card.setAttribute('role', 'group');
        card.setAttribute('aria-label', `${roll.character ? `${roll.character}: ` : ''}${roll.action ?? ''} — ${roll.total}, ${outcomeLabel(roll, t)}`);

        if (fresh) {
            card.classList.add('dw-fresh');
            animateNumber(number, roll.total);
        }
        return card;
    }

    /* Markers inside <pre>/<code> are CODE SAMPLES (the user is showing the
       marker syntax), not roll placeholders — never consume them. */
    function isInPreCode(node) {
        return !!(node.parentElement?.closest?.('pre, code'));
    }

    function injectRollCards(messageId, fresh) {
        const documentRef = doc();
        if (!documentRef) return;
        const mesEl = documentRef.querySelector(`#chat .mes[mesid="${messageId}"]`);
        if (!mesEl) return;
        const mesText = mesEl.querySelector('.mes_text');
        if (!mesText) return;
        const context = getContext();
        const mes = context.chat[messageId];
        /* Normalize at the read boundary: payloads saved by older versions may
           miss fields (no rolls/ts/kind) — display code must never see NaN. */
        const rolls = (Array.isArray(mes?.extra?.diceRolls) ? mes.extra.diceRolls : [])
            .map(normalizeStoredRoll)
            .filter(Boolean);
        const byId = new Map(rolls.map(roll => [roll.id, roll]));
        const consumed = new Set();

        const walker = documentRef.createTreeWalker(mesText, nodeFilter().SHOW_TEXT);
        const targets = [];
        let node;
        /* One reusable regex instance + a cheap non-global gate per text node:
           the old code allocated a fresh RegExp object for EVERY node of EVERY
           message on EVERY sweep. */
        const re = new RegExp(MARKER_RE.source, MARKER_RE.flags);
        while ((node = walker.nextNode())) {
            if (isInPreCode(node)) continue;
            if (!MARKER_GATE_RE.test(node.nodeValue)) continue;
            targets.push(node);
        }
        if (!targets.length) return;

        for (const target of targets) {
            const fragment = documentRef.createDocumentFragment();
            const value = target.nodeValue;
            re.lastIndex = 0;
            let lastIndex = 0;
            let match;
            while ((match = re.exec(value)) !== null) {
                if (match.index > lastIndex) {
                    fragment.appendChild(documentRef.createTextNode(value.slice(lastIndex, match.index)));
                }
                const id = (match[1] ?? '').toLowerCase();
                const roll = byId.get(id) ?? null;
                if (roll && !consumed.has(id)) {
                    consumed.add(id);
                    fragment.appendChild(buildRollCard(roll, { fresh }));
                }
                lastIndex = re.lastIndex;
            }
            if (lastIndex < value.length) {
                fragment.appendChild(documentRef.createTextNode(value.slice(lastIndex)));
            }
            target.parentNode.replaceChild(fragment, target);
        }
    }

    function domHasMarkerText(messageId) {
        const documentRef = doc();
        if (!documentRef) return false;
        const mesText = documentRef.querySelector(`#chat .mes[mesid="${messageId}"] .mes_text`);
        if (!mesText) return false;
        const walker = documentRef.createTreeWalker(mesText, nodeFilter().SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            if (isInPreCode(node)) continue;
            if (MARKER_GATE_RE.test(node.nodeValue)) return true;
        }
        return false;
    }

    /* The DOM is "current" when it shows EITHER the raw marker text (not yet
       injected) OR an already-injected card (injectRollCards REPLACES the
       marker text node with the card element, so a successfully injected
       message has NEITHER marker text NOR needs a rebuild). */
    function domHasRollUi(messageId) {
        const documentRef = doc();
        if (!documentRef) return false;
        const mesText = documentRef.querySelector(`#chat .mes[mesid="${messageId}"] .mes_text`);
        if (!mesText) return false;
        const walker = documentRef.createTreeWalker(mesText, nodeFilter().SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            if (isInPreCode(node)) continue;
            if (MARKER_GATE_RE.test(node.nodeValue)) return true;
        }
        return mesText.querySelector('.dw-roll') !== null;
    }

    function mesElExists(messageId) {
        const documentRef = doc();
        if (!documentRef) return false;
        return !!documentRef.querySelector(`#chat .mes[mesid="${messageId}"]`);
    }

    /* P0-2 partial heal: DOM cards present < payloads whose marker exists in the
       RENDERED text ⇒ ST re-rendered the block halfway. Count from the ONE field
       ST actually renders (display_text when present, else mes.mes) — counting
       both double-counted mirrored markers and made the heal loop forever. One
       payload renders exactly ONE card, so compare against DISTINCT ids. */
    function healPartialRender(messageId, mes, rolls) {
        const documentRef = doc();
        if (!documentRef || !rolls.length) return;
        const mesEl = documentRef.querySelector(`#chat .mes[mesid="${messageId}"]`);
        if (!mesEl) return;
        const rendered = typeof mes.extra?.display_text === 'string' ? mes.extra.display_text : String(mes.mes ?? '');
        const ids = new Set(rolls.map(roll => String(roll?.id ?? '').toLowerCase()));
        const re = new RegExp(MARKER_RE.source, MARKER_RE.flags);
        const expectedIds = new Set();
        let match;
        while ((match = re.exec(rendered)) !== null) {
            const id = (match[1] ?? '').toLowerCase();
            if (id && ids.has(id)) expectedIds.add(id);
        }
        if (mesEl.querySelectorAll('.dw-roll').length < expectedIds.size) {
            updateMessageBlock(messageId, mes);
            injectRollCards(messageId, false);
        }
    }

    function renderMessageRolls(messageId, fresh) {
        const context = getContext();
        const mes = context.chat[messageId];
        if (!mes) return;
        const rolls = Array.isArray(mes.extra?.diceRolls) ? mes.extra.diceRolls : [];
        const hasRolls = rolls.length > 0;
        const markerInText = hasMarker(mes.mes) || hasMarker(mes.extra?.display_text ?? '');
        if (!hasRolls && !markerInText) return;
        const textKey = textStateKey(mes);
        if (markerInText && mesElExists(messageId) && !domHasRollUi(messageId) && seenTextState.get(mes) !== textKey) {
            updateMessageBlock(messageId, mes);
            injectRollCards(messageId, fresh);
            seenTextState.set(mes, textKey);
        } else {
            injectRollCards(messageId, fresh);
        }
        healPartialRender(messageId, mes, rolls);
    }

    /* Re-roll path (P0-8): slim markers mean a re-roll changes ONLY the payload
       (extra.diceRolls), never the message text — swap the card element in
       place instead of re-rendering the whole block. */
    function rerenderRollCard(messageId, rollId) {
        const documentRef = doc();
        if (!documentRef) return;
        const context = getContext();
        const mes = context.chat[messageId];
        const roll = Array.isArray(mes?.extra?.diceRolls) ? mes.extra.diceRolls.find(item => item?.id === rollId) : null;
        if (!roll) return;
        const mesEl = documentRef.querySelector(`#chat .mes[mesid="${messageId}"]`);
        const oldCard = mesEl?.querySelector(`.dw-roll[data-dw-id="${rollId}"]`);
        if (!oldCard) {
            renderMessageRolls(messageId, true);
            return;
        }
        oldCard.replaceWith(buildRollCard(roll, { fresh: true }));
    }

    /* Delete path: the marker line left the text (deleteRoll) — drop the card
       element directly; the render gate correctly skips a full rebuild because
       the DOM still shows the OTHER, still-valid cards. */
    function removeRollCard(messageId, rollId) {
        const documentRef = doc();
        if (!documentRef) return;
        const card = documentRef.querySelector(`#chat .mes[mesid="${messageId}"] .dw-roll[data-dw-id="${rollId}"]`);
        if (card) card.remove();
    }

    function renderAllRolls() {
        const context = getContext();
        const chat = Array.isArray(context.chat) ? context.chat : [];
        chat.forEach((mes, messageId) => {
            const hasRolls = Array.isArray(mes?.extra?.diceRolls) && mes.extra.diceRolls.length > 0;
            const hasMarkerText = hasMarker(mes?.mes) || hasMarker(mes?.extra?.display_text ?? '');
            if (hasRolls || hasMarkerText) {
                renderMessageRolls(messageId, false);
                return;
            }
            /* Tag heal (v0.4.8): history messages get NO per-message render events
               after F5 / lazy "Show more", so a roll the model wrote as XML tool
               text (`<roll_dice ... />`) or a legacy `<roll>` tag would stay raw
               in the DOM forever. Parse assistant/non-system messages that still
               contain a tag; parseMessageRollTags is idempotent (a parsed tag
               becomes a marker) and leaves failed parses untouched. */
            if (!mes?.is_user && !mes?.is_system && typeof mes?.mes === 'string' && ROLL_TAG_GATE_RE.test(mes.mes)) {
                if (parseMessageRollTags) parseMessageRollTags(messageId);
            }
        });
    }

    function scheduleRollSweep(delay) {
        setTimeout(renderAllRolls, delay);
    }

    function setTagParser(fn) {
        parseMessageRollTags = typeof fn === 'function' ? fn : null;
    }

    return {
        findAvatarUrl,
        buildRollCard,
        animateNumber,
        injectRollCards,
        domHasMarkerText,
        domHasRollUi,
        mesElExists,
        renderMessageRolls,
        rerenderRollCard,
        removeRollCard,
        renderAllRolls,
        scheduleRollSweep,
        invalidateAvatarCache,
        setTagParser,
    };
}
