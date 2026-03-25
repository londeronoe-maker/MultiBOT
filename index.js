const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages]
});

const BOT_TOKEN = process.env.BOT_TOKEN;
const USER_IDS = process.env.USER_IDS.split(',');
const RENDER_API_KEY = process.env.RENDER_API_KEY;
const SERVICE_ID = "srv-d70574i4d50c7393n1qg";
const ADMIN_PASSWORD = process.env.DASHBOARD_PASSWORD || "admin";
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const NG_API_KEY = process.env.NG_API_KEY;
const CLIENT_ID = "1485359905639764070";
const COMPTES_FILE = path.join(__dirname, 'comptes.json');
const STATS_FILE = path.join(__dirname, 'stats.json');

// ===== FICHIERS =====
function chargerComptes() {
  if (fs.existsSync(COMPTES_FILE)) return JSON.parse(fs.readFileSync(COMPTES_FILE, 'utf8'));
  const initial = [{ username: "admin", password: ADMIN_PASSWORD, role: "admin" }];
  sauvegarderComptes(initial);
  return initial;
}
function sauvegarderComptes(comptes) {
  fs.writeFileSync(COMPTES_FILE, JSON.stringify(comptes, null, 2));
}
function chargerStats() {
  if (fs.existsSync(STATS_FILE)) return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
  return { mois: new Date().getMonth(), annee: new Date().getFullYear(), charsDetruitTotal: 0, charsPerdusTotal: 0, charsCapturesTotal: 0, recordRapport: 0, tireurs: {}, rapports: [] };
}
function sauvegarderStats(stats) {
  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
}

const MOIS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

// ===== NATIONSGLORY API =====
async function ngFetch(endpoint) {
  const response = await fetch(`https://api.nationsglory.fr${endpoint}`, {
    headers: { 'Authorization': `Bearer ${NG_API_KEY}` }
  });
  if (!response.ok) throw new Error(`Erreur API: ${response.status}`);
  return response.json();
}

// ===== COMMANDES SLASH =====
const commands = [
  new SlashCommandBuilder()
    .setName('pays')
    .setDescription('Infos sur un pays NationsGlory')
    .addStringOption(o => o.setName('nom').setDescription('Nom du pays').setRequired(true)),
  new SlashCommandBuilder()
    .setName('bank')
    .setDescription('Bank d\'un pays NationsGlory')
    .addStringOption(o => o.setName('nom').setDescription('Nom du pays').setRequired(true)),
  new SlashCommandBuilder()
    .setName('power')
    .setDescription('Power d\'un pays NationsGlory')
    .addStringOption(o => o.setName('nom').setDescription('Nom du pays').setRequired(true)),
  new SlashCommandBuilder()
    .setName('joueur')
    .setDescription('Infos sur un joueur NationsGlory')
    .addStringOption(o => o.setName('pseudo').setDescription('Pseudo du joueur').setRequired(true)),
  new SlashCommandBuilder()
    .setName('mmr')
    .setDescription('Classement MMR NationsGlory'),
  new SlashCommandBuilder()
    .setName('hdv')
    .setDescription('Hôtel des ventes NationsGlory'),
  new SlashCommandBuilder()
    .setName('online')
    .setDescription('Nombre de joueurs en ligne sur NationsGlory'),
].map(c => c.toJSON());

