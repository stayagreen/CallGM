import dgram from 'dgram';
import * as stun from 'stun';
import * as ProxyChain from 'proxy-chain';
import db from '../db/db.js';

interface ProxyStatus {
    isActive: boolean;
    localPort: number;
    publicIp: string | null;
    publicPort: number | null;
    username: string;
    authEnabled: boolean;
    lastUpdate: number;
}

class ProxyService {
    private server: any = null;
    private status: ProxyStatus = {
        isActive: false,
        localPort: 8888,
        publicIp: null,
        publicPort: null,
        username: 'admin',
        authEnabled: true,
        lastUpdate: Date.now()
    };

    private stunServers = [
        'stun:stun.qq.com:3478',
        'stun:stun.aliyun.com:3478',
        'stun:stun.l.google.com:19302'
    ];

    constructor() {
        this.initTable();
        this.loadConfig();
    }

    private initTable() {
        db.exec(`
            CREATE TABLE IF NOT EXISTS system_config (
                key TEXT PRIMARY KEY,
                value TEXT
            );
        `);
        // Initial values
        db.prepare('INSERT OR IGNORE INTO system_config (key, value) VALUES (?, ?)').run('proxy_user', 'admin');
        db.prepare('INSERT OR IGNORE INTO system_config (key, value) VALUES (?, ?)').run('proxy_pass', '123456');
    }

    private loadConfig() {
        const user = db.prepare('SELECT value FROM system_config WHERE key = ?').get('proxy_user') as any;
        this.status.username = user ? user.value : 'admin';
    }

    public async start() {
        if (this.server) return;

        const port = 8888;
        const password = (db.prepare('SELECT value FROM system_config WHERE key = ?').get('proxy_pass') as any)?.value || '123456';

        try {
            this.server = new ProxyChain.Server({
                port: port,
                prepareRequestFunction: ({ username, password }) => {
                    const dbUser = db.prepare('SELECT value FROM system_config WHERE key = ?').get('proxy_user') as any;
                    const dbPass = db.prepare('SELECT value FROM system_config WHERE key = ?').get('proxy_pass') as any;
                    
                    const validUser = dbUser ? dbUser.value : 'admin';
                    const validPass = dbPass ? dbPass.value : '123456';

                    const isAuthOk = username === validUser && password === validPass;

                    return {
                        requestAuthentication: !isAuthOk,
                        failMsg: 'Bad proxy credentials',
                    };
                },
            });

            // Handle authentication
            this.server.on('request', (req: any) => {
               // Optional: Log requests
            });

            await this.server.listen();
            this.status.isActive = true;
            this.status.localPort = port;
            console.log(`🚀 Proxy server is listening on port ${port}`);

            // Start STUN polling
            this.startStunPolling();
        } catch (error) {
            console.error('❌ Failed to start proxy server:', error);
        }
    }

    private async startStunPolling() {
        const poll = async () => {
            if (!this.status.isActive) return;

            for (const server of this.stunServers) {
                try {
                    const res = await stun.request(server);
                    const mappedAddress = res.getXorAddress();
                    if (mappedAddress) {
                        this.status.publicIp = mappedAddress.address;
                        this.status.publicPort = mappedAddress.port;
                        this.status.lastUpdate = Date.now();
                        // console.log(`🌍 STUN: Current Public Address is ${this.status.publicIp}:${this.status.publicPort}`);
                        break;
                    }
                } catch (e) {
                    // Try next server
                }
            }
            setTimeout(poll, 30000); // 30 seconds
        };
        poll();
    }

    public getStatus() {
        return this.status;
    }

    public async updateConfig(username: string, pass: string) {
        db.prepare('UPDATE system_config SET value = ? WHERE key = ?').run(username, 'proxy_user');
        db.prepare('UPDATE system_config SET value = ? WHERE key = ?').run(pass, 'proxy_pass');
        this.status.username = username;
        
        // Proxy-chain doesn't easily reload config without restart, 
        // but since we check in prepareRequestFunction, we need to handle it there.
        // Let's refine the authentication check.
    }
}

export const proxyService = new ProxyService();
