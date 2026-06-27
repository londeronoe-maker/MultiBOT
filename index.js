const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { MongoClient } = require('mongodb');
const express = require('express');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent]
});

const BOT_TOKEN = process.env.BOT_TOKEN;
const USER_IDS = process.env.USER_IDS ? process.env.USER_IDS.split(',').map(id => id.trim()) : [];
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const CLIENT_ID = "1485359905639764070";
const GUILD_ID = "1479289389476610149";
const MONGODB_URL = process.env.MONGODB_URL;

// ===== STEAM WORKSHOP =====
const STEAM_API_KEY = process.env.STEAM_API_KEY;
const STEAM_ADDON_ID = process.env.STEAM_ADDON_ID || '3750430777';
const STEAM_CHANNEL_ID = process.env.STEAM_CHANNEL_ID || '1520336068602232862';

// ===== LOGS SITE BLACK WOLVES =====
const LOG_SECRET = process.env.LOG_SECRET || "K1nv]8R63c£3";
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || "1513861797965201518";

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

// ===== HELPER — embed stats =====
function buildStatsEmbed(stats) {
  const ratio = stats.charsPerdusTotal > 0 ? (stats.charsDetruitTotal / stats.charsPerdusTotal).toFixed(2) : stats.charsDetruitTotal > 0 ? '∞' : '0';
  const tireurs = Object.entries(stats.tireurs || {}).sort((a, b) => b[1] - a[1]);
  const top3 = tireurs.slice(0, 3).map((t, i) => `${['🥇','🥈','🥉'][i]} **${t[0]}** — ${t[1]} chars`).join('\n') || 'Aucun';
  return new EmbedBuilder()
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
}

// ===== HELPER — graphique ASCII =====
function graphiqueTexte(stats) {
  const rapports = stats.rapports || [];
  const parJour = {};
  rapports.forEach(r => {
    const d = r.date || '?';
    if (!parJour[d]) parJour[d] = { d: 0, p: 0, c: 0 };
    parJour[d].d += r.detruits || 0; parJour[d].p += r.perdus || 0; parJour[d].c += r.captures || 0;
  });
  const jours = Object.keys(parJour).sort();
  if (!jours.length) return '```\nAucun rapport ce mois-ci\n```';
  const maxVal = Math.max(...jours.map(j => Math.max(parJour[j].d, parJour[j].p, parJour[j].c)), 1);
  const H = 8;
  let lignes = [];
  for (let h = H; h >= 1; h--) {
    const seuil = Math.round((h / H) * maxVal);
    let ligne = String(seuil).padStart(3) + ' |';
    jours.forEach(j => {
      ligne += ' ' + (parJour[j].d >= seuil ? 'D' : ' ') + (parJour[j].p >= seuil ? 'P' : ' ') + (parJour[j].c >= seuil ? 'C' : ' ');
    });
    lignes.push(ligne);
  }
  lignes.push('    +' + jours.map(() => '----').join(''));
  lignes.push('     ' + jours.map(j => j.slice(0, 4)).join(' '));
  lignes.push('D=Détruits  P=Perdus  C=Capturés');
  return '```\n' + lignes.join('\n') + '\n```';
}

function buildGraphiqueEmbed(stats) {
  const ratio = stats.charsPerdusTotal > 0 ? (stats.charsDetruitTotal / stats.charsPerdusTotal).toFixed(2) : stats.charsDetruitTotal > 0 ? '∞' : '0';
  return new EmbedBuilder()
    .setTitle(`📈 Graphique — ${MOIS[stats.mois]} ${stats.annee}`)
    .setColor(0xFFD700)
    .setDescription(graphiqueTexte(stats))
    .addFields(
      { name: '💥 Total détruits', value: `**${stats.charsDetruitTotal}**`, inline: true },
      { name: '💀 Total perdus', value: `**${stats.charsPerdusTotal}**`, inline: true },
      { name: '⚖️ Ratio', value: `**${ratio}**`, inline: true }
    )
    .setTimestamp();
}

