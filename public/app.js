let allSessions = [];
let currentFilter = 'all';
let currentSessionMessages = [];
let currentSession = null;

// Load initial sessions
async function loadSessions() {
    try {
        const res = await fetch('/api/sessions');
        allSessions = await res.json();
        
        // Update dashboard welcome stats
        updateWelcomeStats();
        
        // Render the session cards
        renderSessionsList();
    } catch (e) {
        console.error("Failed to load sessions:", e);
    }
}

function updateWelcomeStats() {
    const sqliteCount = allSessions.filter(s => s.source === 'sqlite').length;
    const legacyCount = allSessions.filter(s => s.source === 'legacy-jsonl').length;
    
    document.getElementById('stat-sqlite').textContent = sqliteCount;
    document.getElementById('stat-legacy').textContent = legacyCount;
}

function renderSessionsList() {
    const container = document.getElementById('sessions-container');
    container.innerHTML = '';
    
    const searchVal = document.getElementById('search-input').value.toLowerCase();
    
    const filtered = allSessions.filter(s => {
        const matchesSearch = s.title.toLowerCase().includes(searchVal) || s.id.toLowerCase().includes(searchVal);
        const matchesType = currentFilter === 'all' || s.source === currentFilter;
        return matchesSearch && matchesType;
    });
    
    document.getElementById('session-count-badge').textContent = `${filtered.length} sessions`;
    
    if (filtered.length === 0) {
        container.innerHTML = '<div style="color: var(--text-dark); text-align: center; padding: 40px 10px; font-size: 0.85rem;">No conversations found</div>';
        return;
    }
    
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
            <div class="card-title">${session.title || 'Empty Session'}</div>
            <div class="card-meta">
                <span class="badge badge-${session.source}">${session.source === 'sqlite' ? 'Active' : 'Legacy'}</span>
                <span>${dateStr}</span>
            </div>
        `;
        container.appendChild(card);
    });
}

async function selectSession(session, cardElement) {
    currentSession = session;
    document.querySelectorAll('.session-card').forEach(c => c.classList.remove('selected'));
    cardElement.classList.add('selected');
    
    document.getElementById('welcome-view').classList.add('hidden');
    const chatView = document.getElementById('chat-view');
    chatView.classList.remove('hidden');
    
    document.getElementById('session-title').textContent = session.title;
    document.getElementById('session-path-display').textContent = session.file;
    document.getElementById('size-display').textContent = session.size;
    
    const badge = document.getElementById('session-badge');
    badge.textContent = session.source === 'sqlite' ? 'Active Workspace' : 'Legacy Log';
    badge.className = `source-badge badge-${session.source}`;
    
    const messagesContainer = document.getElementById('messages-container');
    messagesContainer.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 40px;">Parsing dialogue steps and loading messages...</div>';
    
    try {
        const res = await fetch(`/api/session/${session.id}?source=${session.source}`);
        const chatData = await res.json();
        
        if (chatData.error) {
            messagesContainer.innerHTML = `<div style="color: var(--fail-color); text-align: center; padding: 40px;">Error: ${chatData.error}</div>`;
            document.getElementById('msg-count-display').textContent = '0';
            currentSessionMessages = [];
        } else {
            document.getElementById('msg-count-display').textContent = chatData.messages ? chatData.messages.length : '0';
            currentSessionMessages = chatData.messages || [];
            renderMessages(chatData.messages);
            
            if (document.getElementById('tab-revision').classList.contains('active')) {
                generateRevisionDeck(currentSessionMessages);
            } else {
                document.getElementById('revision-container').innerHTML = '';
            }
        }
    } catch (e) {
        messagesContainer.innerHTML = `<div style="color: var(--fail-color); text-align: center; padding: 40px;">Error: ${e.message}</div>`;
        document.getElementById('msg-count-display').textContent = '0';
    }
}

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Quick inline formatting for basic markdown elements (bold, lists, code blocks, etc.)
function formatMarkdown(text) {
    if (!text) return '';
    
    const lines = text.split('\n');
    let inList = false;
    let listType = null;
    let result = [];
    
    lines.forEach(line => {
        const trimmed = line.trim();
        const isBullet = trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('+ ');
        const isNumbered = /^\d+\.\s/.test(trimmed);
        
        let escapedLine = escapeHtml(line);
        escapedLine = escapedLine.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        escapedLine = escapedLine.replace(/`([^`]+)`/g, '<code style="background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; font-family: var(--font-mono); font-size: 0.85em; color: #a7f3d0;">$1</code>');
        
        if (isBullet || isNumbered) {
            const currentType = isBullet ? 'ul' : 'ol';
            if (!inList) {
                result.push(`<${currentType} style="margin: 8px 0 8px 20px; padding: 0; list-style-type: ${isBullet ? 'disc' : 'decimal'}; white-space: normal;">`);
                inList = true;
                listType = currentType;
            } else if (listType !== currentType) {
                result.push(`</${listType}><${currentType} style="margin: 8px 0 8px 20px; padding: 0; list-style-type: ${isBullet ? 'disc' : 'decimal'}; white-space: normal;">`);
                listType = currentType;
            }
            const cleanLine = escapedLine.replace(/^(\s*[\-\*\+]\s+|\s*\d+\.\s+)/, '');
            result.push(`<li style="margin-bottom: 4px; color: var(--text-main); white-space: normal;">${cleanLine}</li>`);
        } else {
            if (inList) {
                result.push(`</${listType}>`);
                inList = false;
                listType = null;
            }
            result.push(escapedLine);
        }
    });
    
    if (inList) {
        result.push(`</${listType}>`);
    }
    
    return result.join('\n');
}

