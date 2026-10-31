/* Roll results → AI context (opt-in, DEFAULT OFF — decision D1).
   Dependency-injected, node-testable. A short SYSTEM extension prompt carries
   up to 3 not-yet-seen roll outcomes into the NEXT generation; nothing is
   written into message text, and each injected roll is marked seen in
   chat_metadata.diceweaverSeen (pruned, per chat).
   createResultsFeed({ getContext, saveMetadataDebounced, setExtensionPrompt,
   extension_prompt_types, extension_prompt_roles, getSettings, getCharSettings,
   isCharEnabled? }) */

const FEED_PROMPT_KEY = 'diceweaver_results';
const SEEN_KEY = 'diceweaverSeen';
const MAX_SEEN = 200;
const MAX_LINES = 3;
const TRUNCATE = 60;

const OUTCOME_FEED_LABEL = {
    crit: 'CRITICAL SUCCESS',
    success: 'SUCCESS',
    fail: 'FAILED',
    critfail: 'CRITICAL FAILURE',
};

function truncate(text) {
    const value = String(text ?? '').replace(/\s+/g, ' ').trim();
    return value.length > TRUNCATE ? `${value.slice(0, TRUNCATE - 1)}…` : value;
}

export function createResultsFeed(deps) {
    const getContext = deps.getContext;
    const saveMetadataDebounced = deps.saveMetadataDebounced;
    const setExtensionPrompt = deps.setExtensionPrompt;
    const extension_prompt_types = deps.extension_prompt_types;
    const extension_prompt_roles = deps.extension_prompt_roles;
    const getSettings = deps.getSettings;
    const getCharSettings = deps.getCharSettings;
    const isCharEnabled = typeof deps.isCharEnabled === 'function' ? deps.isCharEnabled : () => true;

    function chatMetadata() {
        const context = getContext();
        const metadata = context?.chatMetadata;
        if (!metadata || typeof metadata !== 'object') return null;
        return metadata;
    }

    function readSeen(metadata) {
        const list = metadata?.[SEEN_KEY];
        return Array.isArray(list) ? list.filter(id => typeof id === 'string') : [];
    }

    function markSeen(ids) {
        const metadata = chatMetadata();
        const fresh = (Array.isArray(ids) ? ids : []).filter(id => typeof id === 'string');
        if (!metadata || !fresh.length) return;
        /* Room-based prune: old entries give way to the batch being marked, so
           just-injected results can never be evicted by their own markSeen. */
        const freshSet = new Set(fresh);
        const seen = readSeen(metadata).filter(id => !freshSet.has(id));
        const room = Math.max(0, MAX_SEEN - fresh.length);
        metadata[SEEN_KEY] = [...seen.slice(-room), ...fresh].slice(-MAX_SEEN);
        saveMetadataDebounced();
    }

    /* A re-rolled / undone roll has a NEW result the AI has not seen. */
    function unmarkSeen(id) {
        const metadata = chatMetadata();
        if (!metadata || typeof id !== 'string') return;
        const seen = readSeen(metadata);
        if (!seen.includes(id)) return;
        metadata[SEEN_KEY] = seen.filter(value => value !== id);
        saveMetadataDebounced();
    }

    function feedOnFor(roll) {
        const settings = getSettings();
        if (!settings.feed_results_to_ai) return false;
        const charName = String(roll?.character ?? '').trim();
        const charSettings = getCharSettings(charName);
        if (charSettings.feed_results_to_ai === false) return false;
        return isCharEnabled(charName);
    }

    /* Newest last: iterate the chat forwards, unseen rolls in chat order, cap. */
    function collectUnseen(limit = MAX_LINES) {
        const context = getContext();
        const chat = Array.isArray(context?.chat) ? context.chat : [];
        const metadata = chatMetadata();
        const seen = new Set(readSeen(metadata));
        const unseen = [];
        chat.forEach((mes, messageId) => {
            const rolls = Array.isArray(mes?.extra?.diceRolls) ? mes.extra.diceRolls : [];
            for (const roll of rolls) {
                if (!roll?.id || seen.has(roll.id)) continue;
                if (!feedOnFor(roll)) continue;
                unseen.push({ messageId, roll });
            }
        });
        return unseen.slice(Math.max(0, unseen.length - Math.max(1, limit)));
    }

    function describeRoll(roll) {
        const who = truncate(roll.character) || 'Unknown';
        const what = truncate(roll.action) || '(no action)';
        const outcome = OUTCOME_FEED_LABEL[roll.outcome] ?? String(roll.outcome ?? 'UNKNOWN').toUpperCase();
        const detail = roll.dc == null
            ? `${roll.total} damage`
            : `${roll.total} vs DC ${roll.dc}`;
        return `- ${who}: "${what}" \u2192 ${outcome} (${detail}).`;
    }

    function buildFeedText(unseen) {
        if (!unseen.length) return '';
        const lines = unseen.map(({ roll }) => describeRoll(roll));
        return [
            '[Roll results — decided, narrate the consequence]',
            ...lines,
            'Use these facts; never mention dice numbers or rolls.',
        ].join('\n');
    }

    function setPromptKey(text) {
        setExtensionPrompt(FEED_PROMPT_KEY, text, extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.SYSTEM);
    }

    function clearPromptKey() {
        setPromptKey('');
    }

    /* generation_started: dry-run and continue/swipe/regenerate/impersonate
       never CONSUME results — the prompt key keeps the text injected for the
       original reply, so a redo of that SAME reply still sees the outcomes
       (regenerate used to find nothing unseen and clear them). `quiet` is a
       background generation (summarize, other extensions): it must not mark
       results seen before the real reply gets them. */
    function handleGenerationStarted(type, isDryRun) {
        if (isDryRun) return;
        if (['continue', 'swipe', 'regenerate', 'impersonate', 'quiet'].includes(type)) return;
        if (!getSettings().feed_results_to_ai) {
            clearPromptKey();
            return;
        }
        const unseen = collectUnseen(MAX_LINES);
        if (!unseen.length) {
            clearPromptKey();
            return;
        }
        setPromptKey(buildFeedText(unseen));
        markSeen(unseen.map(({ roll }) => roll.id));
    }

    /* Extension prompt keys are global app state — a chat switch must not leak
       the previous chat's results; seen-ids come from the new chat's metadata
       automatically on the next generation. */
    function handleChatChanged() {
        clearPromptKey();
    }

    return {
        FEED_PROMPT_KEY,
        SEEN_KEY,
        MAX_SEEN,
        MAX_LINES,
        collectUnseen,
        buildFeedText,
        describeRoll,
        markSeen,
        unmarkSeen,
        readSeen,
        handleGenerationStarted,
        handleChatChanged,
        clearPromptKey,
    };
}
