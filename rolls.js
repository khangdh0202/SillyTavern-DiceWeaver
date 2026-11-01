/* Roll storage + message mutations (dependency-injected, node-testable).
   createRollStore({ getContext, addOneMessage, saveChatDebounced, getSettings,
   getCharSettings, renderMessageRolls, injectRollCards }) */
import { MARKER_RE, ROLL_TAG_GATE_RE, extractRollTags, formatMarker, normalizeDc, parseAttrs, parseFormulaLine, performRoll } from './dice.js';
import { createRollPayload } from './payloads.js';

const SWIPE_ROLLS_KEY = 'diceRollsBySwipe';
const PENDING_TTL = 10 * 60 * 1000;

/* B1 (pure, testable): the AI message produced by the CURRENT turn, or null.
   Prefers the id from CHARACTER_MESSAGE_RENDERED; otherwise the last chat
   message when it is an AI message created (or, for swipe/continue,
   re-generated in place) after the turn started. */
export function resolveTurnMessage({ chat, renderedId = null, turnStartIndex = null, generationType = null } = {}) {
    if (renderedId != null) return renderedId;
    const list = Array.isArray(chat) ? chat : [];
    const last = list.length - 1;
    if (turnStartIndex == null || last < 0) return null;
    const mes = list[last];
    if (!mes || mes.is_user || mes.is_system) return null;
    const floor = ['swipe', 'continue'].includes(generationType) ? turnStartIndex - 1 : turnStartIndex;
    return last >= floor ? last : null;
}

