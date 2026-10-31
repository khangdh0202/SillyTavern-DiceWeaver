/* ===========================================================================
 * Roll Hub UI — send-form button + dashboard popup (dependency-injected).
 * Anchors visually next to #character-state-button when present; never
 * imports or calls another extension.
 * createDwHub({ jquery, document?, getSettings, getCharSettings,
 * getActiveCharName, toolSupported, getContext, performRoll, makeId,
 * parseFormulaLine, buildRollCard, rerollRoll, undoReroll, deleteRoll,
 * insertRoll, pushSystemRollMessage, renderAllRolls, callGenericPopup,
 * POPUP_TYPE, POPUP_RESULT, eventSource, event_types, toastr?, getT,
 * getFcMissState?, resetFcMisses? })
 *
 * v0.6.0 (local/DESIGN-v0.6.md §3.2): the popup is built ONCE per open and
 * then refreshed by REGION (header, stats, list, character filter options).
 * The quick-roll form, the filter bar and the list scroll position are never
 * rebuilt by events — v0.5 rebuilt everything on every generation/swipe and
 * wiped what the user was typing.
 * ========================================================================= */
import { isCritEligible } from './dice.js';
import { createRollPayload, normalizeStoredRoll } from './payloads.js';

const LIST_PAGE = 150;

