/* Dice Weaver — Copyright (C) 2026 kdturtle — GPL-3.0, see LICENSE. */
/* Settings drawer + per-character fieldset (dependency-injected).
   createSettingsUI({ jquery, getSettings, saveSettingsDebounced, updateDirective,
   charKeyForName, getContext, performRoll, makeId, buildRollCard, getT, toastr?,
   onSettingsChanged? })

   v0.6.0 (local/DESIGN-v0.6.md §3.3): five collapsible groups (General · Roll
   rules · Forced trigger · AI integration · Per-character), live formula
   preview + validation, FC-fallback controls. Element ids are unchanged. */
import { evalModifierFormula, isValidModifierFormula } from './dice.js';

const OPEN_GROUPS_KEY = 'diceweaver.settings.openGroups';
const DEFAULT_OPEN = ['general', 'rules'];
const PREVIEW_STATS = [30, 50, 80];

export function createSettingsUI(deps) {
    const $ = deps.jquery;
    const getSettings = deps.getSettings;
    const saveSettingsDebounced = deps.saveSettingsDebounced;
    const updateDirective = deps.updateDirective;
    const charKeyForName = deps.charKeyForName;
    const getContext = deps.getContext;
    const performRoll = deps.performRoll;
    const makeId = deps.makeId;
    const buildRollCard = deps.buildRollCard;
    const getT = typeof deps.getT === 'function' ? deps.getT : null;
    const toastr = deps.toastr ?? globalThis.toastr;
    const onSettingsChanged = typeof deps.onSettingsChanged === 'function' ? deps.onSettingsChanged : () => {};

    const t = (key, params) => {
        if (getT) return getT()(key, params);
        let value = String(key);
        if (params) for (const [name, replacement] of Object.entries(params)) value = value.replaceAll(`{${name}}`, String(replacement));
        return value;
    };

    function escapeHtml(value) {
        return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
    }

    /* Per-viewer convenience only: which groups are expanded. */
    function readOpenGroups() {
        try {
            const raw = globalThis.localStorage?.getItem(OPEN_GROUPS_KEY);
            const parsed = raw ? JSON.parse(raw) : null;
            return Array.isArray(parsed) ? parsed : DEFAULT_OPEN;
        } catch {
            return DEFAULT_OPEN;
        }
    }

    function writeOpenGroups() {
        try {
            const open = $('#diceweaver-settings .dw-group[open]').map((_, node) => node.dataset.group).get();
            globalThis.localStorage?.setItem(OPEN_GROUPS_KEY, JSON.stringify(open));
        } catch {
            /* storage unavailable — groups just reset next load */
        }
    }

    function hasCharRules(name) {
        if (!name) return false;
        const chars = getSettings().characters ?? {};
        return Boolean(chars[charKeyForName(name)] || chars[name]);
    }

    function charOptionsHtml() {
        const characters = getContext().characters ?? [];
        return [`<option value="">${escapeHtml(t('charGlobal'))}</option>`]
            .concat(characters.map(entry => {
                const name = String(entry?.name ?? '');
                const mark = hasCharRules(name) ? ' ●' : '';
                return `<option value="${escapeHtml(name)}">${escapeHtml(name)}${mark}</option>`;
            }))
            .join('');
    }

    function refreshCharOptions() {
        const select = $('#dw_char_select');
        if (!select.length) return;
        const current = String(select.val() ?? '');
        select.empty().append(charOptionsHtml());
        if (current) select.val(current);
    }

    function triStateOptions(current) {
        return `
            <option value="" ${current == null ? 'selected' : ''}>${escapeHtml(t('inherit'))}</option>
            <option value="on" ${current === true ? 'selected' : ''}>${escapeHtml(t('on'))}</option>
            <option value="off" ${current === false ? 'selected' : ''}>${escapeHtml(t('off'))}</option>`;
    }

    function formulaPreviewText(formula) {
        if (!isValidModifierFormula(formula)) return { text: t('formulaInvalid'), invalid: true };
        const fmt = value => (value >= 0 ? `+${value}` : `−${Math.abs(value)}`);
        const [a, b, c] = PREVIEW_STATS;
        return {
            text: t('formulaPreview', {
                a, ma: fmt(evalModifierFormula(formula, a)),
                b, mb: fmt(evalModifierFormula(formula, b)),
                c, mc: fmt(evalModifierFormula(formula, c)),
            }),
            invalid: false,
        };
    }

    function renderFormulaPreview(inputSelector, previewSelector, fallbackFormula = null) {
        const raw = String($(inputSelector).val() ?? '').trim();
        const formula = raw || fallbackFormula || '0';
        const { text, invalid } = formulaPreviewText(formula);
        $(previewSelector).text(text).toggleClass('dw-invalid', invalid);
    }

    function group(id, title, body, openGroups) {
        return `
            <details class="dw-group" data-group="${id}" ${openGroups.includes(id) ? 'open' : ''}>
                <summary>${escapeHtml(title)}</summary>
                <div class="dw-group-body">${body}</div>
            </details>`;
    }

    function updateCharBadge() {
        const name = String($('#dw_char_select').val() ?? '');
        $('#dw_char_badge').text(hasCharRules(name) ? t('charHasRules') : '');
    }

    function addSettingsUI() {
        const settings = getSettings();
        const ladder = settings.dc_ladder ?? {};
        const openGroups = readOpenGroups();
        const threshold = Number.isFinite(Number(settings.fc_miss_threshold)) ? Math.max(1, Math.floor(Number(settings.fc_miss_threshold))) : 3;

        const general = `
            <label class="checkbox_label">
                <input id="dw_enabled" type="checkbox" ${settings.enabled ? 'checked' : ''}>
                <span>${t('settingsEnable')}</span>
            </label>
            <label for="dw_mode">${t('settingsMode')}</label>
            <select id="dw_mode" class="text_pole">
                <option value="auto" ${settings.mode === 'auto' ? 'selected' : ''}>${t('modeAuto')}</option>
                <option value="fc_only" ${settings.mode === 'fc_only' ? 'selected' : ''}>${t('modeFcOnly')}</option>
                <option value="tag_only" ${settings.mode === 'tag_only' ? 'selected' : ''}>${t('modeTagOnly')}</option>
            </select>
            <label for="dw_lang">${t('langLabel')}</label>
            <select id="dw_lang" class="text_pole">
                <option value="en" ${settings.lang === 'en' ? 'selected' : ''}>English</option>
                <option value="vi" ${settings.lang === 'vi' ? 'selected' : ''}>Tiếng Việt</option>
                <option value="auto" ${settings.lang === 'auto' ? 'selected' : ''}>${t('langAuto')}</option>
            </select>`;

        const rules = `
            <label for="dw_formula">${t('settingsFormula')}</label>
            <input id="dw_formula" class="text_pole" type="text" value="${escapeHtml(settings.formula)}" spellcheck="false">
            <small id="dw_formula_preview" class="dw-hint dw-formula-preview"></small>
            <label for="dw_dc">${t('settingsDc')}</label>
            <input id="dw_dc" class="text_pole dw-number" type="number" min="0" max="99" step="1" value="${escapeHtml(settings.dc_default)}">
            <span class="dw-field-label">${t('settingsLadder')}</span>
            <div class="dw-ladder-row">
                ${['easy', 'normal', 'hard', 'extreme'].map(rung => `
                <label for="dw_ladder_${rung}">${t(rung)}
                    <input id="dw_ladder_${rung}" class="text_pole" type="number" min="0" max="99" step="1" value="${escapeHtml(ladder[rung] ?? { easy: 5, normal: 10, hard: 15, extreme: 20 }[rung])}">
                </label>`).join('')}
            </div>
            <label class="checkbox_label">
                <input id="dw_crit20" type="checkbox" ${settings.crit20 ? 'checked' : ''}>
                <span>${t('crit20')}</span>
            </label>
            <label class="checkbox_label">
                <input id="dw_crit1" type="checkbox" ${settings.crit1 ? 'checked' : ''}>
                <span>${t('crit1')}</span>
            </label>
            <div class="dw-row">
                <button id="dw_preview_btn" class="menu_button" type="button"><i class="fa-solid fa-dice-d20"></i> ${t('testRoll')}</button>
            </div>
            <div id="dw_preview"></div>`;

        const trigger = `
            <label for="dw_trigger">${t('settingsTrigger')}</label>
            <input id="dw_trigger" class="text_pole" type="text" value="${escapeHtml(String(settings.trigger ?? ''))}" spellcheck="false">
            <small class="dw-hint">${t('settingsTriggerHint')}</small>
            <label for="dw_trigger_formula">${t('settingsTriggerFormula')}</label>
            <input id="dw_trigger_formula" class="text_pole" type="text" value="${escapeHtml(String(settings.trigger_formula ?? ''))}" spellcheck="false">
            <small class="dw-hint">${t('settingsTriggerFormulaHint')}</small>`;

        const ai = `
            <label class="checkbox_label">
                <input id="dw_feed" type="checkbox" ${settings.feed_results_to_ai ? 'checked' : ''}>
                <span>${t('feedGlobal')}</span>
            </label>
            <small class="dw-hint">${t('feedHint')}</small>
            <label class="checkbox_label">
                <input id="dw_fc_fallback" type="checkbox" ${settings.auto_fallback_to_tags !== false ? 'checked' : ''}>
                <span>${t('fcFallback')}</span>
            </label>
            <label for="dw_fc_threshold">${t('fcThreshold')}</label>
            <input id="dw_fc_threshold" class="text_pole dw-number" type="number" min="1" max="20" step="1" value="${threshold}">
            <small class="dw-hint">${t('fcFallbackHint')}</small>`;

        const chars = `
            <label for="dw_char_select">${t('charSelect')}<span id="dw_char_badge" class="dw-char-badge"></span></label>
            <select id="dw_char_select" class="text_pole">${charOptionsHtml()}</select>
            <div id="dw_char_fields" style="display: none;">
                <label for="dw_char_enabled">${t('charEnabled')}</label>
                <select id="dw_char_enabled" class="text_pole">${triStateOptions(undefined)}</select>
                <label for="dw_char_feed">${t('charFeed')}</label>
                <select id="dw_char_feed" class="text_pole">${triStateOptions(undefined)}</select>
                <label for="dw_char_formula">${t('charFormula')}</label>
                <input id="dw_char_formula" class="text_pole" type="text" spellcheck="false">
                <small id="dw_char_formula_preview" class="dw-hint dw-formula-preview"></small>
                <label for="dw_char_dc">${t('charDc')}</label>
                <input id="dw_char_dc" class="text_pole dw-number" type="number" min="0" max="99" step="1">
                <label for="dw_char_trigger">${t('charTrigger')}</label>
                <input id="dw_char_trigger" class="text_pole" type="text" spellcheck="false">
                <label for="dw_char_trigger_formula">${t('charTriggerFormula')}</label>
                <input id="dw_char_trigger_formula" class="text_pole" type="text" spellcheck="false">
                <label for="dw_char_crit20">${t('crit20')}</label>
                <select id="dw_char_crit20" class="text_pole">${triStateOptions(undefined)}</select>
                <label for="dw_char_crit1">${t('crit1')}</label>
                <select id="dw_char_crit1" class="text_pole">${triStateOptions(undefined)}</select>
                <div class="dw-row">
                    <button id="dw_char_save" class="menu_button" type="button"><i class="fa-solid fa-floppy-disk"></i> ${t('charSave')}</button>
                    <button id="dw_char_delete" class="menu_button" type="button"><i class="fa-solid fa-trash-can"></i> ${t('charDelete')}</button>
                </div>
            </div>`;

        const html = `
        <div id="diceweaver-settings" class="extension_settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b><i class="fa-solid fa-dice-d20"></i> Dice Weaver</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    ${group('general', t('groupGeneral'), general, openGroups)}
                    ${group('rules', t('groupRules'), rules, openGroups)}
                    ${group('trigger', t('groupTrigger'), trigger, openGroups)}
                    ${group('ai', t('groupAi'), ai, openGroups)}
                    ${group('chars', t('groupChars'), chars, openGroups)}
                </div>
            </div>
        </div>`;
        const existing = $('#diceweaver-settings');
        if (existing.length) existing.replaceWith(html);
        else $('#extensions_settings2').append(html);
        renderFormulaPreview('#dw_formula', '#dw_formula_preview');

        $('#diceweaver-settings .dw-group').on('toggle', writeOpenGroups);

        const changed = () => {
            saveSettingsDebounced();
            updateDirective();
            onSettingsChanged();
        };

        $('#dw_enabled').on('change', function () {
            getSettings().enabled = Boolean($(this).prop('checked'));
            changed();
        });
        $('#dw_mode').on('change', function () {
            getSettings().mode = String($(this).val());
            changed();
        });
        $('#dw_lang').on('change', function () {
            getSettings().lang = String($(this).val());
            saveSettingsDebounced();
            /* Rebuild this drawer in place so labels switch immediately (the
               outer drawer stays open: replaceWith keeps its position). */
            addSettingsUI();
            $('#diceweaver-settings .inline-drawer-content').show();
            $('#diceweaver-settings .inline-drawer-icon').removeClass('down').addClass('up');
            onSettingsChanged();
        });
        $('#dw_formula').on('input', function () {
            getSettings().formula = String($(this).val());
            renderFormulaPreview('#dw_formula', '#dw_formula_preview');
            saveSettingsDebounced();
        });
        $('#dw_dc').on('input', function () {
            const raw = String($(this).val()).trim();
            /* Empty input = "leave as is" (Number('') === 0 would set DC 0). */
            if (!raw) return;
            const value = Number(raw);
            if (Number.isFinite(value)) {
                getSettings().dc_default = Math.max(0, Math.min(99, Math.round(value)));
                saveSettingsDebounced();
            }
        });
        for (const rung of ['easy', 'normal', 'hard', 'extreme']) {
            $(`#dw_ladder_${rung}`).on('input', function () {
                const raw = String($(this).val()).trim();
                if (!raw) return;
                const value = Number(raw);
                if (!Number.isFinite(value)) return;
                const current = getSettings();
                current.dc_ladder = current.dc_ladder && typeof current.dc_ladder === 'object' ? current.dc_ladder : {};
                current.dc_ladder[rung] = Math.max(0, Math.min(99, Math.round(value)));
                saveSettingsDebounced();
            });
        }
        $('#dw_trigger').on('input', function () {
            getSettings().trigger = String($(this).val());
            saveSettingsDebounced();
        });
        $('#dw_trigger_formula').on('input', function () {
            getSettings().trigger_formula = String($(this).val());
            saveSettingsDebounced();
        });
        $('#dw_crit20').on('change', function () {
            getSettings().crit20 = Boolean($(this).prop('checked'));
            saveSettingsDebounced();
        });
        $('#dw_crit1').on('change', function () {
            getSettings().crit1 = Boolean($(this).prop('checked'));
            saveSettingsDebounced();
        });
        $('#dw_feed').on('change', function () {
            getSettings().feed_results_to_ai = Boolean($(this).prop('checked'));
            saveSettingsDebounced();
        });
        $('#dw_fc_fallback').on('change', function () {
            getSettings().auto_fallback_to_tags = Boolean($(this).prop('checked'));
            changed();
        });
        $('#dw_fc_threshold').on('input', function () {
            const value = Number(String($(this).val()).trim());
            if (!Number.isFinite(value) || value < 1) return;
            getSettings().fc_miss_threshold = Math.min(20, Math.floor(value));
            changed();
        });

        /* Per-character rules -------------------------------------------- */
        $('#dw_char_select').on('focus', refreshCharOptions);
        $('#dw_char_select').on('change', () => {
            const name = String($('#dw_char_select').val());
            $('#dw_char_fields').toggle(Boolean(name));
            updateCharBadge();
            if (!name) return;
            const key = charKeyForName(name);
            const entry = getSettings().characters?.[key] ?? getSettings().characters?.[name] ?? {};
            $('#dw_char_enabled').val(entry.enabled == null ? '' : entry.enabled ? 'on' : 'off');
            $('#dw_char_feed').val(entry.feed_results_to_ai == null ? '' : entry.feed_results_to_ai ? 'on' : 'off');
            $('#dw_char_formula').val(entry.formula ?? '').attr('placeholder', getSettings().formula);
            $('#dw_char_dc').val(entry.dc_default ?? '').attr('placeholder', getSettings().dc_default);
            $('#dw_char_trigger').val(entry.trigger ?? '');
            $('#dw_char_trigger_formula').val(entry.trigger_formula ?? '');
            $('#dw_char_crit20').val(entry.crit20 == null ? '' : entry.crit20 ? 'on' : 'off');
            $('#dw_char_crit1').val(entry.crit1 == null ? '' : entry.crit1 ? 'on' : 'off');
            renderFormulaPreview('#dw_char_formula', '#dw_char_formula_preview', getSettings().formula);
        });
        $('#dw_char_formula').on('input', () => renderFormulaPreview('#dw_char_formula', '#dw_char_formula_preview', getSettings().formula));
        $('#dw_char_save').on('click', () => {
            const name = String($('#dw_char_select').val());
            if (!name) return;
            const settings = getSettings();
            settings.characters = settings.characters ?? {};
            const key = charKeyForName(name);
            /* Keep fields this UI does not edit (e.g. a hand-set dc_ladder). */
            const previous = settings.characters[key] ?? settings.characters[name] ?? {};
            const entry = previous.dc_ladder ? { dc_ladder: previous.dc_ladder } : {};
            const formula = String($('#dw_char_formula').val()).trim();
            if (formula) entry.formula = formula;
            /* Empty DC = inherit (getCharSettings treats null/'' as inherit). */
            const dcRaw = String($('#dw_char_dc').val()).trim();
            if (dcRaw) {
                const dc = Number(dcRaw);
                if (Number.isFinite(dc)) entry.dc_default = Math.max(0, Math.min(99, Math.round(dc)));
            }
            const charEnabled = String($('#dw_char_enabled').val());
            if (charEnabled) entry.enabled = charEnabled === 'on';
            const charFeed = String($('#dw_char_feed').val());
            if (charFeed) entry.feed_results_to_ai = charFeed === 'on';
            entry.trigger = String($('#dw_char_trigger').val());
            entry.trigger_formula = String($('#dw_char_trigger_formula').val());
            const crit20 = String($('#dw_char_crit20').val());
            if (crit20) entry.crit20 = crit20 === 'on';
            const crit1 = String($('#dw_char_crit1').val());
            if (crit1) entry.crit1 = crit1 === 'on';
            if (key !== name) delete settings.characters[name];
            settings.characters[key] = entry;
            saveSettingsDebounced();
            updateDirective();
            refreshCharOptions();
            updateCharBadge();
            onSettingsChanged();
            toastr.success(t('charSaved', { name }));
        });
        $('#dw_char_delete').on('click', () => {
            const name = String($('#dw_char_select').val());
            if (!name) return;
            const settings = getSettings();
            const key = charKeyForName(name);
            if (settings.characters?.[key] || settings.characters?.[name]) {
                delete settings.characters[key];
                delete settings.characters[name];
                saveSettingsDebounced();
                updateDirective();
                onSettingsChanged();
                toastr.success(t('charDeleted', { name }));
            }
            refreshCharOptions();
            $('#dw_char_select').trigger('change');
        });

        $('#dw_preview_btn').on('click', () => {
            const settings = getSettings();
            const result = performRoll({
                statValue: 65,
                dc: settings.dc_default,
                rollType: 'd20',
                formula: settings.formula,
                crit20: settings.crit20,
                crit1: settings.crit1,
            });
            const roll = {
                id: makeId(),
                character: 'Alice',
                action: 'flip a heavy crate across the stone floor',
                note: 'heavy load',
                stat_label: 'STR 65',
                stat_value: 65,
                adv: '',
                dc: settings.dc_default,
                kind: 'check',
                roll_type: 'd20',
                formula_text: '',
                source: 'preview',
                ...result,
            };
            $('#dw_preview').empty().append(buildRollCard(roll, { fresh: true }));
        });
    }

    return { addSettingsUI, refreshCharOptions, escapeHtml };
}
