"use strict";

let sodiumLoaded = new Promise(resolve => {
    if (window.sodium) {
        resolve(window.sodium);
    } else {
        window.sodium = {
            onload: (sodium) => {
                resolve(sodium);
            }
        };
    }
});

const safeHtml = (strings, ...values) => {
    let output = [];
    let escapeHelper = document.createElement('p');
    strings.forEach((string, i) => {
        output.push(string);
        let value = values[i];
        if (value) {
            escapeHelper.innerText = value;
            output.push(escapeHelper.innerHTML);
        }
    });
    return output.join('');
};

/**
 * Creates an update function for the given conditional element, identified
 * by the given identifier. Calling the update function re-evaluates the
 * condition and removes or adds the element based on its result.
 */
const _createElementUpdater = (component, element, identifier) => {
    const placeholder = document.createComment('if');
    const parent = element.parentElement;
    const predicate = component.predicates[identifier];
    parent.insertBefore(placeholder, element);
    let hidden = false;
    return () => {
        const shouldBeShown = predicate();
        if (hidden && shouldBeShown) {
            hidden = false;
            parent.insertBefore(element, placeholder);
        } else if (!hidden && !shouldBeShown) {
            hidden = true;
            parent.removeChild(element);
        }
    };
};

const render = (component, rootElement) => {
    component.rendererCallback = () => {
        component.predicates = {};
        rootElement.innerHTML = component.render();
        rootElement.querySelectorAll('*').forEach(element => {
            for (let attribute of element.attributes) {
                if (!attribute.name.startsWith('data-bind-')) {
                    continue
                }
                let eventName = attribute.name.substr('data-bind-'.length)
                element.addEventListener(eventName, component.handle(attribute.value));
            }
        });
        rootElement.querySelectorAll('*[data-if]').forEach(element => {
            const attr = element.attributes.getNamedItem('data-if');
            if (attr && element.parentElement) {
                const evaluator = _createElementUpdater(component, element, attr.value);
                component.predicates[attr.value] = evaluator;
                evaluator();
            }
        });
    };
    component.rendererCallback();
};


const idMaker = () => {
    let id = 0;
    return () => (id++).toString();
}


/**
 * Base class for components.
 */
class Component {
    constructor() {
        this.predicates = {};
        this.eventHandlers = {};
        this.state = {};
        this._nextId = idMaker();
    }

    bind(handler) {
        let identifier = this._nextId();
        this.eventHandlers[identifier] = handler.bind(this);
        return identifier;
    }

    cond(predicate) {
        let identifier = this._nextId();
        this.predicates[identifier] = predicate.bind(this);
        return identifier;
    }

    handle(identifier) {
        return event => {
            this.eventHandlers[identifier](event);
        }
    }

    evaluationCallback() {
        Object.values(this.predicates).forEach((x) => x());
    }

    setState(newState) {
        this.state = newState;
        if (this.rendererCallback) {
            this.rendererCallback();
        }
    }

    updateState(newState) {
        Object.assign(this.state, newState);
        this.evaluationCallback();
    }
}


/** The request safe does not exist. */
class NotFound extends Error {}


/**
 * API gateway to Kuchenblech's vault.
 */
class VaultApi {
    async createSafe(secrets, openDuration) {
        const [key, nonce, cipher] = await this._encrypt(JSON.stringify(secrets));
        const {data} = await this._request(
            '/safes',
            {
                nonce: nonce,
                secrets: cipher,
                open_duration: openDuration
            });
        return location.origin + data.href + '#' + key;
    }

    async unlockSafe(safeId, key) {
        // XXX handle doesn't exist case
        const {status, data} = await this._request('/safes/' + safeId, {});
        if (status === 404) {
            throw new NotFound();
        }
        const plain = await this._decrypt(key, data.nonce, data.secrets);
        return JSON.parse(plain);
    }

