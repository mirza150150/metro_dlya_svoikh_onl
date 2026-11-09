const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- 0. СЕТЕВЫЕ ПЕРЕМЕННЫЕ (PeerJS) ---
let peer = null;
let conn = null;
let myPlayerId = 1; // По умолчанию хост играет за 1 (Красные)

// --- 1. ИГРОВЫЕ ДАННЫЕ ---
let stations = [
    { id: 0, name: "Полис", x: 400, y: 300, neighbors: [1, 2], owner: null, army: 7, res: "универсал" },
    { id: 1, name: "Арбатская", x: 250, y: 200, neighbors: [0, 3], owner: 1, army: 2, res: "свиньи" },
    { id: 2, name: "Чеховская", x: 550, y: 200, neighbors: [0, 4], owner: 2, army: 2, res: "патроны" },
    { id: 3, name: "Киевская", x: 250, y: 400, neighbors: [1], owner: 1, army: 1, res: "грибы" },
    { id: 4, name: "Цветной бульвар", x: 550, y: 400, neighbors: [2], owner: 2, army: 1, res: "свиньи" },
];

const threatsList = [
    { name: "Стая крыс", power: 3, desc: "Голодные твари вылезли из вентиляции.", icon: "🐀" },
    { name: "Дикий мутант", power: 5, desc: "Огромный зверь преграждает путь.", icon: "👹" },
    { name: "Бандиты", power: 6, desc: "Мародеры не хотят отдавать станцию.", icon: "🔫" },
    { name: "Аномалия", power: 4, desc: "Радиационный фон выжигает легкие.", icon: "☢️" }
];

const questsList = [
    { text: "Захватить 1 станцию", type: "conquest", target: 1, progress: 0 },
    { text: "Собрать 5 патронов", type: "bullets", target: 5, progress: 0 },
    { text: "Нанять 3 солдат", type: "recruit", target: 3, progress: 0 }
];

const lawsList = [
    { text: "Военное положение: все игроки получают +1 к силе армии", effect: "army" },
    { text: "Торговый союз: все игроки получают по 3 патрона", effect: "bullets" },
    { text: "Комендантский час: каждый игрок теряет 1 свинью", effect: "lose_pigs" }
];

let currentThreat = null;
let attackTarget = null;
let heroTarget = null;
let activeLaw = null;
let gameOver = false;

let players = [
    { id: 1, name: "Красная линия", color: "#e63946", points: 3, armyStrength: 2, res: {s: 1, g: 1, b: 1}, heroStation: 1, quest: null, heroPower: 3 },
    { id: 2, name: "Ганза", color: "#457b9d", points: 3, armyStrength: 2, res: {s: 1, g: 1, b: 1}, heroStation: 2, quest: null, heroPower: 3 }
];

let currentPlayerIdx = 0;
let currentPhase = 1;
let selectedStation = null;

function getCurrentPlayer() { return players[currentPlayerIdx]; }

// --- СЕТЕВАЯ ЛОГИКА (P2P) ---
function setupPeer() {
    // Создаем peer с рандомным ID
    peer = new Peer();

    peer.on('open', (id) => {
        document.getElementById('room-code').innerText = id;
        document.getElementById('host-info').style.display = 'block';
        myPlayerId = 1; // Хост играет за 1
    });

    // Когда друг подключается к нам
    peer.on('connection', (connection) => {
        conn = connection;
        setupConnection();
        document.getElementById('connection-screen').style.display = 'none';
        logMessage("Друг подключился! Игра началась.");
    });
}

function setupConnection() {
    conn.on('data', (data) => {
        if (data.type === 'sync') {
            // Получаем состояние игры от другого игрока
            players = data.players;
            stations = data.stations;
            currentPlayerIdx = data.currentPlayerIdx;
            currentPhase = data.currentPhase;
            gameOver = data.gameOver;
            updateUI();
            drawMap();
        } else if (data.type === 'log') {
            logMessage(data.msg);
        }
    });
}

function broadcastState() {
    if (conn && conn.open) {
        conn.send({
            type: 'sync',
            players: players,
            stations: stations,
            currentPlayerIdx: currentPlayerIdx,
            currentPhase: currentPhase,
            gameOver: gameOver
        });
    }
}

