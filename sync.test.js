const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(`${__dirname}/index.html`, 'utf8');
const script = html.slice(html.indexOf('// --- Global State ---'), html.indexOf('// --- Action Handlers ---'));

function phone(shared, transactions, lists) {
    const storage = new Map();
    const context = vm.createContext({
        Date, Math, JSON, console: { error() {} },
        localStorage: { setItem(key, value) { storage.set(key, value); } },
        fetch: async (_url, options = {}) => {
            if (options.method === 'PATCH') {
                shared.patches++;
                if (shared.failPatch) return { ok: false, status: 403 };
                shared.data = JSON.parse(JSON.parse(options.body).files['couple_finance_data.json'].content);
                if (shared.onPatch) await shared.onPatch();
                return { ok: true, status: 200 };
            }
            if (shared.failGet) return { ok: false, status: 401 };
            return { ok: true, json: async () => ({ files: {
                'couple_finance_data.json': { content: JSON.stringify(shared.data) }
            } }) };
        }
    });
    vm.runInContext('const defaultSettings = {}; const mockTransactions = []; const mockLists = [];', context);
    vm.runInContext(script, context);
    vm.runInContext(`state.settings = { githubPat: 'test', gistId: 'test' }; state.transactions = ${JSON.stringify(transactions)}; state.lists = ${JSON.stringify(lists)}; state.currentView = 'lists';`, context);
    return { context, storage, run: code => vm.runInContext(code, context) };
}

async function main() {
    const shared = { data: { transactions: [], lists: [], recurring: [], deleted: [] }, patches: 0 };
    const a = phone(shared, [{ id: 'purchase-a', total: 10, updatedAt: 10 }], [{ id: 'list-a', items: [], updatedAt: 10 }]);
    const b = phone(shared, [{ id: 'purchase-b', total: 20, updatedAt: 20 }], [{ id: 'list-b', items: [], updatedAt: 20 }]);
    assert.equal(await a.run('saveToGist()'), true, a.run('state.syncStatus'));
    assert.equal(await b.run('saveToGist()'), true);
    assert.equal(await a.run('saveToGist()'), true);
    assert.deepEqual(shared.data.transactions.map(tx => tx.id).sort(), ['purchase-a', 'purchase-b']);
    assert.deepEqual(shared.data.lists.map(list => list.id).sort(), ['list-a', 'list-b']);
    assert.deepEqual(JSON.parse(a.storage.get('coupleFinanceState')).transactions.map(tx => tx.id).sort(), ['purchase-a', 'purchase-b']);

    const listsShared = { data: { transactions: [], lists: [{ id: 'groceries', items: [], updatedAt: 1 }], recurring: [], deleted: [] }, patches: 0 };
    const listA = phone(listsShared, [], [{ id: 'groceries', items: [{ id: 'milk', text: 'Milk', updatedAt: 10 }], updatedAt: 10 }]);
    const listB = phone(listsShared, [], [{ id: 'groceries', items: [{ id: 'eggs', text: 'Eggs', updatedAt: 20 }], updatedAt: 20 }]);
    assert.equal(await listA.run('saveToGist()'), true);
    assert.equal(await listB.run('saveToGist()'), true);
    assert.deepEqual(listsShared.data.lists[0].items.map(item => item.id).sort(), ['eggs', 'milk']);

    shared.failGet = true;
    const previous = shared.patches;
    a.run("state.transactions.push({ id: 'offline', total: 30, updatedAt: 30 }); saveState()");
    await a.run('state.syncPromise');
    assert.equal(shared.patches, previous, 'failed download must not upload');
    assert.equal(JSON.parse(a.storage.get('coupleFinanceState')).transactions.some(tx => tx.id === 'offline'), true);
    shared.failGet = false;
    assert.equal(await a.run('saveToGist()'), true);
    assert.equal(shared.data.transactions.some(tx => tx.id === 'offline'), true);

    shared.onPatch = async () => {
        shared.onPatch = null;
        a.run("state.transactions.push({ id: 'during-upload', total: 40, updatedAt: 40 }); saveState()");
    };
    assert.equal(await a.run('saveToGist()'), true);
    assert.equal(shared.data.transactions.some(tx => tx.id === 'during-upload'), true, 'edit during upload must get another pass');

    shared.failPatch = true;
    const c = phone(shared, [{ id: 'unpublished', total: 50, updatedAt: 50 }], []);
    assert.equal(await c.run('saveToGist()'), false);
    assert.equal(c.run('state.syncStatus.includes("403")'), true);
    assert.equal(c.run('state.transactions.some(tx => tx.id === "unpublished")'), true);
    console.log('Sync recovery checks passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