async function enregistrerCommandes() {
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  try {
    console.log('Enregistrement des commandes slash...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('Commandes slash enregistrées !');
  } catch (err) {
    console.error('Erreur enregistrement commandes:', err);
  }
}

// ===== HANDLERS COMMANDES =====
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply();

  try {
    if (interaction.commandName === 'pays') {
      const nom = interaction.options.getString('nom');
      const data = await ngFetch(`/country/${encodeURIComponent(nom)}`);
      const embed = new EmbedBuilder()
        .setTitle(`🌍 ${data.name || nom}`)
        .setColor(0xFFD700)
        .setTimestamp()
        .addFields(
          { name: '👑 Gouvernement', value: `**${data.owner || 'N/A'}**`, inline: true },
          { name: '👥 Membres', value: `**${data.members || 0}**`, inline: true },
          { name: '💰 Balance', value: `**${data.money || 0}$**`, inline: true },
          { name: '⚡ Power', value: `**${data.power || 0}**`, inline: true },
          { name: '🏙️ Capitale', value: `**${data.capital || 'N/A'}**`, inline: true },
          { name: '📅 Création', value: `**${data.creation || 'N/A'}**`, inline: true },
        );
      await interaction.editReply({ embeds: [embed] });

    } else if (interaction.commandName === 'bank') {
      const nom = interaction.options.getString('nom');
      const data = await ngFetch(`/country/${encodeURIComponent(nom)}`);
      const embed = new EmbedBuilder()
        .setTitle(`🏦 Bank de ${data.name || nom}`)
        .setColor(0xFFD700)
        .setTimestamp()
        .addFields(
          { name: '💰 Balance', value: `**${data.money || 0}$**`, inline: true },
          { name: '📈 Taxes', value: `**${data.taxes || 'N/A'}**`, inline: true },
        );
      await interaction.editReply({ embeds: [embed] });

    } else if (interaction.commandName === 'power') {
      const nom = interaction.options.getString('nom');
      const data = await ngFetch(`/country/${encodeURIComponent(nom)}`);
      const embed = new EmbedBuilder()
        .setTitle(`⚡ Power de ${data.name || nom}`)
        .setColor(0xFFD700)
        .setTimestamp()
        .addFields(
          { name: '⚡ Power total', value: `**${data.power || 0}**`, inline: true },
          { name: '👥 Membres', value: `**${data.members || 0}**`, inline: true },
          { name: '⚡ Power/membre', value: `**${data.members > 0 ? (data.power / data.members).toFixed(2) : 'N/A'}**`, inline: true },
        );
      await interaction.editReply({ embeds: [embed] });

    } else if (interaction.commandName === 'joueur') {
      const pseudo = interaction.options.getString('pseudo');
      const data = await ngFetch(`/user/${encodeURIComponent(pseudo)}`);
      const embed = new EmbedBuilder()
        .setTitle(`👤 ${data.name || pseudo}`)
        .setColor(0xFFD700)
        .setTimestamp()
        .addFields(
          { name: '🌍 Pays', value: `**${data.country || 'Sans pays'}**`, inline: true },
          { name: '⚡ Power', value: `**${data.power || 0}**`, inline: true },
          { name: '💰 Balance', value: `**${data.money || 0}$**`, inline: true },
          { name: '🏆 Grade', value: `**${data.grade || 'N/A'}**`, inline: true },
          { name: '📅 Inscription', value: `**${data.register || 'N/A'}**`, inline: true },
          { name: '🕐 Dernière connexion', value: `**${data.lastSeen || 'N/A'}**`, inline: true },
        );
      await interaction.editReply({ embeds: [embed] });

    } else if (interaction.commandName === 'mmr') {
      const data = await ngFetch('/mmr');
      const top = (data.slice ? data.slice(0, 10) : []);
      const embed = new EmbedBuilder()
        .setTitle('🏆 Classement MMR NationsGlory')
        .setColor(0xFFD700)
        .setTimestamp()
        .setDescription(top.map((p, i) => `**${i + 1}.** ${p.name || p.country} — **${p.mmr || p.score}** MMR`).join('\n') || 'Aucune donnée');
      await interaction.editReply({ embeds: [embed] });

    } else if (interaction.commandName === 'hdv') {
      const data = await ngFetch('/hdv');
      const items = (data.slice ? data.slice(0, 10) : []);
      const embed = new EmbedBuilder()
        .setTitle('🛒 Hôtel des Ventes')
        .setColor(0xFFD700)
        .setTimestamp()
        .setDescription(items.map(i => `**${i.item || i.name}** — **${i.price || i.cout}$** (x${i.quantity || i.amount || 1})`).join('\n') || 'Aucune donnée');
      await interaction.editReply({ embeds: [embed] });

    } else if (interaction.commandName === 'online') {
      const data = await ngFetch('/playerscount');
      const embed = new EmbedBuilder()
        .setTitle('🟢 Joueurs en ligne')
        .setColor(0x4CAF50)
        .setTimestamp()
        .addFields(
          { name: '👥 En ligne', value: `**${data.online || data.count || 0}**`, inline: true },
          { name: '📊 Record', value: `**${data.record || 'N/A'}**`, inline: true },
        );
      await interaction.editReply({ embeds: [embed] });
    }
  } catch (err) {
    console.error('Erreur commande slash:', err.message);
    const embed = new EmbedBuilder()
      .setTitle('❌ Erreur')
      .setDescription(`Impossible de récupérer les données : **${err.message}**`)
      .setColor(0xf44336);
    await interaction.editReply({ embeds: [embed] });
  }
});