    _request(url, data) {
        const body = data ? JSON.stringify(data) : null;
        return new Promise(resolve => {
            const request = new XMLHttpRequest();
            request.addEventListener(
                'load',
                () => resolve({status: request.status, data: JSON.parse(request.responseText)}));
            request.open(body === null ? 'GET' : 'POST', url);
            if (body !== null) {
                request.setRequestHeader('Content-Type', 'application/json');
            }
            request.send(body);
        });
    }

    async _encrypt(data) {
        const sodium = await sodiumLoaded;
        const key = sodium.crypto_aead_chacha20poly1305_ietf_keygen();
        const nonce = sodium.randombytes_buf(sodium.crypto_aead_chacha20poly1305_IETF_NPUBBYTES);
        const cipher = sodium.crypto_aead_chacha20poly1305_ietf_encrypt(
            sodium.from_string(data), null, null, nonce, key);
        return [sodium.to_hex(key), sodium.to_base64(nonce), sodium.to_base64(cipher)];
    }

    async _decrypt(key, nonce, cipher) {
        const sodium = await sodiumLoaded;
        const plain = sodium.crypto_aead_chacha20poly1305_ietf_decrypt(
            null,
            sodium.from_base64(cipher),
            null,
            sodium.from_base64(nonce),
            sodium.from_hex(key));
        return sodium.to_string(plain);
    }
}


// --- The unlock app ---

const startUnlockApp = (startElement, safeId, key) => {
    const component = new AskForUnlockStep(safeId, key, startElement);
    render(component, startElement);
};

class AskForUnlockStep extends Component {
    constructor(safeId, key, parentElement) {
        super();
        this.parentElement = parentElement;
        this.safeId = safeId;
        this.key = key;
    }

    nextStep() {
        const newComponent = new OpenSafe(this.safeId, this.key);
        render(newComponent, this.parentElement);
    }

    render() {
        return safeHtml`
            <section class="card">
                <h2>Safe ready to be opened!</h2>
                <p>Someone shared some secrets with you. Press <i>Reveals secrets</i> to see them. Note that you can only reveal the secrets once.</p>
                <nav>
                    <button data-bind-click="${this.bind(this.nextStep)}">Reveal secrets</button>
                </nav>
            </section>
        `;
    }
}

class OpenSafe extends Component {
    constructor(safeId, key) {
        super();

        this.state = {
            secret: "",
            description: "",
            title: "Unlocking safe…"
        }

        const vaultApi = new VaultApi();
        vaultApi.unlockSafe(safeId, key)
            .then((secrets) => {
                this.setState({
                    secret: secrets[0].secret,
                    description: secrets[0].description,
                    title: ''
                })
            }, (error) => {
                if (error instanceof NotFound) {
                    this.setState({
                        secret: '',
                        description: 'Unfortunately, the request safe could not be found. Maybe it already expired.',
                        title: 'Safe not found'
                    });
                } else {
                    this.setState({
                        secret: '',
                        description: '',
                        title: 'Ooops… something went wrong'
                    });
                }
            });
    }

    copyUrlToClipboard() {
        const copyText = document.querySelector('.revealed-secret');
        copyText.select();
        document.execCommand('copy');
    }

    render() {
        return safeHtml`
            <section class="card">
                <h2>${this.state.title}</h2>
                <textarea data-if="${this.cond(() => this.state.secret.length > 0)}" class="revealed-secret">${this.state.secret}</textarea>
                <button data-if="${this.cond(() => this.state.secret.length > 0)}"
                    data-bind-click="${this.bind(this.copyUrlToClipboard)}"><span class="icon-clipboard"></span></button>
                <p>${this.state.description}</p>
            </section>
        `;
    }
}



// --- The share app ---

class FirstStep extends Component {
    constructor(parentElement) {
        super();

        this.parentElement = parentElement;
        this.state = {
            secret: "",
            hasSecret: false
        };
    }

    nextStep() {
        const nextComponent = new AddDescriptionStep(this.state.secret, this.parentElement);
        render(nextComponent, this.parentElement);
    }

    onInput(event) {
        this.updateState({
            secret: event.target.value,
            hasSecret: event.target.value.length > 0
        });
    }

