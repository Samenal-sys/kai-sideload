// KaiOS 3 AppsManager client. Its generated URL encoder differs by firmware:
// some builds accept a string and others a URL object. Inspect the local
// encoder before sending an action, then retry only a proven argument-type
// error. A service failure may mean the action has already started.
const ROOT = 'http://127.0.0.1/api/v1/'
const SCRIPT_PATHS = ['shared/core.js', 'shared/session.js', 'apps/service.js']
const REQUEST_FIELDS = {
    installPackage: ['InstallPackageRequest', 'updateUrl'],
    checkForUpdate: ['CheckForUpdateRequest', 'updateUrl'],
    update: ['UpdateRequest', 'manifestUrl'],
    installPwa: ['InstallPwaRequest', 'manifestUrl'],
    uninstall: ['UninstallRequest', 'manifestUrl'],
}

let managerPromise = null
const scriptPromises = new Map()
let lastDownloadFailure = null

// AppsManager can reject with an AppsServiceError value rather than an Error.
// Match the JScalated website helper so the phone displays the service code
// instead of alerting an undefined .message.
function describeError(error) {
    const value = error?.value
    const code = [error, value, value?.error, error?.code, error?.error]
    .find(candidate => typeof candidate === 'number')
    const names = globalThis.lib_apps?.AppsServiceError
    const name = code === undefined ? '' : Object.keys(names || {})
    .find(key => names[key] === code) || `code ${code}`
    const details = [name, error?.reason, error?.message,
    typeof value === 'string' ? value : '']
    .filter(part => part !== undefined && part !== null && part !== '')
    .map(String)
    if (details.length) return [...new Set(details)].join(': ')
        if (typeof error === 'string' && error) return error
            // if (error && typeof error === 'object') {
                try {
                    const json = JSON.stringify(error)
                    if (json && json !== '{}') return json
                } catch (_) { /* Use the fallback below for cyclic service objects. */ }

            return 'AppsManager returned no error details'
}

function errorText(error, includeDownloadFailure = false) {
    const detail = describeError(error)
    if (!includeDownloadFailure || lastDownloadFailure === null) return detail
        const downloadDetail = describeError(lastDownloadFailure)
        return downloadDetail === detail ? detail : `${detail}; download failed: ${downloadDetail}`
}

function watchDownloadFailures(manager) {
    if (typeof manager?.addEventListener !== 'function' ||
        manager.APP_DOWNLOAD_FAILED_EVENT === undefined) return
        try {
            manager.addEventListener(manager.APP_DOWNLOAD_FAILED_EVENT, event => {
                lastDownloadFailure = event?.reason ?? event?.value ?? event
                console.warn('[ostore] AppsManager download failed:', event)
            })
        } catch (error) {
            console.warn('[ostore] AppsManager download event unavailable:', error)
        }
}

function loadScript(path) {
    if (scriptPromises.has(path)) return scriptPromises.get(path)
        const promise = new Promise((resolve, reject) => {
            const script = document.createElement('script')
            const timer = setTimeout(() => reject(new Error(`Timed out loading ${path}`)), 12000)
            script.onload = () => { clearTimeout(timer); resolve() }
            script.onerror = () => { clearTimeout(timer); reject(new Error(`Could not load ${path}`)) }
            script.src = ROOT + path
            document.head.appendChild(script)
        }).catch(error => {
            scriptPromises.delete(path)
            throw error
        })
        scriptPromises.set(path, promise)
        return promise
}

async function connect() {
    if (managerPromise) return managerPromise
        managerPromise = (async () => {
            for (const path of SCRIPT_PATHS) await loadScript(path)
                if (!globalThis.lib_session?.Session || !globalThis.lib_apps?.AppsManager) {
                    throw new Error('AppsManager client scripts are unavailable')
                }
                const token = typeof navigator.b2g?.externalapi?.getToken === 'function'
                ? await navigator.b2g.externalapi.getToken() : 'secrettoken'
                return new Promise((resolve, reject) => {
                    const session = new globalThis.lib_session.Session()
                    let settled = false
                    const timer = setTimeout(() => finish(new Error('AppsManager connection timed out')), 12000)
                    function finish(error, manager) {
                        if (settled) return
                            settled = true
                            clearTimeout(timer)
                            if (error) reject(error)
                                else {
                                    watchDownloadFailures(manager)
                                    resolve(manager)
                                }
                    }
                    try {
                        session.open('websocket', 'localhost', token, {
                            onsessionconnected() {
                                globalThis.lib_apps.AppsManager.get(session).then(
                                    manager => finish(null, manager), finish
                                )
                            },
                            onsessiondisconnected() {
                                managerPromise = null
                                finish(new Error('AppsManager session disconnected'))
                            },
                            onsessionconnectionerror() {
                                finish(new Error('AppsManager session connection error'))
                            },
                        }, true)
                    } catch (error) { finish(error) }
                })
        })().catch(error => {
            managerPromise = null
            throw error
        })
        return managerPromise
}

function callUrlMethod(manager, method, rawUrl, rest = []) {
    if (typeof manager?.[method] !== 'function') {
        return Promise.reject(new Error(`AppsManager.${method} is unavailable`))
    }
    const address = new URL(String(rawUrl)).href
    if (!/^https?:$/.test(new URL(address).protocol)) {
        return Promise.reject(new Error('AppsManager needs an HTTP(S) URL'))
    }
    const request = REQUEST_FIELDS[method]
    const codec = request && manager.wrapper_payload_message?.[request[0]]
    const extra = method === 'checkForUpdate' ? { appsOption: rest[0] } : {}
    const accepts = value => {
        if (typeof codec?.encode !== 'function') return false
            try {
                codec.encode({ [request[1]]: value, ...extra })
                return true
            } catch (_) { return false }
    }
    const asObject = new URL(address)
    const first = !accepts(address) && accepts(asObject) ? asObject : address
    const call = value => Promise.resolve().then(() => manager[method](value, ...rest))
    return call(first).catch(error => {
        const message = String(error?.message || error || '')
        if (typeof first === 'string' &&
            /Expected\s+URL\s*,\s*(?:bug\s+|but\s+)?got\s+string/i.test(message)) {
            return call(asObject)
            }
            if (typeof first !== 'string' &&
                /Expected\s+string\s*,\s*(?:bug\s+|but\s+)?got\s+(?:object|URL)/i.test(message)) {
                return call(address)
                }
                throw error
    })
}
async function probe() { return connect() }
async function getAll() { return (await connect()).getAll() }
async function installPackage(updateUrl) {
    lastDownloadFailure = null
    return callUrlMethod(await connect(), 'installPackage', updateUrl)
}
async function installPWA(manifestUrl) {
    return callUrlMethod(await connect(), 'installPwa', manifestUrl)
}
async function uninstall(manifestUrl) {
    return callUrlMethod(await connect(), 'uninstall', manifestUrl)
}
async function updatePackage(updateUrl, manifestUrl) {
    lastDownloadFailure = null
    const manager = await connect()
    const available = await callUrlMethod(manager, 'checkForUpdate', updateUrl, [{ autoInstall: false }])
    if (!available) throw new Error('No update is available at this app’s installed update URL')
        return callUrlMethod(manager, 'update', manifestUrl)
}
window.AppsManagement = {installPackage}