// ===== LOGS WEBHOOK =====
async function envoyerLog(titre, description, couleur = 0xFFD700) {
  if (!WEBHOOK_URL) return;
  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [{ title: titre, description: description, color: couleur, timestamp: new Date().toISOString() }] })
    });
  } catch (err) { console.error("Erreur log:", err.message); }
}

// ===== BILAN MENSUEL =====
async function envoyerBilanMensuel(stats) {
  const ratio = stats.charsPerdusTotal > 0 ? (stats.charsDetruitTotal / stats.charsPerdusTotal).toFixed(2) : stats.charsDetruitTotal > 0 ? '∞' : '0';
  const meilleurTireur = Object.entries(stats.tireurs).sort((a, b) => b[1] - a[1])[0];
  const nomMois = MOIS[stats.mois];
  const embed = {
    embeds: [{
      title: `📊 Bilan du mois de ${nomMois} ${stats.annee}`,
      color: 0xFFD700,
      fields: [
        { name: '💥 Chars ennemis détruits', value: `**${stats.charsDetruitTotal}**`, inline: true },
        { name: '💀 Chars alliés perdus', value: `**${stats.charsPerdusTotal}**`, inline: true },
        { name: '🚩 Chars capturés', value: `**${stats.charsCapturesTotal || 0}**`, inline: true },
        { name: '⚖️ Ratio', value: `**${ratio}**`, inline: true },
        { name: '🏆 Record du mois', value: `**${stats.recordRapport}** chars détruits en un rapport`, inline: false },
        { name: '🎯 Meilleur tireur', value: meilleurTireur ? `**${meilleurTireur[0]}** — **${meilleurTireur[1]}** chars` : 'Aucun', inline: false },
      ],
      footer: { text: `Réinitialisation automatique — ${nomMois} ${stats.annee}` },
      timestamp: new Date().toISOString()
    }]
  };
  for (const userId of USER_IDS) {
    try { const user = await client.users.fetch(userId.trim()); await user.send(embed); }
    catch (err) { console.error(`Erreur bilan MP:`, err.message); }
  }
  if (WEBHOOK_URL) await fetch(WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(embed) });
}

async function verifierReinitialisationMois(stats) {
  const now = new Date();
  if (stats.mois !== now.getMonth() || stats.annee !== now.getFullYear()) {
    await envoyerBilanMensuel(stats);
    stats.mois = now.getMonth(); stats.annee = now.getFullYear();
    stats.charsDetruitTotal = 0; stats.charsPerdusTotal = 0; stats.charsCapturesTotal = 0;
    stats.recordRapport = 0; stats.tireurs = {}; stats.rapports = [];
    sauvegarderStats(stats);
  }
  return stats;
}

let comptes = chargerComptes();
let botStartTime = new Date();

client.once('ready', () => {
  console.log(`Bot connecté en tant que ${client.user.tag}`);
  botStartTime = new Date();
  envoyerLog("🟢 Bot démarré", `**${client.user.tag}** est maintenant en ligne !`, 0x4CAF50);
  enregistrerCommandes();
});

// ===== AUTH =====
function auth(req, res, next) {
  const username = req.headers['x-username'];
  const password = req.headers['x-password'];
  const compte = comptes.find(c => c.username === username && c.password === password);
  if (!compte) return res.status(401).json({ error: "Non autorisé" });
  req.compte = compte;
  next();
}
function adminOnly(req, res, next) {
  if (req.compte.role !== 'admin') return res.status(403).json({ error: "Réservé à l'admin" });
  next();
}

// ===== ROUTES =====
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const compte = comptes.find(c => c.username === username && c.password === password);
  if (!compte) { envoyerLog("🔴 Connexion échouée", `Tentative : **${username}**`, 0xf44336); return res.status(401).json({ error: "Identifiants incorrects" }); }
  envoyerLog("🔵 Connexion dashboard", `**${username}** (${compte.role}) connecté`, 0x378ADD);
  res.json({ success: true, role: compte.role, username: compte.username });
});

app.get('/status', auth, (req, res) => {
  const uptime = Math.floor((new Date() - botStartTime) / 1000);
  res.json({ online: client.isReady(), tag: client.user ? client.user.tag : "Déconnecté", uptime });
});

