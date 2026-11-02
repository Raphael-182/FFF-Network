const LEAGUE_ID = "1337435000663986176";
let usersData = {};
let rostersData = [];
let currentNFLWeek = 1;
let actualSleeperWeek = 1;
let playerDictionary = {};

let draftYears = [2027, 2028, 2029]; 
let draftRounds = [1, 2, 3, 4, 5, 6];

let globalAllMatchups = []; 
let globalAllTrades = []; 
let globalDraftPicks = {}; 
let globalPowerRankings = {};
let globalTrophies = {}; 
let activeStreaksGlobal = {}; 
window.allDraftPicks = window.allDraftPicks || {};
window.allDraftsInfo = window.allDraftsInfo || {};
window.playerSeasonLogs = {};

let historicalDataLoaded = false;
let historicalDataLoading = false;
let livePollingInterval = null;

function triggerHaptic() {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(15);
    }
}

function startLivePolling() {
    const day = new Date().getDay(); 
    if (day === 0 || day === 1 || day === 4) {
        document.getElementById('live-badge').classList.remove('hidden');
        if (!livePollingInterval) {
            livePollingInterval = setInterval(() => {
                fetchAndRenderScoreboard(currentNFLWeek, true);
            }, 60000); 
        }
    }
}

const DB_NAME = "FFF_Network_DB";
let db;
function initDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = e => {
            db = e.target.result;
            if(!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', {keyPath: 'id'});
        };
        req.onsuccess = e => { db = e.target.result; resolve(); };
        req.onerror = e => reject(e);
    });
}
async function getCache(id) {
    if(!db) await initDB();
    return new Promise(resolve => {
        const tx = db.transaction('cache', 'readonly');
        const req = tx.objectStore('cache').get(id);
        req.onsuccess = () => resolve(req.result ? req.result.data : null);
        req.onerror = () => resolve(null);
    });
}
async function setCache(id, data) {
    if(!db) await initDB();
    return new Promise(resolve => {
        const tx = db.transaction('cache', 'readwrite');
        tx.objectStore('cache').put({id, data});
        tx.oncomplete = () => resolve();
    });
}

let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    document.getElementById('install-btn').classList.remove('hidden');
});

async function installPWA() {
    triggerHaptic();
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') { document.getElementById('install-btn').classList.add('hidden'); }
        deferredPrompt = null;
    }
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(console.error); });
}

function switchTab(tabId) {
    triggerHaptic();
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.desk-nav').forEach(btn => { btn.classList.remove('text-white'); btn.classList.add('text-gray-400'); });
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    
    document.getElementById(tabId).classList.add('active');
    
    const activeDeskBtn = Array.from(document.querySelectorAll('.desk-nav')).find(btn => btn.getAttribute('onclick').includes(tabId));
    if(activeDeskBtn) { activeDeskBtn.classList.remove('text-gray-400'); activeDeskBtn.classList.add('text-white'); }
    
    const mobBtnId = tabId === 'editor' ? 'mob-nav-editor' : 'mob-nav-' + tabId;
    const activeMobBtn = document.getElementById(mobBtnId);
    if(activeMobBtn) activeMobBtn.classList.add('active');
    
    if(tabId === 'records' && !historicalDataLoaded && !historicalDataLoading) {
        loadHistoricalDataBackground();
    }
    window.scrollTo(0,0);
}

function switchRecordTab(tab) {
    triggerHaptic();
    document.querySelectorAll('.rec-tab').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.rec-nav').forEach(btn => { btn.classList.remove('text-cyan-400', 'border-cyan-400'); btn.classList.add('text-gray-500', 'border-transparent'); });
    
    document.getElementById(`rec-tab-${tab}`).classList.remove('hidden');
    const activeBtn = document.getElementById(`rec-nav-${tab}`);
    activeBtn.classList.remove('text-gray-500', 'border-transparent');
    activeBtn.classList.add('text-cyan-400', 'border-cyan-400');
}

function unlockEditor() { triggerHaptic(); document.getElementById('pin-modal').classList.remove('hidden'); setTimeout(() => document.getElementById('pin-input').focus(), 100); }
function closeModal() { triggerHaptic(); document.getElementById('pin-modal').classList.add('hidden'); document.getElementById('pin-input').value = ''; }
function verifyPin() {
    triggerHaptic();
    const input = document.getElementById('pin-input').value.trim().toLowerCase();
    if (input === 'commish') {
        const deskBtn = document.getElementById('editor-desk-btn');
        if(deskBtn) deskBtn.classList.remove('hidden'); 
        const mobBtn = document.getElementById('mob-nav-editor');
        if(mobBtn) mobBtn.classList.remove('hidden');
        closeModal(); switchTab('editor');
    } else { alert("ACCESS DENIED."); document.getElementById('pin-input').value = ''; }
}
document.getElementById('pin-input').addEventListener('keypress', function (e) { if (e.key === 'Enter') verifyPin(); });

async function forceSync() {
    triggerHaptic();
    const icon = document.getElementById('sync-icon');
    icon.classList.add('spin-active');
    await runDataPipeline();
    setTimeout(() => icon.classList.remove('spin-active'), 500);
}

async function runDataPipeline() {
    try {
        await initDB();
        const [stateRes, usersRes, leagueRes, rostersRes] = await Promise.all([
            fetch('https://api.sleeper.app/v1/state/nfl'),
            fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/users`),
            fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}`),
            fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/rosters`)
        ]);

        const state = await stateRes.json();
        const users = await usersRes.json();
        const league = await leagueRes.json();
        rostersData = await rostersRes.json();

        actualSleeperWeek = state.week || 1;
        const dayOfWeek = new Date().getDay(); 
        if (dayOfWeek === 2 || dayOfWeek === 3) currentNFLWeek = Math.max(1, actualSleeperWeek - 1);
        else currentNFLWeek = actualSleeperWeek;
        
        window.maxCompletedWeekForHistory = currentNFLWeek;
        if ([0, 1, 4, 5, 6].includes(dayOfWeek)) {
            window.maxCompletedWeekForHistory = Math.max(0, currentNFLWeek - 1);
        }

        populateWeekSelectors();

        if (league.avatar) {
            const iconUrl = `https://sleepercdn.com/avatars/thumbs/${league.avatar}`;
            document.getElementById('league-logo').innerHTML = `<img src="${iconUrl}" class="w-full h-full object-cover">`;
            document.getElementById('apple-icon').href = iconUrl;
        }

        users.forEach(u => { usersData[u.user_id] = u; globalTrophies[u.user_id] = { j:0, t:0, b:0 }; });

        calculateGlobalPowerRankings();
        loadAnnouncements();
        await fetchPlayersWithCache();
        
        let currentSeasonPromises = [];
        window.playerSeasonLogs = {};
        for (let w = 1; w <= currentNFLWeek; w++) {
            currentSeasonPromises.push(fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/matchups/${w}`).then(r => r.json()));
        }
        let allCurrentMatchups = await Promise.allSettled(currentSeasonPromises);
        allCurrentMatchups.forEach((res, index) => {
            if(res.status === 'fulfilled') {
                let wk = index + 1;
                res.value.forEach(m => {
                    if(m.players_points) {
                        for(let pid in m.players_points) {
                            if(!window.playerSeasonLogs[pid]) window.playerSeasonLogs[pid] = { total: 0, weeks: {} };
                            window.playerSeasonLogs[pid].weeks[wk] = m.players_points[pid];
                            window.playerSeasonLogs[pid].total += m.players_points[pid];
                        }
                    }
                });
            }
        });

        renderStandings(); 
        renderPowerRankings();
        await fetchAndRenderScoreboard(currentNFLWeek);
        
        if (document.getElementById('public-week-selector').value == actualSleeperWeek) {
            startLivePolling();
        }

        fetchTransactions(actualSleeperWeek); 
        fetchTrendingPlayers();
        await compileDraftCapital();

        if(league.previous_league_id && !historicalDataLoaded && !historicalDataLoading) {
            setTimeout(loadHistoricalDataBackground, 500);
        }

    } catch (e) { 
        console.error("Data Pipeline Error:", e); 
        document.querySelectorAll('.loader-node').forEach(el => {
            el.classList.remove('animate-pulse');
            el.innerHTML = `<span class="text-red-500 font-bold p-2 text-center text-sm">Failed to connect to Sleeper database. Please refresh.</span>`;
        });
    }
}

async function loadHistoricalDataBackground() {
    historicalDataLoading = true;
    document.getElementById('historical-loader').classList.remove('hidden');
    document.getElementById('records-content').classList.add('hidden');
    
    try {
        await compileAllTimeRecords(LEAGUE_ID, window.maxCompletedWeekForHistory); 
        historicalDataLoaded = true;
        document.getElementById('historical-loader').classList.add('hidden');
        document.getElementById('records-content').classList.remove('hidden');
    } catch (e) {
        console.error("History DB Error", e);
        document.getElementById('historical-loader').innerHTML = `<p class="text-red-500 font-bold text-sm">Database Archive Failure.</p>`;
    }
    historicalDataLoading = false;
}

async function fetchPlayersWithCache() {
    try {
        let cached = await getCache('fff-players-v2');
        if(!cached) {
            const res = await fetch('https://api.sleeper.app/v1/players/nfl');
            cached = await res.json();
            await setCache('fff-players-v2', cached);
        }
        for (const id in cached) {
            if(cached[id].active === true || cached[id].team !== null) {
                let ht = cached[id].height;
                if(ht && !isNaN(ht) && ht > 20) {
                    let feet = Math.floor(ht / 12);
                    let inches = ht % 12;
                    ht = `${feet}'${inches}"`;
                } else if (!ht) {
                    ht = '-';
                }
                
                playerDictionary[id] = { 
                    name: (cached[id].first_name && cached[id].last_name) ? `${cached[id].first_name.charAt(0)}. ${cached[id].last_name}` : "Player", 
                    pos: cached[id].position || "UNK", 
                    team: cached[id].team || "FA",
                    age: cached[id].age || '-',
                    ht: ht,
                    wt: cached[id].weight || '-',
                    exp: cached[id].years_exp === 0 ? 'R' : (cached[id].years_exp || '-')
                };
            }
        }
    } catch (e) {}
}

