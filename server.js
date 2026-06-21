import express from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

const app = express();
const PORT = process.env.PORT || 3000;

const LEGACY_DIR = 'C:\\Users\\User\\.gemini\\tmp\\user\\chats';
const SQLITE_DIR = 'C:\\Users\\User\\.gemini\\antigravity-cli\\conversations';
const METADATA_FILE = 'C:\\Users\\User\\gemini-chat-explorer\\metadata.json';

function getCustomTitles() {
    try {
        if (fs.existsSync(METADATA_FILE)) {
            return JSON.parse(fs.readFileSync(METADATA_FILE, 'utf-8'));
        }
    } catch (e) {
        console.error("Failed to read metadata file:", e);
    }
    return {};
}

function parseMessage(msg) {
    if (!msg) return null;
    
    // Ignore checkpoint/system/etc
    if (msg.type === 'checkpoint' || msg.type === 'system' || msg.type === '$set') {
        return null;
    }
    
    let text = '';
    const contentVal = msg.content;
    if (Array.isArray(contentVal)) {
        // Only include non-thought content parts
        const cleanParts = contentVal.filter(p => !p.thought);
        text = cleanParts.map(p => p.text || '').join('');
    } else if (typeof contentVal === 'string') {
        text = contentVal;
    }
    
    const tool_info = [];
    const tool_calls = msg.toolCalls || [];
    for (const tc of tool_calls) {
        let outputStr = '';
        if (tc.result) {
            if (Array.isArray(tc.result) && tc.result.length > 0) {
                const resObj = tc.result[0];
                if (resObj.functionResponse && resObj.functionResponse.response) {
                    outputStr = resObj.functionResponse.response.output || JSON.stringify(resObj.functionResponse.response);
                } else {
                    outputStr = JSON.stringify(resObj);
                }
            } else {
                outputStr = typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result);
            }
        }
        
        tool_info.push({
            id: tc.id || '',
            name: tc.name,
            args: tc.args || {},
            status: tc.result ? 'success' : 'pending',
            output: outputStr
        });
    }
    
    const role = (msg.type === 'user') ? 'User' : 'Agent';
    
    return {
        role,
        text: text.trim(),
        tools: tool_info,
        timestamp: msg.timestamp
    };
}

app.use(express.static('public'));
app.use(express.json());

// Helper to read the first line and the last few lines of a file efficiently without loading all of it
function readFirstAndLastLines(filePath) {
    let fd;
    try {
        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        fd = fs.openSync(filePath, 'r');
        
        let firstLine = '';
        let lastChunk = '';
        
        // Read first 8KB to extract the first line
        const firstBufSize = Math.min(fileSize, 8192);
        if (firstBufSize > 0) {
            const firstBuf = Buffer.alloc(firstBufSize);
            fs.readSync(fd, firstBuf, 0, firstBufSize, 0);
            const firstStr = firstBuf.toString('utf8');
            const newlineIdx = firstStr.indexOf('\n');
            firstLine = newlineIdx !== -1 ? firstStr.substring(0, newlineIdx) : firstStr;
        }
        
        // Read last 64KB to extract the last few lines
        const lastBufSize = Math.min(fileSize, 65536);
        if (lastBufSize > 0) {
            const lastBuf = Buffer.alloc(lastBufSize);
            fs.readSync(fd, lastBuf, 0, lastBufSize, fileSize - lastBufSize);
            lastChunk = lastBuf.toString('utf8');
        }
        
        return { firstLine, lastChunk };
    } finally {
        if (fd !== undefined) {
            fs.closeSync(fd);
        }
    }
}

