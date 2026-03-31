const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const express = require('express');
const path = require('path');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages]
});

const BOT_TOKEN = process.env.BOT_TOKEN;
const USER_IDS = process.env.USER_IDS.split(',');
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const CLIENT_ID = "1485359905639764070";
const GUILD_ID = "1479289389476610149";
const MONGODB_URL = process.env.MONGODB_URL;
const ADMIN_PASSWORD = process.env.DASHBOARD_PASSWORD || "admin";

let db;
const parties = new Map();
const MOIS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

// ===== MONGODB =====
async function connectMongo() {
  const mongoClient = new MongoClient(MONGODB_URL);
  await mongoClient.connect();
  db = mongoClient.db('multibot');
  console.log('MongoDB connecté !');
  const comptes = db.collection('comptes');
  const admin = await comptes.findOne({ username: 'admin' });
  if (!admin) await comptes.insertOne({ username: 'admin', password: ADMIN_PASSWORD, role: 'admin' });
  const stats = db.collection('stats');
  const s = await stats.findOne({ _id: 'current' });
  if (!s) await stats.insertOne({ _id: 'current', mois: new Date().getMonth(), annee: new Date().getFullYear(), charsDetruitTotal: 0, charsPerdusTotal: 0, charsCapturesTotal: 0, recordRapport: 0, tireurs: {}, rapports: [] });
}

async function getComptes() { return db.collection('comptes').find({}).toArray(); }
async function getStats() { return db.collection('stats').findOne({ _id: 'current' }); }
async function saveStats(stats) { await db.collection('stats').replaceOne({ _id: 'current' }, stats, { upsert: true }); }

// ===== COMMANDES SLASH =====
const commands = [
  new SlashCommandBuilder().setName('oxo').setDescription('Jouer au Morpion contre quelqu\'un').addUserOption(o => o.setName('adversaire').setDescription('Ton adversaire').setRequired(true)),
  new SlashCommandBuilder().setName('puissance4').setDescription('Jouer au Puissance 4 contre quelqu\'un').addUserOption(o => o.setName('adversaire').setDescription('Ton adversaire').setRequired(true)),
  new SlashCommandBuilder().setName('demineur').setDescription('Jouer au Démineur').addStringOption(o => o.setName('difficulte').setDescription('Difficulté').setRequired(false).addChoices({ name: 'Facile (5x5)', value: 'facile' }, { name: 'Moyen (7x7)', value: 'moyen' }, { name: 'Difficile (9x9)', value: 'difficile' })),
  new SlashCommandBuilder().setName('logimage').setDescription('Jouer au Logimage (Nonogramme)'),
].map(c => c.toJSON());

async function enregistrerCommandes() {
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('Commandes enregistrées !');
  } catch (err) { console.error('Erreur:', err); }
}

// ===== OXO =====
function oxoGrille() { return Array(9).fill(null); }
function oxoVerifier(g) {
  const combos = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (const [a,b,c] of combos) if (g[a] && g[a] === g[b] && g[a] === g[c]) return g[a];
  return g.every(c => c) ? 'nul' : null;
}
function oxoButtons(grille, fini) {
  const rows = [];
  for (let r = 0; r < 3; r++) {
    const row = new ActionRowBuilder();
    for (let c = 0; c < 3; c++) {
      const i = r * 3 + c;
      row.addComponents(new ButtonBuilder().setCustomId(`oxo_${i}`).setLabel(grille[i] ? (grille[i] === 'X' ? '❌' : '⭕') : '⬜').setStyle(grille[i] === 'X' ? ButtonStyle.Danger : grille[i] === 'O' ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(!!grille[i] || fini));
    }
    rows.push(row);
  }
  return rows;
}

// ===== PUISSANCE 4 =====
function p4Grille() { return Array(6).fill(null).map(() => Array(7).fill(null)); }
function p4Verifier(g) {
  const check = (r, c, dr, dc) => {
    const val = g[r][c]; if (!val) return false;
    for (let i = 1; i < 4; i++) { const nr=r+dr*i, nc=c+dc*i; if (nr<0||nr>=6||nc<0||nc>=7||g[nr][nc]!==val) return false; }
    return val;
  };
  for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) {
    const w = check(r,c,0,1)||check(r,c,1,0)||check(r,c,1,1)||check(r,c,1,-1);
    if (w) return w;
  }
  return g.every(row => row.every(c => c)) ? 'nul' : null;
}
function p4Afficher(g) {
  const e = { '1': '🔴', '2': '🟡', null: '⚫' };
  let txt = '1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣\n';
  for (const row of g) txt += row.map(c => e[c]).join('') + '\n';
  return txt;
}
function p4Buttons(g) {
  const row = new ActionRowBuilder();
  for (let c = 0; c < 7; c++) row.addComponents(new ButtonBuilder().setCustomId(`p4_${c}`).setLabel(`${c+1}`).setStyle(ButtonStyle.Primary).setDisabled(g[0][c] !== null));
  return [row];
}