function getTeamName(ownerId) { return ownerId && usersData[ownerId] ? (usersData[ownerId].metadata?.team_name || usersData[ownerId].display_name) : "Former Franchise"; }

function getTeamLink(ownerId, extraClasses="") {
    const name = getTeamName(ownerId);
    if(!ownerId || !usersData[ownerId]) return `<span class="${extraClasses}">${name}</span>`;
    return `<span onclick="openTeamModal('${ownerId}')" class="cursor-pointer hover:text-cyan-300 transition underline decoration-dashed decoration-slate-600 underline-offset-4 ${extraClasses}">${name}</span>`;
}

function getCurrentSeasonStreak(ownerId) {
    if (globalAllMatchups.length === 0) return "";
    const currentYear = Math.max(...globalAllMatchups.map(m => m.year));
    const teamGames = globalAllMatchups.filter(m => m.year == currentYear && (m.o1 === ownerId || m.o2 === ownerId)).sort((a,b) => b.week - a.week);
    if(teamGames.length === 0) return "";
    
    let streakType = null; let count = 0;
    for(let g of teamGames) {
        let isO1 = g.o1 === ownerId;
        let myPts = isO1 ? g.p1 : g.p2; let oppPts = isO1 ? g.p2 : g.p1;
        if (myPts === oppPts) break; 
        let type = myPts > oppPts ? 'W' : 'L';
        if (streakType === null) { streakType = type; count = 1; } 
        else if (streakType === type) count++; 
        else break;
    }
    if(count === 0) return "";
    return `<span class="text-[10px] font-bold ml-1 ${streakType === 'W' ? 'text-green-400' : 'text-red-400'}">(${streakType}${count})</span>`;
}

