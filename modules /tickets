// ============================================================
//  tickets.js — Système de tickets modulable (config en base, pilotable via dashboard)
//
//  Intégration dans index.js :
//    const tickets = require('./modules/tickets');
//    // dans connectMongo(), après `db` défini :
//    await tickets.initTickets(db, client);
//    // dans interactionCreate, tout en haut (après community) :
//    if (await tickets.handleInteraction(interaction)) return;
//
//  Config stockée dans la collection `config`, document _id='tickets'.
//  Le dashboard lira/écrira ce document pour tout personnaliser.
// ============================================================

const {
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder,
  ButtonStyle, ChannelType, PermissionFlagsBits, AttachmentBuilder
} = require('discord.js');

let db = null;
let client = null;
let cfgCol = null;

// ---- Config par défaut (le dashboard pourra tout changer) ----
const DEFAULT_CONFIG = {
  _id: 'tickets',
  enabled: true,
  guildId: null,                 // rempli au premier panneau
  categoryId: null,              // catégorie Discord où créer les salons de tickets
  transcriptChannelId: null,     // salon d'archives des transcripts
  staffRoleIds: [],              // rôles qui voient/gèrent les tickets
  panelTitle: '🎫 Ouvrir un ticket',
  panelDescription: 'Choisis la catégorie qui correspond le mieux à ta demande dans le menu ci-dessous.',
  panelColor: '#5865F2',
  welcomeMessage: 'Bonjour {user} ! Un membre du staff va te répondre bientôt. Décris ton problème en détail.',
  categories: [
    { id: 'support', label: 'Support', emoji: '🛠️', description: 'Besoin d\'aide technique' },
    { id: 'question', label: 'Question générale', emoji: '💬', description: 'Une question sur nos services' },
    { id: 'bug', label: 'Signaler un bug', emoji: '🐛', description: 'Reporter un problème' },
    { id: 'achat', label: 'Achat / Boutique', emoji: '🛒', description: 'Questions sur un achat' }
  ]
};

async function initTickets(database, discordClient) {
  db = database;
  client = discordClient;
  cfgCol = db.collection('config');
  const existing = await cfgCol.findOne({ _id: 'tickets' });
  if (!existing) await cfgCol.insertOne(DEFAULT_CONFIG);
  console.log('[Tickets] Module initialisé.');
}

async function getConfig() {
  const c = await cfgCol.findOne({ _id: 'tickets' });
  return c || DEFAULT_CONFIG;
}

// ---- Vérifie si un membre est staff ----
function isStaff(member, cfg) {
  if (member.permissions.has(PermissionFlagsBits.ManageChannels)) return true;
  return (cfg.staffRoleIds || []).some(rid => member.roles.cache.has(rid));
}

// ---- Poste le panneau de tickets dans le salon courant ----
async function postPanel(interaction, cfg) {
  const embed = new EmbedBuilder()
    .setTitle(cfg.panelTitle)
    .setDescription(cfg.panelDescription)
    .setColor(parseInt((cfg.panelColor || '#5865F2').replace('#', ''), 16));

  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket_open')
    .setPlaceholder('Sélectionne le type de problème…')
    .addOptions((cfg.categories || []).map(c => ({
      label: c.label.slice(0, 100),
      value: c.id,
      description: (c.description || '').slice(0, 100),
      emoji: c.emoji || undefined
    })));

  await interaction.channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] });
}

// ---- Crée un salon de ticket ----
async function createTicket(interaction, categoryId, cfg) {
  const guild = interaction.guild;
  const member = interaction.member;
  const cat = (cfg.categories || []).find(c => c.id === categoryId);
  if (!cat) return interaction.reply({ content: '❌ Catégorie inconnue.', ephemeral: true });

  // Anti-doublon : un ticket ouvert par personne
  const existing = await db.collection('tickets').findOne({ guildId: guild.id, userId: member.id, status: 'open' });
  if (existing) {
    const ch = guild.channels.cache.get(existing.channelId);
    if (ch) return interaction.reply({ content: `⚠️ Tu as déjà un ticket ouvert : ${ch}`, ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  // Permissions : le membre + le staff voient le salon
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
  ];
  for (const rid of (cfg.staffRoleIds || [])) {
    if (guild.roles.cache.has(rid)) {
      overwrites.push({ id: rid, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
    }
  }

  const num = (await db.collection('tickets').countDocuments({ guildId: guild.id })) + 1;
  const channelName = `ticket-${String(num).padStart(4, '0')}`;

  let channel;
  try {
    channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: cfg.categoryId || null,
      permissionOverwrites: overwrites,
      topic: `Ticket de ${member.user.tag} — ${cat.label}`
    });
  } catch (e) {
    return interaction.editReply({ content: `❌ Impossible de créer le salon : ${e.message}. Vérifie que la catégorie est configurée et que le bot a la permission Gérer les salons.` });
  }

  await db.collection('tickets').insertOne({
    guildId: guild.id, channelId: channel.id, userId: member.id,
    category: categoryId, number: num, status: 'open', createdAt: new Date()
  });

  const welcome = (cfg.welcomeMessage || 'Bonjour {user} !').replace('{user}', `<@${member.id}>`);
  const embed = new EmbedBuilder()
    .setTitle(`🎫 Ticket #${num} — ${cat.emoji || ''} ${cat.label}`)
    .setDescription(welcome)
    .setColor(0x5865F2)
    .setTimestamp();

  const actions = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_close').setLabel('Fermer').setEmoji('🔒').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ticket_transcript').setLabel('Transcript (EN)').setEmoji('📄').setStyle(ButtonStyle.Secondary)
  );

  await channel.send({ content: `<@${member.id}>`, embeds: [embed], components: [actions] });
  await interaction.editReply({ content: `✅ Ton ticket a été créé : ${channel}` });
}

