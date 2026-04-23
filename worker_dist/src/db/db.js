
export default {
    prepare: (sql) => ({
        run: (...args) => ({ changes: 1, lastInsertRowid: 1 }),
        get: (...args) => null,
        all: (...args) => []
    }),
    exec: (sql) => {}
};
