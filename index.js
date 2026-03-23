const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');
const path = require('path');
const fs = require('fs');
const { default: NationsAPI } = require('@baba33mrt/nationsapi');

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
const NG_API_KEY = process.env.NATIONSGLORY_API_KEY;
const COMPTES_FILE = path.join(__dirname, 'comptes.json');
const NATION_NAME = "Cap Vert";
const SERVEUR = "mocha";

const ngApi = new NationsAPI(NG_API_KEY);

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

// Commande !nation
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.content.toLowerCase() === '!nation') {
    try {
      const nation = await ngApi.nation.get(NATION_NAME, SERVEUR);
      console.log("Réponse API:", JSON.stringify(nation));

      if ('error' in nation) {
        return message.reply("❌ Impossible de récupérer les données : " + JSON.stringify(nation.error));
      }

      const embed = new EmbedBuilder()
        .setTitle(`🌍 ${nation.name}`)
        .setColor(0xFFD700)
        .setTimestamp()
        .addFields(
          { name: "👥 Membres", value: `${nation.members}`, inline: true },
          { name: "💰 Argent", value: `${nation.bank ? nation.bank.toLocaleString() : '?'} $`, inline: true },
          { name: "⚔️ Power", value: `${nation.power}/${nation.maxPower}`, inline: true },
          { name: "📊 MMR", value: `${nation.mmr || '?'}`, inline: true },
          { name: "🗺️ Claims", value: `${nation.claims || '?'}`, inline: true },
          { name: "🖥️ Serveur", value: SERVEUR, inline: true }
        );

      message.reply({ embeds: [embed] });
    } catch (err) {
      console.error("Erreur NationsGlory:", err.message);
      message.reply("❌ Erreur : " + err.message);
    }
  }
});

// Stats NationsGlory via dashboard
app.get('/nation', auth, async (req, res) => {
  try {
    const nation = await ngApi.nation.get(NATION_NAME, SERVEUR);
    if ('error' in nation) return res.status(404).json({ error: "Nation introuvable" });
    res.json(nation);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