function openPlayerModal(pid) {
    triggerHaptic();
    if(!pid || pid === "0" || !playerDictionary[pid]) return;
    
    let p = playerDictionary[pid];
    document.getElementById('pm-name').innerText = p.name;
    
    let posColor = "text-cyan-400";
    let borderColor = "border-cyan-400";
    let shadowColor = "shadow-[0_0_15px_rgba(6,182,212,0.3)]";
    let overlayColor = "bg-cyan-900/10";
    let barColor = "bg-cyan-500";

    if (p.pos === 'QB') { posColor = "text-pink-400"; borderColor = "border-pink-400"; shadowColor = "shadow-[0_0_15px_rgba(244,114,182,0.3)]"; overlayColor = "bg-pink-900/10"; barColor = "bg-pink-500"; }
    else if (p.pos === 'RB') { posColor = "text-green-400"; borderColor = "border-green-400"; shadowColor = "shadow-[0_0_15px_rgba(74,222,128,0.3)]"; overlayColor = "bg-green-900/10"; barColor = "bg-green-500"; }
    else if (p.pos === 'WR') { posColor = "text-blue-400"; borderColor = "border-blue-400"; shadowColor = "shadow-[0_0_15px_rgba(96,165,250,0.3)]"; overlayColor = "bg-blue-900/10"; barColor = "bg-blue-500"; }
    else if (p.pos === 'TE') { posColor = "text-orange-400"; borderColor = "border-orange-400"; shadowColor = "shadow-[0_0_15px_rgba(251,146,60,0.3)]"; overlayColor = "bg-orange-900/10"; barColor = "bg-orange-500"; }
    else if (p.pos === 'K') { posColor = "text-purple-400"; borderColor = "border-purple-400"; shadowColor = "shadow-[0_0_15px_rgba(192,132,252,0.3)]"; overlayColor = "bg-purple-900/10"; barColor = "bg-purple-500"; }
    
    document.getElementById('pm-subtitle').className = `${posColor} font-bold text-xs uppercase tracking-widest relative z-10`;
    document.getElementById('pm-subtitle').innerText = `${p.pos} • ${p.team}`;
    
    let av = document.getElementById('pm-avatar');
    av.src = `https://sleepercdn.com/content/nfl/players/thumb/${pid}.jpg`;
    av.className = `w-20 h-20 rounded-full border-2 ${borderColor} object-cover mx-auto mb-3 relative z-10 bg-slate-800 ${shadowColor}`;
    
    document.getElementById('pm-overlay').className = `absolute inset-0 ${overlayColor}`;

    document.getElementById('pm-age').innerText = p.age;
    document.getElementById('pm-ht').innerText = p.ht;
    document.getElementById('pm-wt').innerText = p.wt;
    document.getElementById('pm-exp').innerText = p.exp;
    
    let stats = window.playerSeasonLogs ? window.playerSeasonLogs[pid] : null;
    let logHtml = '';
    
    if (stats && Object.keys(stats.weeks).length > 0) {
        let gamesPlayed = Object.keys(stats.weeks).length;
        let avg = stats.total / gamesPlayed;
        let high = Math.max(...Object.values(stats.weeks));
        let low = Math.min(...Object.values(stats.weeks));
        
        document.getElementById('pm-tot-pts').innerText = stats.total.toFixed(2);
        document.getElementById('pm-avg-pts').innerText = avg.toFixed(2);
        document.getElementById('pm-high-pts').innerText = high.toFixed(2);
        document.getElementById('pm-low-pts').innerText = low.toFixed(2);
        
        let scaleMax = high < 20 ? 20 : high;

        let weeks = Object.keys(stats.weeks).map(Number).sort((a,b) => b - a);
        weeks.forEach(w => {
            let pts = stats.weeks[w];
            let pct = (pts / scaleMax) * 100;
            let pClass = pts >= 15 ? 'text-green-400 font-black' : (pts >= 10 ? 'text-white font-bold' : (pts <= 5 ? 'text-red-400' : 'text-gray-400'));
            
            logHtml += `
            <div class="flex flex-col bg-slate-900/50 p-3 rounded-lg border border-slate-700/50 relative overflow-hidden">
                <div class="absolute left-0 bottom-0 h-1 ${barColor} opacity-50 rounded-r" style="width: ${pct}%"></div>
                <div class="flex justify-between items-center relative z-10">
                    <span class="text-xs font-bold text-gray-400 uppercase tracking-widest">Week ${w}</span>
                    <span class="text-sm font-mono ${pClass}">${pts.toFixed(2)}</span>
                </div>
            </div>`;
        });
    } else {
        document.getElementById('pm-tot-pts').innerText = "0.00";
        document.getElementById('pm-avg-pts').innerText = "0.00";
        document.getElementById('pm-high-pts').innerText = "0.00";
        document.getElementById('pm-low-pts').innerText = "0.00";
        logHtml = `<div class="text-gray-500 italic text-xs text-center py-6">No fantasy points recorded this season.</div>`;
    }
    
    document.getElementById('pm-gamelog').innerHTML = logHtml;
    document.getElementById('player-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('player-modal-content').classList.remove('scale-95'), 10);
}

function closePlayerModal() {
    triggerHaptic();
    document.getElementById('player-modal-content').classList.add('scale-95');
    setTimeout(() => document.getElementById('player-modal').classList.add('hidden'), 200);
}

function openTeamModal(ownerId) {
    triggerHaptic();
    const user = usersData[ownerId];
    const roster = rostersData.find(r => r.owner_id === ownerId);
    if(!user || !roster) return;

    document.getElementById('tm-name').innerText = getTeamName(ownerId);
    document.getElementById('tm-manager').innerText = user.display_name;
    
    const avFallback = document.getElementById('tm-avatar-fallback'); const avImage = document.getElementById('tm-avatar');
    if(user.avatar) { avImage.src = `https://sleepercdn.com/avatars/thumbs/${user.avatar}`; avImage.classList.remove('hidden'); avFallback.classList.add('hidden'); } 
    else { avImage.classList.add('hidden'); avFallback.classList.remove('hidden'); avFallback.innerText = getTeamName(ownerId).substring(0,2).toUpperCase(); }

    document.getElementById('tm-power').innerText = globalPowerRankings[ownerId] ? globalPowerRankings[ownerId].score.toFixed(1) : "N/A";
    
    let streakStr = getCurrentSeasonStreak(ownerId);
    document.getElementById('tm-record').innerHTML = `${roster.settings.wins}-${roster.settings.losses}${streakStr}`;

    const tro = globalTrophies[ownerId] || {j:0,t:0,b:0};
    document.getElementById('tm-trophies').innerHTML = `
        <div class="bg-slate-900 rounded p-2 flex-1"><div class="text-2xl mb-1 drop-shadow-[0_0_5px_rgba(255,215,0,0.5)]">🏆</div><div class="text-[10px] text-gray-400 uppercase font-bold">Juggs</div><div class="text-white font-black">${tro.j}</div></div>
        <div class="bg-slate-900 rounded p-2 flex-1"><div class="text-2xl mb-1 drop-shadow-[0_0_5px_rgba(234,88,12,0.5)]">🚽</div><div class="text-[10px] text-gray-400 uppercase font-bold">Toilets</div><div class="text-white font-black">${tro.t}</div></div>
        <div class="bg-slate-900 rounded p-2 flex-1"><div class="text-2xl mb-1 drop-shadow-[0_0_5px_rgba(220,38,38,0.5)]">🤡</div><div class="text-[10px] text-gray-400 uppercase font-bold">Blunders</div><div class="text-white font-black">${tro.b}</div></div>
    `;

    const activePlayers = (roster.players || []).filter(p => !(roster.reserve || []).includes(p) && !(roster.taxi || []).includes(p));
    let groupedRoster = { 'QB': [], 'RB': [], 'WR': [], 'TE': [], 'K': [], 'DEF': [], 'OTHER': [] };
    
    activePlayers.forEach(id => {
        const pos = playerDictionary[id]?.pos || 'OTHER';
        if(groupedRoster[pos]) groupedRoster[pos].push(id); else groupedRoster['OTHER'].push(id);
    });

    let rosterHtml = "";
    ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'OTHER'].forEach(pos => {
        if(groupedRoster[pos].length > 0) {
            let pList = groupedRoster[pos].map(id => {
                const pName = playerDictionary[id]?.name || "Unknown";
                return `<div onclick="openPlayerModal('${id}')" class="flex items-center space-x-2 py-1 cursor-pointer hover:opacity-75 transition"><img src="https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg" onerror="this.src='https://sleepercdn.com/images/v2/icons/player_default.webp'" class="w-6 h-6 rounded-full bg-slate-900 border border-slate-600 object-cover"><span class="truncate text-white text-sm hover:text-cyan-300 transition">${pName} <span class="text-[10px] text-gray-500">${playerDictionary[id]?.team||''}</span></span></div>`;
            }).join("");
            rosterHtml += `<div class="mb-3"><h5 class="text-[10px] font-black text-cyan-500 uppercase tracking-widest border-b border-slate-700/50 pb-1 mb-2">${pos}</h5><div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4">${pList}</div></div>`;
        }
    });

    document.getElementById('tm-roster').innerHTML = rosterHtml || `<span class="text-gray-500 italic">Empty</span>`;
    
    const teamPicks = globalDraftPicks[roster.roster_id] || [];
    document.getElementById('tm-picks').innerHTML = teamPicks.map(p => {
        let pickColor = p.round === 1 ? "text-yellow-400" : p.round === 2 ? "text-slate-300" : p.round === 3 ? "text-orange-400" : "text-gray-500";
        const origLabel = p.original_roster_id === p.current_roster_id ? "" : ` <span class="text-gray-500 text-[10px] truncate max-w-[80px]">(${getTeamName(rostersData.find(roster => roster.roster_id === p.original_roster_id)?.owner_id)})</span>`;
        return `<div class="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs"><span class="font-bold text-gray-300">${p.year} <span class="${pickColor} font-bold">Round ${p.round}</span></span>${origLabel}</div>`;
    }).join("") || `<span class="text-gray-500 italic text-sm">No draft capital</span>`;

    document.getElementById('team-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('team-modal-content').classList.remove('scale-95'), 10);
}

function closeTeamModal() { 
    triggerHaptic();
    document.getElementById('team-modal-content').classList.add('scale-95');
    setTimeout(() => document.getElementById('team-modal').classList.add('hidden'), 200); 
}

function openMatchupModal(matchupId) {
    triggerHaptic();
    if(!window.currentViewedMatchups) return;
    let matchupGames = window.currentViewedMatchups.filter(m => m.matchup_id === matchupId);
    if(matchupGames.length !== 2) return;

    let t1 = matchupGames[0];
    let t2 = matchupGames[1];
    
    let o1 = rostersData.find(r => r.roster_id === t1.roster_id)?.owner_id;
    let o2 = rostersData.find(r => r.roster_id === t2.roster_id)?.owner_id;
    
    let u1 = usersData[o1];
    let u2 = usersData[o2];
    
    document.getElementById('mu-t1-name').innerText = getTeamName(o1);
    document.getElementById('mu-t2-name').innerText = getTeamName(o2);
    document.getElementById('mu-t1-avatar').src = u1?.avatar ? `https://sleepercdn.com/avatars/thumbs/${u1.avatar}` : 'https://sleepercdn.com/images/v2/icons/player_default.webp';
    document.getElementById('mu-t2-avatar').src = u2?.avatar ? `https://sleepercdn.com/avatars/thumbs/${u2.avatar}` : 'https://sleepercdn.com/images/v2/icons/player_default.webp';
    
    let p1s = t1.points > t2.points ? "text-green-400" : "text-white";
    let p2s = t2.points > t1.points ? "text-green-400" : "text-white";
    
    document.getElementById('mu-t1-score').className = `text-3xl font-black ${p1s}`;
    document.getElementById('mu-t2-score').className = `text-3xl font-black ${p2s}`;
    document.getElementById('mu-t1-score').innerText = t1.points.toFixed(2);
    document.getElementById('mu-t2-score').innerText = t2.points.toFixed(2);
    
    let startersHtml = '';
    const s1 = t1.starters || [];
    const s2 = t2.starters || [];
    
    for(let i=0; i<Math.max(s1.length, s2.length); i++) {
        let pid1 = s1[i] || "0";
        let pid2 = s2[i] || "0";
        
        let p1PtsRaw = (t1.players_points && t1.players_points[pid1]) ? t1.players_points[pid1] : 0;
        let p2PtsRaw = (t2.players_points && t2.players_points[pid2]) ? t2.players_points[pid2] : 0;
        
        let p1Pts = p1PtsRaw.toFixed(2);
        let p2Pts = p2PtsRaw.toFixed(2);
        
        let p1Name = pid1 === "0" ? "Empty" : (playerDictionary[pid1]?.name || "Player");
        let p2Name = pid2 === "0" ? "Empty" : (playerDictionary[pid2]?.name || "Player");
        
        let p1Pos = pid1 === "0" ? "" : (playerDictionary[pid1]?.pos || "");
        let p2Pos = pid2 === "0" ? "" : (playerDictionary[pid2]?.pos || "");
        let p1Team = pid1 === "0" ? "" : (playerDictionary[pid1]?.team || "FA");
        let p2Team = pid2 === "0" ? "" : (playerDictionary[pid2]?.team || "FA");
        
        let badgePos = p1Pos || p2Pos || "FLEX";
        if(badgePos === "") badgePos = "FLEX";

        let badgeColor = "bg-cyan-900/50 border-cyan-800/50 text-cyan-400";
        if(badgePos === 'QB') badgeColor = "bg-pink-900/30 border-pink-700/50 text-pink-400";
        if(badgePos === 'RB') badgeColor = "bg-green-900/30 border-green-700/50 text-green-400";
        if(badgePos === 'WR') badgeColor = "bg-blue-900/30 border-blue-700/50 text-blue-400";
        if(badgePos === 'TE') badgeColor = "bg-orange-900/30 border-orange-700/50 text-orange-400";
        if(badgePos === 'K') badgeColor = "bg-purple-900/30 border-purple-700/50 text-purple-400";
        if(badgePos === 'DEF') badgeColor = "bg-slate-700/50 border-slate-600 text-gray-300";

        let pts1Class = p1PtsRaw > p2PtsRaw ? "text-green-400 font-black" : "text-gray-300";
        let pts2Class = p2PtsRaw > p1PtsRaw ? "text-green-400 font-black" : "text-gray-300";

        if (pid1 === "0") p1Pts = "-";
        if (pid2 === "0") p2Pts = "-";

        let img1 = pid1 === "0" ? "" : `<img onclick="openPlayerModal('${pid1}')" src="https://sleepercdn.com/content/nfl/players/thumb/${pid1}.jpg" onerror="this.src='https://sleepercdn.com/images/v2/icons/player_default.webp'" class="w-6 h-6 sm:w-8 sm:h-8 rounded-full border border-slate-600 mr-2 sm:mr-3 object-cover bg-slate-800 cursor-pointer hover:border-cyan-400 transition">`;
        let img2 = pid2 === "0" ? "" : `<img onclick="openPlayerModal('${pid2}')" src="https://sleepercdn.com/content/nfl/players/thumb/${pid2}.jpg" onerror="this.src='https://sleepercdn.com/images/v2/icons/player_default.webp'" class="w-6 h-6 sm:w-8 sm:h-8 rounded-full border border-slate-600 ml-2 sm:ml-3 object-cover bg-slate-800 cursor-pointer hover:border-cyan-400 transition">`;
        
        let p1Click = pid1 === "0" ? "" : `onclick="openPlayerModal('${pid1}')" class="cursor-pointer hover:text-cyan-300 transition"`;
        let p2Click = pid2 === "0" ? "" : `onclick="openPlayerModal('${pid2}')" class="cursor-pointer hover:text-cyan-300 transition"`;

        startersHtml += `
        <div class="flex items-center justify-between py-2 sm:py-3 border-b border-slate-700/50">
            <div class="flex items-center w-[38%] text-left">
                ${img1}
                <div class="flex flex-col min-w-0">
                    <span ${p1Click} class="text-xs font-bold ${pid1 === '0' ? 'text-gray-600' : 'text-white'} truncate pr-1">${p1Name}</span>
                    <span class="text-[9px] text-gray-500 truncate">${p1Pos} ${p1Team}</span>
                </div>
            </div>
            <div class="flex items-center justify-center space-x-1 sm:space-x-2 w-[24%]">
                <span class="text-xs ${pts1Class} font-mono w-8 text-right">${p1Pts}</span>
                <div class="${badgeColor} text-[9px] font-black px-1 sm:px-2 py-0.5 rounded border text-center w-8 sm:w-10 shadow-sm">${badgePos}</div>
                <span class="text-xs ${pts2Class} font-mono w-8 text-left">${p2Pts}</span>
            </div>
            <div class="flex items-center justify-end w-[38%] text-right">
                <div class="flex flex-col min-w-0 items-end">
                    <span ${p2Click} class="text-xs font-bold ${pid2 === '0' ? 'text-gray-600' : 'text-white'} truncate pl-1">${p2Name}</span>
                    <span class="text-[9px] text-gray-500 truncate">${p2Pos} ${p2Team}</span>
                </div>
                ${img2}
            </div>
        </div>`;
    }
    
    document.getElementById('mu-starters').innerHTML = startersHtml;
    document.getElementById('matchup-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('matchup-modal-content').classList.remove('scale-95'), 10);
}

function closeMatchupModal() {
    triggerHaptic();
    document.getElementById('matchup-modal-content').classList.add('scale-95');
    setTimeout(() => document.getElementById('matchup-modal').classList.add('hidden'), 200);
}

async function fetchTrendingPlayers() {
    try {
        const res = await fetch('https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=24&limit=5');
        const trends = await res.json();
        let html = "";
        trends.forEach(t => {
            const pName = playerDictionary[t.player_id]?.name || "Unknown Player";
            let countFormatted = Number(t.count).toLocaleString();
            html += `
            <div onclick="openPlayerModal('${t.player_id}')" class="border-b border-slate-700/50 pb-2 flex justify-between items-center hover:opacity-75 transition cursor-pointer group">
                <div class="flex items-center">
                    <img src="https://sleepercdn.com/content/nfl/players/thumb/${t.player_id}.jpg" onerror="this.src='https://sleepercdn.com/images/v2/icons/player_default.webp'" class="w-8 h-8 rounded-full bg-slate-900 border border-slate-600 mr-3 object-cover group-hover:border-cyan-400 transition">
                    <span class="text-white font-bold truncate group-hover:text-cyan-300 transition">${pName} <span class="text-gray-500 text-xs font-normal">${playerDictionary[t.player_id]?.pos || ''}</span></span>
                </div>
                <span class="text-green-400 text-xs font-mono bg-green-900/30 px-2 py-1 rounded">+${countFormatted}</span>
            </div>`;
        });
        document.getElementById('trending-feed').innerHTML = html || "<div class='text-gray-500 italic'>No trends found.</div>";
    } catch(e) { document.getElementById('trending-feed').innerHTML = "<div class='text-red-500 italic p-2 text-center text-xs'>Sleeper trend database unavailable.</div>"; }
}

async function fetchTransactions(week) {
    try {
        const transactions = await (await fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/transactions/${week}`)).json();
        let wireHTML = "", tickerArr = [];
        
        const formatWaiverPlayer = (id, isAdd) => {
            let pName = playerDictionary[id]?.name || "Player";
            let color = isAdd ? "text-green-400 hover:text-green-300" : "text-red-400 hover:text-red-300";
            return `<span onclick="openPlayerModal('${id}')" class="inline-flex items-center space-x-1 cursor-pointer hover:opacity-75 transition align-middle mx-1 bg-slate-900/50 px-1.5 py-0.5 rounded border border-slate-700/50 shadow-sm"><img src="https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg" onerror="this.src='https://sleepercdn.com/images/v2/icons/player_default.webp'" class="w-4 h-4 rounded-full border border-slate-600 bg-slate-800 object-cover"><span class="${color} font-bold text-xs">${pName}</span></span>`;
        };

        transactions.filter(t => t.status === 'complete').forEach(t => {
            let tickerStr = "";
            if (t.type === 'trade') {
                let r1 = t.roster_ids[0], r2 = t.roster_ids[1];
                let r1GetsPlayers = [], r1GetsPicks = [], r2GetsPlayers = [], r2GetsPicks = [];
                
                if(t.adds) {
                    for(let pid in t.adds) { if(t.adds[pid] === r1) r1GetsPlayers.push(pid); else if(t.adds[pid] === r2) r2GetsPlayers.push(pid); }
                }
                if(t.draft_picks) {
                    t.draft_picks.forEach(p => { if(p.owner_id === r1) r1GetsPicks.push(p); else if(p.owner_id === r2) r2GetsPicks.push(p); });
                }

                let isBlockbuster = (r1GetsPlayers.length + r1GetsPicks.length + r2GetsPlayers.length + r2GetsPicks.length) >= 4 || (t.draft_picks && t.draft_picks.some(p => p.round === 1));
                let tradeLabel = isBlockbuster ? "🚨 BLOCKBUSTER TRADE" : "🤝 TRADE EXCHANGE";
                let labelColor = isBlockbuster ? "text-purple-400" : "text-blue-400";
                let borderColor = isBlockbuster ? "border-purple-500/50 shadow-[0_0_10px_rgba(168,85,247,0.1)]" : "border-slate-600 shadow-lg";

                const buildAssetList = (pIds, picks) => {
                    let str = pIds.map(id => `<div onclick="openPlayerModal('${id}')" class="flex items-center space-x-2 my-1.5 hover:opacity-75 transition cursor-pointer"><img src="https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg" onerror="this.src='https://sleepercdn.com/images/v2/icons/player_default.webp'" class="w-5 h-5 rounded-full object-cover border border-slate-600"><span class="text-green-400 font-bold text-xs truncate hover:text-cyan-300 transition">${playerDictionary[id]?.name || 'Player'}</span></div>`).join("");
                    str += picks.map(p => {
                        let pickColor = p.round === 1 ? "text-yellow-400" : p.round === 2 ? "text-slate-300" : p.round === 3 ? "text-orange-400" : "text-gray-500";
                        let pickPlayerStr = "";
                        if (window.allDraftPicks && window.allDraftPicks[p.season]) {
                            let slotMap = window.allDraftsInfo ? window.allDraftsInfo[p.season] : null;
                            let pickMade = window.allDraftPicks[p.season].find(pick => {
                                let origRoster = slotMap ? slotMap[pick.draft_slot] : pick.roster_id;
                                return parseInt(pick.round) === parseInt(p.round) && parseInt(origRoster) === parseInt(p.roster_id);
                            });
                            if (pickMade) {
                                let pName = playerDictionary[pickMade.player_id]?.name || (pickMade.metadata?.first_name ? `${pickMade.metadata.first_name[0]}. ${pickMade.metadata.last_name}` : "Player");
                                pickPlayerStr = ` <span class="text-cyan-400 text-[10px] block truncate ml-4 font-semibold">(Pick ${pickMade.round}.${pickMade.draft_slot < 10 ? '0'+pickMade.draft_slot : pickMade.draft_slot}: ${pName})</span>`;
                            }
                        }
                        return `<div class="text-xs font-bold my-1.5 leading-tight"><span class="text-gray-400">🎯 ${p.season}</span> <span class="${pickColor}">Rd ${p.round}</span>${pickPlayerStr}</div>`;
                    }).join("");
                    return str || '<span class="text-gray-500 text-xs italic">Nothing</span>';
                };

                wireHTML += `
                    <div class="glass-panel p-3 rounded-lg border ${borderColor} mb-3">
                        <div class="text-[10px] ${labelColor} font-black uppercase tracking-widest border-b border-slate-700 pb-1 mb-2">${tradeLabel}</div>
                        <div class="grid grid-cols-2 gap-2 divide-x divide-slate-700">
                            <div><div class="text-xs font-bold text-white mb-1 truncate">${getTeamLink(rostersData.find(r=>r.roster_id===r1)?.owner_id)}</div>${buildAssetList(r1GetsPlayers, r1GetsPicks)}</div>
                            <div class="pl-2"><div class="text-xs font-bold text-white mb-1 truncate">${getTeamLink(rostersData.find(r=>r.roster_id===r2)?.owner_id)}</div>${buildAssetList(r2GetsPlayers, r2GetsPicks)}</div>
                        </div>
                    </div>`;
                tickerStr = `🤝 ${getTeamName(rostersData.find(r=>r.roster_id===r1)?.owner_id)} & ${getTeamName(rostersData.find(r=>r.roster_id===r2)?.owner_id)} executed a trade`;
            
            } else if (t.type === 'waiver' || t.type === 'free_agent') {
                let ownerId = rostersData.find(r => r.roster_id === t.roster_ids[0])?.owner_id;
                let added = t.adds ? Object.keys(t.adds).map(id => formatWaiverPlayer(id, true)).join(" and ") : "";
                let dropped = t.drops ? Object.keys(t.drops).map(id => formatWaiverPlayer(id, false)).join(" and ") : "";
                
                let actionText = (added && dropped) ? `added ${added} and dropped ${dropped}` : added ? `added ${added}` : `dropped ${dropped}`;
                let badgeLabel = t.type === 'waiver' ? 'WAIVER CLAIM' : 'FREE AGENT ADD';
                
                wireHTML += `
                <div class="border-b border-slate-700/50 pb-3 mb-3 last:border-0 last:mb-0 last:pb-0">
                    <span class="text-[10px] text-cyan-400 font-black uppercase tracking-widest block mb-1.5">🔁 ${badgeLabel}</span>
                    <div class="text-sm text-gray-300 leading-relaxed font-medium"><span class="font-bold text-white">${getTeamLink(ownerId)}</span> ${actionText}.</div>
                </div>`;
                
                let txtAdd = t.adds ? Object.keys(t.adds).map(id => playerDictionary[id]?.name || "a player").join(", ") : "";
                tickerStr = `🔁 ${getTeamName(ownerId)} ${txtAdd ? 'added ' + txtAdd : 'made roster moves'}`;
            }
            if(tickerStr) tickerArr.push(tickerStr);
        });
        document.getElementById('live-wire-feed').innerHTML = wireHTML || "<div class='text-gray-500 italic text-center p-2'>The wire is quiet this week.</div>";
        document.getElementById('live-ticker-desk').innerText = tickerArr.length > 0 ? "🚨 LATEST MOVES: " + tickerArr.slice(0, 5).join("  |  ") + " 🚨" : "🚨 FFF NETWORK LIVE: Standings and scores synced successfully. 🚨";
        document.getElementById('live-ticker-mob').innerText = document.getElementById('live-ticker-desk').innerText;
    } catch (e) { document.getElementById('live-wire-feed').innerHTML = "<div class='text-red-500 italic p-2 text-center text-xs'>Failed to fetch transactions.</div>"; }
}

async function compileDraftCapital() {
    try {
        const tradedPicks = await (await fetch(`https://api.sleeper.app/v1/league/${LEAGUE_ID}/traded_picks`)).json();
        let allPicks = [];
        rostersData.forEach(r => { draftYears.forEach(y => { draftRounds.forEach(rd => { allPicks.push({ year: y, round: rd, original_roster_id: r.roster_id, current_roster_id: r.roster_id }); }); }); });
        tradedPicks.forEach(trade => {
            const pickIndex = allPicks.findIndex(p => p.year === parseInt(trade.season) && parseInt(p.round) === parseInt(trade.round) && p.original_roster_id === trade.roster_id);
            if (pickIndex !== -1) allPicks[pickIndex].current_roster_id = trade.owner_id;
        });
        let html = "";
        [...rostersData].sort((a,b) => getTeamName(a.owner_id).localeCompare(getTeamName(b.owner_id))).forEach(r => {
            const teamPicks = allPicks.filter(p => p.current_roster_id === r.roster_id).sort((a, b) => a.year - b.year || a.round - b.round);
            globalDraftPicks[r.roster_id] = teamPicks;
            let picksList = teamPicks.map(p => {
                let pickColor = p.round === 1 ? "text-yellow-400" : p.round === 2 ? "text-slate-300" : p.round === 3 ? "text-orange-400" : "text-gray-500";
                const origLabel = p.original_roster_id === p.current_roster_id ? "" : ` <span class="text-gray-500 text-[10px] truncate max-w-[80px]">(${getTeamName(rostersData.find(roster => roster.roster_id === p.original_roster_id)?.owner_id)})</span>`;
                return `<div class="bg-slate-800 rounded px-2 py-1.5 text-sm flex justify-between items-center"><span class="font-bold text-gray-300">${p.year} <span class="${pickColor} font-bold">Round ${p.round}</span></span>${origLabel}</div>`;
            }).join("");
            html += `<div class="glass-panel p-4 rounded-xl border border-slate-700 flex flex-col h-full"><h4 class="font-black text-white mb-3 text-lg border-b border-slate-700 pb-2">${getTeamLink(r.owner_id)}</h4><div class="space-y-2 overflow-y-auto max-h-64 hide-scrollbar flex-1">${picksList || '<div class="text-gray-500 italic text-sm">No draft capital</div>'}</div></div>`;
        });
        document.getElementById('draft-capital-container').innerHTML = html;
    } catch (e) {}
}

function calculateGlobalPowerRankings() {
    rostersData.forEach(r => {
        const pf = r.settings.fpts + (r.settings.fpts_decimal/100);
        const pa = r.settings.fpts_against + (r.settings.fpts_against_decimal/100);
        const score = (pf * 0.5) + (r.settings.wins * 10) + ((pf - pa) * 0.1);
        globalPowerRankings[r.owner_id] = { score: score, pf: pf };
    });
}

function renderStandings() {
    const sorted = [...rostersData].sort((a, b) => b.settings.wins - a.settings.wins || b.settings.fpts - a.settings.fpts);
    let html = "";
    sorted.forEach((r, i) => {
        let rankStr = i + 1;
        let rankClass = "text-gray-500";
        let bgClass = "border-transparent";
        let glow = "";
        
        if (i === 0) { rankClass = "text-yellow-400"; bgClass = "border-l-4 border-yellow-500 bg-yellow-900/10"; glow = "drop-shadow-[0_0_8px_rgba(250,204,21,0.6)]"; }
        else if (i === 1) { rankClass = "text-slate-300"; bgClass = "border-l-4 border-slate-300 bg-slate-700/10"; glow = "drop-shadow-[0_0_8px_rgba(203,213,225,0.6)]"; }
        else if (i === 2) { rankClass = "text-orange-400"; bgClass = "border-l-4 border-orange-400 bg-orange-900/10"; glow = "drop-shadow-[0_0_8px_rgba(251,146,60,0.6)]"; }
        else if (i < 6) { rankClass = "text-cyan-400 font-bold"; bgClass = "border-l-2 border-cyan-500/30"; }

        let streakStr = getCurrentSeasonStreak(r.owner_id);
        let ownerName = getTeamName(r.owner_id);
        let user = usersData[r.owner_id];
        let avatarHtml = user && user.avatar ? `<img src="https://sleepercdn.com/avatars/thumbs/${user.avatar}" class="w-10 h-10 rounded-full border-2 border-slate-600 object-cover bg-slate-900">` : `<div class="w-10 h-10 rounded-full border-2 border-slate-600 bg-slate-800 flex items-center justify-center text-xs font-black text-white">${ownerName.substring(0,2).toUpperCase()}</div>`;

        html += `
        <div onclick="openTeamModal('${r.owner_id}')" class="flex items-center p-3 sm:p-4 border-b border-slate-700/30 last:border-0 hover:bg-slate-700/30 transition cursor-pointer ${bgClass}">
            <div class="w-8 text-center font-black text-xl ${rankClass} ${glow}">${rankStr}</div>
            <div class="mx-3">${avatarHtml}</div>
            <div class="flex-1 min-w-0">
                <div class="text-sm sm:text-base font-bold text-white truncate hover:text-cyan-300 transition">${ownerName}</div>
                <div class="text-[10px] text-gray-400 truncate">${user ? user.display_name : 'Unknown'}</div>
            </div>
            <div class="text-right flex flex-col items-end">
                <div class="text-sm sm:text-base font-mono font-black text-cyan-400">${r.settings.wins}-${r.settings.losses}${streakStr}</div>
                <div class="text-[10px] sm:text-xs text-gray-500 font-mono">${(r.settings.fpts + (r.settings.fpts_decimal/100)).toFixed(2)} PF</div>
            </div>
        </div>`;
    });
    document.getElementById('standings-body').innerHTML = html;
}

function renderPowerRankings() {
    const sortedOwners = Object.keys(globalPowerRankings).sort((a,b) => globalPowerRankings[b].score - globalPowerRankings[a].score);
    let html = "";
    sortedOwners.forEach((ownerId, i) => {
        const t = globalPowerRankings[ownerId];
        let ownerName = getTeamName(ownerId);
        let user = usersData[ownerId];
        let avatarHtml = user && user.avatar ? `<img src="https://sleepercdn.com/avatars/thumbs/${user.avatar}" class="w-10 h-10 rounded-full border border-slate-600 object-cover bg-slate-900">` : `<div class="w-10 h-10 rounded-full border border-slate-600 bg-slate-800 flex items-center justify-center text-xs font-black text-white">${ownerName.substring(0,2).toUpperCase()}</div>`;

        html += `
        <div onclick="openTeamModal('${ownerId}')" class="glass-panel p-4 rounded-xl border border-slate-700 flex justify-between items-center cursor-pointer hover:border-cyan-500 transition shadow-sm">
            <div class="flex items-center">
                <div class="text-xl font-black text-slate-500 w-8 text-center mr-2">${i+1}</div>
                <div class="mr-4">${avatarHtml}</div>
                <div class="min-w-0">
                    <div class="font-bold text-white text-base truncate hover:text-cyan-300 transition">${ownerName}</div>
                    <div class="text-[10px] text-gray-400 uppercase tracking-widest mt-0.5">Index: <span class="text-cyan-400 font-bold">${t.score.toFixed(1)}</span></div>
                </div>
            </div>
            <div class="text-right hidden sm:block">
                <div class="text-xs font-bold text-gray-400 uppercase tracking-widest border border-slate-600 px-2 py-1 rounded bg-slate-800/50">${t.pf.toFixed(2)} PF</div>
            </div>
        </div>`;
    });
    document.getElementById('power-rankings-container').innerHTML = html;
}

function renderTradeHistory() {
    let html = "";
    if(globalAllTrades.length === 0) { document.getElementById('trade-history-container').innerHTML = `<div class="text-gray-500 italic p-4 text-center">No past trades found.</div>`; return; }

    let tradesByYear = {};
    globalAllTrades.forEach(t => { if(!tradesByYear[t.year]) tradesByYear[t.year] = []; tradesByYear[t.year].push(t); });

    Object.keys(tradesByYear).sort((a,b) => b - a).forEach(year => {
        let yearTrades = tradesByYear[year].sort((a,b) => b.week - a.week);
        let tradesHtml = "";

        yearTrades.forEach(t => {
            let r1 = t.roster_ids[0], r2 = t.roster_ids[1];
            let r1GetsPlayers = [], r1GetsPicks = [], r2GetsPlayers = [], r2GetsPicks = [];
            if(t.adds) { for(let pid in t.adds) { if(t.adds[pid] === r1) r1GetsPlayers.push(pid); else if(t.adds[pid] === r2) r2GetsPlayers.push(pid); } }
            if(t.draft_picks) { t.draft_picks.forEach(p => { if(p.owner_id === r1) r1GetsPicks.push(p); else if(p.owner_id === r2) r2GetsPicks.push(p); }); }

            let isBlockbuster = (r1GetsPlayers.length + r1GetsPicks.length + r2GetsPlayers.length + r2GetsPicks.length) >= 4 || (t.draft_picks && t.draft_picks.some(p => p.round === 1));
            let tradeLabel = isBlockbuster ? "🚨 BLOCKBUSTER TRADE" : "🤝 TRADE EXCHANGE";
            let labelColor = isBlockbuster ? "text-purple-400" : "text-blue-400";
            let borderColor = isBlockbuster ? "border-purple-500/50 shadow-[0_0_10px_rgba(168,85,247,0.1)]" : "border-slate-600 shadow-lg";

            const buildAssetList = (pIds, picks) => {
                let str = pIds.map(id => `<div onclick="openPlayerModal('${id}')" class="flex items-center space-x-2 my-1.5 hover:opacity-75 transition cursor-pointer"><img src="https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg" onerror="this.src='https://sleepercdn.com/images/v2/icons/player_default.webp'" class="w-5 h-5 rounded-full object-cover border border-slate-600"><span class="text-green-400 font-bold text-xs truncate hover:text-cyan-300 transition">${playerDictionary[id]?.name || 'Player'}</span></div>`).join("");
                str += picks.map(p => {
                    let pickColor = p.round === 1 ? "text-yellow-400" : p.round === 2 ? "text-slate-300" : p.round === 3 ? "text-orange-400" : "text-gray-500";
                    let pickPlayerStr = "";
                    if (window.allDraftPicks && window.allDraftPicks[p.season]) {
                        let slotMap = window.allDraftsInfo ? window.allDraftsInfo[p.season] : null;
                        let pickMade = window.allDraftPicks[p.season].find(pick => {
                            let origRoster = slotMap ? slotMap[pick.draft_slot] : pick.roster_id;
                            return parseInt(pick.round) === parseInt(p.round) && parseInt(origRoster) === parseInt(p.roster_id);
                        });
                        if (pickMade) {
                            let pName = playerDictionary[pickMade.player_id]?.name || (pickMade.metadata?.first_name ? `${pickMade.metadata.first_name[0]}. ${pickMade.metadata.last_name}` : "Player");
                            pickPlayerStr = ` <span class="text-cyan-400 text-[10px] block truncate ml-4 font-semibold">(Pick ${pickMade.round}.${pickMade.draft_slot < 10 ? '0'+pickMade.draft_slot : pickMade.draft_slot}: ${pName})</span>`;
                        }
                    }
                    return `<div class="text-xs font-bold my-1.5 leading-tight"><span class="text-gray-400">🎯 ${p.season}</span> <span class="${pickColor}">Rd ${p.round}</span>${pickPlayerStr}</div>`;
                }).join("");
                return str || '<span class="text-gray-500 text-xs italic">Nothing</span>';
            };

            tradesHtml += `
                <div class="glass-panel p-3 rounded-lg border ${borderColor} mb-3">
                    <div class="text-[10px] ${labelColor} font-black uppercase tracking-widest border-b border-slate-700 pb-1 mb-2">${tradeLabel}</div>
                    <div class="grid grid-cols-2 gap-2 divide-x divide-slate-700">
                        <div><div class="text-xs font-bold text-white mb-1 truncate">${getTeamLink(rostersData.find(r=>r.roster_id===r1)?.owner_id)}</div>${buildAssetList(r1GetsPlayers, r1GetsPicks)}</div>
                        <div class="pl-2"><div class="text-xs font-bold text-white mb-1 truncate">${getTeamLink(rostersData.find(r=>r.roster_id===r2)?.owner_id)}</div>${buildAssetList(r2GetsPlayers, r2GetsPicks)}</div>
                    </div>
                </div>`;
        });

        html += `
        <div class="glass-panel rounded-xl border border-slate-700 overflow-hidden mb-4">
            <button onclick="toggleAccordion('trade', '${year}')" class="w-full flex justify-between items-center p-5 hover:bg-slate-800 transition focus:outline-none">
                <h4 class="font-black text-white text-lg">${year} Trade Ledger</h4>
                <svg id="trade-chevron-${year}" class="w-6 h-6 text-cyan-400 chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
            </button>
            <div id="trade-content-${year}" class="draft-accordion trade-acc">
                <div class="p-5 pt-0 border-t border-slate-700/50">${tradesHtml}</div>
            </div>
        </div>`;
    });

    document.getElementById('trade-history-container').innerHTML = html;
}

function toggleAccordion(type, id) {
    triggerHaptic();
    const content = document.getElementById(`${type}-content-${id}`);
    const chevron = document.getElementById(`${type}-chevron-${id}`);
    const isOpening = !content.classList.contains('open');

    document.querySelectorAll(`.${type}-acc`).forEach(el => { el.classList.remove('open'); });
    document.querySelectorAll(`.chevron`).forEach(el => { if(el.id.startsWith(`${type}-chevron`)) el.classList.remove('open'); });

    if(isOpening) {
        content.classList.add('open'); chevron.classList.add('open');
    }
}

async function fetchDraftHistory(leagues) {
    try {
        const currentYear = new Date().getFullYear();
        if(!leagues.find(l => l.season == currentYear)) { leagues.push({ id: LEAGUE_ID, season: currentYear }); }
        leagues.sort((a,b) => b.season - a.season);

        let html = '';
        for (let l of leagues) {
            let cachedDrafts = await getCache(`fff_drafts_${l.id}`);
            let drafts = cachedDrafts || await (await fetch(`https://api.sleeper.app/v1/league/${l.id}/drafts`)).json(); 
            if(!cachedDrafts && l.id !== LEAGUE_ID) await setCache(`fff_drafts_${l.id}`, drafts); 
            if(!drafts || drafts.length === 0) continue;

            let draftId = drafts[0].draft_id;
            let cachedPicks = await getCache(`fff_picks_${draftId}`);
            let picks = cachedPicks || await (await fetch(`https://api.sleeper.app/v1/draft/${draftId}/picks`)).json(); 
            if(!cachedPicks && l.id !== LEAGUE_ID) await setCache(`fff_picks_${draftId}`, picks); 

            if(!picks || picks.length === 0) continue;
            window.allDraftPicks[l.season] = picks; 
            window.allDraftsInfo[l.season] = drafts[0].slot_to_roster_id || {};

            let topPicks = picks.filter(p => p.round <= 2);
            if(topPicks.length === 0) continue;

            let picksHtml = topPicks.map(p => {
                let pName = playerDictionary[p.player_id]?.name || (p.metadata?.first_name ? p.metadata.first_name + " " + p.metadata.last_name : "Unknown");
                return `<div onclick="openPlayerModal('${p.player_id}')" class="flex justify-between items-center text-sm border-b border-slate-700/50 py-2 cursor-pointer hover:bg-slate-700/30 transition px-1 rounded">
                    <div class="flex items-center space-x-2"><span class="text-gray-400 font-mono w-8">${p.round}.${p.draft_slot < 10 ? '0'+p.draft_slot : p.draft_slot}</span> <img src="https://sleepercdn.com/content/nfl/players/thumb/${p.player_id}.jpg" class="w-6 h-6 rounded-full border border-slate-600 object-cover" onerror="this.style.display='none'"> <span class="text-white font-bold hover:text-cyan-300 transition">${pName}</span></div>
                    <div class="text-[10px] uppercase truncate max-w-[80px] sm:max-w-[120px]">${getTeamLink(rostersData.find(r => r.roster_id === p.roster_id)?.owner_id)}</div>
                </div>`;
            }).join('');
            
            html += `
            <div class="glass-panel rounded-xl border border-slate-700 overflow-hidden mb-4">
                <button onclick="toggleAccordion('draft', '${l.season}')" class="w-full flex justify-between items-center p-5 hover:bg-slate-800 transition focus:outline-none">
                    <h4 class="font-black text-white text-lg">${l.season} Rookie Draft</h4>
                    <svg id="draft-chevron-${l.season}" class="w-6 h-6 text-cyan-400 chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                </button>
                <div id="draft-content-${l.season}" class="draft-accordion draft-acc">
                    <div class="p-5 pt-0 border-t border-slate-700/50"><div class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1 mt-3">${picksHtml}</div></div>
                </div>
            </div>`;
        }
        document.getElementById('draft-history-container').innerHTML = html || `<div class="text-gray-500 italic p-4 text-center">No past drafts detected.</div>`;
    } catch(e){ document.getElementById('draft-history-container').innerHTML = `<div class="text-red-500 p-4 text-center">Failed to load draft archives.</div>`; }
}

function populateRivalryDropdowns(ownerIds) {
    let opts = '<option value="" disabled selected>Select Franchise</option>';
    ownerIds.filter(id => usersData[id]).sort((a,b) => getTeamName(a).localeCompare(getTeamName(b))).forEach(id => { opts += `<option value="${id}">${getTeamName(id)}</option>`; });
    document.getElementById('rival-a').innerHTML = opts; document.getElementById('rival-b').innerHTML = opts;
}

function updateRivalryDropdowns() {
    const a = document.getElementById('rival-a').value;
    const b = document.getElementById('rival-b').value;
    Array.from(document.getElementById('rival-b').options).forEach(opt => opt.disabled = (opt.value === a && a !== ""));
    Array.from(document.getElementById('rival-a').options).forEach(opt => opt.disabled = (opt.value === b && b !== ""));
    if(a && b) calculateRivalry(); 
}

function calculateRivalry() {
    const a = document.getElementById('rival-a').value, b = document.getElementById('rival-b').value;
    if(!a || !b) return;

    const games = globalAllMatchups.filter(m => (m.o1 === a && m.o2 === b) || (m.o1 === b && m.o2 === a));
    const resContainer = document.getElementById('rivalry-results'); resContainer.classList.remove('hidden');
    if(games.length === 0) { resContainer.innerHTML = `<div class="text-gray-400 italic text-center text-sm py-4">No historical matchups found between these franchises.</div>`; return; }

    let aWins = 0, bWins = 0, aPoints = 0, bPoints = 0;
    let aMax = 0, bMax = 0, currStreak = 0, streakWinner = null, maxStreak = 0, maxStreakWinner = null;
    
    games.sort((x,y) => x.year - y.year || x.week - y.week).forEach(g => { 
        let pA = g.o1 === a ? g.p1 : g.p2; let pB = g.o1 === b ? g.p1 : g.p2; 
        aPoints += pA; bPoints += pB; 
        if(pA > aMax) aMax = pA; if(pB > bMax) bMax = pB;
        
        let gameWinner = pA > pB ? a : (pB > pA ? b : null);
        if(gameWinner) {
            if(gameWinner === a) aWins++; else bWins++;
            if(streakWinner === gameWinner) currStreak++;
            else { streakWinner = gameWinner; currStreak = 1; }
            if(currStreak > maxStreak) { maxStreak = currStreak; maxStreakWinner = streakWinner; }
        }
    });

    const avgMargin = (Math.abs(aPoints - bPoints) / games.length).toFixed(2);
    let leaderText = aWins > bWins ? `<span class="text-cyan-400">${getTeamName(a)}</span> leads the all-time series` : bWins > aWins ? `<span class="text-cyan-400">${getTeamName(b)}</span> leads the all-time series` : "The all-time series is tied";

    resContainer.innerHTML = `
        <div class="text-center mb-4"><span class="font-bold uppercase tracking-widest text-xs">${leaderText}</span></div>
        <div class="grid grid-cols-3 text-center gap-2 items-center mb-6">
            <div class="glass-panel p-3 rounded bg-slate-800 border-b-4 ${aWins > bWins ? 'border-green-500' : 'border-slate-600'}">
                <div class="text-3xl font-black text-white">${aWins}</div><div class="text-[10px] text-gray-400 font-bold uppercase truncate px-1">${getTeamName(a)}</div>
            </div>
            <div class="text-gray-500 font-black text-xl">- WINS -</div>
            <div class="glass-panel p-3 rounded bg-slate-800 border-b-4 ${bWins > aWins ? 'border-green-500' : 'border-slate-600'}">
                <div class="text-3xl font-black text-white">${bWins}</div><div class="text-[10px] text-gray-400 font-bold uppercase truncate px-1">${getTeamName(b)}</div>
            </div>
        </div>
        <div class="grid grid-cols-2 gap-4 text-center">
            <div class="bg-slate-900 p-3 rounded-lg border border-slate-700">
                <div class="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">Longest Win Streak</div>
                <div class="text-lg font-black text-yellow-400">${maxStreak} Games</div>
                <div class="text-xs text-white truncate px-1">${getTeamName(maxStreakWinner)}</div>
            </div>
            <div class="bg-slate-900 p-3 rounded-lg border border-slate-700">
                <div class="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">Highest Matchup Score</div>
                <div class="text-lg font-black text-cyan-400">${Math.max(aMax, bMax).toFixed(2)}</div>
                <div class="text-xs text-white truncate px-1">${aMax > bMax ? getTeamName(a) : getTeamName(b)}</div>
            </div>
        </div>
        <div class="mt-4 text-center text-[10px] text-gray-400 uppercase tracking-widest">Total Matchups: <span class="text-white">${games.length}</span> &nbsp;|&nbsp; Avg Margin: <span class="text-white">${avgMargin} pts</span></div>
    `;
}

function publishAnnouncement() {
    const t = document.getElementById('post-title').value.trim(), b = document.getElementById('post-body').value.trim();
    if (!t || !b) { alert("Title and message required."); return; }
    let posts = JSON.parse(localStorage.getItem('fff_announcements') || '[]');
    posts.unshift({ id: Date.now(), title: t, body: b, date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) });
    localStorage.setItem('fff_announcements', JSON.stringify(posts));
    document.getElementById('post-title').value = ''; document.getElementById('post-body').value = ''; loadAnnouncements(); switchTab('news'); window.scrollTo({ top: 0, behavior: 'smooth' });
}

function loadAnnouncements() {
    const posts = JSON.parse(localStorage.getItem('fff_announcements') || '[]');
    let html = '';
    posts.forEach(p => { html += `<article class="glass-panel p-5 sm:p-7 rounded-xl border border-cyan-500/50 relative group shadow-[0_0_15px_rgba(6,182,212,0.1)] mb-6"><button onclick="deleteAnnouncement(${p.id})" class="absolute top-4 right-4 bg-red-900/50 text-red-400 text-xs px-2 py-1 rounded hover:bg-red-600 hover:text-white transition shadow z-10">Delete</button><h2 class="text-2xl font-black text-cyan-400 mb-2 uppercase tracking-tight leading-tight pr-14 flex items-center">📣 ${p.title}</h2><p class="text-gray-400 text-xs font-bold mb-4 tracking-widest uppercase">${p.date} • COMMISSIONER ANNOUNCEMENT</p><div class="prose prose-invert max-w-none text-white leading-relaxed text-sm sm:text-base">${p.body}</div></article>`; });
    document.getElementById('commish-announcements-feed').innerHTML = html;
}

function deleteAnnouncement(id) { if(confirm("Permanently delete this announcement?")) { localStorage.setItem('fff_announcements', JSON.stringify(JSON.parse(localStorage.getItem('fff_announcements') || '[]').filter(p => p.id !== id))); loadAnnouncements(); } }

window.addEventListener('DOMContentLoaded', () => { runDataPipeline(); });
