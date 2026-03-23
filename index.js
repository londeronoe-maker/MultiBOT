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
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || "admin";
const RENDER_API_KEY = process.env.RENDER_API_KEY;
const SERVICE_ID = "srv-d70574i4d50c7393n1qg";

let botStartTime = new Date();

client.once('ready', () => {
  console.log(`Bot connecté en tant que ${client.user.tag}`);
  botStartTime = new Date();
});

function auth(req, res, next) {
  const password = req.headers['x-password'];
  if (password !== DASHBOARD_PASSWORD) return res.status(401).json({ error: "Non autorisé" });
  next();
}

app.get('/status', auth, (req, res) => {
  const uptime = Math.floor((new Date() - botStartTime) / 1000);
  res.json({
    online: client.isReady(),
    tag: client.user ? client.user.tag : "Déconnecté",
    uptime: uptime
  });
});

app.post('/send', auth, async (req, res) => {
  const { userId, message } = req.body;
  try {
    const user = await client.users.fetch(userId);
    await user.send(message);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
      res.json({ success: true });
    } else {
      const data = await response.json();
      res.status(500).json({ error: data.message });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/stop', auth, async (req, res) => {
  try {
    const response = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/suspend`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RENDER_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    if (response.ok) {
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

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

client.login(BOT_TOKEN).then(() => {
  app.listen(3000, () => console.log('Serveur démarré sur le port 3000'));
});
