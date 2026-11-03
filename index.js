/* Dice Weaver — Copyright (C) 2026 kdturtle — GPL-3.0, see LICENSE. */
import { extension_settings, getContext, saveMetadataDebounced } from '../../../extensions.js';
import { saveChatDebounced, saveSettingsDebounced, setExtensionPrompt, extension_prompt_types, extension_prompt_roles, updateMessageBlock, addOneMessage } from '../../../../script.js';
import { eventSource, event_types } from '../../../events.js';
import { ToolManager } from '../../../tool-calling.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument, SlashCommandNamedArgument } from '../../../slash-commands/SlashCommandArgument.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { callGenericPopup, POPUP_TYPE, POPUP_RESULT } from '../../../popup.js';
import { getCurrentLocale } from '../../../i18n.js';
import { user_avatar } from '../../../personas.js';
import {
    makeId,
    parseFormulaLine,
    performRoll,
    resolveDc,
    stripMarkers,
} from './dice.js';
import { createRollPayload } from './payloads.js';
import { charKeyFor, getCharSettingsFrom, getSettingsFrom, migrateCharSettings } from './settings-core.js';
import { createRenderEngine } from './render.js';
import { createRollStore, resolveTurnMessage } from './rolls.js';
import { createSettingsUI } from './settings-ui.js';
import { createDwHub } from './hub.js';
import { createResultsFeed } from './results-feed.js';
import { makeT, resolveLang } from './strings.js';

const MODULE_NAME = 'diceweaver';
const TOOL_NAME = 'roll_dice';
const DIRECTIVE_KEY = 'diceweaver_directive';

const DIRECTIVE = [
    '[Dice Rolls] When the outcome of an action is uncertain, end your reply with exactly one roll line and write nothing after it:',
    '<roll char="Character name" stat="STR 3" stat_value="3" dc="10" adv="" note="brief modifier reason">the action being attempted</roll>',
    'stat_value is the bare number of the stat. adv is "adv", "dis" or empty. dc is a number. Never write dice numbers, totals or outcomes yourself. Roll sparingly, only for meaningful attempts.',
].join('\n');

const TAG_FALLBACK_DIRECTIVE = [
    '[Dice Rolls] End your reply with exactly one roll line when an action\'s outcome is uncertain, and write nothing after it:',
    '<roll char="Character name" stat="STR 3" stat_value="3" dc="10" adv="" note="brief reason">the action being attempted</roll>',
    'Never write dice numbers, totals or outcomes yourself. Roll sparingly, only for meaningful attempts.',
].join('\n');

let forcedRoll = null;
let fcMisses = 0;
let lastGenerationType = null;
/* P0-3: id of the AI message rendered for the CURRENT generation turn.
   Set by CHARACTER_MESSAGE_RENDERED, cleared on GENERATION_ENDED /
   CHAT_CHANGED. attachRoll trusts only this (never "last AI message"). */
let currentTurnMessageId = null;
/* B1: chat.length when the current (non-quiet, non-dry) generation started.
   Streaming + the stealth roll_dice tool finalizes the AI message through
   finalizeIntermediaryMessage, which emits NO CHARACTER_MESSAGE_RENDERED -
   without this anchor every streamed FC roll became a detached "Dice"
   system message instead of a card under the reply that narrated it. */
let turnStartIndex = null;
/* True between a real turn's GENERATION_STARTED and GENERATION_ENDED. */
let generationInFlight = false;
let turnStartedAt = null;

/* The message being STREAMED right now must never be tag-parsed: its text is
   partial (an unfinished `<roll ...` looks like a cut-off tag → bogus
   "[the reply was cut off]" roll) and the next stream tick overwrites
   mes.mes with the raw text again, so a second parse creates a DUPLICATE
   roll (one with a marker, one orphan). Seen in a real chat: a sweep ran
   mid-stream. CHARACTER_MESSAGE_RENDERED (stream finished) or
   GENERATION_ENDED parse it once the text is final. */
function isInFlightMessage(messageId) {
    if (!generationInFlight || currentTurnMessageId != null) return false;
    const chat = getContext().chat ?? [];
    return messageId === chat.length - 1 && turnStartIndex != null && messageId >= turnStartIndex - 1;
}

function parseTagsUnlessInFlight(messageId) {
    if (isInFlightMessage(messageId)) return;
    store.parseMessageRollTags(messageId);
}

function isTurnGeneration(type) {
    return type !== 'quiet';
}