// ===== HELPER — liste des rapports =====
function buildListeEmbed(stats) {
  const rapports = stats.rapports || [];
  const embed = new EmbedBuilder()
    .setTitle(`📋 Rapports de ${MOIS[stats.mois]} ${stats.annee}`)
    .setColor(0xFFD700)
    .setTimestamp();
  if (!rapports.length) {
    embed.setDescription('Aucun rapport ce mois-ci.');
    return embed;
  }
  const lignes = rapports.slice(-20).reverse().map((r, i) =>
    `**${i + 1}.** ${r.nom} — 🎯 ${r.tireur} — 💥 ${r.detruits} — 💀 ${r.perdus} — 🚩 ${r.captures || 0} — 📅 ${r.date}`
  );
  embed.setDescription(lignes.join('\n').slice(0, 4000));
  return embed;
}

// ===== HELPER — menu déroulant MP =====
function buildMenuMP() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('menu_mp')
      .setPlaceholder('📂 Choisis une action...')
      .addOptions(
        { label: 'Stats du mois', description: 'Voir les statistiques du mois', value: 'stats', emoji: '📊' },
        { label: 'Graphique', description: 'Voir le graphique du mois', value: 'graphique', emoji: '📈' },
        { label: 'Liste des rapports', description: 'Voir tous les rapports du mois', value: 'liste', emoji: '📋' },
        { label: 'Stats individuelles', description: 'Voir les stats d\'une personne', value: 'individuel', emoji: '👤' }
      )
  );
}

// ===== HELPER — extraire les membres de l'équipage =====
function membresEquipage(r) {
  if (!r.equipage || r.equipage === 'Solo' || r.equipage === 'N/A') return [];
  return r.equipage.split(',').map(n => n.trim()).filter(n => n.length > 0);
}

// ===== HELPER — toutes les personnes (tireurs + équipages) =====
function toutesLesPersonnes(stats) {
  const noms = new Set();
  (stats.rapports || []).forEach(r => {
    if (r.tireur) noms.add(r.tireur);
    membresEquipage(r).forEach(n => noms.add(n));
  });
  return [...noms];
}