// --- ОБРАБОТЧИКИ КНОПОК ПОДКЛЮЧЕНИЯ ---
document.getElementById('btn-host').onclick = () => {
    document.getElementById('btn-host').disabled = true;
    setupPeer();
};

document.getElementById('btn-join').onclick = () => {
    const code = document.getElementById('join-code').value.trim();
    if (!code) return alert("Введите код!");

    peer = new Peer();
    peer.on('open', () => {
        conn = peer.connect(code);
        myPlayerId = 2; // Клиент играет за 2

        conn.on('open', () => {
            document.getElementById('connection-screen').style.display = 'none';
            logMessage("Вы подключились к игре!");
            // Запрашиваем текущее состояние у хоста
            broadcastState();
        });

        setupConnection();
    });
};

// --- ВАЖНО: Блокировка ходов, если сейчас не ваш ход ---
function isMyTurn() {
    // Если сетевой игры нет (hot-seat), ходить могут оба
    if (!conn) return true;
    // Если сеть есть, ходить может только тот, чей сейчас currentPlayerIdx
    return (currentPlayerIdx + 1) === myPlayerId;
}

// --- 2. ОТРИСОВКА КАРТЫ (без изменений) ---
function drawMap() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#555'; ctx.lineWidth = 4;
    stations.forEach(st => {
        st.neighbors.forEach(nId => {
            if (st.id < nId) {
                const neighbor = stations.find(s => s.id === nId);
                ctx.beginPath(); ctx.moveTo(st.x, st.y); ctx.lineTo(neighbor.x, neighbor.y); ctx.stroke();
            }
        });
    });

    stations.forEach(st => {
        let color = '#666';
        if (st.owner) {
            const owner = players.find(p => p.id === st.owner);
            color = owner ? owner.color : '#666';
        }
        if (currentPhase === 3 && st.owner !== getCurrentPlayer().id) {
            const myStations = stations.filter(s => s.owner === getCurrentPlayer().id);
            const canAttack = myStations.some(mySt => mySt.neighbors.includes(st.id));
            if (canAttack) {
                ctx.beginPath(); ctx.arc(st.x, st.y, 35, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255, 255, 0, 0.2)'; ctx.fill();
            }
        }
        ctx.beginPath(); ctx.arc(st.x, st.y, 30, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();

        ctx.fillStyle = '#fff'; ctx.font = 'bold 18px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(st.army, st.x, st.y);
        ctx.fillStyle = '#ddd'; ctx.font = '14px Arial'; ctx.fillText(st.name, st.x, st.y + 50);

        if (selectedStation === st) {
            ctx.beginPath(); ctx.arc(st.x, st.y, 38, 0, Math.PI * 2);
            ctx.strokeStyle = '#f1c40f'; ctx.lineWidth = 3; ctx.stroke();
        }
    });

    players.forEach(p => {
        if (p.heroStation !== undefined && p.heroStation !== null) {
            const st = stations.find(s => s.id === p.heroStation);
            if (st) {
                ctx.fillStyle = '#f1c40f'; ctx.beginPath();
                ctx.moveTo(st.x, st.y - 40); ctx.lineTo(st.x - 10, st.y - 55); ctx.lineTo(st.x + 10, st.y - 55);
                ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.stroke();
            }
        }
    });
}

