// ============================================================
//  community.js — Module rôles-réactions + messages personnalisés
//
//  Se branche sur MultiBOT (discord.js v14) sans toucher au reste.
//
//  Intégration dans index.js :
//    const community = require('./community');
//    // dans connectMongo(), après avoir défini `db` :
//    community.initCommunity(db);
//    // dans client.once('ready'), après enregistrement des commandes globales :
//    // (les commandes du module sont incluses via community.getCommands())
//    // dans client.on('interactionCreate', ...) tout en haut :
//    if (await community.handleInteraction(interaction)) return;
//
//  Commandes ajoutées :
//    /rolereaction ajouter   -> lie un emoji à un rôle sur un message
//    /rolereaction retirer   -> retire une liaison
//    /rolereaction liste     -> voir les liaisons
//    /embed                  -> crée un message embed personnalisé
//    /say                    -> envoie un message simple (texte)
// ============================================================

const {
  SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType
} = require('discord.js');

let db = null;
let rrCol = null; // collection role_reactions

function initCommunity(database) {
  db = database;
  rrCol = db.collection('role_reactions');
}

// ---- Commandes exposées (à fusionner dans la liste globale) ----
function getCommands() {
  return [
    new SlashCommandBuilder()
      .setName('rolereaction')
      .setDescription('Gérer les rôles-réactions (admin)')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .addSubcommand(sub => sub.setName('ajouter').setDescription('Lier un emoji à un rôle sur un message')
        .addStringOption(o => o.setName('message_id').setDescription('ID du message cible').setRequired(true))
        .addStringOption(o => o.setName('emoji').setDescription('L\'emoji').setRequired(true))
        .addRoleOption(o => o.setName('role').setDescription('Le rôle à donner').setRequired(true)))
      .addSubcommand(sub => sub.setName('retirer').setDescription('Retirer une liaison emoji-rôle')
        .addStringOption(o => o.setName('message_id').setDescription('ID du message').setRequired(true))
        .addStringOption(o => o.setName('emoji').setDescription('L\'emoji').setRequired(true)))
      .addSubcommand(sub => sub.setName('liste').setDescription('Voir toutes les liaisons')),

    new SlashCommandBuilder()
      .setName('embed')
      .setDescription('Envoyer un message embed personnalisé (admin)')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addStringOption(o => o.setName('titre').setDescription('Titre de l\'embed').setRequired(true))
      .addStringOption(o => o.setName('description').setDescription('Texte (utilise \\n pour un saut de ligne)').setRequired(true))
      .addStringOption(o => o.setName('couleur').setDescription('Couleur hex (ex: #FFD700)').setRequired(false))
      .addChannelOption(o => o.setName('salon').setDescription('Salon cible (défaut: ici)').setRequired(false))
      .addStringOption(o => o.setName('image').setDescription('URL d\'une image').setRequired(false))
      .addStringOption(o => o.setName('footer').setDescription('Texte du pied de page').setRequired(false)),

    new SlashCommandBuilder()
      .setName('say')
      .setDescription('Envoyer un message texte simple via le bot (admin)')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addStringOption(o => o.setName('message').setDescription('Le message').setRequired(true))
      .addChannelOption(o => o.setName('salon').setDescription('Salon cible (défaut: ici)').setRequired(false)),
  ].map(c => c.toJSON());
}

// ---- Normalise un emoji (unicode ou custom <:name:id>) ----
function normEmoji(raw) {
  const m = raw.match(/<a?:\w+:(\d+)>/);
  return m ? m[1] : raw.trim();
}