/* The AI message produced by the CURRENT turn, or null. Prefers the id from
   CHARACTER_MESSAGE_RENDERED; otherwise the last chat message when it is an
   AI message created (or, for swipe/continue, re-generated) by this turn. */
/* Continue after a tool-only turn: ST appends the continuation to the LAST
   message, which is our system roll message. That message renders
   display_text (the markers) only, so the new prose was saved but never
   shown. Move the prose into its own reply after the roll card; an echoed
   copy of the player's message at its start is dropped. Also runs on chat
   load, so a roll message already holding hidden prose is repaired. */
async function rescueContinuedRollMessage() {
    const context = getContext();
    const chat = context.chat;
    if (!Array.isArray(chat) || !chat.length) return false;
    const index = chat.length - 1;
    const mes = chat[index];
    if (!mes?.is_system || !Array.isArray(mes.extra?.diceRolls) || typeof mes.extra.display_text !== 'string') return false;
    let prose = stripMarkers(String(mes.mes ?? '')).trim();
    if (!prose) return false;
    const lastUser = chat.slice(0, index).reverse().find(item => item?.is_user);
    const userText = String(lastUser?.mes ?? '').trim();
    if (userText && prose.startsWith(userText)) prose = prose.slice(userText.length).trim();

    const { diceRolls, display_text: markerText, isSmallSys, ...replyExtra } = mes.extra;
    /* Character State event markers point into extra.csEvents; without that
       list they would show as raw text in the moved reply. */
    if (!Array.isArray(replyExtra.csEvents)) prose = prose.replace(/^[ \t]*\[CSEVENT:#\d+[^\]]*\][ \t]*\n*/gm, '').trim();
    mes.mes = markerText;
    mes.extra = { isSmallSys, diceRolls, display_text: markerText };
    if (Array.isArray(mes.swipes)) {
        mes.swipes = [markerText];
        mes.swipe_id = 0;
        mes.swipe_info = [{ send_date: mes.send_date, extra: structuredClone(mes.extra) }];
    }
    updateMessageBlock(index, mes);
    engine.renderMessageRolls(index, true);
    if (prose) {
        const reply = {
            name: context.name2,
            is_user: false,
            is_system: false,
            send_date: mes.send_date,
            mes: prose,
            gen_started: mes.gen_started,
            gen_finished: mes.gen_finished,
            extra: replyExtra,
            swipes: [prose],
            swipe_id: 0,
            swipe_info: [{ send_date: mes.send_date, gen_started: mes.gen_started, gen_finished: mes.gen_finished, extra: structuredClone(replyExtra) }],
        };
        chat.push(reply);
        await addOneMessage(reply);
        await eventSource.emit(event_types.CHARACTER_MESSAGE_RENDERED, chat.length - 1, 'normal');
    }
    saveChatDebounced();
    return true;
}

function resolveTurnMessageId() {
    return resolveTurnMessage({
        chat: getContext().chat,
        renderedId: currentTurnMessageId,
        turnStartIndex,
        generationType: lastGenerationType,
    });
}

function fcMissThreshold() {
    const raw = Number(getSettings().fc_miss_threshold);
    return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 3;
}

function fcFallbackActive() {
    const settings = getSettings();
    return settings.mode === 'auto'
        && settings.auto_fallback_to_tags !== false
        && toolSupported()
        && !useTagMode()
        && fcMisses >= fcMissThreshold();
}

function getFcMissState() {
    return { misses: fcMisses, threshold: fcMissThreshold(), fallbackActive: fcFallbackActive() };
}

function resetFcMisses() {
    fcMisses = 0;
    updateDirective();
    hub.syncDwHub();
}

function bumpRollsIndex() {
    /* MESSAGE_DELETED etc.: roll data changed outside rolls.js mutation paths. */
    store.bumpRollsVersion();
}

/* D3: fresh translator per call so a language change applies without F5. */
function getT() {
    return makeT(resolveLang(getSettings().lang, getCurrentLocale()));
}

/* ---------------------------------------------------------------------------
 * Settings wrappers (pure core lives in settings-core.js)
 * ------------------------------------------------------------------------- */

function getSettings() {
    return getSettingsFrom(extension_settings, MODULE_NAME);
}

function charKeyForName(name) {
    return charKeyFor(getContext(), name);
}

function getCharSettings(name) {
    return getCharSettingsFrom(getSettings(), charKeyForName, name);
}

function getActiveCharName() {
    const context = getContext();
    /* Group chat: characterId points at no single member — resolve the ACTIVE
       speaker from the most recent non-user message (`mes.name` is the member
       name there). Limitation (documented): before any AI message exists the
       group has no speaker yet, so per-char rules resolve to '' (global). */
    if (context.groupId != null) {
        const chat = Array.isArray(context.chat) ? context.chat : [];
        for (let i = chat.length - 1; i >= 0; i--) {
            const mes = chat[i];
            if (!mes || mes.is_user) continue;
            const name = String(mes.name ?? '').trim();
            if (name) return name;
        }
        return '';
    }
    const id = context.characterId;
    const entry = Number.isInteger(id) ? context.characters?.[id] : null;
    return entry?.name ?? '';
}

/* Per-char kill switch (tri-state inherit/on/off): the global master switch
   wins; a char is disabled only when its own rule is explicitly false. */
function isCharEnabled(name) {
    const settings = getSettings();
    if (!settings.enabled) return false;
    return getCharSettings(String(name ?? '').trim()).enabled !== false;
}

function toolSupported() {
    try {
        return ToolManager.isToolCallingSupported();
    } catch {
        return false;
    }
}

function useTagMode() {
    const settings = getSettings();
    if (!isCharEnabled(getActiveCharName())) return false;
    if (settings.mode === 'tag_only') return true;
    if (settings.mode === 'fc_only') return false;
    return !toolSupported();
}

/* ---------------------------------------------------------------------------
 * Directive + forced roll (prompt-side logic)
 * ------------------------------------------------------------------------- */

function buildForcedDirective(userText, formulaLine) {
    const formulaAttr = formulaLine ? ` formula="${formulaLine}"` : '';
    const lines = [
        '[Dice Roll - MANDATORY] The user just sent a roll command:',
        `"${String(userText ?? '').trim().slice(0, 300)}"`,
        'If the situation/action in that command happens in this reply, end the reply with EXACTLY ONE roll line and write nothing after it:',
        `<roll char="character name" stat="STR 3" stat_value="3" dc="10" adv="" note="reason"${formulaAttr}>the action being attempted</roll>`,
        formulaLine ? `Required roll formula: ${formulaLine}` : 'Formula: use the stat-based modifier as usual.',
        'If the condition does not happen, do NOT roll; reply normally.',
    ];
    return lines.join('\n');
}

function updateDirective() {
    const settings = getSettings();
    if (!isCharEnabled(getActiveCharName())) {
        setExtensionPrompt(DIRECTIVE_KEY, '', extension_prompt_types.IN_CHAT, 2, false, extension_prompt_roles.SYSTEM);
        return;
    }
    /* Tag directive when tags are the active path, or as a graceful fallback
       when FC is requested but the model/API cannot do function calling
       (fc_only without tool support would otherwise be a silent dead mode —
       tags are still parsed on MESSAGE_RECEIVED regardless of mode). */
    let directive = (useTagMode() || !toolSupported()) ? DIRECTIVE : '';
    if (fcFallbackActive()) {
        directive = TAG_FALLBACK_DIRECTIVE;
    }
    if (forcedRoll) {
        directive = buildForcedDirective(forcedRoll.text, forcedRoll.formula);
    }
    setExtensionPrompt(DIRECTIVE_KEY, directive, extension_prompt_types.IN_CHAT, 2, false, extension_prompt_roles.SYSTEM);
}

/* P1 fix: a "miss" is only a miss when the FC directive was ACTUALLY the
   active path for a normal generation — mode=auto, tools supported, no forced
   roll, tags not already the active path, fallback not yet engaged, and the
   finished message is an AI message of type 'normal'. Everything else
   (swipes, continues, forced directives, group misc) never counted. */
function trackFcMisses(messageId) {
    const settings = getSettings();
    if (settings.mode !== 'auto' || !toolSupported()) return;
    if (settings.auto_fallback_to_tags === false) return;
    if (lastGenerationType && lastGenerationType !== 'normal') return;
    if (forcedRoll) return;
    if (useTagMode()) return;
    if (fcMisses >= fcMissThreshold()) return;
    const context = getContext();
    const mes = context.chat[messageId];
    if (!mes || mes.is_user || mes.is_system) return;
    const hasRolls = Array.isArray(mes.extra?.diceRolls) && mes.extra.diceRolls.length > 0;
    if (hasRolls) {
        if (fcMisses !== 0) {
            fcMisses = 0;
            updateDirective();
        }
        return;
    }
    fcMisses++;
    if (fcMisses >= fcMissThreshold()) {
        updateDirective();
    }
}

function maybeClearForcedRoll() {
    const context = getContext();
    if (context.groupId != null) return;
    clearForcedRoll();
}

/* P1 fix: substring `includes()` matched "scroll" for trigger "roll".
   Plain triggers match on word boundaries (case-insensitive); triggers that
   start with `/` or `!` are commands — they only fire at the start of the
   message or of a sentence. */
function triggerMatches(text, trigger) {
    const escaped = String(trigger).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (/^[\/!]/.test(trigger)) {
        return new RegExp(`(?:^|\n|[.!?…][ \t]+)${escaped}`, 'i').test(text);
    }
    return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

function detectForcedRoll(messageId) {
    const charSettings = getCharSettings(getActiveCharName());
    const trigger = String(charSettings.trigger ?? '').trim();
    if (!trigger || !isCharEnabled(getActiveCharName())) return;
    const context = getContext();
    const mes = context.chat[messageId];
    if (!mes || !mes.is_user || typeof mes.mes !== 'string') return;
    if (triggerMatches(mes.mes, trigger)) {
        forcedRoll = { text: mes.mes, formula: String(charSettings.trigger_formula ?? '').trim(), ts: Date.now() };
        updateDirective();
    }
}

function detectForcedRollFromLastUserMessage() {
    const context = getContext();
    for (let i = context.chat.length - 1; i >= 0; i--) {
        if (context.chat[i]?.is_user) {
            detectForcedRoll(i);
            return;
        }
    }
}

function clearForcedRoll() {
    if (!forcedRoll) return;
    forcedRoll = null;
    updateDirective();
}

/* ---------------------------------------------------------------------------
 * Module wiring (factories)
 * ------------------------------------------------------------------------- */

const engine = createRenderEngine({
    getContext,
    updateMessageBlock,
    getT,
    /* Live binding: personas.js reassigns user_avatar on persona switch. */
    getUserAvatar: () => user_avatar,
});

const store = createRollStore({
    getContext,
    addOneMessage,
    saveChatDebounced,
    getSettings,
    getCharSettings,
    isCharEnabled,
    renderMessageRolls: engine.renderMessageRolls,
    injectRollCards: engine.injectRollCards,
    rerenderRollCard: engine.rerenderRollCard,
    removeRollCard: engine.removeRollCard,
    getCurrentTurnMessageId: resolveTurnMessageId,
    notify: charName => toastr.warning(
        getSettings().enabled ? getT()('rerollBlockedChar', { name: charName || '?' }) : getT()('rerollBlockedOff'),
        'Dice Weaver',
    ),
    /* Late-bound: resultsFeed is created below; only called from UI clicks. */
    onRollChanged: rollId => resultsFeed.unmarkSeen(rollId),
});

/* renderAllRolls (engine) calls parseMessageRollTags (store) — late-bound to
   break the factory dependency cycle; binding happens before any event. */
engine.setTagParser(parseTagsUnlessInFlight);

const resultsFeed = createResultsFeed({
    getContext,
    saveMetadataDebounced,
    setExtensionPrompt,
    extension_prompt_types,
    extension_prompt_roles,
    getSettings,
    getCharSettings,
    isCharEnabled,
});

const settingsUI = createSettingsUI({
    jquery: globalThis.jQuery,
    getSettings,
    saveSettingsDebounced,
    updateDirective,
    charKeyForName,
    getContext,
    performRoll,
    makeId,
    buildRollCard: engine.buildRollCard,
    getT,
    /* Late-bound: hub is created below; called only from UI events. */
    onSettingsChanged: () => hub.syncDwHub(),
});

const hub = createDwHub({
    jquery: globalThis.jQuery,
    getSettings,
    getCharSettings,
    getActiveCharName,
    toolSupported,
    getContext,
    performRoll,
    makeId,
    parseFormulaLine,
    buildRollCard: engine.buildRollCard,
    rerollRoll: store.rerollRoll,
    undoReroll: store.undoReroll,
    deleteRoll: store.deleteRoll,
    insertRoll: store.insertRoll,
    pushSystemRollMessage: store.pushSystemRollMessage,
    renderAllRolls: engine.renderAllRolls,
    callGenericPopup,
    POPUP_TYPE,
    POPUP_RESULT,
    eventSource,
    event_types,
    getFcMissState,
    resetFcMisses,
    getRollsVersion: store.getRollsVersion,
    getT,
});

/* ---------------------------------------------------------------------------
 * Tool + slash command
 * ------------------------------------------------------------------------- */

async function onToolCall(args) {
    const charName = String(args?.character ?? '').trim();
    if (!isCharEnabled(charName)) {
        return 'Dice rolls are disabled for this character.';
    }
    const charSettings = getCharSettings(charName);
    const statFallback = String(args?.stat_label ?? '').match(/-?\d+/);
    const statValue = Number(args?.stat_value ?? (statFallback ? statFallback[0] : 0)) || 0;
    const hasStat = (args?.stat_value != null && String(args.stat_value).trim() !== '') || !!statFallback;
    const dc = resolveDc(args?.dc, charSettings.dc_ladder, charSettings.dc_default ?? 10);
    const adv = ['adv', 'dis', 'advp', 'disp'].includes(args?.advantage) ? args.advantage : '';
    const formulaLine = String(args?.formula ?? '').trim();
    const parsedFormula = parseFormulaLine(formulaLine);
    const rollType = parsedFormula ? parsedFormula.rollType : 'd20';
    const result = performRoll({
        statValue,
        dc,
        adv,
        rollType,
        formula: charSettings.formula,
        crit20: charSettings.crit20,
        crit1: charSettings.crit1,
        bonus: parsedFormula ? parsedFormula.bonus : 0,
        terms: parsedFormula && parsedFormula.terms.length > 1 ? parsedFormula.terms : null,
        hasStat,
    });
    const payload = createRollPayload({
        id: makeId(),
        character: charName,
        action: String(args?.action ?? '').trim(),
        note: String(args?.note ?? '').trim(),
        stat_label: String(args?.stat_label ?? '').trim(),
        stat_value: statValue,
        adv,
        dc,
        roll_type: rollType,
        formula_text: parsedFormula ? parsedFormula.text : '',
        source: 'fc',
        ...result,
    });
    store.attachRoll(payload);
    /* The tool result below already tells the model this outcome: don't feed
       it again next turn (a re-roll unmarks it, so the new result is fed). */
    resultsFeed.markSeen([payload.id]);
    const modPart = result.modifier >= 0 ? `+${result.modifier}` : String(result.modifier);
    const bonusPart = result.bonus > 0 ? `+${result.bonus}` : result.bonus < 0 ? String(result.bonus) : '';
    return `${rollType}: ${result.natural} ${modPart}${bonusPart} = ${result.total} vs DC ${dc} => ${result.outcome}`;
}

function registerRollSlashCommand() {
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'roll',
        helpString: 'Dice Weaver: rolls dice and attaches a roll card to the last AI message (or a small system line).',
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'Roll formula, e.g. 1d20+3 or 2d6. Optional (default d20).',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: false,
            }),
        ],
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'dc',
                description: 'Difficulty class to meet or beat.',
                typeList: [ARGUMENT_TYPE.NUMBER],
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'adv',
                description: 'Roll with advantage (adv), disadvantage (dis), or the penalty-dice variants advp / disp (one extra die; the kept dice are summed).',
                typeList: [ARGUMENT_TYPE.STRING],
                enumList: ['adv', 'dis', 'advp', 'disp'],
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'name',
                description: 'Character name for per-character rules and the card header.',
                typeList: [ARGUMENT_TYPE.STRING],
            }),
        ],
        callback: async (args, formula) => {
            const charName = String(args?.name ?? '').trim();
            const charSettings = getCharSettings(charName);
            const dc = resolveDc(args?.dc, charSettings.dc_ladder, charSettings.dc_default ?? 10);
            const advMap = { adv: 'adv', dis: 'dis', advp: 'advp', disp: 'disp' };
            const adv = advMap[String(args?.adv ?? '').toLowerCase()] ?? '';
            const parsedFormula = parseFormulaLine(formula);
            const rollType = parsedFormula ? parsedFormula.rollType : 'd20';
            const result = performRoll({
                statValue: 0,
                hasStat: false,
                dc,
                adv,
                rollType,
                formula: charSettings.formula,
                crit20: charSettings.crit20,
                crit1: charSettings.crit1,
                bonus: parsedFormula ? parsedFormula.bonus : 0,
                terms: parsedFormula && parsedFormula.terms.length > 1 ? parsedFormula.terms : null,
            });
            const payload = createRollPayload({
                id: makeId(),
                character: charName,
                action: getT()('manualAction'),
                note: '',
                stat_label: '',
                stat_value: 0,
                adv,
                dc,
                roll_type: rollType,
                formula_text: parsedFormula ? parsedFormula.text : '',
                source: 'manual',
                ...result,
            });
            const context = getContext();
            let attached = false;
            for (let i = context.chat.length - 1; i >= 0; i--) {
                const mes = context.chat[i];
                if (mes && !mes.is_user && !mes.is_system) {
                    store.insertRoll(i, payload);
                    attached = true;
                    break;
                }
            }
            if (!attached) {
                await store.pushSystemRollMessage([payload]);
            }
            /* P0-4: returning the marker text made the slash pipe drop it into
               the next command's input (and leak it onward). The card is
               rendered in chat — the command itself yields nothing. */
            toastr.success(getT()('manualDone', { rollType, total: result.total, outcome: hub.dwHubOutcomeLabel(result.outcome) }), 'Dice Weaver');
            return '';
        },
        returns: 'nothing — the result card is rendered in chat',
    }));
}