function renderMessages(messages) {
    const container = document.getElementById('messages-container');
    container.innerHTML = '';
    
    if (!messages || messages.length === 0) {
        container.innerHTML = '<div style="color: var(--text-dark); text-align: center; padding: 40px;">No dialogue turns found in this session.</div>';
        return;
    }
    
    messages.forEach(msg => {
        const wrapper = document.createElement('div');
        wrapper.className = 'message-wrapper';
        
        const isUser = msg.role.toLowerCase() === 'user';
        
        const dateStr = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }) : '';
        
        // Build tool execution layout
        let toolsHTML = '';
        if (msg.tools && msg.tools.length > 0) {
            toolsHTML += '<div class="tools-grid">';
            msg.tools.forEach(tool => {
                const toolId = tool.id || Math.random().toString(36).substring(7);
                const argsStr = typeof tool.args === 'string' ? tool.args : JSON.stringify(tool.args, null, 2);
                const outputStr = tool.output || 'No output captured (void function or silent tool).';
                
                const escapedName = escapeHtml(tool.name);
                const escapedStatus = escapeHtml(tool.status);
                const escapedStatusUpper = escapedStatus.toUpperCase();
                
                toolsHTML += `
                    <div class="tool-block">
                        <div class="tool-header" onclick="document.getElementById('body-${toolId}').classList.toggle('hidden')">
                            <div class="tool-header-left">
                                <span class="tool-badge">Tool</span>
                                <strong>${escapedName}</strong>
                            </div>
                            <span class="tool-status ${escapedStatus}">${escapedStatusUpper}</span>
                        </div>
                        <div class="tool-body hidden" id="body-${toolId}">
                            <div class="tool-section">
                                <div class="tool-section-title">Arguments</div>
                                <pre class="tool-args">${escapeHtml(argsStr)}</pre>
                            </div>
                            <div class="tool-section">
                                <div class="tool-section-title">Execution Result</div>
                                <pre class="tool-output">${escapeHtml(outputStr)}</pre>
                            </div>
                        </div>
                    </div>
                `;
            });
            toolsHTML += '</div>';
        }
        
        wrapper.innerHTML = `
            <div class="message ${isUser ? 'user' : 'agent'}">
                <div class="message-meta">
                    <span class="sender-name ${isUser ? 'sender-name-user' : 'sender-name-agent'}">${isUser ? 'User' : 'Assistant'}</span>
                    ${dateStr ? `<span>${dateStr}</span>` : ''}
                </div>
                <div class="message-bubble">${formatMarkdown(msg.text)}</div>
                ${toolsHTML}
            </div>
        `;
        container.appendChild(wrapper);
    });
    
    // Auto-scroll to the bottom of conversation log
    container.scrollTop = container.scrollHeight;
}