// ===== HELPER — agréger les stats d'une personne (tireur OU équipage) =====
function getStatsTireur(stats, personne) {
  // On compte un rapport si la personne est le tireur OU dans l'équipage
  const raps = (stats.rapports || []).filter(r =>
    r.tireur === personne || membresEquipage(r).includes(personne)
  );
  let detruits = 0, perdus = 0, captures = 0;
  const chars = {};
  let commeTireur = 0, commeEquipage = 0;
  raps.forEach(r => {
    detruits += r.detruits || 0;
    perdus += r.perdus || 0;
    captures += r.captures || 0;
    const c = r.char && r.char !== 'N/A' ? r.char : null;
    if (c) chars[c] = (chars[c] || 0) + 1;
    if (r.tireur === personne) commeTireur++; else commeEquipage++;
  });
  const charsList = Object.entries(chars).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} (${n}x)`).join(', ') || 'Aucun';
  const ratio = perdus > 0 ? (detruits / perdus).toFixed(2) : detruits > 0 ? '∞' : '0';
  return { tireur: personne, detruits, perdus, captures, charsList, ratio, nbRapports: raps.length, commeTireur, commeEquipage };
}

// ===== HELPER — embed stats individuelles =====
function buildStatsIndividuelEmbed(stats, personne) {
  const s = getStatsTireur(stats, personne);
  return new EmbedBuilder()
    .setTitle(`👤 Stats de ${s.tireur} — ${MOIS[stats.mois]} ${stats.annee}`)
    .setColor(0xFFD700)
    .addFields(
      { name: '💥 Chars détruits', value: `**${s.detruits}**`, inline: true },
      { name: '💀 Chars perdus', value: `**${s.perdus}**`, inline: true },
      { name: '🚩 Chars capturés', value: `**${s.captures}**`, inline: true },
      { name: '⚖️ Ratio', value: `**${s.ratio}**`, inline: true },
      { name: '📋 Rapports', value: `**${s.nbRapports}** (🎯 ${s.commeTireur} tireur · 👥 ${s.commeEquipage} équipage)`, inline: true },
      { name: '🛡️ Chars utilisés', value: s.charsList, inline: false }
    )
    .setTimestamp();
}

// ===== HELPER — menu de sélection d'une personne =====
function buildMenuTireurs(stats) {
  const personnes = toutesLesPersonnes(stats);
  if (!personnes.length) return null;
  const options = personnes.slice(0, 25).map(t => ({
    label: t.slice(0, 100),
    description: `Voir les stats de ${t}`.slice(0, 100),
    value: t.slice(0, 100),
    emoji: '👤'
  }));
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('menu_tireur')
      .setPlaceholder('👤 Choisis une personne...')
      .addOptions(options)
  );
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

  new SlashCommandBuilder().setName('statsindiv').setDescription('Voir les stats individuelles d\'une personne'),

].map(c => c.toJSON());

async function enregistrerCommandes() {
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('Commandes globales enregistrées !');
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

    // /statsindiv
    else if (commandName === 'statsindiv') {
      let stats = await getStats();
      stats = await verifierMois(stats);
      const menuTireurs = buildMenuTireurs(stats);
      if (!menuTireurs) return interaction.reply({ content: '📋 Aucun rapport ce mois-ci, donc aucune personne à afficher.', ephemeral: true });
      await interaction.reply({ content: '👤 De qui veux-tu voir les stats ?', components: [menuTireurs] });
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
  }

  // ===== SELECT MENU =====
  else if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'menu_mp') {
      const choix = interaction.values[0];
      let stats = await getStats();
      stats = await verifierMois(stats);

      // Stats individuelles : afficher le menu de sélection du tireur
      if (choix === 'individuel') {
        const menuTireurs = buildMenuTireurs(stats);
        if (!menuTireurs) return interaction.reply({ content: '📋 Aucun rapport ce mois-ci, donc aucune personne à afficher.', ephemeral: true });
        return interaction.reply({ content: '👤 De qui veux-tu voir les stats ?', components: [menuTireurs], ephemeral: false });
      }

      await interaction.deferReply();
      let embed;
      if (choix === 'stats') embed = buildStatsEmbed(stats);
      else if (choix === 'graphique') embed = buildGraphiqueEmbed(stats);
      else if (choix === 'liste') embed = buildListeEmbed(stats);
      await interaction.editReply({ embeds: [embed] });
      // Réaffiche le menu pour enchaîner
      try { await interaction.followUp({ content: 'Autre chose ?', components: [buildMenuMP()] }); } catch (e) {}
    }

    else if (interaction.customId === 'menu_tireur') {
      await interaction.deferReply();
      let stats = await getStats();
      stats = await verifierMois(stats);
      const tireur = interaction.values[0];
      const embed = buildStatsIndividuelEmbed(stats, tireur);
      await interaction.editReply({ embeds: [embed] });
      try { await interaction.followUp({ content: 'Autre chose ?', components: [buildMenuMP()] }); } catch (e) {}
    }

    else if (interaction.customId === 'rapportmanage_select') {
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

// ===== MESSAGE EN MP — affiche le menu déroulant =====
const menuCooldowns = new Map(); // userId -> timestamp du dernier menu

client.on('messageCreate', async message => {
  // Ignore les bots et les messages hors MP
  if (message.author.bot) return;
  if (message.guild) return; // uniquement en MP

  // Cooldown de 20 secondes par utilisateur
  const now = Date.now();
  const dernier = menuCooldowns.get(message.author.id) || 0;
  if (now - dernier < 20000) return; // moins de 20s : on ignore
  menuCooldowns.set(message.author.id, now);

  try {
    await message.reply({
      content: '👋 Que veux-tu consulter ?',
      components: [buildMenuMP()]
    });
  } catch (e) { console.error('Erreur menu MP:', e.message); }
});

// ===== EXPRESS =====
const app = express();
app.use(express.json());

// ===== ROUTE PING (keep-alive UptimeRobot) =====
app.get('/ping', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));
app.get('/', (req, res) => res.send('MultiBOT en ligne 🐺'));

// ===== CORS (autorise le site Black Wolves à parler au bot depuis le navigateur) =====
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ===== ROUTE LOGS SITE BLACK WOLVES =====
app.post('/log', async (req, res) => {
  const { secret, type, message, user } = req.body || {};
  if (secret !== LOG_SECRET) return res.status(403).json({ error: 'Refusé' });
  try {
    const channel = await client.channels.fetch(LOG_CHANNEL_ID);
    const embed = new EmbedBuilder()
      .setTitle('📡 ' + (type || 'LOG'))
      .setDescription(message || '—')
      .setColor(0x5f86a3)
      .setFooter({ text: '🐺 ' + (user || 'Système') + ' · Site Black Wolves' })
      .setTimestamp();
    await channel.send({ embeds: [embed] });
    res.json({ success: true });
  } catch (e) {
    console.error('Log site error:', e.message);
    res.status(500).json({ error: 'Erreur' });
  }
});

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

// ===== STEAM WORKSHOP — SURVEILLANCE =====

// Récupère les détails de l'addon (abonnés, favoris, vues, votes)
async function getSteamDetails() {
  try {
    const params = new URLSearchParams();
    params.append('itemcount', '1');
    params.append('publishedfileids[0]', STEAM_ADDON_ID);
    const res = await fetch('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });
    const data = await res.json();
    const f = data?.response?.publishedfiledetails?.[0];
    if (!f || f.result !== 1) return null;
    return {
      title: f.title,
      subscriptions: f.subscriptions || 0,
      favorited: f.favorited || 0,
      views: f.views || 0,
      votesUp: f.vote_data?.votes_up ?? (f.favorited || 0),
      lifetimeSubs: f.lifetime_subscriptions || 0,
      previewUrl: f.preview_url
    };
  } catch (e) {
    console.error('Erreur Steam details:', e.message);
    return null;
  }
}

// Récupère le nombre total de commentaires de l'addon
async function getSteamCommentCount() {
  try {
    const params = new URLSearchParams();
    params.append('start', '0');
    params.append('totalcount', '1');
    params.append('count', '1');
    const res = await fetch(`https://steamcommunity.com/comment/PublishedFile_Public/render/0/${STEAM_ADDON_ID}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });
    const data = await res.json();
    return data?.total_count || 0;
  } catch (e) {
    console.error('Erreur Steam comments:', e.message);
    return null;
  }
}