function registerHubSlashCommand() {
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'rollhub',
        helpString: 'Dice Weaver: opens the roll dashboard (Roll Hub) for this chat.',
        callback: () => {
            hub.showDwHubPopup();
            return '';
        },
        returns: 'nothing — opens the dashboard popup',
    }));
}

function registerTool() {
    ToolManager.registerFunctionTool({
        name: TOOL_NAME,
        displayName: 'Dice Roll',
        description: 'Rolls a d20 check against a difficulty class (DC). Call this AFTER you finish narrating the attempted action, as the very final part of your reply. Never invent dice numbers or outcomes yourself; the extension rolls and displays the result to the user.',
        /* No `$schema` key: the old 'draft-4' URI (typo of draft-04) is an
           unknown meta-schema, and strict providers reject the WHOLE request
           ("Unknown meta-schema"). ST strips $schema only for Gemini/Cohere,
           so the plain object schema is the portable form. */
        parameters: {
            type: 'object',
            properties: {
                character: { type: 'string', description: 'Name of the character attempting the action' },
                action: { type: 'string', description: 'The action being attempted, short and vivid' },
                stat_label: { type: 'string', description: 'Stat used with its value, e.g. "STR 3"' },
                stat_value: { type: 'number', description: 'The bare numeric value of the stat used for the modifier' },
                dc: { type: 'string', description: 'Difficulty: a number (e.g. "10") or a ladder word: easy / normal / hard / extreme' },
                advantage: { type: 'string', enum: ['', 'adv', 'dis'], description: 'Roll with advantage or disadvantage' },
                formula: { type: 'string', description: 'Optional roll formula override, e.g. "1d20+3" or "2d6+1". Omit to use the default stat-based formula.' },
                note: { type: 'string', description: 'Brief note about modifiers or circumstances' },
            },
            required: ['character', 'action', 'dc'],
        },
        action: onToolCall,
        formatMessage: async () => 'Rolling the dice...',
        shouldRegister: () => {
            return isCharEnabled(getActiveCharName()) && getSettings().mode !== 'tag_only';
        },
        stealth: true,
    });
}