// ===== DEMINEUR =====
function demCreer(taille, mines) {
  const g = Array(taille).fill(null).map(() => Array(taille).fill(0));
  const rev = Array(taille).fill(null).map(() => Array(taille).fill(false));
  const drap = Array(taille).fill(null).map(() => Array(taille).fill(false));
  let placed = 0;
  while (placed < mines) { const r=Math.floor(Math.random()*taille), c=Math.floor(Math.random()*taille); if (g[r][c]!==-1) { g[r][c]=-1; placed++; } }
  for (let r=0;r<taille;r++) for (let c=0;c<taille;c++) {
    if (g[r][c]===-1) continue;
    let count=0;
    for (let dr=-1;dr<=1;dr++) for (let dc=-1;dc<=1;dc++) { const nr=r+dr,nc=c+dc; if (nr>=0&&nr<taille&&nc>=0&&nc<taille&&g[nr][nc]===-1) count++; }
    g[r][c]=count;
  }
  return { g, rev, drap, taille, mines, fini: false, gagne: false };
}
function demAfficher(jeu) {
  const nums = ['0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣'];
  let txt = '';
  for (let r=0;r<jeu.taille;r++) { for (let c=0;c<jeu.taille;c++) { if (jeu.drap[r][c]) txt+='🚩'; else if (!jeu.rev[r][c]) txt+='🟦'; else if (jeu.g[r][c]===-1) txt+='💣'; else txt+=nums[jeu.g[r][c]]; } txt+='\n'; }
  return txt;
}
function demButtons(jeu) {
  const rows = [];
  for (let r=0;r<Math.min(jeu.taille,5);r++) {
    const row = new ActionRowBuilder();
    for (let c=0;c<Math.min(jeu.taille,5);c++) {
      const rev = jeu.rev[r][c];
      row.addComponents(new ButtonBuilder().setCustomId(`dem_${r}_${c}`).setLabel(rev?(jeu.g[r][c]===0?'·':String(jeu.g[r][c])):(jeu.drap[r][c]?'🚩':'?')).setStyle(rev?ButtonStyle.Secondary:ButtonStyle.Primary).setDisabled(rev||jeu.fini));
    }
    rows.push(row);
  }
  return rows;
}

