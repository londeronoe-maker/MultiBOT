const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');
const path = require('path');

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

// Comptes stockés en mémoire
let comptes = [
  { username: "admin", password: ADMIN_PASSWORD, role: "admin" }
];

let botStartTime = new Date();

client.once('ready', () => {
  console.log(`Bot connecté en tant que ${client.user.tag}`);
  botStartTime = new Date();
});

// Auth middleware
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

// Login
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const compte = comptes.find(c => c.username === username && c.password === password);
  if (!compte) return res.status(401).json({ error: "Identifiants incorrects" });
  res.json({ success: true, role: compte.role, username: compte.username });
});

// Statut
app.get('/status', auth, (req, res) => {
  const uptime = Math.floor((new Date() - botStartTime) / 1000);
  res.json({
    online: client.isReady(),
    tag: client.user ? client.user.tag : "Déconnecté",
    uptime: uptime
  });
});

// Envoyer message à plusieurs IDs
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

  res.json({ results });
});

// Restart
app.post('/restart', auth, async (req, res) => {
  try {
    const response = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/restart`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RENDER_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    if (response.ok) res.json({ success: true });
    else {
      const data = await response.json();
      res.status(500).json({ error: data.message });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Candidature
app.post('/candidature', async (req, res) => {
  console.log("Requête reçue:", JSON.stringify(req.body));
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
      console.log(`MP embed envoyé à ${userId}`);
    } catch (err) {
      console.error(`Erreur MP pour ${userId}:`, err.message);
    }
  }

  res.json({ success: true });
});

// Gestion des comptes (admin uniquement)
app.get('/comptes', auth, adminOnly, (req, res) => {
  res.json(comptes.map(c => ({ username: c.username, role: c.role })));
});

app.post('/comptes', auth, adminOnly, (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) return res.status(400).json({ error: "Champs manquants" });
  if (comptes.find(c => c.username === username)) return res.status(400).json({ error: "Nom d'utilisateur déjà pris" });
  comptes.push({ username, password, role });
  res.json({ success: true });
});

app.delete('/comptes/:username', auth, adminOnly, (req, res) => {
  const { username } = req.params;
  if (username === 'admin') return res.status(400).json({ error: "Impossible de supprimer l'admin" });
  comptes = comptes.filter(c => c.username !== username);
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
  res.json({ success: true });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

client.login(BOT_TOKEN).then(() => {
  app.listen(3000, () => console.log('Serveur démarré sur le port 3000'));
});