function onMessageRendered(messageId) {
    if (!Number.isInteger(messageId)) return;
    currentTurnMessageId = messageId;
    store.flushPendingRolls(messageId);
    store.parseMessageRollTags(messageId);
    trackFcMisses(messageId);
    maybeClearForcedRoll();
}

/* ---------------------------------------------------------------------------
 * Bootstrap + events
 * ------------------------------------------------------------------------- */

jQuery(() => {
    settingsUI.addSettingsUI();
    registerTool();
    registerRollSlashCommand();
    registerHubSlashCommand();
    updateDirective();

    $('#chat').on('click', '.dw-reroll, .dw-undo', function (event) {
        event.stopPropagation();
        const messageId = Number($(this).closest('.mes').attr('mesid'));
        const rollId = String($(this).closest('.dw-roll').attr('data-dw-id') ?? '');
        if (!Number.isInteger(messageId) || !rollId) return;
        if ($(this).hasClass('dw-undo')) store.undoReroll(messageId, rollId);
        else store.rerollRoll(messageId, rollId);
        hub.syncDwHub();
    });

    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onMessageRendered);
    eventSource.on(event_types.USER_MESSAGE_RENDERED, messageId => {
        if (!Number.isInteger(messageId)) return;
        store.clearPendingRolls();
        /* B7: NOT resetting fcMisses here - a miss streak spans user turns
           (one AI reply per user message); resetting per message meant the
           threshold could never be reached in a 1:1 chat. A real roll, a chat
           switch or the Hub "Reset" button reset it. */
        detectForcedRoll(messageId);
        engine.renderMessageRolls(messageId, false);
    });
    eventSource.on(event_types.MESSAGE_RECEIVED, messageId => {
        if (Number.isInteger(messageId)) {
            store.parseMessageRollTags(messageId);
            maybeClearForcedRoll();
        }
    });
    eventSource.on(event_types.MESSAGE_EDITED, messageId => {
        if (!Number.isInteger(messageId)) return;
        store.reconcileEditedMessage(messageId);
        parseTagsUnlessInFlight(messageId);
    });
    eventSource.on(event_types.MESSAGE_UPDATED, messageId => {
        if (Number.isInteger(messageId)) engine.renderMessageRolls(messageId, false);
    });
    eventSource.on(event_types.MESSAGE_SWIPED, messageId => {
        if (Number.isInteger(messageId)) {
            store.materializeRollsForSwipe(getContext().chat[messageId]);
            parseTagsUnlessInFlight(messageId);
        }
    });
    eventSource.on(event_types.MESSAGE_DELETED, () => {
        bumpRollsIndex();
        hub.syncDwHub();
    });
    eventSource.on(event_types.MORE_MESSAGES_LOADED, () => {
        engine.renderAllRolls();
        engine.scheduleRollSweep(250);
    });
    eventSource.on(event_types.CHAT_CHANGED, () => {
        store.clearPendingRolls();
        forcedRoll = null;
        fcMisses = 0;
        currentTurnMessageId = null;
        turnStartIndex = null;
        generationInFlight = false;
        turnStartedAt = null;
        updateDirective();
        resultsFeed.handleChatChanged();
        engine.invalidateAvatarCache();
        engine.renderAllRolls();
        engine.scheduleRollSweep(700);
        engine.scheduleRollSweep(2200);
        rescueContinuedRollMessage().catch(error => console.error('[Dice Weaver] Repairing a continued roll message failed:', error));
    });
    eventSource.on(event_types.APP_READY, () => {
        migrateCharSettings(getSettings(), getContext(), saveSettingsDebounced);
        settingsUI.refreshCharOptions();
        updateDirective();
        engine.invalidateAvatarCache();
        engine.renderAllRolls();
        engine.scheduleRollSweep(900);
    });
    eventSource.on(event_types.GENERATION_STARTED, (type, params, isDryRun) => {
        resultsFeed.handleGenerationStarted(type, isDryRun);
        /* B11: dry runs (token counting, prompt itemization) and quiet
           background generations are not chat turns - they must not reset
           the turn anchor of a real generation. */
        if (isDryRun || !isTurnGeneration(type)) return;
        lastGenerationType = typeof type === 'string' ? type : null;
        /* New turn: the previous turn's rendered message id is STALE — keeping it
           would let the GENERATION_ENDED flush glue tool-only rolls onto the
           PREVIOUS turn's AI message. */
        currentTurnMessageId = null;
        turnStartIndex = Array.isArray(getContext().chat) ? getContext().chat.length : null;
        generationInFlight = true;
        turnStartedAt = Date.now();
        if (!forcedRoll && ['normal', 'swipe', 'regenerate'].includes(type)) {
            detectForcedRollFromLastUserMessage();
        }
        updateDirective();
    });
    eventSource.on(event_types.GENERATION_ENDED, async () => {
        if (lastGenerationType === 'continue') {
            try {
                await rescueContinuedRollMessage();
            } catch (error) {
                console.error('[Dice Weaver] Moving a continuation out of the roll message failed:', error);
            }
        }
        if (turnStartIndex == null && currentTurnMessageId == null) return;
        /* B1: a turn that ended WITHOUT a render event (streaming + stealth
           tool) still produced an AI message - parse its tags and count it. */
        const renderedThisTurn = currentTurnMessageId != null;
        const turnId = resolveTurnMessageId();
        generationInFlight = false;
        /* P0-3: flush parked rolls BEFORE clearing the turn anchor - the flush
           targets the final AI message of the turn that just ended. */
        await store.flushPendingRollsFallback();
        if (!renderedThisTurn && turnId != null) {
            store.parseMessageRollTags(turnId);
            trackFcMisses(turnId);
        }
        /* Final text is in: drop payloads whose marker the finished reply no
           longer contains (left over by any mid-stream parse) — otherwise
           they show up as phantom rolls in the Hub. */
        if (turnId != null && turnStartedAt != null) store.reconcileEditedMessage(turnId, { createdAfter: turnStartedAt });
        turnStartedAt = null;
        currentTurnMessageId = null;
        turnStartIndex = null;
        forcedRoll = null;
        updateDirective();
        hub.syncDwHub();
    });

    hub.init();
});

