const { Client, GatewayIntentBits, Partials } = require('discord.js');

function createClient() {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildModeration,
    ],
    partials: [Partials.Channel, Partials.Message, Partials.GuildMember],
  });
}

module.exports = { createClient };