// ===== LOGIMAGE =====
const logimagesPuzzles = [
  { nom: "Cœur", rows: [[0,2],[2,2],[4],[6],[4],[2,2],[0,2]], cols: [[1],[1,1],[3],[5],[3],[1,1],[1]], taille: 7,
    solution: [[0,1,0,0,0,1,0],[1,1,0,0,0,1,1],[1,1,1,1,1,1,1],[0,1,1,1,1,1,0],[0,0,1,1,1,0,0],[0,0,0,1,0,0,0],[0,0,0,0,0,0,0]] },
  { nom: "Maison", rows: [[3],[5],[1,1],[1,1],[5]], cols: [[1],[2,1],[5],[2,1],[1]], taille: 5,
    solution: [[0,1,1,1,0],[1,1,1,1,1],[1,0,1,0,1],[1,0,1,0,1],[1,1,1,1,1]] }
];
function logiAfficher(jeu) {
  const t = jeu.puzzle.taille;
  let txt = '```\n';
  const maxColHint = Math.max(...jeu.puzzle.cols.map(c => c.length));
  for (let h=0;h<maxColHint;h++) { txt+='   '; for (let c=0;c<t;c++) { const hints=jeu.puzzle.cols[c]; const idx=hints.length-maxColHint+h; txt+=idx>=0?` ${hints[idx]}`:'  '; } txt+='\n'; }
  for (let r=0;r<t;r++) { const hint=jeu.puzzle.rows[r].join(' '); txt+=hint.padStart(3)+' '; for (let c=0;c<t;c++) { const val=jeu.grille[r][c]; txt+=val===1?'██':val===-1?'XX':'░░'; } txt+='\n'; }
  txt+='```'; return txt;
}
function logiButtons(jeu) {
  const rows = [];
  const t = jeu.puzzle.taille;
  for (let r=0;r<t&&r<5;r++) {
    const row = new ActionRowBuilder();
    for (let c=0;c<t&&c<5;c++) { const val=jeu.grille[r][c]; row.addComponents(new ButtonBuilder().setCustomId(`logi_${r}_${c}`).setLabel(val===1?'■':val===-1?'X':'·').setStyle(val===1?ButtonStyle.Success:val===-1?ButtonStyle.Danger:ButtonStyle.Secondary).setDisabled(jeu.fini)); }
    rows.push(row);
  }
  rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('logi_check').setLabel('✅ Vérifier').setStyle(ButtonStyle.Primary).setDisabled(jeu.fini)));
  return rows;
}