/* Public integration surface for external bridges (e.g. the Storyline
   dice_roller function). Passive by design: Dice Weaver never imports or
   depends on any other extension, and works fully standalone.
   v2 methods are frozen as-is; v3 (0.5.0) is additive only. */
async function rollFor(options = {}) {
    const charName = String(options?.character ?? '').trim();
    if (!isCharEnabled(charName)) return null;
    const charSettings = getCharSettings(charName);
    const dc = resolveDc(options?.dc, charSettings.dc_ladder, charSettings.dc_default ?? 10);
    const adv = ['adv', 'dis', 'advp', 'disp'].includes(options?.adv) ? options.adv : '';
    const formulaLine = String(options?.formula ?? '').trim();
    const parsedFormula = parseFormulaLine(formulaLine);
    const rollType = parsedFormula ? parsedFormula.rollType : 'd20';
    const statValue = Number(options?.stat_value ?? 0) || 0;
    const result = performRoll({
        statValue,
        hasStat: options?.stat_value != null && String(options.stat_value).trim() !== '',
        dc,
        adv,
        rollType,
        formula: charSettings.formula,
        crit20: charSettings.crit20,
        crit1: charSettings.crit1,
        bonus: parsedFormula ? parsedFormula.bonus : 0,
        terms: parsedFormula && parsedFormula.terms.length > 1 ? parsedFormula.terms : null,
    });
    const payload = createRollPayload({
        id: makeId(),
        character: charName,
        action: String(options?.action ?? '').trim() || getT()('apiAction'),
        note: String(options?.note ?? '').trim(),
        stat_label: String(options?.stat_label ?? '').trim(),
        stat_value: statValue,
        adv,
        dc,
        roll_type: rollType,
        formula_text: parsedFormula ? parsedFormula.text : '',
        source: 'api',
        ...result,
    });
    store.attachRoll(payload);
    hub.syncDwHub();
    return payload;
}

