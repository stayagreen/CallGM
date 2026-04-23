
export default {
    prepare: (sql: string) => ({
        run: (...args: any[]) => ({ changes: 1, lastInsertRowid: 1 }),
        get: (...args: any[]) => null,
        all: (...args: any[]) => []
    }),
    exec: (sql: string) => {}
};