// --- 3. ИНТЕРФЕЙС (без изменений, но с учетом isMyTurn) ---
function updateUI() {
    const list = document.getElementById('players-list');
    list.innerHTML = '';
    players.forEach(p => {
        const isActive = (p.id === getCurrentPlayer().id) ? 'active' : '';
        const div = document.createElement('div');
        div.className = `player-panel ${isActive}`;
        div.style.borderLeftColor = p.color;
        div.innerHTML = `<h3>${p.name}</h3><div>Очки: <b>${p.points}</b></div><div>Армия: <b>${p.armyStrength}</b></div><div>Герой: <b>${p.heroPower}</b></div><div>Ресурсы: 🐷${p.res.s} 🍄${p.res.g} 🔫${p.res.b}</div>`;
        list.appendChild(div);
    });

    document.getElementById('current-player-name').innerText = getCurrentPlayer().name;
    document.getElementById('current-player-name').style.color = getCurrentPlayer().color;
    const phaseNames = {1: "1. Ресурсы", 2: "2. Мобилизация", 3: "3. Атака", 4: "4. Герои"};
    document.getElementById('current-phase').innerText = phaseNames[currentPhase];

    const turn = isMyTurn();
    document.getElementById('btn-buy-army').disabled = (currentPhase !== 2 || gameOver || !turn);
    document.getElementById('btn-next-phase').disabled = (gameOver || !turn);
    document.getElementById('btn-get-quest').disabled = (currentPhase !== 2 || getCurrentPlayer().quest !== null || gameOver || !turn);
    document.getElementById('btn-reset-quest').disabled = (currentPhase !== 2 || getCurrentPlayer().quest === null || gameOver || !turn);
    document.getElementById('btn-law').disabled = (currentPhase !== 2 || gameOver || !turn);

    const p = getCurrentPlayer();
    const questBox = document.getElementById('quest-box');
    if (p.quest) {
        questBox.innerHTML = `<b>${p.quest.text}</b><br>Прогресс: ${p.quest.progress} / ${p.quest.target}`;
        questBox.style.color = '#f1c40f';
    } else {
        questBox.innerHTML = `Нет активного задания`; questBox.style.color = '#fff';
    }
}

function logMessage(msg) {
    const logBox = document.getElementById('log');
    logBox.innerHTML += `<div>> ${msg}</div>`;
    logBox.scrollTop = logBox.scrollHeight;
}

// После любого изменения вызываем broadcastState()
function checkQuest(type) {
    const p = getCurrentPlayer();
    if (!p.quest) return;
    if (p.quest.type === type) {
        p.quest.progress++;
        logMessage(`📜 Прогресс: ${p.quest.progress}/${p.quest.target}`);
        if (p.quest.progress >= p.quest.target) {
            logMessage(`🏆 КВЕСТ ВЫПОЛНЕН! +1 очко.`);
            p.points += 1; p.quest = null; updateUI(); checkWin();
        }
    }
}

function checkWin() {
    const p = getCurrentPlayer();
    const allCaptured = stations.every(st => st.owner === p.id);
    if ((p.points >= 10 || allCaptured) && !gameOver) {
        gameOver = true;
        logMessage(`🎉 ПОБЕДА! ${p.name} захватил метро!`);
        broadcastState();
        updateUI();
        const winScreen = document.createElement('div');
        winScreen.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);display:flex;flex-direction:column;justify-content:center;align-items:center;z-index:9999;color:' + p.color;
        winScreen.innerHTML = `<h1 style="font-size: 50px;">ПОБЕДА!</h1><h2>Игрок ${p.name} захватил метро!</h2>`;
        document.body.appendChild(winScreen);
    }
}

// --- 4. КНОПКИ (Добавлена проверка isMyTurn) ---
document.getElementById('btn-get-quest').onclick = () => {
    if(!isMyTurn()) return;
    const p = getCurrentPlayer();
    p.quest = JSON.parse(JSON.stringify(questsList[Math.floor(Math.random() * questsList.length)]));
    logMessage(`📜 ${p.name} взял задание.`);
    updateUI();
};

document.getElementById('btn-reset-quest').onclick = () => {
    if(!isMyTurn()) return;
    const p = getCurrentPlayer();
    if (p.res.b < 1) return alert("Нужен 1 патрон!");
    p.res.b -= 1; p.quest = null;
    logMessage(`🗑️ Задание сброшено.`); updateUI();
};

document.getElementById('btn-buy-army').onclick = () => {
    if(!isMyTurn()) return;
    const p = getCurrentPlayer();
    if (p.res.s >= 1 && p.res.b >= 1) {
        p.res.s -= 1; p.res.b -= 1; p.armyStrength += 1;
        logMessage(`${p.name} нанял солдата!`);
        checkQuest("recruit"); updateUI();
    }
};