globalThis.DiceWeaverAPI = Object.freeze({
    apiVersion: 3,
    toolName: TOOL_NAME,
    /* --- v2 (unchanged; Storyline dice-weaver-bridge depends on these) --- */
    isEnabled: () => isCharEnabled(getActiveCharName()),
    getMode: () => String(getSettings().mode ?? 'auto'),
    getTrigger: () => String(getCharSettings(getActiveCharName()).trigger ?? '').trim(),
    getTriggerFormula: () => String(getCharSettings(getActiveCharName()).trigger_formula ?? '').trim(),
    hasForcedRoll: () => forcedRoll !== null,
    getForcedDirective: () => (forcedRoll ? buildForcedDirective(forcedRoll.text, forcedRoll.formula) : ''),
    stripMarkers,
    /* --- v3 additive --- */
    /* Deep copies: payloads are JSON-safe, but {...roll} would leave nested
       `rolls` and `prev` aliasing the persisted chat data — a consumer mutating
       its "read-only" copy would corrupt messages / undo snapshots. */
    getRolls: () => hub.dwHubCollectRolls().map(({ messageId, roll }) => ({ messageId, roll: structuredClone(roll) })),
    rollFor,
    deleteRoll: rollId => {
        if (typeof rollId !== 'string' || !rollId) return false;
        const entry = hub.dwHubCollectRolls().find(({ roll }) => roll.id === rollId);
        if (!entry) return false;
        const deleted = store.deleteRoll(entry.messageId, rollId);
        if (deleted) hub.syncDwHub();
        return deleted;
    },
    getUnseenResults: () => resultsFeed.collectUnseen(resultsFeed.MAX_SEEN).map(({ messageId, roll }) => ({ messageId, roll: structuredClone(roll) })),
    clearUnseenResults: () => {
        const seen = resultsFeed.collectUnseen(resultsFeed.MAX_SEEN).map(({ roll }) => roll.id);
        resultsFeed.markSeen(seen);
        return seen.length;
    },
});
