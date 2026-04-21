const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
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
    mois: new Date().getMonth(), annee: new Date().getFullYear(),
    charsDetruitTotal: 0, charsPerdusTotal: 0, charsCapturesTotal: 0,
    recordRapport: 0, tireurs: {}, rapports: [],
    admins: [...USER_IDS],
    sosup_ids: [...USER_IDS],
    so_ids: [...USER_IDS]
  });
}

async function getStats() { return db.collection('stats').findOne({ _id: 'current' }); }
async function saveStats(stats) { await db.collection('stats').replaceOne({ _id: 'current' }, stats, { upsert: true }); }
async function getAdmins() { const s = await getStats(); return (s && s.admins && s.admins.length) ? s.admins : USER_IDS; }
async function isAdmin(userId) { const a = await getAdmins(); return a.includes(userId); }

// ===== LOGS =====
async function envoyerLog(titre, description, couleur = 0xFFD700) {
  if (!WEBHOOK_URL) return;
  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [{ title: titre, description, color: couleur, timestamp: new Date().toISOString() }] })
    });
  } catch (e) { console.error('Log error:', e.message); }
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
  if (WEBHOOK_URL) await fetch(WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds: [embed.toJSON()] }) });
}

async function verifierMois(stats) {
  const now = new Date();
  if (stats.mois !== now.getMonth() || stats.annee !== now.getFullYear()) {
    await envoyerBilanMensuel(stats);
    Object.assign(stats, { mois: now.getMonth(), annee: now.getFullYear(), charsDetruitTotal: 0, charsPerdusTotal: 0, charsCapturesTotal: 0, recordRapport: 0, tireurs: {}, rapports: [] });
    await saveStats(stats);
  }
  return stats;
}

// ===== HELPER — embed rapport =====
function buildRapportEmbed(r, stats) {
  const ratio = r.perdus > 0 ? (r.detruits / r.perdus).toFixed(2) : r.detruits > 0 ? '∞' : '0';
  const embed = new EmbedBuilder()
    .setTitle(`📋 Rapport de combat — ${r.nom}`)
    .setColor(0xFFD700)
    .addFields(
      { name: '👤 Rapporteur', value: `**${r.nom}**`, inline: true },
      { name: '🎯 Tireur', value: `**${r.tireur}**`, inline: true },
      { name: '📍 Front', value: `**${r.front || 'N/A'}**`, inline: true },
      { name: '🛡️ Char utilisé', value: `**${r.char || 'N/A'}**`, inline: true },
      { name: '⚔️ Véhicules ennemis', value: `**${r.ennemis || 'N/A'}**`, inline: true },
      { name: '👥 Équipage', value: `**${r.equipage || 'Solo'}**`, inline: true },
      { name: '💥 Chars détruits', value: `**${r.detruits}**`, inline: true },
      { name: '💀 Chars perdus', value: `**${r.perdus}**`, inline: true },
      { name: '🚩 Chars capturés', value: `**${r.captures || 0}**`, inline: true },
      { name: '⚖️ Ratio', value: `**${ratio}**`, inline: true },
      { name: '🔧 Réparations', value: `**${r.reparations || 0}**`, inline: true },
      { name: '📅 Date', value: `**${r.date}**`, inline: true }
    )
    .setTimestamp();
  if (stats) {
    embed.addFields(
      { name: `📊 Total ${MOIS[stats.mois]}`, value: `**${stats.charsDetruitTotal}** détruits | **${stats.charsPerdusTotal}** perdus | **${stats.charsCapturesTotal || 0}** capturés`, inline: false },
      { name: '🏆 Record du mois', value: `**${stats.recordRapport}** chars détruits en un rapport`, inline: false }
    );
  }
  return embed;
}