// ===== INTERACTIONS =====
client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'oxo') {
      const adv = interaction.options.getUser('adversaire');
      if (adv.id === interaction.user.id) return interaction.reply({ content: '❌ Tu ne peux pas jouer contre toi-même !', ephemeral: true });
      const id = `oxo_${interaction.channelId}`;
      parties.set(id, { grille: oxoGrille(), joueurs: [interaction.user.id, adv.id], tour: 0 });
      const embed = new EmbedBuilder().setTitle('⭕❌ Morpion').setColor(0xFFD700).setDescription(`**${interaction.user.username}** ❌ vs **${adv.username}** ⭕\n\nC'est au tour de **${interaction.user.username}** ❌`);
      await interaction.reply({ embeds: [embed], components: oxoButtons(parties.get(id).grille, false) });
    }
    else if (interaction.commandName === 'puissance4') {
      const adv = interaction.options.getUser('adversaire');
      if (adv.id === interaction.user.id) return interaction.reply({ content: '❌ Tu ne peux pas jouer contre toi-même !', ephemeral: true });
      const id = `p4_${interaction.channelId}`;
      const grille = p4Grille();
      parties.set(id, { grille, joueurs: [interaction.user.id, adv.id], tour: 0 });
      const embed = new EmbedBuilder().setTitle('🔴🟡 Puissance 4').setColor(0xFFD700).setDescription(`**${interaction.user.username}** 🔴 vs **${adv.username}** 🟡\n\n${p4Afficher(grille)}\nC'est au tour de **${interaction.user.username}** 🔴`);
      await interaction.reply({ embeds: [embed], components: p4Buttons(grille) });
    }
    else if (interaction.commandName === 'demineur') {
      const diff = interaction.options.getString('difficulte') || 'facile';
      const config = { facile: { taille: 5, mines: 4 }, moyen: { taille: 7, mines: 8 }, difficile: { taille: 9, mines: 12 } };
      const { taille, mines } = config[diff];
      const jeu = demCreer(taille, mines);
      parties.set(`dem_${interaction.user.id}`, { ...jeu, userId: interaction.user.id });
      const embed = new EmbedBuilder().setTitle('💣 Démineur').setColor(0xFFD700).setDescription(`Difficulté : **${diff}** | Mines : **${mines}**\n\n${demAfficher(jeu)}\nClique sur une case !`);
      await interaction.reply({ embeds: [embed], components: demButtons(jeu) });
    }
    else if (interaction.commandName === 'logimage') {
      const puzzle = logimagesPuzzles[Math.floor(Math.random() * logimagesPuzzles.length)];
      const grille = Array(puzzle.taille).fill(null).map(() => Array(puzzle.taille).fill(0));
      const jeu = { grille, puzzle, fini: false, userId: interaction.user.id };
      parties.set(`logi_${interaction.user.id}`, jeu);
      const embed = new EmbedBuilder().setTitle(`🖼️ Logimage — ${puzzle.nom}`).setColor(0xFFD700).setDescription(`${logiAfficher(jeu)}\n■ rempli | X vide | · effacé`);
      await interaction.reply({ embeds: [embed], components: logiButtons(jeu) });
    }
  }

  if (interaction.isButton()) {
    const id = interaction.customId;
    if (id.startsWith('oxo_')) {
      const partieId = `oxo_${interaction.channelId}`;
      const partie = parties.get(partieId);
      if (!partie) return interaction.reply({ content: '❌ Partie introuvable !', ephemeral: true });
      const joueurIdx = partie.joueurs.indexOf(interaction.user.id);
      if (joueurIdx === -1) return interaction.reply({ content: '❌ Tu ne fais pas partie de cette partie !', ephemeral: true });
      if (joueurIdx !== partie.tour) return interaction.reply({ content: '⏳ Ce n\'est pas ton tour !', ephemeral: true });
      const case_ = parseInt(id.split('_')[1]);
      if (partie.grille[case_]) return interaction.reply({ content: '❌ Case déjà jouée !', ephemeral: true });
      partie.grille[case_] = partie.tour === 0 ? 'X' : 'O';
      const resultat = oxoVerifier(partie.grille);
      const noms = await Promise.all(partie.joueurs.map(id => client.users.fetch(id)));
      let desc = ''; let fini = false;
      if (resultat === 'nul') { desc = '🤝 Match nul !'; fini = true; parties.delete(partieId); }
      else if (resultat) { desc = `🎉 **${noms[partie.tour].username}** a gagné !`; fini = true; parties.delete(partieId); }
      else { partie.tour = 1 - partie.tour; desc = `C'est au tour de **${noms[partie.tour].username}** ${partie.tour === 0 ? '❌' : '⭕'}`; }
      const embed = new EmbedBuilder().setTitle('⭕❌ Morpion').setColor(fini ? 0x4CAF50 : 0xFFD700).setDescription(`**${noms[0].username}** ❌ vs **${noms[1].username}** ⭕\n\n${desc}`);
      await interaction.update({ embeds: [embed], components: oxoButtons(partie.grille, fini) });
    }
    else if (id.startsWith('p4_')) {
      const partieId = `p4_${interaction.channelId}`;
      const partie = parties.get(partieId);
      if (!partie) return interaction.reply({ content: '❌ Partie introuvable !', ephemeral: true });
      const joueurIdx = partie.joueurs.indexOf(interaction.user.id);
      if (joueurIdx === -1) return interaction.reply({ content: '❌ Tu ne fais pas partie de cette partie !', ephemeral: true });
      if (joueurIdx !== partie.tour) return interaction.reply({ content: '⏳ Ce n\'est pas ton tour !', ephemeral: true });
      const col = parseInt(id.split('_')[1]);
      let placed = false;
      for (let r = 5; r >= 0; r--) { if (!partie.grille[r][col]) { partie.grille[r][col] = String(partie.tour + 1); placed = true; break; } }
      if (!placed) return interaction.reply({ content: '❌ Colonne pleine !', ephemeral: true });
      const resultat = p4Verifier(partie.grille);
      const noms = await Promise.all(partie.joueurs.map(id => client.users.fetch(id)));
      let desc = ''; let fini = false;
      if (resultat === 'nul') { desc = '🤝 Match nul !'; fini = true; parties.delete(partieId); }
      else if (resultat) { desc = `🎉 **${noms[partie.tour].username}** a gagné !`; fini = true; parties.delete(partieId); }
      else { partie.tour = 1 - partie.tour; desc = `C'est au tour de **${noms[partie.tour].username}** ${partie.tour === 0 ? '🔴' : '🟡'}`; }
      const embed = new EmbedBuilder().setTitle('🔴🟡 Puissance 4').setColor(fini ? 0x4CAF50 : 0xFFD700).setDescription(`**${noms[0].username}** 🔴 vs **${noms[1].username}** 🟡\n\n${p4Afficher(partie.grille)}\n${desc}`);
      await interaction.update({ embeds: [embed], components: fini ? [] : p4Buttons(partie.grille) });
    }
    else if (id.startsWith('dem_')) {
      const jeu = parties.get(`dem_${interaction.user.id}`);
      if (!jeu) return interaction.reply({ content: '❌ Partie introuvable !', ephemeral: true });
      const [, r, c] = id.split('_').map(Number);
      if (jeu.g[r][c] === -1) {
        jeu.fini = true;
        for (let i=0;i<jeu.taille;i++) for (let j=0;j<jeu.taille;j++) if (jeu.g[i][j]===-1) jeu.rev[i][j]=true;
        return interaction.update({ embeds: [new EmbedBuilder().setTitle('💣 Démineur').setColor(0xf44336).setDescription(`${demAfficher(jeu)}\n\n💥 **BOOM ! Tu as perdu !**`)], components: [] });
      }
      const queue = [[r, c]];
      while (queue.length) {
        const [cr, cc] = queue.shift();
        if (cr<0||cr>=jeu.taille||cc<0||cc>=jeu.taille||jeu.rev[cr][cc]) continue;
        jeu.rev[cr][cc] = true;
        if (jeu.g[cr][cc] === 0) for (let dr=-1;dr<=1;dr++) for (let dc=-1;dc<=1;dc++) queue.push([cr+dr,cc+dc]);
      }
      let gagne = true;
      for (let i=0;i<jeu.taille;i++) for (let j=0;j<jeu.taille;j++) if (jeu.g[i][j]!==-1&&!jeu.rev[i][j]) { gagne=false; break; }
      if (gagne) jeu.fini = true;
      await interaction.update({ embeds: [new EmbedBuilder().setTitle('💣 Démineur').setColor(gagne ? 0x4CAF50 : 0xFFD700).setDescription(`${demAfficher(jeu)}\n\n${gagne ? '🎉 **Bravo, tu as gagné !**' : 'Continue !'}`)], components: jeu.fini ? [] : demButtons(jeu) });
    }
    else if (id.startsWith('logi_')) {
      const jeu = parties.get(`logi_${interaction.user.id}`);
      if (!jeu) return interaction.reply({ content: '❌ Partie introuvable !', ephemeral: true });
      if (id === 'logi_check') {
        const correct = jeu.grille.every((row, r) => row.every((v, c) => (v === 1) === (jeu.puzzle.solution[r][c] === 1)));
        jeu.fini = correct;
        return interaction.update({ embeds: [new EmbedBuilder().setTitle(`🖼️ Logimage — ${jeu.puzzle.nom}`).setColor(correct ? 0x4CAF50 : 0xFFD700).setDescription(`${logiAfficher(jeu)}\n\n${correct ? '🎉 **Bravo, Logimage résolu !**' : '❌ Pas encore correct, continue !'}`)], components: correct ? [] : logiButtons(jeu) });
      }
      const [, r, c] = id.split('_').map(Number);
      jeu.grille[r][c] = jeu.grille[r][c] === 0 ? 1 : jeu.grille[r][c] === 1 ? -1 : 0;
      await interaction.update({ embeds: [new EmbedBuilder().setTitle(`🖼️ Logimage — ${jeu.puzzle.nom}`).setColor(0xFFD700).setDescription(`${logiAfficher(jeu)}\n■ rempli | X vide | · effacé`)], components: logiButtons(jeu) });
    }
  }
});

