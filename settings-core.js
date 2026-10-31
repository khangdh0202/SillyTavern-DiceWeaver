/* Pure settings layer — no SillyTavern imports, node-testable.
   index.js wraps these with live state (extension_settings + getContext). */

export const DEFAULT_SETTINGS = {
    enabled: true,
    mode: 'auto',
    formula: 'round(({stat}-50)/15)',
    crit20: true,
    crit1: true,
    dc_default: 10,
    trigger: '',
    trigger_formula: '',
    characters: {},
    /* v0.5.0 P1: FC-miss tracking + tag fallback */
    fc_miss_threshold: 3,
    auto_fallback_to_tags: true,
    /* v0.5.0 D1: roll results → AI context (opt-in, OFF by default) */
    feed_results_to_ai: false,
    /* v0.5.0 Phase 5: named DC ladder for tag attr / tool dc="hard" */
    dc_ladder: { easy: 5, normal: 10, hard: 15, extreme: 20 },
    /* UI language: English by default (v0.6.0); 'vi' or 'auto' (follow the
       SillyTavern locale) are opt-in from the settings drawer. */
    lang: 'en',
};

function cloneDefault(value) {
    return (value !== null && typeof value === 'object') ? structuredClone(value) : value;
}

/* Mutate-in-place: the stored settings object KEEPS its identity across calls
   (callers hold references; reassigning extension_settings[moduleName] on
   every getSettings() silently orphaned them). Nested defaults (characters)
   are cloned, never aliased — mutating one character rule must not touch
   DEFAULT_SETTINGS. */
export function getSettingsFrom(extensionSettings, moduleName) {
    const existing = extensionSettings[moduleName];
    if (existing && typeof existing === 'object') {
        for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
            if (existing[key] === undefined) existing[key] = cloneDefault(value);
        }
        if (!existing.characters || typeof existing.characters !== 'object' || existing.characters === DEFAULT_SETTINGS.characters) {
            existing.characters = cloneDefault(DEFAULT_SETTINGS.characters);
        }
        return existing;
    }
    const fresh = {};
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) fresh[key] = cloneDefault(value);
    extensionSettings[moduleName] = fresh;
    return fresh;
}

export function charKeyFor(context, name) {
    if (!name) return '';
    const entry = (context?.characters ?? []).find(item => String(item?.name ?? '') === name);
    return entry?.avatar ?? name;
}

export function getCharSettingsFrom(settings, resolveKey, name) {
    const chars = settings.characters ?? {};
    const key = name ? resolveKey(name) : '';
    const entry = (key && chars[key]) ? chars[key] : (name ? (chars[name] ?? {}) : {});
    const pick = (value, fallback) => (value == null || value === '') ? fallback : value;
    return {
        formula: pick(entry.formula, settings.formula),
        dc_default: pick(entry.dc_default, settings.dc_default),
        crit20: entry.crit20 ?? settings.crit20,
        crit1: entry.crit1 ?? settings.crit1,
        trigger: pick(entry.trigger, settings.trigger),
        trigger_formula: pick(entry.trigger_formula, settings.trigger_formula),
        /* Tri-state: undefined/absent = inherit (treated as enabled), true, false. */
        enabled: entry.enabled,
        /* Feed override: undefined = inherit from global. */
        feed_results_to_ai: entry.feed_results_to_ai ?? settings.feed_results_to_ai,
        /* Ladder inherits as a WHOLE object (per-entry override not supported). */
        dc_ladder: (entry.dc_ladder && typeof entry.dc_ladder === 'object') ? entry.dc_ladder : settings.dc_ladder,
    };
}

export function migrateCharSettings(settings, context, onSave) {
    const chars = settings.characters;
    if (!chars || typeof chars !== 'object') return;
    const list = Array.isArray(context?.characters) ? context.characters : [];
    for (const entry of list) {
        const name = String(entry?.name ?? '');
        const avatar = String(entry?.avatar ?? '');
        if (!name || !avatar) continue;
        if (Object.prototype.hasOwnProperty.call(chars, name) && !Object.prototype.hasOwnProperty.call(chars, avatar)) {
            chars[avatar] = chars[name];
            delete chars[name];
            if (typeof onSave === 'function') onSave();
        }
    }
}