export function createRollStore(deps) {
    const getContext = deps.getContext;
    const addOneMessage = deps.addOneMessage;
    const saveChatDebounced = deps.saveChatDebounced;
    const getSettings = deps.getSettings;
    const getCharSettings = deps.getCharSettings;
    const renderMessageRolls = deps.renderMessageRolls;
    const injectRollCards = deps.injectRollCards;
    const rerenderRollCard = deps.rerenderRollCard;
    const removeRollCard = deps.removeRollCard;
    const getCurrentTurnMessageId = typeof deps.getCurrentTurnMessageId === 'function' ? deps.getCurrentTurnMessageId : () => null;
    const isCharEnabled = typeof deps.isCharEnabled === 'function' ? deps.isCharEnabled : () => true;
    /* UI feedback for a blocked action (toastr in the app). */
    const notify = typeof deps.notify === 'function' ? deps.notify : () => {};
    /* A roll's RESULT changed (re-roll / undo) — the results feed must treat
       it as unseen again, or the AI keeps narrating the old outcome. */
    const onRollChanged = typeof deps.onRollChanged === 'function' ? deps.onRollChanged : () => {};
    let pendingRolls = [];
    /* Monotonic version bumped on EVERY roll-data mutation — lets the Hub cache
       its collect pass without callbacks (see hub.js dwHubCollectRolls). */
    let rollsVersion = 0;

    function bumpRollsVersion() {
        rollsVersion++;
    }

    function clearPendingRolls() {
        pendingRolls = [];
    }

    function insertRoll(messageId, payload) {
        const context = getContext();
        const mes = context.chat[messageId];
        if (!mes) return;
        mes.extra = mes.extra ?? {};
        mes.extra.diceRolls = Array.isArray(mes.extra.diceRolls) ? mes.extra.diceRolls : [];
        if (mes.extra.diceRolls.some(roll => roll.id === payload.id)) return;
        mes.extra.diceRolls.push(payload);
        recordRollsForSwipe(mes, [payload]);
        /* One marker PER roll: the id-dedupe above guarantees this payload is
           new, so its marker is new too. The old per-message hasMarker() guard
           silently dropped every second+ roll's marker in the same message
           (/roll twice, multiple tool calls, flushPendingRolls) — the payload
           existed but no card could ever render from it. */
        mes.mes = `${String(mes.mes ?? '').trimEnd()}\n${formatMarker(payload)}`;
        if (typeof mes.extra.display_text === 'string') {
            mes.extra.display_text = `${mes.extra.display_text.trimEnd()}\n${formatMarker(payload)}`;
        }
        bumpRollsVersion();
        saveChatDebounced();
        renderMessageRolls(messageId, true);
    }

    /* Per-swipe roll storage: ST syncs mes/extra per swipe, so a roll written
       into the current view can end up orphaned in another swipe's extra.
       diceRollsBySwipe[swipeId] keeps the payload truth per swipe; the active
       swipe's list is materialized back into extra.diceRolls on MESSAGE_SWIPED. */
    function recordRollsForSwipe(mes, newRolls) {
        if (!Array.isArray(mes?.swipes) || !Array.isArray(newRolls) || !newRolls.length) return;
        mes.extra = mes.extra ?? {};
        const store = (mes.extra[SWIPE_ROLLS_KEY] && typeof mes.extra[SWIPE_ROLLS_KEY] === 'object')
            ? mes.extra[SWIPE_ROLLS_KEY]
            : (mes.extra[SWIPE_ROLLS_KEY] = {});
        const sid = String(mes.swipe_id ?? 0);
        const list = Array.isArray(store[sid]) ? store[sid] : [];
        for (const roll of newRolls) {
            if (!list.some(item => item.id === roll.id)) list.push(roll);
        }
        store[sid] = list;
    }

    function materializeRollsForSwipe(mes) {
        if (!Array.isArray(mes?.swipes)) return false;
        const sid = String(mes.swipe_id ?? 0);
        const store = mes.extra?.[SWIPE_ROLLS_KEY];
        const stored = store && typeof store === 'object' ? store[sid] : null;
        mes.extra = mes.extra ?? {};
        if (!Array.isArray(stored)) {
            /* Fresh swipe with no stored entry: materialize an EMPTY list instead
               of leaving the previous swipe's payloads in the shared extra —
               stale rolls caused phantom hub entries and a false "rolled" signal
               in trackFcMisses (which reset the tag-fallback counter). */
            if (Array.isArray(mes.extra.diceRolls) && mes.extra.diceRolls.length) {
                mes.extra.diceRolls = [];
                /* The Hub cache keys on rollsVersion — swipe switching changes
                   extra.diceRolls just like any other mutation. */
                bumpRollsVersion();
            }
            return false;
        }
        /* ST restores extra per swipe from swipe_info (synced when the user
           swiped away), so extra.diceRolls can be NEWER than the store copy
           (a re-roll made before a reload). Same id → keep the restored one. */
        const restored = new Map((Array.isArray(mes.extra.diceRolls) ? mes.extra.diceRolls : [])
            .filter(roll => roll && roll.id)
            .map(roll => [roll.id, roll]));
        const list = stored.filter(roll => roll && roll.id).map(roll => restored.get(roll.id) ?? roll);
        store[sid] = list;
        mes.extra.diceRolls = list;
        bumpRollsVersion();
        return true;
    }

    /* After a JSON reload extra.diceRolls[i] and diceRollsBySwipe[sid][i] are
       SEPARATE objects; a re-roll/undo that only mutated the first was
       reverted by the next swipe materialization. Point the store entry at
       the live payload again. */
    function syncSwipeEntry(mes, payload) {
        if (!Array.isArray(mes?.swipes)) return;
        const store = mes.extra?.[SWIPE_ROLLS_KEY];
        const sid = String(mes.swipe_id ?? 0);
        if (!store || typeof store !== 'object' || !Array.isArray(store[sid])) return;
        store[sid] = store[sid].map(roll => (roll?.id === payload.id ? payload : roll));
    }

    /* P0-3: FC tool calls fire DURING generation, often before (or without) the
       AI text message existing. Attach ONLY to the current turn's message —
       set by CHARACTER_MESSAGE_RENDERED, cleared on GENERATION_ENDED — and
       only while it is still the last non-user/non-system message. Anything
       else (AI reply was tool-only, message not rendered yet) parks the roll
       in pendingRolls; the GENERATION_ENDED flush inserts it into the final
       AI message or emits a small system roll message. Attaching to the last
       AI message unconditionally used to glue fresh rolls onto an OLDER
       message. */
    function attachRoll(payload) {
        const context = getContext();
        const turnId = getCurrentTurnMessageId();
        const mes = turnId != null ? context.chat[turnId] : null;
        if (turnId != null && mes && turnId === context.chat.length - 1 && !mes.is_user && !mes.is_system) {
            insertRoll(turnId, payload);
            return;
        }
        pendingRolls.push({ payload, ts: Date.now() });
    }

    function flushPendingRolls(messageId) {
        if (!pendingRolls.length) return;
        const context = getContext();
        const mes = context.chat[messageId];
        if (!mes || mes.is_user || mes.is_system) return;
        if (messageId !== context.chat.length - 1) return;
        const now = Date.now();
        pendingRolls = pendingRolls.filter(item => now - item.ts < PENDING_TTL);
        while (pendingRolls.length) {
            const { payload } = pendingRolls.shift();
            insertRoll(messageId, payload);
        }
    }

    /* Tool-only turn: no message rendered THIS generation → currentTurnMessageId
       is null (reset at GENERATION_STARTED), so parked rolls must NOT glue onto
       the PREVIOUS turn's AI message — they surface as a system roll message. */
    async function flushPendingRollsFallback() {
        if (!pendingRolls.length) return;
        const now = Date.now();
        pendingRolls = pendingRolls.filter(item => now - item.ts < PENDING_TTL);
        if (!pendingRolls.length) return;
        const context = getContext();
        const turnId = getCurrentTurnMessageId();
        const mes = turnId != null ? context.chat[turnId] : null;
        if (turnId != null && mes && turnId === context.chat.length - 1 && !mes.is_user && !mes.is_system) {
            while (pendingRolls.length) {
                insertRoll(turnId, pendingRolls.shift().payload);
            }
            return;
        }
        const payloads = pendingRolls.splice(0).map(item => item.payload);
        await pushSystemRollMessage(payloads);
    }

    async function pushSystemRollMessage(payloads) {
        const markerText = payloads.map(payload => formatMarker(payload)).join('\n');
        const mes = {
            name: 'Dice',
            is_system: true,
            is_user: false,
            send_date: Date.now(),
            mes: markerText,
            extra: {
                isSmallSys: true,
                diceRolls: payloads,
                display_text: markerText,
            },
        };
        const context = getContext();
        context.chat.push(mes);
        await addOneMessage(mes);
        saveChatDebounced();
        injectRollCards(context.chat.length - 1, true);
    }

    /* P0-8: markers are slim (`[dice:#id]`) and the payload in extra.diceRolls
       is the single source of truth, so a re-roll only swaps the card element —
       no message-text rewrite, no marker churn, nothing new for the model. */
    function rerollRoll(messageId, rollId) {
        const context = getContext();
        const mes = context.chat[messageId];
        if (!mes || !Array.isArray(mes.extra?.diceRolls)) return;
        const payload = mes.extra.diceRolls.find(roll => roll.id === rollId);
        if (!payload) return;
        const charName = String(payload.character ?? '').trim();
        if (!isCharEnabled(charName)) {
            /* Used to be a silent no-op: the button looked broken. */
            notify(charName);
            return false;
        }
        const charSettings = getCharSettings(charName);
        /* One-level undo snapshot (Hub "Undo re-roll"): the outcome state BEFORE
           this re-roll. A second re-roll overwrites it — only one step back. */
        payload.prev = {
            rolls: payload.rolls,
            natural: payload.natural,
            modifier: payload.modifier,
            bonus: payload.bonus,
            total: payload.total,
            outcome: payload.outcome,
        };
        /* Damage rolls are unopposed: no DC. Multi-term formulas re-parse from
           roll_type ("2d6+1d4") so the same terms roll again. The modifier is
           KEPT from the original roll — re-evaluating the (maybe edited) stat
           formula changed it, and gave manual rolls a phantom stat penalty. */
        const reparsed = parseFormulaLine(String(payload.roll_type ?? ''));
        const terms = reparsed && reparsed.terms.length > 1 ? reparsed.terms : null;
        const storedModifier = Number(payload.modifier);
        const result = performRoll({
            statValue: payload.stat_value ?? 0,
            modifier: Number.isFinite(storedModifier) ? storedModifier : null,
            hasStat: !!String(payload.stat_label ?? '').trim() || Number(payload.stat_value) !== 0,
            dc: payload.kind === 'damage' ? null : normalizeDc(payload.dc),
            adv: payload.adv ?? '',
            rollType: payload.roll_type ?? 'd20',
            formula: charSettings.formula,
            crit20: charSettings.crit20,
            crit1: charSettings.crit1,
            bonus: payload.bonus ?? 0,
            terms,
        });
        Object.assign(payload, result);
        syncSwipeEntry(mes, payload);
        bumpRollsVersion();
        saveChatDebounced();
        rerenderRollCard(messageId, rollId);
        onRollChanged(rollId);
        return true;
    }

    /* Hub "undo": restore the one-level snapshot saved by the last re-roll. */
    function undoReroll(messageId, rollId) {
        const context = getContext();
        const mes = context.chat[messageId];
        const payload = Array.isArray(mes?.extra?.diceRolls) ? mes.extra.diceRolls.find(roll => roll?.id === rollId) : null;
        if (!payload || !payload.prev || typeof payload.prev !== 'object') return false;
        const restored = { ...payload.prev };
        delete payload.prev;
        Object.assign(payload, restored);
        syncSwipeEntry(mes, payload);
        bumpRollsVersion();
        saveChatDebounced();
        rerenderRollCard(messageId, rollId);
        onRollChanged(rollId);
        return true;
    }

    /* Full delete (Hub CRUD + DiceWeaverAPI v3): payload out of extra.diceRolls,
       marker line out of the message text (current swipe view), per-swipe store
       re-synced, card element removed. */
    function deleteRoll(messageId, rollId) {
        const context = getContext();
        const mes = context.chat[messageId];
        if (!mes || !Array.isArray(mes.extra?.diceRolls)) return false;
        const idx = mes.extra.diceRolls.findIndex(roll => roll?.id === rollId);
        if (idx < 0) return false;
        mes.extra.diceRolls.splice(idx, 1);
        bumpRollsVersion();
        const idLower = String(rollId).toLowerCase();
        const stripOwnMarker = text => String(text ?? '')
            .replace(new RegExp(MARKER_RE.source, MARKER_RE.flags), (full, id) => (String(id).toLowerCase() === idLower ? '' : full))
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trimEnd();
        if (typeof mes.mes === 'string') mes.mes = stripOwnMarker(mes.mes);
        if (typeof mes.extra?.display_text === 'string') mes.extra.display_text = stripOwnMarker(mes.extra.display_text);
        if (Array.isArray(mes.swipes)) {
            const sid = String(mes.swipe_id ?? 0);
            const swipeStore = mes.extra[SWIPE_ROLLS_KEY];
            if (swipeStore && typeof swipeStore === 'object' && Array.isArray(swipeStore[sid])) {
                swipeStore[sid] = swipeStore[sid].filter(roll => roll?.id !== rollId);
            }
        }
        saveChatDebounced();
        removeRollCard(messageId, rollId);
        return true;
    }

    /* P0-7: editing a message can delete marker lines whose payloads survive in
       extra.diceRolls — phantom rows in the Hub forever. Reconcile on
       MESSAGE_EDITED: drop every payload whose marker no longer exists in the
       message text, and re-sync the CURRENT swipe's per-swipe store (other
       swipes re-materialize on MESSAGE_SWIPED from their own store). */
    /* createdAfter (ms timestamp): only payloads stamped at/after it may be
       dropped. The generation-end cleanup passes the turn start so a reply
       whose markers got lost on CONTINUE (e.g. a prompt regex rewrote the
       continued text) never deletes the rolls that were already there. */
    function reconcileEditedMessage(messageId, { createdAfter = null } = {}) {
        const context = getContext();
        const mes = context.chat[messageId];
        if (!mes || !Array.isArray(mes.extra?.diceRolls) || !mes.extra.diceRolls.length) return;
        const text = `${String(mes.mes ?? '')}\n${typeof mes.extra?.display_text === 'string' ? mes.extra.display_text : ''}`;
        const present = new Set();
        const re = new RegExp(MARKER_RE.source, MARKER_RE.flags);
        let match;
        while ((match = re.exec(text)) !== null) {
            present.add((match[1] ?? '').toLowerCase());
        }
        const protectedRoll = roll => createdAfter != null && !(Number(roll?.ts) >= createdAfter);
        const kept = mes.extra.diceRolls.filter(roll => roll?.id && (present.has(String(roll.id).toLowerCase()) || protectedRoll(roll)));
        if (kept.length === mes.extra.diceRolls.length) return;
        mes.extra.diceRolls = kept;
        bumpRollsVersion();
        if (Array.isArray(mes.swipes)) {
            const sid = String(mes.swipe_id ?? 0);
            const swipeStore = mes.extra[SWIPE_ROLLS_KEY];
            if (swipeStore && typeof swipeStore === 'object' && Array.isArray(swipeStore[sid])) {
                swipeStore[sid] = kept;
            }
        }
        saveChatDebounced();
    }

    function parseMessageRollTags(messageId) {
        const context = getContext();
        const mes = context.chat[messageId];
        if (!mes || !getSettings().enabled || typeof mes.mes !== 'string' || !ROLL_TAG_GATE_RE.test(mes.mes)) {
            renderMessageRolls(messageId, false);
            return;
        }
        const settings = getSettings();
        const extracted = extractRollTags(mes.mes, {
            formula: settings.formula,
            crit20: settings.crit20,
            crit1: settings.crit1,
            dcDefault: settings.dc_default,
            /* The named ladder (global + per-char) must reach the tag parser,
               or dc="hard" silently ignored the user's customized rungs. */
            dcLadder: settings.dc_ladder,
            resolveSettings: attrs => {
                const a = parseAttrs(attrs);
                const cs = getCharSettings(String(a.char ?? a.character ?? '').trim());
                return { formula: cs.formula, crit20: cs.crit20, crit1: cs.crit1, dcDefault: cs.dc_default, dcLadder: cs.dc_ladder };
            },
        });
        const text = extracted.text;
        /* Tag rolls are the most common path — stamp them through the payload
           factory like every other source (ts → Hub relative time). The id is
           preserved, so the markers already written into `text` still match. */
        const rolls = extracted.rolls.map(roll => createRollPayload(roll));
        if (rolls.length) {
            mes.extra = mes.extra ?? {};
            mes.extra.diceRolls = [...(Array.isArray(mes.extra.diceRolls) ? mes.extra.diceRolls : []), ...rolls];
            recordRollsForSwipe(mes, rolls);
            mes.mes = text;
            if (typeof mes.extra.display_text === 'string') {
                mes.extra.display_text = extractRollTags(mes.extra.display_text, { rolls }).text;
            }
            bumpRollsVersion();
            saveChatDebounced();
        }
        renderMessageRolls(messageId, rolls.length > 0);
    }

    return {
        SWIPE_ROLLS_KEY,
        insertRoll,
        recordRollsForSwipe,
        materializeRollsForSwipe,
        attachRoll,
        flushPendingRolls,
        flushPendingRollsFallback,
        pushSystemRollMessage,
        rerollRoll,
        undoReroll,
        deleteRoll,
        reconcileEditedMessage,
        parseMessageRollTags,
        clearPendingRolls,
        getRollsVersion: () => rollsVersion,
        bumpRollsVersion,
    };
}
