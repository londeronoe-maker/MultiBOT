const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { MongoClient } = require('mongodb');
const express = require('express');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages]
});

const BOT_TOKEN = process.env.BOT_TOKEN;
const USER_IDS = process.env.USER_IDS ? process.env.USER_IDS.split(',').map(id => id.trim()) : [];
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const CLIENT_ID = "1485359905639764070";
const GUILD_ID = "1479289389476610149";
const MONGODB_URL = process.env.MONGODB_URL;

let db;
const MOIS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

// ===== MONGODB =====
async function connectMongo() {
  const mongoClient = new MongoClient(MONGODB_URL);
  await mongoClient.connect();
  db = mongoClient.db('multibot');
  console.log('MongoDB connecté !');
  const stats = db.collection('stats');
  const s = await stats.findOne({ _id: 'current' });
  if (!s) await stats.insertOne({
    _id: 'current',
    mois: new Date().getMonth(),
    annee: new Date().getFullYear(),
    charsDetruitTotal: 0, charsPerdusTotal: 0, charsCapturesTotal: 0,
    recordRapport: 0, tireurs: {}, rapports: [], admins: USER_IDS
  });
}

async function getStats() { return db.collection('stats').findOne({ _id: 'current' }); }
async function saveStats(stats) { await db.collection('stats').replaceOne({ _id: 'current' }, stats, { upsert: true }); }

async function getAdmins() {
  const stats = await getStats();
  return (stats && stats.admins && stats.admins.length) ? stats.admins : USER_IDS;
}
async function isAdmin(userId) {
  const admins = await getAdmins();
  return admins.includes(userId);
}

// ===== LOGS =====
async function envoyerLog(titre, description, couleur = 0xFFD700) {
  if (!WEBHOOK_URL) return;
  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [{ title: titre, description, color: couleur, timestamp: new Date().toISOString() }] })
    });
  } catch (err) { console.error('Erreur log:', err.message); }
}

// ===== BILAN MENSUEL =====
async function envoyerBilanMensuel(stats) {
  const ratio = stats.charsPerdusTotal > 0 ? (stats.charsDetruitTotal / stats.charsPerdusTotal).toFixed(2) : stats.charsDetruitTotal > 0 ? '∞' : '0';
  const tireurs = Object.entries(stats.tireurs || {}).sort((a, b) => b[1] - a[1]);
  const meilleurTireur = tireurs[0];
  const embed = new EmbedBuilder()
    .setTitle(`📊 Bilan de ${MOIS[stats.mois]} ${stats.annee}`)
    .setColor(0xFFD700)
    .addFields(
      { name: '💥 Chars détruits', value: `**${stats.charsDetruitTotal}**`, inline: true },
      { name: '💀 Chars perdus', value: `**${stats.charsPerdusTotal}**`, inline: true },
      { name: '🚩 Capturés', value: `**${stats.charsCapturesTotal || 0}**`, inline: true },
      { name: '⚖️ Ratio', value: `**${ratio}**`, inline: true },
      { name: '🏆 Record', value: `**${stats.recordRapport}** chars en un rapport`, inline: false },
      { name: '🎯 Meilleur tireur', value: meilleurTireur ? `**${meilleurTireur[0]}** — **${meilleurTireur[1]}** chars` : 'Aucun', inline: false }
    )
    .setFooter({ text: `Réinitialisation — ${MOIS[stats.mois]} ${stats.annee}` })
    .setTimestamp();
  const admins = await getAdmins();
  for (const userId of admins) {
    try { const u = await client.users.fetch(userId); await u.send({ embeds: [embed] }); } catch (e) {}
  }
  if (WEBHOOK_URL) {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed.toJSON()] })
    });
  }
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