// ===== LOGS =====
async function envoyerLog(titre, description, couleur = 0xFFD700) {
  if (!WEBHOOK_URL) return;
  try { await fetch(WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds: [{ title: titre, description, color: couleur, timestamp: new Date().toISOString() }] }) }); }
  catch (err) { console.error("Erreur log:", err.message); }
}

// ===== BILAN MENSUEL =====
async function envoyerBilanMensuel(stats) {
  const ratio = stats.charsPerdusTotal > 0 ? (stats.charsDetruitTotal / stats.charsPerdusTotal).toFixed(2) : stats.charsDetruitTotal > 0 ? '∞' : '0';
  const meilleurTireur = Object.entries(stats.tireurs).sort((a, b) => b[1] - a[1])[0];
  const embed = { embeds: [{ title: `📊 Bilan de ${MOIS[stats.mois]} ${stats.annee}`, color: 0xFFD700, fields: [
    { name: '💥 Chars détruits', value: `**${stats.charsDetruitTotal}**`, inline: true },
    { name: '💀 Chars perdus', value: `**${stats.charsPerdusTotal}**`, inline: true },
    { name: '🚩 Capturés', value: `**${stats.charsCapturesTotal||0}**`, inline: true },
    { name: '⚖️ Ratio', value: `**${ratio}**`, inline: true },
    { name: '🏆 Record', value: `**${stats.recordRapport}** chars en un rapport`, inline: false },
    { name: '🎯 Meilleur tireur', value: meilleurTireur ? `**${meilleurTireur[0]}** — **${meilleurTireur[1]}** chars` : 'Aucun', inline: false },
  ], footer: { text: `Réinitialisation — ${MOIS[stats.mois]} ${stats.annee}` }, timestamp: new Date().toISOString() }] };
  for (const userId of USER_IDS) { try { const u = await client.users.fetch(userId.trim()); await u.send(embed); } catch (e) {} }
  if (WEBHOOK_URL) await fetch(WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(embed) });
}

