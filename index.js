const { Client, GatewayIntentBits, Partials, EmbedBuilder, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');
const { MongoClient } = require('mongodb');
const express = require('express');
const crypto = require('crypto');
const community = require('./modules/community');
const dashboard = require('./modules/dashboard');
const tickets = require('./modules/tickets');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessageReactions],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
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
const STEAM_ADDON_IDS = process.env.STEAM_ADDON_IDS
  ? process.env.STEAM_ADDON_IDS.split(',').map(id => id.trim()).filter(Boolean)
  : ['3750430777', '3757736571'];
const STEAM_CHANNEL_ID = process.env.STEAM_CHANNEL_ID || '1520336068602232862';

// ===== PATREON =====
const PATREON_SECRET = process.env.PATREON_SECRET || 'GZObk8ze15kOorzCMZrcWqy8pMAdz5j2-JSzBYh4fObkASJ5NsaFoxuYHszLQ921';
const PATREON_CHANNEL_ID = process.env.PATREON_CHANNEL_ID || '1520336068602232862';

// ===== CONFIG SERVEUR (setup / rolemenu / reset) =====
const R_FONDATEUR = '👑 Fondateur';
const R_DEV = '🛠️ Développeur';
const R_MOD = '🛡️ Modérateur';
const R_PREMIUM = '⭐ Client Premium';
const R_SUPPORTER = '💚 Supporter';
const R_GERANT = '🎮 Gérant de serveur';
const R_ANNONCES = '🔔 Annonces';
const R_MEMBRE = '👤 Membre';
const R_SORTIES = '🆕 Nouvelles sorties';
const R_BETA = '🧪 Bêta-testeur';

const STAFF_ROLES = [R_FONDATEUR, R_DEV, R_MOD];

// [nom, couleur, permissions, mentionnable]
const SETUP_ROLES = [
  [R_FONDATEUR, 0xF1C40F, [PermissionFlagsBits.Administrator], true],
  [R_DEV, 0x9B59B6, [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageThreads], true],
  [R_MOD, 0x3498DB, [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers, PermissionFlagsBits.ModerateMembers, PermissionFlagsBits.ManageNicknames], true],
  [R_PREMIUM, 0xE74C3C, [], false],
  [R_SUPPORTER, 0x2ECC71, [], false],
  [R_GERANT, 0x1ABC9C, [], true],
  [R_ANNONCES, 0x95A5A6, [], false],
  [R_MEMBRE, 0x99AAB5, [], false],
  [R_SORTIES, 0x5DADE2, [], false],
  [R_BETA, 0xE67E22, [], false]
];

// Premium et Supporter volontairement absents : donnés à la main
const SELF_ROLES = [
  [R_MEMBRE, 'Accès de base à la communauté'],
  [R_GERANT, 'Tu gères un serveur qui utilise mes addons'],
  [R_ANNONCES, 'Être ping à chaque mise à jour'],
  [R_SORTIES, 'Être ping pour les nouvelles sorties'],
  [R_BETA, 'Tester les versions bêta']
];

const STRUCTURE = [
  { name: '📋 Informations', channels: [
    { name: 'bienvenue', mode: 'read_only' },
    { name: 'règles', mode: 'read_only' },
    { name: 'annonces', mode: 'read_only' },
    { name: 'rôles', mode: 'read_only' },
    { name: 'liens', mode: 'read_only' }
  ]},
  { name: '🎮 Addons', channels: [
    { name: 'showcase' },
    { name: 'changelog', mode: 'read_only' },
    { name: 'roadmap', mode: 'read_only' },
    { name: 'turbolaser' },
    { name: 'holocomm' },
    { name: 'gm-tool' }
  ]},
  { name: '🛠️ Support', channels: [
    { name: 'support-gratuit' },
    { name: 'support-premium', mode: 'premium' },
    { name: 'bug-report' },
    { name: 'suggestions' },
    { name: 'faq', mode: 'read_only' }
  ]},
  { name: '💬 Communauté', channels: [
    { name: 'général' },
    { name: 'média' },
    { name: 'recrutement' },
    { name: 'Vocal', type: 'voice' }
  ]}
];

