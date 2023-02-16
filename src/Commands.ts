import { ChannelType, ChatInputCommandInteraction, GuildMemberRoleManager, GuildScheduledEventEntityType, GuildScheduledEventPrivacyLevel, SlashCommandBuilder, ThreadChannel } from "discord.js";
import { deseralizeEventEmbed } from "./Content/Embed/eventEmbed";
import { eventModal } from "./Content/Modal/eventModal";
import { configuration, EventMonkeyEvent } from "./EventMonkey";
import { getEvent, saveEvent } from "./EventsUnderConstruction";

export const eventCommand = {
  builder: () => {
    const builder = new SlashCommandBuilder()
      .setName(configuration.commandName)
      .setDescription("Create an event");

    if (configuration.eventTypes.length > 1) {
      builder.addStringOption((option) => {
        option.setName("type").setDescription("The type of event to schedule");
        option.addChoices(
          ...configuration.eventTypes.map((eventType) => {
            return { name: eventType.name, value: eventType.channel };
          })
        );
        option.setRequired(true);
        return option;
      });
    }

    builder.addStringOption((option) => {
      option
        .setName("location")
        .setDescription("The type of location the event will be at");
      option.addChoices(
        ...[
          {
            name: "External",
            value: GuildScheduledEventEntityType.External.toString(),
            entityType: GuildScheduledEventEntityType.External,
          },
          {
            name: "Voice",
            value: GuildScheduledEventEntityType.Voice.toString(),
            entityType: GuildScheduledEventEntityType.Voice,
          },
          {
            name: "Stage",
            value: GuildScheduledEventEntityType.StageInstance.toString(),
            entityType: GuildScheduledEventEntityType.StageInstance,
          },
        ].filter(
          (x) =>
            !configuration.allowedEntityTypes ||
            configuration.allowedEntityTypes.includes(x.entityType)
        )
      );
      option.setRequired(true);
      return option;
    });

    return builder;
  },
  execute: executeEventCommand,
};

async function executeEventCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild || !interaction.channel) return;
  if (!interaction.member?.roles || !interaction.memberPermissions) {
    interaction.reply({
      content: "This command can only be used in a channel.",
      ephemeral: true,
    });
    return;
  }

  if (!checkRolePermissions(interaction)) {
    return;
  }

  const forumChannelId = interaction.options.getString("type") ?? "";
  const entityType = Number(
    interaction.options.getString("location")
  ) as GuildScheduledEventEntityType;
  const defaultStartTime = new Date();
  defaultStartTime.setDate(defaultStartTime.getDate() + 1);
  const defaultDuration = 1;

  const newEvent: EventMonkeyEvent =
    getEvent(interaction.user.id) ?? 
      {
          name: "New Meetup",
          description: "Your meetup description",
          image: "",
          scheduledStartTime: defaultStartTime,
          duration: defaultDuration,
          entityMetadata: {
            location:
              entityType === GuildScheduledEventEntityType.External
                ? "Meetup Location"
                : "Channel Name",
          },
          privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
          id: crypto.randomUUID(),
          forumChannelId,
          author: interaction.user,
          entityType,
        };

  newEvent.entityType = entityType;
  saveEvent(newEvent);

  await eventModal(newEvent, interaction);
}

export const editEventCommand = {
  builder: () =>
    new SlashCommandBuilder()
      .setName(`${configuration.commandName}-edit`)
      .setDescription("Edit an event")
      .addChannelOption((option) =>
        option
          .setName("thread")
          .setRequired(true)
          .setDescription("The thread for the event you want to edit.")
          .addChannelTypes(ChannelType.PublicThread, ChannelType.PrivateThread)
      ),
  execute: executeEditCommand,
};

async function executeEditCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild || !interaction.channel) return;
  const channel = interaction.options.getChannel("thread") as ThreadChannel;
  if (!checkRolePermissions(interaction)) {
    return;
  }

  const event = await deseralizeEventEmbed(
    channel,
    channel.client
  );

  if (event.author.id !== interaction.user.id) {
    interaction.reply({
      content: "Sorry, you can only edit events that you created!",
      ephemeral: true,
    });

    return;
  }

  if (
    event.threadChannel &&
    event.scheduledStartTime.valueOf() < new Date().valueOf()
  ) {
    interaction.reply({
      content: "You can't edit an event that is in the past.",
      ephemeral: true,
    });

    return;
  }

  if (event.threadChannel && event.threadChannel.archived) {
    interaction.reply({
      content: "You can't edit an event that has been cancelled.",
      ephemeral: true,
    });

    return;
  }

  await eventModal(event, interaction);
}

function checkRolePermissions(
  interaction: ChatInputCommandInteraction
): boolean {
  if (!interaction.member) return false;

  let allowed = configuration.roleIds?.allowed == null;
  const memberPermissions = interaction.memberPermissions;
  if (memberPermissions && memberPermissions.has("Administrator")) {
    return true;
  }

  if (memberPermissions) {
    const userRoles = interaction.member.roles as GuildMemberRoleManager;
    if (configuration.roleIds?.allowed) {
      for (const roleId of configuration.roleIds.allowed) {
        if (userRoles.cache.has(roleId)) {
          allowed = true;
          break;
        }
      }
    }

    if (configuration.roleIds?.denied) {
      for (const roleId of configuration.roleIds.denied) {
        if (userRoles.cache.has(roleId)) {
          allowed = false;
          break;
        }
      }
    }
  }

  if (!allowed) {
    interaction.reply({
      content:
        "Sorry, but you do not have permissions to create or edit events.",
      ephemeral: true,
    });
  }

  return allowed;
}