app.post('/send', auth, async (req, res) => {
  const { userIds, message } = req.body;
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  const results = [];
  for (const userId of ids) {
    try {
      const user = await client.users.fetch(userId.trim());
      const embed = new EmbedBuilder().setTitle('📩 Message du Dashboard').setDescription(message).setColor(0xFFD700).setFooter({ text: `Envoyé par ${req.compte.username}` }).setTimestamp();
      await user.send({ embeds: [embed] });
      results.push({ userId, success: true });
    } catch (err) { results.push({ userId, success: false, error: err.message }); }
  }
  const succes = results.filter(r => r.success).length;
  const echecs = results.filter(r => !r.success).length;
  envoyerLog("💬 Message envoyé", `Par **${req.compte.username}**\n✅ ${succes} — ❌ ${echecs}`, 0xFFD700);
  res.json({ results });
});

app.post('/restart', auth, async (req, res) => {
  try {
    const response = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/restart`, { method: 'POST', headers: { 'Authorization': `Bearer ${RENDER_API_KEY}`, 'Content-Type': 'application/json' } });
    if (response.ok) { envoyerLog("🔄 Redémarrage", `Lancé par **${req.compte.username}**`, 0xFF9800); res.json({ success: true }); }
    else { const data = await response.json(); res.status(500).json({ error: data.message }); }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/candidature', async (req, res) => {
  const { fields, titre } = req.body;
  if (!fields || fields.length === 0) return res.status(400).json({ error: "Aucun champ reçu" });
  const embed = new EmbedBuilder().setTitle(titre || "📋 Nouvelle candidature reçue !").setColor(0xFFD700).setTimestamp().addFields(fields.map(f => ({ name: f.name, value: String(f.value) })));
  for (const userId of USER_IDS) {
    try { const user = await client.users.fetch(userId); await user.send({ embeds: [embed] }); }
    catch (err) { console.error(`Erreur MP:`, err.message); }
  }
  res.json({ success: true });
});

app.post('/rapport', async (req, res) => {
  const { nom, tireur, charsDetruit, charsPerdus, front, date, charUtilise, vehiculesConfront, autresPersonnes, charsCaptures, reparations } = req.body;
  let stats = chargerStats();
  stats = await verifierReinitialisationMois(stats);
  const detruits = parseInt(charsDetruit) || 0;
  const perdus = parseInt(charsPerdus) || 0;
  const captures = parseInt(charsCaptures) || 0;
  stats.charsDetruitTotal += detruits; stats.charsPerdusTotal += perdus;
  stats.charsCapturesTotal = (stats.charsCapturesTotal || 0) + captures;
  if (detruits > stats.recordRapport) stats.recordRapport = detruits;
  if (!stats.tireurs[tireur]) stats.tireurs[tireur] = 0;
  stats.tireurs[tireur] += detruits;
  stats.rapports.push({ id: Date.now(), nom, tireur, detruits, perdus, captures, date });
  sauvegarderStats(stats);
  const ratio = perdus > 0 ? (detruits / perdus).toFixed(2) : detruits > 0 ? '∞' : '0';
  const nomMois = MOIS[stats.mois];
  const embed = new EmbedBuilder().setTitle(`📋 Rapport de combat — ${nom}`).setColor(0xFFD700).setTimestamp()
    .addFields(
      { name: '👤 Rapporteur', value: `**${nom}**`, inline: true },
      { name: '🎯 Tireur', value: `**${tireur}**`, inline: true },
      { name: '📍 Front', value: `**${front}**`, inline: true },
      { name: '🛡️ Char utilisé', value: `**${charUtilise || 'N/A'}**`, inline: true },
      { name: '⚔️ Véhicules confrontés', value: `**${vehiculesConfront || 'N/A'}**`, inline: true },
      { name: '👥 Équipage', value: `**${autresPersonnes || 'Solo'}**`, inline: true },
      { name: '💥 Chars ennemis détruits', value: `**${detruits}**`, inline: true },
      { name: '💀 Chars alliés perdus', value: `**${perdus}**`, inline: true },
      { name: '🚩 Chars capturés', value: `**${captures}**`, inline: true },
      { name: '⚖️ Ratio', value: `**${ratio}**`, inline: true },
      { name: '🔧 Réparations', value: `**${reparations || 0}**`, inline: true },
      { name: '📅 Date', value: `**${date}**`, inline: true },
      { name: `📊 Total ${nomMois}`, value: `**${stats.charsDetruitTotal}** détruits | **${stats.charsCapturesTotal}** capturés`, inline: false },
      { name: '🏆 Record par rapport', value: `**${stats.recordRapport}** chars détruits`, inline: true },
    );
  for (const userId of USER_IDS) {
    try { const user = await client.users.fetch(userId.trim()); await user.send({ embeds: [embed] }); }
    catch (err) { console.error(`Erreur MP rapport:`, err.message); }
  }
  res.json({ success: true });
});

app.get('/stats', auth, (req, res) => { res.json(chargerStats()); });

app.put('/stats', auth, (req, res) => {
  const { charsDetruitTotal, charsPerdusTotal, recordRapport, charsCapturesTotal } = req.body;
  const stats = chargerStats();
  if (charsDetruitTotal !== undefined) stats.charsDetruitTotal = parseInt(charsDetruitTotal);
  if (charsPerdusTotal !== undefined) stats.charsPerdusTotal = parseInt(charsPerdusTotal);
  if (recordRapport !== undefined) stats.recordRapport = parseInt(recordRapport);
  if (charsCapturesTotal !== undefined) stats.charsCapturesTotal = parseInt(charsCapturesTotal);
  sauvegarderStats(stats);
  envoyerLog("✏️ Stats modifiées", `Par **${req.compte.username}**`, 0xFF9800);
  res.json({ success: true });
});

app.delete('/stats/rapport/:id', auth, (req, res) => {
  const id = parseInt(req.params.id);
  const stats = chargerStats();
  const rapport = stats.rapports.find(r => r.id === id);
  if (!rapport) return res.status(404).json({ error: "Rapport introuvable" });
  stats.charsDetruitTotal -= rapport.detruits; stats.charsPerdusTotal -= rapport.perdus;
  stats.charsCapturesTotal = (stats.charsCapturesTotal || 0) - (rapport.captures || 0);
  if (stats.tireurs[rapport.tireur]) stats.tireurs[rapport.tireur] -= rapport.detruits;
  stats.rapports = stats.rapports.filter(r => r.id !== id);
  stats.recordRapport = stats.rapports.length > 0 ? Math.max(...stats.rapports.map(r => r.detruits)) : 0;
  sauvegarderStats(stats);
  envoyerLog("🗑️ Rapport supprimé", `Par **${req.compte.username}** — **${rapport.nom}** (${rapport.detruits} chars)`, 0xf44336);
  res.json({ success: true });
});

app.post('/stats/reset', auth, adminOnly, async (req, res) => {
  const stats = chargerStats();
  await envoyerBilanMensuel(stats);
  stats.charsDetruitTotal = 0; stats.charsPerdusTotal = 0; stats.charsCapturesTotal = 0;
  stats.recordRapport = 0; stats.tireurs = {}; stats.rapports = [];
  sauvegarderStats(stats);
  envoyerLog("🔁 Stats réinitialisées", `Par **${req.compte.username}**`, 0xf44336);
  res.json({ success: true });
});

app.get('/comptes', auth, adminOnly, (req, res) => { res.json(comptes.map(c => ({ username: c.username, role: c.role }))); });
app.post('/comptes', auth, adminOnly, (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) return res.status(400).json({ error: "Champs manquants" });
  if (comptes.find(c => c.username === username)) return res.status(400).json({ error: "Nom déjà pris" });
  comptes.push({ username, password, role });
  sauvegarderComptes(comptes);
  envoyerLog("👤 Compte créé", `**${username}** (${role}) par **${req.compte.username}**`, 0x4CAF50);
  res.json({ success: true });
});
app.delete('/comptes/:username', auth, adminOnly, (req, res) => {
  const { username } = req.params;
  if (username === 'admin') return res.status(400).json({ error: "Impossible de supprimer l'admin" });
  comptes = comptes.filter(c => c.username !== username);
  sauvegarderComptes(comptes);
  envoyerLog("🗑️ Compte supprimé", `**${username}** par **${req.compte.username}**`, 0xf44336);
  res.json({ success: true });
});
app.put('/comptes/:username/password', auth, (req, res) => {
  const { username } = req.params;
  const { newPassword } = req.body;
  if (req.compte.role !== 'admin' && req.compte.username !== username) return res.status(403).json({ error: "Non autorisé" });
  const compte = comptes.find(c => c.username === username);
  if (!compte) return res.status(404).json({ error: "Compte introuvable" });
  compte.password = newPassword;
  sauvegarderComptes(comptes);
  envoyerLog("🔑 Mot de passe changé", `**${username}** par **${req.compte.username}**`, 0xFF9800);
  res.json({ success: true });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

client.login(BOT_TOKEN).then(() => {
  app.listen(3000, () => console.log('Serveur démarré sur le port 3000'));
});