const SETUP_ROLE_NAMES = new Set(SETUP_ROLES.map(r => r[0]));
const SETUP_CAT_NAMES = new Set(STRUCTURE.map(c => c.name));

// ===== LOGS SITE BLACK WOLVES =====
const LOG_SECRET = process.env.LOG_SECRET || "K1nv]8R63c£3";
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || "1513861797965201518";

let db;

// ===== MONGODB =====
async function connectMongo() {
  const mongoClient = new MongoClient(MONGODB_URL);
  await mongoClient.connect();
  db = mongoClient.db('multibot');
  console.log('MongoDB connecté !');
  community.initCommunity(db);
  await tickets.initTickets(db, client);
}

// admins = liste fixe via variable d'environnement USER_IDS
async function getAdmins() { return USER_IDS; }
async function isAdmin(userId) { return USER_IDS.includes(userId); }

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

// ===== COMMANDES =====
const commands = [
  new SlashCommandBuilder().setName('mp').setDescription('Envoyer un MP à un membre (admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o => o.setName('membre').setDescription('Membre à contacter').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Message').setRequired(true)),

  new SlashCommandBuilder().setName('message').setDescription('Envoyer dans un salon (admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o => o.setName('salon').setDescription('Salon cible').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Message').setRequired(true)),

  new SlashCommandBuilder().setName('setup').setDescription('Construit le serveur complet (admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('rolemenu').setDescription('Poste le menu des auto-rôles (admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('reset').setDescription('⚠️ Supprime tout ce que /setup a créé (admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder().setName('panel').setDescription('Poster le panneau de tickets (admin)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

].map(c => c.toJSON());

async function enregistrerCommandes() {
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  const MON_SERVEUR = '975054589407674430';
  try {
    // Commandes perso (mp, message, setup, rolemenu, reset) → uniquement sur mon serveur
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, MON_SERVEUR), { body: commands });
    console.log('Commandes serveur (perso) enregistrées !');
    // Commandes communauté (rolereaction, embed, say) → globales
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: community.getCommands() });
    console.log('Commandes globales (communauté) enregistrées !');
  } catch (err) { console.error('Erreur commandes:', err); }
}

// ===== SETUP SERVEUR — helpers =====
async function ensureRoles(guild) {
  const created = {};
  for (const [name, color, perms, mentionable] of SETUP_ROLES) {
    let role = guild.roles.cache.find(r => r.name === name);
    if (!role) {
      role = await guild.roles.create({ name, color, permissions: perms, mentionable, reason: 'Auto-setup' });
    }
    created[name] = role;
  }
  return created;
}

