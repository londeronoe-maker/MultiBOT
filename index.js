const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessages
  ]
});

const BOT_TOKEN = process.env.BOT_TOKEN;
const USER_IDS = process.env.USER_IDS.split(',');
const RENDER_API_KEY = process.env.RENDER_API_KEY;
const SERVICE_ID = "srv-d70574i4d50c7393n1qg";
const ADMIN_PASSWORD = process.env.DASHBOARD_PASSWORD || "admin";
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const COMPTES_FILE = path.join(__dirname, 'comptes.json');

function chargerComptes() {
  if (fs.existsSync(COMPTES_FILE)) {
    return JSON.parse(fs.readFileSync(COMPTES_FILE, 'utf8'));
  }
  const initial = [{ username: "admin", password: ADMIN_PASSWORD, role: "admin" }];
  sauvegarderComptes(initial);
  return initial;
}

function sauvegarderComptes(comptes) {
  fs.writeFileSync(COMPTES_FILE, JSON.stringify(comptes, null, 2));
}

async function envoyerLog(titre, description, couleur = 0xFFD700) {
  if (!WEBHOOK_URL) return;
  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{
          title: titre,
          description: description,
          color: couleur,
          timestamp: new Date().toISOString()
        }]
      })
    });
  } catch (err) {
    console.error("Erreur log webhook:", err.message);
  }
}

let comptes = chargerComptes();
let botStartTime = new Date();

client.once('ready', () => {
  console.log(`MultiBOT connecté en tant que ${client.user.tag}`);
  botStartTime = new Date();
  envoyerLog("🟢 MultiBOT démarré", `**${client.user.tag}** est maintenant en ligne !`, 0x4CAF50);
});

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

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const compte = comptes.find(c => c.username === username && c.password === password);
  if (!compte) {
    envoyerLog("🔴 Tentative de connexion échouée", `Nom d'utilisateur : **${username}**`, 0xf44336);
    return res.status(401).json({ error: "Identifiants incorrects" });
  }
  envoyerLog("🔵 Connexion au dashboard", `**${username}** (${compte.role}) s'est connecté`, 0x378ADD);
  res.json({ success: true, role: compte.role, username: compte.username });
});

app.get('/status', auth, (req, res) => {
  const uptime = Math.floor((new Date() - botStartTime) / 1000);
  res.json({
    online: client.isReady(),
    tag: client.user ? client.user.tag : "Déconnecté",
    uptime: uptime
  });
});

app.post('/send', auth, async (req, res) => {
  const { userIds, message } = req.body;
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  const results = [];

  for (const userId of ids) {
    try {
      const user = await client.users.fetch(userId.trim());
      await user.send(message);
      results.push({ userId, success: true });
    } catch (err) {
      results.push({ userId, success: false, error: err.message });
    }
  }

  const succes = results.filter(r => r.success).length;
  const echecs = results.filter(r => !r.success).length;
  envoyerLog("💬 Message envoyé", `Par **${req.compte.username}**\n✅ ${succes} envoyé(s) — ❌ ${echecs} échoué(s)\n\n**Message :** ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`, 0xFFD700);

  res.json({ results });
});

app.post('/restart', auth, async (req, res) => {
  try {
    const response = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/restart`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RENDER_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    if (response.ok) {
      envoyerLog("🔄 MultiBOT redémarré", `Redémarrage lancé par **${req.compte.username}**`, 0xFF9800);
      res.json({ success: true });
    } else {
      const data = await response.json();
      res.status(500).json({ error: data.message });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/candidature', async (req, res) => {
  const { fields, titre } = req.body;
  if (!fields || fields.length === 0) {
    return res.status(400).json({ error: "Aucun champ reçu" });
  }

  const embed = new EmbedBuilder()
    .setTitle(titre || "📋 Nouvelle candidature reçue !")
    .setColor(0xFFD700)
    .setTimestamp()
    .addFields(fields.map(f => ({ name: f.name, value: String(f.value) })));

  for (const userId of USER_IDS) {
    try {
      const user = await client.users.fetch(userId);
      await user.send({ embeds: [embed] });
    } catch (err) {
      console.error(`Erreur MP pour ${userId}:`, err.message);
    }
  }

  res.json({ success: true });
});

app.get('/comptes', auth, adminOnly, (req, res) => {
  res.json(comptes.map(c => ({ username: c.username, role: c.role })));
});

app.post('/comptes', auth, adminOnly, (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) return res.status(400).json({ error: "Champs manquants" });
  if (comptes.find(c => c.username === username)) return res.status(400).json({ error: "Nom d'utilisateur déjà pris" });
  comptes.push({ username, password, role });
  sauvegarderComptes(comptes);
  envoyerLog("👤 Nouveau compte créé", `**${username}** (${role}) créé par **${req.compte.username}**`, 0x4CAF50);
  res.json({ success: true });
});

app.delete('/comptes/:username', auth, adminOnly, (req, res) => {
  const { username } = req.params;
  if (username === 'admin') return res.status(400).json({ error: "Impossible de supprimer l'admin" });
  comptes = comptes.filter(c => c.username !== username);
  sauvegarderComptes(comptes);
  envoyerLog("🗑️ Compte supprimé", `**${username}** supprimé par **${req.compte.username}**`, 0xf44336);
  res.json({ success: true });
});

app.put('/comptes/:username/password', auth, (req, res) => {
  const { username } = req.params;
  const { newPassword } = req.body;
  if (req.compte.role !== 'admin' && req.compte.username !== username) {
    return res.status(403).json({ error: "Non autorisé" });
  }
  const compte = comptes.find(c => c.username === username);
  if (!compte) return res.status(404).json({ error: "Compte introuvable" });
  compte.password = newPassword;
  sauvegarderComptes(comptes);
  envoyerLog("🔑 Mot de passe changé", `Mot de passe de **${username}** modifié par **${req.compte.username}**`, 0xFF9800);
  res.json({ success: true });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

client.login(BOT_TOKEN).then(() => {
  app.listen(3000, () => console.log('Serveur démarré sur le port 3000'));
});