// ===== COMMANDES =====
const commands = [
  new SlashCommandBuilder().setName('stats').setDescription('Voir les statistiques du mois'),

  new SlashCommandBuilder().setName('rapport').setDescription('Ajouter un rapport de combat')
    .addStringOption(o => o.setName('nom').setDescription('Ton nom').setRequired(true))
    .addStringOption(o => o.setName('tireur').setDescription('Nom du tireur').setRequired(true))
    .addIntegerOption(o => o.setName('detruits').setDescription('Chars détruits').setRequired(true))
    .addIntegerOption(o => o.setName('perdus').setDescription('Chars perdus').setRequired(true))
    .addStringOption(o => o.setName('front').setDescription('Front').setRequired(true))
    .addStringOption(o => o.setName('date').setDescription('Date (ex: 15/04)').setRequired(true))
    .addIntegerOption(o => o.setName('captures').setDescription('Chars capturés').setRequired(false))
    .addStringOption(o => o.setName('char').setDescription('Char utilisé').setRequired(false))
    .addStringOption(o => o.setName('ennemis').setDescription('Véhicules confrontés').setRequired(false))
    .addStringOption(o => o.setName('equipage').setDescription('Autres membres dans le char').setRequired(false))
    .addIntegerOption(o => o.setName('reparations').setDescription('Nombre de réparations').setRequired(false)),

  new SlashCommandBuilder().setName('rapportmanage').setDescription('Gérer les rapports (admin)')
    .addSubcommand(sub => sub.setName('liste').setDescription('Voir et gérer les rapports via menu déroulant'))
    .addSubcommand(sub => sub.setName('reset').setDescription('Réinitialiser les stats du mois')),

  new SlashCommandBuilder().setName('mp').setDescription('Envoyer un MP à un membre (admin)')
    .addUserOption(o => o.setName('membre').setDescription('Membre à contacter').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Message').setRequired(true)),

  new SlashCommandBuilder().setName('message').setDescription('Envoyer dans un salon (admin)')
    .addChannelOption(o => o.setName('salon').setDescription('Salon cible').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Message').setRequired(true)),

  new SlashCommandBuilder().setName('compte').setDescription('Gérer les admins et IDs des formulaires')
    .addSubcommand(sub => sub.setName('liste').setDescription('Voir tous les accès configurés'))
    .addSubcommand(sub => sub.setName('ajouter').setDescription('Ajouter un admin')
      .addUserOption(o => o.setName('membre').setDescription('Membre à ajouter').setRequired(true)))
    .addSubcommand(sub => sub.setName('retirer').setDescription('Retirer un admin')
      .addUserOption(o => o.setName('membre').setDescription('Membre à retirer').setRequired(true)))
    .addSubcommand(sub => sub.setName('sosup').setDescription('Définir qui reçoit le formulaire Rapport SO SUP en MP')
      .addStringOption(o => o.setName('ids').setDescription('IDs Discord séparés par virgule').setRequired(true)))
    .addSubcommand(sub => sub.setName('so').setDescription('Définir qui reçoit le formulaire Rapport SO en MP')
      .addStringOption(o => o.setName('ids').setDescription('IDs Discord séparés par virgule').setRequired(true))),

  new SlashCommandBuilder().setName('restart').setDescription('Redémarrer le bot (admin)'),

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
  const userId = interaction.user.id;
  const admin = await isAdmin(userId);

  // ===== SLASH COMMANDS =====
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    // /stats
    if (commandName === 'stats') {
      await interaction.deferReply();
      let stats = await getStats();
      stats = await verifierMois(stats);
      const ratio = stats.charsPerdusTotal > 0 ? (stats.charsDetruitTotal / stats.charsPerdusTotal).toFixed(2) : stats.charsDetruitTotal > 0 ? '∞' : '0';
      const tireurs = Object.entries(stats.tireurs || {}).sort((a, b) => b[1] - a[1]);
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

    // /rapport
    else if (commandName === 'rapport') {
      await interaction.deferReply();
      let stats = await getStats();
      stats = await verifierMois(stats);
      const nom = interaction.options.getString('nom');
      const tireur = interaction.options.getString('tireur');
      const detruits = interaction.options.getInteger('detruits') || 0;
      const perdus = interaction.options.getInteger('perdus') || 0;
      const front = interaction.options.getString('front');
      const date = interaction.options.getString('date');
      const captures = interaction.options.getInteger('captures') || 0;
      const char = interaction.options.getString('char') || 'N/A';
      const ennemis = interaction.options.getString('ennemis') || 'N/A';
      const equipage = interaction.options.getString('equipage') || 'Solo';
      const reparations = interaction.options.getInteger('reparations') || 0;

      stats.charsDetruitTotal += detruits;
      stats.charsPerdusTotal += perdus;
      stats.charsCapturesTotal = (stats.charsCapturesTotal || 0) + captures;
      if (detruits > stats.recordRapport) stats.recordRapport = detruits;
      stats.tireurs[tireur] = (stats.tireurs[tireur] || 0) + detruits;
      const rapportObj = { id: Date.now(), nom, tireur, detruits, perdus, captures, date, front, char, ennemis, equipage, reparations };
      stats.rapports.push(rapportObj);
      await saveStats(stats);

      const embed = buildRapportEmbed(rapportObj, stats);
      await interaction.editReply({ embeds: [embed] });

      const admins = await getAdmins();
      for (const adminId of admins) {
        if (adminId !== userId) { try { const u = await client.users.fetch(adminId); await u.send({ embeds: [embed] }); } catch (e) {} }
      }
      if (WEBHOOK_URL) await fetch(WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds: [embed.toJSON()] }) });
    }

    // /rapportmanage
    else if (commandName === 'rapportmanage') {
      if (!admin) return interaction.reply({ content: '❌ Vous n\'avez pas la permission !', ephemeral: true });
      const sub = interaction.options.getSubcommand();

      if (sub === 'liste') {
        await interaction.deferReply({ ephemeral: true });
        const stats = await getStats();
        const rapports = stats.rapports || [];
        if (!rapports.length) return interaction.editReply({ content: '📋 Aucun rapport ce mois-ci.' });

        const options = rapports.slice(-25).reverse().map(r => ({
          label: `${r.nom} — ${r.detruits}💥 ${r.perdus}💀 — ${r.date}`.slice(0, 100),
          description: `Tireur: ${r.tireur} | Captures: ${r.captures || 0}`.slice(0, 100),
          value: String(r.id)
        }));

        const selectMenu = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('rapportmanage_select')
            .setPlaceholder('Sélectionne un rapport à gérer...')
            .addOptions(options)
        );

        const embed = new EmbedBuilder()
          .setTitle(`📋 Gestion des rapports — ${MOIS[stats.mois]} ${stats.annee}`)
          .setColor(0xFFD700)
          .setDescription(`**${rapports.length}** rapport(s) ce mois.\nSélectionne un rapport dans le menu pour le voir ou le supprimer.`)
          .addFields(
            { name: '💥 Total détruits', value: `**${stats.charsDetruitTotal}**`, inline: true },
            { name: '💀 Total perdus', value: `**${stats.charsPerdusTotal}**`, inline: true },
            { name: '🚩 Total capturés', value: `**${stats.charsCapturesTotal || 0}**`, inline: true }
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [embed], components: [selectMenu] });
      }

      else if (sub === 'reset') {
        await interaction.deferReply({ ephemeral: true });
        let stats = await getStats();
        await envoyerBilanMensuel(stats);
        Object.assign(stats, { charsDetruitTotal: 0, charsPerdusTotal: 0, charsCapturesTotal: 0, recordRapport: 0, tireurs: {}, rapports: [] });
        await saveStats(stats);
        await interaction.editReply({ content: '✅ Stats réinitialisées ! Le bilan a été envoyé aux admins.' });
        envoyerLog('🔁 Reset stats', `Par **${interaction.user.username}**`, 0xf44336);
      }
    }

    // /mp
    else if (commandName === 'mp') {
      if (!admin) return interaction.reply({ content: '❌ Vous n\'avez pas la permission !', ephemeral: true });
      await interaction.deferReply({ ephemeral: true });
      const membre = interaction.options.getUser('membre');
      const message = interaction.options.getString('message');
      try {
        await membre.send({ embeds: [new EmbedBuilder().setTitle('📩 Message').setDescription(message).setColor(0xFFD700).setFooter({ text: `Envoyé par ${interaction.user.username}` }).setTimestamp()] });
        await interaction.editReply({ content: `✅ Message envoyé à **${membre.username}** !` });
        envoyerLog('💬 MP envoyé', `Par **${interaction.user.username}** à **${membre.username}**`, 0xFFD700);
      } catch (e) {
        await interaction.editReply({ content: `❌ Impossible d'envoyer à ${membre.username} (DMs fermés).` });
      }
    }

    // /message
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

    // /compte
    else if (commandName === 'compte') {
      if (!admin) return interaction.reply({ content: '❌ Vous n\'avez pas la permission !', ephemeral: true });
      const sub = interaction.options.getSubcommand();
      let stats = await getStats();
      if (!stats.admins) stats.admins = [...USER_IDS];
      if (!stats.sosup_ids) stats.sosup_ids = [...USER_IDS];
      if (!stats.so_ids) stats.so_ids = [...USER_IDS];

      const fetchNames = async (ids) => {
        return Promise.all((ids || []).map(async id => {
          try { const u = await client.users.fetch(id); return `• **${u.username}** (\`${id}\`)`; }
          catch (e) { return `• ID inconnu (\`${id}\`)`; }
        }));
      };

      if (sub === 'liste') {
        const [adminNames, sosupNames, soNames] = await Promise.all([
          fetchNames(stats.admins),
          fetchNames(stats.sosup_ids),
          fetchNames(stats.so_ids)
        ]);
        const embed = new EmbedBuilder()
          .setTitle('👥 Configuration des accès')
          .setColor(0xFFD700)
          .addFields(
            { name: '🔑 Admins — toutes les commandes admin', value: adminNames.join('\n') || 'Aucun', inline: false },
            { name: '📋 Rapport SO SUP — reçoivent le formulaire en MP', value: sosupNames.join('\n') || 'Aucun', inline: false },
            { name: '📋 Rapport SO — reçoivent le formulaire en MP', value: soNames.join('\n') || 'Aucun', inline: false }
          )
          .setTimestamp();
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      else if (sub === 'ajouter') {
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

      else if (sub === 'sosup') {
        const ids = interaction.options.getString('ids').split(',').map(id => id.trim()).filter(id => id.length > 0);
        stats.sosup_ids = ids;
        await saveStats(stats);
        const names = await fetchNames(ids);
        const embed = new EmbedBuilder()
          .setTitle('✅ IDs Rapport SO SUP mis à jour')
          .setColor(0x9B59B6)
          .setDescription('Ces membres recevront le formulaire **Rapport SO SUP** en MP :')
          .addFields({ name: '👥 Membres configurés', value: names.join('\n') || 'Aucun' })
          .setTimestamp();
        await interaction.reply({ embeds: [embed], ephemeral: true });
      }

      else if (sub === 'so') {
        const ids = interaction.options.getString('ids').split(',').map(id => id.trim()).filter(id => id.length > 0);
        stats.so_ids = ids;
        await saveStats(stats);
        const names = await fetchNames(ids);
        const embed = new EmbedBuilder()
          .setTitle('✅ IDs Rapport SO mis à jour')
          .setColor(0x3498DB)
          .setDescription('Ces membres recevront le formulaire **Rapport SO** en MP :')
          .addFields({ name: '👥 Membres configurés', value: names.join('\n') || 'Aucun' })
          .setTimestamp();
        await interaction.reply({ embeds: [embed], ephemeral: true });
      }
    }

    // /restart
    else if (commandName === 'restart') {
      if (!admin) return interaction.reply({ content: '❌ Vous n\'avez pas la permission !', ephemeral: true });
      await interaction.reply({ content: '🔄 Redémarrage en cours...', ephemeral: true });
      envoyerLog('🔄 Restart', `Par **${interaction.user.username}**`, 0xFF9800);
      setTimeout(() => process.exit(0), 1500);
    }
  }

  // ===== SELECT MENU =====
  else if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'rapportmanage_select') {
      if (!await isAdmin(interaction.user.id)) return interaction.reply({ content: '❌ Non autorisé !', ephemeral: true });
      const rapportId = parseInt(interaction.values[0]);
      const stats = await getStats();
      const rapport = stats.rapports.find(r => r.id === rapportId);
      if (!rapport) return interaction.reply({ content: '❌ Rapport introuvable !', ephemeral: true });

      const embed = buildRapportEmbed(rapport, null);
      embed.setFooter({ text: `ID: ${rapport.id}` });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`rapport_del_${rapport.id}`).setLabel('🗑️ Supprimer').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('rapport_cancel').setLabel('❌ Annuler').setStyle(ButtonStyle.Secondary)
      );

      await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }
  }

  // ===== BOUTONS =====
  else if (interaction.isButton()) {
    if (!await isAdmin(interaction.user.id)) return interaction.reply({ content: '❌ Non autorisé !', ephemeral: true });

    if (interaction.customId.startsWith('rapport_del_')) {
      const rapportId = parseInt(interaction.customId.replace('rapport_del_', ''));
      let stats = await getStats();
      const rapport = stats.rapports.find(r => r.id === rapportId);
      if (!rapport) return interaction.update({ content: '❌ Rapport introuvable !', embeds: [], components: [] });

      stats.charsDetruitTotal = Math.max(0, stats.charsDetruitTotal - rapport.detruits);
      stats.charsPerdusTotal = Math.max(0, stats.charsPerdusTotal - rapport.perdus);
      stats.charsCapturesTotal = Math.max(0, (stats.charsCapturesTotal || 0) - (rapport.captures || 0));
      stats.tireurs[rapport.tireur] = Math.max(0, (stats.tireurs[rapport.tireur] || 0) - rapport.detruits);
      stats.rapports = stats.rapports.filter(r => r.id !== rapportId);
      stats.recordRapport = stats.rapports.length > 0 ? Math.max(...stats.rapports.map(r => r.detruits)) : 0;
      await saveStats(stats);

      await interaction.update({
        content: `✅ Rapport de **${rapport.nom}** supprimé ! (${rapport.detruits}💥 ${rapport.perdus}💀 recalculés)`,
        embeds: [], components: []
      });
      envoyerLog('🗑️ Rapport supprimé', `**${rapport.nom}** par **${interaction.user.username}**`, 0xf44336);
    }

    else if (interaction.customId === 'rapport_cancel') {
      await interaction.update({ content: '❌ Annulé.', embeds: [], components: [] });
    }
  }
});