document.getElementById('btn-law').onclick = () => { if(isMyTurn()) drawLawCard(); };

document.getElementById('btn-next-phase').onclick = () => {
    if (gameOver || !isMyTurn()) return;
    const p = getCurrentPlayer();
    if (currentPhase === 1) {
        let gotRes = false;
        stations.filter(s => s.owner === p.id).forEach(st => {
            if (st.res === "свиньи") { p.res.s += 1; gotRes = true; }
            if (st.res === "грибы") { p.res.g += 1; gotRes = true; }
            if (st.res === "патроны") { p.res.b += 1; gotRes = true; checkQuest("bullets"); }
            if (st.res === "универсал") { p.res.s += 1; p.res.g += 1; p.res.b += 1; gotRes = true; checkQuest("bullets"); }
        });
        if (gotRes) logMessage(`${p.name} собрал ресурсы.`);
        currentPhase = 2;
    } else if (currentPhase === 2) {
        logMessage(`${p.name} переходит к атаке.`); currentPhase = 3;
    } else if (currentPhase === 3) {
        logMessage(`${p.name} переходит к героям.`); currentPhase = 4;
    } else if (currentPhase === 4) {
        logMessage(`--- Ход переходит ---`);
        currentPlayerIdx = (currentPlayerIdx + 1) % players.length;
        currentPhase = 1; selectedStation = null; resetMarket();
    }
    broadcastState(); // <--- СИНХРОНИЗАЦИЯ!
    drawMap(); updateUI();
};

// --- 5. КЛИКИ ПО КАРТЕ (Проверка isMyTurn) ---
canvas.addEventListener('click', (e) => {
    if (gameOver || !isMyTurn() || (currentPhase !== 3 && currentPhase !== 4)) return;

    const rect = canvas.getBoundingClientRect();
    let clickedStation = null;
    for (let st of stations) {
        if (Math.hypot(st.x - (e.clientX - rect.left), st.y - (e.clientY - rect.top)) < 35) { clickedStation = st; break; }
    }
    if (!clickedStation) return;
    selectedStation = clickedStation; drawMap();

    const p = getCurrentPlayer();

    if (currentPhase === 4) {
        if (clickedStation.id === p.heroStation) { openHeroModal(clickedStation); return; }
        const chs = stations.find(s => s.id === p.heroStation);
        if (chs.neighbors.includes(clickedStation.id)) {
            p.heroStation = clickedStation.id;
            logMessage(`🕵️ Герой переместился.`);
            broadcastState(); updateUI(); drawMap(); openHeroModal(clickedStation);
        }
        return;
    }

    if (clickedStation.owner === p.id) return;
    const myStations = stations.filter(s => s.owner === p.id);
    if (!myStations.some(mySt => mySt.neighbors.includes(clickedStation.id))) return;

    if (clickedStation.owner === null) { attackTarget = clickedStation; drawThreatCard(); return; }

    logMessage(`⚔️ Атака на ${clickedStation.name}!`);
    if (p.armyStrength > clickedStation.army) {
        const prev = players.find(pl => pl.id === clickedStation.owner);
        prev.points -= 1; clickedStation.owner = p.id; clickedStation.army = 1; p.points += 1;
        checkQuest("conquest"); checkWin();
    } else {
        clickedStation.army -= 1; if (clickedStation.army < 1) clickedStation.army = 1;
    }
    currentPlayerIdx = (currentPlayerIdx + 1) % players.length; currentPhase = 1; selectedStation = null; resetMarket();
    broadcastState(); // <--- СИНХРОНИЗАЦИЯ!
    updateUI(); drawMap();
});

// --- 6-10. ОСТАЛЬНЫЕ ФУНКЦИИ (Покупка, Угрозы, Герои, Законы) ---
window.buyCard = function(cardId, costPigs, costBullets) {
    if (gameOver || !isMyTurn() || currentPhase !== 2) return;
    const p = getCurrentPlayer();
    if (p.res.s >= costPigs && p.res.b >= costBullets) {
        p.res.s -= costPigs; p.res.b -= costBullets; p.heroPower += 1;
        const cardElement = document.getElementById('card-' + cardId);
        if (cardElement) { cardElement.classList.add('bought'); cardElement.querySelector('.card-desc').innerText = "КУПЛЕНО"; }
        logMessage(`🛒 Куплено снаряжение!`); broadcastState(); updateUI();
    }
};