// ---- Gère les interactions du module. Retourne true si géré. ----
async function handleInteraction(interaction) {
  if (!rrCol) return false;

  // ----- Slash commands -----
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    if (commandName === 'rolereaction') {
      const sub = interaction.options.getSubcommand();

      if (sub === 'ajouter') {
        const messageId = interaction.options.getString('message_id');
        const emojiRaw = interaction.options.getString('emoji');
        const role = interaction.options.getRole('role');
        const emoji = normEmoji(emojiRaw);

        // Tenter d'ajouter la réaction au message
        let targetMsg = null;
        try {
          targetMsg = await interaction.channel.messages.fetch(messageId);
          await targetMsg.react(emojiRaw);
        } catch (e) {
          return interaction.reply({ content: `❌ Impossible de réagir au message ${messageId} dans ce salon. Lance la commande dans le salon du message et vérifie l'emoji.`, ephemeral: true });
        }

        await rrCol.updateOne(
          { messageId, emoji, guildId: interaction.guild.id },
          { $set: { messageId, emoji, emojiRaw, roleId: role.id, guildId: interaction.guild.id, channelId: interaction.channel.id } },
          { upsert: true }
        );
        return interaction.reply({ content: `✅ ${emojiRaw} → **${role.name}** sur le message \`${messageId}\``, ephemeral: true });
      }

      if (sub === 'retirer') {
        const messageId = interaction.options.getString('message_id');
        const emoji = normEmoji(interaction.options.getString('emoji'));
        const r = await rrCol.deleteOne({ messageId, emoji, guildId: interaction.guild.id });
        return interaction.reply({ content: r.deletedCount ? '✅ Liaison retirée.' : '⚠️ Aucune liaison trouvée.', ephemeral: true });
      }

      if (sub === 'liste') {
        const list = await rrCol.find({ guildId: interaction.guild.id }).toArray();
        if (!list.length) return interaction.reply({ content: 'Aucune liaison configurée.', ephemeral: true });
        const desc = list.map(l => `${l.emojiRaw || l.emoji} → <@&${l.roleId}> (msg \`${l.messageId}\`)`).join('\n');
        const embed = new EmbedBuilder().setTitle('🎭 Rôles-réactions').setColor(0x5865F2).setDescription(desc.slice(0, 4000));
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }
    }

    if (commandName === 'embed') {
      const titre = interaction.options.getString('titre');
      const description = interaction.options.getString('description').replace(/\\n/g, '\n');
      const couleurRaw = interaction.options.getString('couleur');
      const salon = interaction.options.getChannel('salon') || interaction.channel;
      const image = interaction.options.getString('image');
      const footer = interaction.options.getString('footer');

      let couleur = 0x5865F2;
      if (couleurRaw) {
        const hex = couleurRaw.replace('#', '');
        const parsed = parseInt(hex, 16);
        if (!isNaN(parsed)) couleur = parsed;
      }

      const embed = new EmbedBuilder().setTitle(titre).setDescription(description).setColor(couleur);
      if (image) embed.setImage(image);
      if (footer) embed.setFooter({ text: footer });

      try {
        await salon.send({ embeds: [embed] });
        return interaction.reply({ content: `✅ Embed envoyé dans ${salon}.`, ephemeral: true });
      } catch (e) {
        return interaction.reply({ content: `❌ Erreur : ${e.message}`, ephemeral: true });
      }
    }

    if (commandName === 'say') {
      const message = interaction.options.getString('message').replace(/\\n/g, '\n');
      const salon = interaction.options.getChannel('salon') || interaction.channel;
      try {
        await salon.send(message);
        return interaction.reply({ content: `✅ Message envoyé dans ${salon}.`, ephemeral: true });
      } catch (e) {
        return interaction.reply({ content: `❌ Erreur : ${e.message}`, ephemeral: true });
      }
    }
  }

  return false; // pas géré par ce module
}

// ---- Écouteurs de réactions (à brancher sur le client) ----
function attachReactionListeners(client) {
  client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot || !rrCol) return;
    try {
      if (reaction.partial) await reaction.fetch();
      const emoji = reaction.emoji.id || reaction.emoji.name;
      const binding = await rrCol.findOne({ messageId: reaction.message.id, emoji });
      if (!binding) return;
      const guild = reaction.message.guild;
      const member = await guild.members.fetch(user.id);
      const role = guild.roles.cache.get(binding.roleId);
      if (role && member) await member.roles.add(role, 'Rôle-réaction');
    } catch (e) { console.error('Erreur reactionAdd:', e.message); }
  });

  client.on('messageReactionRemove', async (reaction, user) => {
    if (user.bot || !rrCol) return;
    try {
      if (reaction.partial) await reaction.fetch();
      const emoji = reaction.emoji.id || reaction.emoji.name;
      const binding = await rrCol.findOne({ messageId: reaction.message.id, emoji });
      if (!binding) return;
      const guild = reaction.message.guild;
      const member = await guild.members.fetch(user.id);
      const role = guild.roles.cache.get(binding.roleId);
      if (role && member) await member.roles.remove(role, 'Rôle-réaction retiré');
    } catch (e) { console.error('Erreur reactionRemove:', e.message); }
  });
}

module.exports = { initCommunity, getCommands, handleInteraction, attachReactionListeners };