async function verifierReinitialisationMois(stats) {
  const now = new Date();
  if (stats.mois !== now.getMonth() || stats.annee !== now.getFullYear()) {
    await envoyerBilanMensuel(stats);
    Object.assign(stats, { mois: now.getMonth(), annee: now.getFullYear(), charsDetruitTotal: 0, charsPerdusTotal: 0, charsCapturesTotal: 0, recordRapport: 0, tireurs: {}, rapports: [] });
    await saveStats(stats);
  }
  return stats;
}

let botStartTime = new Date();

client.once('ready', () => {
  console.log(`Bot connecté : ${client.user.tag}`);
  botStartTime = new Date();
  envoyerLog("🟢 Bot démarré", `**${client.user.tag}** en ligne !`, 0x4CAF50);
  enregistrerCommandes();
});

// ===== AUTH =====
function auth(req, res, next) {
  const username = req.headers['x-username'];
  const password = req.headers['x-password'];
  getComptes().then(comptes => {
    const compte = comptes.find(c => c.username === username && c.password === password);
    if (!compte) return res.status(401).json({ error: "Non autorisé" });
    req.compte = compte;
    next();
  }).catch(err => { res.status(500).json({ error: "Erreur serveur" }); });
}

function adminOnly(req, res, next) {
  if (req.compte.role !== 'admin') return res.status(403).json({ error: "Réservé à l'admin" });
  next();
}

// ===== ROUTES =====
app.post('/login', async (req, res) => {
  const comptes = await getComptes();
  const compte = comptes.find(c => c.username === req.body.username && c.password === req.body.password);
  if (!compte) { envoyerLog("🔴 Connexion échouée", `**${req.body.username}**`, 0xf44336); return res.status(401).json({ error: "Identifiants incorrects" }); }
  envoyerLog("🔵 Connexion", `**${compte.username}** (${compte.role})`, 0x378ADD);
  res.json({ success: true, role: compte.role, username: compte.username });
});

app.get('/status', auth, (req, res) => {
  res.json({ online: client.isReady(), tag: client.user?.tag || "Déconnecté", uptime: Math.floor((new Date() - botStartTime) / 1000) });
});

// Route pour récupérer les membres du serveur
app.get('/membres', auth, async (req, res) => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.members.fetch();
    const membres = guild.members.cache.map(m => ({
      id: m.user.id,
      username: m.user.username,
      displayName: m.displayName,
      avatar: m.user.displayAvatarURL({ size: 64, extension: 'png' })
    }));
    res.json(membres);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/send', auth, async (req, res) => {
  const ids = Array.isArray(req.body.userIds) ? req.body.userIds : [req.body.userIds];
  const results = [];
  for (const userId of ids) {
    try {
      const user = await client.users.fetch(userId.trim());
      await user.send({ embeds: [new EmbedBuilder().setTitle('📩 Message du Dashboard').setDescription(req.body.message).setColor(0xFFD700).setFooter({ text: `Envoyé par ${req.compte.username}` }).setTimestamp()] });
      results.push({ userId, success: true });
    } catch (err) { results.push({ userId, success: false, error: err.message }); }
  }
  envoyerLog("💬 Message", `Par **${req.compte.username}**`, 0xFFD700);
  res.json({ results });
});

