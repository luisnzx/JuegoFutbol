// Menu handler script
console.log('HTML ready, startGame available:', typeof window.startGame);

const startBtn = document.getElementById('startBtn');
const startMenu = document.getElementById('startMenu');
const hud = document.getElementById('hud');
const scoreDiv = document.getElementById('score');

startBtn.addEventListener('click', async () => {
    console.log('Start button clicked');
    
    if (window.startGame) {
        try {
            await window.startGame();
            startMenu.style.display = 'none';
            hud.style.display = 'block';
            if (scoreDiv) scoreDiv.style.display = 'block';
            console.log('Game started');
        } catch (e) {
            console.error('Error:', e);
            alert('Error: ' + e.message);
        }
    } else {
        alert('Game not ready yet');
    }
});

document.getElementById('helpBtn').addEventListener('click', () => {
    alert('Dibuja con el ratón sobre el campo para hacer un pase. Intenta anotar goles.');
});