// Envoie un message dans le salon Steam
async function envoyerSteam(embed) {
  try {
    const channel = await client.channels.fetch(STEAM_CHANNEL_ID);
    if (channel) await channel.send({ embeds: [embed] });
  } catch (e) { console.error('Erreur envoi salon Steam:', e.message); }
}

// Vérifie les changements (abonnés, favoris, votes, commentaires)
async function verifierSteam() {
  if (!STEAM_API_KEY && !STEAM_ADDON_ID) return;
  const details = await getSteamDetails();
  if (!details) return;
  const commentCount = await getSteamCommentCount();

  // Charger l'état précédent depuis MongoDB
  let steamState = await db.collection('steam').findOne({ _id: 'state' });
  if (!steamState) {
    // Première fois : on initialise sans notifier
    await db.collection('steam').insertOne({
      _id: 'state',
      subscriptions: details.subscriptions,
      favorited: details.favorited,
      votesUp: details.votesUp,
      views: details.views,
      comments: commentCount || 0,
      views2hStart: details.views,
      lastSummary: Date.now()
    });
    console.log('État Steam initialisé.');
    return;
  }

  // Détecter les changements
  const diffSubs = details.subscriptions - steamState.subscriptions;
  const diffFav = details.favorited - steamState.favorited;
  const diffVotes = details.votesUp - steamState.votesUp;
  const diffComments = (commentCount !== null) ? commentCount - (steamState.comments || 0) : 0;

  if (diffSubs > 0) {
    await envoyerSteam(new EmbedBuilder()
      .setTitle('📈 Nouvel abonné !')
      .setColor(0x4CAF50)
      .setDescription(`**+${diffSubs}** abonné(s) sur **${details.title}**`)
      .addFields({ name: '👥 Total abonnés', value: `**${details.subscriptions}**`, inline: true })
      .setThumbnail(details.previewUrl || null)
      .setTimestamp());
  } else if (diffSubs < 0) {
    await envoyerSteam(new EmbedBuilder()
      .setTitle('📉 Désabonnement')
      .setColor(0xf44336)
      .setDescription(`**${diffSubs}** abonné(s) sur **${details.title}**`)
      .addFields({ name: '👥 Total abonnés', value: `**${details.subscriptions}**`, inline: true })
      .setTimestamp());
  }

  if (diffFav > 0) {
    await envoyerSteam(new EmbedBuilder()
      .setTitle('⭐ Nouveau favori !')
      .setColor(0xFFD700)
      .setDescription(`**+${diffFav}** favori(s) sur **${details.title}**`)
      .addFields({ name: '⭐ Total favoris', value: `**${details.favorited}**`, inline: true })
      .setTimestamp());
  }

  if (diffVotes > 0) {
    await envoyerSteam(new EmbedBuilder()
      .setTitle('👍 Nouveau like !')
      .setColor(0x1565c0)
      .setDescription(`**+${diffVotes}** like(s) sur **${details.title}**`)
      .addFields({ name: '👍 Total likes', value: `**${details.votesUp}**`, inline: true })
      .setTimestamp());
  }

  if (diffComments > 0) {
    await envoyerSteam(new EmbedBuilder()
      .setTitle('💬 Nouveau commentaire !')
      .setColor(0x9B59B6)
      .setDescription(`**+${diffComments}** commentaire(s) sur **${details.title}**\n[Voir les commentaires](https://steamcommunity.com/sharedfiles/filedetails/comments/${STEAM_ADDON_ID})`)
      .addFields({ name: '💬 Total commentaires', value: `**${commentCount}**`, inline: true })
      .setTimestamp());
  }

  // Résumé toutes les 24h
  const intervalleSummary = 24 * 60 * 60 * 1000;
  let nouveauSummary = steamState.lastSummary;
  let nouveauViews2hStart = steamState.views2hStart;
  if (Date.now() - steamState.lastSummary >= intervalleSummary) {
    const vues2h = details.views - (steamState.views2hStart || details.views);
    const subs2h = details.subscriptions - (steamState.subsSummaryStart ?? steamState.subscriptions);
    await envoyerSteam(new EmbedBuilder()
      .setTitle('📊 Résumé des 24 dernières heures')
      .setColor(0xFFD700)
      .setDescription(`**${details.title}**`)
      .addFields(
        { name: '👁️ Vues (24h)', value: `**+${vues2h}**`, inline: true },
        { name: '👁️ Vues totales', value: `**${details.views}**`, inline: true },
        { name: '\u200B', value: '\u200B', inline: true },
        { name: '👥 Abonnés totaux', value: `**${details.subscriptions}**`, inline: true },
        { name: '⭐ Favoris', value: `**${details.favorited}**`, inline: true },
        { name: '👍 Likes', value: `**${details.votesUp}**`, inline: true }
      )
      .setThumbnail(details.previewUrl || null)
      .setFooter({ text: 'Note : Steam ne fournit que les vues totales, pas les visites uniques' })
      .setTimestamp());
    nouveauSummary = Date.now();
    nouveauViews2hStart = details.views;
  }

  // Sauvegarder le nouvel état
  await db.collection('steam').replaceOne({ _id: 'state' }, {
    _id: 'state',
    subscriptions: details.subscriptions,
    favorited: details.favorited,
    votesUp: details.votesUp,
    views: details.views,
    comments: commentCount !== null ? commentCount : (steamState.comments || 0),
    views2hStart: nouveauViews2hStart,
    subsSummaryStart: (nouveauSummary !== steamState.lastSummary) ? details.subscriptions : (steamState.subsSummaryStart ?? steamState.subscriptions),
    lastSummary: nouveauSummary
  }, { upsert: true });
}

// ===== DÉMARRAGE =====
const PORT = process.env.PORT || 3000;

client.once('ready', () => {
  console.log(`Bot connecté : ${client.user.tag}`);
  envoyerLog('🟢 Bot démarré', `**${client.user.tag}** en ligne !`, 0x4CAF50);
  enregistrerCommandes();
  // Surveillance Steam toutes les 2 minutes
  setTimeout(() => verifierSteam(), 10000); // premier check après 10s
  setInterval(() => verifierSteam(), 2 * 60 * 1000);
});

connectMongo().then(() => {
  client.login(BOT_TOKEN).then(() => {
    app.listen(PORT, () => console.log('Serveur démarré sur port ' + PORT));
  });
});