app.post('/candidature', async (req, res) => {
  const { fields, titre } = req.body;
  if (!fields?.length) return res.status(400).json({ error: "Aucun champ" });
  const embed = new EmbedBuilder().setTitle(titre || "📋 Candidature !").setColor(0xFFD700).setTimestamp().addFields(fields.map(f => ({ name: f.name, value: String(f.value) })));
  for (const userId of USER_IDS) { try { const u = await client.users.fetch(userId); await u.send({ embeds: [embed] }); } catch (e) {} }
  res.json({ success: true });
});

app.post('/rapport', async (req, res) => {
  const { nom, tireur, charsDetruit, charsPerdus, front, date, charUtilise, vehiculesConfront, autresPersonnes, charsCaptures, reparations } = req.body;
  let stats = await getStats();
  stats = await verifierReinitialisationMois(stats);
  const detruits = parseInt(charsDetruit)||0, perdus = parseInt(charsPerdus)||0, captures = parseInt(charsCaptures)||0;
  stats.charsDetruitTotal += detruits; stats.charsPerdusTotal += perdus;
  stats.charsCapturesTotal = (stats.charsCapturesTotal||0) + captures;
  if (detruits > stats.recordRapport) stats.recordRapport = detruits;
  stats.tireurs[tireur] = (stats.tireurs[tireur]||0) + detruits;
  stats.rapports.push({ id: Date.now(), nom, tireur, detruits, perdus, captures, date });
  await saveStats(stats);
  const ratio = perdus > 0 ? (detruits/perdus).toFixed(2) : detruits > 0 ? '∞' : '0';
  const embed = new EmbedBuilder().setTitle(`📋 Rapport — ${nom}`).setColor(0xFFD700).setTimestamp().addFields(
    { name: '👤 Rapporteur', value: `**${nom}**`, inline: true }, { name: '🎯 Tireur', value: `**${tireur}**`, inline: true },
    { name: '📍 Front', value: `**${front}**`, inline: true }, { name: '🛡️ Char', value: `**${charUtilise||'N/A'}**`, inline: true },
    { name: '⚔️ Ennemis', value: `**${vehiculesConfront||'N/A'}**`, inline: true }, { name: '👥 Équipage', value: `**${autresPersonnes||'Solo'}**`, inline: true },
    { name: '💥 Détruits', value: `**${detruits}**`, inline: true }, { name: '💀 Perdus', value: `**${perdus}**`, inline: true },
    { name: '🚩 Capturés', value: `**${captures}**`, inline: true }, { name: '⚖️ Ratio', value: `**${ratio}**`, inline: true },
    { name: '🔧 Réparations', value: `**${reparations||0}**`, inline: true }, { name: '📅 Date', value: `**${date}**`, inline: true },
    { name: `📊 Total ${MOIS[stats.mois]}`, value: `**${stats.charsDetruitTotal}** détruits | **${stats.charsPerdusTotal}** perdus | **${stats.charsCapturesTotal}** capturés`, inline: false },
    { name: '🏆 Record', value: `**${stats.recordRapport}** chars Détruits`, inline: true },
  );
  for (const userId of USER_IDS) { try { const u = await client.users.fetch(userId.trim()); await u.send({ embeds: [embed] }); } catch (e) {} }
  res.json({ success: true });
});

app.get('/stats', auth, async (req, res) => res.json(await getStats()));

app.put('/stats', auth, async (req, res) => {
  const stats = await getStats();
  const { charsDetruitTotal, charsPerdusTotal, recordRapport, charsCapturesTotal } = req.body;
  if (charsDetruitTotal !== undefined) stats.charsDetruitTotal = parseInt(charsDetruitTotal);
  if (charsPerdusTotal !== undefined) stats.charsPerdusTotal = parseInt(charsPerdusTotal);
  if (recordRapport !== undefined) stats.recordRapport = parseInt(recordRapport);
  if (charsCapturesTotal !== undefined) stats.charsCapturesTotal = parseInt(charsCapturesTotal);
  await saveStats(stats);
  envoyerLog("✏️ Stats modifiées", `Par **${req.compte.username}**`, 0xFF9800);
  res.json({ success: true });
});

