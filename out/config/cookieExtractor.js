"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractDeepSeekCookie = extractDeepSeekCookie;
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
/**
 * Extract platform.deepseek.com cookies from Chrome/Edge browsers.
 *
 * Uses a separate Node.js script (scripts/extract-cookies.js) that runs under
 * the SYSTEM Node.js (not VS Code's built-in one) because it needs
 * `node:sqlite` which requires Node 22.5+.
 */
async function extractDeepSeekCookie() {
    const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'extract-cookies.js');
    if (!fs.existsSync(scriptPath)) {
        console.error(`[cookieExtractor] Script not found: ${scriptPath}`);
        return null;
    }
    return new Promise((resolve) => {
        // Find system Node.js
        const nodePaths = [
            '"C:\\Program Files\\nodejs\\node.exe"',
            'node',
        ];
        function tryNode(idx) {
            if (idx >= nodePaths.length) {
                resolve(null);
                return;
            }
            (0, child_process_1.execFile)(nodePaths[idx], [scriptPath], {
                timeout: 20000,
                windowsHide: true,
                shell: true,
            }, (err, stdout) => {
                if (err) {
                    tryNode(idx + 1);
                    return;
                }
                try {
                    const result = JSON.parse(stdout.trim());
                    if (result.cookie && result.source) {
                        resolve({ cookie: result.cookie, source: result.source });
                    }
                    else {
                        console.error(`[cookieExtractor] ${result.error || 'No cookies found'}`);
                        // Don't try next node path — the script ran, just no data
                    }
                }
                catch {
                    tryNode(idx + 1);
                }
            });
        }
        tryNode(0);
    });
}
//# sourceMappingURL=cookieExtractor.js.map