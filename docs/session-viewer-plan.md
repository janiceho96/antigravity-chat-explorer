# Gemini & AI Agent Chat Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a local Node.js + Express application with a responsive split-pane UI to browse, search, and view all legacy `.jsonl` and active SQLite `.db` chat sessions.

**Architecture:** Express server (`server.js`) serving static files and API endpoints, calling a Python script (`dump_sqlite.py`) in the background to safely read/decode binary SQLite databases on Windows.

**Tech Stack:** Node.js, Express, Python (sqlite3), Vanilla HTML5/CSS3/JS.

---

## Files to Create

1. `C:\Users\User\gemini-chat-explorer\package.json` — Package configuration.
2. `C:\Users\User\gemini-chat-explorer\server.js` — Main Express web server.
3. `C:\Users\User\gemini-chat-explorer\dump_sqlite.py` — Python helper to dump binary SQLite logs to JSON.
4. `C:\Users\User\gemini-chat-explorer\public\index.html` — Main HTML dashboard layout.
5. `C:\Users\User\gemini-chat-explorer\public\style.css` — High-fidelity dark mode styling.
6. `C:\Users\User\gemini-chat-explorer\public\app.js` — Client-side AJAX, search, and DOM rendering.

---

### Task 1: Project Scaffolding
**Files:**
- Create: `C:\Users\User\gemini-chat-explorer\package.json`

- [ ] **Step 1: Write `package.json` configuration**
  Write package configuration with `express` and `dotenv` dependencies.
  ```json
  {
    "name": "gemini-chat-explorer",
    "version": "1.0.0",
    "description": "Browse and search legacy and active Gemini/AI CLI conversations",
    "main": "server.js",
    "type": "module",
    "scripts": {
      "start": "node server.js"
    },
    "dependencies": {
      "express": "^4.19.2"
    }
  }
  ```