app.delete('/stats/rapport/:id', auth, async (req, res) => {
  const stats = await getStats();
  const rapport = stats.rapports.find(r => r.id === parseInt(req.params.id));
  if (!rapport) return res.status(404).json({ error: "Introuvable" });
  stats.charsDetruitTotal -= rapport.detruits; stats.charsPerdusTotal -= rapport.perdus;
  stats.charsCapturesTotal = (stats.charsCapturesTotal||0) - (rapport.captures||0);
  stats.tireurs[rapport.tireur] = (stats.tireurs[rapport.tireur]||0) - rapport.detruits;
  stats.rapports = stats.rapports.filter(r => r.id !== parseInt(req.params.id));
  stats.recordRapport = stats.rapports.length > 0 ? Math.max(...stats.rapports.map(r => r.detruits)) : 0;
  await saveStats(stats);
  envoyerLog("🗑️ Rapport supprimé", `Par **${req.compte.username}**`, 0xf44336);
  res.json({ success: true });
});

app.post('/stats/reset', auth, adminOnly, async (req, res) => {
  const stats = await getStats();
  await envoyerBilanMensuel(stats);
  Object.assign(stats, { charsDetruitTotal: 0, charsPerdusTotal: 0, charsCapturesTotal: 0, recordRapport: 0, tireurs: {}, rapports: [] });
  await saveStats(stats);
  envoyerLog("🔁 Reset stats", `Par **${req.compte.username}**`, 0xf44336);
  res.json({ success: true });
});

app.get('/comptes', auth, adminOnly, async (req, res) => {
  const comptes = await getComptes();
  res.json(comptes.map(c => ({ username: c.username, role: c.role })));
});

app.post('/comptes', auth, adminOnly, async (req, res) => {
  const { username, password, role } = req.body;
  if (!username||!password||!role) return res.status(400).json({ error: "Champs manquants" });
  const comptes = await getComptes();
  if (comptes.find(c => c.username === username)) return res.status(400).json({ error: "Nom déjà pris" });
  await db.collection('comptes').insertOne({ username, password, role });
  envoyerLog("👤 Compte créé", `**${username}** (${role})`, 0x4CAF50);
  res.json({ success: true });
});

app.put('/comptes/:username', auth, adminOnly, async (req, res) => {
  const { username } = req.params;
  const { newUsername, newPassword, newRole } = req.body;
  if (username === 'admin' && newRole && newRole !== 'admin') return res.status(400).json({ error: "Impossible de changer le rôle de l'admin" });
  const update = {};
  if (newUsername) update.username = newUsername;
  if (newPassword) update.password = newPassword;
  if (newRole) update.role = newRole;
  await db.collection('comptes').updateOne({ username }, { $set: update });
  envoyerLog("✏️ Compte modifié", `**${username}** par **${req.compte.username}**`, 0xFF9800);
  res.json({ success: true });
});

app.delete('/comptes/:username', auth, adminOnly, async (req, res) => {
  if (req.params.username === 'admin') return res.status(400).json({ error: "Impossible" });
  await db.collection('comptes').deleteOne({ username: req.params.username });
  envoyerLog("🗑️ Compte supprimé", `**${req.params.username}**`, 0xf44336);
  res.json({ success: true });
});

app.get('/discussion/:userId', auth, async (req, res) => {
  try {
    const user = await client.users.fetch(req.params.userId);
    const dmChannel = await user.createDM();
    const messages = await dmChannel.messages.fetch({ limit: 50 });
    const formatted = messages.reverse().map(m => ({
      content: m.content || '[Embed ou fichier]',
      isBot: m.author.bot,
      timestamp: m.createdTimestamp,
      author: m.author.username
    }));
    res.json({ messages: formatted });
  } catch (err) {
    res.status(500).json({ messages: [], error: err.message });
  }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

connectMongo().then(() => {
  client.login(BOT_TOKEN).then(() => {
    app.listen(3000, () => console.log('Serveur démarré'));
  });
});