// ===== EXPRESS =====
const app = express();
app.use(express.json());

// Route candidature (Google Forms)
app.post('/candidature', async (req, res) => {
  const { fields, titre } = req.body;
  if (!fields?.length) return res.status(400).json({ error: 'Aucun champ' });
  const embed = new EmbedBuilder().setTitle(titre || '📋 Candidature !').setColor(0xFFD700).setTimestamp().addFields(fields.map(f => ({ name: f.name, value: String(f.value) })));
  const admins = await getAdmins();
  for (const userId of admins) { try { const u = await client.users.fetch(userId); await u.send({ embeds: [embed] }); } catch (e) {} }
  res.json({ success: true });
});

// Route rapport combat (Google Forms)
app.post('/rapport', async (req, res) => {
  const { nom, tireur, charsDetruit, charsPerdus, front, date, charUtilise, vehiculesConfront, autresPersonnes, charsCaptures, reparations } = req.body;
  let stats = await getStats();
  stats = await verifierMois(stats);
  const detruits = parseInt(charsDetruit) || 0, perdus = parseInt(charsPerdus) || 0, captures = parseInt(charsCaptures) || 0;
  stats.charsDetruitTotal += detruits; stats.charsPerdusTotal += perdus;
  stats.charsCapturesTotal = (stats.charsCapturesTotal || 0) + captures;
  if (detruits > stats.recordRapport) stats.recordRapport = detruits;
  stats.tireurs[tireur] = (stats.tireurs[tireur] || 0) + detruits;
  const rapportObj = { id: Date.now(), nom, tireur, detruits, perdus, captures, date, front, char: charUtilise || 'N/A', ennemis: vehiculesConfront || 'N/A', equipage: autresPersonnes || 'Solo', reparations: reparations || 0 };
  stats.rapports.push(rapportObj);
  await saveStats(stats);
  const embed = buildRapportEmbed(rapportObj, stats);
  const admins = await getAdmins();
  for (const userId of admins) { try { const u = await client.users.fetch(userId.trim()); await u.send({ embeds: [embed] }); } catch (e) {} }
  res.json({ success: true });
});