- [ ] **Step 2: Install dependencies**
  Run: `npm install` inside `C:\Users\User\gemini-chat-explorer\`

---

### Task 2: SQLite Decoder Script (Python)
**Files:**
- Create: `C:\Users\User\gemini-chat-explorer\dump_sqlite.py`

- [ ] **Step 1: Write `dump_sqlite.py`**
  This script opens a SQLite `.db` conversation file and extracts step metadata/payloads, parsing ASCII/printable chunks to restore the dialog.
  ```python
  import sqlite3
  import json
  import sys
  import os
  import re

  def extract_printable_text(binary_data):
      if not binary_data:
          return ""
      # Find runs of printable characters
      pattern = re.compile(rb'[a-zA-Z0-9\s_.,:\-/\\{}|[\]"\']{15,}')
      matches = pattern.findall(binary_data)
      decoded_parts = []
      for m in matches:
          try:
              decoded_parts.append(m.decode('utf-8', errors='ignore'))
          except Exception:
              pass
      return "\n".join(decoded_parts)

  def parse_db(db_path):
      if not os.path.exists(db_path):
          return {"error": "File not found"}
      
      conn = sqlite3.connect(db_path)
      cur = conn.cursor()
      
      # Read metadata
      meta = {"id": os.path.basename(db_path).replace(".db", ""), "summary": "Active Workspace Session"}
      try:
          cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
          tables = [t[0] for t in cur.fetchall()]
          
          messages = []
          
          # In new CLI sqlite DBs, the steps table stores idx, step_payload (binary blob)
          if "steps" in tables:
              cur.execute("SELECT idx, step_type, status, step_payload FROM steps ORDER BY idx")
              for idx, step_type, status, payload in cur.fetchall():
                  if not payload:
                      continue
                  text = extract_printable_text(payload)
                  if text.strip():
                      # Categorize role (type 21 is command, type 15/14 is agent response, etc.)
                      role = "Agent"
                      if "CommandLine" in text:
                          role = "Tool Call"
                      elif "USER_INPUT" in text:
                          role = "User"
                      
                      messages.append({
                          "role": role,
                          "text": text,
                          "idx": idx
                      })
          return {"id": meta["id"], "summary": meta["summary"], "messages": messages}
      except Exception as e:
          return {"error": str(e)}
      finally:
          conn.close()

  if __name__ == "__main__":
      if len(sys.argv) < 2:
          print(json.dumps({"error": "No database path provided"}))
          sys.exit(1)
      print(json.dumps(parse_db(sys.argv[1]), ensure_ascii=False))
  ```

---

### Task 3: Express Web Server
**Files:**
- Create: `C:\Users\User\gemini-chat-explorer\server.js`

- [ ] **Step 1: Write `server.js`**
  ```javascript
  import express from 'express';
  import * as fs from 'node:fs';
  import * as path from 'node:path';
  import { execSync } from 'node:child_process';

  const app = express();
  const PORT = 3000;

  const LEGACY_DIR = 'C:\\Users\\User\\.gemini\\tmp\\user\\chats';
  const SQLITE_DIR = 'C:\\Users\\User\\.gemini\\antigravity-cli\\conversations';

  app.use(express.static('public'));

  // Get all sessions
  app.get('/api/sessions', (req, res) => {
      const sessions = [];
      
      // 1. Scan Legacy JSONL files
      if (fs.existsSync(LEGACY_DIR)) {
          const files = fs.readdirSync(LEGACY_DIR).filter(f => f.endsWith('.jsonl'));
          for (const f of files) {
              const fullPath = path.join(LEGACY_DIR, f);
              const stat = fs.statSync(fullPath);
              // Read first and last lines to extract metadata efficiently
              let summary = 'Legacy Session';
              let id = f.replace('.jsonl', '').split('-').pop();
              try {
                  const content = fs.readFileSync(fullPath, 'utf-8');
                  const lines = content.trim().split('\n');
                  if (lines.length > 0) {
                      const first = JSON.parse(lines[0]);
                      id = first.sessionId || id;
                  }
                  if (lines.length > 1) {
                      const last = JSON.parse(lines[lines.length - 1]);
                      if (last.$set && last.$set.summary) {
                          summary = last.$set.summary;
                      }
                  }
              } catch (e) {}
              
              sessions.append({
                  id,
                  title: summary,
                  date: stat.mtime,
                  source: 'legacy-jsonl',
                  size: (stat.size / (1024 * 1024)).toFixed(2) + ' MB',
                  file: fullPath
              });
          }
      }
      
      // 2. Scan SQLite databases
      if (fs.existsSync(SQLITE_DIR)) {
          const files = fs.readdirSync(SQLITE_DIR).filter(f => f.endsWith('.db'));
          for (const f of files) {
              const fullPath = path.join(SQLITE_DIR, f);
              const stat = fs.statSync(fullPath);
              sessions.append({
                  id: f.replace('.db', ''),
                  title: 'Active Workspace Session',
                  date: stat.mtime,
                  source: 'sqlite',
                  size: (stat.size / (1024 * 1024)).toFixed(2) + ' MB',
                  file: fullPath
              });
          }
      }
      
      // Sort by date descending
      sessions.sort((a, b) => new Date(b.date) - new Date(a.date));
      res.json(sessions);
  });

  // Get specific session messages
  app.get('/api/session/:id', (req, res) => {
      const { id } = req.params;
      const { source, file } = req.query;
      
      if (!file || !fs.existsSync(file)) {
          return res.status(404).json({ error: 'Chat file not found' });
      }
      
      if (source === 'sqlite') {
          // Call Python script to extract DB payload
          try {
              const stdout = execSync(`python dump_sqlite.py "${file}"`, { encoding: 'utf-8' });
              return res.json(JSON.parse(stdout));
          } catch (e) {
              return res.status(500).json({ error: 'Failed to read SQLite file: ' + e.message });
          }
      } else {
          // Parse legacy JSONL file
          try {
              const content = fs.readFileSync(file, 'utf-8');
              const lines = content.trim().split('\n');
              const messages = [];
              let summary = 'Legacy Session';
              
              for (const line of lines) {
                  const data = JSON.parse(line);
                  if (data.type === 'user' || data.type === 'gemini') {
                      let text = '';
                      const contentVal = data.content;
                      if (Array.isArray(contentVal)) {
                          text = contentVal.map(p => p.text || '').join('');
                      } else if (typeof contentVal === 'string') {
                          text = contentVal;
                      }
                      
                      const tool_info = [];
                      const tool_calls = data.toolCalls || [];
                      for (const tc of tool_calls) {
                          tool_info.push({
                              name: tc.name,
                              args: tc.args,
                              status: tc.status
                          });
                      }
                      
                      messages.push({
                          role: data.type === 'user' ? 'User' : 'Gemini',
                          text: text.strip(),
                          tools: tool_info,
                          timestamp: data.timestamp
                      });
                  } else if (data.$set && data.$set.summary) {
                      summary = data.$set.summary;
                  }
              }
              return res.json({ id, summary, messages });
          } catch (e) {
              return res.status(500).json({ error: 'Failed to read JSONL file: ' + e.message });
          }
      }
  });

  app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
  });
  ```

---

### Task 4: Frontend HTML UI Layout
**Files:**
- Create: `C:\Users\User\gemini-chat-explorer\public\index.html`

- [ ] **Step 1: Write HTML markup**
  Create dashboard scaffolding with filters, session panel list, and main conversation window.
  ```html
  <!DOCTYPE html>
  <html lang="en">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Gemini & AI Agent Chat Explorer</title>
      <link rel="stylesheet" href="style.css">
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&family=Plus+Jakarta+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
  </head>
  <body>
      <div class="app-container">
          <!-- Sidebar -->
          <aside class="sidebar">
              <div class="sidebar-header">
                  <h2>AI Agent Logs</h2>
                  <p class="sessions-count">Loading sessions...</p>
              </div>
              <div class="search-bar">
                  <input type="text" id="search-input" placeholder="Search chats, files, or tools...">
              </div>
              <div class="filter-group">
                  <button class="filter-btn active" data-filter="all">All</button>
                  <button class="filter-btn" data-filter="sqlite">Active</button>
                  <button class="filter-btn" data-filter="legacy-jsonl">Legacy</button>
              </div>
              <div class="sessions-list" id="sessions-container">
                  <!-- Dynamic session list items go here -->
              </div>
          </aside>

          <!-- Main Chat Panel -->
          <main class="chat-panel">
              <!-- Welcome State -->
              <div class="welcome-view" id="welcome-view">
                  <div class="welcome-card">
                      <h1>Chat Summary Explorer</h1>
                      <p>Select a workspace conversation from the sidebar to browse logs, trace code executions, and audit generated files.</p>
                  </div>
              </div>
              
              <!-- Chat Session View -->
              <div class="chat-view hidden" id="chat-view">
                  <div class="chat-header">
                      <div class="header-info">
                          <h1 id="session-title">Session Title</h1>
                          <span class="source-badge" id="session-badge">SQLite</span>
                      </div>
                      <div class="metadata">
                          <p>ID: <span id="session-id-display">-</span></p>
                      </div>
                  </div>
                  
                  <div class="chat-messages" id="messages-container">
                      <!-- Chat bubble nodes go here -->
                  </div>
              </div>
          </main>
      </div>
      <script src="app.js"></script>
  </body>
  </html>
  ```

---

### Task 5: Frontend Glassmorphic CSS Styling
**Files:**
- Create: `C:\Users\User\gemini-chat-explorer\public\style.css`

- [ ] **Step 1: Write styling sheet**
  Create a modern glassmorphic dashboard with a fluid custom scrollbar, gradient bubbles, and badge grids.
  ```css
  :root {
      --bg-color: #0b0f19;
      --card-bg: rgba(30, 41, 59, 0.45);
      --border-color: rgba(255, 255, 255, 0.08);
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --accent-color: #6366f1;
      --accent-glow: rgba(99, 102, 241, 0.3);
      --user-bubble: linear-gradient(135deg, #4f46e5, #6366f1);
      --ai-bubble: rgba(30, 41, 59, 0.6);
  }

  * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
  }

  body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background-color: var(--bg-color);
      color: var(--text-main);
      overflow: hidden;
      height: 100vh;
  }

  .app-container {
      display: grid;
      grid-template-columns: 350px 1fr;
      height: 100vh;
  }

  /* Sidebar styling */
  .sidebar {
      background-color: rgba(15, 23, 42, 0.6);
      border-right: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      height: 100%;
  }

  .sidebar-header {
      padding: 24px;
      border-bottom: 1px solid var(--border-color);
  }

  .sidebar-header h2 {
      font-family: 'Outfit', sans-serif;
      font-size: 1.5rem;
      font-weight: 700;
  }

  .sessions-count {
      color: var(--text-muted);
      font-size: 0.875rem;
      margin-top: 4px;
  }

  .search-bar {
      padding: 16px 24px;
  }

  .search-bar input {
      width: 100%;
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid var(--border-color);
      padding: 12px 16px;
      border-radius: 8px;
      color: var(--text-main);
      outline: none;
      transition: all 0.3s ease;
  }

  .search-bar input:focus {
      border-color: var(--accent-color);
      box-shadow: 0 0 10px var(--accent-glow);
  }

  .filter-group {
      display: flex;
      padding: 0 24px 16px;
      gap: 8px;
      border-bottom: 1px solid var(--border-color);
  }

  .filter-btn {
      background: none;
      border: 1px solid var(--border-color);
      padding: 6px 12px;
      border-radius: 6px;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 0.8rem;
      transition: all 0.2s ease;
  }

  .filter-btn.active, .filter-btn:hover {
      background: var(--accent-color);
      color: var(--text-main);
      border-color: var(--accent-color);
  }

  .sessions-list {
      flex: 1;
      overflow-y: auto;
      padding: 16px 24px;
      display: flex;
      flex-direction: column;
      gap: 12px;
  }

  /* Scrollbar Customization */
  ::-webkit-scrollbar {
      width: 6px;
  }
  ::-webkit-scrollbar-track {
      background: transparent;
  }
  ::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 10px;
  }
  ::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.25);
  }

  .session-card {
      background: var(--card-bg);
      border: 1px solid var(--border-color);
      padding: 16px;
      border-radius: 10px;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .session-card:hover {
      border-color: var(--accent-color);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(99, 102, 241, 0.15);
  }

  .session-card.selected {
      background: rgba(99, 102, 241, 0.12);
      border-color: var(--accent-color);
  }

  .card-title {
      font-size: 0.95rem;
      font-weight: 600;
      margin-bottom: 8px;
      line-height: 1.4;
  }

  .card-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.75rem;
      color: var(--text-muted);
  }

  .badge {
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.7rem;
      font-weight: bold;
      text-transform: uppercase;
  }

  .badge-sqlite { background: rgba(16, 185, 129, 0.15); color: #10b981; }
  .badge-legacy-jsonl { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }

  /* Main Panel styling */
  .chat-panel {
      background-color: var(--bg-color);
      display: flex;
      flex-direction: column;
      height: 100%;
  }

  .welcome-view {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      padding: 48px;
      text-align: center;
  }

  .welcome-card {
      max-width: 600px;
      background: var(--card-bg);
      border: 1px solid var(--border-color);
      padding: 40px;
      border-radius: 16px;
      backdrop-filter: blur(12px);
  }

  .welcome-card h1 {
      font-family: 'Outfit', sans-serif;
      font-size: 2.5rem;
      font-weight: 700;
      margin-bottom: 16px;
      background: linear-gradient(to right, #a5b4fc, #6366f1);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
  }

  .welcome-card p {
      color: var(--text-muted);
      line-height: 1.6;
  }

  .chat-view {
      display: flex;
      flex-direction: column;
      height: 100%;
  }

  .chat-header {
      padding: 24px 32px;
      border-bottom: 1px solid var(--border-color);
      backdrop-filter: blur(8px);
      z-index: 10;
  }

  .header-info {
      display: flex;
      align-items: center;
      gap: 12px;
  }

  .header-info h1 {
      font-family: 'Outfit', sans-serif;
      font-size: 1.5rem;
      font-weight: 600;
  }

  .chat-header .metadata {
      margin-top: 6px;
      font-size: 0.8rem;
      color: var(--text-muted);
  }

  .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 32px;
      display: flex;
      flex-direction: column;
      gap: 24px;
  }

  .message {
      max-width: 80%;
      display: flex;
      flex-direction: column;
      gap: 6px;
  }

  .message.user {
      align-self: flex-end;
  }

  .message.agent {
      align-self: flex-start;
  }

  .message-bubble {
      padding: 16px 20px;
      border-radius: 12px;
      line-height: 1.6;
      font-size: 0.95rem;
      word-break: break-word;
      white-space: pre-wrap;
  }

  .message.user .message-bubble {
      background: var(--user-bubble);
      color: #fff;
      border-bottom-right-radius: 2px;
      box-shadow: 0 4px 12px rgba(99, 102, 241, 0.25);
  }

  .message.agent .message-bubble {
      background: var(--ai-bubble);
      color: var(--text-main);
      border: 1px solid var(--border-color);
      border-bottom-left-radius: 2px;
      backdrop-filter: blur(4px);
  }

  .message-meta {
      font-size: 0.75rem;
      color: var(--text-muted);
  }

  .message.user .message-meta {
      text-align: right;
  }

  .tool-block {
      margin-top: 10px;
      border: 1px solid rgba(255, 255, 255, 0.05);
      background: rgba(15, 23, 42, 0.4);
      border-radius: 8px;
      overflow: hidden;
  }

  .tool-header {
      padding: 8px 12px;
      background: rgba(255, 255, 255, 0.03);
      font-size: 0.78rem;
      font-family: monospace;
      color: #38bdf8;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
  }

  .tool-args {
      padding: 12px;
      font-size: 0.8rem;
      font-family: monospace;
      background: rgba(0, 0, 0, 0.2);
      border-top: 1px solid rgba(255, 255, 255, 0.03);
      color: #a7f3d0;
      white-space: pre-wrap;
      overflow-x: auto;
  }

  .hidden {
      display: none !important;
  }
  ```

---

### Task 6: Frontend Client-Side App Logic
**Files:**
- Create: `C:\Users\User\gemini-chat-explorer\public\app.js`

- [ ] **Step 1: Write frontend logic**
  Implement search matching, list rendering, details requests, and responsive selection hooks.
  ```javascript
  let allSessions = [];
  let currentFilter = 'all';

  // Load initial sessions
  async function loadSessions() {
      try {
          const res = await fetch('/api/sessions');
          allSessions = await res.json();
          renderSessionsList();
      } catch (e) {
          console.error("Failed to load sessions:", e);
      }
  }

  function renderSessionsList() {
      const container = document.getElementById('sessions-container');
      container.innerHTML = '';
      
      const searchVal = document.getElementById('search-input').value.toLowerCase();
      
      const filtered = allSessions.filter(s => {
          const matchesSearch = s.title.toLowerCase().includes(searchVal) || s.id.includes(searchVal);
          const matchesType = currentFilter === 'all' || s.source === currentFilter;
          return matchesSearch && matchesType;
      });
      
      document.querySelector('.sessions-count').textContent = `${filtered.length} sessions found`;
      
      filtered.forEach(session => {
          const card = document.createElement('div');
          card.className = 'session-card';
          card.onclick = () => selectSession(session, card);
          
          const dateStr = new Date(session.date).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
          });
          
          card.innerHTML = `
              <div class="card-title">${session.title}</div>
              <div class="card-meta">
                  <span class="badge badge-${session.source}">${session.source === 'sqlite' ? 'Active' : 'Legacy'}</span>
                  <span>${dateStr}</span>
              </div>
          `;
          container.appendChild(card);
      });
  }

  async function selectSession(session, cardElement) {
      document.querySelectorAll('.session-card').forEach(c => c.classList.remove('selected'));
      cardElement.classList.add('selected');
      
      document.getElementById('welcome-view').classList.add('hidden');
      const chatView = document.getElementById('chat-view');
      chatView.classList.remove('hidden');
      
      document.getElementById('session-title').textContent = session.title;
      document.getElementById('session-id-display').textContent = session.id;
      
      const badge = document.getElementById('session-badge');
      badge.textContent = session.source === 'sqlite' ? 'Active Worktree' : 'Legacy';
      badge.className = `source-badge badge-${session.source}`;
      
      const messagesContainer = document.getElementById('messages-container');
      messagesContainer.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 20px;">Loading chat messages...</div>';
      
      try {
          const res = await fetch(`/api/session/${session.id}?source=${session.source}&file=${encodeURIComponent(session.file)}`);
          const chatData = await res.json();
          renderMessages(chatData.messages);
      } catch (e) {
          messagesContainer.innerHTML = `<div style="color: #ef4444; text-align: center; padding: 20px;">Error: ${e.message}</div>`;
      }
  }

  function renderMessages(messages) {
      const container = document.getElementById('messages-container');
      container.innerHTML = '';
      
      if (!messages || messages.length === 0) {
          container.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 20px;">No messages in this session.</div>';
          return;
      }
      
      messages.forEach(msg => {
          const msgNode = document.createElement('div');
          const isUser = msg.role.toLowerCase() === 'user';
          msgNode.className = `message ${isUser ? 'user' : 'agent'}`;
          
          let toolsHTML = '';
          if (msg.tools && msg.tools.length > 0) {
              msg.tools.forEach(tool => {
                  toolsHTML += `
                      <div class="tool-block">
                          <div class="tool-header" onclick="this.nextElementSibling.classList.toggle('hidden')">
                              <span>🔧 Tool: ${tool.name}</span>
                              <span style="font-size: 0.7rem; color: ${tool.status === 'success' ? '#10b981' : '#ef4444'}">${tool.status.toUpperCase()}</span>
                          </div>
                          <div class="tool-args hidden">${JSON.stringify(tool.args, null, 2)}</div>
                      </div>
                  `;
              });
          }
          
          msgNode.innerHTML = `
              <div class="message-bubble">${msg.text}</div>
              ${toolsHTML}
          `;
          container.appendChild(msgNode);
      });
      container.scrollTop = container.scrollHeight;
  }

  // Filter & Search bindings
  document.getElementById('search-input').addEventListener('input', renderSessionsList);

  document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.onclick = () => {
          document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          currentFilter = btn.dataset.filter;
          renderSessionsList();
      };
  });

  // Load app
  window.onload = loadSessions;
  ```