// Bind search and filter events
document.getElementById('search-input').addEventListener('input', renderSessionsList);

document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        renderSessionsList();
    };
});

// Tab Switching & Saving Spaces
let activeRevisionCards = {};

function getSavedCards() {
    try {
        const data = localStorage.getItem('saved_revision_cards');
        return data ? JSON.parse(data) : {};
    } catch (e) {
        console.error("Error reading saved cards:", e);
        return {};
    }
}

function saveSavedCards(cards) {
    try {
        localStorage.setItem('saved_revision_cards', JSON.stringify(cards));
    } catch (e) {
        console.error("Error saving cards:", e);
    }
}

function handleCardCheckboxChange(cardId) {
    const saved = getSavedCards();
    if (saved[cardId]) {
        delete saved[cardId];
    } else {
        const cardData = activeRevisionCards[cardId];
        if (cardData) {
            saved[cardId] = cardData;
        }
    }
    saveSavedCards(saved);
    
    // Sync all checkboxes for this cardId across tabs
    document.querySelectorAll(`.save-card-checkbox[data-card-id="${cardId}"]`).forEach(cb => {
        cb.checked = !!saved[cardId];
    });
    
    // If we're on the saved space tab, re-render to reflect removal
    if (document.getElementById('tab-saved').classList.contains('active')) {
        renderSavedSpace();
    }
}
window.handleCardCheckboxChange = handleCardCheckboxChange;

function renderSavedSpace() {
    const container = document.getElementById('saved-container');
    container.innerHTML = '';
    
    const saved = getSavedCards();
    const savedList = Object.values(saved);
    
    if (savedList.length === 0) {
        container.innerHTML = `
            <div style="color: var(--text-dark); text-align: center; padding: 60px 20px; grid-column: 1 / -1;">
                <div style="font-size: 2.2rem; margin-bottom: 16px; filter: drop-shadow(0 0 8px var(--accent-color));">⭐</div>
                <h3 style="font-family: var(--font-heading); font-size: 1.15rem; color: var(--text-main); margin-bottom: 6px;">Your Revision Space is Empty</h3>
                <p style="font-size: 0.85rem; color: var(--text-muted); max-width: 320px; margin: 0 auto; line-height: 1.5;">
                    Browse the <strong>Revision Deck</strong> of any chat log and tick the checkbox on any card to save it here.
                </p>
            </div>
        `;
        return;
    }
    
    savedList.forEach(cardData => {
        // Cache in activeRevisionCards so they can be unchecked/toggled
        activeRevisionCards[cardData.id] = cardData;
        
        const card = document.createElement('div');
        card.className = `revision-card ${cardData.category}`;
        
        card.innerHTML = `
            <div class="card-header">
                <span class="card-badge ${cardData.badgeClass}">${cardData.badgeText}</span>
                <div style="display: flex; align-items: center; gap: 12px;">
                    <label class="card-save-control">
                        <input type="checkbox" class="save-card-checkbox" checked data-card-id="${cardData.id}" onchange="handleCardCheckboxChange('${cardData.id}')">
                        <span style="font-size: 0.72rem; font-weight: 600; color: var(--accent-color);">Saved</span>
                    </label>
                    <span class="card-date">${cardData.timeStr}</span>
                </div>
            </div>
            <div class="session-reference-title" style="font-size: 0.65rem; color: var(--accent-color); font-weight: 700; text-transform: uppercase; margin-bottom: -4px; letter-spacing: 0.03em;">
                From: ${escapeHtml(cardData.sessionTitle)}
            </div>
            <div class="card-field">
                <span class="field-title">Active Prompt</span>
                <div class="field-prompt">${formatMarkdown(cardData.promptText)}</div>
            </div>
            ${cardData.fieldsHTML}
        `;
        container.appendChild(card);
    });
}