// ===== RAPPORT SO SUP (Formulaire 1 — https://forms.gle/cCrnXomgrggCZTsb6) =====
app.post('/rapport-sosup', async (req, res) => {
  const { nom, avis, ameliorer, note } = req.body;
  if (!nom) return res.status(400).json({ error: 'Données manquantes' });
  const embed = new EmbedBuilder()
    .setTitle('📋 Rapport SO SUP')
    .setColor(0x9B59B6)
    .addFields(
      { name: '👤 Nom — Prénom', value: `**${nom}**`, inline: true },
      { name: '⭐ Note', value: `**${note || 'N/A'}/10**`, inline: true },
      { name: '💬 Avis sur la personne', value: avis || 'N/A', inline: false },
      { name: '🔧 Choses à améliorer', value: ameliorer || 'N/A', inline: false }
    )
    .setTimestamp();
  const stats = await getStats();
  const ids = (stats.sosup_ids && stats.sosup_ids.length) ? stats.sosup_ids : USER_IDS;
  for (const userId of ids) {
    try { const u = await client.users.fetch(userId.trim()); await u.send({ embeds: [embed] }); } catch (e) {}
  }
  if (WEBHOOK_URL) await fetch(WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds: [embed.toJSON()] }) });
  envoyerLog('📋 Rapport SO SUP reçu', `**${nom}** — Note: ${note}/10`, 0x9B59B6);
  res.json({ success: true });
});