// ===== GRAPHIQUE ASCII (sans canvas) =====
function genererGraphiqueTexte(stats) {
  const rapports = stats.rapports || [];
  const parJour = {};
  rapports.forEach(r => {
    const d = r.date || '?';
    if (!parJour[d]) parJour[d] = { d: 0, p: 0, c: 0 };
    parJour[d].d += r.detruits || 0;
    parJour[d].p += r.perdus || 0;
    parJour[d].c += r.captures || 0;
  });
  const jours = Object.keys(parJour).sort();
  if (!jours.length) return '```\nAucun rapport ce mois-ci\n```';

  const maxVal = Math.max(...jours.map(j => Math.max(parJour[j].d, parJour[j].p, parJour[j].c)), 1);
  const HAUTEUR = 8;
  let lignes = [];
  for (let h = HAUTEUR; h >= 1; h--) {
    const seuil = Math.round((h / HAUTEUR) * maxVal);
    let ligne = String(seuil).padStart(3) + ' |';
    jours.forEach(j => {
      const d = parJour[j].d >= seuil ? 'D' : ' ';
      const p = parJour[j].p >= seuil ? 'P' : ' ';
      const c = parJour[j].c >= seuil ? 'C' : ' ';
      ligne += ' ' + d + p + c;
    });
    lignes.push(ligne);
  }
  lignes.push('    +' + jours.map(() => '----').join(''));
  lignes.push('     ' + jours.map(j => j.slice(0, 4)).join(' '));
  lignes.push('');
  lignes.push('D=Détruits  P=Perdus  C=Capturés');
  return '```\n' + lignes.join('\n') + '\n```';
}

