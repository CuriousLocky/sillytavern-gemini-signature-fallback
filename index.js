const SETTINGS_KEY = 'gemini_signature_fallback';
const FALLBACK_SIGNATURE = 'skip_thought_signature_validator';
const context = SillyTavern.getContext();

/**
 * getSettings initializes persisted lists and returns the current settings.
 */
function getSettings() {
    if (!isRecord(context.extensionSettings[SETTINGS_KEY])) {
        context.extensionSettings[SETTINGS_KEY] = {};
    }
    const settings = context.extensionSettings[SETTINGS_KEY];
    let initialized = false;
    for (const [key, defaults] of Object.entries({
        endpoints: ['https://litellm.lockyhome.icu'],
        models: ['gemini-*'],
    })) {
        if (!Array.isArray(settings[key])) {
            settings[key] = defaults;
            initialized = true;
        }
    }
    if (initialized) context.saveSettingsDebounced();
    return settings;
}

/**
 * normalizeEndpoint converts an HTTP(S) endpoint URL to its origin.
 */
function normalizeEndpoint(value) {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('Enter an HTTP or HTTPS endpoint URL.');
    }
    return url.origin;
}

/**
 * normalizeModel validates an exact model name or trailing-wildcard pattern.
 */
function normalizeModel(value) {
    const model = value.trim();
    if (!model || /\s/.test(model) || model.slice(0, -1).includes('*')) {
        throw new Error('Enter a model name or a prefix ending in *, such as gemini-*.');
    }
    return model;
}

/**
 * isRecord reports whether a value is a non-array object.
 */
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * isTargetRequest matches a Custom request against both configured lists.
 */
function isTargetRequest(body) {
    if (!isRecord(body)
        || body.chat_completion_source !== 'custom'
        || typeof body.model !== 'string'
        || typeof body.custom_url !== 'string') {
        return false;
    }

    try {
        const settings = getSettings();
        const origin = normalizeEndpoint(body.custom_url);
        return settings.endpoints.includes(origin) && settings.models.some(pattern =>
            typeof pattern === 'string' && (pattern.endsWith('*')
                ? body.model.startsWith(pattern.slice(0, -1))
                : body.model === pattern));
    } catch {
        return false;
    }
}

/**
 * addMissingSignatures mutates outgoing tool calls, preserving real signatures.
 * Malformed metadata is left untouched rather than overwritten.
 */
function addMissingSignatures(body) {
    if (!isTargetRequest(body) || !Array.isArray(body.messages)) return;

    for (const message of body.messages) {
        if (!isRecord(message)
            || message.role !== 'assistant'
            || !Array.isArray(message.tool_calls)) {
            continue;
        }

        for (const call of message.tool_calls) {
            if (!isRecord(call) || call.type !== 'function') continue;

            call.extra_content ??= {};
            if (!isRecord(call.extra_content)) continue;

            call.extra_content.google ??= {};
            if (!isRecord(call.extra_content.google)) continue;

            const google = call.extra_content.google;
            if (google.thought_signature == null || google.thought_signature === '') {
                google.thought_signature = FALLBACK_SIGNATURE;
            }
        }
    }
}

/**
 * createListEditor builds a saved list with accessible Add and Remove controls.
 */
function createListEditor(key, title, hint, placeholder, normalize) {
    const section = document.createElement('section');
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.id = `gsf-${key}-input`;
    input.type = 'text';
    input.className = 'text_pole';
    input.placeholder = placeholder;
    label.htmlFor = input.id;
    label.textContent = title;
    const description = document.createElement('p');
    description.textContent = hint;
    const list = document.createElement('ul');
    list.className = 'gsf-list';
    const error = document.createElement('p');
    error.className = 'gsf-error';
    error.setAttribute('role', 'status');
    const controls = document.createElement('div');
    controls.className = 'gsf-controls';
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'menu_button';
    add.textContent = 'Add';

    /** renderList refreshes saved entries and their removal controls. */
    function renderList() {
        list.replaceChildren();
        for (const [index, value] of getSettings()[key].entries()) {
            const item = document.createElement('li');
            const text = document.createElement('span');
            text.textContent = value;
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'menu_button';
            remove.textContent = 'Remove';
            remove.setAttribute('aria-label', `Remove ${value}`);
            remove.addEventListener('click', () => {
                getSettings()[key].splice(index, 1);
                context.saveSettingsDebounced();
                renderList();
            });
            item.append(text, remove);
            list.append(item);
        }
    }

    /** addEntry validates and saves the entry currently in the input. */
    function addEntry() {
        try {
            const value = normalize(input.value);
            const entries = getSettings()[key];
            if (entries.includes(value)) {
                error.textContent = 'This entry is already in the list.';
                return;
            }
            entries.push(value);
            context.saveSettingsDebounced();
            input.value = '';
            error.textContent = '';
            renderList();
            input.focus();
        } catch (err) {
            error.textContent = key === 'endpoints'
                ? 'Enter an HTTP or HTTPS endpoint URL, such as https://proxy.example.com/v1.'
                : err.message;
        }
    }

    add.addEventListener('click', addEntry);
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            addEntry();
        }
    });
    controls.append(input, add);
    section.append(label, description, list, controls, error);
    renderList();
    return section;
}

/**
 * initializeSettingsUI mounts the extension's endpoint and model list editors.
 */
function initializeSettingsUI() {
    getSettings();
    const container = document.getElementById('extensions_settings');
    if (!container || document.getElementById('gsf-settings')) return;
    const panel = document.createElement('details');
    panel.id = 'gsf-settings';
    const heading = document.createElement('summary');
    heading.textContent = 'Gemini Tool Signature Fallback';
    const description = document.createElement('p');
    description.textContent = 'Applies to Custom connections matching an endpoint and a model below. Changes save automatically. Both lists need at least one entry to activate the fallback.';
    panel.append(heading, description,
        createListEditor('endpoints', 'Endpoints',
            'Enter an endpoint URL. Matching uses its scheme, host, and port across all paths.',
            'https://proxy.example.com/v1', normalizeEndpoint),
        createListEditor('models', 'Models',
            'Use an exact model name or a trailing * for a prefix match. Names are case-sensitive.',
            'gemini-4-hydrogen or gemini-*', normalizeModel));
    container.append(panel);
}

context.eventSource.on(context.event_types.CHAT_COMPLETION_SETTINGS_READY, addMissingSignatures);
jQuery(initializeSettingsUI);