function overwritesFor(guild, roles, mode) {
  const everyone = guild.roles.everyone;
  const ow = [];
  if (mode === 'read_only') {
    ow.push({ id: everyone.id, deny: [PermissionFlagsBits.SendMessages], allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.AddReactions] });
    for (const r of STAFF_ROLES) {
      if (roles[r]) ow.push({ id: roles[r].id, allow: [PermissionFlagsBits.SendMessages] });
    }
  } else if (mode === 'premium') {
    ow.push({ id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] });
    if (roles[R_PREMIUM]) ow.push({ id: roles[R_PREMIUM].id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
    for (const r of STAFF_ROLES) {
      if (roles[r]) ow.push({ id: roles[r].id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
    }
  }
  return ow;
}

function buildRoleMenu() {
  const rows = [];
  let current = new ActionRowBuilder();
  let count = 0;
  for (const [name] of SELF_ROLES) {
    if (count === 5) { rows.push(current); current = new ActionRowBuilder(); count = 0; }
    current.addComponents(new ButtonBuilder().setCustomId(`selfrole:${name}`).setLabel(name).setStyle(ButtonStyle.Secondary));
    count++;
  }
  if (count > 0) rows.push(current);
  return rows;
}

// ===== INTERACTIONS =====
client.on('interactionCreate', async interaction => {
  // Module communauté (rôles-réactions, embed, say) — priorité
  try { if (await community.handleInteraction(interaction)) return; } catch (e) { console.error('Erreur community:', e.message); }
  // Module tickets
  try { if (await tickets.handleInteraction(interaction)) return; } catch (e) { console.error('Erreur tickets:', e.message); }

  const userId = interaction.user.id;
  const admin = await isAdmin(userId);

  // ===== SLASH COMMANDS =====
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    // /setup
    if (commandName === 'setup') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator))
        return interaction.reply({ content: '❌ Il faut être Administrateur.', ephemeral: true });
      await interaction.reply({ content: '⚙️ Construction en cours…', ephemeral: true });
      const guild = interaction.guild;
      try {
        const roles = await ensureRoles(guild);
        for (const cat of STRUCTURE) {
          let category = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === cat.name);
          if (!category) category = await guild.channels.create({ name: cat.name, type: ChannelType.GuildCategory, reason: 'Auto-setup' });
          for (const ch of cat.channels) {
            const slug = ch.name.toLowerCase().replace(/ /g, '-');
            const exists = guild.channels.cache.find(c => c.parentId === category.id && (c.name === slug || c.name === ch.name));
            if (exists) continue;
            const mode = ch.mode || 'open';
            const ow = mode !== 'open' ? overwritesFor(guild, roles, mode) : [];
            const type = ch.type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;
            await guild.channels.create({ name: ch.name, type, parent: category.id, permissionOverwrites: ow, reason: 'Auto-setup' });
          }
        }
        await interaction.editReply({ content: '✅ **Serveur construit !** Va dans #rôles et lance `/rolemenu`.' });
      } catch (e) {
        console.error('Erreur setup:', e);
        await interaction.editReply({ content: `❌ Erreur : ${e.message}\nVérifie que le rôle du bot est tout en haut et qu'il a la permission Administrateur.` });
      }
    }

    // /rolemenu
    else if (commandName === 'rolemenu') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator))
        return interaction.reply({ content: '❌ Il faut être Administrateur.', ephemeral: true });
      let desc = '**Choisis tes rôles** — clique pour ajouter / retirer :\n\n';
      desc += SELF_ROLES.map(([name, d]) => `${name} — ${d}`).join('\n');
      desc += '\n\n*⭐ Client Premium et 💚 Supporter sont attribués manuellement.*';
      const embed = new EmbedBuilder().setTitle('🎭 Auto-rôles').setDescription(desc).setColor(0x5865F2);
      await interaction.channel.send({ embeds: [embed], components: buildRoleMenu() });
      await interaction.reply({ content: '✅ Menu posté.', ephemeral: true });
    }

    // /reset
    else if (commandName === 'reset') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator))
        return interaction.reply({ content: '❌ Il faut être Administrateur.', ephemeral: true });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('reset_confirm').setLabel('🗑️ Tout supprimer').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('reset_cancel').setLabel('Annuler').setStyle(ButtonStyle.Secondary)
      );
      await interaction.reply({
        content: '⚠️ **Attention** : ça supprime toutes les catégories, salons et rôles créés par `/setup`.\nCe que tu as ajouté toi-même hors de cette liste n\'est **pas** touché.\n\nConfirmer ?',
        components: [row], ephemeral: true
      });
    }

    // /panel
    else if (commandName === 'panel') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels))
        return interaction.reply({ content: '❌ Il faut la permission Gérer les salons.', ephemeral: true });
      await tickets.postPanelCommand(interaction);
      await interaction.reply({ content: '✅ Panneau de tickets posté.', ephemeral: true });
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
  }

  // ===== BOUTONS =====
  else if (interaction.isButton()) {
    // Auto-rôles : tout le monde peut cliquer
    if (interaction.customId.startsWith('selfrole:')) {
      const roleName = interaction.customId.slice('selfrole:'.length);
      const role = interaction.guild.roles.cache.find(r => r.name === roleName);
      if (!role) return interaction.reply({ content: '❌ Rôle introuvable — relance /setup.', ephemeral: true });
      try {
        if (interaction.member.roles.cache.has(role.id)) {
          await interaction.member.roles.remove(role, 'Auto-rôle');
          return interaction.reply({ content: `➖ **${role.name}** retiré.`, ephemeral: true });
        } else {
          await interaction.member.roles.add(role, 'Auto-rôle');
          return interaction.reply({ content: `➕ **${role.name}** ajouté.`, ephemeral: true });
        }
      } catch (e) {
        return interaction.reply({ content: `❌ Impossible : le rôle du bot doit être au-dessus de **${role.name}** dans la hiérarchie.`, ephemeral: true });
      }
    }

    // Reset : confirmation (admin uniquement)
    if (interaction.customId === 'reset_confirm' || interaction.customId === 'reset_cancel') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator))
        return interaction.reply({ content: '❌ Il faut être Administrateur.', ephemeral: true });
      if (interaction.customId === 'reset_cancel') {
        return interaction.update({ content: '❎ Annulé — rien n\'a été supprimé.', components: [] });
      }
      await interaction.update({ content: '🗑️ Suppression en cours…', components: [] });
      const guild = interaction.guild;
      const deleted = { channels: 0, categories: 0, roles: 0, errors: 0 };
      // Salons + catégories
      for (const cat of STRUCTURE) {
        const category = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === cat.name);
        if (!category) continue;
        const children = guild.channels.cache.filter(c => c.parentId === category.id);
        for (const [, channel] of children) {
          try { await channel.delete('Reset'); deleted.channels++; } catch (e) { deleted.errors++; }
        }
        try { await category.delete('Reset'); deleted.categories++; } catch (e) { deleted.errors++; }
      }
      // Rôles
      for (const [, role] of guild.roles.cache) {
        if (SETUP_ROLE_NAMES.has(role.name) && !role.managed && role.id !== guild.roles.everyone.id) {
          try { await role.delete('Reset'); deleted.roles++; } catch (e) { deleted.errors++; }
        }
      }
      return interaction.editReply({
        content: `🗑️ **Reset terminé** — ${deleted.categories} catégories, ${deleted.channels} salons, ${deleted.roles} rôles supprimés` +
          (deleted.errors ? ` (${deleted.errors} erreurs, souvent des rôles au-dessus du bot).` : '.')
      });
    }
  }
});

