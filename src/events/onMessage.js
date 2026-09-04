"use strict";
import chalk from "chalk";
import { handleMessage, handleEvent, handleReaction } from "../core/Router.js";
import { recordStoryEvent, recordFriendEvent } from "../server/dashboard/facebook-store.js";

/**
 * Detect and capture story events from MQTT stream
 * FCA passes through raw events — stories may appear with certain types or attachment structures
 * @param {object} event - raw MQTT event
 */
function detectStoryEvent(event) {
  // Check event type for story-like events
  const storyTypes = ["story_reaction", "story_reply", "story_mention"];
  if (storyTypes.includes(event.type)) {
    recordStoryEvent({
      storyID:   event.storyID || event.threadID || null,
      senderID:  event.senderID || event.actorID || null,
      senderName:event.senderName || null,
      preview:   event.body || event.reactionType || null,
      timestamp: event.timestamp || Date.now(),
      type:      event.type,
    });
    return;
  }

  // Check attachments for story-related content
  if (Array.isArray(event.attachments)) {
    for (const att of event.attachments) {
      const attType = att?.type || att?.mimeType || "";
      if (
        attType.toLowerCase().includes("story") ||
        att?.url?.includes("/stories/") ||
        att?.storyID
      ) {
        recordStoryEvent({
          storyID:    att.storyID || att.attachmentID || null,
          senderID:   event.senderID || null,
          senderName: null,
          preview:    att.title || att.description || att.url || null,
          timestamp:  event.timestamp || Date.now(),
          type:       "story_attachment",
        });
        break;
      }
    }
  }

  // Log:story — Facebook sometimes sends story events as log events
  if (event.type === "log" && event.logMessageType?.includes("story")) {
    recordStoryEvent({
      storyID:   event.messageID || null,
      senderID:  event.author || event.senderID || null,
      senderName:null,
      preview:   event.logMessageBody || null,
      timestamp: event.timestamp || Date.now(),
      type:      "log_story",
    });
  }
}

/**
 * Detect friend-related events from MQTT
 * @param {object} event - raw MQTT event
 */
function detectFriendEvent(event) {
  const friendEventTypes = ["friend_request", "friend_add", "friend_confirmed", "friendship"];
  if (friendEventTypes.includes(event.type)) {
    recordFriendEvent({
      senderID:   event.senderID || event.actorID || null,
      senderName: event.senderName || null,
      type:       event.type,
      timestamp:  event.timestamp || Date.now(),
    });
  }
}

export function dispatchMqttEvent(api, event, label, acceptedThreads) {
  if (global.isBanned(event.threadID, event.senderID ?? event.userID)) return;

  // Auto-accept message requests from unknown threads
  if (
    event.threadID &&
    ["message", "message_reply"].includes(event.type) &&
    !acceptedThreads.has(event.threadID) &&
    typeof api.handleMessageRequest === "function"
  ) {
    acceptedThreads.add(event.threadID);
    api.handleMessageRequest([event.threadID], true, (err) => {
      if (err) {
        acceptedThreads.delete(event.threadID);
      }
    });
  }

  // Detect and store story/friend events for the dashboard
  detectStoryEvent(event);
  detectFriendEvent(event);

  if (["message", "message_reply", "log", "event"].includes(event.type)) {
    handleEvent(api, event).catch(e => console.error(`[EVENT ERR:${label}]`, e.message));
    handleMessage(api, event).catch(e => console.error(`[EVENT ERR:${label}]`, e.message));
  } else if (event.type === "message_reaction") {
    handleReaction(api, event);
  }
}