// ===== RAPPORT SO (Formulaire 2 — https://forms.gle/qxi7HLQHDpDq63uT9) =====
app.post('/rapport-so', async (req, res) => {
  const { nom, avis, ameliorer, note } = req.body;
  if (!nom) return res.status(400).json({ error: 'Données manquantes' });
  const embed = new EmbedBuilder()
    .setTitle('📋 Rapport SO')
    .setColor(0x3498DB)
    .addFields(
      { name: '👤 Nom — Prénom', value: `**${nom}**`, inline: true },
      { name: '⭐ Note', value: `**${note || 'N/A'}/10**`, inline: true },
      { name: '💬 Avis sur la personne', value: avis || 'N/A', inline: false },
      { name: '🔧 Choses à améliorer', value: ameliorer || 'N/A', inline: false }
    )
    .setTimestamp();
  const stats = await getStats();
  const ids = (stats.so_ids && stats.so_ids.length) ? stats.so_ids : USER_IDS;
  for (const userId of ids) {
    try { const u = await client.users.fetch(userId.trim()); await u.send({ embeds: [embed] }); } catch (e) {}
  }
  if (WEBHOOK_URL) await fetch(WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ embeds: [embed.toJSON()] }) });
  envoyerLog('📋 Rapport SO reçu', `**${nom}** — Note: ${note}/10`, 0x3498DB);
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
