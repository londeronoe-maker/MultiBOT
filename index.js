const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');

const app = express();
app.use(express.json());

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages]
});

const BOT_TOKEN = process.env.BOT_TOKEN;
const USER_IDS = process.env.USER_IDS.split(',');

client.once('ready', () => {
  console.log(`Bot connecté en tant que ${client.user.tag}`);
});

app.post('/candidature', async (req, res) => {
  console.log("Requête reçue:", JSON.stringify(req.body));

  const { fields, titre } = req.body;

  if (!fields || fields.length === 0) {
    console.log("Aucun champ reçu !");
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

app.get('/', (req, res) => res.send('Bot en ligne !'));

client.login(BOT_TOKEN).then(() => {
  app.listen(3000, () => console.log('Serveur démarré sur le port 3000'));
});