// ===== EXPRESS =====
const app = express();
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
}));

// ===== CORS (autorise le dashboard à appeler l'API) =====
app.use((req, res, next) => { res.header("Access-Control-Allow-Origin", "*"); next(); });

// ===== MODULE CC-API =====
const { ccRouter, initCC } = require('./cc-api');
initCC(MONGODB_URL);
app.use('/cc', ccRouter);

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

// ===== PATREON — Webhook nouvel abonné =====
app.post('/patreon', async (req, res) => {
  // Vérifier la signature Patreon (HMAC-MD5 du corps brut avec le secret)
  try {
    const signature = req.get('X-Patreon-Signature');
    const event = req.get('X-Patreon-Event'); // ex: "members:pledge:create"
    if (req.rawBody && signature) {
      const hash = crypto.createHmac('md5', PATREON_SECRET).update(req.rawBody).digest('hex');
      if (hash !== signature) {
        console.error('Patreon: signature invalide');
        return res.status(403).json({ error: 'signature invalide' });
      }
    }

    // On réagit aux abonnements (create) et désabonnements (delete)
    const estAbonnement = event ? event.includes('create') : true;
    const estDesabonnement = event ? event.includes('delete') : false;
    if (event && !estAbonnement && !estDesabonnement) {
      return res.json({ ok: true, ignored: event });
    }

    const data = req.body?.data;
    const included = req.body?.included || [];

    // Récupérer le nom du patron
    const userInc = included.find(i => i.type === 'user');
    const nomPatron = userInc?.attributes?.full_name || data?.attributes?.full_name || 'Un patron';

    // Récupérer le montant (en centimes -> euros/dollars)
    const cents = data?.attributes?.currently_entitled_amount_cents
      ?? data?.attributes?.pledge_amount_cents
      ?? data?.attributes?.amount_cents
      ?? null;
    const montant = cents !== null ? (cents / 100).toFixed(2) : null;

    // Récupérer le tier si dispo
    const tierInc = included.find(i => i.type === 'tier');
    const tierNom = tierInc?.attributes?.title || null;

    let embed;
    if (estDesabonnement) {
      embed = new EmbedBuilder()
        .setTitle('💔 Désabonnement Patreon')
        .setColor(0x95a5a6) // gris
        .setDescription(`**${nomPatron}** s'est désabonné.`)
        .setTimestamp();
      if (montant !== null) embed.addFields({ name: '💰 Ancien montant', value: `**${montant} €/mois**`, inline: true });
      if (tierNom) embed.addFields({ name: '⭐ Ancien palier', value: `**${tierNom}**`, inline: true });
    } else {
      embed = new EmbedBuilder()
        .setTitle('🎉 Nouvel abonné Patreon !')
        .setColor(0xF96854) // couleur Patreon
        .setDescription(`**${nomPatron}** vient de s'abonner ! Merci ! 🧡`)
        .setTimestamp();
      if (montant !== null) embed.addFields({ name: '💰 Montant', value: `**${montant} €/mois**`, inline: true });
      if (tierNom) embed.addFields({ name: '⭐ Palier', value: `**${tierNom}**`, inline: true });
    }

    try {
      const channel = await client.channels.fetch(PATREON_CHANNEL_ID);
      if (channel) await channel.send({ embeds: [embed] });
    } catch (e) { console.error('Erreur envoi salon Patreon:', e.message); }

    res.json({ ok: true });
  } catch (e) {
    console.error('Erreur webhook Patreon:', e.message);
    res.status(500).json({ error: e.message });
  }
});


