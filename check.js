// Syntaxpruefung der HUD-Seite (laeuft im Bau, bevor eine Version veroeffentlicht wird)
const fs = require('fs');
const h = fs.readFileSync('web/hud.html', 'utf8');
new Function(h.match(/<script>([\s\S]*)<\/script>/)[1]);
console.log('hud.html: Syntax ok');