// ===== COMMANDES =====
const commands = [
  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Voir les statistiques du mois'),

  new SlashCommandBuilder()
    .setName('rapport')
    .setDescription('Gérer les rapports de combat')
    .addSubcommand(sub => sub.setName('ajouter').setDescription('Ajouter un rapport')
      .addStringOption(o => o.setName('nom').setDescription('Ton nom').setRequired(true))
      .addStringOption(o => o.setName('tireur').setDescription('Nom du tireur').setRequired(true))
      .addIntegerOption(o => o.setName('detruits').setDescription('Chars détruits').setRequired(true))
      .addIntegerOption(o => o.setName('perdus').setDescription('Chars perdus').setRequired(true))
      .addStringOption(o => o.setName('front').setDescription('Front').setRequired(true))
      .addStringOption(o => o.setName('date').setDescription('Date (ex: 15/04/2025)').setRequired(true))
      .addIntegerOption(o => o.setName('captures').setDescription('Chars capturés').setRequired(false))
      .addStringOption(o => o.setName('char').setDescription('Char utilisé').setRequired(false))
      .addStringOption(o => o.setName('ennemis').setDescription('Véhicules confrontés').setRequired(false))
      .addStringOption(o => o.setName('equipage').setDescription('Autres personnes dans le char').setRequired(false))
      .addIntegerOption(o => o.setName('reparations').setDescription('Nombre de réparations').setRequired(false)))
    .addSubcommand(sub => sub.setName('supprimer').setDescription('Supprimer un rapport (admin)')
      .addStringOption(o => o.setName('id').setDescription('ID du rapport').setRequired(true)))
    .addSubcommand(sub => sub.setName('liste').setDescription('Voir tous les rapports du mois'))
    .addSubcommand(sub => sub.setName('reset').setDescription('Réinitialiser les stats du mois (admin)')),

  new SlashCommandBuilder()
    .setName('mp')
    .setDescription('Envoyer un message privé à un membre (admin)')
    .addUserOption(o => o.setName('membre').setDescription('Membre à contacter').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Message à envoyer').setRequired(true)),

  new SlashCommandBuilder()
    .setName('message')
    .setDescription('Envoyer un message dans un salon (admin)')
    .addChannelOption(o => o.setName('salon').setDescription('Salon cible').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Message à envoyer').setRequired(true)),

  new SlashCommandBuilder()
    .setName('graphique')
    .setDescription('Voir le graphique des stats du mois'),

  new SlashCommandBuilder()
    .setName('compte')
    .setDescription('Gérer les admins autorisés (admin)')
    .addSubcommand(sub => sub.setName('ajouter').setDescription('Ajouter un admin')
      .addUserOption(o => o.setName('membre').setDescription('Membre à ajouter').setRequired(true)))
    .addSubcommand(sub => sub.setName('retirer').setDescription('Retirer un admin')
      .addUserOption(o => o.setName('membre').setDescription('Membre à retirer').setRequired(true)))
    .addSubcommand(sub => sub.setName('liste').setDescription('Voir la liste des admins')),

  new SlashCommandBuilder()
    .setName('restart')
    .setDescription('Redémarrer le bot (admin)'),

].map(c => c.toJSON());

async function enregistrerCommandes() {
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('Commandes enregistrées !');
  } catch (err) { console.error('Erreur commandes:', err); }
}

// ===== INTERACTIONS =====
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;
  const userId = interaction.user.id;
  const admin = await isAdmin(userId);

  // ===== /stats =====
  if (commandName === 'stats') {
    await interaction.deferReply();
    let stats = await getStats();
    stats = await verifierReinitialisationMois(stats);
    const ratio = stats.charsPerdusTotal > 0 ? (stats.charsDetruitTotal / stats.charsPerdusTotal).toFixed(2) : stats.charsDetruitTotal > 0 ? '∞' : '0';
    const tireurs = Object.entries(stats.tireurs || {}).sort((a, b) => b[1] - a[1]);
    const meilleurTireur = tireurs[0];
    const top3 = tireurs.slice(0, 3).map((t, i) => `${['🥇','🥈','🥉'][i]} **${t[0]}** — ${t[1]} chars`).join('\n') || 'Aucun';
    const embed = new EmbedBuilder()
      .setTitle(`📊 Statistiques — ${MOIS[stats.mois]} ${stats.annee}`)
      .setColor(0xFFD700)
      .addFields(
        { name: '💥 Chars détruits', value: `**${stats.charsDetruitTotal}**`, inline: true },
        { name: '💀 Chars perdus', value: `**${stats.charsPerdusTotal}**`, inline: true },
        { name: '🚩 Chars capturés', value: `**${stats.charsCapturesTotal || 0}**`, inline: true },
        { name: '⚖️ Ratio', value: `**${ratio}**`, inline: true },
        { name: '🏆 Record', value: `**${stats.recordRapport}** chars en un rapport`, inline: true },
        { name: '📋 Rapports', value: `**${(stats.rapports || []).length}** ce mois`, inline: true },
        { name: '🎯 Top Tireurs', value: top3, inline: false }
      )
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  }

  // ===== /rapport =====
  else if (commandName === 'rapport') {
    const sub = interaction.options.getSubcommand();

    if (sub === 'ajouter') {
      await interaction.deferReply();
      let stats = await getStats();
      stats = await verifierReinitialisationMois(stats);
      const nom = interaction.options.getString('nom');
      const tireur = interaction.options.getString('tireur');
      const detruits = interaction.options.getInteger('detruits') || 0;
      const perdus = interaction.options.getInteger('perdus') || 0;
      const front = interaction.options.getString('front');
      const date = interaction.options.getString('date');
      const captures = interaction.options.getInteger('captures') || 0;
      const charUtilise = interaction.options.getString('char') || 'N/A';
      const ennemis = interaction.options.getString('ennemis') || 'N/A';
      const equipage = interaction.options.getString('equipage') || 'Solo';
      const reparations = interaction.options.getInteger('reparations') || 0;

      stats.charsDetruitTotal += detruits;
      stats.charsPerdusTotal += perdus;
      stats.charsCapturesTotal = (stats.charsCapturesTotal || 0) + captures;
      if (detruits > stats.recordRapport) stats.recordRapport = detruits;
      stats.tireurs[tireur] = (stats.tireurs[tireur] || 0) + detruits;
      stats.rapports.push({ id: Date.now(), nom, tireur, detruits, perdus, captures, date });
      await saveStats(stats);

      const ratio = perdus > 0 ? (detruits / perdus).toFixed(2) : detruits > 0 ? '∞' : '0';
      const embed = new EmbedBuilder()
        .setTitle(`📋 Rapport de combat — ${nom}`)
        .setColor(0xFFD700)
        .addFields(
          { name: '👤 Rapporteur', value: `**${nom}**`, inline: true },
          { name: '🎯 Tireur', value: `**${tireur}**`, inline: true },
          { name: '📍 Front', value: `**${front}**`, inline: true },
          { name: '🛡️ Char utilisé', value: `**${charUtilise}**`, inline: true },
          { name: '⚔️ Véhicules ennemis', value: `**${ennemis}**`, inline: true },
          { name: '👥 Équipage', value: `**${equipage}**`, inline: true },
          { name: '💥 Chars détruits', value: `**${detruits}**`, inline: true },
          { name: '💀 Chars perdus', value: `**${perdus}**`, inline: true },
          { name: '🚩 Chars capturés', value: `**${captures}**`, inline: true },
          { name: '⚖️ Ratio', value: `**${ratio}**`, inline: true },
          { name: '🔧 Réparations', value: `**${reparations}**`, inline: true },
          { name: '📅 Date', value: `**${date}**`, inline: true },
          { name: `📊 Total ${MOIS[stats.mois]}`, value: `**${stats.charsDetruitTotal}** détruits | **${stats.charsPerdusTotal}** perdus | **${stats.charsCapturesTotal}** capturés`, inline: false },
          { name: '🏆 Record du mois', value: `**${stats.recordRapport}** chars détruits en un rapport`, inline: false }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      // Envoyer aux admins en MP
      const admins = await getAdmins();
      for (const adminId of admins) {
        if (adminId !== userId) {
          try { const u = await client.users.fetch(adminId); await u.send({ embeds: [embed] }); } catch (e) {}
        }
      }
      if (WEBHOOK_URL) {
        await fetch(WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ embeds: [embed.toJSON()] })
        });
      }
    }

    else if (sub === 'supprimer') {
      if (!admin) return interaction.reply({ content: '❌ Vous n\'avez pas la permission !', ephemeral: true });
      await interaction.deferReply({ ephemeral: true });
      const id = parseInt(interaction.options.getString('id'));
      let stats = await getStats();
      const rapport = stats.rapports.find(r => r.id === id);
      if (!rapport) return interaction.editReply({ content: '❌ Rapport introuvable ! Utilise `/rapport liste` pour voir les IDs.' });
      stats.charsDetruitTotal -= rapport.detruits;
      stats.charsPerdusTotal -= rapport.perdus;
      stats.charsCapturesTotal = (stats.charsCapturesTotal || 0) - (rapport.captures || 0);
      stats.tireurs[rapport.tireur] = (stats.tireurs[rapport.tireur] || 0) - rapport.detruits;
      stats.rapports = stats.rapports.filter(r => r.id !== id);
      stats.recordRapport = stats.rapports.length > 0 ? Math.max(...stats.rapports.map(r => r.detruits)) : 0;
      await saveStats(stats);
      await interaction.editReply({ content: `✅ Rapport de **${rapport.nom}** (${rapport.detruits} détruits) supprimé !` });
      envoyerLog('🗑️ Rapport supprimé', `**${rapport.nom}** par **${interaction.user.username}**`, 0xf44336);
    }

    else if (sub === 'liste') {
      await interaction.deferReply({ ephemeral: true });
      const stats = await getStats();
      const rapports = stats.rapports || [];
      if (!rapports.length) return interaction.editReply({ content: '📋 Aucun rapport ce mois-ci.' });
      const chunks = [];
      let current = '';
      rapports.forEach((r, i) => {
        const line = `**${i + 1}.** ${r.nom} — 🎯 ${r.tireur} — 💥 ${r.detruits} — 💀 ${r.perdus} — 🚩 ${r.captures || 0} — 📅 ${r.date} — ID: \`${r.id}\`\n`;
        if (current.length + line.length > 3900) { chunks.push(current); current = ''; }
        current += line;
      });
      if (current) chunks.push(current);
      const embeds = chunks.map((desc, i) => new EmbedBuilder()
        .setTitle(i === 0 ? `📋 Rapports de ${MOIS[stats.mois]} ${stats.annee}` : `📋 Rapports (suite)`)
        .setColor(0xFFD700)
        .setDescription(desc)
        .setTimestamp()
      );
      await interaction.editReply({ embeds: embeds.slice(0, 10) });
    }

    else if (sub === 'reset') {
      if (!admin) return interaction.reply({ content: '❌ Vous n\'avez pas la permission !', ephemeral: true });
      await interaction.deferReply({ ephemeral: true });
      let stats = await getStats();
      await envoyerBilanMensuel(stats);
      Object.assign(stats, { charsDetruitTotal: 0, charsPerdusTotal: 0, charsCapturesTotal: 0, recordRapport: 0, tireurs: {}, rapports: [] });
      await saveStats(stats);
      await interaction.editReply({ content: '✅ Stats réinitialisées ! Le bilan a été envoyé aux admins.' });
      envoyerLog('🔁 Reset stats', `Par **${interaction.user.username}**`, 0xf44336);
    }
  }

  // ===== /mp =====
  else if (commandName === 'mp') {
    if (!admin) return interaction.reply({ content: '❌ Vous n\'avez pas la permission !', ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    const membre = interaction.options.getUser('membre');
    const message = interaction.options.getString('message');
    try {
      await membre.send({ embeds: [new EmbedBuilder()
        .setTitle('📩 Message')
        .setDescription(message)
        .setColor(0xFFD700)
        .setFooter({ text: `Envoyé par ${interaction.user.username}` })
        .setTimestamp()
      ]});
      await interaction.editReply({ content: `✅ Message envoyé à **${membre.username}** !` });
      envoyerLog('💬 MP envoyé', `Par **${interaction.user.username}** à **${membre.username}**`, 0xFFD700);
    } catch (e) {
      await interaction.editReply({ content: `❌ Impossible d'envoyer à ${membre.username} : DMs fermés ou bot non partagé.` });
    }
  }

  // ===== /message =====
  else if (commandName === 'message') {
    if (!admin) return interaction.reply({ content: '❌ Vous n\'avez pas la permission !', ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    const salon = interaction.options.getChannel('salon');
    const message = interaction.options.getString('message');
    try {
      await salon.send(message);
      await interaction.editReply({ content: `✅ Message envoyé dans **#${salon.name}** !` });
      envoyerLog('📢 Message salon', `Par **${interaction.user.username}** dans **#${salon.name}**`, 0xFFD700);
    } catch (e) {
      await interaction.editReply({ content: `❌ Erreur : ${e.message}` });
    }
  }

  // ===== /graphique =====
  else if (commandName === 'graphique') {
    await interaction.deferReply();
    const stats = await getStats();
    const graphique = genererGraphiqueTexte(stats);
    const ratio = stats.charsPerdusTotal > 0 ? (stats.charsDetruitTotal / stats.charsPerdusTotal).toFixed(2) : stats.charsDetruitTotal > 0 ? '∞' : '0';
    const embed = new EmbedBuilder()
      .setTitle(`📈 Graphique — ${MOIS[stats.mois]} ${stats.annee}`)
      .setColor(0xFFD700)
      .setDescription(graphique)
      .addFields(
        { name: '💥 Total détruits', value: `**${stats.charsDetruitTotal}**`, inline: true },
        { name: '💀 Total perdus', value: `**${stats.charsPerdusTotal}**`, inline: true },
        { name: '⚖️ Ratio', value: `**${ratio}**`, inline: true }
      )
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  }

  // ===== /compte =====
  else if (commandName === 'compte') {
    if (!admin) return interaction.reply({ content: '❌ Vous n\'avez pas la permission !', ephemeral: true });
    const sub = interaction.options.getSubcommand();
    let stats = await getStats();
    if (!stats.admins) stats.admins = [...USER_IDS];

    if (sub === 'ajouter') {
      const membre = interaction.options.getUser('membre');
      if (stats.admins.includes(membre.id)) return interaction.reply({ content: `⚠️ **${membre.username}** est déjà admin !`, ephemeral: true });
      stats.admins.push(membre.id);
      await saveStats(stats);
      await interaction.reply({ content: `✅ **${membre.username}** ajouté comme admin !`, ephemeral: true });
      envoyerLog('👤 Admin ajouté', `**${membre.username}** par **${interaction.user.username}**`, 0x4CAF50);
    }

    else if (sub === 'retirer') {
      const membre = interaction.options.getUser('membre');
      if (!stats.admins.includes(membre.id)) return interaction.reply({ content: `⚠️ **${membre.username}** n'est pas admin !`, ephemeral: true });
      stats.admins = stats.admins.filter(id => id !== membre.id);
      await saveStats(stats);
      await interaction.reply({ content: `✅ **${membre.username}** retiré des admins !`, ephemeral: true });
      envoyerLog('🗑️ Admin retiré', `**${membre.username}** par **${interaction.user.username}**`, 0xf44336);
    }

    else if (sub === 'liste') {
      const admins = stats.admins || [];
      const membres = await Promise.all(admins.map(async id => {
        try { const u = await client.users.fetch(id); return `• **${u.username}** (\`${id}\`)`; }
        catch (e) { return `• ID inconnu (\`${id}\`)`; }
      }));
      const embed = new EmbedBuilder()
        .setTitle('👥 Admins autorisés')
        .setColor(0xFFD700)
        .setDescription(membres.length ? membres.join('\n') : 'Aucun admin configuré')
        .setFooter({ text: 'Accès à : /restart /compte /mp /message /rapport supprimer & reset' })
        .setTimestamp();
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }

  // ===== /restart =====
  else if (commandName === 'restart') {
    if (!admin) return interaction.reply({ content: '❌ Vous n\'avez pas la permission !', ephemeral: true });
    await interaction.reply({ content: '🔄 Redémarrage en cours...', ephemeral: true });
    envoyerLog('🔄 Restart', `Par **${interaction.user.username}**`, 0xFF9800);
    setTimeout(() => process.exit(0), 1500);
  }
});

// ===== ROUTES (Google Forms) =====
const app = express();
app.use(express.json());

app.post('/candidature', async (req, res) => {
  const { fields, titre } = req.body;
  if (!fields?.length) return res.status(400).json({ error: 'Aucun champ' });
  const embed = new EmbedBuilder()
    .setTitle(titre || '📋 Candidature !')
    .setColor(0xFFD700)
    .setTimestamp()
    .addFields(fields.map(f => ({ name: f.name, value: String(f.value) })));
  const admins = await getAdmins();
  for (const userId of admins) {
    try { const u = await client.users.fetch(userId); await u.send({ embeds: [embed] }); } catch (e) {}
  }
  res.json({ success: true });
});

app.post('/rapport', async (req, res) => {
  const { nom, tireur, charsDetruit, charsPerdus, front, date, charUtilise, vehiculesConfront, autresPersonnes, charsCaptures, reparations } = req.body;
  let stats = await getStats();
  stats = await verifierReinitialisationMois(stats);
  const detruits = parseInt(charsDetruit) || 0;
  const perdus = parseInt(charsPerdus) || 0;
  const captures = parseInt(charsCaptures) || 0;
  stats.charsDetruitTotal += detruits; stats.charsPerdusTotal += perdus;
  stats.charsCapturesTotal = (stats.charsCapturesTotal || 0) + captures;
  if (detruits > stats.recordRapport) stats.recordRapport = detruits;
  stats.tireurs[tireur] = (stats.tireurs[tireur] || 0) + detruits;
  stats.rapports.push({ id: Date.now(), nom, tireur, detruits, perdus, captures, date });
  await saveStats(stats);
  const ratio = perdus > 0 ? (detruits / perdus).toFixed(2) : detruits > 0 ? '∞' : '0';
  const embed = new EmbedBuilder()
    .setTitle(`📋 Rapport — ${nom}`)
    .setColor(0xFFD700)
    .setTimestamp()
    .addFields(
      { name: '👤 Rapporteur', value: `**${nom}**`, inline: true },
      { name: '🎯 Tireur', value: `**${tireur}**`, inline: true },
      { name: '📍 Front', value: `**${front}**`, inline: true },
      { name: '🛡️ Char', value: `**${charUtilise || 'N/A'}**`, inline: true },
      { name: '⚔️ Ennemis', value: `**${vehiculesConfront || 'N/A'}**`, inline: true },
      { name: '👥 Équipage', value: `**${autresPersonnes || 'Solo'}**`, inline: true },
      { name: '💥 Détruits', value: `**${detruits}**`, inline: true },
      { name: '💀 Perdus', value: `**${perdus}**`, inline: true },
      { name: '🚩 Capturés', value: `**${captures}**`, inline: true },
      { name: '⚖️ Ratio', value: `**${ratio}**`, inline: true },
      { name: '🔧 Réparations', value: `**${reparations || 0}**`, inline: true },
      { name: '📅 Date', value: `**${date}**`, inline: true },
      { name: `📊 Total ${MOIS[stats.mois]}`, value: `**${stats.charsDetruitTotal}** détruits | **${stats.charsPerdusTotal}** perdus | **${stats.charsCapturesTotal}** capturés`, inline: false },
      { name: '🏆 Record', value: `**${stats.recordRapport}** chars détruits`, inline: true }
    );
  const admins = await getAdmins();
  for (const userId of admins) {
    try { const u = await client.users.fetch(userId.trim()); await u.send({ embeds: [embed] }); } catch (e) {}
  }
  res.json({ success: true });
});

// ===== DÉMARRAGE =====
const PORT = process.env.PORT || 3000;

client.once('ready', () => {
  console.log(`Bot connecté : ${client.user.tag}`);
  envoyerLog('🟢 Bot démarré', `**${client.user.tag}** en ligne !`, 0x4CAF50);
  enregistrerCommandes();
});

connectMongo().then(() => {
  client.login(BOT_TOKEN).then(() => {
    app.listen(PORT, () => console.log('Serveur démarré sur port ' + PORT));
  });
});