    render() {
        return safeHtml`
            <section class="card">
                <h2>Start with your first secret</h2>
                <textarea placeholder="Enter your secret" autofocus 
                    data-bind-input="${this.bind(this.onInput)}"></textarea>
                <nav data-if="${this.cond(() => this.state.hasSecret)}">
                    <button data-bind-click="${this.bind(this.nextStep)}">Continue</button>
                </nav>
            </section>
        `
    }
}

class AddDescriptionStep extends Component {
    constructor(secret, parentElement) {
        super();

        this.parentElement = parentElement;
        this.state = {
            secret: secret,
            description: ""
        };
    }

    onInput(event) {
        this.updateState({description: event.target.value});
    }

    nextStep() {
        const newComponent = new AddExpirationStep(this.state.secret, this.state.description, this.parentElement);
        render(newComponent, this.parentElement);
    }

    render() {
        return safeHtml`
            <section class="card">
                <h2>Does your secret need a description?</h2>
                <code>${this.state.secret}</code>
                <textarea placeholder="Enter a description if needed" autofocus data-bind
                          data-bind-input="${this.bind(this.onInput)}"></textarea>
                <nav>
                    <button data-bind-click="${this.bind(this.nextStep)}">Continue</button>
                </nav>
            </section>
        `;
    }
}

class AddExpirationStep extends Component {
    constructor(secret, description, parentElement) {
        super();

        this.parentElement = parentElement;
        this.state = {
            description: description,
            secret: secret
        }
    }

    nextStep(openDuration) {
        const newComponent = new LastStep(
            this.state.secret, this.state.description, openDuration, this.parentElement);
        render(newComponent, this.parentElement);
    }

    render() {
        return safeHtml`
            <section class="card">
                <h2>Should the secret delete itself if it's not revealed in time?</h2>
                <code>${this.state.secret}</code>
                <p>${this.state.description}</p>
                <nav class="visualRange">
                    <button data-bind-click="${this.bind(() => this.nextStep(Number.MAX_SAFE_INTEGER))}">No expi&shy;ration</button>
                    <button data-bind-click="${this.bind(() => this.nextStep(3 * 24 * 3600))}">3 d<span>ays</span></button>
                    <button data-bind-click="${this.bind(() => this.nextStep(24 * 3600))}">1 d<span>ay</span></button>
                    <button data-bind-click="${this.bind(() => this.nextStep(12 * 3600))}">12 h<span>ours</span></button>
                    <button data-bind-click="${this.bind(() => this.nextStep(3600))}">1 h<span>our</span></button>
                </nav>
            </section>
        `;
    }
}

class LastStep extends Component {
    constructor(secret, description, openDuration, parentElement) {
        super();

        this.parentElement = parentElement;
        this.state = {
            secret: secret,
            description: description,
            url: 'Creating your sharable secret...',
            heading: 'Your secret is almost ready to be shared'
        };

        const vault = new VaultApi();
        vault.createSafe(
            [{secret: this.state.secret, description: this.state.description}],
            openDuration
        ).then(url => this.setState(Object.assign(
            {}, this.state,
            {heading: 'Your secret is ready to be shared', url: url})));
    }

    copyUrlToClipboard() {
        const copyText = document.querySelector('#share_url');
        copyText.select();
        document.execCommand('copy');
    }

    startAgain() {
        startApp(this.parentElement);
    }

    render() {
        return safeHtml`
            <section class="card">
                <h2>${this.state.heading}</h2>
                <code>${this.state.secret}</code>
                <p>${this.state.description}</p>
                <p class="vertical-spacer">Use the following link to share your secret:</p>
                <div class="flex-container">
                    <textarea readonly id="share_url" class="flex break-all">${this.state.url}</textarea>
                </div>
                <button data-bind-click="${this.bind(this.copyUrlToClipboard)}"><span class="icon-clipboard"></span></button>
                <button data-bind-click="${this.bind(this.startAgain)}" class="secondary">I want to share another secret</button>
            </section>
        `;
    }
}

function startApp(startElement) {
    const component = new FirstStep(startElement);
    render(component, startElement);
}