export function createDwHub(deps) {
    const getSettings = deps.getSettings;
    const getCharSettings = deps.getCharSettings;
    const getActiveCharName = deps.getActiveCharName;
    const toolSupported = deps.toolSupported;
    const getContext = deps.getContext;
    const performRoll = deps.performRoll;
    const makeId = deps.makeId;
    const parseFormulaLine = deps.parseFormulaLine;
    const rerollRoll = deps.rerollRoll;
    const undoReroll = deps.undoReroll;
    const deleteRoll = deps.deleteRoll;
    const insertRoll = deps.insertRoll;
    const pushSystemRollMessage = deps.pushSystemRollMessage;
    const renderAllRolls = deps.renderAllRolls;
    const callGenericPopup = deps.callGenericPopup;
    const POPUP_TYPE = deps.POPUP_TYPE;
    const POPUP_RESULT = deps.POPUP_RESULT;
    const toastr = deps.toastr ?? globalThis.toastr;
    const eventSource = deps.eventSource;
    const event_types = deps.event_types;
    const getT = typeof deps.getT === 'function' ? deps.getT : null;
    const getRollsVersion = typeof deps.getRollsVersion === 'function' ? deps.getRollsVersion : null;
    const getFcMissState = typeof deps.getFcMissState === 'function' ? deps.getFcMissState : null;
    const resetFcMisses = typeof deps.resetFcMisses === 'function' ? deps.resetFcMisses : null;

    const documentRef = () => deps.document ?? globalThis.document;

    const t = (key, params) => {
        if (getT) return getT()(key, params);
        let value = String(key);
        if (params) for (const [name, replacement] of Object.entries(params)) value = value.replaceAll(`{${name}}`, String(replacement));
        return value;
    };

    /* Open-popup region refs (all null while the popup is closed). */
    let ui = null;
    const dwHubFilter = { text: '', character: '', outcome: '', source: '' };
    let listLimit = LIST_PAGE;

    function dwHubMakeEl(tag, className = '', text = null) {
        const node = documentRef().createElement(tag);
        if (className) node.className = className;
        if (text !== null && text !== undefined) node.textContent = String(text);
        return node;
    }

    function dwHubMakeChip(text, className = '') {
        return dwHubMakeEl('span', `dw-hub-chip${className ? ` ${className}` : ''}`, text);
    }

    function iconEl(faClass) {
        const icon = dwHubMakeEl('i', `fa-solid ${faClass}`);
        icon.setAttribute('aria-hidden', 'true');
        return icon;
    }

    function makeButton(className, { icon = '', label = '', title = '' } = {}) {
        const button = dwHubMakeEl('button', `menu_button ${className}`);
        button.type = 'button';
        if (icon) button.append(iconEl(icon));
        if (label) button.append(dwHubMakeEl('span', '', label));
        if (title) {
            button.title = title;
            if (!label) button.setAttribute('aria-label', title);
        }
        return button;
    }

    function makeSelect(className, ariaLabel, options, value) {
        const select = documentRef().createElement('select');
        select.className = `text_pole ${className}`;
        select.setAttribute('aria-label', ariaLabel);
        for (const [optionValue, label] of options) {
            const option = documentRef().createElement('option');
            option.value = optionValue;
            option.textContent = label;
            select.append(option);
        }
        select.value = value;
        return select;
    }

    function dwHubOutcomeLabel(outcome) {
        switch (outcome) {
            case 'crit': return t('outcomeCrit');
            case 'critfail': return t('outcomeCritfail');
            case 'success': return t('outcomeSuccess');
            default: return t('outcomeFail');
        }
    }

    function dwHubOutcomeClass(outcome) {
        if (outcome === 'crit') return 'dw-hub-crit';
        if (outcome === 'fail' || outcome === 'critfail') return 'dw-hub-bad';
        return 'dw-hub-good';
    }

    function dwHubSourceLabel(source) {
        switch (source) {
            case 'fc': return t('sourceFc');
            case 'tag': return t('sourceTag');
            case 'manual': return t('sourceManual');
            case 'preview': return t('sourcePreview');
            case 'api': return t('sourceApi');
            default: return String(source ?? t('sourceOther'));
        }
    }

    /* Perf: a full-chat roll collection runs on every badge/sync event — cache
       by (chatId, rollsVersion). rolls.js bumps the version on every mutation,
       and a chat switch changes the chatId, so both invalidation paths are
       covered without callbacks. */
    let hubCache = { chatId: undefined, version: -1, items: [] };

    function dwHubCollectRolls() {
        const context = getContext();
        const chatId = context?.chatId ?? null;
        const version = getRollsVersion ? getRollsVersion() : 0;
        if (hubCache.chatId === chatId && hubCache.version === version) return hubCache.items;
        const chat = Array.isArray(context.chat) ? context.chat : [];
        const items = [];
        chat.forEach((mes, messageId) => {
            const rolls = Array.isArray(mes?.extra?.diceRolls) ? mes.extra.diceRolls : [];
            for (const raw of rolls) {
                const roll = normalizeStoredRoll(raw);
                if (roll?.id) items.push({ messageId, roll });
            }
        });
        items.reverse();
        hubCache = { chatId, version, items };
        return items;
    }

    /* Pure stats over the collected items (exported for tests). Success rate
       counts CHECKS only — damage rolls have no DC and always "succeed". The
       d20 average uses only single-d20 rolls (the kept die). */
    function computeStats(items) {
        let checks = 0;
        let wins = 0;
        let nat20 = 0;
        let nat1 = 0;
        let d20Sum = 0;
        let d20Count = 0;
        for (const { roll } of items) {
            if (roll.outcome === 'crit') nat20++;
            if (roll.outcome === 'critfail') nat1++;
            if (roll.kind !== 'damage' && roll.dc != null) {
                checks++;
                if (roll.outcome === 'success' || roll.outcome === 'crit') wins++;
            }
            if (isCritEligible(roll.roll_type, roll.adv) && Number.isFinite(roll.natural)) {
                d20Sum += roll.natural;
                d20Count++;
            }
        }
        return {
            total: items.length,
            successRate: checks ? Math.round((wins / checks) * 100) : null,
            nat20,
            nat1,
            avgD20: d20Count ? Math.round((d20Sum / d20Count) * 10) / 10 : null,
        };
    }

    function dwHubModeNote() {
        const settings = getSettings();
        if (!settings.enabled) return t('noteDisabled');
        const notes = [];
        if (settings.mode === 'tag_only') {
            notes.push(t('noteTagMode'));
        } else if (settings.mode === 'fc_only') {
            notes.push(toolSupported() ? t('noteFc') : t('noteFcNoTool'));
        } else {
            notes.push(toolSupported() ? t('noteAuto', { threshold: getFcMissState ? getFcMissState().threshold : 3 }) : t('noteAutoNoTool'));
        }
        const trigger = String(getCharSettings(getActiveCharName()).trigger ?? '').trim();
        if (trigger) notes.push(t('noteTrigger', { trigger }));
        return notes.join(' ');
    }

    /* ---------------------------------------------------------------------------
     * Send-form button
     * ------------------------------------------------------------------------- */

    function updateDwHubBadge() {
        const button = documentRef().getElementById('dw_button');
        if (!button) return;

        const settings = getSettings();
        const count = dwHubCollectRolls().length;
        const functional = settings.enabled && (settings.mode === 'tag_only' || toolSupported());
        const degraded = settings.enabled && settings.mode === 'fc_only' && !toolSupported();

        const badge = button.querySelector('.dw-sendform-badge');
        if (badge) badge.textContent = String(count);

        button.classList.toggle('dw-ready', functional && !degraded);
        button.classList.toggle('dw-off', !settings.enabled);
        button.classList.toggle('dw-warn', degraded);
        button.title = !settings.enabled ? t('hubOffTitle') : t('hubTitle', { count });
        button.setAttribute('aria-label', t('hubAria'));
    }

    function ensureDwHubButton() {
        const sendForm = documentRef().querySelector('#send_form');
        if (!sendForm) return false;

        let button = documentRef().getElementById('dw_button');
        if (!button) {
            button = documentRef().createElement('div');
            button.id = 'dw_button';
            button.className = 'menu_button dw-sendform-btn';
            button.tabIndex = 0;
            button.setAttribute('role', 'button');
            button.setAttribute('aria-label', t('hubAria'));
            const label = dwHubMakeEl('span', 'dw-sendform-label', 'Dice Weaver');
            const badge = dwHubMakeEl('span', 'dw-sendform-badge');
            badge.setAttribute('aria-live', 'polite');
            button.append(iconEl('fa-dice-d20'), label, badge);
            button.addEventListener('click', () => showDwHubPopup());
            button.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    showDwHubPopup();
                }
            });
        }

        const anchor = documentRef().getElementById('character-state-button');
        if (anchor && anchor.parentElement === sendForm) {
            if (anchor.nextElementSibling !== button) anchor.after(button);
        } else if (button.parentElement !== sendForm) {
            sendForm.prepend(button);
        }

        updateDwHubBadge();
        /* P0-6: success = the button is anchored in the send form — NOT whether
           the (optional) character-state anchor exists. */
        return button.parentElement === sendForm;
    }

    function initDwHubButton() {
        let attempts = 0;
        const tryAdd = () => {
            if (ensureDwHubButton() || ++attempts >= 40) return;
            setTimeout(tryAdd, 250);
        };
        tryAdd();
    }

    /* ---------------------------------------------------------------------------
     * Regions
     * ------------------------------------------------------------------------- */

    function buildHeader() {
        const settings = getSettings();
        const header = dwHubMakeEl('div', 'dw-hub-hero');
        const icon = dwHubMakeEl('div', 'dw-hub-hero-icon');
        icon.append(iconEl('fa-dice-d20'));

        const main = dwHubMakeEl('div', 'dw-hub-hero-main');
        main.append(
            dwHubMakeEl('div', 'dw-hub-hero-title', 'Dice Weaver'),
            dwHubMakeEl('div', 'dw-hub-hero-sub', dwHubModeNote()),
        );

        const modeLabel = settings.mode === 'auto' ? t('chipModeAuto') : settings.mode === 'fc_only' ? t('sourceFc') : settings.mode === 'tag_only' ? t('sourceTag') : String(settings.mode);
        const chips = dwHubMakeEl('div', 'dw-hub-hero-chips');
        chips.append(
            dwHubMakeChip(settings.enabled ? t('chipOn') : t('chipOff'), settings.enabled ? 'dw-hub-chip-good' : 'dw-hub-chip-bad'),
            dwHubMakeChip(modeLabel, 'dw-hub-chip-info'),
            dwHubMakeChip(toolSupported() ? t('chipFcOk') : t('chipFcNo'), toolSupported() ? 'dw-hub-chip-good' : 'dw-hub-chip-muted'),
        );
        /* Make the FC→tag fallback VISIBLE, with a one-click reset. */
        if (getFcMissState && getFcMissState().fallbackActive) {
            chips.append(dwHubMakeChip(t('chipFallback'), 'dw-hub-chip-bad'));
            if (resetFcMisses) {
                const resetBtn = makeButton('dw-hub-chip dw-hub-chip-info dw-hub-reset-fc', { label: t('chipFallbackReset'), title: t('chipFallbackResetTitle') });
                resetBtn.addEventListener('click', () => {
                    resetFcMisses();
                    refreshRegions();
                });
                chips.append(resetBtn);
            }
        }

        header.append(icon, main, chips);
        return header;
    }

    function makeStat(value, label, className = '') {
        const card = dwHubMakeEl('div', `dw-hub-stat${className ? ` ${className}` : ''}`);
        card.append(dwHubMakeEl('div', 'dw-hub-stat-value', value), dwHubMakeEl('div', 'dw-hub-stat-label', label));
        return card;
    }

    function buildStats() {
        const stats = computeStats(dwHubCollectRolls());
        const grid = dwHubMakeEl('div', 'dw-hub-stats');
        grid.append(
            makeStat(stats.total, t('statRolls')),
            makeStat(stats.successRate == null ? '—' : `${stats.successRate}%`, t('statSuccessRate'), 'dw-hub-stat-good'),
            makeStat(stats.nat20, t('statNat20'), 'dw-hub-stat-crit'),
            makeStat(stats.nat1, t('statNat1'), 'dw-hub-stat-bad'),
            makeStat(stats.avgD20 == null ? '—' : stats.avgD20.toFixed(1), t('statAvgD20')),
        );
        return grid;
    }

    function rollCharacterNames() {
        return [...new Set(dwHubCollectRolls().map(({ roll }) => String(roll.character ?? '').trim()).filter(Boolean))].sort();
    }

    function fillCharacterFilter(select) {
        const names = rollCharacterNames();
        const current = dwHubFilter.character;
        select.replaceChildren();
        for (const name of ['', ...names]) {
            const option = documentRef().createElement('option');
            option.value = name;
            option.textContent = name || t('allCharacters');
            select.append(option);
        }
        select.value = names.includes(current) ? current : '';
        dwHubFilter.character = select.value;
    }

    function fillNameDatalist(datalist) {
        const names = new Set(rollCharacterNames());
        const active = String(getActiveCharName() ?? '').trim();
        if (active) names.add(active);
        const userName = String(getContext()?.name1 ?? '').trim();
        if (userName) names.add(userName);
        datalist.replaceChildren(...[...names].sort().map(name => {
            const option = documentRef().createElement('option');
            option.value = name;
            return option;
        }));
    }

    /* ---------------------------------------------------------------------------
     * Quick roll (static region — survives every refresh)
     * ------------------------------------------------------------------------- */

    function attachToLastAiMessage(payload) {
        const context = getContext();
        for (let i = context.chat.length - 1; i >= 0; i--) {
            const mes = context.chat[i];
            if (mes && !mes.is_user && !mes.is_system) {
                insertRoll(i, payload);
                return true;
            }
        }
        return false;
    }

    function buildQuickRoll() {
        const section = dwHubMakeEl('div', 'dw-hub-card dw-hub-quick');
        section.append(dwHubMakeEl('div', 'dw-hub-section-title', t('quickTitle')));

        const datalistId = 'dw_hub_names';
        const datalist = documentRef().createElement('datalist');
        datalist.id = datalistId;

        const name = dwHubMakeEl('input', 'text_pole dw-hub-q-name');
        name.type = 'text';
        name.setAttribute('list', datalistId);
        name.placeholder = String(getActiveCharName() ?? '').trim() || t('quickName');
        name.setAttribute('aria-label', t('quickName'));
        name.title = t('manualName');
        name.spellcheck = false;

        const action = dwHubMakeEl('input', 'text_pole dw-hub-q-action');
        action.type = 'text';
        action.placeholder = t('quickAction');
        action.setAttribute('aria-label', t('quickAction'));

        const formula = dwHubMakeEl('input', 'text_pole dw-hub-q-formula');
        formula.type = 'text';
        formula.placeholder = '1d20';
        formula.setAttribute('aria-label', t('manualFormula'));
        formula.title = t('manualFormula');
        formula.spellcheck = false;

        const dc = dwHubMakeEl('input', 'text_pole dw-hub-q-dc');
        dc.type = 'number';
        dc.min = '0';
        dc.max = '99';
        dc.step = '1';
        dc.placeholder = t('manualDc');
        dc.setAttribute('aria-label', t('manualDc'));

        const adv = makeSelect('dw-hub-q-adv', t('manualAdvNone'), [['', t('manualAdvNone')], ['adv', t('manualAdv')], ['dis', t('manualDis')], ['advp', t('manualAdvp')], ['disp', t('manualDisp')]], '');

        const fire = makeButton('dw-hub-btn dw-hub-btn-primary', { icon: 'fa-dice-d20', label: t('manualFire') });
        const error = dwHubMakeEl('div', 'dw-hub-q-error');
        error.setAttribute('role', 'alert');
        const hint = dwHubMakeEl('div', 'dw-hub-q-hint', t('quickHint'));

        formula.addEventListener('input', () => {
            error.textContent = '';
            formula.removeAttribute('aria-invalid');
        });

        const doRoll = async () => {
            const formulaText = formula.value.trim();
            const parsedFormula = formulaText ? parseFormulaLine(formulaText) : null;
            if (formulaText && !parsedFormula) {
                error.textContent = t('quickInvalid');
                formula.setAttribute('aria-invalid', 'true');
                formula.focus();
                return;
            }
            const charName = name.value.trim() || String(getActiveCharName() ?? '').trim();
            const charSettings = getCharSettings(charName);
            /* Blank DC = inherit the character default; typed 0 stays valid. */
            const rawDc = String(dc.value ?? '').trim();
            const dcValue = rawDc === '' ? NaN : Number(rawDc);
            const finalDc = Number.isFinite(dcValue) ? Math.max(0, Math.min(99, Math.round(dcValue))) : charSettings.dc_default;
            const rollType = parsedFormula ? parsedFormula.rollType : 'd20';
            const result = performRoll({
                statValue: 0,
                hasStat: false,
                dc: finalDc,
                adv: adv.value,
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
                action: action.value.trim() || t('manualAction'),
                note: '',
                stat_label: '',
                stat_value: 0,
                adv: adv.value,
                dc: finalDc,
                roll_type: rollType,
                formula_text: parsedFormula ? parsedFormula.text : '',
                source: 'manual',
                ...result,
            });
            if (!attachToLastAiMessage(payload)) await pushSystemRollMessage([payload]);
            action.value = '';
            toastr.success(t('manualDone', { rollType, total: result.total, outcome: dwHubOutcomeLabel(result.outcome) }), 'Dice Weaver');
            refreshRegions();
        };

        fire.addEventListener('click', doRoll);
        for (const input of [name, action, formula, dc]) {
            input.addEventListener('keydown', event => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    doRoll();
                }
            });
        }

        const rowA = dwHubMakeEl('div', 'dw-hub-q-row');
        rowA.append(name, action);
        const rowB = dwHubMakeEl('div', 'dw-hub-q-row');
        rowB.append(formula, dc, adv, fire);
        section.append(rowA, rowB, error, hint, datalist);
        return { section, datalist };
    }

    /* ---------------------------------------------------------------------------
     * Filter bar (static region — only the character options refresh)
     * ------------------------------------------------------------------------- */

    function buildFilterBar() {
        const bar = dwHubMakeEl('div', 'dw-hub-toolbar');

        const search = dwHubMakeEl('input', 'text_pole dw-hub-search');
        search.type = 'search';
        search.placeholder = t('searchPlaceholder');
        search.setAttribute('aria-label', t('searchAria'));
        search.value = dwHubFilter.text;
        search.addEventListener('input', () => {
            dwHubFilter.text = search.value;
            listLimit = LIST_PAGE;
            refreshList({ keepScroll: false });
        });

        const characterSelect = makeSelect('dw-hub-char-filter', t('allCharacters'), [], '');
        fillCharacterFilter(characterSelect);
        const outcomeSelect = makeSelect('dw-hub-outcome-filter', t('allOutcomes'), [['', t('allOutcomes')], ['crit', t('outcomeCrit')], ['success', t('outcomeSuccess')], ['fail', t('outcomeFail')], ['critfail', t('outcomeCritfail')]], dwHubFilter.outcome);
        const sourceSelect = makeSelect('dw-hub-source-filter', t('allSources'), [['', t('allSources')], ['fc', t('sourceFc')], ['tag', t('sourceTag')], ['manual', t('sourceManual')], ['api', t('sourceApi')]], dwHubFilter.source);

        for (const [select, key] of [[characterSelect, 'character'], [outcomeSelect, 'outcome'], [sourceSelect, 'source']]) {
            select.addEventListener('change', () => {
                dwHubFilter[key] = select.value;
                listLimit = LIST_PAGE;
                refreshList({ keepScroll: false });
            });
        }

        const count = dwHubMakeEl('div', 'dw-hub-list-count');
        count.setAttribute('aria-live', 'polite');
        bar.append(search, characterSelect, outcomeSelect, sourceSelect, count);
        return { bar, characterSelect, count };
    }

    function dwHubMatchesFilter(item) {
        const roll = item.roll;
        if (dwHubFilter.character && String(roll.character ?? '').trim() !== dwHubFilter.character) return false;
        if (dwHubFilter.outcome && roll.outcome !== dwHubFilter.outcome) return false;
        if (dwHubFilter.source && roll.source !== dwHubFilter.source) return false;
        const query = dwHubFilter.text.trim().toLowerCase();
        if (!query) return true;
        const haystack = [
            roll.character,
            roll.action,
            roll.note,
            roll.formula_text,
            roll.roll_type,
            roll.stat_label,
            dwHubOutcomeLabel(roll.outcome),
        ].map(value => String(value ?? '').toLowerCase());
        return haystack.some(value => value.includes(query));
    }

    function dwHubRelativeTime(ts) {
        const value = Number(ts);
        if (!Number.isFinite(value) || value <= 0) return '';
        const seconds = Math.max(0, Math.floor((Date.now() - value) / 1000));
        if (seconds < 60) return t('relNow');
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return t('relMinutes', { n: minutes });
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return t('relHours', { n: hours });
        return t('relDays', { n: Math.floor(hours / 24) });
    }

    /* Jump: close the popup (it covers the chat), then scroll + flash the
       message. Lazy-loaded chats may not have the message in the DOM yet. */
    function jumpToMessage(messageId) {
        const target = documentRef().querySelector(`#chat .mes[mesid="${messageId}"]`);
        if (!target) {
            toastr.info(t('jumpMissing', { n: messageId + 1 }), 'Dice Weaver');
            return;
        }
        const dialog = ui?.root?.closest?.('.popup');
        dialog?.querySelector?.('.popup-button-ok')?.click();
        setTimeout(() => {
            const smooth = !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
            target.scrollIntoView?.({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
            target.classList.remove('dw-flash');
            void target.offsetWidth;
            target.classList.add('dw-flash');
            setTimeout(() => target.classList.remove('dw-flash'), 1800);
        }, 60);
    }

    function buildDwHubRow(item) {
        const { messageId, roll } = item;
        const row = dwHubMakeEl('div', `dw-hub-row ${dwHubOutcomeClass(roll.outcome)}`);

        const main = dwHubMakeEl('div', 'dw-hub-row-main');
        main.tabIndex = 0;
        main.setAttribute('role', 'button');
        main.title = t('rowJumpTitle');
        const top = dwHubMakeEl('div', 'dw-hub-row-top');
        if (roll.character) top.append(dwHubMakeEl('span', 'dw-hub-row-chip', roll.character));
        top.append(dwHubMakeChip(dwHubOutcomeLabel(roll.outcome), 'dw-hub-chip-outcome'));
        top.append(dwHubMakeEl('span', 'dw-hub-row-total', `${roll.total}${roll.dc != null && roll.kind !== 'damage' ? ` / DC ${roll.dc}` : ''}`));
        top.append(dwHubMakeEl('span', 'dw-hub-row-source', dwHubSourceLabel(roll.source)));

        const action = String(roll.action ?? '').trim() || t('rowNoAction');
        main.append(top, dwHubMakeEl('div', 'dw-hub-row-action', action));

        const metaParts = [t('rowMessage', { n: messageId + 1 }), String(roll.formula_text || roll.roll_type || 'd20')];
        if (roll.adv) metaParts.push(roll.adv.toUpperCase());
        const relTime = dwHubRelativeTime(roll.ts);
        if (relTime) metaParts.push(relTime);
        main.append(dwHubMakeEl('div', 'dw-hub-row-meta', metaParts.join(' · ')));
        main.addEventListener('click', () => jumpToMessage(messageId));
        main.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                jumpToMessage(messageId);
            }
        });

        const actions = dwHubMakeEl('div', 'dw-hub-row-actions');
        if (roll.prev && typeof roll.prev === 'object') {
            const undo = makeButton('dw-hub-icon-btn', { icon: 'fa-rotate-left', title: t('rowUndoTitle') });
            undo.addEventListener('click', () => {
                if (undoReroll(messageId, roll.id)) toastr.info(t('rowUndone'), 'Dice Weaver');
                refreshRegions();
            });
            actions.append(undo);
        }
        const reroll = makeButton('dw-hub-icon-btn', { icon: 'fa-arrows-rotate', title: t('rowRerollTitle') });
        reroll.addEventListener('click', () => {
            rerollRoll(messageId, roll.id);
            refreshRegions();
        });
        const del = makeButton('dw-hub-icon-btn dw-hub-row-delete', { icon: 'fa-trash-can', title: t('rowDeleteTitle') });
        del.addEventListener('click', () => {
            if (deleteRoll(messageId, roll.id)) toastr.info(t('rowDeleted'), 'Dice Weaver');
            refreshRegions();
        });
        actions.append(reroll, del);

        row.append(main, actions);
        return row;
    }

    function buildEmptyState(hasAny) {
        const empty = dwHubMakeEl('div', 'dw-hub-empty');
        const icon = dwHubMakeEl('div', 'dw-hub-empty-icon');
        icon.append(iconEl('fa-dice-d20'));
        empty.append(
            icon,
            dwHubMakeEl('div', 'dw-hub-empty-title', hasAny ? t('emptyTitleFiltered') : t('emptyTitleEmpty')),
            dwHubMakeEl('div', 'dw-hub-empty-sub', hasAny ? t('emptySubFiltered') : t('emptySubEmpty')),
        );
        return empty;
    }

    function buildFooter() {
        const footer = dwHubMakeEl('div', 'dw-hub-footer');
        const left = dwHubMakeEl('div', 'dw-hub-footer-group');

        const rescan = makeButton('dw-hub-btn', { icon: 'fa-rotate', label: t('rescanBtn'), title: t('rescanTitle') });
        rescan.addEventListener('click', () => {
            renderAllRolls();
            toastr.info(t('rescanDone'), 'Dice Weaver');
        });

        const exportBtn = makeButton('dw-hub-btn', { icon: 'fa-file-export', label: t('exportBtn') });
        exportBtn.addEventListener('click', () => {
            const items = dwHubCollectRolls();
            const payload = {
                exportedAt: new Date().toISOString(),
                chatId: getContext().chatId ?? null,
                count: items.length,
                rolls: items.map(({ messageId, roll }) => ({ messageId, roll })),
            };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const anchor = documentRef().createElement('a');
            anchor.href = url;
            anchor.download = `diceweaver-rolls-${new Date().toISOString().slice(0, 10)}.json`;
            documentRef().body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            toastr.success(t('exportDone', { count: items.length }), 'Dice Weaver');
        });
        left.append(rescan, exportBtn);

        /* Destructive action kept apart from the harmless ones. */
        const clearAll = makeButton('dw-hub-btn dw-hub-danger', { icon: 'fa-trash-can', label: t('clearAllBtn'), title: t('clearAllTitle') });
        clearAll.addEventListener('click', async () => {
            const items = dwHubCollectRolls();
            if (!items.length) return;
            const confirmed = await callGenericPopup(t('clearAllConfirmTitle', { count: items.length }), POPUP_TYPE.CONFIRM, {
                text: t('clearAllConfirmText', { count: items.length }),
            });
            if (confirmed !== POPUP_RESULT.AFFIRMATIVE) return;
            let deleted = 0;
            for (const { messageId, roll } of [...items]) {
                if (deleteRoll(messageId, roll.id)) deleted++;
            }
            refreshRegions();
            toastr.success(t('clearAllDone', { count: deleted }), 'Dice Weaver');
        });

        footer.append(left, clearAll);
        return footer;
    }

    /* ---------------------------------------------------------------------------
     * Region refresh
     * ------------------------------------------------------------------------- */

    function swapRegion(key, builder) {
        if (!ui?.[key]?.isConnected) return;
        const fresh = builder();
        ui[key].replaceWith(fresh);
        ui[key] = fresh;
    }

    function refreshList({ keepScroll = true } = {}) {
        if (!ui?.list) return;
        const scrollTop = keepScroll ? ui.list.scrollTop : 0;
        const all = dwHubCollectRolls();
        const filtered = all.filter(dwHubMatchesFilter);
        ui.count.textContent = t('listCount', { filtered: filtered.length, all: all.length });

        const children = [];
        if (!filtered.length) {
            children.push(buildEmptyState(all.length > 0));
        } else {
            for (const item of filtered.slice(0, listLimit)) children.push(buildDwHubRow(item));
            if (filtered.length > listLimit) {
                const more = makeButton('dw-hub-btn dw-hub-more', { label: `+${filtered.length - listLimit}` });
                more.addEventListener('click', () => {
                    listLimit += LIST_PAGE;
                    refreshList();
                });
                children.push(more);
            }
        }
        ui.list.replaceChildren(...children);
        ui.list.scrollTop = scrollTop;
    }

    function refreshRegions() {
        updateDwHubBadge();
        if (!ui?.root?.isConnected) return;
        swapRegion('header', buildHeader);
        swapRegion('stats', buildStats);
        /* Re-filling a <select> the user is interacting with would close it. */
        if (documentRef().activeElement !== ui.characterSelect) fillCharacterFilter(ui.characterSelect);
        fillNameDatalist(ui.datalist);
        refreshList();
    }

    function renderDwHubPopup() {
        if (!ui?.root) return;
        const shell = dwHubMakeEl('div', 'dw-hub-shell');
        ui.header = buildHeader();
        ui.stats = buildStats();
        const quick = buildQuickRoll();
        ui.datalist = quick.datalist;
        fillNameDatalist(ui.datalist);
        const filter = buildFilterBar();
        ui.characterSelect = filter.characterSelect;
        ui.count = filter.count;

        const listCard = dwHubMakeEl('div', 'dw-hub-card dw-hub-list-card');
        listCard.append(dwHubMakeEl('div', 'dw-hub-section-title', t('listTitle')), filter.bar);
        ui.list = dwHubMakeEl('div', 'dw-hub-list');
        listCard.append(ui.list);

        shell.append(ui.header, ui.stats, quick.section, listCard, buildFooter(), dwHubMakeEl('div', 'dw-hub-footer-note', t('footerNote')));
        ui.root.replaceChildren(shell);
        refreshList({ keepScroll: false });
    }

    function showDwHubPopup() {
        if (ui?.root?.isConnected) {
            refreshRegions();
            return Promise.resolve();
        }

        const root = dwHubMakeEl('div', 'dw-hub-popup');
        root.id = 'dw_popup';
        ui = { root };
        listLimit = LIST_PAGE;
        renderDwHubPopup();

        return callGenericPopup(root, POPUP_TYPE.TEXT, '', {
            okButton: t('popupClose'),
            wide: true,
            large: true,
            allowVerticalScrolling: true,
            /* ST 1.18 blocks closing on ANY falsy return from onClosing — must
               return true after clearing dashboard references. */
            onClosing: () => {
                ui = null;
                return true;
            },
        });
    }

    /* Event sync: region refresh only — the quick-roll form, filter inputs,
       open selects and list scroll survive generations, swipes and edits. */
    function syncDwHub() {
        refreshRegions();
    }

    function init() {
        initDwHubButton();

        for (const eventName of [
            event_types.MESSAGE_RECEIVED,
            event_types.CHARACTER_MESSAGE_RENDERED,
            event_types.MESSAGE_SWIPED,
            event_types.MESSAGE_EDITED,
            event_types.MESSAGE_UPDATED,
            event_types.GENERATION_ENDED,
        ]) {
            eventSource.on(eventName, () => syncDwHub());
        }

        eventSource.on(event_types.CHAT_CHANGED, () => {
            ensureDwHubButton();
            syncDwHub();
        });
        eventSource.on(event_types.APP_READY, () => {
            ensureDwHubButton();
            syncDwHub();
        });
    }

    return {
        init,
        updateDwHubBadge,
        ensureDwHubButton,
        syncDwHub,
        showDwHubPopup,
        dwHubCollectRolls,
        dwHubOutcomeLabel,
        dwHubSourceLabel,
        computeStats,
    };
}