// ---- Traduction gratuite via l'endpoint Google Translate non-officiel ----
async function translateToEnglish(text) {
  if (!text || !text.trim()) return text;
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (Array.isArray(data) && Array.isArray(data[0])) {
      return data[0].map(chunk => chunk[0]).join('');
    }
  } catch (e) { console.error('Erreur traduction:', e.message); }
  return text; // fallback : texte original
}

// ---- Génère et envoie le transcript (traduit en anglais) ----
async function generateTranscript(interaction, cfg) {
  await interaction.deferReply();
  const channel = interaction.channel;
  const ticket = await db.collection('tickets').findOne({ channelId: channel.id });

  // Récupérer tous les messages
  let messages = [];
  let lastId = null;
  for (let i = 0; i < 10; i++) { // max ~1000 messages
    const batch = await channel.messages.fetch({ limit: 100, ...(lastId ? { before: lastId } : {}) });
    if (batch.size === 0) break;
    messages.push(...batch.values());
    lastId = batch.last().id;
    if (batch.size < 100) break;
  }
  messages.reverse();

  // Construire le texte + traduire chaque message
  const lines = [];
  for (const m of messages) {
    if (!m.content) continue;
    const traduit = await translateToEnglish(m.content);
    const time = new Date(m.createdTimestamp).toISOString().slice(0, 16).replace('T', ' ');
    lines.push(`[${time}] ${m.author.tag}: ${traduit}`);
  }

  const header = `=== TICKET TRANSCRIPT (translated to English) ===\nChannel: ${channel.name}\nDate: ${new Date().toISOString()}\nMessages: ${lines.length}\n${'='.repeat(50)}\n\n`;
  const content = header + (lines.join('\n') || '(no text messages)');
  const buffer = Buffer.from(content, 'utf-8');
  const file = new AttachmentBuilder(buffer, { name: `transcript-${channel.name}.txt` });

  // Envoyer dans le salon d'archives si configuré, sinon ici
  const archiveId = cfg.transcriptChannelId;
  let sentTo = null;
  if (archiveId) {
    try {
      const archive = await client.channels.fetch(archiveId);
      if (archive) {
        await archive.send({ content: `📄 Transcript de **${channel.name}** (${lines.length} messages)`, files: [file] });
        sentTo = archive;
      }
    } catch (e) { console.error('Erreur archive transcript:', e.message); }
  }

  if (sentTo) {
    await interaction.editReply({ content: `✅ Transcript généré et envoyé dans ${sentTo}.` });
  } else {
    await interaction.editReply({ content: '📄 Transcript généré (aucun salon d\'archives configuré) :', files: [file] });
  }
}

// ---- Ferme un ticket ----
async function closeTicket(interaction) {
  const channel = interaction.channel;
  const ticket = await db.collection('tickets').findOne({ channelId: channel.id });
  if (!ticket) return interaction.reply({ content: '❌ Ce salon n\'est pas un ticket.', ephemeral: true });

  await interaction.reply({ content: '🔒 Fermeture du ticket dans 5 secondes…' });
  await db.collection('tickets').updateOne({ channelId: channel.id }, { $set: { status: 'closed', closedAt: new Date(), closedBy: interaction.user.id } });
  setTimeout(async () => {
    try { await channel.delete('Ticket fermé'); } catch (e) { console.error('Erreur suppression ticket:', e.message); }
  }, 5000);
}

// ---- Handler principal ----
async function handleInteraction(interaction) {
  if (!cfgCol) return false;

  // Menu d'ouverture
  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_open') {
    const cfg = await getConfig();
    if (!cfg.enabled) return interaction.reply({ content: '❌ Les tickets sont désactivés.', ephemeral: true }), true;
    await createTicket(interaction, interaction.values[0], cfg);
    return true;
  }

  // Boutons du ticket
  if (interaction.isButton()) {
    if (interaction.customId === 'ticket_close') {
      const cfg = await getConfig();
      const ticket = await db.collection('tickets').findOne({ channelId: interaction.channel.id });
      if (ticket && (interaction.user.id === ticket.userId || isStaff(interaction.member, cfg))) {
        await closeTicket(interaction);
      } else {
        await interaction.reply({ content: '❌ Seul le créateur du ticket ou le staff peut le fermer.', ephemeral: true });
      }
      return true;
    }
    if (interaction.customId === 'ticket_transcript') {
      const cfg = await getConfig();
      if (!isStaff(interaction.member, cfg)) {
        await interaction.reply({ content: '❌ Seul le staff peut générer un transcript.', ephemeral: true });
        return true;
      }
      await generateTranscript(interaction, cfg);
      return true;
    }
  }

  return false;
}

// ---- Commande /panel pour poster le panneau (appelée depuis index) ----
async function postPanelCommand(interaction) {
  const cfg = await getConfig();
  // Mémoriser le guildId
  if (!cfg.guildId) await cfgCol.updateOne({ _id: 'tickets' }, { $set: { guildId: interaction.guild.id } });
  await postPanel(interaction, cfg);
}

module.exports = { initTickets, handleInteraction, getConfig, postPanelCommand };