function resetMarket() {
    document.querySelectorAll('.card').forEach(card => {
        card.classList.remove('bought');
        if (card.id === 'card-akm' || card.id === 'card-armor') card.querySelector('.card-desc').innerText = "+1 к силе героя";
    });
}

function drawThreatCard() {
    currentThreat = threatsList[Math.floor(Math.random() * threatsList.length)];
    document.getElementById('threat-name').innerText = currentThreat.name;
    document.getElementById('threat-desc').innerText = currentThreat.desc;
    document.getElementById('threat-power').innerText = currentThreat.power;
    document.querySelector('.threat-icon').innerText = currentThreat.icon;
    document.getElementById('threat-modal').classList.add('active');
}

function closeThreatModal() {
    document.getElementById('threat-modal').classList.remove('active');
    logMessage(`Отступили.`);
    currentPlayerIdx = (currentPlayerIdx + 1) % players.length; currentPhase = 1; selectedStation = null; resetMarket();
    broadcastState(); updateUI(); drawMap();
}

function resolveThreatFight() {
    const p = getCurrentPlayer();
    document.getElementById('threat-modal').classList.remove('active');
    if (p.armyStrength > currentThreat.power) {
        attackTarget.owner = p.id; attackTarget.army = 1; p.points += 1;
        checkQuest("conquest"); checkQuest("threats"); checkWin();
    } else {
        p.armyStrength -= 1; if (p.armyStrength < 1) p.armyStrength = 1;
    }
    currentPlayerIdx = (currentPlayerIdx + 1) % players.length; currentPhase = 1; selectedStation = null; resetMarket();
    broadcastState(); updateUI(); drawMap();
}

function openHeroModal(station) {
    heroTarget = station; document.getElementById('hero-target-name').innerText = station.name;
    const p = getCurrentPlayer();
    document.getElementById('btn-hero-attack').style.display = (station.owner === p.id) ? 'none' : 'block';
    document.getElementById('btn-hero-gather').style.display = (station.owner !== null && station.owner !== p.id) ? 'none' : 'block';
    document.getElementById('hero-modal').classList.add('active');
}

function heroAttack() {
    document.getElementById('hero-modal').classList.remove('active');
    const p = getCurrentPlayer();
    if (p.heroPower > heroTarget.army) {
        if (heroTarget.owner) players.find(pl => pl.id === heroTarget.owner).points -= 1;
        heroTarget.owner = p.id; heroTarget.army = 1; p.points += 1;
        checkQuest("conquest"); checkWin();
    } else { p.heroStation = 1; }
    endHeroTurn();
}

function heroGather() {
    document.getElementById('hero-modal').classList.remove('active');
    getCurrentPlayer().res.b += 1; checkQuest("bullets"); endHeroTurn();
}

function endHeroTurn() {
    document.getElementById('hero-modal').classList.remove('active');
    currentPlayerIdx = (currentPlayerIdx + 1) % players.length; currentPhase = 1; selectedStation = null; resetMarket();
    broadcastState(); updateUI(); drawMap();
}

function drawLawCard() {
    activeLaw = lawsList[Math.floor(Math.random() * lawsList.length)];
    document.getElementById('law-text').innerText = activeLaw.text;
    document.getElementById('law-modal').classList.add('active');
}

function vote(choice) {
    document.getElementById('law-modal').classList.remove('active');
    if (choice === 'yes') {
        logMessage(`✅ Закон принят.`);
        if (activeLaw.effect === 'army') players.forEach(pl => pl.armyStrength += 1);
        if (activeLaw.effect === 'bullets') players.forEach(pl => pl.res.b += 3);
        if (activeLaw.effect === 'lose_pigs') players.forEach(pl => { pl.res.s = Math.max(0, pl.res.s - 1); });
    }
    broadcastState(); updateUI(); drawMap();
}

// --- СТАРТ ИГРЫ ---
drawMap();
updateUI();