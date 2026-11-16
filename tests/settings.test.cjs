const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const source = readFileSync(`${__dirname}/../index.js`, 'utf8');

/** Element provides the DOM operations needed to exercise settings interactions. */
class Element {
    constructor(tag) {
        this.tag = tag;
        this.children = [];
        this.listeners = {};
        this.value = '';
        this.textContent = '';
    }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute() {}
    addEventListener(event, callback) { this.listeners[event] = callback; }
    focus() {}
}

/** load starts the extension with persisted settings and an in-memory settings DOM. */
function load(extensionSettings = {}) {
    const container = new Element('div');
    let listener;
    let saves = 0;
    const context = {
        extensionSettings,
        saveSettingsDebounced: () => saves++,
        event_types: { CHAT_COMPLETION_SETTINGS_READY: 'ready' },
        eventSource: { on: (event, callback) => {
            assert.equal(event, 'ready');
            listener = callback;
        } },
    };
    runInNewContext(source, {
        URL,
        SillyTavern: { getContext: () => context },
        jQuery: callback => callback(),
        document: {
            createElement: tag => new Element(tag),
            getElementById: id => id === 'extensions_settings' ? container : null,
        },
    });
    return { container, listener, extensionSettings, saves: () => saves };
}

/** request returns a tool-history request for matching and preservation checks. */
function request(url = 'https://litellm.lockyhome.icu/v1', model = 'gemini-4-hydrogen') {
    return {
        chat_completion_source: 'custom', custom_url: url, model,
        messages: [{ role: 'assistant', tool_calls: [
            { type: 'function', function: { name: 'context', arguments: '{}' } },
            { type: 'function', extra_content: { google: { thought_signature: 'original' }, other: 1 } },
        ] }],
    };
}

/** editor selects the controls for one of the two settings list editors. */
function editor(app, index) {
    const section = app.container.children[0].children[index + 2];
    const [, , list, controls, error] = section.children;
    return { list, input: controls.children[0], add: controls.children[1], error };
}

test('UI adds, normalizes, rejects duplicates, removes, and persists entries', () => {
    const app = load();
    const endpoints = editor(app, 0);
    endpoints.input.value = 'https://SECOND.example:443/v1/';
    endpoints.add.listeners.click();
    assert.equal(endpoints.list.children.length, 2);
    endpoints.input.value = 'https://second.example/another';
    endpoints.input.listeners.keydown({ key: 'Enter', preventDefault() {} });
    assert.equal(endpoints.list.children.length, 2);
    assert.match(endpoints.error.textContent, /already/);
    endpoints.input.value = 'invalid URL';
    endpoints.add.listeners.click();
    assert.match(endpoints.error.textContent, /HTTP/);
    assert.equal(endpoints.list.children.length, 2);

    const models = editor(app, 1);
    models.input.value = 'custom-model';
    models.add.listeners.click();
    models.list.children[0].children[1].listeners.click();
    endpoints.list.children[0].children[1].listeners.click();
    const reloaded = load(JSON.parse(JSON.stringify(app.extensionSettings)));
    const body = request('https://second.example/v1', 'custom-model');
    reloaded.listener(body);
    assert.equal(body.messages[0].tool_calls[0].extra_content.google.thought_signature,
        'skip_thought_signature_validator');
    assert.equal(reloaded.saves(), 0);
    assert.ok(app.saves() >= 5);
});

test('matching requires both lists, exact origin, and Custom source', () => {
    const app = load();
    for (const body of [
        request('https://litellm.lockyhome.icu.attacker.example/v1'),
        request(undefined, 'other-model'),
        { ...request(), chat_completion_source: 'openai' },
    ]) {
        app.listener(body);
        assert.equal(body.messages[0].tool_calls[0].extra_content, undefined);
    }
    const body = request();
    app.listener(body);
    assert.equal(body.messages[0].tool_calls[1].extra_content.google.thought_signature, 'original');
    assert.equal(body.messages[0].tool_calls[1].extra_content.other, 1);
    const before = JSON.stringify(body);
    app.listener(body);
    assert.equal(JSON.stringify(body), before);
    editor(app, 0).list.children[0].children[1].listeners.click();
    const reloaded = load(JSON.parse(JSON.stringify(app.extensionSettings)));
    const empty = request();
    reloaded.listener(empty);
    assert.equal(empty.messages[0].tool_calls[0].extra_content, undefined);
    assert.equal(editor(reloaded, 0).list.children.length, 0);
});

test('model editor validates patterns and matches exact names or prefixes', () => {
    const app = load();
    const models = editor(app, 1);
    for (const value of ['a*b', '', 'two words']) {
        models.input.value = value;
        models.add.listeners.click();
        assert.ok(models.error.textContent);
        assert.equal(models.list.children.length, 1);
    }
    models.list.children[0].children[1].listeners.click();
    models.input.value = 'exact-model';
    models.add.listeners.click();
    const exact = request(undefined, 'exact-model');
    app.listener(exact);
    assert.ok(exact.messages[0].tool_calls[0].extra_content);
    const suffix = request(undefined, 'exact-model-extra');
    app.listener(suffix);
    assert.equal(suffix.messages[0].tool_calls[0].extra_content, undefined);
});
