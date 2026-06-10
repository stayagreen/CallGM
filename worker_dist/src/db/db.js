
const dbStore = new Map();
const dbMock = {
    store: dbStore,
    prepare: (sql) => ({
        run: (...args) => ({ changes: 1, lastInsertRowid: 1 }),
        get: (...args) => {
            if (sql.includes('system_config') || (args[0] && typeof args[0] === 'string' && args[0].includes('config'))) {
                return { value: JSON.stringify({
                    chromePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                    userDataDir: 'C:\\ChromeDebug',
                    pasteMin: 5, pasteMax: 10, clickMin: 8, clickMax: 15, downloadMin: 120, downloadMax: 240
                })};
            }
            return dbStore.get(args[0]) || null;
        },
        all: (...args) => []
    }),
    exec: (sql) => {}
};
export default dbMock;