// ===== STEAM WORKSHOP — SURVEILLANCE =====

// Récupère les détails d'un addon (abonnés, favoris, vues, votes)
async function getSteamDetails(addonId) {
  try {
    const params = new URLSearchParams();
    params.append('itemcount', '1');
    params.append('publishedfileids[0]', addonId);
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

// Récupère le nombre total de commentaires d'un addon
async function getSteamCommentCount(addonId) {
  try {
    const params = new URLSearchParams();
    params.append('start', '0');
    params.append('totalcount', '1');
    params.append('count', '1');
    const res = await fetch(`https://steamcommunity.com/comment/PublishedFile_Public/render/0/${addonId}/`, {
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
async function envoyerSteam(embed, content = null) {
  try {
    const channel = await client.channels.fetch(STEAM_CHANNEL_ID);
    if (channel) {
      const payload = { embeds: [embed] };
      if (content) {
        payload.content = content;
        payload.allowedMentions = { roles: ['905540994144030800'] };
      }
      await channel.send(payload);
    }
  } catch (e) { console.error('Erreur envoi salon Steam:', e.message); }
}

// Vérifie un seul addon
async function verifierUnAddon(addonId) {
  const details = await getSteamDetails(addonId);
  if (!details) return;
  const commentCount = await getSteamCommentCount(addonId);

  // Charger l'état précédent depuis MongoDB (un document par addon)
  const stateId = `state_${addonId}`;
  let steamState = await db.collection('steam').findOne({ _id: stateId });
  if (!steamState) {
    await db.collection('steam').insertOne({
      _id: stateId,
      addonId,
      subscriptions: details.subscriptions,
      favorited: details.favorited,
      votesUp: details.votesUp,
      views: details.views,
      comments: commentCount || 0,
      viewsSummaryStart: details.views,
      subsSummaryStart: details.subscriptions,
      lastSummary: Date.now()
    });
    console.log(`État Steam initialisé pour ${addonId}.`);
    return;
  }

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
      .setDescription(`**+${diffComments}** commentaire(s) sur **${details.title}**\n[Voir les commentaires](https://steamcommunity.com/sharedfiles/filedetails/comments/${addonId})`)
      .addFields({ name: '💬 Total commentaires', value: `**${commentCount}**`, inline: true })
      .setTimestamp(),
      '<@&905540994144030800>');
  }

  // Résumé toutes les 24h (par addon)
  const intervalleSummary = 24 * 60 * 60 * 1000;
  let nouveauSummary = steamState.lastSummary;
  let nouveauViewsStart = steamState.viewsSummaryStart ?? details.views;
  let nouveauSubsStart = steamState.subsSummaryStart ?? details.subscriptions;
  if (Date.now() - steamState.lastSummary >= intervalleSummary) {
    const vues24h = details.views - (steamState.viewsSummaryStart || details.views);
    const subs24h = details.subscriptions - (steamState.subsSummaryStart ?? details.subscriptions);
    await envoyerSteam(new EmbedBuilder()
      .setTitle('📊 Résumé des 24 dernières heures')
      .setColor(0xFFD700)
      .setDescription(`**${details.title}**`)
      .addFields(
        { name: '👁️ Vues (24h)', value: `**+${vues24h}**`, inline: true },
        { name: '👁️ Vues totales', value: `**${details.views}**`, inline: true },
        { name: '👥 Abonnés (24h)', value: `**${subs24h >= 0 ? '+' : ''}${subs24h}**`, inline: true },
        { name: '👥 Abonnés totaux', value: `**${details.subscriptions}**`, inline: true },
        { name: '⭐ Favoris', value: `**${details.favorited}**`, inline: true },
        { name: '👍 Likes', value: `**${details.votesUp}**`, inline: true }
      )
      .setThumbnail(details.previewUrl || null)
      .setFooter({ text: 'Note : Steam ne fournit que les vues totales, pas les visites uniques' })
      .setTimestamp());
    nouveauSummary = Date.now();
    nouveauViewsStart = details.views;
    nouveauSubsStart = details.subscriptions;
  }

  await db.collection('steam').replaceOne({ _id: stateId }, {
    _id: stateId,
    addonId,
    subscriptions: details.subscriptions,
    favorited: details.favorited,
    votesUp: details.votesUp,
    views: details.views,
    comments: commentCount !== null ? commentCount : (steamState.comments || 0),
    viewsSummaryStart: nouveauViewsStart,
    subsSummaryStart: nouveauSubsStart,
    lastSummary: nouveauSummary
  }, { upsert: true });
}

// Vérifie tous les addons
async function verifierSteam() {
  if (!STEAM_ADDON_IDS.length) return;
  for (const addonId of STEAM_ADDON_IDS) {
    await verifierUnAddon(addonId);
  }
}

// ===== DÉMARRAGE =====
const PORT = process.env.PORT || 3000;

client.once('ready', () => {
  console.log(`Bot connecté : ${client.user.tag}`);
  envoyerLog('🟢 Bot démarré', `**${client.user.tag}** en ligne !`, 0x4CAF50);
  enregistrerCommandes();
  community.attachReactionListeners(client);
  // Surveillance Steam toutes les 2 minutes
  setTimeout(() => verifierSteam(), 10000); // premier check après 10s
  setInterval(() => verifierSteam(), 2 * 60 * 1000);
});

connectMongo().then(() => {
  client.login(BOT_TOKEN).then(() => {
    dashboard.initDashboard({ app, client, db, guildId: '1532545431006089236' });
    app.listen(PORT, () => console.log('Serveur démarré sur port ' + PORT));
  });
});