function setActiveTab(tab) {
    document.getElementById('tab-dialogue').classList.toggle('active', tab === 'dialogue');
    document.getElementById('tab-revision').classList.toggle('active', tab === 'revision');
    document.getElementById('tab-saved').classList.toggle('active', tab === 'saved');
    
    document.getElementById('messages-container').classList.toggle('hidden', tab !== 'dialogue');
    document.getElementById('revision-container').classList.toggle('hidden', tab !== 'revision');
    document.getElementById('saved-container').classList.toggle('hidden', tab !== 'saved');
    
    if (tab === 'revision') {
        generateRevisionDeck(currentSessionMessages);
    } else if (tab === 'saved') {
        renderSavedSpace();
    }
}

// Tab Switching Event Handlers
document.getElementById('tab-dialogue').addEventListener('click', () => setActiveTab('dialogue'));
document.getElementById('tab-revision').addEventListener('click', () => setActiveTab('revision'));
document.getElementById('tab-saved').addEventListener('click', () => setActiveTab('saved'));

// Theme toggle click handler
document.getElementById('theme-toggle').addEventListener('click', () => {
    const isLight = document.body.classList.toggle('light-theme');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
});

// Rename session click handler
document.getElementById('rename-session-btn').addEventListener('click', async () => {
    if (!currentSession) return;
    
    const newTitle = prompt("Enter a new name for this conversation:", currentSession.title);
    if (newTitle === null) return; // cancelled
    
    const trimmedTitle = newTitle.trim();
    if (!trimmedTitle) {
        alert("Conversation name cannot be empty.");
        return;
    }
    
    try {
        const res = await fetch(`/api/session/${currentSession.id}/rename`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ title: trimmedTitle })
        });
        
        const data = await res.json();
        if (data.success) {
            // Update local memory
            currentSession.title = data.title;
            document.getElementById('session-title').textContent = data.title;
            
            // Also update the session list details if we have it loaded in memory
            const matched = allSessions.find(s => s.id === currentSession.id);
            if (matched) {
                matched.title = data.title;
            }
            
            // Re-render session list to update titles in sidebar
            renderSessionsList();
        } else {
            alert(`Failed to rename session: ${data.error}`);
        }
    } catch (e) {
        alert(`Error renaming session: ${e.message}`);
    }
});