// Get all sessions
app.get('/api/sessions', (req, res) => {
    const sessions = [];
    const customTitles = getCustomTitles();
    
    // 1. Scan Legacy JSONL files
    if (fs.existsSync(LEGACY_DIR)) {
        try {
            const files = fs.readdirSync(LEGACY_DIR).filter(f => f.endsWith('.jsonl') || f.endsWith('.json'));
            for (const f of files) {
                const fullPath = path.join(LEGACY_DIR, f);
                const stat = fs.statSync(fullPath);
                
                let summary = 'Legacy Session';
                let id = f.replace('.jsonl', '').replace('.json', '');
                let date = stat.mtime;
                
                try {
                    const { firstLine, lastChunk } = readFirstAndLastLines(fullPath);
                    
                    if (f.endsWith('.json') && firstLine.trim() === '{') {
                        // Standard formatted JSON file
                        const fullContent = fs.readFileSync(fullPath, 'utf-8');
                        const parsed = JSON.parse(fullContent);
                        if (parsed.startTime) {
                            date = new Date(parsed.startTime);
                        }
                        if (parsed.messages && parsed.messages.length > 0) {
                            const firstMsg = parsed.messages[0];
                            if (firstMsg.content) {
                                if (Array.isArray(firstMsg.content)) {
                                    const cleanParts = firstMsg.content.filter(p => !p.thought);
                                    summary = cleanParts.map(p => p.text || '').join('');
                                } else if (typeof firstMsg.content === 'string') {
                                    summary = firstMsg.content;
                                }
                            }
                        }
                    } else {
                        // JSONL file
                        if (firstLine.trim()) {
                            const firstData = JSON.parse(firstLine);
                            if (firstData.startTime) {
                                date = new Date(firstData.startTime);
                            }
                        }
                        
                        if (lastChunk.trim()) {
                            // Find all instances of $set with summary in the last chunk
                            const matches = [...lastChunk.matchAll(/\{\"\$set\"[^}]*\"summary\"[^}]*\}/g)];
                            if (matches.length > 0) {
                                const lastMatch = matches[matches.length - 1][0];
                                try {
                                    const lastData = JSON.parse(lastMatch);
                                    if (lastData.$set && lastData.$set.summary) {
                                        const sumVal = lastData.$set.summary;
                                        if (sumVal.trim().startsWith('{')) {
                                            try {
                                                const inner = JSON.parse(sumVal);
                                                summary = inner.response || inner.summary || sumVal;
                                            } catch (e) {
                                                summary = sumVal;
                                            }
                                        } else {
                                            summary = sumVal;
                                        }
                                    }
                                } catch (e) {}
                            } else {
                                // Try to find $set with messages
                                const msgMatches = [...lastChunk.matchAll(/\{\"\$set\"[^}]*\"messages\"[^}]*\}/g)];
                                if (msgMatches.length > 0) {
                                    const lastMatch = msgMatches[msgMatches.length - 1][0];
                                    try {
                                        const lastData = JSON.parse(lastMatch);
                                        if (lastData.$set && Array.isArray(lastData.$set.messages) && lastData.$set.messages.length > 0) {
                                            const firstMsg = lastData.$set.messages.find(m => m.type === 'user');
                                            if (firstMsg && firstMsg.content) {
                                                if (Array.isArray(firstMsg.content)) {
                                                    const cleanParts = firstMsg.content.filter(p => !p.thought);
                                                    summary = cleanParts.map(p => p.text || '').join('');
                                                } else if (typeof firstMsg.content === 'string') {
                                                    summary = firstMsg.content;
                                                }
                                            }
                                        }
                                    } catch (e) {}
                                }
                                
                                // Fallback: try to parse the first User content in the file as a title
                                if (summary === 'Legacy Session') {
                                    const userMatches = [...lastChunk.matchAll(/\"type\":\"user\",\"content\":\[\{\"text\":\"([^\"]+)\"/g)];
                                    if (userMatches.length > 0) {
                                        summary = userMatches[0][1].replace(/\\n/g, ' ');
                                    }
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.error(`Error reading headers for legacy session ${f}:`, e);
                }
                
                if (summary.length > 80) {
                    summary = summary.substring(0, 77) + '...';
                }
                
                sessions.push({
                    id,
                    title: customTitles[id] || summary,
                    date,
                    source: 'legacy-jsonl',
                    size: (stat.size / (1024 * 1024)).toFixed(2) + ' MB',
                    file: fullPath
                });
            }
        } catch (e) {
            console.error("Error scanning legacy sessions:", e);
        }
    }
    
    // 2. Scan SQLite databases
    if (fs.existsSync(SQLITE_DIR)) {
        try {
            // Call Python script to extract metadata of all databases in one process spawn
            const stdout = execFileSync('python', ['dump_sqlite.py', '--scan', SQLITE_DIR], { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
            const dbs = JSON.parse(stdout);
            
            if (Array.isArray(dbs)) {
                for (const db of dbs) {
                    if (db.error) continue;
                    sessions.push({
                        id: db.id,
                        title: customTitles[db.id] || db.summary,
                        date: new Date(db.date),
                        source: 'sqlite',
                        size: (db.size / (1024 * 1024)).toFixed(2) + ' MB',
                        file: db.file
                    });
                }
            }
        } catch (e) {
            console.error("Error scanning SQLite database sessions:", e);
        }
    }
    
    // Sort by date descending
    sessions.sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json(sessions);
});

// Get specific session messages
app.get('/api/session/:id', (req, res) => {
    const { id } = req.params;
    const { source } = req.query;
    
    // Strict alphanumeric/UUID style check on session ID to block Path Traversal and Command Injection
    if (!/^[a-zA-Z0-9-]+$/.test(id)) {
        return res.status(400).json({ error: 'Invalid session ID format' });
    }
    
    let resolvedPath = '';
    
    if (source === 'sqlite') {
        resolvedPath = path.join(SQLITE_DIR, `${id}.db`);
        if (!resolvedPath.startsWith(SQLITE_DIR) || !fs.existsSync(resolvedPath)) {
            return res.status(404).json({ error: 'SQLite database session not found' });
        }
        
        // Call Python script using safe process execution API
        try {
            const stdout = execFileSync('python', ['dump_sqlite.py', resolvedPath], { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
            const data = JSON.parse(stdout);
            const customTitles = getCustomTitles();
            if (customTitles[id]) {
                data.summary = customTitles[id];
            }
            return res.json(data);
        } catch (e) {
            return res.status(500).json({ error: 'Failed to parse SQLite session: ' + e.message });
        }
    } else {
        // Resolve legacy JSONL path safely by looking for corresponding file in LEGACY_DIR
        try {
            const files = fs.readdirSync(LEGACY_DIR);
            let matchedFile = files.find(f => f === `${id}.jsonl` || f.endsWith(`${id}.jsonl`));
            if (!matchedFile) {
                matchedFile = files.find(f => f === `${id}.json` || f.endsWith(`${id}.json`));
            }
            if (!matchedFile) {
                return res.status(404).json({ error: 'Legacy session file not found' });
            }
            
            resolvedPath = path.join(LEGACY_DIR, matchedFile);
            if (!resolvedPath.startsWith(LEGACY_DIR) || !fs.existsSync(resolvedPath)) {
                return res.status(404).json({ error: 'Legacy session file path traversal blocked' });
            }
        } catch (e) {
            return res.status(500).json({ error: 'Failed to access legacy chat directory: ' + e.message });
        }
        
        // Parse legacy JSON/JSONL file
        try {
            const content = fs.readFileSync(resolvedPath, 'utf-8');
            const messages = [];
            let summary = 'Legacy Session';
            
            // Try to parse the file as a single JSON object (for standard .json files)
            let isStandardJson = false;
            try {
                const parsedData = JSON.parse(content.trim());
                if (parsedData && Array.isArray(parsedData.messages)) {
                    isStandardJson = true;
                    if (parsedData.sessionId) {
                        summary = parsedData.sessionId;
                    }
                    
                    for (const msg of parsedData.messages) {
                        const parsedMsg = parseMessage(msg);
                        if (parsedMsg) {
                            messages.push(parsedMsg);
                        }
                    }
                }
            } catch (jsonErr) {
                // Not standard JSON, fallback to line-by-line JSONL parsing
                isStandardJson = false;
            }
            
            if (!isStandardJson) {
                const lines = content.trim().split('\n');
                for (const line of lines) {
                    if (!line.trim()) continue;
                    let data;
                    try {
                        data = JSON.parse(line);
                    } catch (err) {
                        console.warn(`Ignoring malformed JSONL line in session ${id}: ${err.message}`);
                        continue;
                    }
                    
                    if (data.$set && Array.isArray(data.$set.messages)) {
                        // Re-initialize/overwrite messages list with the messages from $set.messages
                        messages.length = 0;
                        for (const msg of data.$set.messages) {
                            const parsedMsg = parseMessage(msg);
                            if (parsedMsg) {
                                messages.push(parsedMsg);
                            }
                        }
                    } else if (data.type && data.type !== 'checkpoint' && data.type !== 'system' && data.type !== '$set') {
                        const parsedMsg = parseMessage(data);
                        if (parsedMsg) {
                            messages.push(parsedMsg);
                        }
                    }
                    
                    if (data.$set && data.$set.summary) {
                        const sumVal = data.$set.summary;
                        if (sumVal.trim().startsWith('{')) {
                            try {
                                const inner = JSON.parse(sumVal);
                                summary = inner.response || inner.summary || sumVal;
                            } catch (e) {
                                summary = sumVal;
                            }
                        } else {
                            summary = sumVal;
                        }
                    }
                }
            }
            
            // Extract a summary from the first User message if we couldn't resolve a better title
            if (summary === 'Legacy Session' && messages.length > 0) {
                const firstUser = messages.find(m => m.role === 'User');
                if (firstUser && firstUser.text) {
                    summary = firstUser.text;
                }
            }
            if (summary.length > 80) {
                summary = summary.substring(0, 77) + '...';
            }
            
            const customTitles = getCustomTitles();
            const finalSummary = customTitles[id] || summary;
            return res.json({ id, summary: finalSummary, messages });
        } catch (e) {
            return res.status(500).json({ error: 'Failed to read session file: ' + e.message });
        }
    }
});

// Rename specific session
app.post('/api/session/:id/rename', (req, res) => {
    const { id } = req.params;
    const { title } = req.body;
    
    if (!/^[a-zA-Z0-9-]+$/.test(id)) {
        return res.status(400).json({ error: 'Invalid session ID format' });
    }
    if (typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ error: 'Invalid title value' });
    }
    
    try {
        let customTitles = {};
        if (fs.existsSync(METADATA_FILE)) {
            customTitles = JSON.parse(fs.readFileSync(METADATA_FILE, 'utf-8'));
        }
        customTitles[id] = title.trim();
        fs.writeFileSync(METADATA_FILE, JSON.stringify(customTitles, null, 2), 'utf-8');
        return res.json({ success: true, title: title.trim() });
    } catch (e) {
        return res.status(500).json({ error: 'Failed to update custom title: ' + e.message });
    }
});

// Delete specific session
app.delete('/api/session/:id', (req, res) => {
    const { id } = req.params;
    const { source } = req.query;
    
    if (!/^[a-zA-Z0-9-]+$/.test(id)) {
        return res.status(400).json({ error: 'Invalid session ID format' });
    }
    
    let resolvedPath = '';
    
    if (source === 'sqlite') {
        resolvedPath = path.join(SQLITE_DIR, `${id}.db`);
        if (!resolvedPath.startsWith(SQLITE_DIR)) {
            return res.status(400).json({ error: 'Path traversal blocked' });
        }
    } else {
        try {
            const files = fs.readdirSync(LEGACY_DIR);
            const matchedFile = files.find(f => f === `${id}.jsonl` || f === `${id}.json` || f.endsWith(`${id}.jsonl`) || f.endsWith(`${id}.json`));
            if (!matchedFile) {
                return res.status(404).json({ error: 'Session file not found' });
            }
            resolvedPath = path.join(LEGACY_DIR, matchedFile);
            if (!resolvedPath.startsWith(LEGACY_DIR)) {
                return res.status(400).json({ error: 'Path traversal blocked' });
            }
        } catch (e) {
            return res.status(500).json({ error: 'Failed to access legacy chat directory: ' + e.message });
        }
    }
    
    try {
        if (fs.existsSync(resolvedPath)) {
            fs.unlinkSync(resolvedPath);
            return res.json({ success: true });
        } else {
            return res.status(404).json({ error: 'Session file not found on disk' });
        }
    } catch (e) {
        return res.status(500).json({ error: 'Failed to delete session: ' + e.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