// Delete session click handler
document.getElementById('delete-session-btn').addEventListener('click', async () => {
    if (!currentSession) return;
    
    const confirmDelete = confirm(`Are you sure you want to delete the conversation history for "${currentSession.title}"? This cannot be undone.`);
    if (!confirmDelete) return;
    
    try {
        const res = await fetch(`/api/session/${currentSession.id}?source=${currentSession.source}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        
        if (data.success) {
            // Reset active states and hide chat view
            document.getElementById('chat-view').classList.add('hidden');
            document.getElementById('welcome-view').classList.remove('hidden');
            currentSession = null;
            currentSessionMessages = [];
            
            // Reload session list from server
            await loadSessions();
        } else {
            alert(`Failed to delete session: ${data.error}`);
        }
    } catch (e) {
        alert(`Error deleting session: ${e.message}`);
    }
});

function generateRevisionDeck(messages) {
    const container = document.getElementById('revision-container');
    container.innerHTML = '';
    
    if (!messages || messages.length === 0) {
        container.innerHTML = '<div style="color: var(--text-dark); text-align: center; padding: 40px; grid-column: 1 / -1;">No revision elements found in this session.</div>';
        return;
    }
    
    activeRevisionCards = {};
    const savedCards = getSavedCards();
    let currentPrompt = "Initial Session Setup";
    let cardCount = 0;
    
    messages.forEach((msg, msgIdx) => {
        const isUser = msg.role.toLowerCase() === 'user';
        if (isUser) {
            currentPrompt = msg.text || "Empty prompt";
            return;
        }
        
        // Process tool calls in Agent message
        if (msg.tools && msg.tools.length > 0) {
            msg.tools.forEach((tool, toolIdx) => {
                const card = document.createElement('div');
                let category = 'cat-findings';
                let badgeClass = 'badge-findings';
                let badgeText = 'Tool Action';
                let fieldsHTML = '';
                
                const toolName = (tool.name || '').toLowerCase();
                
                if (['run_command', 'exec', 'shell', 'ctx_shell', 'command'].some(n => toolName.includes(n))) {
                    category = 'cat-terminal';
                    badgeClass = 'badge-terminal';
                    badgeText = 'Command';
                    
                    const cmd = tool.args?.CommandLine || tool.args?.command || (typeof tool.args === 'string' ? tool.args : JSON.stringify(tool.args));
                    fieldsHTML = `
                        <div class="card-field">
                            <span class="field-title">Command Run</span>
                            <pre class="field-content">${escapeHtml(cmd)}</pre>
                        </div>
                        <div class="card-field">
                            <span class="field-title">Terminal Output</span>
                            <pre class="field-content">${escapeHtml(tool.output || 'No output captured.')}</pre>
                        </div>
                    `;
                } else if (['write_to_file', 'replace_file_content', 'multi_replace_file_content', 'write_file', 'edit_file', 'ctx_edit'].some(n => toolName.includes(n))) {
                    category = 'cat-code';
                    badgeClass = 'badge-code';
                    badgeText = 'Code Edit';
                    
                    const filePath = tool.args?.TargetFile || tool.args?.path || 'Unknown File';
                    let codeText = '';
                    if (tool.args?.CodeContent) {
                        codeText = tool.args.CodeContent;
                    } else if (tool.args?.ReplacementContent) {
                        codeText = tool.args.ReplacementContent;
                    } else if (tool.args?.ReplacementChunks) {
                        codeText = typeof tool.args.ReplacementChunks === 'string' 
                            ? tool.args.ReplacementChunks 
                            : JSON.stringify(tool.args.ReplacementChunks, null, 2);
                    } else {
                        codeText = typeof tool.args === 'string' ? tool.args : JSON.stringify(tool.args, null, 2);
                    }
                    
                    fieldsHTML = `
                        <div class="card-field">
                            <span class="field-title">Target File</span>
                            <div style="font-family: var(--font-mono); font-size: 0.8rem; color: #10b981; word-break: break-all;">${escapeHtml(filePath)}</div>
                        </div>
                        <div class="card-field">
                            <span class="field-title">Code Content</span>
                            <pre class="field-content">${escapeHtml(codeText)}</pre>
                        </div>
                    `;
                } else if (['search_web', 'grep_search', 'read_url_content', 'view_file', 'list_dir', 'ctx_read', 'ctx_search', 'ctx_tree'].some(n => toolName.includes(n))) {
                    category = 'cat-research';
                    badgeClass = 'badge-research';
                    badgeText = 'Research';
                    
                    const query = tool.args?.query || tool.args?.Query || tool.args?.SearchPath || tool.args?.AbsolutePath || tool.args?.Url || tool.args?.path || JSON.stringify(tool.args);
                    fieldsHTML = `
                        <div class="card-field">
                            <span class="field-title">Query / Path</span>
                            <pre class="field-content">${escapeHtml(query)}</pre>
                        </div>
                        <div class="card-field">
                            <span class="field-title">Results</span>
                            <pre class="field-content">${escapeHtml(tool.output || 'No output.')}</pre>
                        </div>
                    `;
                } else {
                    category = 'cat-research';
                    badgeClass = 'badge-research';
                    badgeText = tool.name || 'Tool';
                    
                    fieldsHTML = `
                        <div class="card-field">
                            <span class="field-title">Arguments</span>
                            <pre class="field-content">${escapeHtml(JSON.stringify(tool.args, null, 2))}</pre>
                        </div>
                        <div class="card-field">
                            <span class="field-title">Result</span>
                            <pre class="field-content">${escapeHtml(tool.output || 'No output.')}</pre>
                        </div>
                    `;
                }
                
                const timeStr = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString(undefined, {
                    hour: '2-digit',
                    minute: '2-digit'
                }) : `Step ${msgIdx}`;
                
                const cardId = `${currentSession.id}_tool_${msgIdx}_${toolIdx}_${tool.name || 'action'}`;
                const isSaved = !!savedCards[cardId];
                
                activeRevisionCards[cardId] = {
                    id: cardId,
                    sessionId: currentSession.id,
                    sessionTitle: currentSession.title,
                    category,
                    badgeClass,
                    badgeText,
                    timeStr,
                    promptText: currentPrompt,
                    fieldsHTML
                };
                
                card.className = `revision-card ${category}`;
                card.innerHTML = `
                    <div class="card-header">
                        <span class="card-badge ${badgeClass}">${badgeText}</span>
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <label class="card-save-control">
                                <input type="checkbox" class="save-card-checkbox" ${isSaved ? 'checked' : ''} data-card-id="${cardId}" onchange="handleCardCheckboxChange('${cardId}')">
                                <span>Save</span>
                            </label>
                            <span class="card-date">${timeStr}</span>
                        </div>
                    </div>
                    <div class="card-field">
                        <span class="field-title">Active Prompt</span>
                        <div class="field-prompt">${formatMarkdown(currentPrompt)}</div>
                    </div>
                    ${fieldsHTML}
                `;
                container.appendChild(card);
                cardCount++;
            });
        }
        
        // Extract code snippets from text
        if (msg.text) {
            const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
            let match;
            let snippetIdx = 0;
            while ((match = codeBlockRegex.exec(msg.text)) !== null) {
                const lang = match[1] || 'code';
                const code = match[2];
                if (!code || code.trim().length === 0) continue;
                
                const card = document.createElement('div');
                card.className = 'revision-card cat-code';
                
                const timeStr = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString(undefined, {
                    hour: '2-digit',
                    minute: '2-digit'
                }) : `Step ${msgIdx}`;
                
                const cardId = `${currentSession.id}_code_${msgIdx}_${snippetIdx}`;
                const isSaved = !!savedCards[cardId];
                
                const fieldsHTML = `
                    <div class="card-field">
                        <span class="field-title">Snippet Details</span>
                        <pre class="field-content">${escapeHtml(code)}</pre>
                    </div>
                `;
                
                activeRevisionCards[cardId] = {
                    id: cardId,
                    sessionId: currentSession.id,
                    sessionTitle: currentSession.title,
                    category: 'cat-code',
                    badgeClass: 'badge-code',
                    badgeText: `Code Snippet (${lang})`,
                    timeStr,
                    promptText: currentPrompt,
                    fieldsHTML
                };
                
                card.innerHTML = `
                    <div class="card-header">
                        <span class="card-badge badge-code">Code Snippet (${lang})</span>
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <label class="card-save-control">
                                <input type="checkbox" class="save-card-checkbox" ${isSaved ? 'checked' : ''} data-card-id="${cardId}" onchange="handleCardCheckboxChange('${cardId}')">
                                <span>Save</span>
                            </label>
                            <span class="card-date">${timeStr}</span>
                        </div>
                    </div>
                    <div class="card-field">
                        <span class="field-title">Active Prompt</span>
                        <div class="field-prompt">${formatMarkdown(currentPrompt)}</div>
                    </div>
                    ${fieldsHTML}
                `;
                container.appendChild(card);
                cardCount++;
                snippetIdx++;
            }
            
            // Extract explicitly marked sections (findings/conclusions/recs)
            const lines = msg.text.split('\n');
            const sections = [];
            let currentSectionTitle = null;
            let currentSectionLines = [];
            
            lines.forEach(line => {
                const headingMatch = line.match(/^#+\s+(Strengths|Issues|Key\s+Findings|Findings|Results|Recommendations|Assessment|Conclusions|Summary|Findings\s+&amp;\s+Insights|Insights|Key\s+Points|Key\s+Discoveries|Vulnerability|Vulnerabilities|Security\s+Risks|Next\s+Steps)(.*)/i);
                if (headingMatch) {
                    if (currentSectionTitle && currentSectionLines.length > 0) {
                        sections.push({
                            title: currentSectionTitle,
                            content: currentSectionLines.join('\n')
                        });
                    }
                    currentSectionTitle = headingMatch[1] + (headingMatch[2] || '');
                    currentSectionLines = [];
                } else {
                    if (currentSectionTitle) {
                        currentSectionLines.push(line);
                    }
                }
            });
            
            if (currentSectionTitle && currentSectionLines.length > 0) {
                sections.push({
                    title: currentSectionTitle,
                    content: currentSectionLines.join('\n')
                });
            }
            
            if (sections.length > 0) {
                sections.forEach((sec, secIdx) => {
                    const card = document.createElement('div');
                    card.className = 'revision-card cat-findings';
                    
                    const timeStr = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString(undefined, {
                        hour: '2-digit',
                        minute: '2-digit'
                    }) : `Step ${msgIdx}`;
                    
                    const cardId = `${currentSession.id}_section_${msgIdx}_${secIdx}`;
                    const isSaved = !!savedCards[cardId];
                    
                    const fieldsHTML = `
                        <div class="card-field">
                            <span class="field-title">Details</span>
                            <div class="field-findings">${formatMarkdown(sec.content)}</div>
                        </div>
                    `;
                    
                    activeRevisionCards[cardId] = {
                        id: cardId,
                        sessionId: currentSession.id,
                        sessionTitle: currentSession.title,
                        category: 'cat-findings',
                        badgeClass: 'badge-findings',
                        badgeText: `Finding: ${sec.title}`,
                        timeStr,
                        promptText: currentPrompt,
                        fieldsHTML
                    };
                    
                    card.innerHTML = `
                        <div class="card-header">
                            <span class="card-badge badge-findings">Finding: ${escapeHtml(sec.title)}</span>
                            <div style="display: flex; align-items: center; gap: 12px;">
                                <label class="card-save-control">
                                    <input type="checkbox" class="save-card-checkbox" ${isSaved ? 'checked' : ''} data-card-id="${cardId}" onchange="handleCardCheckboxChange('${cardId}')">
                                    <span>Save</span>
                                </label>
                                <span class="card-date">${timeStr}</span>
                            </div>
                        </div>
                        <div class="card-field">
                            <span class="field-title">Active Prompt</span>
                            <div class="field-prompt">${formatMarkdown(currentPrompt)}</div>
                        </div>
                        ${fieldsHTML}
                    `;
                    container.appendChild(card);
                    cardCount++;
                });
            } else {
                // Look for callouts
                const callouts = [];
                let inCallout = false;
                let currentCallout = [];
                
                lines.forEach(line => {
                    if (line.trim().startsWith('>')) {
                        inCallout = true;
                        currentCallout.push(line.trim().substring(1).trim());
                    } else if (inCallout) {
                        callouts.push(currentCallout.join('\n'));
                        currentCallout = [];
                        inCallout = false;
                    }
                });
                if (inCallout && currentCallout.length > 0) {
                    callouts.push(currentCallout.join('\n'));
                }
                
                if (callouts.length > 0) {
                    callouts.forEach((callout, calloutIdx) => {
                        const card = document.createElement('div');
                        card.className = 'revision-card cat-findings';
                        
                        const timeStr = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString(undefined, {
                            hour: '2-digit',
                            minute: '2-digit'
                        }) : `Step ${msgIdx}`;
                        
                        const cardId = `${currentSession.id}_callout_${msgIdx}_${calloutIdx}`;
                        const isSaved = !!savedCards[cardId];
                        
                        const fieldsHTML = `
                            <div class="card-field">
                                <span class="field-title">Content</span>
                                <div class="field-findings">${formatMarkdown(callout)}</div>
                            </div>
                        `;
                        
                        activeRevisionCards[cardId] = {
                            id: cardId,
                            sessionId: currentSession.id,
                            sessionTitle: currentSession.title,
                            category: 'cat-findings',
                            badgeClass: 'badge-findings',
                            badgeText: 'Insight / Callout',
                            timeStr,
                            promptText: currentPrompt,
                            fieldsHTML
                        };
                        
                        card.innerHTML = `
                            <div class="card-header">
                                <span class="card-badge badge-findings">Insight / Callout</span>
                                <div style="display: flex; align-items: center; gap: 12px;">
                                    <label class="card-save-control">
                                        <input type="checkbox" class="save-card-checkbox" ${isSaved ? 'checked' : ''} data-card-id="${cardId}" onchange="handleCardCheckboxChange('${cardId}')">
                                        <span>Save</span>
                                    </label>
                                    <span class="card-date">${timeStr}</span>
                                </div>
                            </div>
                            <div class="card-field">
                                <span class="field-title">Active Prompt</span>
                                <div class="field-prompt">${formatMarkdown(currentPrompt)}</div>
                            </div>
                            ${fieldsHTML}
                        `;
                        container.appendChild(card);
                        cardCount++;
                    });
                } else {
                    // Extract Bullet Points if there are enough
                    const bullets = lines.filter(l => l.trim().match(/^([\-\*\+]\s|\d+\.\s)/));
                    if (bullets.length >= 2) {
                        const card = document.createElement('div');
                        card.className = 'revision-card cat-findings';
                        
                        const timeStr = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString(undefined, {
                            hour: '2-digit',
                            minute: '2-digit'
                        }) : `Step ${msgIdx}`;
                        
                        const cardId = `${currentSession.id}_bullets_${msgIdx}`;
                        const isSaved = !!savedCards[cardId];
                        
                        const fieldsHTML = `
                            <div class="card-field">
                                <span class="field-title">Key Points</span>
                                <div class="field-findings">${formatMarkdown(bullets.join('\n'))}</div>
                            </div>
                        `;
                        
                        activeRevisionCards[cardId] = {
                            id: cardId,
                            sessionId: currentSession.id,
                            sessionTitle: currentSession.title,
                            category: 'cat-findings',
                            badgeClass: 'badge-findings',
                            badgeText: 'Key Observations',
                            timeStr,
                            promptText: currentPrompt,
                            fieldsHTML
                        };
                        
                        card.innerHTML = `
                            <div class="card-header">
                                <span class="card-badge badge-findings">Key Observations</span>
                                <div style="display: flex; align-items: center; gap: 12px;">
                                    <label class="card-save-control">
                                        <input type="checkbox" class="save-card-checkbox" ${isSaved ? 'checked' : ''} data-card-id="${cardId}" onchange="handleCardCheckboxChange('${cardId}')">
                                        <span>Save</span>
                                    </label>
                                    <span class="card-date">${timeStr}</span>
                                </div>
                            </div>
                            <div class="card-field">
                                <span class="field-title">Active Prompt</span>
                                <div class="field-prompt">${formatMarkdown(currentPrompt)}</div>
                            </div>
                            ${fieldsHTML}
                        `;
                        container.appendChild(card);
                        cardCount++;
                    }
                }
            }
        }
    });
    
    if (cardCount === 0) {
        container.innerHTML = '<div style="color: var(--text-dark); text-align: center; padding: 40px; grid-column: 1 / -1;">No revision elements parsed in this session. Use the dialogue feed to browse raw messages.</div>';
    }
}

// Load the app on load
window.onload = () => {
    // Apply saved theme
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
        document.body.classList.add('light-theme');
    }
    loadSessions();
};
